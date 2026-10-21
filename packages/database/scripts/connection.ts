/**
 * The addresses the scripts use to reach PostgreSQL.
 *
 * The application connects as a role of its own, to the database it works
 * in. The administrative role connects to that same database, and is the
 * only role that may create and change the tables.
 *
 * A database that does not exist yet cannot be reached, so the scripts that
 * create one connect to the maintenance database instead.
 */

/** The administrative connection, to the database the application works in. */
export function adminUrl(): string {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL is required");
  return url;
}

/**
 * The connection to the maintenance database.
 *
 * This is where a database is created and dropped, because the database
 * itself may not exist yet.
 */
export function maintenanceUrl(): string {
  const url = new URL(adminUrl());
  url.pathname = `/${process.env.DATABASE_MAINTENANCE_NAME ?? "postgres"}`;
  return url.toString();
}

/** The database the application works in. */
export function targetDatabaseName(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(name)) throw new Error("Unsafe target database name");
  return name;
}
