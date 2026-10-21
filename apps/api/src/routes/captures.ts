import { Elysia } from "elysia";
import { captureCreateSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { createCapture, recentCaptures } from "../services/captures";
import { runIdempotent } from "../services/idempotency";

export function createCaptureRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "capture-routes" })
    .post("/api/v1/captures", async ({ body, request, set }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "captures.create");
      const input = captureCreateSchema.parse(body);
      const result = await runIdempotent(context, "capture.create", request.headers.get("idempotency-key"), input, () => createCapture(context, request, input));
      set.status = 201;
      return success(result);
    })
    .get("/api/v1/captures/recent", async ({ request }) => success(await recentCaptures(await getTenantContext(request, auth, env, "captures.read"))));
}
