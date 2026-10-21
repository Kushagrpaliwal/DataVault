import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { getDatabase, organizations, users } from "@data-vault/database";
import { app } from "../src";
import { parseBookmarks, parseUrlList } from "../src/services/imports";
import { clearRateLimits } from "./support";

const origin = process.env.WEB_URL ?? "http://localhost:5173";
const suffix = crypto.randomUUID().slice(0, 8);
const password = `Import-${suffix}-Aa1`;
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

async function register(name: string, email: string): Promise<BrowserSession> {
  const { response, payload } = await call("/api/v1/auth/register", { method: "POST", body: { name, email, password } });
  expect(response.status).toBe(201);
  const user = payload.data.user as Record<string, unknown>;
  const userId = String(user.id);
  createdUserIds.push(userId);
  return { cookie: response.headers.getSetCookie()[0]!.split(";")[0]!, csrf: String(payload.data.csrfToken), userId };
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

const bookmarks = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1600000000">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com/one" ADD_DATE="1600000000">The first one</A>
        <DT><H3 ADD_DATE="1600000000">Reading</H3>
        <DL><p>
            <DT><A HREF="https://example.com/two" ADD_DATE="1600000000">The second one &amp; more</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://example.com/three">A link with no folder</A>
</DL><p>`;

describe("bringing material in", () => {
  test("the items of a bookmarks file are read, with the folders they were in", () => {
    const items = parseBookmarks(bookmarks);
    expect(items.length).toBe(3);
    expect(items[0]).toEqual({ title: "The first one", url: "https://example.com/one", folder: "Bookmarks bar" });
    expect(items[1]?.title).toBe("The second one & more");
    expect(items[1]?.folder).toBe("Bookmarks bar/Reading");
    expect(items[2]?.folder).toBeUndefined();
  });

  test("a list of addresses is read", () => {
    const items = parseUrlList([
      "https://example.com/one",
      "A title | https://example.com/two",
      "",
      "# a comment",
      "not an address",
    ].join("\n"));
    expect(items.length).toBe(2);
    expect(items[0]?.title).toBe("https://example.com/one");
    expect(items[1]).toEqual({ title: "A title", url: "https://example.com/two" });
  });

  test("a bookmarks file is brought into a folder of its own", async () => {
    const session = await register("Import Admin", `import-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);
    createdOrganizationIds.push(organizationId);

    const result = await call("/api/v1/imports", {
      method: "POST",
      session,
      organizationId,
      body: { kind: "bookmarks", content: bookmarks, name: "My old bookmarks" },
    });
    expect(result.response.status).toBe(201);
    expect((result.payload.data as { imported: number }).imported).toBe(3);

    /**
     * The items are in a folder of their own, and the folder they came
     * from became a collection.
     */
    const folders = await call("/api/v1/vaults", { session, organizationId });
    const folders_ = folders.payload.data as unknown as { id: string; name: string }[];
    const imported = folders_.find((folder) => folder.name === "My old bookmarks");
    expect(imported).toBeTruthy();

    const items = await call(`/api/v1/saved-records?vaultId=${imported!.id}`, { session, organizationId });
    expect((items.payload.data as { total: number }).total).toBe(3);

    const collections = await call(`/api/v1/vaults/${imported!.id}/collections`, { session, organizationId });
    expect((collections.payload.data as unknown as unknown[]).length).toBe(2);
  }, 30_000);

  test("the whole workspace can be taken out as one file", async () => {
    const session = await register("Export Admin", `export-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);
    createdOrganizationIds.push(organizationId);

    await call("/api/v1/saved-records", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `export-${suffix}`,
      body: { recordType: "note", title: "Something worth keeping" },
    });

    const exported = await call("/api/v1/export", { session, organizationId });
    expect(exported.response.status).toBe(200);
    expect(exported.response.headers.get("content-disposition")).toContain("attachment");
    const data = JSON.parse(exported.text) as { version: number; items: { title: string }[]; folders: unknown[]; docs: unknown[] };
    expect(data.version).toBe(1);
    expect(data.items.some((item) => item.title === "Something worth keeping")).toBe(true);
    expect(Array.isArray(data.folders)).toBe(true);
    expect(Array.isArray(data.docs)).toBe(true);
  }, 30_000);
});
