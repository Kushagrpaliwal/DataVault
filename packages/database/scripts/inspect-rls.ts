import postgres from "postgres";
import { adminUrl } from "./connection";

/**
 * The tables that must be behind the rules.
 *
 * The rules are only a boundary when they are forced, because a table's
 * owner is exempt from them otherwise. The application connects as a role
 * of its own, so the rules are the second boundary.
 */
const tenantTables = [
  "attachments", "audit_logs", "capture_sources", "evidence_snapshots", "idempotency_keys",
  "note_revisions", "notes", "processing_jobs", "record_embeddings", "saved_record_collections", "saved_record_tags",
  "saved_records", "saved_views", "tags", "user_note_prefs", "vault_collections", "vaults",
];

/** The tables that follow the person rather than the workspace. */
const userTables = ["ai_credit_periods", "ai_credit_ledger", "ai_usage_events", "ai_consents", "ai_connections", "note_ai_previews"];

const sql = postgres(adminUrl(), { max: 1 });
const rows = await sql`
  select c.relname as "table", c.relrowsecurity as "rls", c.relforcerowsecurity as "force"
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' order by c.relname`;
console.table(rows);
const policies = await sql`
  select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by tablename`;
console.table(policies);

const state = new Map(rows.map((row) => [row.table, row]));
const missing = [...tenantTables, ...userTables].filter((table) => {
  const row = state.get(table);
  return !row?.rls || !row?.force;
});
await sql.end();

if (missing.length) {
  console.error(`These tables do not have forced row-level security: ${missing.join(", ")}.`);
  process.exit(1);
}
console.info("Every table that holds business data has forced row-level security.");
