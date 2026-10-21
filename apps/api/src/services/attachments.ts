import { and, eq } from "drizzle-orm";
import { attachments, savedRecords, withTenant } from "@data-vault/database";
import type { ServerEnvironment } from "@data-vault/config";
import type { TenantContext } from "../auth/context";
import { AppError, notFound } from "../lib/errors";
import { sha256 } from "../lib/crypto";
import { writeAudit } from "./audit";

const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function saveScreenshot(context: TenantContext, request: Request, env: ServerEnvironment, savedRecordId: string) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(400, "ATTACHMENT_REQUIRED", "Choose a screenshot to upload.");
  if (!allowedTypes.has(file.type)) throw new AppError(415, "INVALID_ATTACHMENT_TYPE", "Screenshots must be PNG, JPEG, or WebP images.");
  if (file.size <= 0 || file.size > env.MAX_ATTACHMENT_BYTES) throw new AppError(413, "ATTACHMENT_TOO_LARGE", `Screenshots must be smaller than ${Math.floor(env.MAX_ATTACHMENT_BYTES / 1_048_576)} MB.`);
  const data = new Uint8Array(await file.arrayBuffer());
  const contentHash = await sha256(data);
  return withTenant(context.organizationId, async (tx) => {
    const [record] = await tx.select({ id: savedRecords.id }).from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, savedRecordId))).limit(1);
    if (!record) throw notFound("saved_record");
    const [existing] = await tx.select({ id: attachments.id, fileName: attachments.fileName, mimeType: attachments.mimeType, byteSize: attachments.byteSize, createdAt: attachments.createdAt }).from(attachments).where(and(eq(attachments.organizationId, context.organizationId), eq(attachments.savedRecordId, savedRecordId), eq(attachments.sha256, contentHash))).limit(1);
    if (existing) return { ...existing, createdAt: existing.createdAt.toISOString() };
    const [attachment] = await tx.insert(attachments).values({ organizationId: context.organizationId, savedRecordId, fileName: file.name.slice(0, 250), mimeType: file.type, byteSize: String(file.size), sha256: contentHash, content: data, createdBy: context.userId }).onConflictDoNothing({ target: [attachments.organizationId, attachments.savedRecordId, attachments.sha256] }).returning({ id: attachments.id, fileName: attachments.fileName, mimeType: attachments.mimeType, byteSize: attachments.byteSize, createdAt: attachments.createdAt });
    if (!attachment) {
      const [concurrentAttachment] = await tx.select({ id: attachments.id, fileName: attachments.fileName, mimeType: attachments.mimeType, byteSize: attachments.byteSize, createdAt: attachments.createdAt }).from(attachments).where(and(eq(attachments.organizationId, context.organizationId), eq(attachments.savedRecordId, savedRecordId), eq(attachments.sha256, contentHash))).limit(1);
      if (!concurrentAttachment) throw new Error("Attachment insert failed");
      return { ...concurrentAttachment, createdAt: concurrentAttachment.createdAt.toISOString() };
    }
    await writeAudit(tx, context, request, { action: "attachment_added", resourceType: "saved_record", resourceId: savedRecordId, newValues: { attachmentId: attachment.id, fileName: attachment.fileName } });
    return { ...attachment, createdAt: attachment.createdAt.toISOString() };
  });
}

export async function getAttachment(context: TenantContext, id: string) {
  return withTenant(context.organizationId, async (tx) => {
    const [attachment] = await tx.select().from(attachments).where(and(eq(attachments.organizationId, context.organizationId), eq(attachments.id, id))).limit(1);
    if (!attachment) throw notFound("attachment");
    return attachment;
  });
}
