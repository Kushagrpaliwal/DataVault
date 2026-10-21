import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { inArray, sql } from "drizzle-orm";
import {
  aiConsents, getDatabase, organizations, organizationMembers, savedRecords, users, vaults, withAccount, withTenant,
} from "@data-vault/database";
import { getServerEnvironment } from "@data-vault/config";
import { listCreditActivity, readCreditStatus, recordConsent, recordUsage, reserveCredit } from "../src/services/ai-credits";

/**
 * The rules on the tables are only a boundary if the application connects
 * as a role that is subject to them. The tests run as that role, so a
 * query that forgets to name a workspace sees nothing at all.
 */
const environment = getServerEnvironment({
  NODE_ENV: "test",
  API_PORT: "3000",
  API_URL: "http://localhost:3000",
  WEB_URL: "http://localhost:5173",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://example@example.com/data-vault",
  SESSION_SECRET: "s".repeat(32),
  JWT_SECRET: "j".repeat(32),
  ALLOWED_ORIGINS: "http://localhost:5173",
  EXTENSION_REDIRECT_URL: "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/data-vault-auth",
  GEMINI_API_KEY: "test-key",
  AI_USER_DAILY_CREDITS: "20",
  AI_GLOBAL_DAILY_REQUESTS: "900",
});

const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await getDatabase().insert(users).values({
    name: "Isolation Tester",
    email: `isolation-${crypto.randomUUID().slice(0, 8)}@example.com`,
    emailVerified: true,
  }).returning({ id: users.id });
  if (!user) throw new Error("User insert failed");
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrganization(userId: string): Promise<string> {
  const [organization] = await getDatabase().insert(organizations).values({
    name: "Isolation Workspace",
    slug: `isolation-${crypto.randomUUID().slice(0, 12)}`,
    currency: "USD",
    locale: "en-US",
    timeZone: "UTC",
    createdBy: userId,
  }).returning({ id: organizations.id });
  if (!organization) throw new Error("Organization insert failed");
  await getDatabase().insert(organizationMembers).values({ organizationId: organization.id, userId, status: "active" });
  createdOrganizationIds.push(organization.id);
  return organization.id;
}

/** A count of the rows a table holds, without naming a workspace. */
async function countWithoutTenant(table: string): Promise<number> {
  const rows = await getDatabase().execute<{ count: number }>(sql.raw(`select count(*)::int as count from ${table}`));
  return Number(rows[0]?.count ?? -1);
}

afterEach(async () => {
  const db = getDatabase();
  if (createdOrganizationIds.length) await db.delete(organizations).where(inArray(organizations.id, createdOrganizationIds));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  createdUserIds.length = 0;
  createdOrganizationIds.length = 0;
});

describe("the row-level security rules", () => {
  test("a query with no workspace set sees nothing", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrganization(userId);
    const [vault] = await withTenant(organizationId, (tx) => tx.insert(vaults).values({
      organizationId,
      name: "Isolation Vault",
      slug: `isolation-vault-${crypto.randomUUID().slice(0, 8)}`,
      createdBy: userId,
    }).returning({ id: vaults.id }));
    await withTenant(organizationId, (tx) => tx.insert(savedRecords).values({
      organizationId,
      vaultId: vault!.id,
      recordType: "note",
      title: "Only this workspace may read it",
      createdBy: userId,
    }));

    /**
     * The row is there, and the query that names the workspace finds it.
     */
    const visible = await withTenant(organizationId, (tx) => tx.select({ id: savedRecords.id }).from(savedRecords));
    expect(visible.length).toBe(1);

    /**
     * A query that does not name a workspace finds nothing. This is the
     * whole point of the rules: a forgotten scope is not a data leak.
     */
    expect(await countWithoutTenant("saved_records")).toBe(0);
    expect(await countWithoutTenant("notes")).toBe(0);
    expect(await countWithoutTenant("vaults")).toBe(0);
  });

  test("the credit tables follow the person", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrganization(userId);

    /**
     * The agreement belongs to the person, so it is written and read with
     * the person in place.
     */
    await recordConsent(userId);
    const status = await readCreditStatus(environment, { userId, organizationId });
    expect(status.consented).toBe(true);
    expect(status.remaining).toBeGreaterThan(0);

    const reservation = await reserveCredit(environment, { userId, organizationId }, "summarize", "test-model", `${userId}:isolation`);
    await recordUsage(reservation, { inputTokens: 10, outputTokens: 20 });

    /**
     * The usage and the movements are found again, so the rules do not
     * swallow the writes.
     */
    const activity = await listCreditActivity({ userId, organizationId });
    expect(activity.length).toBe(1);
    expect(activity[0]?.kind).toBe("usage");

    /**
     * Without the person, the same rows are out of sight.
     */
    expect(await countWithoutTenant("ai_consents")).toBe(0);
    expect(await countWithoutTenant("ai_credit_ledger")).toBe(0);
    expect(await countWithoutTenant("ai_usage_events")).toBe(0);

    const [consent] = await withAccount(userId, (tx) => tx.select({ userId: aiConsents.userId }).from(aiConsents));
    expect(consent?.userId).toBe(userId);
  });
});
