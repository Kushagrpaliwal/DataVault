import { Elysia } from "elysia";
import { z } from "zod";
import { paginationQuerySchema, searchQuerySchema, uuidSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { getDashboard } from "../services/dashboard";
import { globalSearch } from "../services/search";
import { listAuditLogs } from "../services/audit";
import { getAttachment, saveScreenshot } from "../services/attachments";

const auditQuerySchema = paginationQuerySchema.extend({ resourceType: z.string().max(80).optional() });

export function createMiscRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "misc-routes" })
    .get("/api/v1/dashboard", async ({ request }) => success(await getDashboard(await getTenantContext(request, auth, env, "reports.read"))))
    .get("/api/v1/audit-logs", async ({ query, request }) => success(await listAuditLogs(await getTenantContext(request, auth, env, "reports.read"), auditQuerySchema.parse(query))))
    .get("/api/v1/search", async ({ query, request }) => success(await globalSearch(await getTenantContext(request, auth, env, "captures.read"), searchQuerySchema.parse(query))))
    .post("/api/v1/saved-records/:id/attachments", async ({ params, request, set }) => { await requireCsrf(request, auth, env); set.status = 201; return success(await saveScreenshot(await getTenantContext(request, auth, env, "captures.update"), request, env, uuidSchema.parse(params.id))); })
    .get("/api/v1/attachments/:id", async ({ params, request, set }) => { const attachment = await getAttachment(await getTenantContext(request, auth, env, "captures.read"), uuidSchema.parse(params.id)); set.headers["content-type"] = attachment.mimeType; set.headers["content-disposition"] = `inline; filename="${attachment.fileName.replaceAll('"', "")}"`; return attachment.content; });
}
