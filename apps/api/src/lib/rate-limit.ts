import { sql } from "drizzle-orm";
import { getDatabase } from "@data-vault/database";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window resets. */
  retryAfter: number;
}

interface BucketOptions {
  /** A stable key, for example `signup:203.0.113.4`. */
  key: string;
  /** How many requests are allowed inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * A fixed-window rate limiter backed by Postgres.
 *
 * The previous limiter lived in an in-process Map, which meant every restart
 * reset every counter and no two instances shared state. This version
 * survives restarts and is consistent across replicas.
 *
 * The counter rolls over on its own: when the stored reset time has passed,
 * the next request starts a fresh window instead of counting against the old
 * one. That keeps the whole operation to a single atomic statement.
 */
export async function consumeRateLimit({ key, limit, windowSeconds }: BucketOptions): Promise<RateLimitResult> {
  if (limit <= 0) return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfter: 0 };
  const db = getDatabase();
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);

  const rows = await db.execute<{ hits: number; reset_at: string }>(sql`
    insert into rate_limit_buckets (key, hits, reset_at, updated_at)
    values (${key}, '1', ${resetAt.toISOString()}, now())
    on conflict (key) do update
      set hits = case when rate_limit_buckets.reset_at <= now() then '1' else (rate_limit_buckets.hits::int + 1)::text end,
          reset_at = case when rate_limit_buckets.reset_at <= now() then ${resetAt.toISOString()} else rate_limit_buckets.reset_at end,
          updated_at = now()
    returning hits::int as hits, reset_at
  `);

  const row = (rows as unknown as { rows?: { hits: number; reset_at: string }[] }).rows?.[0];
  const count = Number(row?.hits ?? 1);
  const expires = row?.reset_at ? new Date(row.reset_at) : resetAt;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.max(1, Math.ceil((expires.getTime() - Date.now()) / 1000)),
  };
}

/** Read the current count without consuming the budget. */
export async function peekRateLimit({ key, limit }: Omit<BucketOptions, "windowSeconds">): Promise<RateLimitResult> {
  if (limit <= 0) return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfter: 0 };
  const db = getDatabase();
  const rows = await db.execute<{ hits: number; reset_at: string }>(sql`
    select hits::int as hits, reset_at from rate_limit_buckets where key = ${key}
  `);
  const row = (rows as unknown as { rows?: { hits: number; reset_at: string }[] }).rows?.[0];
  const count = Number(row?.hits ?? 0);
  const expires = row?.reset_at ? new Date(row.reset_at) : new Date();
  return {
    allowed: count < limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.max(1, Math.ceil((expires.getTime() - Date.now()) / 1000)),
  };
}

/** Drop buckets whose window has closed. */
export async function pruneRateLimitBuckets(): Promise<void> {
  await getDatabase().execute(sql`delete from rate_limit_buckets where reset_at < now() - interval '1 hour'`);
}
