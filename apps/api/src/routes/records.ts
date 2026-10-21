import { Elysia } from "elysia";
import { savedRecordCreateSchema, savedRecordListQuerySchema, savedRecordPatchSchema, savedRecordViewSchema, uuidSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { createSavedRecord, createSavedView, deleteSavedView, getSavedRecord, listSavedRecords, listSavedViews, restoreTrashedRecord, setRecordArchived, trashSavedRecord, updateSavedRecord } from "../services/records";
import { runIdempotent } from "../services/idempotency";

export function createRecordRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "record-routes" })
    .get("/api/v1/saved-records", async ({ query, request }) => success(await listSavedRecords(await getTenantContext(request, auth, env, "captures.read"), savedRecordListQuerySchema.parse(query))))
    .get("/api/v1/saved-records/:id", async ({ params, request }) => success(await getSavedRecord(await getTenantContext(request, auth, env, "captures.read"), uuidSchema.parse(params.id))))
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
