import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, { max: 1 });
const rows = await sql`
  select c.relname as "table", c.relrowsecurity as "rls", c.relforcerowsecurity as "force"
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' order by c.relname`;
console.table(rows);
const policies = await sql`
  select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by tablename`;
console.table(policies);
await sql.end();
