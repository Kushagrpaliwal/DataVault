import { and, count, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { defaultCaptureExtractor } from "@data-vault/capture-parser";
import { captureSources, categories, evidenceSnapshots, paymentMethods, payments, processingJobs, savedRecords, savedRecordTags, tags, vaults, withTenant } from "@data-vault/database";
import type { z } from "zod";
import type { captureCreateSchema } from "@data-vault/schemas";
import type { TenantContext } from "../auth/context";
import { calculateNetAmount } from "../domain/money";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/crypto";
import { writeAudit } from "./audit";
import { mapSavedRecord } from "./records";
import { defaultVaultId } from "./vaults";

type CaptureInput = z.infer<typeof captureCreateSchema>;

export async function createCapture(context: TenantContext, request: Request, input: CaptureInput) {
  const extracted = await defaultCaptureExtractor.extract({ text: input.selectedText, pageTitle: input.source.title, pageUrl: input.source.url, capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date() });
  const parsed = { ...extracted, ...input.parsedData, confidence: { ...extracted.confidence, ...input.parsedData?.confidence } };
  const recordType = input.recordType === "other" ? parsed.recordType ?? "other" : input.recordType;
  const normalizedText = input.selectedText.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  const captureHash = await sha256(normalizedText);

  return withTenant(context.organizationId, async (tx) => {
    const vaultId = input.vaultId ?? await defaultVaultId(tx, context.organizationId);
    const [vault] = await tx.select({ id: vaults.id }).from(vaults).where(and(eq(vaults.organizationId, context.organizationId), eq(vaults.id, vaultId))).limit(1);
    if (!vault) throw new AppError(400, "INVALID_VAULT", "Choose a vault in this workspace.");
    const duplicateConditions = [eq(captureSources.organizationId, context.organizationId), eq(captureSources.captureHash, captureHash)];
    const duplicateCaptures = await tx.select({ id: savedRecords.id, title: savedRecords.title, createdAt: savedRecords.createdAt }).from(captureSources).innerJoin(savedRecords, eq(savedRecords.id, captureSources.savedRecordId)).where(and(...duplicateConditions)).limit(5);
    const duplicatePayments = parsed.utr ? await tx.select({ id: savedRecords.id, title: savedRecords.title, createdAt: savedRecords.createdAt }).from(payments).innerJoin(savedRecords, eq(savedRecords.id, payments.savedRecordId)).where(and(eq(payments.organizationId, context.organizationId), eq(payments.utr, parsed.utr))).limit(5) : [];
    const duplicates = [...duplicateCaptures, ...duplicatePayments].filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index);
    if (duplicates.length && !input.confirmDuplicate) throw new AppError(409, "POTENTIAL_DUPLICATE", "A similar record may already be saved.", { duplicates: duplicates.map((duplicate) => ({ ...duplicate, createdAt: duplicate.createdAt.toISOString() })) });

    let categoryName: string | undefined;
    if (input.categoryId) {
      const [category] = await tx.select({ name: categories.name }).from(categories).where(and(eq(categories.organizationId, context.organizationId), eq(categories.id, input.categoryId))).limit(1);
      if (!category) throw new AppError(400, "INVALID_CATEGORY", "The selected category is unavailable.");
      categoryName = category.name;
    }
    let paymentMethodId = input.paymentMethodId ?? null;
    if (!paymentMethodId && parsed.paymentMethod) {
      const [method] = await tx.select({ id: paymentMethods.id }).from(paymentMethods).where(and(eq(paymentMethods.organizationId, context.organizationId), ilike(paymentMethods.name, parsed.paymentMethod))).limit(1);
      paymentMethodId = method?.id ?? null;
    }
    const snippet = input.selectedText.replace(/\s+/g, " ").trim().slice(0, 70);
    const title = parsed.title && parsed.title !== "Captured record"
      ? parsed.title
      : input.source.title && input.source.title !== "Untitled page"
        ? input.source.title
        : snippet || `Clip from ${input.source.domain}`;
    const [record] = await tx.insert(savedRecords).values({
      organizationId: context.organizationId, vaultId, recordType, title, originalText: input.originalText ?? input.selectedText,
      sourceType: "browser_extension", sourceUrl: input.source.url, sourceDomain: input.source.domain, sourcePageTitle: input.source.title,
      capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date(), createdVia: context.extensionSessionId ? "extension" : "website",
      summaryAmount: parsed.amount, summaryCurrency: parsed.currency, summaryParty: parsed.party, summaryStatus: parsed.amount ? "completed" : null,
      metadata: { parsedData: parsed, ...(input.captureQuality ? { captureQuality: input.captureQuality } : {}), ...(categoryName ? { categoryName } : {}) }, captureKind: input.captureKind, reviewStatus: "inbox", privacyLevel: "private", createdBy: context.userId,
    }).returning();
    if (!record) throw new Error("Capture record insert failed");
    await tx.insert(captureSources).values({ organizationId: context.organizationId, savedRecordId: record.id, selectedText: input.selectedText, captureHash, extractorId: defaultCaptureExtractor.id, extractorVersion: defaultCaptureExtractor.version, parsedData: parsed, confidence: parsed.confidence });
    await tx.insert(evidenceSnapshots).values({ organizationId: context.organizationId, savedRecordId: record.id, sourceUrl: input.source.url, sourceTitle: input.source.title, sourceDomain: input.source.domain, capturedText: input.originalText ?? input.selectedText, contentHash: captureHash, extractorId: defaultCaptureExtractor.id, extractorVersion: defaultCaptureExtractor.version, capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date() });
    const tagNames = [...new Set(input.tagNames.map((tag) => tag.trim()).filter(Boolean))];
    for (const name of tagNames) await tx.insert(tags).values({ organizationId: context.organizationId, name, color: "#b8a4ed", createdBy: context.userId }).onConflictDoNothing({ target: [tags.organizationId, tags.name] });
    if (tagNames.length) {
      const tagRows = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.organizationId, context.organizationId), inArray(tags.name, tagNames)));
      if (tagRows.length) await tx.insert(savedRecordTags).values(tagRows.map((tag) => ({ organizationId: context.organizationId, savedRecordId: record.id, tagId: tag.id })));
    }
    await tx.insert(processingJobs).values({ organizationId: context.organizationId, savedRecordId: record.id, kind: input.captureKind === "receipt" ? "receipt-extraction" : "capture-index", status: "completed", payload: { captureKind: input.captureKind, sourceDomain: input.source.domain, captureQuality: input.captureQuality ?? null }, completedAt: new Date() });

    let payment: typeof payments.$inferSelect | null = null;
    if (["payment", "expense", "income"].includes(recordType) && parsed.amount && parsed.date) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${context.organizationId}:payment`}))`);
      const result = await tx.select({ count: count() }).from(payments).where(eq(payments.organizationId, context.organizationId));
      const paymentNumber = `PAY-${new Date().getUTCFullYear()}-${String((result[0]?.count ?? 0) + 1).padStart(6, "0")}`;
      const direction = recordType === "income" ? "incoming" : "outgoing";
      const netAmount = calculateNetAmount({ amount: parsed.amount });
      const [createdPayment] = await tx.insert(payments).values({ organizationId: context.organizationId, savedRecordId: record.id, paymentNumber, direction, amount: parsed.amount, currency: parsed.currency ?? "INR", taxAmount: "0.00", feeAmount: "0.00", discountAmount: "0.00", netAmount, paymentMethodId, categoryId: input.categoryId ?? null, transactionReference: parsed.transactionReference ?? null, utr: parsed.utr ?? null, description: title, status: "completed", paymentDate: parsed.date, createdBy: context.userId, updatedBy: context.userId }).returning();
      payment = createdPayment ?? null;
    }
    await writeAudit(tx, context, request, { action: "captured", resourceType: "saved_record", resourceId: record.id, newValues: { recordType, captureKind: input.captureKind, vaultId, sourceDomain: input.source.domain, paymentId: payment?.id ?? null } });
    return { record: mapSavedRecord(record), payment: payment ? { ...payment, createdAt: payment.createdAt.toISOString(), updatedAt: payment.updatedAt.toISOString() } : null, parser: { id: defaultCaptureExtractor.id, version: defaultCaptureExtractor.version, result: parsed } };
  });
}

export async function recentCaptures(context: TenantContext) {
  return withTenant(context.organizationId, async (tx) => {
    const rows = await tx.select().from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.createdVia, "extension"))).orderBy(desc(savedRecords.createdAt)).limit(10);
    return rows.map(mapSavedRecord);
  });
}
