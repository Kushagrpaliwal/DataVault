import { and, count, desc, eq, gte, ilike, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { invoiceItems, invoicePayments, invoices, payments, savedRecords, withTenant } from "@data-vault/database";
import type { DatabaseTransaction } from "@data-vault/database";
import type { invoiceCreateSchema, invoiceListQuerySchema, invoicePatchSchema } from "@data-vault/schemas";
import type { z } from "zod";
import type { TenantContext } from "../auth/context";
import { calculateInvoiceLine, money, moneyString } from "../domain/money";
import { AppError, notFound } from "../lib/errors";
import { writeAudit } from "./audit";
import { defaultVaultId } from "./vaults";

type CreateInput = z.infer<typeof invoiceCreateSchema>;
type PatchInput = z.infer<typeof invoicePatchSchema>;
type ListQuery = z.infer<typeof invoiceListQuerySchema>;

function totals(items: CreateInput["items"]) {
  let subtotal = money(0); let tax = money(0); let discount = money(0); let total = money(0);
  const lines = items.map((item, index) => {
    const line = calculateInvoiceLine(item); subtotal = subtotal.plus(line.base); tax = tax.plus(line.tax); discount = discount.plus(item.discountAmount); total = total.plus(line.total);
    return { ...item, lineTotal: line.total, position: String(index + 1) };
  });
  return { lines, subtotal: moneyString(subtotal), taxAmount: moneyString(tax), discountAmount: moneyString(discount), totalAmount: moneyString(total) };
}

async function nextInvoiceNumber(tx: DatabaseTransaction, organizationId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:invoice`}))`);
  const rows = await tx.select({ count: count() }).from(invoices).where(eq(invoices.organizationId, organizationId));
  return `INV-${new Date().getUTCFullYear()}-${String((rows[0]?.count ?? 0) + 1).padStart(5, "0")}`;
}

export async function createInvoice(context: TenantContext, request: Request, input: CreateInput) {
  return withTenant(context.organizationId, async (tx) => {
    const calculated = totals(input.items);
    const invoiceNumber = await nextInvoiceNumber(tx, context.organizationId);
    const party = input.customerId ? "Customer" : "Vendor";
    const vaultId = await defaultVaultId(tx, context.organizationId);
    const [record] = await tx.insert(savedRecords).values({ organizationId: context.organizationId, vaultId, recordType: "invoice", title: `${invoiceNumber} · ${party}`, description: input.notes ?? null, sourceType: "manual", createdVia: "website", summaryAmount: calculated.totalAmount, summaryCurrency: input.currency, summaryStatus: input.status, createdBy: context.userId }).returning();
    if (!record) throw new Error("Invoice record insert failed");
    const [invoice] = await tx.insert(invoices).values({ organizationId: context.organizationId, savedRecordId: record.id, invoiceNumber, kind: input.kind, customerId: input.customerId ?? null, vendorId: input.vendorId ?? null, issueDate: input.issueDate, dueDate: input.dueDate, currency: input.currency, subtotal: calculated.subtotal, taxAmount: calculated.taxAmount, discountAmount: calculated.discountAmount, totalAmount: calculated.totalAmount, outstandingAmount: calculated.totalAmount, amountPaid: "0.00", notes: input.notes ?? null, terms: input.terms ?? null, status: input.status, createdBy: context.userId, updatedBy: context.userId }).returning();
    if (!invoice) throw new Error("Invoice insert failed");
    await tx.insert(invoiceItems).values(calculated.lines.map((line) => ({ organizationId: context.organizationId, invoiceId: invoice.id, ...line })));
    await writeAudit(tx, context, request, { action: "created", resourceType: "invoice", resourceId: invoice.id, newValues: { invoiceNumber, totalAmount: invoice.totalAmount, status: invoice.status } });
    return { ...invoice, createdAt: invoice.createdAt.toISOString(), updatedAt: invoice.updatedAt.toISOString(), items: calculated.lines };
  });
}

export async function listInvoices(context: TenantContext, query: ListQuery) {
  return withTenant(context.organizationId, async (tx) => {
    const conditions = [eq(invoices.organizationId, context.organizationId), query.archived ? isNotNull(invoices.archivedAt) : isNull(invoices.archivedAt)];
    if (query.q) conditions.push(ilike(invoices.invoiceNumber, `%${query.q}%`)); if (query.status) conditions.push(eq(invoices.status, query.status)); if (query.kind) conditions.push(eq(invoices.kind, query.kind)); if (query.from) conditions.push(gte(invoices.issueDate, query.from)); if (query.to) conditions.push(lte(invoices.issueDate, query.to));
    const where = and(...conditions); const [rows, totalRows] = await Promise.all([tx.select().from(invoices).where(where).orderBy(desc(invoices.issueDate)).limit(query.limit).offset((query.page - 1) * query.limit), tx.select({ count: count() }).from(invoices).where(where)]); const total = totalRows[0]?.count ?? 0;
    return { items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })), page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  });
}

export async function getInvoice(context: TenantContext, id: string) {
  return withTenant(context.organizationId, async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.organizationId, context.organizationId), eq(invoices.id, id))).limit(1); if (!invoice) throw notFound("invoice");
    const [items, allocations] = await Promise.all([tx.select().from(invoiceItems).where(and(eq(invoiceItems.organizationId, context.organizationId), eq(invoiceItems.invoiceId, id))).orderBy(invoiceItems.position), tx.select({ allocation: invoicePayments, payment: payments }).from(invoicePayments).innerJoin(payments, eq(payments.id, invoicePayments.paymentId)).where(and(eq(invoicePayments.organizationId, context.organizationId), eq(invoicePayments.invoiceId, id)))]);
    return { ...invoice, createdAt: invoice.createdAt.toISOString(), updatedAt: invoice.updatedAt.toISOString(), items, payments: allocations };
  });
}

export async function updateInvoice(context: TenantContext, request: Request, id: string, input: PatchInput) {
  return withTenant(context.organizationId, async (tx) => {
    const [before] = await tx.select().from(invoices).where(and(eq(invoices.organizationId, context.organizationId), eq(invoices.id, id))).limit(1); if (!before) throw notFound("invoice");
    const replacementItems = input.items; const calculated = replacementItems ? totals(replacementItems) : null;
    if (calculated && money(calculated.totalAmount).lt(before.amountPaid)) throw new AppError(409, "INVOICE_BELOW_PAID_AMOUNT", "Invoice total cannot be lower than payments already applied.");
    const totalAmount = calculated?.totalAmount ?? before.totalAmount; const outstandingAmount = moneyString(money(totalAmount).minus(before.amountPaid));
    const [after] = await tx.update(invoices).set({ ...input, ...(calculated ? { subtotal: calculated.subtotal, taxAmount: calculated.taxAmount, discountAmount: calculated.discountAmount, totalAmount, outstandingAmount } : {}), updatedBy: context.userId, updatedAt: new Date() }).where(and(eq(invoices.organizationId, context.organizationId), eq(invoices.id, id))).returning(); if (!after) throw notFound("invoice");
    if (calculated) { await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id)); await tx.insert(invoiceItems).values(calculated.lines.map((line) => ({ organizationId: context.organizationId, invoiceId: id, ...line }))); }
    await tx.update(savedRecords).set({ summaryAmount: after.totalAmount, summaryCurrency: after.currency, summaryStatus: after.status, updatedAt: new Date() }).where(eq(savedRecords.id, after.savedRecordId));
    await writeAudit(tx, context, request, { action: "updated", resourceType: "invoice", resourceId: id, previousValues: { totalAmount: before.totalAmount, status: before.status }, newValues: { totalAmount: after.totalAmount, status: after.status } });
    const items = await tx.select().from(invoiceItems).where(and(eq(invoiceItems.organizationId, context.organizationId), eq(invoiceItems.invoiceId, id))).orderBy(invoiceItems.position);
    return { ...after, createdAt: after.createdAt.toISOString(), updatedAt: after.updatedAt.toISOString(), items };
  });
}
