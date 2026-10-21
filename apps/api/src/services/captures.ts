import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { defaultCaptureExtractor } from "@data-vault/capture-parser";
import { captureSources, evidenceSnapshots, processingJobs, savedRecords, savedRecordTags, tags, vaults, withTenant } from "@data-vault/database";
import type { z } from "zod";
import type { ServerEnvironment } from "@data-vault/config";
import type { captureCreateSchema } from "@data-vault/schemas";
import type { TenantContext } from "../auth/context";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/crypto";
import { writeAudit } from "./audit";
import { mapSavedRecord } from "./records";
import { indexRecord } from "./semantic";
import { defaultVaultId, linkCollections } from "./vaults";

type CaptureInput = z.infer<typeof captureCreateSchema>;

export async function createCapture(context: TenantContext, request: Request, input: CaptureInput, env?: ServerEnvironment) {
  const extracted = await defaultCaptureExtractor.extract({ text: input.selectedText, pageTitle: input.source.title, pageUrl: input.source.url, capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date() });
  const parsed = { ...extracted, ...input.parsedData, confidence: { ...extracted.confidence, ...input.parsedData?.confidence } };
  const recordType = input.recordType === "other" ? parsed.recordType ?? "other" : input.recordType;
  const normalizedText = input.selectedText.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  const captureHash = await sha256(normalizedText);

  const saved = await withTenant(context.organizationId, async (tx) => {
    const vaultId = input.vaultId ?? await defaultVaultId(tx, context.organizationId);
    const [vault] = await tx.select({ id: vaults.id }).from(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, vaultId))).limit(1);
    if (!vault) throw new AppError(400, "INVALID_VAULT", "Choose a vault in this workspace.");
    const duplicateCaptures = await tx.select({ id: savedRecords.id, title: savedRecords.title, createdAt: savedRecords.createdAt }).from(captureSources).innerJoin(savedRecords, eq(savedRecords.id, captureSources.savedRecordId)).where(and(eq(captureSources.organizationId, context.organizationId), eq(captureSources.captureHash, captureHash), isNull(savedRecords.deletedAt))).limit(5);
    if (duplicateCaptures.length && !input.confirmDuplicate) throw new AppError(409, "POTENTIAL_DUPLICATE", "A similar record may already be saved.", { duplicates: duplicateCaptures.map((duplicate) => ({ ...duplicate, createdAt: duplicate.createdAt.toISOString() })) });

    const snippet = input.selectedText.replace(/\s+/g, " ").trim().slice(0, 70);
    const title = parsed.title && parsed.title !== "Captured clip"
      ? parsed.title
      : input.source.title && input.source.title !== "Untitled page"
        ? input.source.title
        : snippet || `Clip from ${input.source.domain}`;
    const [record] = await tx.insert(savedRecords).values({
      organizationId: context.organizationId, vaultId, recordType, title, originalText: input.originalText ?? input.selectedText,
      sourceType: "browser_extension", sourceUrl: input.source.url, sourceDomain: input.source.domain, sourcePageTitle: input.source.title,
      capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date(), createdVia: context.extensionSessionId ? "extension" : "website",
      metadata: { parsedData: parsed, ...(input.captureQuality ? { captureQuality: input.captureQuality } : {}) }, captureKind: input.captureKind, reviewStatus: "inbox", privacyLevel: "private", createdBy: context.userId,
    }).returning();
    if (!record) throw new Error("Capture record insert failed");
    await tx.insert(captureSources).values({ organizationId: context.organizationId, savedRecordId: record.id, selectedText: input.selectedText, captureHash, extractorId: defaultCaptureExtractor.id, extractorVersion: defaultCaptureExtractor.version, parsedData: parsed, confidence: parsed.confidence });
    await tx.insert(evidenceSnapshots).values({ organizationId: context.organizationId, savedRecordId: record.id, sourceUrl: input.source.url, sourceTitle: input.source.title, sourceDomain: input.source.domain, capturedText: input.originalText ?? input.selectedText, ...(input.pageHtml ? { pageHtml: input.pageHtml } : {}), contentHash: captureHash, extractorId: defaultCaptureExtractor.id, extractorVersion: defaultCaptureExtractor.version, capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date() });
    const tagNames = [...new Set(input.tagNames.map((tag) => tag.trim()).filter(Boolean))];
    for (const name of tagNames) await tx.insert(tags).values({ organizationId: context.organizationId, name, color: "#b8a4ed", createdBy: context.userId }).onConflictDoNothing({ target: [tags.organizationId, tags.name] });
    if (tagNames.length) {
      const tagRows = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.organizationId, context.organizationId), inArray(tags.name, tagNames)));
      if (tagRows.length) await tx.insert(savedRecordTags).values(tagRows.map((tag) => ({ organizationId: context.organizationId, savedRecordId: record.id, tagId: tag.id })));
    }
    /**
     * The collections the person chose are put on the item now, so that it
     * lands in the right place without asking again.
     */
    await linkCollections(tx, context, record.id, vaultId, input.collectionIds);
    await tx.insert(processingJobs).values({ organizationId: context.organizationId, savedRecordId: record.id, kind: "capture-index", status: "completed", payload: { captureKind: input.captureKind, sourceDomain: input.source.domain, captureQuality: input.captureQuality ?? null }, completedAt: new Date() });

    await writeAudit(tx, context, request, { action: "captured", resourceType: "saved_record", resourceId: record.id, newValues: { recordType, captureKind: input.captureKind, vaultId, sourceDomain: input.source.domain } });
    return { record: mapSavedRecord(record), parser: { id: defaultCaptureExtractor.id, version: defaultCaptureExtractor.version, result: parsed } };
  });

  /**
   * The numbers that say what the item is about are made afterwards, so
   * that the capture is not held up while the model is asked. The item is
   * already written down by then, so the numbers cannot be lost.
   *
   * An item that cannot be given numbers is still saved, and simply does
   * not turn up in a search by meaning.
   */
  if (env) {
    void indexRecord(env, context, saved.record.id, saved.record.title, saved.record.originalText ?? null).catch(() => undefined);
  }
  return saved;
}

/**
 * The clips that arrived through the browser extension, most recent first.
 *
 * Trashed items are left out, so a deleted clip does not keep showing up in
 * the list of things that were just saved.
 */
export async function recentCaptures(context: TenantContext) {
  return withTenant(context.organizationId, async (tx) => {
    const rows = await tx.select().from(savedRecords).where(and(
      eq(savedRecords.organizationId, context.organizationId),
      eq(savedRecords.createdVia, "extension"),
      isNull(savedRecords.deletedAt),
      isNull(savedRecords.archivedAt),
    )).orderBy(desc(savedRecords.createdAt)).limit(10);
    return rows.map(mapSavedRecord);
  });
}
