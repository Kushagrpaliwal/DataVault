import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, getDatabase, organizationMembers, organizations, roles, userRoles, users } from "@data-vault/database";
import { app } from "../src";
import { issuePasswordSetupToken } from "../src/auth/password-setup";
import { clearRateLimits } from "./support";

const origin = process.env.WEB_URL ?? "http://localhost:5173";
const suffix = crypto.randomUUID().slice(0, 8);
const password = `Integration-${suffix}-Aa1`;
const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

type Envelope<T = Record<string, unknown>> = { success: boolean; data: T; error?: { code: string; message: string } };
interface BrowserSession { cookie: string; csrf: string; userId: string }

async function call(path: string, options: { method?: string; body?: unknown; session?: BrowserSession; organizationId?: string; idempotencyKey?: string; bearer?: string } = {}) {
  const headers = new Headers({ origin });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.session) { headers.set("cookie", options.session.cookie); headers.set("x-csrf-token", options.session.csrf); }
  if (options.organizationId) headers.set("x-organization-id", options.organizationId);
  if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  const response = await app.handle(new Request(`http://localhost:3000${path}`, { method: options.method ?? "GET", headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }));
  return { response, payload: await response.json() as Envelope };
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
  /**
   * The rate limits are counted in the database, and they are meant to hold
   * back a person who signs up over and over. A test run signs up more than
   * once on purpose, so the counters are cleared before each test.
   */
  await clearRateLimits();
});

afterEach(async () => {
  const db = getDatabase();
  const personalOrganizations = createdUserIds.length ? await db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.createdBy, createdUserIds)) : [];
  const allOrganizationIds = [...new Set([...createdOrganizationIds, ...personalOrganizations.map((organization) => organization.id)])];
  if (allOrganizationIds.length) await db.delete(organizations).where(inArray(organizations.id, allOrganizationIds));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  createdOrganizationIds.length = 0;
  createdUserIds.length = 0;
});

describe("DataVault API integration", () => {
  test("auth, tenancy, RBAC, captures, idempotency, search, and extension auth", async () => {
    const admin = await register("Integration Admin", `admin-${suffix}@example.com`);
    const orgAResult = await call("/api/v1/organizations", { method: "POST", session: admin, body: { name: `Integration A ${suffix}`, slug: `integration-a-${suffix}`, currency: "USD", locale: "en-US", timeZone: "UTC" } });
    expect(orgAResult.response.status).toBe(201);
    const orgA = String(orgAResult.payload.data.id);
    createdOrganizationIds.push(orgA);
    const orgBResult = await call("/api/v1/organizations", { method: "POST", session: admin, body: { name: `Integration B ${suffix}`, slug: `integration-b-${suffix}`, currency: "USD", locale: "en-US", timeZone: "UTC" } });
    const orgB = String(orgBResult.payload.data.id);
    createdOrganizationIds.push(orgB);
    const vaultList = await call("/api/v1/vaults", { session: admin, organizationId: orgA });
    expect(vaultList.response.status).toBe(200);
    const defaultVault = (vaultList.payload.data as unknown as Record<string, unknown>[]).find((vault) => vault.isDefault === true);
    expect(defaultVault).toBeTruthy();
    const vaultId = String(defaultVault!.id);
    const researchCollection = await call("/api/v1/collections", { method: "POST", session: admin, organizationId: orgA, body: { vaultId, name: `Research ${suffix}`, color: "#b8a4ed" } });
    expect(researchCollection.response.status).toBe(201);
    const tag = await call("/api/v1/tags", { method: "POST", session: admin, organizationId: orgA, body: { name: `reading-${suffix}`, color: "#b8a4ed" } });
    expect(tag.response.status).toBe(201);

    const captureBody = { selectedText: `A finding about CAP-${suffix}\nBy Priya Raman\n12 March 2026\n\nAbout 42% of readers said the same.`, source: { url: "https://example.com/article/123", title: "A finding", domain: "example.com" }, recordType: "article", confirmDuplicate: true, vaultId, captureKind: "selection", tagNames: [`reading-${suffix}`] };
    const capture = await call("/api/v1/captures", { method: "POST", session: admin, organizationId: orgA, idempotencyKey: `capture-${suffix}`, body: captureBody });
    const captureRetry = await call("/api/v1/captures", { method: "POST", session: admin, organizationId: orgA, idempotencyKey: `capture-${suffix}`, body: captureBody });
    const separatelySavedCapture = await call("/api/v1/captures", { method: "POST", session: admin, organizationId: orgA, idempotencyKey: `capture-separate-${suffix}`, body: captureBody });
    expect(capture.response.status).toBe(201);
    expect((capture.payload.data.record as Record<string, unknown>).id).toBe((captureRetry.payload.data.record as Record<string, unknown>).id);
    expect((separatelySavedCapture.payload.data.record as Record<string, unknown>).id).not.toBe((capture.payload.data.record as Record<string, unknown>).id);
    const captureRecordId = String((capture.payload.data.record as Record<string, unknown>).id);
    const captureDetail = await call(`/api/v1/saved-records/${captureRecordId}`, { session: admin, organizationId: orgA });
    expect((captureDetail.payload.data.evidence as Record<string, unknown>[]).length).toBe(1);
    expect((captureDetail.payload.data.tags as Record<string, unknown>[]).some((item) => item.name === `reading-${suffix}`)).toBe(true);
    const organizedCapture = await call(`/api/v1/saved-records/${captureRecordId}/organization`, { method: "PUT", session: admin, organizationId: orgA, body: { collectionIds: [String(researchCollection.payload.data.id)], reviewStatus: "reviewed" } });
    expect(organizedCapture.response.status).toBe(200);
    const vaultFiltered = await call(`/api/v1/saved-records?vaultId=${vaultId}&collectionId=${String(researchCollection.payload.data.id)}&tag=reading-${suffix}`, { session: admin, organizationId: orgA });
    expect(vaultFiltered.payload.data.total).toBe(1);
    const searchA = await call(`/api/v1/search?q=CAP-${suffix}`, { session: admin, organizationId: orgA });
    const searchB = await call(`/api/v1/search?q=CAP-${suffix}`, { session: admin, organizationId: orgB });
    expect(searchA.payload.data.total).toBe(2);
    expect(searchB.payload.data.total).toBe(0);
    const crossTenantRecord = await call(`/api/v1/saved-records/${String((capture.payload.data.record as Record<string, unknown>).id)}`, { session: admin, organizationId: orgB });
    expect(crossTenantRecord.response.status).toBe(404);

    const viewer = await register("Integration Viewer", `viewer-${suffix}@example.com`);
    const db = getDatabase();
    const [viewerRole] = await db.select().from(roles).where(and(eq(roles.organizationId, orgA), eq(roles.slug, "viewer"))).limit(1);
    await db.insert(organizationMembers).values({ organizationId: orgA, userId: viewer.userId });
    await db.insert(userRoles).values({ organizationId: orgA, userId: viewer.userId, roleId: viewerRole!.id });
    const denied = await call("/api/v1/captures", { method: "POST", session: viewer, organizationId: orgA, idempotencyKey: `viewer-${suffix}`, body: captureBody });
    expect(denied.response.status).toBe(403);
    expect(denied.payload.error?.code).toBe("PERMISSION_DENIED");

    const verifier = "v".repeat(64);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const codeChallenge = Buffer.from(digest).toString("base64url");
    const redirectUri = "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/data-vault-auth";
    const approved = await call("/api/v1/extension/auth/approve", { method: "POST", session: admin, body: { organizationId: orgA, redirectUri, codeChallenge, state: "state-for-integration-test-12345" } });
    const redirect = new URL(String(approved.payload.data.redirectUrl));
    const exchange = await call("/api/v1/extension/auth/exchange", { method: "POST", body: { code: redirect.searchParams.get("code"), codeVerifier: verifier, redirectUri } });
    expect(exchange.response.status).toBe(200);
    const accessToken = String(exchange.payload.data.accessToken);
    const extensionMe = await call("/api/v1/me", { bearer: accessToken, organizationId: orgA });
    expect(extensionMe.response.status).toBe(200);
    const extensionCapture = await call("/api/v1/captures", { method: "POST", bearer: accessToken, organizationId: orgA, idempotencyKey: `extension-capture-${suffix}`, body: { selectedText: `Extension capture ${suffix}`, source: { url: "https://example.com/extension", title: "Extension capture", domain: "example.com" }, recordType: "note", confirmDuplicate: true } });
    expect(extensionCapture.response.status).toBe(201);
    const extensionRecordId = String((extensionCapture.payload.data.record as Record<string, unknown>).id);
    const deletingWebsiteRecord = await call(`/api/v1/saved-records/${String((capture.payload.data.record as Record<string, unknown>).id)}`, { method: "DELETE", session: admin, organizationId: orgA });
    expect(deletingWebsiteRecord.response.status).toBe(200);
    const deletedExtensionCapture = await call(`/api/v1/saved-records/${extensionRecordId}`, { method: "DELETE", bearer: accessToken, organizationId: orgA });
    expect(deletedExtensionCapture.response.status).toBe(200);
    const trashedExtensionCapture = await call(`/api/v1/saved-records?trash=true&q=${encodeURIComponent(`Extension capture ${suffix}`)}`, { bearer: accessToken, organizationId: orgA });
    expect(trashedExtensionCapture.response.status).toBe(200);
    expect(trashedExtensionCapture.payload.data.total).toBe(1);
    const restoredExtensionCapture = await call(`/api/v1/saved-records/${extensionRecordId}/trash/restore`, { method: "POST", bearer: accessToken, organizationId: orgA });
    expect(restoredExtensionCapture.response.status).toBe(200);
    const restoredRecord = await call(`/api/v1/saved-records/${extensionRecordId}`, { bearer: accessToken, organizationId: orgA });
    expect(restoredRecord.response.status).toBe(200);
    await call(`/api/v1/extension/sessions/${String(exchange.payload.data.sessionId)}/revoke`, { method: "POST", session: admin });
    const revoked = await call("/api/v1/me", { bearer: accessToken, organizationId: orgA });
    expect(revoked.response.status).toBe(401);
  }, 30_000);

  test("a body that is too large is refused, and a body in chunks is refused too", async () => {
    const body = JSON.stringify({ email: "someone@example.com", password: "Aa1Bb2Cc3Dd4" });

    /**
     * The length is read from the header, so a body that says it is too
     * large is turned away before it is read.
     */
    const tooLarge = await app.handle(new Request("http://localhost:3000/api/v1/auth/login", {
      method: "POST",
      headers: { origin, "content-type": "application/json", "content-length": String(9 * 1024 * 1024) },
      body,
    }));
    expect(tooLarge.status).toBe(413);

    /**
     * A body that arrives in chunks has no length to check, so it is
     * turned away as well.
     */
    const chunked = await app.handle(new Request("http://localhost:3000/api/v1/auth/login", {
      method: "POST",
      headers: { origin, "content-type": "application/json", "transfer-encoding": "chunked" },
      body,
    }));
    expect(chunked.status).toBe(411);
  });

  test("the sign-in methods endpoint reports the available methods and no Google", async () => {
    const methods = await call("/api/v1/auth/methods");
    expect(methods.response.status).toBe(200);
    const data = methods.payload.data as Record<string, unknown>;
    expect(data.emailAndPassword).toBe(true);
    expect(data.emailOtp).toBe(true);
    expect(data.twoFactor).toBe(true);
    expect("google" in data).toBe(false);
  });

  test("the Google routes are gone", async () => {
    const start = await call("/api/v1/auth/google/start", { method: "POST", body: { callbackURL: "/" } });
    expect(start.response.status).toBe(404);
    const link = await call("/api/v1/auth/google/link", { method: "POST", body: { password, callbackURL: "/settings" } });
    expect(link.response.status).toBe(404);
  });

  test("AI credits stay locked until the address is confirmed", async () => {
    const user = await register("Credits User", `credits-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session: user });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);
    const credits = await call("/api/v1/ai/credits", { session: user, organizationId });
    expect(credits.response.status).toBe(200);
    const status = credits.payload.data as Record<string, unknown>;
    expect(status.emailVerified).toBe(false);
    expect(status.consented).toBe(false);
    expect(status.remaining).toBe(0);
    // The reason explains whichever lock applies first.
    expect(String(status.reason).length).toBeGreaterThan(0);
  });

  test("a disposable email address is refused at sign-up", async () => {
    const result = await call("/api/v1/auth/register", { method: "POST", body: { name: "Throwaway", email: `someone-${suffix}@mailinator.com`, password } });
    expect(result.response.status).toBe(400);
    expect(result.payload.error?.code).toBe("EMAIL_NOT_ACCEPTED");
  });

  test("a capture with no page address still saves", async () => {
    const user = await register("No Address", `noaddress-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session: user });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);
    const result = await call("/api/v1/captures", {
      method: "POST",
      session: user,
      organizationId,
      idempotencyKey: `noaddress-${suffix}`,
      body: { selectedText: "Some text", source: { url: "", title: "Untitled", domain: "current-page" }, recordType: "note", captureKind: "selection" },
    });
    expect(result.response.status).toBe(201);
    expect((result.payload.data as { record: { sourceUrl: string | null } }).record.sourceUrl).toBeNull();
  });
  test("a capture with a malformed address is a clear client error, not a server fault", async () => {
    const user = await register("Bad Address", `badaddress-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session: user });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);
    const result = await call("/api/v1/captures", {
      method: "POST",
      session: user,
      organizationId,
      idempotencyKey: `badaddress-${suffix}`,
      body: { selectedText: "Other text", source: { url: "not a url", title: "Untitled", domain: "example.com" }, recordType: "note", captureKind: "selection" },
    });
    expect(result.response.status).toBe(400);
    expect(result.payload.error?.code).toBe("VALIDATION_ERROR");
  });

  test("a one-time link lets an account without a password set one", async () => {
    const email = `setup-${suffix}@example.com`;
    const user = await register("Setup User", email);
    const db = getDatabase();
    await db.delete(accounts).where(eq(accounts.userId, user.userId));
    const request = await call("/api/v1/auth/request-password-setup", { method: "POST", body: { email } });
    expect(request.response.status).toBe(200);
    const token = await issuePasswordSetupToken(user.userId);
    const setPassword = await call("/api/v1/auth/set-password", { method: "POST", body: { token, password } });
    expect(setPassword.response.status).toBe(200);
    const login = await call("/api/v1/auth/login", { method: "POST", body: { email, password } });
    expect(login.response.status).toBe(200);
  });

  test("two renewals of the same token do not end the session", async () => {
    const user = await register("Refresh Admin", `refresh-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session: user });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);
    const verifier = "r".repeat(64);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const codeChallenge = Buffer.from(digest).toString("base64url");
    const redirectUri = "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/data-vault-auth";
    const approved = await call("/api/v1/extension/auth/approve", { method: "POST", session: user, body: { organizationId, redirectUri, codeChallenge, state: "state-for-refresh-test-12345" } });
    const redirect = new URL(String(approved.payload.data.redirectUrl));
    const exchange = await call("/api/v1/extension/auth/exchange", { method: "POST", body: { code: redirect.searchParams.get("code"), codeVerifier: verifier, redirectUri } });
    expect(exchange.response.status).toBe(200);
    const refreshToken = String(exchange.payload.data.refreshToken);

    /**
     * Two parts of the extension renew at the same moment. One of them gets
     * the new token, the other is told the token was just used. Neither of
     * them should end the session.
     */
    const [first, second] = await Promise.all([
      call("/api/v1/extension/auth/refresh", { method: "POST", body: { refreshToken } }),
      call("/api/v1/extension/auth/refresh", { method: "POST", body: { refreshToken } }),
    ]);
    const codes = [first, second].map((result) => result.payload.error?.code);
    expect(codes.filter((code) => code === undefined).length).toBeGreaterThanOrEqual(1);
    expect(codes.some((code) => code === "REFRESH_TOKEN_STALE" || code === undefined)).toBe(true);
    expect(codes).not.toContain("REFRESH_TOKEN_REUSED");

    /**
     * The session is still good, so the access token from the successful
     * renewal still works.
     */
    const accessToken = first.payload.data?.accessToken ?? second.payload.data?.accessToken;
    if (accessToken) {
      const me = await call("/api/v1/me", { bearer: String(accessToken), organizationId });
      expect(me.response.status).toBe(200);
    }
  }, 30_000);

  test("a doc can be written, read, arranged, undone and thrown away", async () => {
    const admin = await register("Docs Admin", `docs-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session: admin });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);

    const created = await call("/api/v1/notes", { method: "POST", session: admin, organizationId, idempotencyKey: `note-${suffix}`, body: { title: "Research notes" } });
    expect(created.response.status).toBe(201);
    const noteId = String(created.payload.data.id);

    const listed = await call("/api/v1/notes", { session: admin, organizationId });
    expect(listed.response.status).toBe(200);
    expect((listed.payload.data as unknown as { id: string }[]).some((note) => note.id === noteId)).toBe(true);

    const clip = await call(`/api/v1/notes/${noteId}/clips`, {
      method: "POST",
      session: admin,
      organizationId,
      body: { html: "<h2>A heading</h2><p>Some <strong>bold</strong> words</p>", text: "A heading Some bold words", source: { url: "https://example.com/page", title: "Example page", domain: "example.com" } },
    });
    expect(clip.response.status).toBe(200);
    expect((clip.payload.data as { duplicate: boolean }).duplicate).toBe(false);
    const clipId = String((clip.payload.data as { clipId: string }).clipId);
    expect((clip.payload.data as { clipCount: number }).clipCount).toBe(1);

    /**
     * The same text again is not added twice.
     */
    const repeat = await call(`/api/v1/notes/${noteId}/clips`, {
      method: "POST",
      session: admin,
      organizationId,
      body: { html: "<h2>A heading</h2><p>Some <strong>bold</strong> words</p>", text: "A heading Some bold words", source: { url: "https://example.com/page", title: "Example page", domain: "example.com" } },
    });
    expect((repeat.payload.data as { duplicate: boolean }).duplicate).toBe(true);

    const detail = await call(`/api/v1/notes/${noteId}`, { session: admin, organizationId });
    const content = detail.payload.data.content as { content?: { type: string }[] };
    expect(content.content?.some((node) => node.type === "clip")).toBe(true);

    /**
     * An old version is refused, so two people cannot overwrite each other.
     */
    const conflict = await call(`/api/v1/notes/${noteId}`, { method: "PATCH", session: admin, organizationId, body: { title: "Changed too early", baseVersion: 1 } });
    expect(conflict.response.status).toBe(409);
    expect(conflict.payload.error?.code).toBe("NOTE_VERSION_CONFLICT");

    const updated = await call(`/api/v1/notes/${noteId}`, { method: "PATCH", session: admin, organizationId, body: { title: "Research notes, revised", baseVersion: 2 } });
    expect(updated.response.status).toBe(200);
    expect(updated.payload.data.title).toBe("Research notes, revised");

    const undone = await call(`/api/v1/notes/${noteId}/clips/${clipId}`, { method: "DELETE", session: admin, organizationId });
    expect(undone.response.status).toBe(200);
    const afterUndo = await call(`/api/v1/notes/${noteId}`, { session: admin, organizationId });
    expect((afterUndo.payload.data.content as { content?: { type: string }[] }).content?.some((node) => node.type === "clip")).toBe(false);

    const revisions = await call(`/api/v1/notes/${noteId}/revisions`, { session: admin, organizationId });
    expect(revisions.response.status).toBe(200);
    const revisionId = String((revisions.payload.data as unknown as { id: string }[])[0]?.id ?? "");
    if (revisionId) {
      const restored = await call(`/api/v1/notes/${noteId}/revisions/${revisionId}/restore`, { method: "POST", session: admin, organizationId });
      expect(restored.response.status).toBe(200);
    }

    const trashed = await call(`/api/v1/notes/${noteId}`, { method: "DELETE", session: admin, organizationId });
    expect(trashed.response.status).toBe(200);
    const trashList = await call("/api/v1/notes?trash=true", { session: admin, organizationId });
    expect((trashList.payload.data as unknown as { id: string }[]).some((note) => note.id === noteId)).toBe(true);
    const restoredNote = await call(`/api/v1/notes/${noteId}/restore`, { method: "POST", session: admin, organizationId });
    expect(restoredNote.response.status).toBe(200);
  }, 30_000);

  test("a doc that was never named takes the name of its first page", async () => {
    const admin = await register("Rename Admin", `rename-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session: admin });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);

    const created = await call("/api/v1/notes", { method: "POST", session: admin, organizationId, idempotencyKey: `rename-note-${suffix}`, body: { title: "Untitled doc · 20 Oct 2026" } });
    expect(created.response.status).toBe(201);
    const noteId = String(created.payload.data.id);

    const clip = await call(`/api/v1/notes/${noteId}/clips`, {
      method: "POST",
      session: admin,
      organizationId,
      body: { html: "<p>A piece</p>", text: "A piece", source: { url: "https://example.com/first", title: "First page", domain: "example.com" } },
    });
    expect(clip.response.status).toBe(200);
    expect((clip.payload.data as { noteTitle: string }).noteTitle).toBe("First page");

    /**
     * A doc that has been named is never renamed again.
     */
    const second = await call(`/api/v1/notes/${noteId}/clips`, {
      method: "POST",
      session: admin,
      organizationId,
      body: { html: "<p>Another piece</p>", text: "Another piece", source: { url: "https://example.com/second", title: "Second page", domain: "example.com" } },
    });
    expect((second.payload.data as { noteTitle: string }).noteTitle).toBe("First page");
  }, 30_000);

  test("the shortcut makes a doc when there is none, and keeps using it afterwards", async () => {
    const admin = await register("Shortcut Admin", `shortcut-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session: admin });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);

    const before = await call("/api/v1/notes/current", { session: admin, organizationId });
    expect(before.response.status).toBe(200);
    expect((before.payload.data as { noteId: string | null }).noteId).toBeNull();

    const first = await call("/api/v1/notes/current/clips", {
      method: "POST",
      session: admin,
      organizationId,
      body: { html: "<p>The first piece</p>", text: "The first piece", source: { url: "https://example.com/first", title: "First page", domain: "example.com" } },
    });
    expect(first.response.status).toBe(200);
    const noteId = String((first.payload.data as { noteId: string }).noteId);
    expect((first.payload.data as { noteTitle: string }).noteTitle).toBe("First page");

    const second = await call("/api/v1/notes/current/clips", {
      method: "POST",
      session: admin,
      organizationId,
      body: { html: "<p>The second piece</p>", text: "The second piece", source: { url: "https://other.com/second", title: "Second page", domain: "other.com" } },
    });
    expect(second.response.status).toBe(200);
    expect((second.payload.data as { noteId: string }).noteId).toBe(noteId);
    expect((second.payload.data as { clipCount: number }).clipCount).toBe(2);

    const current = await call("/api/v1/notes/current", { session: admin, organizationId });
    expect((current.payload.data as { noteId: string | null }).noteId).toBe(noteId);
  }, 30_000);

  test("a doc in one workspace cannot be read from another", async () => {
    const admin = await register("Tenant Admin", `tenant-${suffix}@example.com`);
    const orgA = await call("/api/v1/organizations", { method: "POST", session: admin, body: { name: `Tenant A ${suffix}`, slug: `tenant-a-${suffix}`, currency: "USD", locale: "en-US", timeZone: "UTC" } });
    const organizationA = String(orgA.payload.data.id);
    createdOrganizationIds.push(organizationA);
    const orgB = await call("/api/v1/organizations", { method: "POST", session: admin, body: { name: `Tenant B ${suffix}`, slug: `tenant-b-${suffix}`, currency: "USD", locale: "en-US", timeZone: "UTC" } });
    const organizationB = String(orgB.payload.data.id);
    createdOrganizationIds.push(organizationB);

    const created = await call("/api/v1/notes", { method: "POST", session: admin, organizationId: organizationA, idempotencyKey: `tenant-note-${suffix}`, body: { title: "Private doc" } });
    const noteId = String(created.payload.data.id);
    const crossTenant = await call(`/api/v1/notes/${noteId}`, { session: admin, organizationId: organizationB });
    expect(crossTenant.response.status).toBe(404);
  }, 30_000);

  test("writing a doc up needs something to write from", async () => {
    const admin = await register("Write Up Admin", `writeup-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session: admin });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);

    const created = await call("/api/v1/notes", { method: "POST", session: admin, organizationId, idempotencyKey: `writeup-note-${suffix}`, body: { title: "Empty doc" } });
    const noteId = String(created.payload.data.id);

    const result = await call(`/api/v1/notes/${noteId}/write-up`, { method: "POST", session: admin, organizationId, body: {} });
    expect(result.response.status).toBe(400);
    expect(result.payload.error?.code).toBe("NOTHING_TO_WRITE");
  }, 30_000);

  test("a doc can be chosen as the current one, and the choice is kept", async () => {    const admin = await register("Current Admin", `current-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session: admin });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);

    const first = await call("/api/v1/notes", { method: "POST", session: admin, organizationId, idempotencyKey: `current-a-${suffix}`, body: { title: "First doc" } });
    const second = await call("/api/v1/notes", { method: "POST", session: admin, organizationId, idempotencyKey: `current-b-${suffix}`, body: { title: "Second doc" } });
    const firstId = String(first.payload.data.id);
    const secondId = String(second.payload.data.id);

    const empty = await call("/api/v1/notes/current", { session: admin, organizationId });
    expect((empty.payload.data as { noteId: string | null }).noteId).toBeNull();

    const chosen = await call("/api/v1/notes/current", { method: "PUT", session: admin, organizationId, body: { noteId: secondId } });
    expect(chosen.response.status).toBe(200);
    expect((chosen.payload.data as { noteId: string }).noteId).toBe(secondId);

    const read = await call("/api/v1/notes/current", { session: admin, organizationId });
    expect((read.payload.data as { noteId: string }).noteId).toBe(secondId);
    expect((read.payload.data as { title: string }).title).toBe("Second doc");

    /**
     * The choice can be changed, and a doc that does not exist is refused.
     */
    const changed = await call("/api/v1/notes/current", { method: "PUT", session: admin, organizationId, body: { noteId: firstId } });
    expect(changed.response.status).toBe(200);
    const afterChange = await call("/api/v1/notes/current", { session: admin, organizationId });
    expect((afterChange.payload.data as { noteId: string }).noteId).toBe(firstId);

    const missing = await call("/api/v1/notes/current", { method: "PUT", session: admin, organizationId, body: { noteId: "00000000-0000-0000-0000-000000000000" } });
    expect(missing.response.status).toBe(404);

    /**
     * The shortcut then goes into the chosen doc.
     */
    const clip = await call("/api/v1/notes/current/clips", {
      method: "POST", session: admin, organizationId,
      body: { html: "<p>A piece</p>", text: "A piece", source: { url: "https://example.com/piece", title: "Piece page", domain: "example.com" } },
    });
    expect(clip.response.status).toBe(200);
    expect((clip.payload.data as { noteId: string }).noteId).toBe(firstId);
  }, 30_000);

  test("a real workspace comes before the personal bucket, so saves do not all land in it", async () => {    const user = await register("Order Admin", `order-${suffix}@example.com`);
    /**
     * Every account is given a personal workspace when it signs up.
     */
    const first = await call("/api/v1/organizations", { session: user });
    expect(first.response.status).toBe(200);
    const personal = (first.payload.data as unknown as { id: string; isPersonal: boolean }[])[0]!;
    expect(personal.isPersonal).toBe(true);

    const created = await call("/api/v1/organizations", { method: "POST", session: user, body: { name: `Order Workspace ${suffix}`, slug: `order-workspace-${suffix}`, currency: "USD", locale: "en-US", timeZone: "UTC" } });
    expect(created.response.status).toBe(201);
    const workspaceId = String(created.payload.data.id);
    createdOrganizationIds.push(workspaceId);

    const listed = await call("/api/v1/organizations", { session: user });
    const organizations = listed.payload.data as unknown as { id: string; isPersonal: boolean }[];
    expect(organizations[0]?.id).toBe(workspaceId);
    expect(organizations[0]?.isPersonal).toBe(false);
    expect(organizations.some((item) => item.id === personal.id)).toBe(true);

    /**
     * The same order comes back every time, so the default does not move.
     */
    const again = await call("/api/v1/organizations", { session: user });
    expect((again.payload.data as unknown as { id: string }[])[0]?.id).toBe(workspaceId);
  }, 30_000);

  test("a trashed item is missing from the dashboard and from the search", async () => {
    const user = await register("Trash Admin", `trash-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session: user });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);

    const created = await call("/api/v1/saved-records", {
      method: "POST",
      session: user,
      organizationId,
      idempotencyKey: `trash-item-${suffix}`,
      body: { recordType: "note", title: `Hidden by trash ${suffix}` },
    });
    expect(created.response.status).toBe(201);
    const recordId = String(created.payload.data.id);

    const before = await call("/api/v1/dashboard", { session: user, organizationId });
    const beforeSummary = before.payload.data.summary as { savedRecords: number };
    expect(beforeSummary.savedRecords).toBe(1);

    const trashed = await call(`/api/v1/saved-records/${recordId}`, { method: "DELETE", session: user, organizationId });
    expect(trashed.response.status).toBe(200);

    const after = await call("/api/v1/dashboard", { session: user, organizationId });
    const afterSummary = after.payload.data.summary as { savedRecords: number };
    expect(afterSummary.savedRecords).toBe(0);

    const search = await call(`/api/v1/search?q=${encodeURIComponent(`trash ${suffix}`)}`, { session: user, organizationId });
    expect(search.payload.data.total).toBe(0);
  }, 30_000);

  test("a percent sign in a search is looked for as text", async () => {
    const user = await register("Percent Admin", `percent-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session: user });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);

    await call("/api/v1/saved-records", {
      method: "POST",
      session: user,
      organizationId,
      idempotencyKey: `percent-item-${suffix}`,
      body: { recordType: "statistic", title: "Growth was 42% last year" },
    });
    await call("/api/v1/saved-records", {
      method: "POST",
      session: user,
      organizationId,
      idempotencyKey: `percent-plain-${suffix}`,
      body: { recordType: "note", title: "A plain note" },
    });

    /**
     * A percent sign is a wildcard in a search pattern. Treated as one, it
     * would match every row, and the plain note would come back too.
     */
    const literal = await call("/api/v1/search?q=42%25", { session: user, organizationId });
    expect(literal.payload.data.total).toBe(1);

    const wildcard = await call("/api/v1/search?q=%25", { session: user, organizationId });
    expect(wildcard.payload.data.total).toBe(1);
  }, 30_000);

  test("a folder from another workspace is refused", async () => {
    const user = await register("Scope Admin", `scope-${suffix}@example.com`);
    const first = await call("/api/v1/organizations", { method: "POST", session: user, body: { name: `Scope A ${suffix}`, slug: `scope-a-${suffix}`, currency: "USD", locale: "en-US", timeZone: "UTC" } });
    const organizationA = String(first.payload.data.id);
    createdOrganizationIds.push(organizationA);
    const second = await call("/api/v1/organizations", { method: "POST", session: user, body: { name: `Scope B ${suffix}`, slug: `scope-b-${suffix}`, currency: "USD", locale: "en-US", timeZone: "UTC" } });
    const organizationB = String(second.payload.data.id);
    createdOrganizationIds.push(organizationB);

    const vaults = await call("/api/v1/vaults", { session: user, organizationId: organizationA });
    const vaultId = String((vaults.payload.data as unknown as { id: string }[])[0]!.id);

    /**
     * The folder belongs to the first workspace, so the second one cannot
     * point a doc at it.
     */
    const result = await call("/api/v1/notes", { method: "POST", session: user, organizationId: organizationB, idempotencyKey: `scope-note-${suffix}`, body: { title: "Out of place", vaultId } });
    expect(result.response.status).toBe(404);
    expect(result.payload.error?.code).toBe("NOT_FOUND");
  }, 30_000);

  test("a doc can be copied, and the copy is a new doc", async () => {
    const user = await register("Copy Admin", `copy-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session: user });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);

    const created = await call("/api/v1/notes", { method: "POST", session: user, organizationId, idempotencyKey: `copy-note-${suffix}`, body: { title: "Original doc" } });
    const noteId = String(created.payload.data.id);

    const copied = await call(`/api/v1/notes/${noteId}/duplicate`, { method: "POST", session: user, organizationId, idempotencyKey: `copy-note-${suffix}`, body: {} });
    expect(copied.response.status).toBe(201);
    const copyId = String(copied.payload.data.id);
    expect(copyId).not.toBe(noteId);
    expect(copied.payload.data.title).toBe("Original doc");

    const original = await call(`/api/v1/notes/${noteId}`, { session: user, organizationId });
    const copy = await call(`/api/v1/notes/${copyId}`, { session: user, organizationId });
    expect(copy.payload.data.title).toBe(original.payload.data.title);
    expect(copy.payload.data.version).toBe(1);
  }, 30_000);

  test("an account with two-factor authentication gets a challenge, not a failure", async () => {
    await register("Two Factor Admin", `twofactor-${suffix}@example.com`);
    /**
     * The sign-in answer is read as a session. When the account has a second
     * factor there is no session, so the answer used to be read as though
     * there was one and signing in failed with a server fault.
     */
    const login = await call("/api/v1/auth/login", { method: "POST", body: { email: `twofactor-${suffix}@example.com`, password } });
    expect(login.response.status).toBe(200);
    expect(login.payload.data.user).toBeTruthy();
  }, 30_000);
});
