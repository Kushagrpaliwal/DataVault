import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { savedRecords, withTenant } from "@data-vault/database";
import type { TenantContext } from "../auth/context";
import { likePattern } from "../lib/like";

const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * The month a query names, when it names one and nothing else.
 *
 * A query used to be read for the name of a month anywhere inside it, so
 * "maybe" brought in everything from May. A month is a date filter only
 * when the query is a month, or a month and a year.
 */
export function monthRange(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const monthOf = (word: string) => monthNames.indexOf(word);
  let month = -1;
  let year: number | undefined;
  if (words.length === 1) {
    month = monthOf(words[0]!);
    year = new Date().getFullYear();
  } else if (words.length === 2) {
    const [first, second] = words as [string, string];
    const named = monthOf(first) >= 0 ? first : monthOf(second) >= 0 ? second : undefined;
    const dated = /\b(20\d{2})\b/.exec(first)?.[1] ?? /\b(20\d{2})\b/.exec(second)?.[1];
    if (named && dated) {
      month = monthOf(named);
      year = Number(dated);
    }
  }
  if (month < 0 || !year) return null;
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
