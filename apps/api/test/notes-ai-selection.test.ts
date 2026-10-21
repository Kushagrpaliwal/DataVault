import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { inArray, sql } from "drizzle-orm";
import { getDatabase, organizations, users, withUser } from "@data-vault/database";
import { getServerEnvironment } from "@data-vault/config";
import { createApp } from "../src";
import { clearRateLimits } from "./support";

/**
 * A fetch that answers with the given body.
 */
function mockFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}


const origin = process.env.WEB_URL ?? "http://localhost:5173";
const suffix = crypto.randomUUID().slice(0, 8);
const password = `Sel-${suffix}-Aa1`;
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

const app = createApp(environment);

type Envelope<T = Record<string, unknown>> = { success: boolean; data: T; error?: { code: string; message: string } };
interface BrowserSession { cookie: string; csrf: string; userId: string }

async function call(path: string, options: { method?: string; body?: unknown; session?: BrowserSession; organizationId?: string; idempotencyKey?: string } = {}) {
  const headers = new Headers({ origin });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.session) { headers.set("cookie", options.session.cookie); headers.set("x-csrf-token", options.session.csrf); }
  if (options.organizationId) headers.set("x-organization-id", options.organizationId);
  if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
  const response = await app.handle(new Request(`http://localhost:3000${path}`, { method: options.method ?? "GET", headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }));
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

async function makeDoc(session: BrowserSession, organizationId: string): Promise<string> {
  const created = await call("/api/v1/notes", {
    method: "POST",
    session,
    organizationId,
    idempotencyKey: `selection-${suffix}`,
    body: { title: "A doc to work on" },
  });
  expect(created.response.status).toBe(201);
  return String((created.payload.data as { id: string }).id);
}

/**
 * The answer the model gives.
 */
const blocks = {
  blocks: [
    { type: "heading", level: 2, text: "The tides" },
    { type: "paragraph", text: "A piece about the water." },
    { type: "bullets", items: ["The water", "The boats"] },
  ],
};

const realFetch = globalThis.fetch;

beforeEach(async () => {
  await clearRateLimits();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  const db = getDatabase();
  const personal = createdUserIds.length ? await db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.createdBy, createdUserIds)) : [];
  const all = [...new Set([...createdOrganizationIds, ...personal.map((organization) => organization.id)])];
  if (all.length) await db.delete(organizations).where(inArray(organizations.id, all));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  createdUserIds.length = 0;
  createdOrganizationIds.length = 0;
});

/**
 * Connect a provider of their own, so that the request does not spend a
 * credit.
 */
async function connectOwnKey(session: BrowserSession, organizationId: string, kind: "openai-compatible" | "anthropic" | "gemini"): Promise<void> {
  const created = await call("/api/v1/ai/connections", {
    method: "POST",
    session,
    organizationId,
    body: { label: "My key", kind, preset: kind === "anthropic" ? "anthropic" : kind === "gemini" ? "gemini" : "openai", baseUrl: "https://1.1.1.1", model: "test-model", apiKey: "sk-test-key", isDefault: true },
  });
  expect(created.response.status).toBe(201);
}

/**
 * The selection that is sent.
 */
const selection = { markdown: "The tides of the northern sea.\nA piece about the water.", clips: [] };

describe("the AI, on a selection", () => {
  test("an answer in the shape of the provider that speaks the OpenAI language", async () => {
    const session = await register("OpenAI Admin", `selection-openai-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const noteId = await makeDoc(session, organizationId);
    await connectOwnKey(session, organizationId, "openai-compatible");

    globalThis.fetch = mockFetch({
      choices: [{ message: { content: JSON.stringify(blocks) } }],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
    });

    const result = await call(`/api/v1/notes/${noteId}/ai/selection`, {
      method: "POST",
      session,
      organizationId,
      body: { action: "arrange", selection, context: { mode: "selection" } },
    });
    expect(result.response.status).toBe(200);
    const answer = (result.payload.data as { blocks: { type: string }[] }).blocks;
    expect(answer.map((block) => block.type)).toEqual(["heading", "paragraph", "bullets"]);
  });

  test("an answer in the shape of Anthropic", async () => {
    const session = await register("Anthropic Admin", `selection-anthropic-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const noteId = await makeDoc(session, organizationId);
    await connectOwnKey(session, organizationId, "anthropic");

    globalThis.fetch = mockFetch({
      content: [{ type: "tool_use", name: "answer", input: blocks }],
      usage: { input_tokens: 12, output_tokens: 8 },
    });

    const result = await call(`/api/v1/notes/${noteId}/ai/selection`, {
      method: "POST",
      session,
      organizationId,
      body: { action: "arrange", selection, context: { mode: "selection" } },
    });
    expect(result.response.status).toBe(200);
    expect((result.payload.data as { blocks: unknown[] }).blocks.length).toBe(3);
  });

  test("an answer in the shape of Google", async () => {
    const session = await register("Gemini Admin", `selection-gemini-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const noteId = await makeDoc(session, organizationId);
    await connectOwnKey(session, organizationId, "gemini");

    globalThis.fetch = mockFetch({
      candidates: [{ content: { parts: [{ text: JSON.stringify(blocks) }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 },
    });

    const result = await call(`/api/v1/notes/${noteId}/ai/selection`, {
      method: "POST",
      session,
      organizationId,
      body: { action: "arrange", selection, context: { mode: "selection" } },
    });
    expect(result.response.status).toBe(200);
    expect((result.payload.data as { blocks: unknown[] }).blocks.length).toBe(3);
  });

  test("an answer of their own spends no credit", async () => {
    const session = await register("Own Admin", `selection-own-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const noteId = await makeDoc(session, organizationId);
    await connectOwnKey(session, organizationId, "openai-compatible");

    globalThis.fetch = mockFetch({ choices: [{ message: { content: JSON.stringify(blocks) } }] });

    const result = await call(`/api/v1/notes/${noteId}/ai/selection`, {
      method: "POST",
      session,
      organizationId,
      body: { action: "arrange", selection, context: { mode: "selection" } },
    });
    expect(result.response.status).toBe(200);
    expect((result.payload.data as { source: string }).source).toBe("own");

    const ledger = await withUser(session.userId, organizationId, (tx) => tx.execute(sql`select count(*)::int as count from ai_credit_ledger`));
    expect(Number(ledger[0]?.count ?? 0)).toBe(0);
  });

  test("without a key of their own the free credits are used", async () => {
    const session = await register("Free Admin", `selection-free-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const noteId = await makeDoc(session, organizationId);
    /**
     * The address has to be confirmed, or the free path refuses the
     * request before it is made.
     */
    await getDatabase().update(users).set({ emailVerified: true }).where(inArray(users.id, [session.userId]));
    await call("/api/v1/ai/consent", { method: "POST", session, body: { accepted: true } });

    globalThis.fetch = mockFetch({
      candidates: [{ content: { parts: [{ text: JSON.stringify(blocks) }] } }],
    });

    const result = await call(`/api/v1/notes/${noteId}/ai/selection`, {
      method: "POST",
      session,
      organizationId,
      body: { action: "arrange", selection, context: { mode: "selection" } },
    });
    expect(result.response.status).toBe(200);
    expect((result.payload.data as { source: string }).source).toBe("free");

    const ledger = await withUser(session.userId, organizationId, (tx) => tx.execute(sql`select count(*)::int as count from ai_credit_ledger where kind = 'usage'`));
    expect(Number(ledger[0]?.count ?? 0)).toBe(1);
  });

  test("a saved item of another workspace is refused", async () => {
    const session = await register("Cross Admin", `selection-cross-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const noteId = await makeDoc(session, organizationId);
    await connectOwnKey(session, organizationId, "openai-compatible");

    const other = await register("Other Admin", `selection-other-${suffix}@example.com`);
    const otherOrganization = await workspace(other);
    const otherRecord = await call("/api/v1/saved-records", {
      method: "POST",
      session: other,
      organizationId: otherOrganization,
      idempotencyKey: `selection-other-${suffix}`,
      body: { recordType: "note", title: "Not yours" },
    });
    const recordId = String((otherRecord.payload.data as { id: string }).id);

    globalThis.fetch = mockFetch({ choices: [{ message: { content: JSON.stringify(blocks) } }] });

    const result = await call(`/api/v1/notes/${noteId}/ai/selection`, {
      method: "POST",
      session,
      organizationId,
      body: { action: "arrange", selection, context: { mode: "sources", recordIds: [recordId] } },
    });
    expect(result.response.status).toBe(404);
  });

  test("an answer that cannot be read is refused", async () => {
    const session = await register("Bad Admin", `selection-bad-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const noteId = await makeDoc(session, organizationId);
    await connectOwnKey(session, organizationId, "openai-compatible");

    globalThis.fetch = mockFetch({ choices: [{ message: { content: "not json at all" } }] });

    const result = await call(`/api/v1/notes/${noteId}/ai/selection`, {
      method: "POST",
      session,
      organizationId,
      body: { action: "arrange", selection, context: { mode: "selection" } },
    });
    expect(result.response.status).toBe(502);
    expect(result.payload.error?.code).toBe("AI_INVALID_RESPONSE");
  });
});
