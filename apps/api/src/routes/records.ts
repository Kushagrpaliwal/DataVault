import { Elysia } from "elysia";
import { savedRecordCreateSchema, savedRecordListQuerySchema, savedRecordPatchSchema, savedRecordViewSchema, uuidSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { createSavedRecord, createSavedView, deleteSavedView, getPageSnapshot, getSavedRecord, listSavedRecords, listSavedViews, restoreTrashedRecord, setRecordArchived, trashSavedRecord, updateSavedRecord } from "../services/records";
import { runIdempotent } from "../services/idempotency";
import { AppError } from "../lib/errors";

export function createRecordRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "record-routes" })
    .get("/api/v1/saved-records", async ({ query, request }) => success(await listSavedRecords(await getTenantContext(request, auth, env, "captures.read"), savedRecordListQuerySchema.parse(query))))
    .get("/api/v1/saved-records/:id", async ({ params, request }) => success(await getSavedRecord(await getTenantContext(request, auth, env, "captures.read"), uuidSchema.parse(params.id))))
    /**
     * The page as it was, when the item was saved.
     *
     * The page is served in a sandbox, so nothing in it can run and
     * nothing in it can reach the page that is showing it.
     */
    .get("/api/v1/saved-records/:id/snapshot", async ({ params, request, set }) => {
      const context = await getTenantContext(request, auth, env, "captures.read");
      const snapshot = await getPageSnapshot(context, uuidSchema.parse(params.id));
      if (!snapshot) throw new AppError(404, "SNAPSHOT_NOT_FOUND", "There is no snapshot of the page for this item.");
      set.headers["content-type"] = "text/html; charset=utf-8";
      set.headers["content-security-policy"] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";
      set.headers["x-content-type-options"] = "nosniff";
      const title = snapshot.title ? snapshot.title.replace(/[<>&"]/g, "") : "The page as it was";
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px/1.6 system-ui,sans-serif;margin:2rem auto;max-width:44rem;padding:0 1rem;color:#1a1a1a}img{max-width:100%;height:auto}a{color:#2b6cb0}</style></head><body>${snapshot.html}</body></html>`;
    })
    .post("/api/v1/saved-records", async ({ body, request, set }) => { await requireCsrf(request, auth, env); const context = await getTenantContext(request, auth, env, "captures.create"); const input = savedRecordCreateSchema.parse(body); const result = await runIdempotent(context, "saved-record.create", request.headers.get("idempotency-key"), input, () => createSavedRecord(context, request, input) as Promise<Record<string, unknown>>); set.status = 201; return success(result); })
    .patch("/api/v1/saved-records/:id", async ({ body, params, request }) => { await requireCsrf(request, auth, env); const context = await getTenantContext(request, auth, env, "captures.update"); return success(await updateSavedRecord(context, request, uuidSchema.parse(params.id), savedRecordPatchSchema.parse(body))); })
    .post("/api/v1/saved-records/:id/archive", async ({ params, request }) => { await requireCsrf(request, auth, env); const context = await getTenantContext(request, auth, env, "captures.update"); return success(await setRecordArchived(context, request, uuidSchema.parse(params.id), true)); })
    .post("/api/v1/saved-records/:id/restore", async ({ params, request }) => { await requireCsrf(request, auth, env); const context = await getTenantContext(request, auth, env, "captures.update"); return success(await setRecordArchived(context, request, uuidSchema.parse(params.id), false)); })
    .post("/api/v1/saved-records/:id/trash/restore", async ({ params, request }) => { await requireCsrf(request, auth, env); const context = await getTenantContext(request, auth, env, "captures.update"); return success(await restoreTrashedRecord(context, request, uuidSchema.parse(params.id))); })
    .delete("/api/v1/saved-records/:id", async ({ params, request }) => { await requireCsrf(request, auth, env); const context = await getTenantContext(request, auth, env, "captures.delete"); return success(await trashSavedRecord(context, request, uuidSchema.parse(params.id))); })
    .get("/api/v1/saved-views", async ({ request }) => success(await listSavedViews(await getTenantContext(request, auth, env, "captures.read"))))
    .post("/api/v1/saved-views", async ({ body, request, set }) => { await requireCsrf(request, auth, env); set.status = 201; return success(await createSavedView(await getTenantContext(request, auth, env, "captures.read"), savedRecordViewSchema.parse(body))); })
    .delete("/api/v1/saved-views/:id", async ({ params, request }) => { await requireCsrf(request, auth, env); return success(await deleteSavedView(await getTenantContext(request, auth, env, "captures.read"), uuidSchema.parse(params.id))); });
}
