import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { getDatabase, organizations, organizationMembers, savedRecords, users, vaults, withTenant } from "@data-vault/database";
import { globalSearch, monthRange } from "../src/services/search";
import type { TenantContext } from "../src/auth/context";

const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await getDatabase().insert(users).values({
    name: "Search Tester",
    email: `search-${crypto.randomUUID().slice(0, 8)}@example.com`,
    emailVerified: true,
  }).returning({ id: users.id });
  if (!user) throw new Error("User insert failed");
  createdUserIds.push(user.id);
  return user.id;
}

async function makeWorkspace(userId: string): Promise<{ organizationId: string; vaultId: string }> {
  const db = getDatabase();
  const [organization] = await db.insert(organizations).values({
    name: "Search Workspace",
    slug: `search-${crypto.randomUUID().slice(0, 12)}`,
    currency: "USD",
    locale: "en-US",
    timeZone: "UTC",
    createdBy: userId,
  }).returning({ id: organizations.id });
  if (!organization) throw new Error("Organization insert failed");
  await db.insert(organizationMembers).values({ organizationId: organization.id, userId, status: "active" });
  createdOrganizationIds.push(organization.id);
  const [vault] = await withTenant(organization.id, (tx) => tx.insert(vaults).values({
    organizationId: organization.id,
    name: "Search Vault",
    slug: `search-vault-${crypto.randomUUID().slice(0, 8)}`,
    createdBy: userId,
  }).returning({ id: vaults.id }));
  return { organizationId: organization.id, vaultId: vault!.id };
}

afterEach(async () => {
  const db = getDatabase();
  if (createdOrganizationIds.length) await db.delete(organizations).where(inArray(organizations.id, createdOrganizationIds));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  createdUserIds.length = 0;
  createdOrganizationIds.length = 0;
});

describe("a month in a search", () => {
  test("is a date filter only when the query is a month", () => {
    expect(monthRange("maybe")).toBeNull();
    expect(monthRange("a reading in may")).toBeNull();
    expect(monthRange("may")).not.toBeNull();
    expect(monthRange("may 2024")).not.toBeNull();
    expect(monthRange("2024 may")).not.toBeNull();
  });

  test("does not bring in everything from that month", async () => {
    const userId = await makeUser();
    const { organizationId, vaultId } = await makeWorkspace(userId);
    const context = { userId, organizationId, permissions: new Set<string>() } as TenantContext;

    /**
     * Two items from May of this year. Only one of them has the word in
     * it.
     */
    const may = new Date(Date.UTC(new Date().getFullYear(), 4, 15));
    await withTenant(organizationId, (tx) => tx.insert(savedRecords).values([
      { organizationId, vaultId, recordType: "note", title: "Maybe worth reading", createdBy: userId, createdAt: may },
      { organizationId, vaultId, recordType: "note", title: "Something else entirely", createdBy: userId, createdAt: may },
    ]));

    /**
     * The word contains the name of a month. It is still only a word.
     */
    const results = await globalSearch(context, { q: "maybe", page: 1, limit: 20 });
    expect(results.total).toBe(1);
    expect(results.items[0]?.title).toBe("Maybe worth reading");
  });
});
