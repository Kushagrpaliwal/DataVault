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
 * Two folders, and a sub-folder inside each of them.
 *
 * The folders are made here rather than taken from the list, because the
 * default folder cannot be removed, and one of the tests removes a folder.
 */
async function makeFolders(session: BrowserSession, organizationId: string) {
  const firstMade = await call("/api/v1/vaults", { method: "POST", session, organizationId, body: { name: "Research", slug: `research-${suffix}`, kind: "workspace", color: "#b8a4ed" } });
  const first = String((firstMade.payload.data as { id: string }).id);
  const made = await call("/api/v1/vaults", { method: "POST", session, organizationId, body: { name: "Another folder", slug: `another-${suffix}`, kind: "workspace", color: "#b8a4ed" } });
  const second = String((made.payload.data as { id: string }).id);
  const inside = await call("/api/v1/vaults", { method: "POST", session, organizationId, body: { name: "Reading", parentId: first, kind: "workspace", color: "#b8a4ed" } });
  const other = await call("/api/v1/vaults", { method: "POST", session, organizationId, body: { name: "Elsewhere", parentId: second, kind: "workspace", color: "#b8a4ed" } });
  return {
    first,
    second,
    subfolderId: String((inside.payload.data as { id: string }).id),
    otherSubfolderId: String((other.payload.data as { id: string }).id),
  };
}

describe("choosing where an item goes", () => {
  test("a capture goes into the sub-folder that was chosen", async () => {
    const session = await register("Capture Admin", `folder-capture-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const { first, subfolderId } = await makeFolders(session, organizationId);

    const created = await call("/api/v1/captures", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `folder-capture-${suffix}`,
      body: {
        selectedText: "A piece of a web page worth keeping.",
        source: { url: "https://example.com/one", title: "One", domain: "example.com" },
        vaultId: subfolderId,
      },
    });
    expect(created.response.status).toBe(201);
    const recordId = String((created.payload.data as { record: { id: string } }).record.id);

    const detail = await call(`/api/v1/saved-records/${recordId}`, { session, organizationId });
    expect((detail.payload.data as { vaultId: string }).vaultId).toBe(subfolderId);
    expect(first).not.toBe(subfolderId);
  }, 30_000);

  test("a sub-folder of another workspace is refused", async () => {
    const session = await register("Refuse Admin", `folder-refuse-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const { subfolderId } = await makeFolders(session, organizationId);

    const other = await register("Other Admin", `folder-other-${suffix}@example.com`);
    const otherOrganizationId = await workspace(other);
    const otherFolders = await call("/api/v1/vaults", { session: other, organizationId: otherOrganizationId });
    const otherFolderId = String((otherFolders.payload.data as unknown as { id: string }[])[0]!.id);

    const made = await call("/api/v1/vaults", { method: "POST", session: other, organizationId: otherOrganizationId, body: { name: "Borrowed", parentId: subfolderId, kind: "workspace", color: "#b8a4ed" } });
    expect(made.response.status).toBe(400);
    expect(made.payload.error?.code).toBe("INVALID_VAULT");
    expect(otherFolderId).not.toBe(subfolderId);
  }, 30_000);

  test("an item made by hand goes into the sub-folder that was chosen", async () => {
    const session = await register("Manual Admin", `folder-manual-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const { subfolderId } = await makeFolders(session, organizationId);

    const created = await call("/api/v1/saved-records", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `folder-manual-${suffix}`,
      body: { recordType: "note", title: "Something worth keeping", vaultId: subfolderId },
    });
    expect(created.response.status).toBe(201);
    const recordId = String((created.payload.data as { id: string }).id);

    const detail = await call(`/api/v1/saved-records/${recordId}`, { session, organizationId });
    expect((detail.payload.data as { vaultId: string }).vaultId).toBe(subfolderId);
  }, 30_000);

  test("a folder shows the items of the folders under it", async () => {
    const session = await register("Tree Admin", `folder-tree-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const { first, subfolderId } = await makeFolders(session, organizationId);

    const created = await call("/api/v1/saved-records", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `folder-tree-${suffix}`,
      body: { recordType: "note", title: "Something worth keeping", vaultId: subfolderId },
    });
    expect(created.response.status).toBe(201);

    const listed = await call(`/api/v1/saved-records?vaultId=${first}`, { session, organizationId });
    const items = (listed.payload.data as { items: { id: string }[] }).items;
    expect(items.length).toBe(1);

    const counted = await call("/api/v1/vaults", { session, organizationId });
    const folders = counted.payload.data as unknown as { id: string; itemCount?: number }[];
    const parent = folders.find((folder) => folder.id === first);
    expect(parent?.itemCount).toBe(1);
  }, 30_000);

  test("removing a folder removes the folders under it", async () => {
    const session = await register("Remove Admin", `folder-remove-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const { first, subfolderId } = await makeFolders(session, organizationId);

    const created = await call("/api/v1/saved-records", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `folder-remove-${suffix}`,
      body: { recordType: "note", title: "Something worth keeping", vaultId: subfolderId },
    });
    expect(created.response.status).toBe(201);

    const removed = await call(`/api/v1/vaults/${first}`, { method: "DELETE", session, organizationId });
    expect(removed.response.status).toBe(200);

    const folders = await call("/api/v1/vaults", { session, organizationId });
    const remaining = (folders.payload.data as unknown as { id: string }[]).map((folder) => folder.id);
    expect(remaining).not.toContain(subfolderId);
    expect(remaining).not.toContain(first);
  }, 30_000);

  test("a tag added to a folder is put on the items of that folder", async () => {
    const session = await register("Tag Admin", `folder-tag-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const { first, subfolderId } = await makeFolders(session, organizationId);

    const created = await call("/api/v1/saved-records", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `folder-tag-${suffix}`,
      body: { recordType: "note", title: "Something worth keeping", vaultId: first },
    });
    expect(created.response.status).toBe(201);
    const recordId = String((created.payload.data as { id: string }).id);

    const tagged = await call(`/api/v1/vaults/${first}/tags`, { method: "POST", session, organizationId, body: { name: "research" } });
    expect(tagged.response.status).toBe(200);

    const detail = await call(`/api/v1/saved-records/${recordId}`, { session, organizationId });
    const tags = (detail.payload.data as { tags: { name: string }[] }).tags;
    expect(tags.map((tag) => tag.name)).toContain("research");

    // Verify folder tags are included in vault list
    const vaultsList = await call("/api/v1/vaults", { session, organizationId });
    const folderWithTag = (vaultsList.payload.data as unknown as { id: string; tags: { id: string; name: string }[] }[]).find((f) => f.id === first);
    expect(folderWithTag?.tags.map((t) => t.name)).toContain("research");

    // Verify tagging an empty subfolder works and appears in listTags
    const subfolderTagged = await call(`/api/v1/vaults/${subfolderId}/tags`, { method: "POST", session, organizationId, body: { name: "subtag" } });
    expect(subfolderTagged.response.status).toBe(200);
    const subfolderTags = await call(`/api/v1/tags?vaultId=${subfolderId}`, { session, organizationId });
    expect(subfolderTags.response.status).toBe(200);
    const subfolderTagNames = (subfolderTags.payload.data as unknown as { name: string }[]).map((t) => t.name);
    expect(subfolderTagNames).toContain("subtag");

    // Verify untagging the subfolder
    const subTagId = (subfolderTagged.payload.data as { id: string }).id;
    const untagged = await call(`/api/v1/vaults/${subfolderId}/tags/${subTagId}`, { method: "DELETE", session, organizationId });
    expect(untagged.response.status).toBe(200);
    const subfolderTagsAfter = await call(`/api/v1/tags?vaultId=${subfolderId}`, { session, organizationId });
    expect((subfolderTagsAfter.payload.data as unknown as { name: string }[]).map((t) => t.name)).not.toContain("subtag");
  }, 30_000);
});
