import { Elysia } from "elysia";
import { z } from "zod";
import { paginationQuerySchema, searchQuerySchema, uuidSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { enforceRateLimit, RATE_LIMITS } from "../lib/rate-limit-policies";
import { getDashboard } from "../services/dashboard";
import { globalSearch } from "../services/search";
import { listAuditLogs } from "../services/audit";
import { getAttachment, saveScreenshot } from "../services/attachments";
import { embedQuery, reindexWorkspace, semanticSearch } from "../services/semantic";
import { AppError } from "../lib/errors";

const auditQuerySchema = paginationQuerySchema.extend({ resourceType: z.string().max(80).optional() });

export function createMiscRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "misc-routes" })
    .get("/api/v1/dashboard", async ({ request }) => success(await getDashboard(await getTenantContext(request, auth, env, "reports.read"))))
    .get("/api/v1/audit-logs", async ({ query, request }) => success(await listAuditLogs(await getTenantContext(request, auth, env, "reports.read"), auditQuerySchema.parse(query))))
    .get("/api/v1/search", async ({ query, request }) => success(await globalSearch(await getTenantContext(request, auth, env, "captures.read"), searchQuerySchema.parse(query))))
    /**
     * A search by meaning.
     *
     * The words of the question are turned into numbers, and the items whose
     * numbers are close to them are the ones that mean the same thing. An
     * item about the sea is found by a question that never says the word
     * sea.
     *
     * Embeddings are generated through the person's connected provider.
     * The request is rate limited and requires the AI permission.
     */
    .get("/api/v1/search/semantic", async ({ query, request }) => {
      await enforceRateLimit(request, env, RATE_LIMITS.semanticSearch);
      const context = await getTenantContext(request, auth, env, "captures.read");
      if (!context.permissions.has("ai.use")) throw new AppError(403, "PERMISSION_DENIED", "You do not have permission to use AI features in this workspace.");
      const input = searchQuerySchema.parse(query);
      const embedded = await embedQuery(env, context, input.q);
      return success(await semanticSearch(context, embedded.values, embedded.model, input.limit));
    })
    /**
     * Make the numbers of every item in the workspace again.
     *
     * It is what is needed after the model has changed, or after material
     * has been brought in from somewhere else.
     */
    .post("/api/v1/search/semantic/reindex", async ({ request }) => {
      await requireCsrf(request, auth, env);
      await enforceRateLimit(request, env, RATE_LIMITS.semanticReindex);
      const context = await getTenantContext(request, auth, env, "captures.update");
      if (!context.permissions.has("ai.use")) throw new AppError(403, "PERMISSION_DENIED", "You do not have permission to use AI features in this workspace.");
      return success(await reindexWorkspace(context, env));
    })
    .post("/api/v1/saved-records/:id/attachments", async ({ params, request, set }) => { await requireCsrf(request, auth, env); set.status = 201; return success(await saveScreenshot(await getTenantContext(request, auth, env, "captures.update"), request, env, uuidSchema.parse(params.id))); })
    .get("/api/v1/attachments/:id", async ({ params, request, set }) => { const attachment = await getAttachment(await getTenantContext(request, auth, env, "captures.read"), uuidSchema.parse(params.id)); set.headers["content-type"] = attachment.mimeType; set.headers["content-disposition"] = `inline; filename="${attachment.fileName.replaceAll('"', "")}"`; return attachment.content; });
}
