import { inArray, like, or } from "drizzle-orm";
import { getDatabase, organizations, users } from "../src";

const db = getDatabase();
const testUsers = await db.select({ id: users.id, email: users.email }).from(users).where(or(like(users.email, "admin-%@example.com"), like(users.email, "viewer-%@example.com")));
const testOrganizations = await db.select({ id: organizations.id, slug: organizations.slug }).from(organizations).where(or(like(organizations.slug, "integration-a-%"), like(organizations.slug, "integration-b-%")));

await db.transaction(async (tx) => {
  if (testOrganizations.length) await tx.delete(organizations).where(inArray(organizations.id, testOrganizations.map((organization) => organization.id)));
  if (testUsers.length) await tx.delete(users).where(inArray(users.id, testUsers.map((user) => user.id)));
});

console.log(JSON.stringify({ removedTestUsers: testUsers.length, removedTestWorkspaces: testOrganizations.length }));
process.exit(0);
