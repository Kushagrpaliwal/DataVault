import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { savedRecords, withTenant } from "@data-vault/database";
import type { TenantContext } from "../auth/context";
import { likePattern } from "../lib/like";

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
    const term = likePattern(query.q);
    const range = monthRange(query.q);
    const typeList = query.types?.split(",").filter(Boolean) as (typeof savedRecords.$inferSelect)["recordType"][] | undefined;
    const conditions = [
      eq(savedRecords.organizationId, context.organizationId),
      isNull(savedRecords.archivedAt),
      isNull(savedRecords.deletedAt),
    ];
    if (typeList?.length) conditions.push(inArray(savedRecords.recordType, typeList));
    conditions.push(or(
      ilike(savedRecords.title, term),
      ilike(savedRecords.description, term),
      ilike(savedRecords.originalText, term),
      ilike(savedRecords.sourceDomain, term),
      ilike(savedRecords.sourcePageTitle, term),
      ...(range ? [and(sql`${savedRecords.createdAt} >= ${range.from}`, sql`${savedRecords.createdAt} < ${range.to}`)!] : []),
    )!);
    const where = and(...conditions);
    const selection = {
      id: savedRecords.id,
      resourceType: savedRecords.recordType,
      title: savedRecords.title,
      subtitle: savedRecords.sourcePageTitle,
      occurredAt: savedRecords.capturedAt,
      createdAt: savedRecords.createdAt,
    };
    const [rows, totals] = await Promise.all([
      tx.select(selection).from(savedRecords).where(where).orderBy(desc(savedRecords.createdAt)).limit(query.limit).offset((query.page - 1) * query.limit),
      tx.select({ count: count() }).from(savedRecords).where(where),
    ]);
    const total = totals[0]?.count ?? 0;
    return { items: rows.map((row) => ({ ...row, occurredAt: row.occurredAt?.toISOString() ?? row.createdAt.toISOString() })), page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  });
}
