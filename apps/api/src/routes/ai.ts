import { Elysia } from "elysia";
import { z } from "zod";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getActor, getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { AppError } from "../lib/errors";
import { success } from "../lib/http";
import { enforceRateLimit, RATE_LIMITS } from "../lib/rate-limit-policies";import { listCreditActivity, readCreditStatus } from "../services/ai-credits";
import { grantConsent, loadItemText, runAiFeature } from "../services/ai";

const summarySchema = z.object({ recordId: z.string().uuid().optional(), text: z.string().max(200_000).optional() });
const classifySchema = z.object({ recordId: z.string().uuid().optional(), text: z.string().max(200_000).optional() });
const extractSchema = z.object({ recordId: z.string().uuid().optional(), text: z.string().max(200_000).optional() });
const consentSchema = z.object({ accepted: z.literal(true) });

export function createAiRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "ai-routes" })
    /** The current allowance, and why the AI features are unavailable if they are. */
    .get("/api/v1/ai/credits", async ({ request }) => {
      const actor = await getActor(request, auth, env);
      const organizationId = request.headers.get("x-organization-id");
      if (!organizationId) throw new AppError(400, "ORGANIZATION_REQUIRED", "Select a workspace to continue.");
      const status = await readCreditStatus(env, { userId: actor.userId, organizationId });
      return success(status);
    })
    /** Recent credit movements, so the user can see where their allowance went. */
    .get("/api/v1/ai/activity", async ({ request }) => {
      const actor = await getActor(request, auth, env);
      const organizationId = request.headers.get("x-organization-id");
      if (!organizationId) throw new AppError(400, "ORGANIZATION_REQUIRED", "Select a workspace to continue.");
      return success(await listCreditActivity({ userId: actor.userId, organizationId }));
    })
    /** Record the agreement to send content to the model provider. */
    .post("/api/v1/ai/consent", async ({ body, request }) => {
      await requireCsrf(request, auth, env);
      consentSchema.parse(body);
      const actor = await getActor(request, auth, env);
      await grantConsent(actor.userId);
      return success({ consented: true });
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

/**
 * A stable identifier for one attempt.
 *
 * The client sends an Idempotency-Key, so a retry after a network blip is
 * charged once rather than twice. The key is scoped to the account, so one
 * person cannot spend another person's request by guessing their key.
 */
function requestId(request: Request, userId: string): string {
  const key = request.headers.get("idempotency-key");
  return key ? `${userId}:${key}` : crypto.randomUUID();
}
