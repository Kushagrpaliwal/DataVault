import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { getServerEnvironment } from "@data-vault/config";
import { createAuth } from "./auth/better-auth";
import { normalizeError } from "./lib/errors";
import { success } from "./lib/http";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rate-limit-policies";
import { createAuthRoutes } from "./routes/auth";
import { createAiRoutes } from "./routes/ai";
import { createCaptureRoutes } from "./routes/captures";
import { createExtensionAuthRoutes } from "./routes/extension-auth";
import { createInvoiceRoutes } from "./routes/invoices";
import { createMiscRoutes } from "./routes/misc";
import { createNoteRoutes } from "./routes/notes";
import { createOrganizationRoutes } from "./routes/organizations";
import { createPartyRoutes } from "./routes/parties";
import { createPaymentRoutes } from "./routes/payments";
import { createRecordRoutes } from "./routes/records";
import { createVaultRoutes } from "./routes/vaults";
import { isTrustedWebOrigin } from "./auth/origins";
import { ensurePermissionCatalog } from "./services/organizations";

export function createApp() {
  const env = getServerEnvironment();
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
    .use(openapi({ path: "/api/v1/openapi", documentation: { info: { title: "DataVault API", version: "1.0.0" } } }))
    .onStart(() => ensurePermissionCatalog())
    .onBeforeHandle(async ({ request, set }) => {
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["x-frame-options"] = "DENY";
      set.headers["referrer-policy"] = "no-referrer";
      set.headers["permissions-policy"] = "camera=(), microphone=(), geolocation=()";
      if (env.NODE_ENV === "production") set.headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
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
        } else if (/\/auth\//.test(path) || path.endsWith("/refund")) {
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
    .get("/api/v1/health", () => success({ status: "ok", service: "data-vault-api" }))
    .all("/api/v1/internal-auth/*", ({ request }) => auth.handler(request))
    .use(createAuthRoutes(auth, env))
    .use(createAiRoutes(auth, env))
    .use(createOrganizationRoutes(auth, env))
    .use(createRecordRoutes(auth, env))
    .use(createVaultRoutes(auth, env))
    .use(createPaymentRoutes(auth, env))
    .use(createPartyRoutes(auth, env))
    .use(createInvoiceRoutes(auth, env))
    .use(createCaptureRoutes(auth, env))
    .use(createNoteRoutes(auth, env))
    .use(createExtensionAuthRoutes(auth, env))
    .use(createMiscRoutes(auth, env));
}

export const app = createApp();

if (import.meta.main) {
  app.listen(Number(process.env.API_PORT ?? 3000));
  console.log(`DataVault API listening on http://localhost:${app.server?.port ?? 3000}`);
}

export type App = typeof app;
