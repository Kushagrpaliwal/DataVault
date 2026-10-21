import { and, eq } from "drizzle-orm";
import { idempotencyKeys, withTenant } from "@data-vault/database";
import type { TenantContext } from "../auth/context";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/crypto";

export async function runIdempotent<T extends Record<string, unknown>>(context: TenantContext, scope: string, key: string | null, payload: unknown, operation: () => Promise<T>): Promise<T> {
  if (!key) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "This operation requires an Idempotency-Key header.");
  if (key.length < 8 || key.length > 200) throw new AppError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must contain 8 to 200 characters.");
  const requestHash = await sha256(JSON.stringify(payload));
  const claim = await withTenant(context.organizationId, async (tx) => tx.insert(idempotencyKeys).values({ organizationId: context.organizationId, scope, key, requestHash, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }).onConflictDoNothing().returning());
  if (!claim.length) {
    const existing = await withTenant(context.organizationId, async (tx) => tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.organizationId, context.organizationId), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key))).limit(1));
    const row = existing[0];
    if (!row) throw new AppError(409, "IDEMPOTENCY_RETRY", "The original request is still being processed. Retry shortly.");
    if (row.requestHash !== requestHash) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request.");
    if (!row.responseBody) throw new AppError(409, "IDEMPOTENCY_IN_PROGRESS", "The original request is still being processed.");
    return row.responseBody as T;
  }
  try {
    const result = await operation();
    await withTenant(context.organizationId, async (tx) => { await tx.update(idempotencyKeys).set({ responseStatus: "completed", responseBody: result }).where(eq(idempotencyKeys.id, claim[0]!.id)); });
    return result;
  } catch (error) {
    await withTenant(context.organizationId, async (tx) => { await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.id, claim[0]!.id)); });
    throw error;
  }
}
