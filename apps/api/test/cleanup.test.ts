import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { getDatabase, idempotencyKeys, noteAiPreviews, notes, organizations, rateLimitBuckets, users, withAccount, withTenant, withUser } from "@data-vault/database";
import { pruneExpiredRows } from "../src/services/cleanup";

const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

afterEach(async () => {
  const db = getDatabase();
  const personal = createdUserIds.length ? await db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.createdBy, createdUserIds)) : [];
  const all = [...new Set([...createdOrganizationIds, ...personal.map((organization) => organization.id)])];
  if (all.length) await db.delete(organizations).where(inArray(organizations.id, all));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  createdUserIds.length = 0;
  createdOrganizationIds.length = 0;
});

describe("the rows that expire", () => {
  test("the answers, the request keys and the spent buckets are removed", async () => {
    const db = getDatabase();
    const [user] = await db.insert(users).values({
      name: "Cleanup Tester",
      email: `cleanup-${crypto.randomUUID().slice(0, 8)}@example.com`,
      emailVerified: true,
    }).returning({ id: users.id });
    if (!user) throw new Error("User insert failed");
    createdUserIds.push(user.id);
    const [organization] = await db.insert(organizations).values({
      name: "Cleanup Workspace",
      slug: `cleanup-${crypto.randomUUID().slice(0, 12)}`,
      currency: "USD",
      locale: "en-US",
      timeZone: "UTC",
      createdBy: user.id,
    }).returning({ id: organizations.id });
    if (!organization) throw new Error("Organization insert failed");
    createdOrganizationIds.push(organization.id);

    const [note] = await withTenant(organization.id, (tx) => tx.insert(notes).values({
      organizationId: organization.id,
      title: "A doc to hang the answers on",
      createdBy: user.id,
    }).returning({ id: notes.id }));
    if (!note) throw new Error("Note insert failed");

    /**
     * Two answers that are waiting to be applied: one that has expired and
     * one that has not.
     */
    await withUser(user.id, organization.id, (tx) => tx.insert(noteAiPreviews).values([
      { organizationId: organization.id, noteId: note.id, userId: user.id, feature: "organize", baseVersion: 1, payload: {}, expiresAt: new Date(Date.now() - 60_000) },
      { organizationId: organization.id, noteId: note.id, userId: user.id, feature: "write-up", baseVersion: 1, payload: {}, expiresAt: new Date(Date.now() + 3_600_000) },
    ]));

    /**
     * Two request keys: one that has expired and one that has not.
     */
    await withTenant(organization.id, (tx) => tx.insert(idempotencyKeys).values([
      { organizationId: organization.id, scope: "capture.create", key: "expired-key", requestHash: "hash", expiresAt: new Date(Date.now() - 60_000) },
      { organizationId: organization.id, scope: "capture.create", key: "live-key", requestHash: "hash", expiresAt: new Date(Date.now() + 3_600_000) },
    ]));

    /**
     * Two rate-limit buckets: one whose window has passed and one that is
     * still counting.
     */
    const spentKey = `cleanup-spent-${crypto.randomUUID()}`;
    const liveKey = `cleanup-live-${crypto.randomUUID()}`;
    await db.insert(rateLimitBuckets).values([
      { key: spentKey, hits: "3", resetAt: new Date(Date.now() - 60_000) },
      { key: liveKey, hits: "1", resetAt: new Date(Date.now() + 3_600_000) },
    ]);

    await pruneExpiredRows();

    const previews = await withUser(user.id, organization.id, (tx) => tx.select({ feature: noteAiPreviews.feature }).from(noteAiPreviews));
    expect(previews.map((preview) => preview.feature)).toEqual(["write-up"]);

    const keys = await withTenant(organization.id, (tx) => tx.select({ key: idempotencyKeys.key }).from(idempotencyKeys));
    expect(keys.map((entry) => entry.key)).toEqual(["live-key"]);

    const buckets = await db.select({ key: rateLimitBuckets.key }).from(rateLimitBuckets).where(inArray(rateLimitBuckets.key, [spentKey, liveKey]));
    expect(buckets.map((bucket) => bucket.key)).toEqual([liveKey]);

    await withAccount(user.id, async (tx) => tx.delete(noteAiPreviews).where(eq(noteAiPreviews.userId, user.id)));
  });
});
