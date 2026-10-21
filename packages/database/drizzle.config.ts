import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://localhost/data_vault" },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
