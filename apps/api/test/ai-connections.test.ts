import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { inArray, sql } from "drizzle-orm";
import { getDatabase, organizations, users, withUser } from "@data-vault/database";
import { getServerEnvironment } from "@data-vault/config";
import { createApp } from "../src";
import { openSecret, sealSecret } from "../src/lib/secret-box";
import { isPrivateAddress } from "../src/lib/endpoint-guard";
import { clearRateLimits } from "./support";

/**
 * A fetch that answers with the given body.
 */
function mockFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}


const origin = process.env.WEB_URL ?? "http://localhost:5173";
const suffix = crypto.randomUUID().slice(0, 8);
const password = `Key-${suffix}-Aa1`;
const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

/**
 * The server, with the key that holds the keys of the users.
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
  GEMINI_API_KEY: "test-key",
  AI_KEY_ENCRYPTION_KEY: Buffer.from("k".repeat(32)).toString("base64"),
});

const keyApp = createApp(environment);

type Envelope<T = Record<string, unknown>> = { success: boolean; data: T; error?: { code: string; message: string } };
interface BrowserSession { cookie: string; csrf: string; userId: string }

async function call(path: string, options: { method?: string; body?: unknown; session?: BrowserSession; organizationId?: string; server?: typeof keyApp } = {}) {
  const headers = new Headers({ origin });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.session) { headers.set("cookie", options.session.cookie); headers.set("x-csrf-token", options.session.csrf); }
  if (options.organizationId) headers.set("x-organization-id", options.organizationId);
  const server = options.server ?? keyApp;
  const response = await server.handle(new Request(`http://localhost:3000${path}`, { method: options.method ?? "GET", headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }));
  const text = await response.text();
  let payload: Envelope;
  try {
    payload = JSON.parse(text) as Envelope;
  } catch {
    payload = { success: response.ok, data: { raw: text } };
  }
  return { response, payload, text };
}

async function register(name: string, email: string): Promise<BrowserSession> {
  const { response, payload } = await call("/api/v1/auth/register", { method: "POST", body: { name, email, password } });
  expect(response.status).toBe(201);
  const user = payload.data.user as Record<string, unknown>;
  const userId = String(user.id);
  createdUserIds.push(userId);
  return { cookie: response.headers.getSetCookie()[0]!.split(";")[0]!, csrf: String(payload.data.csrfToken), userId };
}

async function workspace(session: BrowserSession): Promise<string> {
  const orgs = await call("/api/v1/organizations", { session });
  const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);
  createdOrganizationIds.push(organizationId);
  return organizationId;
}

beforeEach(async () => {
  await clearRateLimits();
});

afterEach(async () => {
  const db = getDatabase();
  const personal = createdUserIds.length ? await db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.createdBy, createdUserIds)) : [];
  const all = [...new Set([...createdOrganizationIds, ...personal.map((organization) => organization.id)])];
  if (all.length) await db.delete(organizations).where(inArray(organizations.id, all));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  createdUserIds.length = 0;
  createdOrganizationIds.length = 0;
});

describe("a key of their own", () => {
  test("the key is never sent back", async () => {
    const session = await register("Key Admin", `key-${suffix}@example.com`);
    const organizationId = await workspace(session);

    const created = await call("/api/v1/ai/connections", {
      method: "POST",
      session,
      organizationId,
      body: { label: "My key", kind: "openai-compatible", preset: "openai", baseUrl: "https://api.example.com/v1", model: "gpt-test", apiKey: "sk-super-secret-1234" },
    });
    expect(created.response.status).toBe(201);
    expect(created.text).not.toContain("sk-super-secret-1234");
    expect(created.text).not.toContain("super-secret");
    /**
     * Only the last four of the key are kept, so that two keys can be told
     * apart.
     */
    expect((created.payload.data as { keyHint: string | null }).keyHint).toBe("1234");

    const list = await call("/api/v1/ai/connections", { session, organizationId });
    expect(list.text).not.toContain("sk-super-secret-1234");
    expect((list.payload.data as unknown as { keyHint: string | null }[])[0]?.keyHint).toBe("1234");  });

  test("the stored key is not plain text", async () => {
    const session = await register("Cipher Admin", `cipher-${suffix}@example.com`);
    const organizationId = await workspace(session);

    await call("/api/v1/ai/connections", {
      method: "POST",
      session,
      organizationId,
      body: { label: "My key", kind: "openai-compatible", preset: "openai", baseUrl: "https://api.example.com/v1", model: "gpt-test", apiKey: "sk-plain-text-should-not-be-here" },
    });

    /**
     * The row is read with the person in place, because the rule on the
     * table hides it from anybody else.
     */
    const rows = await withUser(session.userId, organizationId, (tx) => tx.execute(sql`select encrypted_key from ai_connections`));
    const stored = rows.map((row) => String((row as { encrypted_key?: string | null }).encrypted_key ?? "")).join(",");
    expect(stored).not.toContain("should-not-be-here");
    expect(stored).toContain("v1:");
  });

  test("a ciphertext cannot be moved to another person", async () => {
    const master = environment.aiKeyEncryptionKey!;
    const sealed = await sealSecret(master, "person-one", "connection-one", "sk-secret", "api.example.com");
    /**
     * The same ciphertext, read as though it belonged to another person or
     * another connection, is refused.
     */
    let failure: unknown;
    try {
      await openSecret(master, "person-two", "connection-one", sealed, "api.example.com");
    } catch (caught) {
      failure = caught;
    }
    expect(failure).toBeTruthy();
    expect((failure as { code?: string }).code).toBe("AI_KEY_UNREADABLE");

    let other: unknown;
    try {
      await openSecret(master, "person-one", "connection-two", sealed, "api.example.com");
    } catch (caught) {
      other = caught;
    }
    expect(other).toBeTruthy();

    /**
     * And the right person and connection do read it back.
     */
    expect(await openSecret(master, "person-one", "connection-one", sealed, "api.example.com")).toBe("sk-secret");
  });

  test("a key that was given for one host will not open for another", async () => {
    const master = environment.aiKeyEncryptionKey!;
    const sealed = await sealSecret(master, "person-one", "connection-one", "sk-secret", "api.example.com");

    /**
     * The address of a connection can be changed by whoever has the
     * session. The key is tied to the host it was given for, so it does not
     * open for the new one, and so it is never sent there.
     */
    let failure: unknown;
    try {
      await openSecret(master, "person-one", "connection-one", sealed, "attacker.example.com");
    } catch (caught) {
      failure = caught;
    }
    expect(failure).toBeTruthy();
    expect((failure as { code?: string }).code).toBe("AI_KEY_UNREADABLE");

    /**
     * The same host is the same host, whichever way it is written.
     */
    expect(await openSecret(master, "person-one", "connection-one", sealed, "API.Example.com")).toBe("sk-secret");
  });

  test("moving a connection to another address needs the key again", async () => {
    const session = await register("Move Admin", `move-${suffix}@example.com`);
    const organizationId = await workspace(session);

    const created = await call("/api/v1/ai/connections", {
      method: "POST",
      session,
      organizationId,
      body: { label: "My key", kind: "openai-compatible", preset: "openai", baseUrl: "https://api.example.com/v1", model: "gpt-test", apiKey: "sk-secret-1234" },
    });
    expect(created.response.status).toBe(201);
    const id = String((created.payload.data as { id: string }).id);

    /**
     * The address cannot be pointed somewhere else while the key is kept.
     */
    const moved = await call(`/api/v1/ai/connections/${id}`, {
      method: "PATCH",
      session,
      organizationId,
      body: { baseUrl: "https://attacker.example.com/v1" },
    });
    expect(moved.response.status).toBe(400);
    expect(moved.payload.error?.code).toBe("AI_KEY_REQUIRED_FOR_NEW_ADDRESS");

    /**
     * The address that is kept is the one that was given.
     */
    const listed = await call("/api/v1/ai/connections", { session, organizationId });
    expect((listed.payload.data as unknown as { baseUrl: string }[])[0]?.baseUrl).toBe("https://api.example.com/v1");
  });

  test("the key is not sent to a host it was not given for", async () => {
    const session = await register("Host Admin", `host-${suffix}@example.com`);
    const organizationId = await workspace(session);

    const created = await call("/api/v1/ai/connections", {
      method: "POST",
      session,
      organizationId,
      body: { label: "My key", kind: "openai-compatible", preset: "openai", baseUrl: "https://api.example.com/v1", model: "gpt-test", apiKey: "sk-secret-1234" },
    });
    const id = String((created.payload.data as { id: string }).id);

    /**
     * The key is moved with the address, and the key is given again.
     */
    const moved = await call(`/api/v1/ai/connections/${id}`, {
      method: "PATCH",
      session,
      organizationId,
      body: { baseUrl: "https://other.example.com/v1", apiKey: "sk-secret-5678" },
    });
    expect(moved.response.status).toBe(200);
    expect((moved.payload.data as { keyHint: string }).keyHint).toBe("5678");
  });

  test("one person cannot read the connection of another", async () => {
    const first = await register("First Admin", `first-${suffix}@example.com`);
    const firstOrganization = await workspace(first);
    const second = await register("Second Admin", `second-${suffix}@example.com`);
    const secondOrganization = await workspace(second);

    await call("/api/v1/ai/connections", {
      method: "POST",
      session: first,
      organizationId: firstOrganization,
      body: { label: "Private key", kind: "openai-compatible", preset: "openai", baseUrl: "https://api.example.com/v1", model: "gpt-test", apiKey: "sk-first-person-secret" },
    });

    /**
     * The row is behind the rules of the person, so the other person finds
     * nothing.
     */
    const list = await call("/api/v1/ai/connections", { session: second, organizationId: secondOrganization });
    expect((list.payload.data as unknown as unknown[]).length).toBe(0);

    const rows = await withUser(first.userId, firstOrganization, (tx) => tx.execute(sql`select count(*)::int as count from ai_connections`));
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  });

  test("the guard keeps the server away from the local network", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("api.openai.com")).toBe(false);
  });

  test("the guard refuses the addresses that reach inside", async () => {
    const session = await register("Guard Admin", `guard-${suffix}@example.com`);
    const organizationId = await workspace(session);

    for (const address of ["http://169.254.169.254", "https://localhost/v1", "https://127.0.0.1/v1", "https://10.0.0.1/v1"]) {
      const refused = await call("/api/v1/ai/connections/test", {
        method: "POST",
        session,
        organizationId,
        body: { kind: "openai-compatible", baseUrl: address, model: "test", apiKey: "sk-test" },
      });
      expect(refused.response.status).toBe(400);
      expect(["AI_ENDPOINT_BLOCKED", "AI_ENDPOINT_INVALID"]).toContain(refused.payload.error?.code ?? "");
    }
  });

  test("the guard lets a local model through when it is allowed", async () => {
    const allowed = getServerEnvironment({
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
      AI_ALLOW_PRIVATE_ENDPOINTS: "true",
    });
    /**
     * The address is allowed, so the failure is the provider not answering
     * rather than the guard refusing it.
     */
    let failure: unknown;
    try {
      const { assertSafeEndpoint } = await import("../src/lib/endpoint-guard");
      await assertSafeEndpoint(allowed, "http://127.0.0.1:11434/v1");
    } catch (caught) {
      failure = caught;
    }
    expect(failure).toBeUndefined();
  });

  test("the test button asks the provider which models it has", async () => {
    const session = await register("Models Admin", `models-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const realFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({ data: [{ id: "model-one" }, { id: "model-two" }] });
    try {
      const result = await call("/api/v1/ai/connections/test", {
        method: "POST",
        session,
        organizationId,
        /**
         * The address is one that is not on the local network, and the
         * call to it is answered by the test rather than by the provider.
         */
        body: { kind: "openai-compatible", baseUrl: "https://1.1.1.1/v1", model: "model-one", apiKey: "sk-test" },
      });
      expect(result.response.status).toBe(200);
      expect((result.payload.data as { models: string[] }).models).toEqual(["model-one", "model-two"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("the check of a saved connection says whether the key works and what it can use", async () => {
    const session = await register("Check Admin", `check-${suffix}@example.com`);
    const organizationId = await workspace(session);

    const created = await call("/api/v1/ai/connections", {
      method: "POST",
      session,
      organizationId,
      body: { label: "My key", kind: "openai-compatible", preset: "openai", baseUrl: "https://1.1.1.1/v1", model: "model-one", apiKey: "sk-test" },
    });
    expect(created.response.status).toBe(201);

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      /**
       * The list of models, and then the model that is asked to say one
       * word.
       */
      if (url.includes("/models")) return new Response(JSON.stringify({ data: [{ id: "model-one" }, { id: "model-two" }] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    try {
      const result = await call("/api/v1/ai/connections/test", {
        method: "POST",
        session,
        organizationId,
        body: { id: String((created.payload.data as { id: string }).id) },
      });
      expect(result.response.status).toBe(200);
      const check = result.payload.data as { keyAccepted: boolean; models: string[]; model: string | null; modelAnswered: boolean | null; detail: string };
      expect(check.keyAccepted).toBe(true);
      expect(check.models).toEqual(["model-one", "model-two"]);
      expect(check.model).toBe("model-one");
      expect(check.modelAnswered).toBe(true);
      expect(check.detail).toContain("Your key works");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a key that is refused is said to be refused", async () => {
    const session = await register("Refused Admin", `refused-${suffix}@example.com`);
    const organizationId = await workspace(session);

    const realFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({ error: { message: "Invalid API key" } }, 401);
    try {
      const result = await call("/api/v1/ai/connections/test", {
        method: "POST",
        session,
        organizationId,
        body: { kind: "openai-compatible", baseUrl: "https://1.1.1.1/v1", model: "model-one", apiKey: "sk-wrong" },
      });
      expect(result.response.status).toBe(502);
      expect(result.payload.error?.code).toBe("AI_PROVIDER_REFUSED");
      expect(result.payload.error?.message).toContain("refused the key");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("the models list filters out non-chat models like embeddings, dall-e, and tts", async () => {
    const session = await register("Filter Admin", `filter-${suffix}@example.com`);
    const organizationId = await workspace(session);

    const realFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({
      data: [
        { id: "gpt-4o" },
        { id: "text-embedding-3-small" },
        { id: "dall-e-3" },
        { id: "tts-1" },
        { id: "gpt-4o-mini" },
        { id: "whisper-1" },
      ],
    });
    try {
      const result = await call("/api/v1/ai/connections/test", {
        method: "POST",
        session,
        organizationId,
        body: { kind: "openai-compatible", baseUrl: "https://1.1.1.1/v1", apiKey: "sk-test" },
      });
      expect(result.response.status).toBe(200);
      const data = result.payload.data as { models: string[] };
      expect(data.models).toEqual(["gpt-4o", "gpt-4o-mini"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
