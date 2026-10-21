import { lt } from "drizzle-orm";
import { getDatabase, idempotencyKeys, organizations, rateLimitBuckets, withTenant } from "@data-vault/database";
import { pruneNoteAiPreviews } from "./notes-ai";

/**
 * The rows that are of no use any more.
 *
 * The answers that are waiting to be applied expire, the request keys
 * expire so that the same key may be used again, and the rate-limit
 * buckets of a window that has passed are of no use to anybody.
 *
 * The clean-up is done by the server itself, so that nothing grows for
 * ever and no person has to think about it.
 */
export async function pruneExpiredRows(): Promise<void> {
  await pruneNoteAiPreviews();
  await pruneExpiredIdempotencyKeys();
  await pruneOldRateLimits();
}

/**
 * The request keys that have expired.
 *
 * A key is kept for a while so that a retry of the same request is not
 * done twice. Once it has expired the key may be used again, so the row is
 * of no use.
 *
 * The keys belong to a workspace, so the clean-up goes through each
 * workspace in turn. A query that did not say which workspace it was
 * working in would be refused by the rule on the table, which is exactly
 * what that rule is for.
 */
async function pruneExpiredIdempotencyKeys(): Promise<void> {
  const workspaces = await getDatabase().select({ id: organizations.id }).from(organizations);
  for (const workspace of workspaces) {
    await withTenant(workspace.id, (tx) => tx.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date())));
  }
}

/**
 * The rate-limit buckets whose window has passed.
 *
 * The buckets are counted per address, and there are a great many
 * addresses, so the ones that are spent are removed rather than left for
 * ever.
 */
async function pruneOldRateLimits(): Promise<void> {
  await getDatabase().delete(rateLimitBuckets).where(lt(rateLimitBuckets.resetAt, new Date()));
}
