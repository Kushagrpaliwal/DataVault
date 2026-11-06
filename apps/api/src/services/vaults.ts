import { and, count, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { savedRecords, savedRecordTags, tags, vaults, vaultTags, withTenant } from "@data-vault/database";
import type { Vault, VaultTag } from "@data-vault/types";
import type { z } from "zod";
import type { itemOrganizationSchema, tagCreateSchema, tagPatchSchema, vaultCreateSchema, vaultPatchSchema } from "@data-vault/schemas";
import type { DatabaseTransaction } from "@data-vault/database";
import type { TenantContext } from "../auth/context";
import { AppError, notFound } from "../lib/errors";
import { writeAudit } from "./audit";
import { mapSavedRecord } from "./record-shape";

type VaultInput = z.infer<typeof vaultCreateSchema>;
type TagInput = z.infer<typeof tagCreateSchema>;
type OrganizationInput = z.infer<typeof itemOrganizationSchema>;

/**
 * How deep a tree of folders is allowed to go.
 *
 * A folder cannot be moved inside itself, so a tree cannot grow forever, but
 * the walk is given a limit as well so that a mistake in the data cannot
 * hang the server.
 */
const MAX_FOLDER_DEPTH = 50;

function mapVault(row: typeof vaults.$inferSelect): Vault {
  return { id: row.id, organizationId: row.organizationId, parentId: row.parentId, name: row.name, slug: row.slug, description: row.description, kind: row.kind, color: row.color, isDefault: row.isDefault, createdAt: row.createdAt.toISOString() };
}

export async function createDefaultVault(tx: DatabaseTransaction, organizationId: string, userId: string, isPersonal: boolean) {
  const [vault] = await tx.insert(vaults).values({
    organizationId,
    name: isPersonal ? "Personal Vault" : "Workspace Vault",
    slug: "inbox",
    kind: isPersonal ? "personal" : "workspace",
    color: isPersonal ? "#1a3a3a" : "#b8a4ed",
    isDefault: true,
    createdBy: userId,
  }).onConflictDoNothing().returning();
  if (vault) return vault;
  const [existing] = await tx.select().from(vaults).where(and(eq(vaults.organizationId, organizationId), eq(vaults.isDefault, true))).limit(1);
  if (!existing) throw new Error("A default vault could not be created.");
  return existing;
}

export async function defaultVaultId(tx: DatabaseTransaction, organizationId: string) {
  const [vault] = await tx.select({ id: vaults.id }).from(vaults).where(and(eq(vaults.organizationId, organizationId), eq(vaults.isDefault, true))).limit(1);
  if (!vault) throw new AppError(409, "VAULT_NOT_READY", "This workspace does not have a default vault yet. Apply the latest database migration and try again.");
  return vault.id;
}

/**
 * A folder and everything under it.
 *
 * A folder shows what is in it and what is in the folders inside it, so the
 * folders under it are needed whenever a folder is looked at. The walk is
 * done by the database, because the tree is read in one step.
 */
export async function descendantVaultIds(tx: DatabaseTransaction, organizationId: string, vaultId: string): Promise<string[]> {
  const rows = await tx.execute(sql`
    with recursive tree as (
      select id from vaults where organization_id = ${organizationId} and id = ${vaultId}
      union all
      select child.id from vaults child
        inner join tree on child.parent_id = tree.id
        where child.organization_id = ${organizationId}
    )
    select id from tree
  `);
  return (rows as unknown as { id: string }[]).map((row) => row.id);
}

/**
 * The folders of the workspace, with the number of items each one holds.
 *
 * The number is the number of items in the folder and in the folders under
 * it, so it says how much is there when the folder is opened.
 */
export async function listVaults(context: TenantContext): Promise<Vault[]> {
  return withTenant(context.organizationId, async (tx) => {
    const rows = await tx.select({
      ...getTableColumns(vaults),
      itemCount: count(savedRecords.id),
    }).from(vaults).leftJoin(savedRecords, and(eq(savedRecords.vaultId, vaults.id), isNull(savedRecords.deletedAt))).where(eq(vaults.organizationId, context.organizationId)).groupBy(vaults.id).orderBy(desc(vaults.isDefault), vaults.name);

    const vaultTagRows = await tx.select({
      vaultId: vaultTags.vaultId,
      id: tags.id,
      name: tags.name,
      color: tags.color,
    }).from(vaultTags)
      .innerJoin(tags, and(eq(tags.id, vaultTags.tagId), eq(tags.organizationId, context.organizationId)))
      .where(eq(vaultTags.organizationId, context.organizationId))
      .orderBy(tags.name);

    const vaultTagsMap = new Map<string, VaultTag[]>();
    for (const vt of vaultTagRows) {
      const list = vaultTagsMap.get(vt.vaultId) ?? [];
      list.push({ id: vt.id, name: vt.name, color: vt.color });
      vaultTagsMap.set(vt.vaultId, list);
    }

    /**
     * The number of a folder is its own plus the numbers of the folders
     * under it.
     *
     * The folders are few, so the whole tree is walked here rather than in
     * the database. The walk is given a limit, so a mistake in the data
     * cannot hang the server.
     */
    const children = new Map<string, string[]>();
    const own = new Map<string, number>();
    for (const row of rows) {
      own.set(row.id, Number(row.itemCount));
      if (row.parentId) {
        const list = children.get(row.parentId) ?? [];
        list.push(row.id);
        children.set(row.parentId, list);
      }
    }
    const totals = new Map<string, number>();
    const total = (id: string, depth: number): number => {
      const cached = totals.get(id);
      if (cached !== undefined) return cached;
      if (depth > MAX_FOLDER_DEPTH) return own.get(id) ?? 0;
      let sum = own.get(id) ?? 0;
      for (const child of children.get(id) ?? []) sum += total(child, depth + 1);
      totals.set(id, sum);
      return sum;
    };

    return rows.map((row) => ({
      ...mapVault(row),
      itemCount: total(row.id, 0),
      tags: vaultTagsMap.get(row.id) ?? [],
    }));
  });
}

/**
 * The name of a folder, written as an address.
 *
 * It is only used to keep the names of siblings apart, so a clash falls back
 * to the name that was already there.
 */
async function freeSlug(tx: DatabaseTransaction, organizationId: string, parentId: string | null, current: string, name: string): Promise<string> {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || current;
  const [taken] = await tx.select({ id: vaults.id }).from(vaults).where(and(
    eq(vaults.organizationId, organizationId),
    parentId ? eq(vaults.parentId, parentId) : isNull(vaults.parentId),
    eq(vaults.slug, base),
  )).limit(1);
  if (!taken || taken.id === current) return base;
  return current;
}

/**
 * The address of a folder that is being made.
 *
 * A number is put at the end when the name is already taken by a sibling, so
 * two folders in the same place can both be made.
 */
async function uniqueSlug(tx: DatabaseTransaction, organizationId: string, parentId: string | null, name: string): Promise<string> {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "folder";
  let slug = base;
  let suffix = 1;
  for (;;) {
    const [taken] = await tx.select({ id: vaults.id }).from(vaults).where(and(
      eq(vaults.organizationId, organizationId),
      parentId ? eq(vaults.parentId, parentId) : isNull(vaults.parentId),
      eq(vaults.slug, slug),
    )).limit(1);
    if (!taken) return slug;
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
}

/**
 * The parent of a folder, checked against this workspace.
 *
 * A folder that is put inside another one has to belong to the same
 * workspace, so a folder of another one cannot be reached through it.
 */
async function assertParent(tx: DatabaseTransaction, context: TenantContext, parentId: string | null): Promise<void> {
  if (!parentId) return;
  const [parent] = await tx.select({ id: vaults.id }).from(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, parentId))).limit(1);
  if (!parent) throw new AppError(400, "INVALID_VAULT", "Choose a folder in this workspace.");
}

export async function createVault(context: TenantContext, request: Request, input: VaultInput): Promise<Vault> {
  return withTenant(context.organizationId, async (tx) => {
    await assertParent(tx, context, input.parentId ?? null);
    const slug = await uniqueSlug(tx, context.organizationId, input.parentId ?? null, input.slug ?? input.name);
    const [vault] = await tx.insert(vaults).values({ ...input, parentId: input.parentId ?? null, slug, organizationId: context.organizationId, createdBy: context.userId }).returning();
    if (!vault) throw new Error("Vault insert failed");
    await writeAudit(tx, context, request, { action: "created", resourceType: "vault", resourceId: vault.id, newValues: { name: vault.name, kind: vault.kind, parentId: vault.parentId } });
    return mapVault(vault);
  });
}

/**
 * Change the name or the colour of a folder, or the folder it sits inside.
 */
export async function updateVault(context: TenantContext, request: Request, id: string, input: z.infer<typeof vaultPatchSchema>): Promise<Vault> {
  return withTenant(context.organizationId, async (tx) => {
    const [vault] = await tx.select().from(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, id))).limit(1);
    if (!vault) throw notFound("vault");
    const changes: Partial<typeof vaults.$inferInsert> = { updatedAt: new Date() };
    if (input.name) {
      changes.name = input.name;
      /**
       * The default folder keeps its address, because that address is what
       * the inbox is known by.
       */
      if (!vault.isDefault) changes.slug = await freeSlug(tx, context.organizationId, vault.parentId, vault.slug, input.name);
    }
    if (input.description !== undefined) changes.description = input.description;
    if (input.color) changes.color = input.color;
    if (input.parentId !== undefined) {
      if (vault.isDefault) throw new AppError(400, "DEFAULT_VAULT", "The default folder always stays at the top.");
      await assertParent(tx, context, input.parentId);
      if (input.parentId) {
        /**
         * A folder cannot be put inside itself, or inside one of the folders
         * under it, because that would make a loop that nothing could walk.
         */
        const under = await descendantVaultIds(tx, context.organizationId, id);
        if (under.includes(input.parentId)) throw new AppError(400, "INVALID_VAULT", "A folder cannot be put inside itself or inside one of the folders under it.");
      }
      changes.parentId = input.parentId;
      if (input.name && !vault.isDefault) changes.slug = await freeSlug(tx, context.organizationId, input.parentId, vault.slug, input.name);
    }
    const [updated] = await tx.update(vaults).set(changes).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, id))).returning();
    if (!updated) throw notFound("vault");
    await writeAudit(tx, context, request, { action: "updated", resourceType: "vault", resourceId: id, newValues: { name: updated.name } });
    return mapVault(updated);
  });
}

/**
 * Remove a folder.
 *
 * The folders under it are removed as well, because a folder that is taken
 * away cannot leave its children behind. The items in all of them are moved
 * to the default folder first, so nothing is lost. The default folder itself
 * cannot be removed, because every workspace needs one.
 */
export async function deleteVault(context: TenantContext, request: Request, id: string): Promise<{ id: string }> {
  return withTenant(context.organizationId, async (tx) => {
    const [vault] = await tx.select().from(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, id))).limit(1);
    if (!vault) throw notFound("vault");
    if (vault.isDefault) throw new AppError(400, "DEFAULT_VAULT", "The default folder cannot be removed. Move its items somewhere else and rename it instead.");
    const fallback = await defaultVaultId(tx, context.organizationId);
    const under = await descendantVaultIds(tx, context.organizationId, id);
    await tx.update(savedRecords).set({ vaultId: fallback, updatedAt: new Date() }).where(and(
      eq(savedRecords.organizationId, context.organizationId),
      inArray(savedRecords.vaultId, under),
    ));
    await tx.delete(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, id)));
    await writeAudit(tx, context, request, { action: "deleted", resourceType: "vault", resourceId: id, newValues: { name: vault.name, folders: under.length } });
    return { id };
  });
}

/**
 * Put a tag on a folder.
 *
 * The tag is made in the workspace, so it can be used on any item, and it is
 * put on the items of the folder, so that it shows up in the list of the
 * tags of that folder at once.
 */
export async function tagFolder(context: TenantContext, request: Request, vaultId: string, input: { name: string; color?: string | undefined }): Promise<VaultTag> {
  return withTenant(context.organizationId, async (tx) => {
    const [vault] = await tx.select({ id: vaults.id }).from(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, vaultId))).limit(1);
    if (!vault) throw notFound("vault");
    const name = input.name.trim();
    if (!name) throw new AppError(400, "INVALID_TAG", "Write the name of the tag.");
    const color = input.color ?? "#b8a4ed";
    const [tag] = await tx.insert(tags).values({ organizationId: context.organizationId, name, color, createdBy: context.userId }).onConflictDoUpdate({ target: [tags.organizationId, tags.name], set: { color } }).returning();
    if (!tag) throw new Error("Tag insert failed");

    await tx.insert(vaultTags).values({
      organizationId: context.organizationId,
      vaultId,
      tagId: tag.id,
    }).onConflictDoNothing();

    const scope = await descendantVaultIds(tx, context.organizationId, vaultId);
    const items = await tx.select({ id: savedRecords.id }).from(savedRecords).where(and(
      eq(savedRecords.organizationId, context.organizationId),
      inArray(savedRecords.vaultId, scope),
      isNull(savedRecords.deletedAt),
    ));
    if (items.length) {
      await tx.insert(savedRecordTags).values(items.map((item) => ({ organizationId: context.organizationId, savedRecordId: item.id, tagId: tag.id }))).onConflictDoNothing();
    }
    await writeAudit(tx, context, request, { action: "created", resourceType: "tag", resourceId: tag.id, newValues: { name: tag.name, vaultId, items: items.length } });
    return { id: tag.id, name: tag.name, color: tag.color, itemCount: items.length };
  });
}

/**
 * Remove a tag from a folder.
 */
export async function untagFolder(context: TenantContext, request: Request, vaultId: string, tagId: string): Promise<{ vaultId: string; tagId: string }> {
  return withTenant(context.organizationId, async (tx) => {
    await tx.delete(vaultTags).where(and(
      eq(vaultTags.organizationId, context.organizationId),
      eq(vaultTags.vaultId, vaultId),
      eq(vaultTags.tagId, tagId),
    ));
    await writeAudit(tx, context, request, { action: "deleted", resourceType: "vault_tag", resourceId: vaultId, newValues: { tagId } });
    return { vaultId, tagId };
  });
}

/**
 * Change the name or the colour of a tag.
 */
export async function updateTag(context: TenantContext, request: Request, id: string, input: z.infer<typeof tagPatchSchema>): Promise<VaultTag> {
  return withTenant(context.organizationId, async (tx) => {
    const [tag] = await tx.select().from(tags).where(and(eq(tags.organizationId, context.organizationId), eq(tags.id, id))).limit(1);
    if (!tag) throw notFound("tag");
    if (input.name && input.name !== tag.name) {
      const [taken] = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.organizationId, context.organizationId), eq(tags.name, input.name))).limit(1);
      if (taken) throw new AppError(409, "TAG_TAKEN", "There is already a tag with that name.");
    }
    const changes: Partial<typeof tags.$inferInsert> = {};
    if (input.name) changes.name = input.name;
    if (input.color) changes.color = input.color;
    const [updated] = await tx.update(tags).set(changes).where(and(eq(tags.organizationId, context.organizationId), eq(tags.id, id))).returning();
    if (!updated) throw notFound("tag");
    await writeAudit(tx, context, request, { action: "updated", resourceType: "tag", resourceId: id, newValues: { name: updated.name } });
    return { id: updated.id, name: updated.name, color: updated.color, itemCount: 0 };
  });
}

/**
 * Remove a tag. The items that had it are kept.
 */
export async function deleteTag(context: TenantContext, request: Request, id: string): Promise<{ id: string }> {
  return withTenant(context.organizationId, async (tx) => {
    const [tag] = await tx.select().from(tags).where(and(eq(tags.organizationId, context.organizationId), eq(tags.id, id))).limit(1);
    if (!tag) throw notFound("tag");
    await tx.delete(tags).where(and(eq(tags.organizationId, context.organizationId), eq(tags.id, id)));
    await writeAudit(tx, context, request, { action: "deleted", resourceType: "tag", resourceId: id, newValues: { name: tag.name } });
    return { id };
  });
}

/**
 * The tags of the workspace.
 *
 * A tag is a label that works across every folder, so it can be used on an
 * item without thinking about where that item lives. When a folder is given,
 * only the tags that are actually used in that folder, or in the folders
 * under it, are returned, so the list of tags is different for each folder
 * and is not the same everywhere.
 */
export async function listTags(context: TenantContext, vaultId?: string): Promise<VaultTag[]> {
  return withTenant(context.organizationId, async (tx) => {
    if (!vaultId) {
      const rows = await tx.select({ id: tags.id, name: tags.name, color: tags.color, itemCount: count(savedRecords.id) })
        .from(tags)
        .leftJoin(savedRecordTags, and(eq(savedRecordTags.tagId, tags.id), eq(savedRecordTags.organizationId, context.organizationId)))
        .leftJoin(savedRecords, and(eq(savedRecords.id, savedRecordTags.savedRecordId), isNull(savedRecords.deletedAt)))
        .where(eq(tags.organizationId, context.organizationId))
        .groupBy(tags.id).orderBy(tags.name);
      return rows.map((row) => ({ ...row, itemCount: Number(row.itemCount) }));
    }

    const scope = await descendantVaultIds(tx, context.organizationId, vaultId);

    // Tags directly attached to the folders in scope
    const directTagRows = await tx.select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
    }).from(vaultTags)
      .innerJoin(tags, and(eq(tags.id, vaultTags.tagId), eq(tags.organizationId, context.organizationId)))
      .where(and(
        eq(vaultTags.organizationId, context.organizationId),
        inArray(vaultTags.vaultId, scope),
      ));

    // Tags on items in this scope
    const itemTagRows = await tx.select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      itemCount: count(savedRecords.id),
    }).from(tags)
      .innerJoin(savedRecordTags, and(eq(savedRecordTags.tagId, tags.id), eq(savedRecordTags.organizationId, context.organizationId)))
      .innerJoin(savedRecords, and(eq(savedRecords.id, savedRecordTags.savedRecordId), isNull(savedRecords.deletedAt)))
      .where(and(
        eq(tags.organizationId, context.organizationId),
        inArray(savedRecords.vaultId, scope),
      ))
      .groupBy(tags.id);

    const tagMap = new Map<string, VaultTag>();
    for (const tag of directTagRows) {
      tagMap.set(tag.id, { id: tag.id, name: tag.name, color: tag.color, itemCount: 0 });
    }
    for (const tag of itemTagRows) {
      tagMap.set(tag.id, {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        itemCount: Number(tag.itemCount),
      });
    }

    return Array.from(tagMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  });
}

export async function createTag(context: TenantContext, request: Request, input: TagInput): Promise<VaultTag> {
  return withTenant(context.organizationId, async (tx) => {
    const [tag] = await tx.insert(tags).values({ ...input, organizationId: context.organizationId, createdBy: context.userId }).onConflictDoUpdate({ target: [tags.organizationId, tags.name], set: { color: input.color } }).returning();
    if (!tag) throw new Error("Tag insert failed");
    await writeAudit(tx, context, request, { action: "created", resourceType: "tag", resourceId: tag.id, newValues: { name: tag.name } });
    return { id: tag.id, name: tag.name, color: tag.color, itemCount: 0 };
  });
}

/**
 * Put an item in a folder and mark it with tags.
 *
 * A folder is where the item lives, and there is only one of them, so
 * moving an item to another folder moves it out of the one it was in. A tag
 * that does not exist yet is made.
 */
export async function organizeSavedRecord(context: TenantContext, request: Request, id: string, input: OrganizationInput) {
  return withTenant(context.organizationId, async (tx) => {
    const [record] = await tx.select().from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, id))).limit(1);
    if (!record) throw notFound("saved_record");
    const vaultId = input.vaultId ?? record.vaultId;
    const [vault] = await tx.select({ id: vaults.id }).from(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, vaultId))).limit(1);
    if (!vault) throw new AppError(400, "INVALID_VAULT", "Choose a folder in this workspace.");
    if (input.tagNames) {
      const names = [...new Set(input.tagNames.map((name) => name.trim()).filter(Boolean))];
      for (const name of names) await tx.insert(tags).values({ organizationId: context.organizationId, name, color: "#b8a4ed", createdBy: context.userId }).onConflictDoNothing({ target: [tags.organizationId, tags.name] });
      const tagRows = names.length ? await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.organizationId, context.organizationId), inArray(tags.name, names))) : [];
      await tx.delete(savedRecordTags).where(and(eq(savedRecordTags.organizationId, context.organizationId), eq(savedRecordTags.savedRecordId, id)));
      if (tagRows.length) await tx.insert(savedRecordTags).values(tagRows.map((tag) => ({ organizationId: context.organizationId, savedRecordId: id, tagId: tag.id })));
    }
    const [updated] = await tx.update(savedRecords).set({ vaultId, ...(input.reviewStatus ? { reviewStatus: input.reviewStatus } : {}), ...(input.privacyLevel ? { privacyLevel: input.privacyLevel } : {}), updatedAt: new Date() }).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, id))).returning();
    if (!updated) throw notFound("saved_record");
    await writeAudit(tx, context, request, { action: "organized", resourceType: "saved_record", resourceId: id, newValues: { vaultId, ...input } });
    return mapSavedRecord(updated);
  });
}
