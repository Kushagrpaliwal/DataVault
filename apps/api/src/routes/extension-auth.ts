import { Elysia } from "elysia";
import { extensionAuthApproveSchema, extensionAuthExchangeSchema, extensionAuthStartSchema, extensionRefreshSchema, uuidSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getActor } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { approveExtensionAuthorization, exchangeExtensionCode, listExtensionSessions, logoutExtensionSession, refreshExtensionSession, revokeExtensionSession, startExtensionAuthorization } from "../services/extension-auth";

export function createExtensionAuthRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "extension-auth-routes" })
    .post("/api/v1/extension/auth/start", ({ body }) => success(startExtensionAuthorization(env, extensionAuthStartSchema.parse(body))))
    .post("/api/v1/extension/auth/approve", async ({ body, request }) => {
      await requireCsrf(request, auth, env);
      const actor = await getActor(request, auth, env);
      return success(await approveExtensionAuthorization(env, actor.userId, extensionAuthApproveSchema.parse(body)));
    })
    .post("/api/v1/extension/auth/exchange", async ({ body, request }) => success(await exchangeExtensionCode(env, request, extensionAuthExchangeSchema.parse(body))))
    .post("/api/v1/extension/auth/refresh", async ({ body }) => success(await refreshExtensionSession(env, extensionRefreshSchema.parse(body).refreshToken)))
    .post("/api/v1/extension/auth/logout", async ({ body }) => { await logoutExtensionSession(extensionRefreshSchema.parse(body).refreshToken); return success(null); })
    .get("/api/v1/extension/sessions", async ({ request }) => success(await listExtensionSessions((await getActor(request, auth, env)).userId)))
    .post("/api/v1/extension/sessions/:id/revoke", async ({ params, request }) => {
      await requireCsrf(request, auth, env);
      const actor = await getActor(request, auth, env);
      await revokeExtensionSession(actor.userId, uuidSchema.parse(params.id));
      return success(null);
    });
}
