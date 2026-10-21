import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { getDatabase, noteAiPreviews, organizations, users, withTenant } from "@data-vault/database";
import { app } from "../src";
import { clearRateLimits } from "./support";

/**
 * Applying an answer is one piece of work.
 *
 * The answer is written into the doc and marked as used in a single
 * transaction, and each write carries the condition that makes it safe. Two
 * people applying the same answer at the same time therefore cannot both
 * succeed: one writes it, and the other is told the doc has moved on.
 */
const origin = process.env.WEB_URL ?? "http://localhost:5173";
const suffix = crypto.randomUUID().slice(0, 8);
const password = `Preview-${suffix}-Aa1`;
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

describe("applying an answer the model gave", () => {
  test("two people applying it at the same time give one answer and one refusal", async () => {
    const session = await register("Preview Admin", `preview-${suffix}@example.com`);
    const orgs = await call("/api/v1/organizations", { session });
    const organizationId = String((orgs.payload.data as unknown as { id: string }[])[0]!.id);
    createdOrganizationIds.push(organizationId);

    const created = await call("/api/v1/notes", { method: "POST", session, organizationId, idempotencyKey: `preview-note-${suffix}`, body: { title: "Concurrent doc" } });
    expect(created.response.status).toBe(201);
    const noteId = String(created.payload.data.id);

    const clipIds: string[] = [];
    for (const piece of ["The first piece", "The second piece"]) {
      const clip = await call(`/api/v1/notes/${noteId}/clips`, {
        method: "POST",
        session,
        organizationId,
        body: { html: `<p>${piece}</p>`, text: piece, source: { url: `https://example.com/${piece.length}`, title: "A page", domain: "example.com" } },
      });
      expect(clip.response.status).toBe(200);
      clipIds.push(String((clip.payload.data as { clipId: string }).clipId));
    }

    const detail = await call(`/api/v1/notes/${noteId}`, { session, organizationId });
    const baseVersion = Number((detail.payload.data as { version: number }).version);

    /**
     * The answer is kept on the server, so it is put there the way the
     * server would.
     */
    const [preview] = await withTenant(organizationId, (tx) => tx.insert(noteAiPreviews).values({
      organizationId,
      noteId,
      userId: session.userId,
      feature: "organize",
      baseVersion,
      payload: { sections: [{ title: "A topic", clipIds }] },
      expiresAt: new Date(Date.now() + 60_000),
    }).returning({ id: noteAiPreviews.id }));
    expect(preview).toBeTruthy();

    const [first, second] = await Promise.all([
      call(`/api/v1/notes/${noteId}/organize`, { method: "POST", session, organizationId, body: { apply: true, previewId: preview!.id } }),
      call(`/api/v1/notes/${noteId}/organize`, { method: "POST", session, organizationId, body: { apply: true, previewId: preview!.id } }),
    ]);

    const statuses = [first.response.status, second.response.status].sort();
    expect(statuses).toEqual([200, 409]);

    /**
     * The refusal says why, and the doc was written once.
     */
    const refused = first.response.status === 409 ? first : second;
    expect(["NOTE_VERSION_CONFLICT", "PREVIEW_ALREADY_APPLIED"]).toContain(refused.payload.error?.code ?? "");

    const after = await call(`/api/v1/notes/${noteId}`, { session, organizationId });
    expect(Number((after.payload.data as { version: number }).version)).toBe(baseVersion + 1);
  }, 30_000);
});
