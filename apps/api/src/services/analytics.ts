import { and, asc, count, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { auditLogs, categories, customers, invoices, paymentMethods, payments, refunds, savedRecords, users, vendors, withTenant } from "@data-vault/database";
import type { TenantContext } from "../auth/context";

export async function listAuditLogs(context: TenantContext, query: { page: number; limit: number; resourceType?: string | undefined }) {
  return withTenant(context.organizationId, async (tx) => {
    const conditions = [eq(auditLogs.organizationId, context.organizationId)];
    if (query.resourceType) conditions.push(eq(auditLogs.resourceType, query.resourceType));
    const where = and(...conditions);
    const [rows, totals] = await Promise.all([
      tx.select({ audit: auditLogs, userName: users.name, userEmail: users.email }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.userId)).where(where).orderBy(desc(auditLogs.createdAt)).limit(query.limit).offset((query.page - 1) * query.limit),
      tx.select({ count: count() }).from(auditLogs).where(where),
    ]);
    const total = totals[0]?.count ?? 0;
    return { items: rows.map(({ audit, userName, userEmail }) => ({ ...audit, userName, userEmail, createdAt: audit.createdAt.toISOString() })), page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  });
}

export async function getReport(context: TenantContext, input: { type: string; from: string; to: string }) {
  return withTenant(context.organizationId, async (tx) => {
    const range = and(eq(payments.organizationId, context.organizationId), gte(payments.paymentDate, input.from), lte(payments.paymentDate, input.to), isNull(payments.archivedAt));
    const rows = await tx.select({ payment: payments, customerName: customers.name, vendorName: vendors.name, categoryName: categories.name, methodName: paymentMethods.name }).from(payments).leftJoin(customers, eq(customers.id, payments.customerId)).leftJoin(vendors, eq(vendors.id, payments.vendorId)).leftJoin(categories, eq(categories.id, payments.categoryId)).leftJoin(paymentMethods, eq(paymentMethods.id, payments.paymentMethodId)).where(range).orderBy(asc(payments.paymentDate));
    const filtered = rows.filter(({ payment }) => input.type === "income" ? payment.direction === "incoming" : input.type === "expense" ? payment.direction === "outgoing" : true);
    const total = filtered.reduce((sum, row) => sum + Number(row.payment.netAmount), 0);
    const byDate = new Map<string, number>(); const breakdown = new Map<string, number>();
    for (const row of filtered) {
      byDate.set(row.payment.paymentDate, (byDate.get(row.payment.paymentDate) ?? 0) + Number(row.payment.netAmount));
      const key = input.type === "payment-method" ? row.methodName ?? "Other" : input.type === "customer-revenue" ? row.customerName ?? "Other" : input.type === "vendor-expense" ? row.vendorName ?? "Other" : row.categoryName ?? "Uncategorized";
      breakdown.set(key, (breakdown.get(key) ?? 0) + Number(row.payment.netAmount));
    }
    const refundRows = input.type === "refund" ? await tx.select().from(refunds).where(and(eq(refunds.organizationId, context.organizationId), gte(refunds.refundDate, input.from), lte(refunds.refundDate, input.to), isNull(refunds.archivedAt))) : [];
    const outstanding = input.type === "outstanding-invoice" ? await tx.select().from(invoices).where(and(eq(invoices.organizationId, context.organizationId), sql`${invoices.outstandingAmount} > 0`, isNull(invoices.archivedAt))).orderBy(desc(invoices.outstandingAmount)) : [];
    const captures = input.type === "extension-capture" ? await tx.select().from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.createdVia, "extension"), gte(savedRecords.createdAt, new Date(`${input.from}T00:00:00Z`)), lte(savedRecords.createdAt, new Date(`${input.to}T23:59:59Z`)))) : [];
    return {
      type: input.type, from: input.from, to: input.to, total: input.type === "refund" ? refundRows.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2) : total.toFixed(2),
      series: [...byDate].map(([date, value]) => ({ date, value: value.toFixed(2) })),
      breakdown: [...breakdown].map(([name, value]) => ({ name, value: value.toFixed(2) })).sort((a, b) => Number(b.value) - Number(a.value)),
      rows: input.type === "refund" ? refundRows : input.type === "outstanding-invoice" ? outstanding : input.type === "extension-capture" ? captures : filtered.map((row) => ({ ...row.payment, party: row.customerName ?? row.vendorName, category: row.categoryName, paymentMethod: row.methodName })),
    };
  });
}
