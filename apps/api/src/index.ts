import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { getDatabase } from "@data-vault/database";
import { getServerEnvironment, type ServerEnvironment } from "@data-vault/config";
import { createAuth } from "./auth/better-auth";
import { normalizeError } from "./lib/errors";
import { AppError } from "./lib/errors";
import { success } from "./lib/http";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rate-limit-policies";
import { createAuthRoutes } from "./routes/auth";
import { createAiRoutes } from "./routes/ai";
import { createAiConnectionRoutes } from "./routes/ai-connections";
import { createCaptureRoutes } from "./routes/captures";
import { createExtensionAuthRoutes } from "./routes/extension-auth";
import { createImportRoutes } from "./routes/imports";
import { createMiscRoutes } from "./routes/misc";
import { createNoteRoutes } from "./routes/notes";
import { createOrganizationRoutes } from "./routes/organizations";
import { createRecordRoutes } from "./routes/records";
import { createVaultRoutes } from "./routes/vaults";
import { isTrustedWebOrigin } from "./auth/origins";
import { ensurePermissionCatalog } from "./services/organizations";
import { pruneExpiredRows } from "./services/cleanup";

/**
 * The largest request body the API accepts.
 *
 * A doc holds the pieces of several pages, so the limit is generous, but it
 * is a limit: without one, a single request could ask the server to hold an
 * unbounded amount of text in memory.
 */
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

export function createApp(environment?: ServerEnvironment) {
  const env = environment ?? getServerEnvironment();
  /**
   * Without a proxy in front of the API, every request looks like it came
   * from the same place. The rate limits then fall back to the signed-in
   * account, which is much better than one shared bucket, but the real fix
   * is to say how many proxies are in front of the API.
   */
  if (env.NODE_ENV === "production" && env.trustedProxyHops === 0) {
    console.warn("[datavault] TRUSTED_PROXY_HOPS is 0 in production, so no request address can be trusted. Rate limits are counted per signed-in account instead of per address. Set TRUSTED_PROXY_HOPS to the number of proxies in front of the API.");
  }
  const auth = createAuth(env);
  const extensionId = new URL(env.EXTENSION_REDIRECT_URL).hostname.split(".")[0];
  const extensionOrigin = extensionId && /^[a-p]{32}$/.test(extensionId) ? `chrome-extension://${extensionId}` : null;
  return new Elysia({ name: "data-vault-api" })
    .use(cors({
      origin: (request) => {
        const origin = request.headers.get("origin");
        const isDevelopmentExtension = env.NODE_ENV !== "production" && /^chrome-extension:\/\/[a-p]{32}$/.test(origin ?? "");
        return !origin || isTrustedWebOrigin(origin, env) || origin === extensionOrigin || isDevelopmentExtension;
      },
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-Organization-Id", "Idempotency-Key", "X-Extension-Version"],
      exposeHeaders: ["X-Request-Id"],
    }))
    .use(env.NODE_ENV === "production" ? new Elysia() : openapi({ path: "/api/v1/openapi", documentation: { info: { title: "DataVault API", version: "1.0.0" } } }))
    .onStart(() => ensurePermissionCatalog())
    .onBeforeHandle(async ({ request, set }) => {
      set.headers["x-request-id"] = request.headers.get("x-request-id") ?? crypto.randomUUID();
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["x-frame-options"] = "DENY";
      set.headers["referrer-policy"] = "no-referrer";
      set.headers["cross-origin-resource-policy"] = "same-site";
      set.headers["permissions-policy"] = "camera=(), microphone=(), geolocation=()";
      if (env.NODE_ENV === "production") set.headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
      /**
       * A request body has a size limit.
       *
       * The length is taken from the header the browser sends, which is
       * there for every ordinary request. A body that arrives in chunks
       * has no length to check, so it is refused rather than taken on
       * trust. The fields themselves carry their own limits as well, so a
       * piece of a page cannot be larger than a doc is allowed to be.
       */
      const contentType = request.headers.get("content-type") ?? "";
      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      if (hasBody && !contentType.startsWith("multipart/form-data")) {
        const declaredLength = request.headers.get("content-length");
        if (declaredLength !== null) {
          const length = Number(declaredLength);
          if (!Number.isFinite(length) || length < 0) {
            throw new AppError(400, "INVALID_CONTENT_LENGTH", "That request could not be read.");
          }
          if (length > MAX_REQUEST_BYTES) {
            throw new AppError(413, "REQUEST_TOO_LARGE", "That request is too large.");
          }
        } else if (request.headers.get("transfer-encoding")?.toLowerCase().includes("chunked")) {
          throw new AppError(411, "LENGTH_REQUIRED", "Send the request with a Content-Length header.");
        }
      }
      const path = new URL(request.url).pathname;
      /**
       * Better Auth's own endpoints are reachable directly, so they need a
       * limit of their own. Otherwise the limits on our wrapper routes could
       * be side-stepped by calling the internal handler.
       */
      if (path.startsWith("/api/v1/internal-auth/")) {
        await enforceRateLimit(request, env, RATE_LIMITS.internalAuth);
      }
      /**
       * Accounts are only created through our own route, which checks the
       * captcha and refuses throwaway addresses. Reached directly, the
       * internal sign-up endpoint would skip both of those checks.
       */
      /**
       * The one-time-code endpoints are not used by any client. Reached
       * directly they would sign a person in without the second factor, and
       * would create accounts without the captcha, so they are closed.
       */
      if (path.startsWith("/api/v1/internal-auth/") && path.includes("email-otp")) {
        throw new AppError(404, "NOT_FOUND", "Not found.");
      }
      if (path === "/api/v1/internal-auth/sign-up/email") {
        throw new AppError(404, "NOT_FOUND", "Use /api/v1/auth/register to create an account.");
      }
      /**
       * Each kind of request gets its own budget.
       *
       * Renewing the extension sign-in used to share the sign-in budget with
       * everything else, so saving a few items in a row could answer the
       * renewal with a rate-limit error and sign the user out.
       */
      if (request.method === "POST") {
        if (path.startsWith("/api/v1/extension/auth/refresh")) {
          await enforceRateLimit(request, env, RATE_LIMITS.extensionRefresh);
        } else if (path.endsWith("/captures") || path.startsWith("/api/v1/notes")) {
          await enforceRateLimit(request, env, RATE_LIMITS.captures);
        } else if (/\/auth\//.test(path)) {
          await enforceRateLimit(request, env, RATE_LIMITS.internalAuth);
        }
      }
    })
    .onError(({ error, request, set }) => {
      const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
      const normalized = normalizeError(error, requestId);
      set.status = normalized.status;
      set.headers["x-request-id"] = requestId;
      return normalized.body;
    })
    .get("/api/v1/live", () => success({ status: "ok", service: "data-vault-api" }))
    .get("/api/v1/health", async ({ set }) => {
      try {
        await getDatabase().execute(sql`select 1`);
        return success({ status: "ok", service: "data-vault-api" });
      } catch {
        set.status = 503;
        return success({ status: "unavailable", service: "data-vault-api" });
      }
    })
    .all("/api/v1/internal-auth/*", ({ request }) => auth.handler(request))
    .use(createAuthRoutes(auth, env))
    .use(createAiRoutes(auth, env))
    .use(createAiConnectionRoutes(auth, env))
    .use(createOrganizationRoutes(auth, env))
    .use(createRecordRoutes(auth, env))
    .use(createVaultRoutes(auth, env))
    .use(createCaptureRoutes(auth, env))
    .use(createNoteRoutes(auth, env))
    .use(createImportRoutes(auth, env))
    .use(createExtensionAuthRoutes(auth, env))
    .use(createMiscRoutes(auth, env));
}

export const app = createApp();

if (import.meta.main) {
  const env = getServerEnvironment();
  /**
   * The server refuses a body that is too large, so the limit is set on the
   * server as well. A request that arrives in chunks is turned away before
   * it is read, because there is no length to check.
   */
  app.listen({
    port: env.API_PORT,
    maxRequestBodySize: MAX_REQUEST_BYTES,
  });
  console.log(`DataVault API listening on port ${app.server?.port ?? env.API_PORT} (${env.API_URL})`);

  /**
   * The rows that expire are cleaned up every six hours.
   *
   * The answers that are waiting to be applied, the request keys and the
   * rate-limit buckets are all of no use once their time has passed, and
   * they would otherwise grow for ever.
   */
  const cleanupTimer = setInterval(() => {
    void pruneExpiredRows().catch((error: unknown) => {
      console.warn(JSON.stringify({
        level: "warn",
        event: "cleanup_failed",
        message: error instanceof Error ? error.message : String(error),
      }));
    });
  }, 6 * 60 * 60 * 1000);

  /** Finish the requests in flight, then close the database before exiting. */
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
    clearInterval(cleanupTimer);
    const forced = setTimeout(() => process.exit(1), 10_000);
    try {
      await app.stop();
      await (getDatabase() as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    } catch (error) {
      console.error(error);
    }
    clearTimeout(forced);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

export type App = typeof app;
