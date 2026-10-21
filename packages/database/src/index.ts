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

export function withTenant<T>(organizationId: string, operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
  return getDatabase().transaction(async (transaction) => {
    await setTenantContext(transaction, organizationId);
    return operation(transaction);
  });
}

export * as schema from "./schema";
export * from "./schema";
