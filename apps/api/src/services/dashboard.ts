import { and, count, desc, eq, gte, inArray, isNotNull, isNull, sql, sum } from "drizzle-orm";
import { invoices, paymentMethods, payments, refunds, savedRecords, withTenant } from "@data-vault/database";
import type { TenantContext } from "../auth/context";
import { money, moneyString } from "../domain/money";
import { mapSavedRecord } from "./records";

export async function getDashboard(context: TenantContext) {
  return withTenant(context.organizationId, async (tx) => {
    const realized = inArray(payments.status, ["completed", "partially_refunded", "refunded"]);
    const [incomingRows, outgoingRows, pendingRows, invoiceRows, refundRows, recordRows, captureRows, recent, extensionRecent, cashFlow, statuses, methods, weekRows, sourceRows, lastRow] = await Promise.all([
      tx.select({ total: sum(payments.netAmount) }).from(payments).where(and(eq(payments.organizationId, context.organizationId), eq(payments.direction, "incoming"), realized, isNull(payments.archivedAt))),
      tx.select({ total: sum(payments.netAmount) }).from(payments).where(and(eq(payments.organizationId, context.organizationId), eq(payments.direction, "outgoing"), realized, isNull(payments.archivedAt))),
      tx.select({ total: sum(payments.netAmount) }).from(payments).where(and(eq(payments.organizationId, context.organizationId), inArray(payments.status, ["pending", "partially_paid"]), isNull(payments.archivedAt))),
      tx.select({ total: sum(invoices.outstandingAmount) }).from(invoices).where(and(eq(invoices.organizationId, context.organizationId), inArray(invoices.status, ["sent", "partially_paid", "overdue"]), isNull(invoices.archivedAt))),
      tx.select({ total: sum(refunds.amount) }).from(refunds).where(and(eq(refunds.organizationId, context.organizationId), eq(refunds.status, "completed"), isNull(refunds.archivedAt))),
      tx.select({ count: count() }).from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), isNull(savedRecords.archivedAt))),
      tx.select({ count: count() }).from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.createdVia, "extension"), isNull(savedRecords.archivedAt))),
      tx.select().from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), isNull(savedRecords.archivedAt))).orderBy(desc(savedRecords.createdAt)).limit(8),
      tx.select().from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.createdVia, "extension"), isNull(savedRecords.archivedAt))).orderBy(desc(savedRecords.createdAt)).limit(8),
      tx.execute<{ month: string; incoming: string; outgoing: string }>(sql`select to_char(date_trunc('month', payment_date), 'Mon') as month, coalesce(sum(net_amount) filter (where direction = 'incoming'), 0)::text as incoming, coalesce(sum(net_amount) filter (where direction = 'outgoing'), 0)::text as outgoing from payments where organization_id = ${context.organizationId} and archived_at is null and payment_date >= current_date - interval '5 months' group by date_trunc('month', payment_date) order by date_trunc('month', payment_date)`),
      tx.select({ status: payments.status, value: count() }).from(payments).where(and(eq(payments.organizationId, context.organizationId), isNull(payments.archivedAt))).groupBy(payments.status),
      tx.select({ name: paymentMethods.name, value: count() }).from(payments).leftJoin(paymentMethods, eq(paymentMethods.id, payments.paymentMethodId)).where(and(eq(payments.organizationId, context.organizationId), isNull(payments.archivedAt))).groupBy(paymentMethods.name),
      tx.select({ count: count() }).from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), isNull(savedRecords.archivedAt), gte(savedRecords.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)))),
      tx.select({ count: sql<number>`count(distinct ${savedRecords.sourceDomain})::int` }).from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), isNull(savedRecords.archivedAt), isNotNull(savedRecords.sourceDomain))),
      tx.select({ latest: sql<Date | null>`max(${savedRecords.createdAt})` }).from(savedRecords).where(and(eq(savedRecords.organizationId, context.organizationId), isNull(savedRecords.archivedAt))),
    ]);
    const refundsTotal = money(refundRows[0]?.total ?? 0);
    const received = money(incomingRows[0]?.total ?? 0).minus(refundsTotal);
    const paid = money(outgoingRows[0]?.total ?? 0);
    return {
      summary: { totalReceived: moneyString(received), totalPaid: moneyString(paid), netCashFlow: moneyString(received.minus(paid)), pendingPayments: moneyString(pendingRows[0]?.total ?? 0), outstandingInvoices: moneyString(invoiceRows[0]?.total ?? 0), refunds: moneyString(refundsTotal), savedRecords: recordRows[0]?.count ?? 0, extensionCaptures: captureRows[0]?.count ?? 0, savedThisWeek: weekRows[0]?.count ?? 0, uniqueSources: sourceRows[0]?.count ?? 0, lastSavedAt: lastRow[0]?.latest ? new Date(lastRow[0].latest).toISOString() : null },
      cashFlow: Array.from(cashFlow), statuses, methods: methods.map((method) => ({ name: method.name ?? "Other", value: method.value })), recentRecords: recent.map(mapSavedRecord), recentCaptures: extensionRecent.map(mapSavedRecord),
    };
  });
}
