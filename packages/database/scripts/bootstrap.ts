import postgres from "postgres";
import { maintenanceUrl, targetDatabaseName } from "./connection";

const databaseName = targetDatabaseName();

const admin = postgres(maintenanceUrl(), { max: 1 });
try {
  const rows = await admin<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${databaseName}) AS exists`;
  if (!rows[0]?.exists) {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    console.info(`Created PostgreSQL database ${databaseName}`);
  }
} finally {
  await admin.end();
}
