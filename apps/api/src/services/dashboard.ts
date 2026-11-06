import { and, count, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { savedRecords, withTenant } from "@data-vault/database";
import type { TenantContext } from "../auth/context";
import { mapSavedRecord } from "./records";

/**
 * The overview of a workspace.
 *
 * It only counts what a researcher would ask about: how much has been
 * collected, where it came from, and how it is spread out.
 */
export async function getDashboard(context: TenantContext) {
  return withTenant(context.organizationId, async (tx) => {
    const visible = and(
      eq(savedRecords.organizationId, context.organizationId),
      isNull(savedRecords.archivedAt),
      isNull(savedRecords.deletedAt),
    );
    const [recordRows, captureRows, weekRows, sourceRows, lastRow, typeRows, recent, extensionRecent] = await Promise.all([
      tx.select({ count: count() }).from(savedRecords).where(visible),
      tx.select({ count: count() }).from(savedRecords).where(and(visible, eq(savedRecords.createdVia, "extension"))),
      tx.select({ count: count() }).from(savedRecords).where(and(visible, gte(savedRecords.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)))),
      tx.select({ count: sql<number>`count(distinct ${savedRecords.sourceDomain})::int` }).from(savedRecords).where(and(visible, isNotNull(savedRecords.sourceDomain))),
      tx.select({ latest: sql<Date | null>`max(${savedRecords.createdAt})` }).from(savedRecords).where(visible),
      tx.select({ type: savedRecords.recordType, value: count() }).from(savedRecords).where(visible).groupBy(savedRecords.recordType),
      tx.select().from(savedRecords).where(visible).orderBy(desc(savedRecords.createdAt)).limit(8),
      tx.select().from(savedRecords).where(and(visible, eq(savedRecords.createdVia, "extension"))).orderBy(desc(savedRecords.createdAt)).limit(8),
    ]);
    return {
      summary: {
        savedRecords: recordRows[0]?.count ?? 0,
        extensionCaptures: captureRows[0]?.count ?? 0,
        savedThisWeek: weekRows[0]?.count ?? 0,
        uniqueSources: sourceRows[0]?.count ?? 0,
        lastSavedAt: lastRow[0]?.latest ? new Date(lastRow[0].latest).toISOString() : null,
        byType: typeRows.map((row) => ({ type: row.type, value: row.value })).sort((left, right) => right.value - left.value),
      },
      recentRecords: recent.map(mapSavedRecord),
      recentCaptures: extensionRecent.map(mapSavedRecord),
    };
  });
}
