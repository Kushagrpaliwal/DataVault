import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { unzipSync } from "fflate";
import { getDatabase, organizations, users } from "@data-vault/database";
import { app } from "../src";
import { normalizeUrl, parseBookmarks, parseCsv, parseCsvItems, parseUrlList } from "../src/services/imports";
import { clearRateLimits } from "./support";

const origin = process.env.WEB_URL ?? "http://localhost:5173";
const suffix = crypto.randomUUID().slice(0, 8);
const password = `Import-${suffix}-Aa1`;
const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

type Envelope<T = Record<string, unknown>> = { success: boolean; data: T; error?: { code: string; message: string } };
interface BrowserSession { cookie: string; csrf: string; userId: string }

async function call(path: string, options: { method?: string; body?: unknown; session?: BrowserSession; organizationId?: string; idempotencyKey?: string; form?: FormData } = {}) {
  const headers = new Headers({ origin });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  /**
   * The boundary of a form is written by the request itself, so the type
   * is left alone when there is a form.
   */
  if (options.session) { headers.set("cookie", options.session.cookie); headers.set("x-csrf-token", options.session.csrf); }
  if (options.organizationId) headers.set("x-organization-id", options.organizationId);
  if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
  const response = await app.handle(new Request(`http://localhost:3000${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.form ? { body: options.form } : options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }));
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

/** The workspace of the account, which every request is made in. */
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

/**
 * The file Pocket writes.
 */
const pocketCsv = `title,url,time_added,tags,status
The first one,https://example.com/pocket-one,1600000000,"news, research",unread
The second one,https://example.com/pocket-two,1600000100,archive,archive`;

/**
 * The file Raindrop writes.
 */
const raindropCsv = `title,url,folder,tags,created,note,excerpt
A raindrop,https://example.com/raindrop-one,Reading/Long,"books",2023-04-05T10:00:00Z,A note about it,An excerpt of it`;

/**
 * The file Instapaper writes.
 */
const instapaperCsv = `URL,Title,Selection,Folder,Timestamp
https://example.com/instapaper-one,An instapaper,The selected words,Later,2023-05-06T11:30:00Z`;

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

  test("a comma-separated file is read, quotes and all", () => {
    const rows = parseCsv('one,two,three\r\n"a, with a comma","a ""quoted"" word",plain');
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual(["one", "two", "three"]);
    expect(rows[1]).toEqual(["a, with a comma", 'a "quoted" word', "plain"]);
  });

  test("the file of Pocket, Raindrop and Instapaper is read", () => {
    const pocket = parseCsvItems(pocketCsv);
    expect(pocket.length).toBe(2);
    expect(pocket[0]?.title).toBe("The first one");
    expect(pocket[0]?.url).toBe("https://example.com/pocket-one");
    expect(pocket[0]?.tags).toEqual(["news", "research"]);
    /**
     * An item that was archived in Pocket has been dealt with, so it does
     * not land in the review queue.
     */
    expect(pocket[1]?.reviewStatus).toBe("reviewed");

    const raindrop = parseCsvItems(raindropCsv);
    expect(raindrop.length).toBe(1);
    expect(raindrop[0]?.title).toBe("A raindrop");
    expect(raindrop[0]?.folder).toBe("Reading/Long");
    expect(raindrop[0]?.tags).toEqual(["books"]);
    expect(raindrop[0]?.text).toBe("A note about it");

    const instapaper = parseCsvItems(instapaperCsv);
    expect(instapaper.length).toBe(1);
    expect(instapaper[0]?.title).toBe("An instapaper");
    expect(instapaper[0]?.url).toBe("https://example.com/instapaper-one");
    expect(instapaper[0]?.text).toBe("The selected words");
    expect(instapaper[0]?.folder).toBe("Later");
  });

  test("an address is written in one shape, so that the same page is the same address", () => {
    expect(normalizeUrl("https://Example.COM/one?utm_source=news&id=4#part")).toBe("https://example.com/one?id=4");
    expect(normalizeUrl("https://example.com/one")).toBe(normalizeUrl("https://example.com/one?utm_medium=mail"));
  });

  test("a bookmarks file is brought into a folder of its own", async () => {
    const session = await register("Import Admin", `import-${suffix}@example.com`);
    const organizationId = await workspace(session);

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

  test("a file of Pocket or Raindrop brings the tags and the folders with it", async () => {
    const session = await register("Csv Admin", `csv-${suffix}@example.com`);
    const organizationId = await workspace(session);

    /**
     * Each service writes a file of its own, with a header of its own, so
     * each one is brought in on its own.
     */
    const pocket = await call("/api/v1/imports", {
      method: "POST",
      session,
      organizationId,
      body: { kind: "csv", content: pocketCsv, name: "From Pocket" },
    });
    expect(pocket.response.status).toBe(201);
    expect((pocket.payload.data as { imported: number }).imported).toBe(2);

    const raindrop = await call("/api/v1/imports", {
      method: "POST",
      session,
      organizationId,
      body: { kind: "csv", content: raindropCsv, name: "From Raindrop" },
    });
    expect(raindrop.response.status).toBe(201);
    expect((raindrop.payload.data as { imported: number }).imported).toBe(1);

    const instapaper = await call("/api/v1/imports", {
      method: "POST",
      session,
      organizationId,
      body: { kind: "csv", content: instapaperCsv, name: "From Instapaper" },
    });
    expect(instapaper.response.status).toBe(201);
    const items = instapaper.payload.data as { imported: number; skipped: number; items: { title: string; url: string }[] };
    expect(items.imported).toBe(1);
    expect(items.items[0]?.title).toBe("An instapaper");
    expect(items.items[0]?.url).toBe("https://example.com/instapaper-one");

    const folders = await call("/api/v1/vaults", { session, organizationId });
    const folders_ = folders.payload.data as unknown as { id: string; name: string }[];
    const raindropFolder = folders_.find((entry) => entry.name === "From Raindrop");
    const instapaperFolder = folders_.find((entry) => entry.name === "From Instapaper");
    expect(raindropFolder).toBeTruthy();
    expect(instapaperFolder).toBeTruthy();

    /**
     * The folder the file had became a collection.
     */
    const raindropCollections = await call(`/api/v1/vaults/${raindropFolder!.id}/collections`, { session, organizationId });
    expect((raindropCollections.payload.data as unknown as { name: string }[]).map((collection) => collection.name)).toContain("Long");
    const instapaperCollections = await call(`/api/v1/vaults/${instapaperFolder!.id}/collections`, { session, organizationId });
    expect((instapaperCollections.payload.data as unknown as { name: string }[]).map((collection) => collection.name)).toContain("Later");

    /**
     * The tags of the file are tags.
     */
    const tags = await call("/api/v1/tags", { session, organizationId });
    const tagNames = (tags.payload.data as unknown as { name: string }[]).map((tag) => tag.name);
    expect(tagNames).toContain("research");
    expect(tagNames).toContain("books");
  }, 30_000);

  test("an item that is already saved, or that is in the file twice, is skipped", async () => {
    const session = await register("Duplicate Admin", `duplicate-${suffix}@example.com`);
    const organizationId = await workspace(session);

    const saved = await call("/api/v1/saved-records", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `duplicate-${suffix}`,
      body: { recordType: "bookmark", title: "Already here", source: { url: "https://example.com/one", title: "Already here", domain: "example.com" } },
    });
    expect(saved.response.status).toBe(201);

    const result = await call("/api/v1/imports", {
      method: "POST",
      session,
      organizationId,
      body: { kind: "urls", content: ["https://example.com/one", "https://example.com/two", "https://example.com/two"].join("\n"), name: "Duplicates" },
    });
    expect(result.response.status).toBe(201);
    const imported = result.payload.data as { imported: number; skipped: number };
    /**
     * One was already saved and one was in the file twice, so only the
     * other one is brought in.
     */
    expect(imported.imported).toBe(1);
    expect(imported.skipped).toBe(2);
  }, 30_000);

  test("an import cannot put its items into a folder of another workspace", async () => {
    const session = await register("Cross Admin", `cross-${suffix}@example.com`);
    const organizationId = await workspace(session);
    const other = await register("Other Admin", `other-${suffix}@example.com`);
    const otherOrganizationId = await workspace(other);

    const folders = await call("/api/v1/vaults", { session: other, organizationId: otherOrganizationId });
    const folder = (folders.payload.data as unknown as { id: string }[])[0]!;

    const result = await call("/api/v1/imports", {
      method: "POST",
      session,
      organizationId,
      body: { kind: "urls", content: "https://example.com/one", vaultId: folder.id },
    });
    expect(result.response.status).toBe(404);
    expect(result.payload.error?.code).toBe("NOT_FOUND");
  }, 30_000);

  test("the whole workspace can be taken out as one file", async () => {
    const session = await register("Export Admin", `export-${suffix}@example.com`);
    const organizationId = await workspace(session);

    const record = await call("/api/v1/saved-records", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `export-${suffix}`,
      body: { recordType: "note", title: "Something worth keeping" },
    });
    expect(record.response.status).toBe(201);
    const recordId = String((record.payload.data as { id: string }).id);

    const second = await call("/api/v1/saved-records", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `export-second-${suffix}`,
      body: { recordType: "bookmark", title: "Another thing worth keeping", source: { url: "https://example.com/one", title: "Another thing worth keeping", domain: "example.com" } },
    });
    expect(second.response.status).toBe(201);

    const doc = await call("/api/v1/notes", {
      method: "POST",
      session,
      organizationId,
      idempotencyKey: `export-note-${suffix}`,
      body: {
        title: "A doc worth keeping",
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The words of the doc." }] }] },
      },
    });
    expect(doc.response.status).toBe(201);

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3, 4])], "shot.png", { type: "image/png" }));
    const attachment = await call(`/api/v1/saved-records/${recordId}/attachments`, { method: "POST", session, organizationId, form });
    expect(attachment.response.status).toBe(201);

    const exported = await app.handle(new Request("http://localhost:3000/api/v1/export", {
      headers: (() => {
        const headers = new Headers({ origin });
        headers.set("cookie", session.cookie);
        headers.set("x-organization-id", organizationId);
        return headers;
      })(),
    }));
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("application/zip");
    expect(exported.headers.get("content-disposition")).toContain("attachment");

    const files = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    const names = Object.keys(files);
    expect(names).toContain("datavault.json");
    expect(names).toContain("docs/a-doc-worth-keeping.md");
    expect(names.some((name) => name.startsWith("attachments/") && name.endsWith("-shot.png"))).toBe(true);

    const json = JSON.parse(new TextDecoder().decode(files["datavault.json"]!)) as { version: number; items: { title: string }[]; folders: unknown[]; docs: { title: string }[] };
    expect(json.version).toBe(2);
    expect(json.items.some((item) => item.title === "Something worth keeping")).toBe(true);
    expect(json.docs.some((entry) => entry.title === "A doc worth keeping")).toBe(true);
    expect(Array.isArray(json.folders)).toBe(true);
    /**
     * The counts are the ones the workspace really has.
     */
    const listed = await call("/api/v1/saved-records", { session, organizationId });
    expect(json.items.length).toBe((listed.payload.data as { total: number }).total);
    expect(json.items.length).toBe(2);

    const markdown = new TextDecoder().decode(files["docs/a-doc-worth-keeping.md"]!);
    expect(markdown).toContain("The words of the doc.");
  }, 30_000);
});
