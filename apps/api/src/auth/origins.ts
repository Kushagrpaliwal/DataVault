import type { ServerEnvironment } from "@data-vault/config";

function isLoopbackDevelopmentOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isTrustedWebOrigin(origin: string, env: ServerEnvironment) {
  return env.allowedOrigins.includes(origin) || (env.NODE_ENV !== "production" && isLoopbackDevelopmentOrigin(origin));
}

export function trustedOriginsFor(request: Request | undefined, env: ServerEnvironment) {
  const origin = request?.headers.get("origin");
  return origin && isTrustedWebOrigin(origin, env) ? [...env.allowedOrigins, origin] : env.allowedOrigins;
}
