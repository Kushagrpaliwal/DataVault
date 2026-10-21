import { defineConfig } from "drizzle-kit";

/**
 * The migrations run as the administrative role.
 *
 * The rules on the tables are forced, and the tables belong to the
 * administrative role, so the migrations cannot run as the application
 * role: it would be refused the very changes it is meant to make.
 */
const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url: adminUrl ?? "postgresql://localhost/data_vault" },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
