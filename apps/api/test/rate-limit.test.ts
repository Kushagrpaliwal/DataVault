import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { inArray, sql } from "drizzle-orm";
import { getDatabase, organizations, users } from "@data-vault/database";
import { getServerEnvironment } from "@data-vault/config";
import { app } from "../src";
import { clientKey } from "../src/lib/client-ip";
import { enforceRateLimit } from "../src/lib/rate-limit-policies";
import { clearRateLimits } from "./support";

/**
 * The bucket a request is counted against.
 *
 * With no proxy in front of the API the address cannot be trusted, so the
 * budget follows the signed-in account. The account is only known when the
 * credential has been checked, so a made-up cookie cannot mint a fresh
 * budget for every request.
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
  TRUSTED_PROXY_HOPS: "0",
});

const policy = { name: "forged-cookie-test", max: 2, windowSeconds: 60 };
const origin = process.env.WEB_URL ?? "http://localhost:5173";
const createdUserIds: string[] = [];

function requestWithCookie(cookie: string) {
  return new Request("http://localhost:3000/api/v1/me", { headers: { cookie } });
}

/** A cookie that looks like a session cookie but was never issued. */
function forgedCookie() {
  return `better-auth.session_token=${crypto.randomUUID()}.${crypto.randomUUID().replaceAll("-", "")}`;
}

beforeEach(async () => {
  await clearRateLimits();
});

afterEach(async () => {
  const db = getDatabase();
  await db.execute(sql`delete from rate_limit_buckets where key like 'forged-cookie-test%'`);
  if (createdUserIds.length) {
    /**
     * Every account is given a personal workspace, and that workspace
     * belongs to the account, so it goes first.
     */
    const personal = await db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.createdBy, createdUserIds));
    if (personal.length) await db.delete(organizations).where(inArray(organizations.id, personal.map((organization) => organization.id)));
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

describe("the rate limit bucket", () => {
  test("a made-up cookie does not get a fresh budget", async () => {
    const first = requestWithCookie(forgedCookie());
    const second = requestWithCookie(forgedCookie());

    /**
     * A cookie that was never issued is not an account, so both requests
     * share the one budget.
     */
    expect(await clientKey(first, environment)).toBe("shared");
    expect(await clientKey(second, environment)).toBe("shared");

    await enforceRateLimit(first, environment, policy);
    await enforceRateLimit(second, environment, policy);

    let failure: unknown;
    try {
      await enforceRateLimit(first, environment, policy);
    } catch (caught) {
      failure = caught;
    }
    expect(failure).toBeTruthy();
    expect((failure as { code?: string }).code).toBe("RATE_LIMITED");
  });

  test("a real session gets a budget of its own", async () => {
    const response = await app.handle(new Request("http://localhost:3000/api/v1/auth/register", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ name: "Bucket Tester", email: `bucket-${crypto.randomUUID().slice(0, 8)}@example.com`, password: "Bucket-Bucket-Bucket-1" }),
    }));
    expect(response.status).toBe(201);
    const payload = await response.json() as { data: { user: { id: string } } };
    createdUserIds.push(payload.data.user.id);
    const cookie = response.headers.getSetCookie()[0]!.split(";")[0]!;

    /**
     * The session is confirmed against the table of sessions, so this one
     * is an account of its own.
     */
    const key = await clientKey(requestWithCookie(cookie), environment);
    expect(key).toStartWith("account:");

    /**
     * A made-up cookie in the same request does not change that.
     */
    const forged = await clientKey(requestWithCookie(`${cookie}; ${forgedCookie()}`), environment);
    expect(forged).toBe(key);
  });
});
