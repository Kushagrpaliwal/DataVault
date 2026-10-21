/**
 * Bring the test database up to date.
 *
 * The tests run against a database of their own, so it has to be migrated
 * as well. The migrations run with the administrative role, exactly as they
 * do for the database the application works in.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is required");

/**
 * The administrative role reaches the test database.
 *
 * The migrations create and change the tables, which the application role
 * is not allowed to do, so the administrative role is used with the name of
 * the test database.
 */
const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required");
const admin = new URL(adminUrl);
admin.pathname = new URL(testUrl).pathname;
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_ADMIN_URL = admin.toString();

/**
 * The command the tool is given.
 *
 * The tool reads it from the arguments of the process, so they are put in
 * place before it is loaded.
 */
process.argv = [process.argv[0] ?? "bun", process.argv[1] ?? "migrate-test.ts", "migrate", "--config", "drizzle.config.ts"];

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("drizzle-kit/package.json"));
await import(pathToFileURL(join(packageRoot, "bin.cjs")).href);
