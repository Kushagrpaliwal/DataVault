import { describe, expect, test } from "bun:test";
import { getServerEnvironment } from "../src";

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

describe("server authentication configuration", () => {
  test("keeps the Turnstile pair together", () => {
    expect(() => getServerEnvironment({ ...baseEnvironment, TURNSTILE_SECRET_KEY: "secret-only" })).toThrow("must be configured together");
    expect(() => getServerEnvironment({ ...baseEnvironment, TURNSTILE_SITE_KEY: "site-only" })).toThrow("must be configured together");
  });

  test("exposes Turnstile keys to the API when both are configured", () => {
    const environment = getServerEnvironment({ ...baseEnvironment, TURNSTILE_SECRET_KEY: "secret", TURNSTILE_SITE_KEY: "site" });
    expect(environment.turnstileSecretKey).toBe("secret");
    expect(environment.turnstileSiteKey).toBe("site");
  });

  test("leaves the signup captcha inert when Turnstile is not configured", () => {
    const environment = getServerEnvironment(baseEnvironment);
    expect(environment.turnstileSecretKey).toBeUndefined();
    expect(environment.turnstileSiteKey).toBeUndefined();
  });

  test("never trusts forwarded client addresses unless a proxy is configured", () => {
    expect(getServerEnvironment(baseEnvironment).trustedProxyHops).toBe(0);
    expect(getServerEnvironment({ ...baseEnvironment, TRUSTED_PROXY_HOPS: "2" }).trustedProxyHops).toBe(2);
  });

  test("leaves the AI features inert when no Gemini key is configured", () => {
    expect(getServerEnvironment(baseEnvironment).geminiApiKey).toBeUndefined();
    expect(getServerEnvironment({ ...baseEnvironment, GEMINI_API_KEY: "key" }).geminiApiKey).toBe("key");
  });

  test("defaults the AI budget to a conservative slice of the free tier", () => {
    const environment = getServerEnvironment(baseEnvironment);
    expect(environment.AI_GLOBAL_DAILY_REQUESTS).toBe(900);
    expect(environment.AI_USER_DAILY_CREDITS).toBe(20);
    expect(environment.GEMINI_MODEL).toBe("gemini-3.1-flash-lite");
  });
});
