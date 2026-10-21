import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { getDatabase, organizations, users } from "@data-vault/database";
import { app } from "../src";
import { clearRateLimits } from "./support";

const origin = process.env.WEB_URL ?? "http://localhost:5173";
const suffix = crypto.randomUUID().slice(0, 8);
const password = `Organize-${suffix}-Aa1`;
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
  return { response, payload };
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

/**
 * Two folders, each with a collection of its own.
 */
async function makeFolders(session: BrowserSession, organizationId: string) {
  const folders = await call("/api/v1/vaults", { session, organizationId });
  const list = folders.payload.data as unknown as { id: string; name: string }[];
  const first = list[0]!;
  /**
   * A second folder is made, because a collection belongs to one folder and
   * the test needs one that belongs to another.
   */
  const made = await call("/api/v1/vaults", { method: "POST", session, organizationId, body: { name: "Another folder", slug: `another-${suffix}`, kind: "workspace", color: "#b8a4ed" } });
  const second = { id: String((made.payload.data as { id: string }).id) };
  const collection = await call("/api/v1/collections", { method: "POST", session, organizationId, body: { vaultId: first.id, name: "Reading", color: "#b8a4ed" } });
  const other = await call("/api/v1/collections", { method: "POST", session, organizationId, body: { vaultId: second.id, name: "Elsewhere", color: "#b8a4ed" } });
  return {
    first: first.id,
    second: second.id,
    collectionId: String((collection.payload.data as { id: string }).id),
    otherCollectionId: String((other.payload.data as { id: string }).id),
  };
}

describe("choosing where an item goes", () => {
  test("a capture goes into the collection that was chosen", async () => {
    const session = await register("Capture Admin", `collection-capture-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const { first, collectionId } = await makeFolders(session, organizationId);

    const created = await call("/api/v1/captures", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `collection-capture-${suffix}`,
      body: {
        selectedText: "A piece of a web page worth keeping.",
        source: { url: "https://example.com/one", title: "One", domain: "example.com" },
        vaultId: first,
        collectionIds: [collectionId],
      },
    });
    expect(created.response.status).toBe(201);
    const recordId = String((created.payload.data as { record: { id: string } }).record.id);

    const detail = await call(`/api/v1/saved-records/${recordId}`, { session, organizationId });
    const collections = (detail.payload.data as { collections: { id: string }[] }).collections;
    expect(collections.map((collection) => collection.id)).toEqual([collectionId]);
  }, 30_000);

  test("a collection of another folder is refused", async () => {
    const session = await register("Refuse Admin", `collection-refuse-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const { first, otherCollectionId } = await makeFolders(session, organizationId);

    const created = await call("/api/v1/captures", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `collection-refuse-${suffix}`,
      body: {
        selectedText: "A piece of a web page worth keeping.",
        source: { url: "https://example.com/one", title: "One", domain: "example.com" },
        vaultId: first,
        collectionIds: [otherCollectionId],
      },
    });
    expect(created.response.status).toBe(400);
    expect(created.payload.error?.code).toBe("INVALID_COLLECTION");
  }, 30_000);

  test("an item made by hand goes into the collection that was chosen", async () => {
    const session = await register("Manual Admin", `collection-manual-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const { first, collectionId } = await makeFolders(session, organizationId);

    const created = await call("/api/v1/saved-records", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `collection-manual-${suffix}`,
      body: { recordType: "note", title: "Something worth keeping", vaultId: first, collectionIds: [collectionId] },
    });
    expect(created.response.status).toBe(201);
    const recordId = String((created.payload.data as { id: string }).id);

    const detail = await call(`/api/v1/saved-records/${recordId}`, { session, organizationId });
    const collections = (detail.payload.data as { collections: { id: string }[] }).collections;
    expect(collections.map((collection) => collection.id)).toEqual([collectionId]);
  }, 30_000);
});
