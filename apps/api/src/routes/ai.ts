import { Elysia } from "elysia";
import { z } from "zod";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { AppError } from "../lib/errors";
import { success } from "../lib/http";
import { enforceRateLimit, RATE_LIMITS } from "../lib/rate-limit-policies";
import { loadItemText, ownConnectionSummary, runAiFeature } from "../services/ai";

const summarySchema = z.object({ recordId: z.string().uuid().optional(), text: z.string().max(200_000).optional() });
const classifySchema = z.object({ recordId: z.string().uuid().optional(), text: z.string().max(200_000).optional() });
const extractSchema = z.object({ recordId: z.string().uuid().optional(), text: z.string().max(200_000).optional() });
export function createAiRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "ai-routes" })
    .get("/api/v1/ai/status", async ({ request }) => {
      const context = await getTenantContext(request, auth, env, "ai.use");
      const ownConnection = await ownConnectionSummary(env, context.userId);
      const available = Boolean(ownConnection?.keyReadable);
      return success({
        available,
        ownConnection,
        reason: available ? null : ownConnection
          ? "Your saved provider key cannot be read. Re-enter it in Settings."
          : "Connect an AI provider in Settings to use AI features.",
      });
    })
    .post("/api/v1/ai/summarize", async ({ body, request }) => {
      await requireCsrf(request, auth, env);
      await enforceRateLimit(request, env, { ...RATE_LIMITS.ai, max: env.AI_USER_MINUTE_REQUESTS });
      const input = summarySchema.parse(body);
      const { userId, organizationId } = await context(request, auth, env);
      const text = await resolveText({ userId, organizationId }, input);
      const result = await runAiFeature(env, { userId, organizationId }, "summarize", text, requestId(request, userId), { idempotencyKey: request.headers.get("idempotency-key") ?? undefined });
      return success(result);
    })
    .post("/api/v1/ai/classify", async ({ body, request }) => {
      await requireCsrf(request, auth, env);
      await enforceRateLimit(request, env, { ...RATE_LIMITS.ai, max: env.AI_USER_MINUTE_REQUESTS });
      const input = classifySchema.parse(body);
      const { userId, organizationId } = await context(request, auth, env);
      const text = await resolveText({ userId, organizationId }, input);
      const result = await runAiFeature(env, { userId, organizationId }, "classify", text, requestId(request, userId), { idempotencyKey: request.headers.get("idempotency-key") ?? undefined });
      return success(result);
    })
    .post("/api/v1/ai/extract", async ({ body, request }) => {
      await requireCsrf(request, auth, env);
      await enforceRateLimit(request, env, { ...RATE_LIMITS.ai, max: env.AI_USER_MINUTE_REQUESTS });
      const input = extractSchema.parse(body);
      const { userId, organizationId } = await context(request, auth, env);
      const text = await resolveText({ userId, organizationId }, input);
      const result = await runAiFeature(env, { userId, organizationId }, "extract", text, requestId(request, userId), { idempotencyKey: request.headers.get("idempotency-key") ?? undefined });
      return success(result);
    });
}

async function context(request: Request, auth: DataVaultAuth, env: ServerEnvironment) {
  const tenant = await getTenantContext(request, auth, env, "ai.use");
  return { userId: tenant.userId, organizationId: tenant.organizationId };
}

async function resolveText(
  scope: { userId: string; organizationId: string },
  input: { recordId?: string | undefined; text?: string | undefined },
): Promise<string> {
  if (input.text?.trim()) return input.text;
  if (input.recordId) {
    const loaded = await loadItemText(scope, input.recordId);
    return loaded.text;
  }
  throw new AppError(400, "AI_NO_INPUT", "Choose a saved item, or paste some text.");
}

/** Give each account its own usage-event namespace for a client request key. */
function requestId(request: Request, userId: string): string {
  const key = request.headers.get("idempotency-key");
  return key ? `${userId}:${key}` : crypto.randomUUID();
}
