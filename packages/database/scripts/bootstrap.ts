import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (process.env.DB_AUTO_CREATE !== "true" || !adminUrl) process.exit(0);

const target = new URL(databaseUrl);
const databaseName = target.pathname.slice(1);
if (!/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(databaseName)) throw new Error("Unsafe target database name");

const admin = postgres(adminUrl, { max: 1 });
try {
  const rows = await admin<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${databaseName}) AS exists`;
  if (!rows[0]?.exists) {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    console.info(`Created PostgreSQL database ${databaseName}`);
  }
} finally {
  await admin.end();
}
