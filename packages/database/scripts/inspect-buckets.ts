import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, { max: 1 });
const rows = await sql`select key, hits, reset_at from rate_limit_buckets order by key`;
console.table(rows);
await sql.end();
