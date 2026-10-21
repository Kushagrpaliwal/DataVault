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

  test("finds the words of an item, and shows why it came back", async () => {
    const userId = await makeUser();
    const { organizationId, vaultId } = await makeWorkspace(userId);
    const context = { userId, organizationId, permissions: new Set<string>() } as TenantContext;

    await withTenant(organizationId, (tx) => tx.insert(savedRecords).values([
      {
        organizationId,
        vaultId,
        recordType: "article",
        title: "The quiet craft of reading",
        originalText: "A long piece about how people read, and what they remember afterwards.",
        createdBy: userId,
      },
      {
        organizationId,
        vaultId,
        recordType: "article",
        title: "Cooking in a hurry",
        originalText: "Something entirely different, about a pot of water and a knife.",
        createdBy: userId,
      },
    ]));

    const results = await globalSearch(context, { q: "reading", page: 1, limit: 20 });
    expect(results.total).toBe(1);
    expect(results.items[0]?.title).toBe("The quiet craft of reading");
    /**
     * The snippet holds the words that matched, so the reader can see why
     * the item came back.
     */
    expect(results.items[0]?.snippet).toContain("read");

    /**
     * A word that is only half remembered is still found, because the text
     * is looked for as it was written as well.
     */
    const partial = await globalSearch(context, { q: "readin", page: 1, limit: 20 });
    expect(partial.total).toBe(1);
  });

  test("the best answer comes first", async () => {
    const userId = await makeUser();
    const { organizationId, vaultId } = await makeWorkspace(userId);
    const context = { userId, organizationId, permissions: new Set<string>() } as TenantContext;

    await withTenant(organizationId, (tx) => tx.insert(savedRecords).values([
      { organizationId, vaultId, recordType: "article", title: "Reading the sea", originalText: "A long piece about tides and the boats that go out with them.", createdBy: userId },
      { organizationId, vaultId, recordType: "article", title: "A mention of a tide", originalText: "A long piece about tides and the boats that go out with them.", createdBy: userId },
    ]));

    /**
     * The title of an item says more about it than the text that was
     * captured, so the item whose title carries the word comes first.
     */
    const results = await globalSearch(context, { q: "reading", page: 1, limit: 20 });
    expect(results.total).toBe(1);
    expect(results.items[0]?.title).toBe("Reading the sea");
  });
});
