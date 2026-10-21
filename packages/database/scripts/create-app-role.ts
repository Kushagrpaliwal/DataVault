/**
 * Give the application its own PostgreSQL role.
 *
 * The row-level security rules on the tables are forced, so they apply to
 * the owner of the table as well. The application used to connect as the
 * owner, which meant the rules were documentation rather than a boundary:
 * a query that forgot to scope itself by workspace still saw every row.
 *
 * The application therefore connects as a role of its own. The role is not
 * a superuser, it does not bypass the rules, and it can read and write the
 * tables but cannot change them. The migrations keep running as the
 * administrative role, which is the only role that may create and change
 * the tables.
 *
 * The script is safe to run again. It sets the password, the attributes and
 * the grants every time, so it also repairs a role that was changed by
 * hand.
 */
import postgres from "postgres";
import { adminUrl, targetDatabaseName } from "./connection";

const appUrl = process.env.DATABASE_URL;
if (!appUrl) throw new Error("DATABASE_URL is required");

/**
 * The grants are made with the administrative role.
 *
 * Without it there is nothing to do, and the script is chained after the
 * migrations, so it says so and stops rather than stopping the whole run.
 */
if (!process.env.DATABASE_ADMIN_URL) {
  console.info("DATABASE_ADMIN_URL is not set, so the application role was left alone. Set it and run this again to give the application its own role.");
  process.exit(0);
}

const target = new URL(appUrl);
const roleName = decodeURIComponent(target.username);
if (!roleName) throw new Error("DATABASE_URL must name the role the application uses");
if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(roleName)) throw new Error("Unsafe role name");

/**
 * The password of the role.
 *
 * It is taken from the address the application connects with, unless it is
 * given on its own. The address is the one place a deployment already has
 * to keep the password, so there is nothing new to remember.
 */
const password = process.env.DATABASE_APP_PASSWORD ?? decodeURIComponent(target.password);
if (!password) throw new Error("DATABASE_URL must carry the password of the application role, or DATABASE_APP_PASSWORD must be set");

/**
 * The databases the application uses.
 *
 * A role is shared by the whole cluster, but the grants are given per
 * database, so the test database is given them as well.
 */
const databases = [targetDatabaseName()];
const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) {
  const testName = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, ""));
  if (/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(testName) && !databases.includes(testName)) databases.push(testName);
}

for (const databaseName of databases) {
  const admin = new URL(adminUrl());
  admin.pathname = `/${databaseName}`;
  const sql = postgres(admin.toString(), { max: 1 });
  try {
    const existing = await sql<{ rolname: string }[]>`select rolname from pg_roles where rolname = ${roleName}`;
    if (!existing.length) {
      await sql.unsafe(`create role "${roleName}" login password ${quote(password)}`);
      console.info(`Created the role ${roleName}.`);
    } else {
      await sql.unsafe(`alter role "${roleName}" login password ${quote(password)}`);
    }

    /**
     * The role is an ordinary one.
     *
     * It cannot create databases or roles, it is not a superuser, and it
     * cannot bypass the row-level security rules. Those are the three ways
     * to get around the isolation without touching the tables.
     */
    await sql.unsafe(`alter role "${roleName}" nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
    await sql.unsafe(`grant connect on database "${databaseName}" to "${roleName}"`);

    await sql.unsafe(`grant usage on schema public to "${roleName}"`);
    await sql.unsafe(`grant select, insert, update, delete on all tables in schema public to "${roleName}"`);
    await sql.unsafe(`grant usage, select on all sequences in schema public to "${roleName}"`);

    /**
     * The tables that come later.
     *
     * A migration creates a table and the role has to be able to use it, so
     * the grants for the future are set as well. They apply to the role that
     * runs the migrations, which is the one that creates the tables.
     */
    await sql.unsafe(`alter default privileges in schema public grant select, insert, update, delete on tables to "${roleName}"`);
    await sql.unsafe(`alter default privileges in schema public grant usage, select on sequences to "${roleName}"`);

    const tables = await sql<{ count: string }[]>`select count(*)::text as count from pg_tables where schemaname = 'public'`;
    console.info(`The role ${roleName} can use ${tables[0]?.count ?? 0} tables in ${databaseName}.`);
  } finally {
    await sql.end();
  }
}

/** A password as a SQL literal, so a quote in it cannot end the statement. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
