import postgres from "postgres";
import { maintenanceUrl } from "./connection";

const name = process.argv[2];
if (!name) throw new Error("Pass the name of the database to recreate.");
if (!/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(name)) throw new Error("Unsafe target database name");
const sql = postgres(maintenanceUrl(), { max: 1 });
await sql.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
await sql.unsafe(`CREATE DATABASE "${name}"`);
await sql.end();
console.log(`Recreated the database ${name}.`);
