import { sql } from "drizzle-orm";
import { getDatabase } from "@data-vault/database";

/**
 * The rate limits are counted in the database.
 *
 * A test run signs up and signs in more often than the limits allow, so the
 * counters are cleared before each test. Without that, one test would use
 * up the budget of the next one.
 */
export async function clearRateLimits(): Promise<void> {
  await getDatabase().execute(sql`delete from rate_limit_buckets`);
}
