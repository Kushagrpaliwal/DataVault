import { and, asc, desc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm";
import { noteRevisions, notes, userNotePrefs, withTenant } from "@data-vault/database";
import { appendClip, docExcerpt, docToPlainText, findClipByHash, removeClip, type ClipContent } from "@data-vault/notes";
import { htmlToClipContent, validateDoc } from "@data-vault/notes/html";
import type { JSONContent } from "@tiptap/core";
import type { z } from "zod";
import type { noteClipSchema, noteCreateSchema, noteListQuerySchema, notePatchSchema } from "@data-vault/schemas";
import type { Note, NoteClipResult, NoteRevision, NoteSummary } from "@data-vault/types";
import type { DatabaseTransaction } from "@data-vault/database";
import type { TenantContext } from "../auth/context";
import { AppError, notFound } from "../lib/errors";
import { sha256 } from "../lib/crypto";
import { writeAudit } from "./audit";

type CreateInput = z.infer<typeof noteCreateSchema>;
type PatchInput = z.infer<typeof notePatchSchema>;
type ListQuery = z.infer<typeof noteListQuerySchema>;
type ClipInput = z.infer<typeof noteClipSchema>;

/** The title a doc has before anyone has named it. */
const DEFAULT_TITLE = "Untitled doc";
/** How many earlier versions of a doc are kept. */
const MAX_REVISIONS = 30;
/** How often a version is kept while the user is typing. */
const REVISION_INTERVAL_MS = 10 * 60_000;

type NoteRow = typeof notes.$inferSelect;

export function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    organizationId: row.organizationId,
    vaultId: row.vaultId,
    parentId: row.parentId,
    title: row.title,
    icon: row.icon,
    content: row.content as Record<string, unknown>,
    contentText: row.contentText,
    arrangeMode: row.arrangeMode,
    isPinned: row.isPinned,
    position: row.position,
    version: row.version,
    clipCount: row.clipCount,
    lastClippedAt: row.lastClippedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

function mapSummary(row: NoteRow): NoteSummary {
  const note = mapNote(row);
  return {
    id: note.id,
    organizationId: note.organizationId,
    vaultId: note.vaultId,
    parentId: note.parentId,
    title: note.title,
    icon: note.icon,
    contentText: note.contentText,
    arrangeMode: note.arrangeMode,
    isPinned: note.isPinned,
    position: note.position,
    version: note.version,
    clipCount: note.clipCount,
    lastClippedAt: note.lastClippedAt,
    createdBy: note.createdBy,
    updatedBy: note.updatedBy,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
    excerpt: docExcerpt(row.content as JSONContent),
  };
}

export async function listNotes(context: TenantContext, query: ListQuery): Promise<NoteSummary[]> {
  return withTenant(context.organizationId, async (tx) => {
    const conditions = [eq(notes.organizationId, context.organizationId)];
    conditions.push(query.trash ? isNotNull(notes.deletedAt) : isNull(notes.deletedAt));
    if (query.parentId) conditions.push(eq(notes.parentId, query.parentId));
    if (query.pinned) conditions.push(eq(notes.isPinned, true));
    if (query.q) conditions.push(or(ilike(notes.title, `%${query.q}%`), ilike(notes.contentText, `%${query.q}%`))!);
    const rows = await tx.select().from(notes).where(and(...conditions))
      .orderBy(desc(notes.isPinned), asc(notes.position), desc(notes.updatedAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);
    return rows.map(mapSummary);
  });
}

export async function getNote(context: TenantContext, id: string): Promise<Note> {
  return withTenant(context.organizationId, async (tx) => {
    const [note] = await tx.select().from(notes).where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, id))).limit(1);
    if (!note) throw notFound("note");
    return mapNote(note);
  });
}

export async function createNote(context: TenantContext, request: Request, input: CreateInput): Promise<Note> {
  return withTenant(context.organizationId, async (tx) => {
    const title = input.title?.trim() || DEFAULT_TITLE;
    const checked = validateDoc(input.content ?? { type: "doc", content: [{ type: "paragraph" }] });
    if (!checked.valid) throw new AppError(400, "INVALID_NOTE_CONTENT", checked.message);
    const [note] = await tx.insert(notes).values({
      organizationId: context.organizationId,
      vaultId: input.vaultId ?? null,
      parentId: input.parentId ?? null,
      title,
      icon: input.icon ?? null,
      content: checked.doc as Record<string, unknown>,
      contentText: input.contentText ?? docToPlainText(checked.doc),
      arrangeMode: input.arrangeMode ?? "page",
      isPinned: input.isPinned ?? false,
      createdBy: context.userId,
      updatedBy: context.userId,
    }).returning();
    if (!note) throw new Error("Note insert failed");
    await writeAudit(tx, context, request, { action: "created", resourceType: "note", resourceId: note.id, newValues: { title: note.title } });
    return mapNote(note);
  });
}

/**
 * Change a doc.
 *
 * The editor sends the version it started from. When the doc has moved on
 * since then, the change is refused rather than quietly overwriting whatever
 * was saved in the meantime.
 */
export async function updateNote(context: TenantContext, request: Request, id: string, input: PatchInput): Promise<Note> {
  return withTenant(context.organizationId, async (tx) => {
    const [before] = await tx.select().from(notes).where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, id))).limit(1);
    if (!before) throw notFound("note");
    if (input.baseVersion !== undefined && input.baseVersion !== before.version) {
      throw new AppError(409, "NOTE_VERSION_CONFLICT", "This doc was changed somewhere else.", { note: mapNote(before) });
    }
    let content = before.content as Record<string, unknown>;
    if (input.content !== undefined) {
      const checked = validateDoc(input.content);
      if (!checked.valid) throw new AppError(400, "INVALID_NOTE_CONTENT", checked.message);
      content = checked.doc as Record<string, unknown>;
    }
    const contentText = input.contentText ?? (input.content !== undefined ? docToPlainText(content as JSONContent) : before.contentText);
    const [after] = await tx.update(notes).set({
      ...(input.title !== undefined ? { title: input.title.trim() || DEFAULT_TITLE } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.content !== undefined ? { content } : {}),
      ...(input.arrangeMode !== undefined ? { arrangeMode: input.arrangeMode } : {}),
      ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      contentText,
      version: before.version + 1,
      updatedBy: context.userId,
      updatedAt: new Date(),
    }).where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, id))).returning();
    if (!after) throw notFound("note");
    await snapshotRevision(tx, context, before, "autosave");
    await writeAudit(tx, context, request, { action: "updated", resourceType: "note", resourceId: id, newValues: { title: after.title, version: after.version } });
    return mapNote(after);
  });
}

export async function trashNote(context: TenantContext, request: Request, id: string) {
  return withTenant(context.organizationId, async (tx) => {
    const [note] = await tx.update(notes).set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: context.userId })
      .where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, id))).returning({ id: notes.id });
    if (!note) throw notFound("note");
    await clearCurrentNote(tx, context, id);
    await writeAudit(tx, context, request, { action: "trashed", resourceType: "note", resourceId: id });
    return note;
  });
}

export async function restoreNote(context: TenantContext, request: Request, id: string): Promise<Note> {
  return withTenant(context.organizationId, async (tx) => {
    const [note] = await tx.update(notes).set({ deletedAt: null, updatedAt: new Date(), updatedBy: context.userId })
      .where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, id), isNotNull(notes.deletedAt))).returning();
    if (!note) throw notFound("trashed_note");
    await writeAudit(tx, context, request, { action: "restored", resourceType: "note", resourceId: id });
    return mapNote(note);
  });
}

/**
 * Keep an earlier version of a doc.
 *
 * A version is only kept every few minutes while the user is typing, and only
 * the last thirty versions of each doc are kept.
 */
async function snapshotRevision(
  tx: DatabaseTransaction,
  context: TenantContext,
  before: NoteRow,
  reason: "autosave" | "ai-organize" | "ai-write-up" | "conflict" | "restore",
) {
  const [latest] = await tx.select({ createdAt: noteRevisions.createdAt }).from(noteRevisions)
    .where(and(eq(noteRevisions.organizationId, context.organizationId), eq(noteRevisions.noteId, before.id)))
    .orderBy(desc(noteRevisions.createdAt)).limit(1);
  if (reason === "autosave" && latest && Date.now() - latest.createdAt.getTime() < REVISION_INTERVAL_MS) return;
  await tx.insert(noteRevisions).values({
    organizationId: context.organizationId,
    noteId: before.id,
    version: before.version,
    title: before.title,
    content: before.content as Record<string, unknown>,
    reason,
    createdBy: context.userId,
  });
  const old = await tx.select({ id: noteRevisions.id }).from(noteRevisions)
    .where(and(eq(noteRevisions.organizationId, context.organizationId), eq(noteRevisions.noteId, before.id)))
    .orderBy(desc(noteRevisions.createdAt))
    .offset(MAX_REVISIONS);
  for (const revision of old) {
    await tx.delete(noteRevisions).where(and(eq(noteRevisions.organizationId, context.organizationId), eq(noteRevisions.id, revision.id)));
  }
}

export async function listRevisions(context: TenantContext, id: string): Promise<NoteRevision[]> {
  return withTenant(context.organizationId, async (tx) => {
    const rows = await tx.select().from(noteRevisions)
      .where(and(eq(noteRevisions.organizationId, context.organizationId), eq(noteRevisions.noteId, id)))
      .orderBy(desc(noteRevisions.createdAt)).limit(MAX_REVISIONS);
    return rows.map((row) => ({
      id: row.id,
      noteId: row.noteId,
      version: row.version,
      title: row.title,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}

export async function restoreRevision(context: TenantContext, request: Request, id: string, revisionId: string): Promise<Note> {
  return withTenant(context.organizationId, async (tx) => {
    const [note] = await tx.select().from(notes).where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, id))).limit(1);
    if (!note) throw notFound("note");
    const [revision] = await tx.select().from(noteRevisions)
      .where(and(eq(noteRevisions.organizationId, context.organizationId), eq(noteRevisions.noteId, id), eq(noteRevisions.id, revisionId))).limit(1);
    if (!revision) throw notFound("note_revision");
    await snapshotRevision(tx, context, note, "restore");
    const [after] = await tx.update(notes).set({
      title: revision.title,
      content: revision.content,
      contentText: docToPlainText(revision.content as JSONContent),
      version: note.version + 1,
      updatedAt: new Date(),
      updatedBy: context.userId,
    }).where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, id))).returning();
    if (!after) throw notFound("note");
    await writeAudit(tx, context, request, { action: "restored", resourceType: "note", resourceId: id, newValues: { version: revision.version } });
    return mapNote(after);
  });
}

/**
 * Turn the HTML of a selection into the blocks of a clip.
 */
async function buildClip(input: ClipInput) {
  const blocks = input.html ? await htmlToClipContent(input.html) : [];
  const text = input.text.trim();
  const hash = await sha256(text.replace(/\s+/g, " ").trim().toLowerCase() || JSON.stringify(blocks));
  return {
    clipId: crypto.randomUUID(),
    hash,
    sourceUrl: input.source.url ?? "",
    sourceTitle: input.source.title ?? "",
    domain: input.source.domain ?? "",
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    content: blocks.length ? blocks : [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] as JSONContent[],
  };
}

/**
 * Add a clip to a doc that has already been read.
 */
async function appendToNote(tx: DatabaseTransaction, context: TenantContext, note: NoteRow, clip: Awaited<ReturnType<typeof buildClip>>) {
  const result = appendClip(note.content as JSONContent, clip, note.arrangeMode);
  if (result.duplicate) {
    const existing = findClipByHash(note.content as JSONContent, clip.hash);
    return {
      clipId: String(existing?.attrs?.clipId ?? clip.clipId),
      sectionTitle: "",
      duplicate: true,
      noteTitle: note.title,
      noteId: note.id,
      version: note.version,
      clipCount: note.clipCount,
    };
  }
  const contentText = docToPlainText(result.doc);
  /**
   * A doc that has never been named takes the name of the page its first
   * piece came from. A doc the user has named is never renamed.
   */
  const title = note.clipCount === 0 && note.title.startsWith(DEFAULT_TITLE)
    ? (clip.sourceTitle?.trim() || clip.domain || note.title).slice(0, 300)
    : note.title;
  const [after] = await tx.update(notes).set({
    content: result.doc as Record<string, unknown>,
    contentText,
    title,
    clipCount: note.clipCount + 1,
    lastClippedAt: new Date(clip.capturedAt),
    version: note.version + 1,
    updatedAt: new Date(),
    updatedBy: context.userId,
  }).where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, note.id))).returning();
  if (!after) throw notFound("note");
  return {
    clipId: clip.clipId,
    sectionTitle: result.sectionTitle,
    duplicate: false,
    noteTitle: after.title,
    noteId: after.id,
    version: after.version,
    clipCount: after.clipCount,
  };
}

/**
 * Add a piece of a web page to a doc.
 *
 * The doc row is locked while the clip is added, so two clips arriving at the
 * same moment cannot overwrite each other.
 */
export async function addClip(context: TenantContext, request: Request, id: string, input: ClipInput): Promise<NoteClipResult> {
  const clip = await buildClip(input);
  return withTenant(context.organizationId, async (tx) => {
    const [note] = await tx.select().from(notes)
      .where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, id)))
      .for("update").limit(1);
    if (!note) throw notFound("note");
    if (note.deletedAt) throw new AppError(409, "NOTE_IN_TRASH", "This doc is in the trash. Restore it before adding to it.");
    const result = await appendToNote(tx, context, note, clip);
    if (!result.duplicate) {
      await writeAudit(tx, context, request, { action: "clipped", resourceType: "note", resourceId: id, newValues: { clipId: clip.clipId, sourceDomain: clip.domain } });
    }
    return result;
  });
}

/**
 * Take a piece back out of a doc.
 */
export async function removeClipById(context: TenantContext, request: Request, id: string, clipId: string) {
  return withTenant(context.organizationId, async (tx) => {
    const [note] = await tx.select().from(notes)
      .where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, id)))
      .for("update").limit(1);
    if (!note) throw notFound("note");
    const next = removeClip(note.content as JSONContent, clipId);
    const contentText = docToPlainText(next);
    const [after] = await tx.update(notes).set({
      content: next as Record<string, unknown>,
      contentText,
      clipCount: Math.max(0, note.clipCount - 1),
      version: note.version + 1,
      updatedAt: new Date(),
      updatedBy: context.userId,
    }).where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, id))).returning();
    if (!after) throw notFound("note");
    await writeAudit(tx, context, request, { action: "clip_removed", resourceType: "note", resourceId: id, newValues: { clipId } });
    return { id: after.id, clipId };
  });
}

/**
 * The doc the keyboard shortcut adds to.
 */
export async function getCurrentNote(context: TenantContext) {
  return withTenant(context.organizationId, async (tx) => {
    const [pref] = await tx.select().from(userNotePrefs)
      .where(and(eq(userNotePrefs.organizationId, context.organizationId), eq(userNotePrefs.userId, context.userId))).limit(1);
    if (!pref?.currentNoteId) return { noteId: null, title: null, clipCount: 0 };
    const [note] = await tx.select().from(notes)
      .where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, pref.currentNoteId), isNull(notes.deletedAt))).limit(1);
    if (!note) return { noteId: null, title: null, clipCount: 0 };
    return { noteId: note.id, title: note.title, clipCount: note.clipCount };
  });
}

export async function setCurrentNote(context: TenantContext, noteId: string | null) {
  return withTenant(context.organizationId, async (tx) => {
    if (noteId) {
      const [note] = await tx.select({ id: notes.id }).from(notes)
        .where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, noteId), isNull(notes.deletedAt))).limit(1);
      if (!note) throw notFound("note");
    }
    await tx.insert(userNotePrefs).values({ organizationId: context.organizationId, userId: context.userId, currentNoteId: noteId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [userNotePrefs.organizationId, userNotePrefs.userId],
        set: { currentNoteId: noteId, updatedAt: new Date() },
      });
    return { noteId };
  });
}

async function clearCurrentNote(tx: DatabaseTransaction, context: TenantContext, noteId: string) {
  await tx.update(userNotePrefs).set({ currentNoteId: null, updatedAt: new Date() })
    .where(and(eq(userNotePrefs.organizationId, context.organizationId), eq(userNotePrefs.userId, context.userId), eq(userNotePrefs.currentNoteId, noteId)));
}

/**
 * The keyboard shortcut.
 *
 * The current doc is used. If there is none, one is made and titled after
 * the page the clip came from.
 */
export async function addCurrentClip(context: TenantContext, request: Request, input: ClipInput): Promise<NoteClipResult> {
  const current = await getCurrentNote(context);
  if (current.noteId) return addClip(context, request, current.noteId, input);

  const clip = await buildClip(input);
  const title = (clip.sourceTitle?.trim() || clip.domain || DEFAULT_TITLE).slice(0, 300);

  return withTenant(context.organizationId, async (tx) => {
    const [note] = await tx.insert(notes).values({
      organizationId: context.organizationId,
      title,
      content: { type: "doc", content: [{ type: "paragraph" }] },
      contentText: "",
      arrangeMode: "page",
      createdBy: context.userId,
      updatedBy: context.userId,
    }).returning();
    if (!note) throw new Error("Note insert failed");
    await tx.insert(userNotePrefs).values({ organizationId: context.organizationId, userId: context.userId, currentNoteId: note.id, updatedAt: new Date() });
    await writeAudit(tx, context, request, { action: "created", resourceType: "note", resourceId: note.id, newValues: { title: note.title } });
    const result = await appendToNote(tx, context, note, clip);
    if (!result.duplicate) {
      await writeAudit(tx, context, request, { action: "clipped", resourceType: "note", resourceId: note.id, newValues: { clipId: clip.clipId, sourceDomain: clip.domain } });
    }
    return result;
  });
}

/**
 * Sort the clips of a doc again, using the mode the doc is set to.
 *
 * The writing that is not a clip is left where it is. Only the automatic
 * headings and the pieces themselves are moved.
 */
export async function rearrangeNote(context: TenantContext, request: Request, id: string): Promise<Note> {
  return withTenant(context.organizationId, async (tx) => {
    const [note] = await tx.select().from(notes)
      .where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, id)))
      .for("update").limit(1);
    if (!note) throw notFound("note");
    if (note.deletedAt) throw new AppError(409, "NOTE_IN_TRASH", "This doc is in the trash. Restore it before sorting it.");

    const clips: ClipContent[] = [];
    const walk = (node: JSONContent) => {
      if (node.type === "clip") {
        clips.push({
          clipId: String(node.attrs?.clipId ?? crypto.randomUUID()),
          hash: String(node.attrs?.hash ?? ""),
          sourceUrl: String(node.attrs?.sourceUrl ?? ""),
          sourceTitle: String(node.attrs?.sourceTitle ?? ""),
          domain: String(node.attrs?.domain ?? ""),
          capturedAt: String(node.attrs?.capturedAt ?? new Date().toISOString()),
          content: node.content ?? [],
        });
        return;
      }
      if (Array.isArray(node.content)) for (const child of node.content) walk(child);
    };
    walk(note.content as JSONContent);

    if (!clips.length) return mapNote(note);

    /**
     * The automatic headings and the pieces are taken out. Everything the
     * user wrote stays exactly where it was.
     */
    const kept = stripClipsAndSections(note.content as JSONContent);
    let doc: JSONContent = kept;
    for (const clip of clips) {
      const result = appendClip(doc, clip, note.arrangeMode);
      if (!result.duplicate) doc = result.doc;
    }

    const [after] = await tx.update(notes).set({
      content: doc as Record<string, unknown>,
      contentText: docToPlainText(doc),
      version: note.version + 1,
      updatedAt: new Date(),
      updatedBy: context.userId,
    }).where(and(eq(notes.organizationId, context.organizationId), eq(notes.id, id))).returning();
    if (!after) throw notFound("note");
    await writeAudit(tx, context, request, { action: "rearranged", resourceType: "note", resourceId: id, newValues: { arrangeMode: note.arrangeMode } });
    return mapNote(after);
  });
}

/**
 * Remove the pieces and the headings that were made for them.
 */
function stripClipsAndSections(doc: JSONContent): JSONContent {
  const content = (doc.content ?? []).filter((node) => {
    if (node.type === "clip") return false;
    if (node.type === "heading" && typeof node.attrs?.sectionKey === "string" && node.attrs.sectionKey) return false;
    return true;
  });
  return { ...doc, content: content.map((node) => (Array.isArray(node.content) ? stripClipsAndSections(node) : node)) };
}

/**
 * Rebuild a doc so that its clips sit under topic headings.
 *
 * The writing that is not a clip stays at the top, and every clip that the
 * AI could not place goes under "Other".
 */
export function rebuildWithSections(doc: JSONContent, sections: Array<{ title: string; clipIds: string[] }>): JSONContent {
  const content = doc.content ?? [];
  const clips = new Map<string, JSONContent>();

  const collect = (nodes: JSONContent[]) => {
    for (const node of nodes) {
      if (node.type === "clip") {
        const clipId = String(node.attrs?.clipId ?? "");
        if (clipId) clips.set(clipId, node);
        continue;
      }
      if (Array.isArray(node.content)) collect(node.content);
    }
  };
  collect(content);

  /**
   * Everything that is not a clip and is not a heading stays at the top, so
   * the user's own writing is never lost.
   */
  const preamble = content.filter((node) => node.type !== "clip" && node.type !== "heading");

  const placed = new Set<string>();
  const next: JSONContent[] = [...preamble];
  for (const section of sections) {
    next.push({
      type: "heading",
      attrs: { level: 2, sectionKey: `topic:${section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` },
      content: [{ type: "text", text: section.title }],
    });
    for (const clipId of section.clipIds) {
      const clip = clips.get(clipId);
      if (!clip || placed.has(clipId)) continue;
      placed.add(clipId);
      next.push(clip);
    }
  }

  const leftovers = [...clips.values()].filter((clip) => !placed.has(String(clip.attrs?.clipId ?? "")));
  if (leftovers.length) {
    next.push({ type: "heading", attrs: { level: 2, sectionKey: "topic:other" }, content: [{ type: "text", text: "Other" }] });
    next.push(...leftovers);
  }

  return { type: "doc", content: next };
}
