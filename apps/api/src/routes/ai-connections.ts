import { Elysia } from "elysia";
import { aiConnectionCreateSchema, aiConnectionPatchSchema, aiConnectionTestSchema, uuidSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { createConnection, deleteConnection, listConnections, patchConnection, testConnection } from "../services/ai-connections";

/**
 * The model providers a person connects themselves.
 *
 * The key is write-only: it goes in and it is never sent back. The list
 * shows the last four of it, which is enough to tell two keys apart.
 */
export function createAiConnectionRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "ai-connection-routes" })
    .get("/api/v1/ai/connections", async ({ request }) => {
      const context = await getTenantContext(request, auth, env, "ai.use");
      return success(await listConnections(context.userId));
    })
    .post("/api/v1/ai/connections", async ({ body, request, set }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "ai.use");
      const input = aiConnectionCreateSchema.parse(body);
      const created = await createConnection(env, context, request, input);
      set.status = 201;
      return success(created);
    })
    .patch("/api/v1/ai/connections/:id", async ({ body, params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "ai.use");
      const input = aiConnectionPatchSchema.parse(body);
      return success(await patchConnection(env, context, request, uuidSchema.parse(params.id), input));
    })
    .delete("/api/v1/ai/connections/:id", async ({ params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "ai.use");
      await deleteConnection(context, uuidSchema.parse(params.id));
      return success({ id: uuidSchema.parse(params.id) });
    })
    /**
     * Try a provider and ask it which models it has.
     *
     * The provider may be one that is already saved, or one that is being
     * set up, so that a person can see whether it works before they keep it.
     */
    .post("/api/v1/ai/connections/test", async ({ body, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "ai.use");
      const input = aiConnectionTestSchema.parse(body);
      return success(await testConnection(env, context, input));
    });
}
