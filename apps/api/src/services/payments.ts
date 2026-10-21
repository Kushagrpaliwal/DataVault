import { and, count, desc, eq, gte, ilike, isNotNull, isNull, lte, or, sql, sum } from "drizzle-orm";
import { categories, invoicePayments, invoices, payments, refunds, savedRecords, withTenant } from "@data-vault/database";
import type { DatabaseTransaction } from "@data-vault/database";
import type { z } from "zod";
import type { paymentCreateSchema, paymentListQuerySchema, paymentPatchSchema, refundCreateSchema } from "@data-vault/schemas";
import type { TenantContext } from "../auth/context";
import { calculateNetAmount, money, moneyString } from "../domain/money";
import { assertPaymentTransition } from "../domain/payment-status";
import { AppError, notFound } from "../lib/errors";
import { writeAudit } from "./audit";
import { defaultVaultId } from "./vaults";

type CreateInput = z.infer<typeof paymentCreateSchema>;
type PatchInput = z.infer<typeof paymentPatchSchema>;
type ListQuery = z.infer<typeof paymentListQuerySchema>;
type RefundInput = z.infer<typeof refundCreateSchema>;

async function nextNumber(tx: DatabaseTransaction, organizationId: string, prefix: string, table: "payment" | "refund") {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${table}`}))`);
  const result = table === "payment" ? await tx.select({ count: count() }).from(payments).where(eq(payments.organizationId, organizationId)) : await tx.select({ count: count() }).from(refunds).where(eq(refunds.organizationId, organizationId));
  return `${prefix}-${new Date().getUTCFullYear()}-${String((result[0]?.count ?? 0) + 1).padStart(6, "0")}`;
}

function serializePayment(row: typeof payments.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null };
}

async function updateInvoiceAllocation(tx: DatabaseTransaction, context: TenantContext, payment: typeof payments.$inferSelect) {
  if (!payment.invoiceId || payment.status !== "completed") return;
  const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, payment.invoiceId), eq(invoices.organizationId, context.organizationId))).limit(1);
  if (!invoice) throw new AppError(400, "INVALID_INVOICE", "The selected invoice is not available in this workspace.");
  const applied = money(payment.netAmount).greaterThan(invoice.outstandingAmount) ? invoice.outstandingAmount : payment.netAmount;
  await tx.insert(invoicePayments).values({ organizationId: context.organizationId, invoiceId: invoice.id, paymentId: payment.id, amountApplied: applied, createdBy: context.userId });
  const paid = money(invoice.amountPaid).plus(applied);
  const outstanding = money(invoice.totalAmount).minus(paid);
  await tx.update(invoices).set({ amountPaid: moneyString(paid), outstandingAmount: moneyString(outstanding), status: outstanding.isZero() ? "paid" : "partially_paid", updatedBy: context.userId, updatedAt: new Date() }).where(eq(invoices.id, invoice.id));
}

export async function createPayment(context: TenantContext, request: Request, input: CreateInput, options: { createdVia?: "website" | "extension" | "api"; savedRecordId?: string; title?: string } = {}) {
  return withTenant(context.organizationId, async (tx) => {
    const netAmount = calculateNetAmount(input);
    let savedRecordId = options.savedRecordId;
    if (!savedRecordId) {
      const vaultId = await defaultVaultId(tx, context.organizationId);
      const [record] = await tx.insert(savedRecords).values({ organizationId: context.organizationId, vaultId, recordType: input.direction === "incoming" ? "income" : "expense", title: options.title ?? input.description ?? (input.direction === "incoming" ? "Incoming payment" : "Outgoing payment"), description: input.description, sourceType: "manual", createdVia: options.createdVia ?? "website", summaryAmount: netAmount, summaryCurrency: input.currency, summaryStatus: input.status, createdBy: context.userId }).returning();
      if (!record) throw new Error("Record insert failed");
      savedRecordId = record.id;
    }
    const paymentNumber = await nextNumber(tx, context.organizationId, "PAY", "payment");
    const [payment] = await tx.insert(payments).values({ organizationId: context.organizationId, savedRecordId, paymentNumber, direction: input.direction, customerId: input.customerId ?? null, vendorId: input.vendorId ?? null, amount: input.amount, currency: input.currency, taxAmount: input.taxAmount, feeAmount: input.feeAmount, discountAmount: input.discountAmount, netAmount, paymentMethodId: input.paymentMethodId ?? null, categoryId: input.categoryId ?? null, invoiceId: input.invoiceId ?? null, transactionReference: input.transactionReference ?? null, utr: input.utr ?? null, description: input.description, notes: input.notes, status: input.status, paymentDate: input.paymentDate, createdBy: context.userId, updatedBy: context.userId }).returning();
    if (!payment) throw new Error("Payment insert failed");
    await tx.update(savedRecords).set({ summaryAmount: netAmount, summaryCurrency: input.currency, summaryStatus: input.status, updatedAt: new Date() }).where(and(eq(savedRecords.id, savedRecordId), eq(savedRecords.organizationId, context.organizationId)));
    await updateInvoiceAllocation(tx, context, payment);
    await writeAudit(tx, context, request, { action: "created", resourceType: "payment", resourceId: payment.id, newValues: { paymentNumber, amount: input.amount, netAmount, status: input.status } });
    return serializePayment(payment);
  });
}

export async function listPayments(context: TenantContext, query: ListQuery) {
  return withTenant(context.organizationId, async (tx) => {
    const conditions = [eq(payments.organizationId, context.organizationId), query.archived ? isNotNull(payments.archivedAt) : isNull(payments.archivedAt)];
    if (query.q) conditions.push(or(ilike(payments.paymentNumber, `%${query.q}%`), ilike(payments.utr, `%${query.q}%`), ilike(payments.transactionReference, `%${query.q}%`), sql`${payments.amount}::text ilike ${`%${query.q.replace(/[₹,$\s]/g, "")}%`}`)!);
    if (query.direction) conditions.push(eq(payments.direction, query.direction));
    if (query.status) conditions.push(eq(payments.status, query.status));
    if (query.from) conditions.push(gte(payments.paymentDate, query.from));
    if (query.to) conditions.push(lte(payments.paymentDate, query.to));
    const where = and(...conditions);
    const [rows, totals] = await Promise.all([
      tx.select().from(payments).where(where).orderBy(desc(payments.paymentDate), desc(payments.createdAt)).limit(query.limit).offset((query.page - 1) * query.limit),
      tx.select({ count: count() }).from(payments).where(where),
    ]);
    const total = totals[0]?.count ?? 0;
    return { items: rows.map(serializePayment), page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  });
}

export async function getPayment(context: TenantContext, id: string) {
  return withTenant(context.organizationId, async (tx) => {
    const [payment] = await tx.select().from(payments).where(and(eq(payments.organizationId, context.organizationId), eq(payments.id, id))).limit(1);
    if (!payment) throw notFound("payment");
    const refundRows = await tx.select().from(refunds).where(and(eq(refunds.organizationId, context.organizationId), eq(refunds.paymentId, id))).orderBy(desc(refunds.createdAt));
    return { ...serializePayment(payment), refunds: refundRows.map((refund) => ({ ...refund, createdAt: refund.createdAt.toISOString(), updatedAt: refund.updatedAt.toISOString() })) };
  });
}

export async function updatePayment(context: TenantContext, request: Request, id: string, input: PatchInput) {
  return withTenant(context.organizationId, async (tx) => {
    const [before] = await tx.select().from(payments).where(and(eq(payments.organizationId, context.organizationId), eq(payments.id, id))).limit(1);
    if (!before) throw notFound("payment");
    if (input.status === "partially_refunded" || input.status === "refunded") throw new AppError(409, "REFUND_STATUS_REQUIRES_REFUND", "Use the refund action to change a payment's refund status.");
    if (input.status) assertPaymentTransition(before.status, input.status);
    let categoryName: string | null | undefined;
    if (input.categoryId) {
      const [category] = await tx.select({ name: categories.name }).from(categories).where(and(eq(categories.organizationId, context.organizationId), eq(categories.id, input.categoryId))).limit(1);
      if (!category) throw new AppError(400, "INVALID_CATEGORY", "The selected category is unavailable.");
      categoryName = category.name;
    } else if (input.categoryId === null) categoryName = null;
    const amountFields = { amount: input.amount ?? before.amount, taxAmount: input.taxAmount ?? before.taxAmount, feeAmount: input.feeAmount ?? before.feeAmount, discountAmount: input.discountAmount ?? before.discountAmount };
    const netAmount = calculateNetAmount(amountFields);
    const [after] = await tx.update(payments).set({ ...input, customerId: input.customerId ?? before.customerId, vendorId: input.vendorId ?? before.vendorId, netAmount, updatedBy: context.userId, updatedAt: new Date() }).where(and(eq(payments.organizationId, context.organizationId), eq(payments.id, id))).returning();
    if (!after) throw notFound("payment");
    if (after.savedRecordId) await tx.update(savedRecords).set({ summaryAmount: netAmount, summaryCurrency: after.currency, summaryStatus: after.status, ...(categoryName !== undefined ? { metadata: categoryName === null ? sql`${savedRecords.metadata} - 'categoryName'` : sql`jsonb_set(${savedRecords.metadata}, '{categoryName}', ${JSON.stringify(categoryName)}::jsonb, true)` } : {}), updatedAt: new Date() }).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, after.savedRecordId)));
    if (before.status !== "completed" && after.status === "completed") await updateInvoiceAllocation(tx, context, after);
    await writeAudit(tx, context, request, { action: "updated", resourceType: "payment", resourceId: id, previousValues: { amount: before.amount, netAmount: before.netAmount, status: before.status, categoryId: before.categoryId }, newValues: { amount: after.amount, netAmount: after.netAmount, status: after.status, categoryId: after.categoryId } });
    return serializePayment(after);
  });
}

export async function createRefund(context: TenantContext, request: Request, paymentId: string, input: RefundInput) {
  return withTenant(context.organizationId, async (tx) => {
    const [payment] = await tx.select().from(payments).where(and(eq(payments.organizationId, context.organizationId), eq(payments.id, paymentId))).limit(1);
    if (!payment) throw notFound("payment");
    if (!["completed", "partially_refunded"].includes(payment.status)) throw new AppError(409, "PAYMENT_NOT_REFUNDABLE", "Only completed payments can be refunded.");
    const totals = await tx.select({ total: sum(refunds.amount) }).from(refunds).where(and(eq(refunds.organizationId, context.organizationId), eq(refunds.paymentId, paymentId), eq(refunds.status, "completed")));
    const refunded = money(totals[0]?.total ?? 0);
    const requested = money(input.amount);
    if (requested.lte(0) || refunded.plus(requested).gt(payment.netAmount)) throw new AppError(409, "REFUND_EXCEEDS_BALANCE", `Only ${moneyString(money(payment.netAmount).minus(refunded))} remains refundable.`);
    const refundNumber = await nextNumber(tx, context.organizationId, "REF", "refund");
    const vaultId = await defaultVaultId(tx, context.organizationId);
    const [record] = await tx.insert(savedRecords).values({ organizationId: context.organizationId, vaultId, recordType: "refund", title: `Refund for ${payment.paymentNumber}`, sourceType: "manual", createdVia: "website", summaryAmount: input.amount, summaryCurrency: payment.currency, summaryStatus: "completed", createdBy: context.userId }).returning();
    if (!record) throw new Error("Refund record insert failed");
    const [refund] = await tx.insert(refunds).values({ organizationId: context.organizationId, savedRecordId: record.id, paymentId, refundNumber, amount: input.amount, reason: input.reason, status: "completed", refundDate: input.refundDate, createdBy: context.userId }).returning();
    if (!refund) throw new Error("Refund insert failed");
    const totalRefunded = refunded.plus(requested);
    const newStatus = totalRefunded.equals(payment.netAmount) ? "refunded" : "partially_refunded";
    await tx.update(payments).set({ status: newStatus, updatedBy: context.userId, updatedAt: new Date() }).where(eq(payments.id, paymentId));
    if (payment.savedRecordId) await tx.update(savedRecords).set({ summaryStatus: newStatus, updatedAt: new Date() }).where(eq(savedRecords.id, payment.savedRecordId));
    if (payment.invoiceId) {
      const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.organizationId, context.organizationId), eq(invoices.id, payment.invoiceId))).limit(1);
      const [allocation] = await tx.select().from(invoicePayments).where(and(eq(invoicePayments.organizationId, context.organizationId), eq(invoicePayments.paymentId, payment.id))).limit(1);
      if (invoice && allocation) {
        const previouslyReversed = refunded.gt(allocation.amountApplied) ? money(allocation.amountApplied) : refunded;
        const nowReversed = totalRefunded.gt(allocation.amountApplied) ? money(allocation.amountApplied) : totalRefunded;
        const allocationDelta = nowReversed.minus(previouslyReversed);
        const amountPaid = money(invoice.amountPaid).minus(allocationDelta);
        const outstanding = money(invoice.totalAmount).minus(amountPaid);
        const invoiceStatus = amountPaid.isZero() ? (new Date(`${invoice.dueDate}T23:59:59Z`) < new Date() ? "overdue" : "sent") : "partially_paid";
        await tx.update(invoices).set({ amountPaid: moneyString(amountPaid), outstandingAmount: moneyString(outstanding), status: invoiceStatus, updatedBy: context.userId, updatedAt: new Date() }).where(eq(invoices.id, invoice.id));
      }
    }
    await writeAudit(tx, context, request, { action: "refunded", resourceType: "payment", resourceId: paymentId, previousValues: { status: payment.status, refunded: moneyString(refunded) }, newValues: { status: newStatus, refunded: moneyString(totalRefunded), refundId: refund.id } });
    return { ...refund, createdAt: refund.createdAt.toISOString(), updatedAt: refund.updatedAt.toISOString() };
  });
}
