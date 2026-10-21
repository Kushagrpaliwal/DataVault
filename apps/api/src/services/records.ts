import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { attachments, auditLogs, captureSources, evidenceSnapshots, savedRecordCollections, savedRecords, savedRecordTags, savedViews, tags, vaultCollections, vaults, withTenant } from "@data-vault/database";
import type { z } from "zod";
import type { savedRecordCreateSchema, savedRecordListQuerySchema, savedRecordPatchSchema } from "@data-vault/schemas";
import type { TenantContext } from "../auth/context";
import { AppError, notFound } from "../lib/errors";
import { sha256 } from "../lib/crypto";
import { likePattern } from "../lib/like";
import { writeAudit } from "./audit";
import { defaultVaultId } from "./vaults";
import { mapSavedRecord } from "./record-shape";

type CreateInput = z.infer<typeof savedRecordCreateSchema>;
type PatchInput = z.infer<typeof savedRecordPatchSchema>;
type ListQuery = z.infer<typeof savedRecordListQuerySchema>;

export { mapSavedRecord };

export async function listSavedRecords(context: TenantContext, query: ListQuery) {
  return withTenant(context.organizationId, async (tx) => {
    const conditions = [eq(savedRecords.organizationId, context.organizationId), query.trash ? isNotNull(savedRecords.deletedAt) : isNull(savedRecords.deletedAt)];
    if (!query.trash) conditions.push(query.archived ? isNotNull(savedRecords.archivedAt) : isNull(savedRecords.archivedAt));
    if (query.recordType) conditions.push(eq(savedRecords.recordType, query.recordType));
    if (query.createdVia) conditions.push(eq(savedRecords.createdVia, query.createdVia));
    if (query.vaultId) conditions.push(eq(savedRecords.vaultId, query.vaultId));
    if (query.reviewStatus) conditions.push(eq(savedRecords.reviewStatus, query.reviewStatus));
    if (query.tag) conditions.push(sql`exists (select 1 from saved_record_tags record_tags inner join tags record_tags_tag on record_tags_tag.id = record_tags.tag_id where record_tags.saved_record_id = ${savedRecords.id} and record_tags.organization_id = ${context.organizationId} and lower(record_tags_tag.name) = lower(${query.tag}))`);
    if (query.collectionId) conditions.push(sql`exists (select 1 from saved_record_collections record_collections where record_collections.saved_record_id = ${savedRecords.id} and record_collections.organization_id = ${context.organizationId} and record_collections.collection_id = ${query.collectionId})`);
    if (query.q) conditions.push(or(ilike(savedRecords.title, likePattern(query.q)), ilike(savedRecords.description, likePattern(query.q)), ilike(savedRecords.originalText, likePattern(query.q)), ilike(savedRecords.sourceDomain, likePattern(query.q)), ilike(savedRecords.sourcePageTitle, likePattern(query.q)))!);
    const where = and(...conditions);
    const orderColumn = query.sort === "title" ? savedRecords.title : query.sort === "updatedAt" ? savedRecords.updatedAt : query.sort === "recordType" ? savedRecords.recordType : savedRecords.createdAt;
    const [rows, totalRows] = await Promise.all([
      tx.select().from(savedRecords).where(where).orderBy(query.direction === "asc" ? asc(orderColumn) : desc(orderColumn)).limit(query.limit).offset((query.page - 1) * query.limit),
      tx.select({ count: count() }).from(savedRecords).where(where),
    ]);
    const total = totalRows[0]?.count ?? 0;
    return { items: rows.map(mapSavedRecord), page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  });
}

export async function getSavedRecord(context: TenantContext, id: string) {
  return withTenant(context.organizationId, async (tx) => {
    const [record] = await tx.select().from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, id))).limit(1);
    if (!record) throw notFound("saved_record");
    const [capture, files, audit, snapshots, collections, recordTags] = await Promise.all([
      tx.select().from(captureSources).where(and(eq(captureSources.organizationId, context.organizationId), eq(captureSources.savedRecordId, id))).limit(1),
      tx.select({ id: attachments.id, fileName: attachments.fileName, mimeType: attachments.mimeType, byteSize: attachments.byteSize, createdAt: attachments.createdAt }).from(attachments).where(and(eq(attachments.organizationId, context.organizationId), eq(attachments.savedRecordId, id))),
      tx.select().from(auditLogs).where(and(eq(auditLogs.organizationId, context.organizationId), eq(auditLogs.resourceId, id))).orderBy(desc(auditLogs.createdAt)).limit(100),
      tx.select().from(evidenceSnapshots).where(and(eq(evidenceSnapshots.organizationId, context.organizationId), eq(evidenceSnapshots.savedRecordId, id))).orderBy(desc(evidenceSnapshots.capturedAt)),
      tx.select({ id: vaultCollections.id, name: vaultCollections.name, color: vaultCollections.color }).from(savedRecordCollections).innerJoin(vaultCollections, eq(vaultCollections.id, savedRecordCollections.collectionId)).where(and(eq(savedRecordCollections.organizationId, context.organizationId), eq(savedRecordCollections.savedRecordId, id))),
      tx.select({ id: tags.id, name: tags.name, color: tags.color }).from(savedRecordTags).innerJoin(tags, eq(tags.id, savedRecordTags.tagId)).where(and(eq(savedRecordTags.organizationId, context.organizationId), eq(savedRecordTags.savedRecordId, id))),
    ]);
    return { ...mapSavedRecord(record), metadata: record.metadata, capture: capture[0] ?? null, collections, tags: recordTags, evidence: snapshots.map((snapshot) => ({ ...snapshot, capturedAt: snapshot.capturedAt.toISOString(), createdAt: snapshot.createdAt.toISOString() })), attachments: files.map((file) => ({ ...file, createdAt: file.createdAt.toISOString() })), audit: audit.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })) };
  });
}

export async function createSavedRecord(context: TenantContext, request: Request, input: CreateInput, createdVia: "website" | "extension" | "api" | "import" = "website") {
  return withTenant(context.organizationId, async (tx) => {
    const vaultId = input.vaultId ?? await defaultVaultId(tx, context.organizationId);
    const [vault] = await tx.select({ id: vaults.id }).from(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, vaultId))).limit(1);
    if (!vault) throw new AppError(400, "INVALID_VAULT", "Choose a vault in this workspace.");
    const [record] = await tx.insert(savedRecords).values({ organizationId: context.organizationId, vaultId, recordType: input.recordType, title: input.title, description: input.description, originalText: input.originalText, sourceType: input.sourceType, sourceUrl: input.source?.url, sourceDomain: input.source?.domain, sourcePageTitle: input.source?.title, capturedAt: input.capturedAt ? new Date(input.capturedAt) : null, createdVia, metadata: input.metadata, captureKind: input.captureKind, reviewStatus: input.reviewStatus, privacyLevel: input.privacyLevel, createdBy: context.userId }).returning();
    if (!record) throw new Error("Record insert failed");
    const evidenceText = input.originalText ?? input.description ?? input.title;
    const contentHash = await sha256(evidenceText.normalize("NFKC").trim());
    await tx.insert(evidenceSnapshots).values({ organizationId: context.organizationId, savedRecordId: record.id, sourceUrl: input.source?.url, sourceTitle: input.source?.title ?? input.title, sourceDomain: input.source?.domain, capturedText: evidenceText, contentHash, extractorId: input.source ? "manual-source" : "manual-entry", extractorVersion: "1", capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date() });
    await writeAudit(tx, context, request, { action: "created", resourceType: "saved_record", resourceId: record.id, newValues: { title: record.title, recordType: record.recordType } });
    return mapSavedRecord(record);
  });
}

export async function updateSavedRecord(context: TenantContext, request: Request, id: string, input: PatchInput) {
  return withTenant(context.organizationId, async (tx) => {
    const [before] = await tx.select().from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, id))).limit(1);
    if (!before) throw notFound("saved_record");
    const update = {
      ...(input.recordType ? { recordType: input.recordType } : {}), ...(input.title ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}), ...(input.originalText !== undefined ? { originalText: input.originalText } : {}),
      ...(input.sourceType ? { sourceType: input.sourceType } : {}), ...(input.source ? { sourceUrl: input.source.url, sourceDomain: input.source.domain, sourcePageTitle: input.source.title } : {}),
      ...(input.capturedAt ? { capturedAt: new Date(input.capturedAt) } : {}), ...(input.metadata ? { metadata: input.metadata } : {}), updatedAt: new Date(),
    };
    const [after] = await tx.update(savedRecords).set(update).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, id))).returning();
    if (!after) throw notFound("saved_record");
    await writeAudit(tx, context, request, { action: "updated", resourceType: "saved_record", resourceId: id, previousValues: { title: before.title, recordType: before.recordType, metadata: before.metadata }, newValues: { title: after.title, recordType: after.recordType, metadata: after.metadata } });
    return mapSavedRecord(after);
  });
}

export async function setRecordArchived(context: TenantContext, request: Request, id: string, archived: boolean) {
  return withTenant(context.organizationId, async (tx) => {
    const [record] = await tx.update(savedRecords).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, id))).returning();
    if (!record) throw notFound("saved_record");
    await writeAudit(tx, context, request, { action: archived ? "archived" : "restored", resourceType: "saved_record", resourceId: id, newValues: { archived } });
    return mapSavedRecord(record);
  });
}

export async function trashSavedRecord(context: TenantContext, request: Request, id: string) {
  return withTenant(context.organizationId, async (tx) => {
    const [record] = await tx.select().from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, id))).for("update").limit(1);
    if (!record) throw notFound("saved_record");
    /**
     * The item itself is not destroyed, it is moved to the trash, so its
     * history is kept. Deleting the audit trail here meant a restored item
     * came back with an empty timeline.
     */
    const [trashed] = await tx.update(savedRecords).set({ deletedAt: new Date(), reviewStatus: "trashed", updatedAt: new Date() }).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, id))).returning({ id: savedRecords.id });
    if (!trashed) throw notFound("saved_record");
    await writeAudit(tx, context, request, { action: "trashed", resourceType: "saved_record", resourceId: id, newValues: { deletedAt: true } });
    return trashed;
  });
}

export async function restoreTrashedRecord(context: TenantContext, request: Request, id: string) {
  return withTenant(context.organizationId, async (tx) => {
    const [restored] = await tx.update(savedRecords).set({ deletedAt: null, reviewStatus: "inbox", updatedAt: new Date() }).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, id), isNotNull(savedRecords.deletedAt))).returning();
    if (!restored) throw notFound("trashed_saved_record");
    await writeAudit(tx, context, request, { action: "restored", resourceType: "saved_record", resourceId: id, newValues: { deletedAt: false } });
    return mapSavedRecord(restored);
  });
}

export async function listSavedViews(context: TenantContext) {
  return withTenant(context.organizationId, async (tx) => (await tx.select().from(savedViews).where(and(eq(savedViews.organizationId, context.organizationId), eq(savedViews.userId, context.userId))).orderBy(savedViews.name)).map((view) => ({ ...view, createdAt: view.createdAt.toISOString(), updatedAt: view.updatedAt.toISOString() })));
}

export async function createSavedView(context: TenantContext, input: { name: string; filters: Record<string, unknown>; columns: string[]; sort: Record<string, unknown> }) {
  return withTenant(context.organizationId, async (tx) => {
    const [view] = await tx.insert(savedViews).values({ organizationId: context.organizationId, userId: context.userId, ...input }).onConflictDoUpdate({ target: [savedViews.organizationId, savedViews.userId, savedViews.name], set: { filters: input.filters, columns: input.columns, sort: input.sort, updatedAt: new Date() } }).returning();
    if (!view) throw new Error("Saved view insert failed");
    return { ...view, createdAt: view.createdAt.toISOString(), updatedAt: view.updatedAt.toISOString() };
  });
}

export async function deleteSavedView(context: TenantContext, id: string) {
  return withTenant(context.organizationId, async (tx) => { const [deleted] = await tx.delete(savedViews).where(and(eq(savedViews.organizationId, context.organizationId), eq(savedViews.userId, context.userId), eq(savedViews.id, id))).returning({ id: savedViews.id }); if (!deleted) throw notFound("saved_view"); return deleted; });
}
