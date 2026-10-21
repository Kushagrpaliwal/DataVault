import { and, eq, inArray, isNull } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import {
  attachments, evidenceSnapshots, noteRevisions, notes, organizations, savedRecords, savedRecordCollections,
  savedRecordTags, tags, vaultCollections, vaults, withTenant, type DatabaseTransaction,
} from "@data-vault/database";
import type { z } from "zod";
import type { JSONContent } from "@tiptap/core";
import type { importCreateSchema } from "@data-vault/schemas";
import type { TenantContext } from "../auth/context";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/crypto";
import { assertSameOrg } from "../lib/tenant-scope";
import { docToMarkdown } from "@data-vault/notes";
import { writeAudit } from "./audit";
import { mapSavedRecord } from "./records";

type ImportInput = z.infer<typeof importCreateSchema>;

/**
 * How many rows are written at a time.
 *
 * A file of bookmarks can hold thousands of items, and writing them one at
 * a time is slow. A few hundred at a time is quick without asking the
 * database to hold the whole file in one statement.
 */
const BATCH_SIZE = 500;

/**
 * One thing that is being brought in.
 */
export interface ImportedItem {
  title: string;
  url: string;
  /** The folder it was in, as a path such as `Reading/Long`. */
  folder?: string | undefined;
  /** The tags the file gave it. */
  tags?: string[] | undefined;
  /** The text the file kept of it, so that it can be searched. */
  text?: string | undefined;
  /** When it was saved, as the file recorded it. */
  capturedAt?: string | undefined;
  /** Whether the person had already dealt with it. */
  reviewStatus?: "inbox" | "reviewed" | undefined;
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
 * The rows of a comma-separated file.
 *
 * The rules are the ones of RFC 4180: the fields are separated by commas,
 * a field may be wrapped in quotes, and a quote inside a quoted field is
 * written twice. A line break may be either a newline or a newline with a
 * carriage return in front of it.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character !== '"') {
        field += character;
        continue;
      }
      /**
       * Two quotes in a row are one quote, and a single quote ends the
       * field.
       */
      if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (character === "\r") continue;
    if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += character;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * The columns each service writes.
 *
 * The three services that write a file of saved items all use their own
 * names for the same things, so the columns are looked up by name and the
 * file is read whichever service wrote it.
 */
const CSV_COLUMNS = {
  pocket: {
    /** Pocket keeps the words in a column of their own. */
    distinctive: ["time_added", "status"],
    url: ["url"],
    title: ["title"],
    tags: ["tags"],
    text: ["excerpt"],
    folder: [],
    time: ["time_added"],
  },
  raindrop: {
    distinctive: ["excerpt", "note", "created"],
    url: ["url"],
    title: ["title"],
    tags: ["tags"],
    text: ["note", "excerpt"],
    folder: ["folder"],
    time: ["created"],
  },
  instapaper: {
    distinctive: ["selection", "timestamp"],
    url: ["url"],
    title: ["title"],
    tags: [],
    text: ["selection"],
    folder: ["folder"],
    time: ["timestamp"],
  },
} as const;

type CsvSource = keyof typeof CSV_COLUMNS;

/**
 * The items of a file written by another service.
 *
 * The columns are found by their names, so a file with the columns in
 * another order, or with more columns than are needed, is still read.
 */
export function parseCsvItems(text: string): ImportedItem[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = (rows[0] ?? []).map((name) => name.trim().toLowerCase());
  const source = (Object.keys(CSV_COLUMNS) as CsvSource[]).find((name) =>
    CSV_COLUMNS[name].distinctive.some((column) => header.includes(column)));
  if (!source) return [];
  const columns = CSV_COLUMNS[source];
  const indexOf = (names: readonly string[]) => {
    for (const name of names) {
      const index = header.indexOf(name);
      if (index >= 0) return index;
    }
    return -1;
  };
  const urlAt = indexOf(columns.url);
  const titleAt = indexOf(columns.title);
  const tagsAt = indexOf(columns.tags);
  const textAt = indexOf(columns.text);
  const folderAt = indexOf(columns.folder);
  const timeAt = indexOf(columns.time);
  if (urlAt < 0 || titleAt < 0) return [];

  const items: ImportedItem[] = [];
  for (const row of rows.slice(1)) {
    const url = (row[urlAt] ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const title = (row[titleAt] ?? "").trim() || url;
    const tags = tagsAt >= 0 ? splitTags(row[tagsAt] ?? "") : [];
    const body = textAt >= 0 ? (row[textAt] ?? "").trim() : "";
    const folder = folderAt >= 0 ? (row[folderAt] ?? "").trim() : "";
    const time = timeAt >= 0 ? (row[timeAt] ?? "").trim() : "";
    const status = source === "pocket" ? (row[header.indexOf("status")] ?? "").trim().toLowerCase() : "";
    items.push({
      title,
      url,
      ...(tags.length ? { tags } : {}),
      ...(body ? { text: body } : {}),
      ...(folder ? { folder } : {}),
      ...(time ? { capturedAt: time } : {}),
      /**
       * An item that was still unread is one that has not been dealt with
       * yet, so it lands in the review queue.
       */
      ...(status === "archive" ? { reviewStatus: "reviewed" as const } : {}),
    });
  }
  return items;
}

/**
 * The tags of a row.
 *
 * The services write them separated by commas, and sometimes with a comma
 * inside the name, so the ones that look like a list are split.
 */
function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 20)
    .map((tag) => tag.slice(0, 60));
}

/**
 * The address of an item, in a shape that can be compared with another.
 *
 * The host is written in lower case, the part after the hash is dropped,
 * and the parameters that only say where a visit came from are dropped as
 * well. Two addresses that lead to the same page are then the same
 * address.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    const kept = [...parsed.searchParams.entries()].filter(([name]) => !name.toLowerCase().startsWith("utm_"));
    parsed.search = "";
    for (const [name, value] of kept) parsed.searchParams.append(name, value);
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

/**
 * The moment a file recorded, in one shape.
 *
 * Pocket writes the number of seconds since the beginning of the world,
 * and the other two write a date. Both are read here, and a moment that
 * cannot be read is left out rather than guessed at.
 */
export function parseWhen(value: string | undefined): Date | undefined {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const date = new Date(Number(trimmed) * 1000);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date;
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
 * A list in pieces of a given size.
 */
function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

/**
 * Bring material into a workspace.
 *
 * The items are filed in a folder of their own, and the folders they came
 * from become collections, so that the shape of the import is kept.
 *
 * An item that is already in the workspace is not brought in a second time,
 * and neither is one that appears twice in the file. Both are counted as
 * skipped, so the person is told what happened.
 */
export async function runImport(context: TenantContext, request: Request, input: ImportInput): Promise<{ imported: number; skipped: number; items: { id: string; title: string; url: string }[] }> {
  if (input.kind === "datavault") throw new AppError(400, "IMPORT_NOT_SUPPORTED", "Bringing a DataVault export back in is not supported yet.");
  const items = input.kind === "bookmarks"
    ? parseBookmarks(input.content)
    : input.kind === "urls"
      ? parseUrlList(input.content)
      : input.kind === "csv"
        ? parseCsvItems(input.content)
        : [];
  if (!items.length) throw new AppError(400, "NOTHING_TO_IMPORT", "There was nothing to bring in.");

  const name = input.name?.trim() || (input.kind === "bookmarks" ? "Imported bookmarks" : input.kind === "csv" ? "Imported items" : "Imported links");
  return withTenant(context.organizationId, async (tx) => {
    /**
     * The material goes into a folder of its own, unless the person chose
     * one.
     */
    let vaultId = input.vaultId;
    if (vaultId) {
      /**
       * The folder is named by the client, so it is checked here. Without
       * the check an import could put its items into a folder of another
       * workspace.
       */
      await assertSameOrg(tx, vaults, vaultId, context.organizationId, "folder");
    } else {
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
    const collectionIds = await makeCollections(tx, context, vaultId, items);
    /**
     * The tags are made once, before the items, because the items all use
     * the same few of them.
     */
    const tagIds = await makeTags(tx, context, items);

    /**
     * The addresses that are already in the workspace are not brought in
     * again.
     */
    const existing = new Set((await tx
      .select({ url: savedRecords.sourceUrl })
      .from(savedRecords)
      .where(and(eq(savedRecords.organizationId, context.organizationId), isNull(savedRecords.deletedAt))))
      .map((row) => row.url)
      .filter((url): url is string => Boolean(url))
      .map(normalizeUrl));
    const seen = new Set<string>();

    const saved: { id: string; title: string; url: string }[] = [];
    let skipped = 0;
    const prepared: PreparedItem[] = [];

    for (const item of items) {
      const key = normalizeUrl(item.url);
      if (seen.has(key) || existing.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      const domain = hostOf(item.url);
      const title = item.title.slice(0, 300);
      const tagNames = ["imported", ...(item.tags ?? [])];
      const capturedAt = parseWhen(item.capturedAt);
      prepared.push({
        values: {
          organizationId: context.organizationId,
          vaultId,
          recordType: "bookmark",
          title,
          description: item.url,
          originalText: item.text ?? null,
          sourceType: "browser_extension",
          sourceUrl: item.url,
          sourceDomain: domain,
          sourcePageTitle: title,
          createdVia: "import",
          captureKind: "link",
          reviewStatus: item.reviewStatus ?? "inbox",
          privacyLevel: "private",
          createdBy: context.userId,
          ...(capturedAt ? { capturedAt } : {}),
        },
        title,
        url: item.url,
        domain,
        text: item.text ?? null,
        collectionId: item.folder ? collectionIds.get(item.folder) : undefined,
        tagIds: tagNames.map((tagName) => tagIds.get(tagName)).filter((id): id is string => Boolean(id)),
      });
    }

    /**
     * The items are written down a few hundred at a time.
     */
    for (const batch of chunks(prepared, BATCH_SIZE)) {
      saved.push(...await writeBatch(tx, context, batch));
    }

    await writeAudit(tx, context, request, { action: "imported", resourceType: "saved_record", resourceId: vaultId, newValues: { kind: input.kind, imported: saved.length, skipped, name } });
    return { imported: saved.length, skipped, items: saved };
  });
}

/**
 * One item that is waiting to be written down.
 */
interface PreparedItem {
  values: typeof savedRecords.$inferInsert;
  title: string;
  url: string;
  domain: string;
  text: string | null;
  collectionId: string | undefined;
  tagIds: string[];
}

/**
 * Write a batch of items down.
 *
 * The items go in first, so that the rows that point at them can be
 * written with their addresses.
 */
async function writeBatch(tx: DatabaseTransaction, context: TenantContext, batch: PreparedItem[]): Promise<{ id: string; title: string; url: string }[]> {
  const inserted = await tx.insert(savedRecords).values(batch.map((entry) => entry.values)).returning({ id: savedRecords.id });
  const hashes = await Promise.all(batch.map((entry) => sha256(entry.url)));
  const saved: { id: string; title: string; url: string }[] = [];
  const collectionLinks: (typeof savedRecordCollections.$inferInsert)[] = [];
  const tagLinks: (typeof savedRecordTags.$inferInsert)[] = [];
  const evidence: (typeof evidenceSnapshots.$inferInsert)[] = [];
  batch.forEach((entry, index) => {
    const id = inserted[index]?.id;
    if (!id) return;
    saved.push({ id, title: entry.title, url: entry.url });
    if (entry.collectionId) collectionLinks.push({ savedRecordId: id, collectionId: entry.collectionId, organizationId: context.organizationId });
    for (const tagId of entry.tagIds) tagLinks.push({ savedRecordId: id, tagId, organizationId: context.organizationId });
    evidence.push({
      organizationId: context.organizationId,
      savedRecordId: id,
      sourceUrl: entry.url,
      sourceTitle: entry.title,
      sourceDomain: entry.domain,
      capturedText: entry.text ?? entry.title,
      contentHash: hashes[index]!,
      extractorId: "importer",
      extractorVersion: "1",
      capturedAt: new Date(),
    });
  });
  if (collectionLinks.length) await tx.insert(savedRecordCollections).values(collectionLinks);
  if (tagLinks.length) await tx.insert(savedRecordTags).values(tagLinks);
  if (evidence.length) await tx.insert(evidenceSnapshots).values(evidence);
  return saved;
}

/**
 * The collections for the folders the material came from.
 */
async function makeCollections(
  tx: DatabaseTransaction,
  context: TenantContext,
  vaultId: string,
  items: ImportedItem[],
): Promise<Map<string, string>> {
  const folders = [...new Set(items.map((item) => item.folder).filter((folder): folder is string => Boolean(folder)))];
  if (!folders.length) return new Map();
  const names = [...new Set(folders.map((folder) => folder.split("/").pop() ?? folder))];
  for (const batch of chunks(names, BATCH_SIZE)) {
    await tx.insert(vaultCollections).values(batch.map((collectionName) => ({
      organizationId: context.organizationId,
      vaultId,
      name: collectionName,
      color: "#b8a4ed",
      createdBy: context.userId,
    }))).onConflictDoNothing({ target: [vaultCollections.vaultId, vaultCollections.name] });
  }
  const rows = await tx.select({ id: vaultCollections.id, name: vaultCollections.name })
    .from(vaultCollections)
    .where(and(eq(vaultCollections.organizationId, context.organizationId), eq(vaultCollections.vaultId, vaultId), inArray(vaultCollections.name, names)));
  const byName = new Map(rows.map((row) => [row.name, row.id]));
  const byFolder = new Map<string, string>();
  for (const folder of folders) {
    const id = byName.get(folder.split("/").pop() ?? folder);
    if (id) byFolder.set(folder, id);
  }
  return byFolder;
}

/**
 * The tags the material carries, made once.
 */
async function makeTags(
  tx: DatabaseTransaction,
  context: TenantContext,
  items: ImportedItem[],
): Promise<Map<string, string>> {
  const names = new Set<string>(["imported"]);
  for (const item of items) for (const tag of item.tags ?? []) names.add(tag);
  const list = [...names];
  for (const batch of chunks(list, BATCH_SIZE)) {
    await tx.insert(tags).values(batch.map((tagName) => ({
      organizationId: context.organizationId,
      name: tagName,
      color: "#b8a4ed",
      createdBy: context.userId,
    }))).onConflictDoNothing({ target: [tags.organizationId, tags.name] });
  }
  const ids = new Map<string, string>();
  for (const batch of chunks(list, BATCH_SIZE)) {
    const rows = await tx.select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(and(eq(tags.organizationId, context.organizationId), inArray(tags.name, batch)));
    for (const row of rows) ids.set(row.name, row.id);
  }
  return ids;
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
    /**
     * The rows that belong to an item are gathered once and looked up by
     * the item they belong to. Looking through the whole list for every
     * item turns the export into a long wait.
     */
    const collectionsByRecord = groupBy(itemRows, (link) => link.savedRecordId, (link) => link.collectionId);
    const tagsByRecord = groupBy(tagRowsForItems, (link) => link.savedRecordId, (link) => link.tagId);
    const evidenceByRecord = groupBy(evidenceRows, (row) => row.savedRecordId, (row) => ({ id: row.id, sourceUrl: row.sourceUrl, sourceTitle: row.sourceTitle, sourceDomain: row.sourceDomain, capturedText: row.capturedText, pageHtml: row.pageHtml, contentHash: row.contentHash, capturedAt: row.capturedAt.toISOString() }));
    const attachmentsByRecord = groupBy(attachmentRows, (row) => row.savedRecordId, (row) => ({ id: row.id, fileName: row.fileName, mimeType: row.mimeType, byteSize: Number(row.byteSize), sha256: row.sha256, createdAt: row.createdAt.toISOString() }));
    const revisionsByDoc = groupBy(revisionRows, (row) => row.noteId, (row) => ({ version: row.version, title: row.title, content: row.content, reason: row.reason, createdAt: row.createdAt.toISOString() }));

    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      organization: organization ? { id: organization.id, name: organization.name, slug: organization.slug } : null,
      folders: folderRows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, description: row.description, color: row.color, isDefault: row.isDefault, createdAt: row.createdAt.toISOString() })),
      collections: collectionRows.map((row) => ({ id: row.id, folderId: row.vaultId, name: row.name, color: row.color })),
      tags: tagRows.map((row) => ({ id: row.id, name: row.name, color: row.color })),
      items: recordRows.map((row) => ({
        ...mapSavedRecord(row),
        collections: collectionsByRecord.get(row.id) ?? [],
        tags: tagsByRecord.get(row.id) ?? [],
        evidence: evidenceByRecord.get(row.id) ?? [],
        attachments: attachmentsByRecord.get(row.id) ?? [],
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
        revisions: revisionsByDoc.get(row.id) ?? [],
      })),
    };
  });
}

/**
 * The rows of a table, gathered by the item they belong to.
 */
function groupBy<Row, Key, Value>(rows: Row[], keyOf: (row: Row) => Key, valueOf: (row: Row) => Value): Map<Key, Value[]> {
  const grouped = new Map<Key, Value[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = grouped.get(key);
    if (list) list.push(valueOf(row));
    else grouped.set(key, [valueOf(row)]);
  }
  return grouped;
}

/**
 * The whole workspace, as one file that is opened like a folder.
 *
 * The file holds the same list as before, the docs as Markdown so that
 * they can be read anywhere, and the attachments as they are. Everything
 * is in one archive, so the workspace can be read somewhere else, or
 * brought back if it is lost.
 */
export async function exportWorkspaceArchive(context: TenantContext): Promise<Uint8Array> {
  const data = await exportWorkspace(context);
  const files: Record<string, Uint8Array> = {
    "datavault.json": strToU8(JSON.stringify(data, null, 2)),
  };

  const docs = await withTenant(context.organizationId, (tx) => tx
    .select({ id: notes.id, title: notes.title, content: notes.content })
    .from(notes)
    .where(and(eq(notes.organizationId, context.organizationId), isNull(notes.deletedAt))));
  const taken = new Set<string>();
  for (const doc of docs) {
    const slug = slugFor(doc.title, taken);
    const body = docToMarkdown(doc.content as unknown as JSONContent);
    files[`docs/${slug}.md`] = strToU8(`# ${doc.title}\n\n${body}\n`);
  }

  const rows = await withTenant(context.organizationId, (tx) => tx
    .select({ id: attachments.id, fileName: attachments.fileName, content: attachments.content })
    .from(attachments)
    .where(eq(attachments.organizationId, context.organizationId)));
  for (const row of rows) {
    files[`attachments/${row.id}-${safeFileName(row.fileName)}`] = new Uint8Array(row.content);
  }

  return zipSync(files, { level: 6 });
}

/**
 * The name of a doc in the archive.
 *
 * Two docs may have the same title, so the second one is given a number
 * rather than overwriting the first.
 */
function slugFor(title: string, taken: Set<string>): string {
  const base = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "doc";
  let slug = base;
  let count = 2;
  while (taken.has(slug)) {
    slug = `${base}-${count}`;
    count += 1;
  }
  taken.add(slug);
  return slug;
}

/**
 * The name of a file inside the archive.
 *
 * A name may not have a path in it, so anything of that sort is taken out
 * of it.
 */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "-").replace(/^\.+/, "").trim();
  return cleaned || "file";
}
