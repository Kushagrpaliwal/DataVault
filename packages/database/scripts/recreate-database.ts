import postgres from "postgres";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required");
const name = process.argv[2];
if (!name) throw new Error("Pass the name of the database to recreate.");
const sql = postgres(adminUrl, { max: 1 });
await sql.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
await sql.unsafe(`CREATE DATABASE "${name}"`);
await sql.end();
console.log(`Recreated the database ${name}.`);
