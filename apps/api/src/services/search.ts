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

/**
 * The words of a query, as PostgreSQL understands them.
 *
 * The query is written the way a person writes it: a phrase in quotes is
 * looked for as a phrase, and a word with a minus in front of it is left
 * out.
 */
export function textQuery(query: string) {
  return sql`websearch_to_tsquery('english', ${query})`;
}

/**
 * How well a saved item answers the query.
 *
 * The title of an item says more about it than the text that was captured,
 * so the weights that were given when the words were written out are used
 * here as well. A word in the title of an item is worth more than the same
 * word in the text that was captured, so the item whose title carries the
 * word comes first.
 */
export function rankQuery(query: string) {
  return sql`ts_rank_cd(${savedRecords.searchVector}, ${textQuery(query)})`;
}

/**
 * The part of a saved item that answers the query.
 *
 * The words that matched are left in place, and the text around them is
 * kept, so the reader can see why the item came back. The words are not
 * marked up here: the page marks them, so nothing from a saved page can
 * become part of the page itself.
 */
export function snippetQuery(query: string) {
  return sql`ts_headline('english', coalesce(${savedRecords.originalText}, ${savedRecords.title}), ${textQuery(query)}, 'StartSel=, StopSel=, MaxFragments=1, MinWords=12, MaxWords=30, ShortWord=3, HighlightAll=false, FragmentDelimiter=…')`;
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
      /**
       * The words of the item, which is what the index is for.
       */
      sql`${savedRecords.searchVector} @@ ${textQuery(query.q)}`,
      /**
       * And the text as it was written, so that a word that is only half
       * remembered is still found.
       */
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
      sourceDomain: savedRecords.sourceDomain,
      occurredAt: savedRecords.capturedAt,
      createdAt: savedRecords.createdAt,
      snippet: snippetQuery(query.q),
    };
    const [rows, totals] = await Promise.all([
      /**
       * The best answer comes first, and the newest of the rest after it.
       */
      tx.select(selection).from(savedRecords).where(where).orderBy(desc(rankQuery(query.q)), desc(savedRecords.createdAt)).limit(query.limit).offset((query.page - 1) * query.limit),
      tx.select({ count: count() }).from(savedRecords).where(where),
    ]);
    const total = totals[0]?.count ?? 0;
    return { items: rows.map((row) => ({ ...row, occurredAt: row.occurredAt?.toISOString() ?? row.createdAt.toISOString() })), page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  });
}
