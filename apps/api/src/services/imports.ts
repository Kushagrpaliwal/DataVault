import { and, eq } from "drizzle-orm";
import {
  attachments, evidenceSnapshots, noteRevisions, notes, organizations, savedRecords, savedRecordCollections,
  savedRecordTags, tags, vaultCollections, vaults, withTenant,
} from "@data-vault/database";
import type { z } from "zod";
import type { importCreateSchema } from "@data-vault/schemas";
import type { TenantContext } from "../auth/context";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/crypto";
import { writeAudit } from "./audit";
import { mapSavedRecord } from "./records";

type ImportInput = z.infer<typeof importCreateSchema>;

/**
 * One thing that is being brought in.
 */
export interface ImportedItem {
  title: string;
  url: string;
  /** The folder it was in, as a path such as `Reading/Long`. */
  folder?: string | undefined;
}

/**
 * The items of a bookmarks file.
 *
 * Every browser writes the same file when the bookmarks are exported, and
 * it is a list of folders and links. The folders are read as they are
 * nested, so that a bookmark that was in a folder can be put back in one.
 */
export function parseBookmarks(html: string): ImportedItem[] {
  const items: ImportedItem[] = [];
  const folders: (string | undefined)[] = [];
  let pending: string | undefined;
  const pattern = /<dl[^>]*>|<\/dl>|<dt[^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>|<dt[^>]*>\s*<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const [whole, heading, attributes, label] = match;
    if (/^<dl/i.test(whole)) {
      folders.push(pending);
      pending = undefined;
      continue;
    }
    if (/^<\/dl/i.test(whole)) {
      folders.pop();
      continue;
    }
    if (heading !== undefined) {
      pending = decodeEntities(heading).trim();
      continue;
    }
    if (attributes === undefined) continue;
    const url = attribute(attributes, "href");
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const title = decodeEntities(label ?? "").trim();
    const folder = folders.filter((entry): entry is string => Boolean(entry)).join("/");
    items.push({ title: title || url, url, ...(folder ? { folder } : {}) });
  }
  return items;
}

/**
 * The items of a list of addresses.
 *
 * A line may be an address on its own, or a title and an address separated
 * by a bar.
 */
export function parseUrlList(text: string): ImportedItem[] {
  const items: ImportedItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [maybeTitle, maybeUrl] = trimmed.includes("|") ? trimmed.split("|", 2) : [undefined, trimmed];
    const url = (maybeUrl ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const title = (maybeTitle ?? "").trim();
    items.push({ title: title || url, url });
  }
  return items;
}

/**
 * The value of an attribute of a tag.
 */
function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attributes);
  const value = match?.[2] ?? match?.[3] ?? match?.[4];
  return value ? decodeEntities(value) : undefined;
}

/**
 * The characters that a web page may write in a way that is not what it means.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Bring material into a workspace.
 *
 * The items are filed in a folder of their own, and the folders they came
 * from become collections, so that the shape of the import is kept.
 */
export async function runImport(context: TenantContext, request: Request, input: ImportInput): Promise<{ imported: number; skipped: number; items: { id: string; title: string; url: string }[] }> {
  const items = input.kind === "bookmarks" ? parseBookmarks(input.content) : input.kind === "urls" ? parseUrlList(input.content) : [];
  if (input.kind === "datavault") throw new AppError(400, "IMPORT_NOT_SUPPORTED", "Bringing a DataVault export back in is not supported yet.");
  if (!items.length) throw new AppError(400, "NOTHING_TO_IMPORT", "There was nothing to bring in.");

  const name = input.name?.trim() || (input.kind === "bookmarks" ? "Imported bookmarks" : "Imported links");
  return withTenant(context.organizationId, async (tx) => {
    /**
     * The material goes into a folder of its own, unless the person chose
     * one.
     */
    let vaultId = input.vaultId;
    if (!vaultId) {
      const slug = `imported-${crypto.randomUUID().slice(0, 8)}`;
      const [vault] = await tx.insert(vaults).values({
        organizationId: context.organizationId,
        name,
        slug,
        description: `Brought in on ${new Date().toISOString().slice(0, 10)}.`,
        kind: "workspace",
        createdBy: context.userId,
      }).returning();
      if (!vault) throw new AppError(500, "IMPORT_FAILED", "The folder for the import could not be made.");
      vaultId = vault.id;
    }

    /**
     * The folders the material came from become collections, so that the
     * shape of the import is kept.
     */
    const collectionIds = new Map<string, string>();
    for (const item of items) {
      if (!item.folder) continue;
      if (collectionIds.has(item.folder)) continue;
      const [collection] = await tx.insert(vaultCollections).values({
        organizationId: context.organizationId,
        vaultId,
        name: item.folder.split("/").pop() ?? item.folder,
        color: "#b8a4ed",
        createdBy: context.userId,
      }).returning();
      if (collection) collectionIds.set(item.folder, collection.id);
    }

    const saved: { id: string; title: string; url: string }[] = [];
    let skipped = 0;
    for (const item of items) {
      const domain = hostOf(item.url);
      const title = item.title.slice(0, 300);
      const [record] = await tx.insert(savedRecords).values({
        organizationId: context.organizationId,
        vaultId,
        recordType: "bookmark",
        title,
        description: item.url,
        originalText: null,
        sourceType: "browser_extension",
        sourceUrl: item.url,
        sourceDomain: domain,
        sourcePageTitle: title,
        createdVia: "import",
        captureKind: "link",
        reviewStatus: "inbox",
        privacyLevel: "private",
        createdBy: context.userId,
      }).returning();
      if (!record) {
        skipped += 1;
        continue;
      }
      const collectionId = item.folder ? collectionIds.get(item.folder) : undefined;
      if (collectionId) {
        await tx.insert(savedRecordCollections).values({ savedRecordId: record.id, collectionId, organizationId: context.organizationId });
      }
      const hash = await sha256(item.url);
      await tx.insert(evidenceSnapshots).values({
        organizationId: context.organizationId,
        savedRecordId: record.id,
        sourceUrl: item.url,
        sourceTitle: title,
        sourceDomain: domain,
        capturedText: title,
        contentHash: hash,
        extractorId: "importer",
        extractorVersion: "1",
        capturedAt: new Date(),
      });
      await tx.insert(tags).values({ organizationId: context.organizationId, name: "imported", color: "#b8a4ed", createdBy: context.userId }).onConflictDoNothing({ target: [tags.organizationId, tags.name] });
      const [tag] = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.organizationId, context.organizationId), eq(tags.name, "imported"))).limit(1);
      if (tag) await tx.insert(savedRecordTags).values({ savedRecordId: record.id, tagId: tag.id, organizationId: context.organizationId });
      saved.push({ id: record.id, title, url: item.url });
    }

    await writeAudit(tx, context, request, { action: "imported", resourceType: "saved_record", resourceId: vaultId, newValues: { kind: input.kind, imported: saved.length, name } });
    return { imported: saved.length, skipped, items: saved };
  });
}

/**
 * The host of an address.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "imported";
  }
}

/**
 * Everything in a workspace, as one file.
 *
 * The file holds the items, the folders, the collections, the tags, the
 * docs and the attachments, so that the workspace can be read somewhere
 * else, or brought back if it is lost.
 */
export async function exportWorkspace(context: TenantContext) {
  return withTenant(context.organizationId, async (tx) => {
    const [organization] = await tx.select({ id: organizations.id, name: organizations.name, slug: organizations.slug }).from(organizations).where(eq(organizations.id, context.organizationId)).limit(1);
    const [folderRows, collectionRows, tagRows] = await Promise.all([
      tx.select().from(vaults).where(eq(vaults.organizationId, context.organizationId)),
      tx.select().from(vaultCollections).where(eq(vaultCollections.organizationId, context.organizationId)),
      tx.select().from(tags).where(eq(tags.organizationId, context.organizationId)),
    ]);
    const recordRows = await tx.select().from(savedRecords).where(eq(savedRecords.organizationId, context.organizationId));
    const itemRows = await tx.select().from(savedRecordCollections).where(eq(savedRecordCollections.organizationId, context.organizationId));
    const tagRowsForItems = await tx.select().from(savedRecordTags).where(eq(savedRecordTags.organizationId, context.organizationId));
    const evidenceRows = await tx.select().from(evidenceSnapshots).where(eq(evidenceSnapshots.organizationId, context.organizationId));
    const attachmentRows = await tx.select().from(attachments).where(eq(attachments.organizationId, context.organizationId));
    const noteRows = await tx.select().from(notes).where(eq(notes.organizationId, context.organizationId));
    const revisionRows = await tx.select().from(noteRevisions).where(eq(noteRevisions.organizationId, context.organizationId));

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      organization: organization ? { id: organization.id, name: organization.name, slug: organization.slug } : null,
      folders: folderRows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, description: row.description, color: row.color, isDefault: row.isDefault, createdAt: row.createdAt.toISOString() })),
      collections: collectionRows.map((row) => ({ id: row.id, folderId: row.vaultId, name: row.name, color: row.color })),
      tags: tagRows.map((row) => ({ id: row.id, name: row.name, color: row.color })),
      items: recordRows.map((row) => ({
        ...mapSavedRecord(row),
        collections: itemRows.filter((link) => link.savedRecordId === row.id).map((link) => link.collectionId),
        tags: tagRowsForItems.filter((link) => link.savedRecordId === row.id).map((link) => link.tagId),
        evidence: evidenceRows.filter((row2) => row2.savedRecordId === row.id).map((row2) => ({ id: row2.id, sourceUrl: row2.sourceUrl, sourceTitle: row2.sourceTitle, sourceDomain: row2.sourceDomain, capturedText: row2.capturedText, contentHash: row2.contentHash, capturedAt: row2.capturedAt.toISOString() })),
        attachments: attachmentRows.filter((row2) => row2.savedRecordId === row.id).map((row2) => ({ id: row2.id, fileName: row2.fileName, mimeType: row2.mimeType, byteSize: Number(row2.byteSize), sha256: row2.sha256, createdAt: row2.createdAt.toISOString() })),
      })),
      docs: noteRows.map((row) => ({
        id: row.id,
        folderId: row.vaultId,
        parentId: row.parentId,
        title: row.title,
        icon: row.icon,
        content: row.content,
        contentText: row.contentText,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        revisions: revisionRows.filter((row2) => row2.noteId === row.id).map((row2) => ({ version: row2.version, title: row2.title, content: row2.content, reason: row2.reason, createdAt: row2.createdAt.toISOString() })),
      })),
    };
  });
}
