import { auditLogs, type Database, type DatabaseTransaction } from "@data-vault/database";
import type { TenantContext } from "../auth/context";
import { requestMetadata } from "../lib/http";

export async function writeAudit(db: Database | DatabaseTransaction, context: TenantContext, request: Request, input: { action: string; resourceType: string; resourceId: string; previousValues?: Record<string, unknown> | null; newValues?: Record<string, unknown> | null }) {
  const metadata = requestMetadata(request);
  await db.insert(auditLogs).values({ organizationId: context.organizationId, userId: context.userId, action: input.action, resourceType: input.resourceType, resourceId: input.resourceId, previousValues: input.previousValues ?? null, newValues: input.newValues ?? null, ...metadata });
}
