import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "./better-auth";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/crypto";
import { isTrustedWebOrigin } from "./origins";

export async function csrfForRequest(request: Request, auth: DataVaultAuth, env: ServerEnvironment) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  return sha256(`${session.session.token}:${env.SESSION_SECRET}`);
}

export async function requireCsrf(request: Request, auth: DataVaultAuth, env: ServerEnvironment) {
  if (request.headers.get("authorization")?.startsWith("Bearer ")) return;
  const origin = request.headers.get("origin");
  if (origin && !isTrustedWebOrigin(origin, env)) throw new AppError(403, "ORIGIN_DENIED", "This request origin is not allowed.");
  const expected = await csrfForRequest(request, auth, env);
  if (!expected || request.headers.get("x-csrf-token") !== expected) throw new AppError(403, "CSRF_VALIDATION_FAILED", "Refresh the page and try again.");
}
