import { Elysia } from "elysia";
import { noteAiRequestSchema, noteAiSelectionSchema, noteClipSchema, noteCreateSchema, noteCurrentSchema, noteListQuerySchema, notePatchSchema, uuidSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { enforceRateLimit, RATE_LIMITS } from "../lib/rate-limit-policies";
import {
  addClip, addCurrentClip, createNote, duplicateNote, getCurrentNote, getNote, listNotes, listRevisions,
  rearrangeNote, removeClipById, restoreNote, restoreRevision, setCurrentNote, trashNote, updateNote,
} from "../services/notes";
import { runIdempotent } from "../services/idempotency";
import { organizeNote, selectionAssist, writeUpNote } from "../services/notes-ai";

export function createNoteRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "note-routes" })
    /**
     * The doc the keyboard shortcut adds to.
     *
     * These are registered before the ones with an id in the address, so
     * "current" is never read as a doc id.
     */
    .get("/api/v1/notes/current", async ({ request }) => success(await getCurrentNote(await getTenantContext(request, auth, env, "captures.read"))))
    .put("/api/v1/notes/current", async ({ body, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.update");
      const input = noteCurrentSchema.parse(body);
      return success(await setCurrentNote(context, input.noteId));
    })
    .post("/api/v1/notes/current/clips", async ({ body, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.create");
      const input = noteClipSchema.parse(body);
      return success(await addCurrentClip(context, request, input));
    })

    .get("/api/v1/notes", async ({ query, request }) => success(await listNotes(await getTenantContext(request, auth, env, "captures.read"), noteListQuerySchema.parse(query))))
    .post("/api/v1/notes", async ({ body, request, set }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.create");
      const input = noteCreateSchema.parse(body);
      const result = await runIdempotent(context, "note.create", request.headers.get("idempotency-key"), input, () => createNote(context, request, input) as Promise<Record<string, unknown>>);
      set.status = 201;
      return success(result);
    })
    .get("/api/v1/notes/:id", async ({ params, request }) => success(await getNote(await getTenantContext(request, auth, env, "captures.read"), uuidSchema.parse(params.id))))
    .patch("/api/v1/notes/:id", async ({ body, params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.update");
      return success(await updateNote(context, request, uuidSchema.parse(params.id), notePatchSchema.parse(body)));
    })
    .delete("/api/v1/notes/:id", async ({ params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.delete");
      return success(await trashNote(context, request, uuidSchema.parse(params.id)));
    })
    .post("/api/v1/notes/:id/restore", async ({ params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.update");
      return success(await restoreNote(context, request, uuidSchema.parse(params.id)));
    })

    /** Add a piece of a web page to a doc. */
    .post("/api/v1/notes/:id/clips", async ({ body, params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.create");
      const input = noteClipSchema.parse(body);
      return success(await addClip(context, request, uuidSchema.parse(params.id), input));
    })
    /** Take a piece back out of a doc. */
    .delete("/api/v1/notes/:id/clips/:clipId", async ({ params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.update");
      return success(await removeClipById(context, request, uuidSchema.parse(params.id), String(params.clipId)));
    })

    .get("/api/v1/notes/:id/revisions", async ({ params, request }) => success(await listRevisions(await getTenantContext(request, auth, env, "captures.read"), uuidSchema.parse(params.id))))
    .post("/api/v1/notes/:id/revisions/:revisionId/restore", async ({ params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.update");
      return success(await restoreRevision(context, request, uuidSchema.parse(params.id), uuidSchema.parse(params.revisionId)));
    })

    /** Sort the pieces of a doc again, using the mode the doc is set to. */
    .post("/api/v1/notes/:id/rearrange", async ({ params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.update");
      return success(await rearrangeNote(context, request, uuidSchema.parse(params.id)));
    })

    /** Turn the pieces into writing, with sentences that follow each other. */
    .post("/api/v1/notes/:id/write-up", async ({ body, params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.update");
      return success(await writeUpNote(env, context, request, uuidSchema.parse(params.id), noteAiRequestSchema.parse(body ?? {})));
    })

    /** Let the AI sort the doc into topics. */
    .post("/api/v1/notes/:id/organize", async ({ body, params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.update");
      return success(await organizeNote(env, context, request, uuidSchema.parse(params.id), noteAiRequestSchema.parse(body ?? {})));
    })

    /**
     * Do something with a selection of the doc.
     *
     * The answer is a list of blocks, and it is not written into the doc
     * here: the person sees it first and accepts it, so a change is never
     * made behind their back.
     */
    .post("/api/v1/notes/:id/ai/selection", async ({ body, params, request }) => {
      await requireCsrf(request, auth, env);
      await enforceRateLimit(request, env, RATE_LIMITS.aiSelection);
      const context = await getTenantContext(request, auth, env, "captures.update");
      return success(await selectionAssist(env, context, request, uuidSchema.parse(params.id), noteAiSelectionSchema.parse(body)));
    })

    /**
     * A copy of a doc.
     *
     * The copy starts empty, so it is a new place to write rather than a
     * second copy of everything that was already there.
     */
    .post("/api/v1/notes/:id/duplicate", async ({ body, params, request, set }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.create");
      const result = await runIdempotent(context, "note.duplicate", request.headers.get("idempotency-key"), body ?? {}, () => duplicateNote(context, request, uuidSchema.parse(params.id)) as Promise<Record<string, unknown>>);
      set.status = 201;
      return success(result);
    });
}
