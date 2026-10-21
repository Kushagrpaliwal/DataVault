import { and, count, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { savedRecordCollections, savedRecords, savedRecordTags, tags, vaultCollections, vaults, withTenant } from "@data-vault/database";
import type { Vault, VaultCollection, VaultTag } from "@data-vault/types";
import type { z } from "zod";
import type { collectionCreateSchema, itemOrganizationSchema, tagCreateSchema, tagPatchSchema, vaultCreateSchema, vaultPatchSchema, collectionPatchSchema } from "@data-vault/schemas";
import type { DatabaseTransaction } from "@data-vault/database";
import type { TenantContext } from "../auth/context";
import { AppError, notFound } from "../lib/errors";
import { writeAudit } from "./audit";
import { mapSavedRecord } from "./record-shape";

type VaultInput = z.infer<typeof vaultCreateSchema>;
type CollectionInput = z.infer<typeof collectionCreateSchema>;
type TagInput = z.infer<typeof tagCreateSchema>;
type OrganizationInput = z.infer<typeof itemOrganizationSchema>;

function mapVault(row: typeof vaults.$inferSelect): Vault {
  return { id: row.id, organizationId: row.organizationId, name: row.name, slug: row.slug, description: row.description, kind: row.kind, color: row.color, isDefault: row.isDefault, createdAt: row.createdAt.toISOString() };
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

export async function listVaults(context: TenantContext): Promise<Vault[]> {
  return withTenant(context.organizationId, async (tx) => {
    const rows = await tx.select({
      ...getTableColumns(vaults),
      itemCount: count(savedRecords.id),
    }).from(vaults).leftJoin(savedRecords, and(eq(savedRecords.vaultId, vaults.id), isNull(savedRecords.deletedAt))).where(eq(vaults.organizationId, context.organizationId)).groupBy(vaults.id).orderBy(desc(vaults.isDefault), vaults.name);
    return rows.map((row) => ({ ...mapVault(row), itemCount: Number(row.itemCount) }));
  });
}

export async function createVault(context: TenantContext, request: Request, input: VaultInput): Promise<Vault> {
  return withTenant(context.organizationId, async (tx) => {
    const [vault] = await tx.insert(vaults).values({ ...input, organizationId: context.organizationId, createdBy: context.userId }).returning();
    if (!vault) throw new Error("Vault insert failed");
    await writeAudit(tx, context, request, { action: "created", resourceType: "vault", resourceId: vault.id, newValues: { name: vault.name, kind: vault.kind } });
    return mapVault(vault);
  });
}

/**
 * The name of a folder, written as an address.
 *
 * It is only used to keep folder names apart, so a clash falls back to the
 * name that was already there.
 */
async function freeSlug(tx: DatabaseTransaction, organizationId: string, current: string, name: string): Promise<string> {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || current;
  const [taken] = await tx.select({ id: vaults.id }).from(vaults).where(and(eq(vaults.organizationId, organizationId), eq(vaults.slug, base))).limit(1);
  if (!taken || taken.id === current) return base;
  return current;
}

/**
 * Change the name or the colour of a folder.
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
      if (!vault.isDefault) changes.slug = await freeSlug(tx, context.organizationId, vault.slug, input.name);
    }
    if (input.description !== undefined) changes.description = input.description;
    if (input.color) changes.color = input.color;
    const [updated] = await tx.update(vaults).set(changes).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, id))).returning();
    if (!updated) throw notFound("vault");
    await writeAudit(tx, context, request, { action: "updated", resourceType: "vault", resourceId: id, newValues: { name: updated.name } });
    return mapVault(updated);
  });
}

/**
 * Remove a folder.
 *
 * The items in it are moved to the default folder first, so nothing is lost.
 * The default folder itself cannot be removed, because every workspace needs
 * one.
 */
export async function deleteVault(context: TenantContext, request: Request, id: string): Promise<{ id: string }> {
  return withTenant(context.organizationId, async (tx) => {
    const [vault] = await tx.select().from(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, id))).limit(1);
    if (!vault) throw notFound("vault");
    if (vault.isDefault) throw new AppError(400, "DEFAULT_VAULT", "The default folder cannot be removed. Move its items somewhere else and rename it instead.");
    const fallback = await defaultVaultId(tx, context.organizationId);
    await tx.update(savedRecords).set({ vaultId: fallback, updatedAt: new Date() }).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.vaultId, id)));
    await tx.delete(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, id)));
    await writeAudit(tx, context, request, { action: "deleted", resourceType: "vault", resourceId: id, newValues: { name: vault.name } });
    return { id };
  });
}

/**
 * Change the name or the colour of a collection.
 */
export async function updateCollection(context: TenantContext, request: Request, id: string, input: z.infer<typeof collectionPatchSchema>): Promise<VaultCollection> {
  return withTenant(context.organizationId, async (tx) => {
    const [collection] = await tx.select().from(vaultCollections).where(and(eq(vaultCollections.organizationId, context.organizationId), eq(vaultCollections.id, id))).limit(1);
    if (!collection) throw notFound("collection");
    const changes: Partial<typeof vaultCollections.$inferInsert> = { updatedAt: new Date() };
    if (input.name) changes.name = input.name;
    if (input.color) changes.color = input.color;
    const [updated] = await tx.update(vaultCollections).set(changes).where(and(eq(vaultCollections.organizationId, context.organizationId), eq(vaultCollections.id, id))).returning();
    if (!updated) throw notFound("collection");
    await writeAudit(tx, context, request, { action: "updated", resourceType: "collection", resourceId: id, newValues: { name: updated.name } });
    return { id: updated.id, vaultId: updated.vaultId, name: updated.name, color: updated.color, itemCount: 0 };
  });
}

/**
 * Remove a collection. The items in it are kept.
 */
export async function deleteCollection(context: TenantContext, request: Request, id: string): Promise<{ id: string }> {
  return withTenant(context.organizationId, async (tx) => {
    const [collection] = await tx.select().from(vaultCollections).where(and(eq(vaultCollections.organizationId, context.organizationId), eq(vaultCollections.id, id))).limit(1);
    if (!collection) throw notFound("collection");
    await tx.delete(vaultCollections).where(and(eq(vaultCollections.organizationId, context.organizationId), eq(vaultCollections.id, id)));
    await writeAudit(tx, context, request, { action: "deleted", resourceType: "collection", resourceId: id, newValues: { name: collection.name } });
    return { id };
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

export async function listCollections(context: TenantContext, vaultId?: string): Promise<VaultCollection[]> {
  return withTenant(context.organizationId, async (tx) => {
    /**
     * The count is the number of items that are still there.
     *
     * An item that is in the trash is not in the collection any more, so it
     * is left out of the number. Otherwise a collection could say it held
     * ten items while none of them could be found.
     */
    const rows = await tx.select({
      id: vaultCollections.id, vaultId: vaultCollections.vaultId, name: vaultCollections.name, color: vaultCollections.color, itemCount: count(savedRecords.id),
    }).from(vaultCollections)
      .leftJoin(savedRecordCollections, and(eq(savedRecordCollections.collectionId, vaultCollections.id), eq(savedRecordCollections.organizationId, context.organizationId)))
      .leftJoin(savedRecords, and(eq(savedRecords.id, savedRecordCollections.savedRecordId), isNull(savedRecords.deletedAt)))
      .where(and(eq(vaultCollections.organizationId, context.organizationId), ...(vaultId ? [eq(vaultCollections.vaultId, vaultId)] : [])))
      .groupBy(vaultCollections.id).orderBy(vaultCollections.name);
    return rows.map((row) => ({ ...row, itemCount: Number(row.itemCount) }));
  });
}

export async function createCollection(context: TenantContext, request: Request, input: CollectionInput): Promise<VaultCollection> {
  return withTenant(context.organizationId, async (tx) => {
    const [vault] = await tx.select({ id: vaults.id }).from(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, input.vaultId))).limit(1);
    if (!vault) throw new AppError(400, "INVALID_VAULT", "Choose a vault in this workspace.");
    const [collection] = await tx.insert(vaultCollections).values({ ...input, organizationId: context.organizationId, createdBy: context.userId }).returning();
    if (!collection) throw new Error("Collection insert failed");
    await writeAudit(tx, context, request, { action: "created", resourceType: "collection", resourceId: collection.id, newValues: { vaultId: collection.vaultId, name: collection.name } });
    return { id: collection.id, vaultId: collection.vaultId, name: collection.name, color: collection.color, itemCount: 0 };
  });
}

/**
 * The tags of the workspace.
 *
 * A tag is a label that works across every folder, so it can be used on an
 * item without thinking about where that item lives. When a folder is given,
 * only the tags that are actually used in that folder are returned, so the
 * list of tags is different for each folder and is not the same everywhere.
 */
export async function listTags(context: TenantContext, vaultId?: string): Promise<VaultTag[]> {
  return withTenant(context.organizationId, async (tx) => {
    const rows = await tx.select({ id: tags.id, name: tags.name, color: tags.color, itemCount: count(savedRecords.id) })
      .from(tags)
      .leftJoin(savedRecordTags, and(eq(savedRecordTags.tagId, tags.id), eq(savedRecordTags.organizationId, context.organizationId)))
      .leftJoin(savedRecords, and(eq(savedRecords.id, savedRecordTags.savedRecordId), isNull(savedRecords.deletedAt)))
      .where(and(eq(tags.organizationId, context.organizationId), ...(vaultId ? [eq(savedRecords.vaultId, vaultId)] : [])))
      .groupBy(tags.id).orderBy(tags.name);
    return rows.map((row) => ({ ...row, itemCount: Number(row.itemCount) }));
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
 * Put an item into collections.
 *
 * A collection belongs to one folder, so the collections that are named have
 * to belong to the folder the item is in, and to this workspace. Anything
 * else is refused rather than quietly put somewhere else.
 */
export async function linkCollections(
  tx: DatabaseTransaction,
  context: TenantContext,
  recordId: string,
  vaultId: string,
  collectionIds: string[],
): Promise<void> {
  if (!collectionIds.length) return;
  const wanted = [...new Set(collectionIds)];
  const collections = await tx.select({ id: vaultCollections.id }).from(vaultCollections).where(and(
    eq(vaultCollections.organizationId, context.organizationId),
    eq(vaultCollections.vaultId, vaultId),
    inArray(vaultCollections.id, wanted),
  ));
  if (collections.length !== wanted.length) throw new AppError(400, "INVALID_COLLECTION", "Every collection must belong to the selected folder.");
  await tx.insert(savedRecordCollections).values(collections.map((collection) => ({ organizationId: context.organizationId, savedRecordId: recordId, collectionId: collection.id })));
}

export async function organizeSavedRecord(context: TenantContext, request: Request, id: string, input: OrganizationInput) {
  return withTenant(context.organizationId, async (tx) => {
    const [record] = await tx.select().from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, id))).limit(1);
    if (!record) throw notFound("saved_record");
    const vaultId = input.vaultId ?? record.vaultId;
    const [vault] = await tx.select({ id: vaults.id }).from(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, vaultId))).limit(1);
    if (!vault) throw new AppError(400, "INVALID_VAULT", "Choose a vault in this workspace.");
    if (input.collectionIds) {
      await tx.delete(savedRecordCollections).where(and(eq(savedRecordCollections.organizationId, context.organizationId), eq(savedRecordCollections.savedRecordId, id)));
      await linkCollections(tx, context, id, vaultId, input.collectionIds);
    } else if (vaultId !== record.vaultId) {
      /**
       * The item moved to another folder, so the collections it had, which
       * belonged to the old folder, are taken off it.
       */
      await tx.delete(savedRecordCollections).where(and(
        eq(savedRecordCollections.organizationId, context.organizationId),
        eq(savedRecordCollections.savedRecordId, id),
        sql`${savedRecordCollections.collectionId} in (select ${vaultCollections.id} from ${vaultCollections} where ${vaultCollections.vaultId} <> ${vaultId})`,
      ));
    }
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
