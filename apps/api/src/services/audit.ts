import { and, count, desc, eq } from "drizzle-orm";
import { auditLogs, users, type Database, type DatabaseTransaction, withTenant } from "@data-vault/database";
import type { TenantContext } from "../auth/context";
import { requestMetadata } from "../lib/http";

export async function writeAudit(db: Database | DatabaseTransaction, context: TenantContext, request: Request, input: { action: string; resourceType: string; resourceId: string; previousValues?: Record<string, unknown> | null; newValues?: Record<string, unknown> | null }) {
  const metadata = requestMetadata(request);
  await db.insert(auditLogs).values({ organizationId: context.organizationId, userId: context.userId, action: input.action, resourceType: input.resourceType, resourceId: input.resourceId, previousValues: input.previousValues ?? null, newValues: input.newValues ?? null, ...metadata });
}

/**
 * The workspace's audit trail.
 *
 * Every change to a saved item is written down, so this is the list of who
 * changed what and when.
 */
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
