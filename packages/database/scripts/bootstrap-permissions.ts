import { PERMISSIONS } from "@data-vault/schemas";
import { getDatabase, permissions } from "../src";

const db = getDatabase();

await db.insert(permissions)
  .values(PERMISSIONS.map((key) => ({ key, description: key.split(".").join(" ") })))
  .onConflictDoNothing();

console.log("DataVault permission catalog is ready. Real users can sign up and create workspaces.");
process.exit(0);
