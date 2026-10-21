import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { customers, invoices, payments, savedRecords, vendors, withTenant } from "@data-vault/database";
import type { TenantContext } from "../auth/context";

const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function monthRange(query: string) {
  const lower = query.toLowerCase();
  const month = monthNames.findIndex((name) => lower.includes(name));
  if (month < 0) return null;
  const yearMatch = /\b(20\d{2})\b/.exec(query);
  const year = yearMatch?.[1] ? Number(yearMatch[1]) : new Date().getFullYear();
  return { from: new Date(Date.UTC(year, month, 1)), to: new Date(Date.UTC(year, month + 1, 1)) };
}

export async function globalSearch(context: TenantContext, query: { q: string; page: number; limit: number; types?: string | undefined }) {
  return withTenant(context.organizationId, async (tx) => {
    const term = `%${query.q}%`;
    const numericTerm = query.q.replace(/[^\d.]/g, "");
    const range = monthRange(query.q);
    const typeList = query.types?.split(",").filter(Boolean) as (typeof savedRecords.$inferSelect)["recordType"][] | undefined;
    const conditions = [eq(savedRecords.organizationId, context.organizationId), isNull(savedRecords.archivedAt)];
    if (typeList?.length) conditions.push(inArray(savedRecords.recordType, typeList));
    conditions.push(or(
      ilike(savedRecords.title, term), ilike(savedRecords.description, term), ilike(savedRecords.originalText, term), ilike(savedRecords.sourceDomain, term), ilike(savedRecords.summaryParty, term),
      ilike(payments.paymentNumber, term), ilike(payments.utr, term), ilike(payments.transactionReference, term), ilike(customers.name, term), ilike(vendors.name, term), ilike(invoices.invoiceNumber, term),
      ...(numericTerm ? [sql`${savedRecords.summaryAmount}::text ilike ${`%${numericTerm}%`}`] : []),
      ...(range ? [and(sql`${savedRecords.createdAt} >= ${range.from}`, sql`${savedRecords.createdAt} < ${range.to}`)!] : []),
    )!);
    const where = and(...conditions);
    const base = tx.select({ id: savedRecords.id, resourceType: savedRecords.recordType, title: savedRecords.title, subtitle: savedRecords.summaryParty, amount: savedRecords.summaryAmount, currency: savedRecords.summaryCurrency, occurredAt: savedRecords.capturedAt, createdAt: savedRecords.createdAt }).from(savedRecords).leftJoin(payments, eq(payments.savedRecordId, savedRecords.id)).leftJoin(customers, eq(customers.savedRecordId, savedRecords.id)).leftJoin(vendors, eq(vendors.savedRecordId, savedRecords.id)).leftJoin(invoices, eq(invoices.savedRecordId, savedRecords.id)).where(where);
    const rows = await base.orderBy(desc(savedRecords.createdAt)).limit(query.limit).offset((query.page - 1) * query.limit);
    const totals = await tx.select({ count: count() }).from(savedRecords).leftJoin(payments, eq(payments.savedRecordId, savedRecords.id)).leftJoin(customers, eq(customers.savedRecordId, savedRecords.id)).leftJoin(vendors, eq(vendors.savedRecordId, savedRecords.id)).leftJoin(invoices, eq(invoices.savedRecordId, savedRecords.id)).where(where);
    const total = totals[0]?.count ?? 0;
    return { items: rows.map((row) => ({ ...row, occurredAt: row.occurredAt?.toISOString() ?? row.createdAt.toISOString() })), page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  });
}
