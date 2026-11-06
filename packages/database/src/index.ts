import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is required");
  const client = postgres(url, { max: Number(process.env.DATABASE_POOL_SIZE ?? 10), idle_timeout: 30, transform: { undefined: null } });
  return drizzle({ client, schema, casing: "snake_case" });
}

let singleton: Database | undefined;
export function getDatabase(): Database {
  singleton ??= createDatabase();
  return singleton;
}

export async function setTenantContext(transaction: DatabaseTransaction, organizationId: string) {
  await transaction.execute(sql`select set_config('app.organization_id', ${organizationId}, true)`);
}

/**
 * Tell the database which person is asking.
 *
 * Account-owned provider connections and legacy credit records use this
 * context in their row-level security policies.
 */
export async function setUserContext(transaction: DatabaseTransaction, userId: string) {
  await transaction.execute(sql`select set_config('app.user_id', ${userId}, true)`);
}

/**
 * Name the request key this transaction is about for the legacy credit ledger.
 *
 * The credit ledger follows the person, so the rule on that table only shows
 * a person their own rows. The server has to find out whether a request key
 * has been used before, and it has to find that out even when the row that
 * holds the key belongs to somebody else. The key is named here for the
 * length of the transaction, and the rule on the table lets that one row
 * through.
 *
 * Only reading is affected. Writing is still checked against the person, so
 * a row cannot be written for somebody else.
 */
export async function setClaimKey(transaction: DatabaseTransaction, key: string) {
  await transaction.execute(sql`select set_config('app.claim_key', ${key}, true)`);
}

export function withTenant<T>(organizationId: string, operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
  return getDatabase().transaction(async (transaction) => {
    await setTenantContext(transaction, organizationId);
    return operation(transaction);
  });
}

/**
 * A transaction that knows the person but not the workspace.
 *
 * Some records belong to a person rather than a workspace, such as their AI
 * provider connections. Those tables are read with the person set.
 */
export function withAccount<T>(userId: string, operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
  return getDatabase().transaction(async (transaction) => {
    await setUserContext(transaction, userId);
    return operation(transaction);
  });
}

/**
 * A transaction that knows both the workspace and the person.
 *
 * Workspace usage events include both the workspace and the person. The
 * legacy credit tables also use this context.
 */
export function withUser<T>(userId: string, organizationId: string, operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
  return getDatabase().transaction(async (transaction) => {
    await setTenantContext(transaction, organizationId);
    await setUserContext(transaction, userId);
    return operation(transaction);
  });
}

export * as schema from "./schema";
export * from "./schema";
