import { describe, expect, test } from "bun:test";
import { getServerEnvironment } from "@data-vault/config";
import { classifyEmailDomain, emailDomain } from "../src/auth/disposable-email";
import { pacificDayKey, pacificDayStart } from "../src/lib/pacific";

const baseEnvironment = {
  NODE_ENV: "test",
  API_PORT: "3000",
  API_URL: "http://localhost:3000",
  WEB_URL: "http://localhost:5173",
  DATABASE_URL: "postgresql://example@example.com/data-vault",
  SESSION_SECRET: "s".repeat(32),
  JWT_SECRET: "j".repeat(32),
  ALLOWED_ORIGINS: "http://localhost:5173",
  EXTENSION_REDIRECT_URL: "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/data-vault-auth",
};

describe("the AI environment", () => {
  test("leaves the features switched off without a key", () => {
    const environment = getServerEnvironment(baseEnvironment);
    expect(environment.geminiApiKey).toBeUndefined();
    expect(environment.GEMINI_MODEL).toBe("gemini-3.1-flash-lite");
  });

  test("keeps the shared budget below the free tier and the personal cap below it", () => {
    const environment = getServerEnvironment(baseEnvironment);
    expect(environment.AI_GLOBAL_DAILY_REQUESTS).toBeLessThanOrEqual(environment.AI_USER_DAILY_CREDITS * 100);
    expect(environment.AI_USER_DAILY_CREDITS).toBeLessThan(environment.AI_GLOBAL_DAILY_REQUESTS);
    expect(environment.AI_USER_MINUTE_REQUESTS).toBeLessThanOrEqual(environment.AI_GLOBAL_MINUTE_REQUESTS);
  });
});

describe("email domains", () => {
  test("knows the difference between a real provider and a throwaway one", () => {
    expect(classifyEmailDomain("someone@gmail.com")).toBe("allowed");
    expect(classifyEmailDomain("someone@mailinator.com")).toBe("blocked");
    expect(classifyEmailDomain("someone@some-random-company.example")).toBe("unknown");
  });

  test("reads the domain from the address", () => {
    expect(emailDomain("Someone@Example.COM")).toBe("example.com");
    expect(emailDomain("not-an-email")).toBe("");
  });
});

describe("the credit day", () => {
  test("is the Pacific calendar day", () => {
    // 03:00 UTC on the 20th is still the 19th in Los Angeles.
    const late = new Date("2026-10-20T03:00:00.000Z");
    expect(pacificDayKey(late)).toBe("2026-10-19");
    // 20:00 UTC on the 20th is the 20th in Los Angeles.
    expect(pacificDayKey(new Date("2026-10-20T20:00:00.000Z"))).toBe("2026-10-20");
  });

  test("starts at midnight Pacific", () => {
    const start = pacificDayStart(new Date("2026-10-20T20:00:00.000Z"));
    // Midnight Pacific on the 20th is 07:00 UTC, because the 20th is still
    // daylight saving time.
    expect(start.toISOString()).toBe("2026-10-20T07:00:00.000Z");
  });

  test("starts at a whole day", () => {
    const start = pacificDayStart(new Date("2026-10-20T20:00:00.000Z"));
    const end = pacificDayStart(new Date("2026-10-21T20:00:00.000Z"));
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
