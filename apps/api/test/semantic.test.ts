import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { getDatabase, organizations, recordEmbeddings, savedRecords, users, vaults, withTenant } from "@data-vault/database";
import { getServerEnvironment } from "@data-vault/config";
import { createApp } from "../src";
import { embedText } from "../src/services/gemini";
import { semanticSearch, textForEmbedding } from "../src/services/semantic";
import type { TenantContext } from "../src/auth/context";
import { clearRateLimits } from "./support";

/**
 * The server the tests talk to.
 *
 * The key is a made-up one, because the model is never really asked: the
 * calls to it are answered by the test.
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
  GEMINI_EMBEDDING_MODEL: "gemini-embedding-2",
  AI_GLOBAL_DAILY_EMBEDDINGS: "900",
});

const app = createApp(environment);

const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

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

const origin = process.env.WEB_URL ?? "http://localhost:5173";
const suffix = crypto.randomUUID().slice(0, 8);
const password = `Semantic-${suffix}-Aa1`;

async function register(name: string, email: string): Promise<BrowserSession> {
  const { response, payload } = await call("/api/v1/auth/register", { method: "POST", body: { name, email, password } });
  expect(response.status).toBe(201);
  const user = payload.data.user as Record<string, unknown>;
  const userId = String(user.id);
  createdUserIds.push(userId);
  return { cookie: response.headers.getSetCookie()[0]!.split(";")[0]!, csrf: String(payload.data.csrfToken), userId };
}

/** The workspace of the account, which every request is made in. */
async function workspace(session: BrowserSession): Promise<string> {
  const orgs = await call("/api/v1/organizations", { session });
  const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);
  createdOrganizationIds.push(organizationId);
  return organizationId;
}

/**
 * Let the account use the AI features.
 *
 * The address is confirmed and the agreement to send content to the model
 * provider is given, which is what the checks ask for.
 */
async function allowAi(session: BrowserSession): Promise<void> {
  await getDatabase().update(users).set({ emailVerified: true }).where(eq(users.id, session.userId));
  await call("/api/v1/ai/consent", { method: "POST", body: { accepted: true }, session });
}

const realFetch = globalThis.fetch;

/**
 * The calls that were made to the model.
 */
interface ModelCall { url: string; body: Record<string, unknown> }

/**
 * Answer the calls to the model without asking the model.
 */
function mockModel(): ModelCall[] {
  const calls: ModelCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ url: String(input), body });
    return new Response(JSON.stringify({ embedding: { values: [1, 0, 0] } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

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
      model: environment.GEMINI_EMBEDDING_MODEL,
      embedding: [1, 0, 0],
    }));

    /**
     * The question is about the water, so the item about the water comes
     * first.
     */
    const results = await semanticSearch(environment, context, [0.9, 0.1, 0], 20);
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
      model: environment.GEMINI_EMBEDDING_MODEL,
      embedding: [1, 0, 0],
    }));

    const results = await semanticSearch(environment, { userId: second.userId, organizationId: second.organizationId, permissions: new Set<string>() } as TenantContext, [1, 0, 0], 20);
    expect(results.items.length).toBe(0);
  });

  test("an archived item is not found", async () => {
    const { userId, organizationId, vaultId } = await makeWorkspace();
    const context = { userId, organizationId, permissions: new Set<string>() } as TenantContext;

    const [record] = await withTenant(organizationId, (tx) => tx.insert(savedRecords).values({
      organizationId,
      vaultId,
      recordType: "article",
      title: "Put away for later",
      archivedAt: new Date(),
      createdBy: userId,
    }).returning({ id: savedRecords.id }));
    await withTenant(organizationId, (tx) => tx.insert(recordEmbeddings).values({
      organizationId,
      savedRecordId: record!.id,
      model: environment.GEMINI_EMBEDDING_MODEL,
      embedding: [1, 0, 0],
    }));

    const results = await semanticSearch(environment, context, [1, 0, 0], 20);
    expect(results.items.length).toBe(0);
  });

  test("the text of an item is written for the model", () => {
    expect(textForEmbedding("The tides", "A long piece.")).toBe("The tides\nThe tides\nA long piece.");
    expect(textForEmbedding(null, "Only the text.")).toBe("Only the text.");
    expect(textForEmbedding("Only the title", null)).toBe("Only the title\nOnly the title\n");
  });
});

describe("the numbers themselves", () => {
  test("the model that is configured is asked, and the task is said", async () => {
    const calls = mockModel();
    await embedText(environment, "A thing worth keeping", "query");
    await embedText(environment, "A thing worth keeping", "document");

    expect(calls.length).toBe(2);
    expect(calls[0]?.url).toContain(environment.GEMINI_EMBEDDING_MODEL);
    expect(calls[0]?.body.taskType).toBe("RETRIEVAL_QUERY");
    expect(calls[1]?.body.taskType).toBe("RETRIEVAL_DOCUMENT");
    /**
     * A shorter list is a smaller row in the database, and the size is the
     * one the guide of the model recommends.
     */
    expect(calls[0]?.body.outputDimensionality).toBe(768);
  });

  test("a question that is asked twice is only asked once", async () => {
    const session = await register("Cache Admin", `semantic-cache-${suffix}@example.com`);
    const organizationId = await workspace(session);
    await allowAi(session);
    const calls = mockModel();
    /**
     * The question is one of its own, because the answers are kept and a
     * question that was asked before would not reach the model at all.
     */
    const question = `the+tides+of+the+sea+${suffix}`;

    const first = await call(`/api/v1/search/semantic?q=${question}`, { session, organizationId });
    const second = await call(`/api/v1/search/semantic?q=${question}`, { session, organizationId });
    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    /**
     * The second question is answered from the place the first one was
     * kept, so the model is not asked again.
     */
    expect(calls.length).toBe(1);
  });
});

describe("the controls around the search by meaning", () => {
  test("without the agreement the search is closed and the model is not asked", async () => {
    const session = await register("Consent Admin", `semantic-consent-${suffix}@example.com`);
    const organizationId = await workspace(session);
    /**
     * The address is confirmed, so that the agreement is the one thing
     * that is missing.
     */
    await getDatabase().update(users).set({ emailVerified: true }).where(eq(users.id, session.userId));
    const calls = mockModel();

    const result = await call("/api/v1/search/semantic?q=the+sea", { session, organizationId });
    expect(result.response.status).toBe(403);
    expect(result.payload.error?.code).toBe("AI_CONSENT_REQUIRED");
    expect(calls.length).toBe(0);
  });

  test("a capture by somebody who has not agreed is given no numbers", async () => {
    const session = await register("Capture Admin", `semantic-capture-${suffix}@example.com`);
    const organizationId = await workspace(session);
    await getDatabase().update(users).set({ emailVerified: true }).where(eq(users.id, session.userId));
    const calls = mockModel();

    const created = await call("/api/v1/captures", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `capture-${suffix}`,
      body: {
        selectedText: "A piece about the water and the boats that go out on it.",
        source: { url: "https://example.com/sea", title: "The sea", domain: "example.com" },
        captureKind: "selection",
      },
    });
    expect(created.response.status).toBe(201);
    const recordId = String((created.payload.data as { record: { id: string } }).record.id);

    /**
     * The numbers are made after the capture is written down, so the test
     * waits for them rather than expecting them to be there at once.
     */
    await new Promise((resolve) => setTimeout(resolve, 200));
    const rows = await withTenant(organizationId, (tx) => tx
      .select({ id: recordEmbeddings.id })
      .from(recordEmbeddings)
      .where(eq(recordEmbeddings.savedRecordId, recordId)));
    expect(rows.length).toBe(0);
    expect(calls.length).toBe(0);
  });

  test("the search is limited to twenty a minute", async () => {
    const session = await register("Limit Admin", `semantic-limit-${suffix}@example.com`);
    const organizationId = await workspace(session);
    await allowAi(session);
    mockModel();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await call(`/api/v1/search/semantic?q=question+${attempt}`, { session, organizationId });
      expect(result.response.status).toBe(200);
    }
    const last = await call("/api/v1/search/semantic?q=one+too+many", { session, organizationId });
    expect(last.response.status).toBe(429);
    expect(last.payload.error?.code).toBe("RATE_LIMITED");
  });
});
