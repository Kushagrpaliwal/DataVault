import { and, inArray } from "drizzle-orm";
import { getDatabase, organizations, users } from "../src";

const demoEmails = ["admin@datavault.local", "accountant@datavault.local", "viewer@datavault.local"];
const db = getDatabase();
const demoUsers = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, demoEmails));
const demoUserIds = demoUsers.map((user) => user.id);
const demoOrganizations = demoUserIds.length
  ? await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug }).from(organizations).where(and(inArray(organizations.createdBy, demoUserIds), inArray(organizations.slug, ["acme-india", "northstar-studio"])))
  : [];

console.log(JSON.stringify({ demoUsers: demoUsers.map((user) => user.email), demoOrganizations: demoOrganizations.map((organization) => organization.slug) }));

if (!demoUsers.length) {
  console.log("No DataVault demo data found.");
  process.exit(0);
}

await db.transaction(async (tx) => {
  if (demoOrganizations.length) await tx.delete(organizations).where(inArray(organizations.id, demoOrganizations.map((organization) => organization.id)));
  await tx.delete(users).where(inArray(users.id, demoUserIds));
});

console.log("Removed DataVault demo accounts, workspaces, and generated records. Other users and captures were kept.");
process.exit(0);
