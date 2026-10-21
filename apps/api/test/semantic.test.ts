import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { getDatabase, organizations, recordEmbeddings, savedRecords, users, vaults, withTenant } from "@data-vault/database";
import { semanticSearch, textForEmbedding } from "../src/services/semantic";
import type { TenantContext } from "../src/auth/context";

const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

async function makeWorkspace(): Promise<{ userId: string; organizationId: string; vaultId: string }> {
  const db = getDatabase();
  const [user] = await db.insert(users).values({
    name: "Semantic Tester",
    email: `semantic-${crypto.randomUUID().slice(0, 8)}@example.com`,
    emailVerified: true,
  }).returning({ id: users.id });
  if (!user) throw new Error("User insert failed");
  createdUserIds.push(user.id);
  const [organization] = await db.insert(organizations).values({
    name: "Semantic Workspace",
    slug: `semantic-${crypto.randomUUID().slice(0, 12)}`,
    currency: "USD",
    locale: "en-US",
    timeZone: "UTC",
    createdBy: user.id,
  }).returning({ id: organizations.id });
  if (!organization) throw new Error("Organization insert failed");
  createdOrganizationIds.push(organization.id);
  const [vault] = await withTenant(organization.id, (tx) => tx.insert(vaults).values({
    organizationId: organization.id,
    name: "Semantic Vault",
    slug: `semantic-vault-${crypto.randomUUID().slice(0, 8)}`,
    createdBy: user.id,
  }).returning({ id: vaults.id }));
  return { userId: user.id, organizationId: organization.id, vaultId: vault!.id };
}

afterEach(async () => {
  const db = getDatabase();
  const personal = createdUserIds.length ? await db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.createdBy, createdUserIds)) : [];
  const all = [...new Set([...createdOrganizationIds, ...personal.map((organization) => organization.id)])];
  if (all.length) await db.delete(organizations).where(inArray(organizations.id, all));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  createdUserIds.length = 0;
  createdOrganizationIds.length = 0;
});

describe("a search by meaning", () => {
  test("the numbers of an item are kept beside it", async () => {
    const { userId, organizationId, vaultId } = await makeWorkspace();
    const context = { userId, organizationId, permissions: new Set<string>() } as TenantContext;

    const [record] = await withTenant(organizationId, (tx) => tx.insert(savedRecords).values({
      organizationId,
      vaultId,
      recordType: "article",
      title: "The tides of the northern sea",
      originalText: "A long piece about the water and the boats that go out on it.",
      createdBy: userId,
    }).returning({ id: savedRecords.id }));
    expect(record).toBeTruthy();

    await withTenant(organizationId, (tx) => tx.insert(recordEmbeddings).values({
      organizationId,
      savedRecordId: record!.id,
      model: "text-embedding-004",
      embedding: [1, 0, 0],
    }));

    /**
     * The question is about the water, so the item about the water comes
     * first.
     */
    const results = await semanticSearch(context, [0.9, 0.1, 0], 20);
    expect(results.items.length).toBe(1);
    expect(results.items[0]?.title).toBe("The tides of the northern sea");
    expect(results.items[0]?.similarity).toBeGreaterThan(0.9);
  });

  test("an item of another workspace is never found", async () => {
    const first = await makeWorkspace();
    const second = await makeWorkspace();

    const [record] = await withTenant(first.organizationId, (tx) => tx.insert(savedRecords).values({
      organizationId: first.organizationId,
      vaultId: first.vaultId,
      recordType: "article",
      title: "Something private",
      createdBy: first.userId,
    }).returning({ id: savedRecords.id }));
    await withTenant(first.organizationId, (tx) => tx.insert(recordEmbeddings).values({
      organizationId: first.organizationId,
      savedRecordId: record!.id,
      model: "text-embedding-004",
      embedding: [1, 0, 0],
    }));

    const results = await semanticSearch({ userId: second.userId, organizationId: second.organizationId, permissions: new Set<string>() } as TenantContext, [1, 0, 0], 20);
    expect(results.items.length).toBe(0);
  });

  test("the text of an item is written for the model", () => {
    expect(textForEmbedding("The tides", "A long piece.")).toBe("The tides\nThe tides\nA long piece.");
    expect(textForEmbedding(null, "Only the text.")).toBe("Only the text.");
    expect(textForEmbedding("Only the title", null)).toBe("Only the title\nOnly the title\n");
  });
});
