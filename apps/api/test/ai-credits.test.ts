import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { aiConsents, aiCreditPeriods, getDatabase, organizations, organizationMembers, users } from "@data-vault/database";
import { getServerEnvironment } from "@data-vault/config";
import { recordConsent, reserveCredit } from "../src/services/ai-credits";
import { pacificDayStart } from "../src/lib/pacific";

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
  /** The features are switched on so the counters can be exercised. */
  GEMINI_API_KEY: "test-key",
  AI_USER_DAILY_CREDITS: "20",
  AI_GLOBAL_DAILY_REQUESTS: "900",
});

const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

async function makeUser(): Promise<string> {
  const db = getDatabase();
  const [user] = await db.insert(users).values({
    name: "Credit Tester",
    email: `credits-${crypto.randomUUID().slice(0, 8)}@example.com`,
    emailVerified: true,
  }).returning({ id: users.id });
  if (!user) throw new Error("User insert failed");
  createdUserIds.push(user.id);
  /**
   * The features are only used by an account that has agreed to send its
   * content to the model provider.
   */
  await recordConsent(user.id);
  return user.id;
}

async function makeOrganization(userId: string): Promise<string> {
  const db = getDatabase();
  const [organization] = await db.insert(organizations).values({
    name: "Credit Workspace",
    slug: `credits-${crypto.randomUUID().slice(0, 12)}`,
    currency: "USD",
    locale: "en-US",
    timeZone: "UTC",
    createdBy: userId,
  }).returning({ id: organizations.id });
  if (!organization) throw new Error("Organization insert failed");
  await db.insert(organizationMembers).values({ organizationId: organization.id, userId, status: "active" });
  createdOrganizationIds.push(organization.id);
  return organization.id;
}

afterEach(async () => {
  const db = getDatabase();
  if (createdOrganizationIds.length) {
    await db.delete(organizations).where(inArray(organizations.id, createdOrganizationIds));
  }
  if (createdUserIds.length) {
    await db.delete(aiCreditPeriods).where(inArray(aiCreditPeriods.userId, createdUserIds));
    await db.delete(aiConsents).where(inArray(aiConsents.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  createdUserIds.length = 0;
  createdOrganizationIds.length = 0;
});

describe("the AI credit allowance", () => {
  test("is counted for the person, not for the workspace", async () => {
    const userId = await makeUser();
    const first = await makeOrganization(userId);
    const second = await makeOrganization(userId);

    const periodStart = pacificDayStart();
    await reserveCredit(environment, { userId, organizationId: first }, "summarize", "test-model", `${userId}:first`);
    await reserveCredit(environment, { userId, organizationId: second }, "summarize", "test-model", `${userId}:second`);

    const db = getDatabase();
    const [period] = await db.select().from(aiCreditPeriods).where(and(
      eq(aiCreditPeriods.userId, userId),
      eq(aiCreditPeriods.periodStart, periodStart),
    )).limit(1);
    /**
     * One row for the person, and both requests counted in it. A separate
     * workspace is not a separate allowance.
     */
    expect(period?.used).toBe(2);
  });

  test("refuses a request key that another account has already used", async () => {
    const first = await makeUser();
    const second = await makeUser();
    const workspace = await makeOrganization(first);
    const key = `shared-key-${crypto.randomUUID()}`;

    await reserveCredit(environment, { userId: first, organizationId: workspace }, "summarize", "test-model", `${first}:${key}`, { idempotencyKey: key });

    let failure: unknown;
    try {
      await reserveCredit(environment, { userId: second, organizationId: workspace }, "summarize", "test-model", `${second}:${key}`, { idempotencyKey: key });
    } catch (caught) {
      failure = caught;
    }
    expect(failure).toBeTruthy();
    expect((failure as { code?: string }).code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  test("marks a repeated request as a replay rather than charging again", async () => {
    const userId = await makeUser();
    const workspace = await makeOrganization(userId);
    const key = `repeat-key-${crypto.randomUUID()}`;

    const first = await reserveCredit(environment, { userId, organizationId: workspace }, "summarize", "test-model", `${userId}:${key}`, { idempotencyKey: key });
    const second = await reserveCredit(environment, { userId, organizationId: workspace }, "summarize", "test-model", `${userId}:${key}`, { idempotencyKey: key });
    expect(first.replay).toBe(false);
    expect(second.replay).toBe(true);
  });
});
