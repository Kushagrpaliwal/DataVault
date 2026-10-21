import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { jwtVerify } from "jose";
import { getDatabase, sessions } from "@data-vault/database";
import type { ServerEnvironment } from "@data-vault/config";

/**
 * Resolve the address a request really came from.
 *
 * X-Forwarded-For is attacker-controlled unless a trusted proxy sits in front
 * of the API and rewrites it. When no proxy is configured we ignore the header
 * entirely, otherwise anyone could rotate the value and walk past every rate
 * limit.
 */
export function clientIp(request: Request, env: ServerEnvironment): string {
  if (env.trustedProxyHops > 0) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const chain = forwarded.split(",").map((entry) => entry.trim()).filter(Boolean);
      // The right-most entries were appended by proxies we trust.
      const candidate = chain[chain.length - env.trustedProxyHops];
      if (candidate) return normalizeIp(candidate);
    }
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp && env.trustedProxyHops > 0) return normalizeIp(realIp);
  return "local";
}

/**
 * The bucket a request should be counted against.
 *
 * The address is the right key, but only when it can be trusted. With no
 * proxy in front of the API every request looks like it came from the same
 * place, so every user shares one budget and a single person can lock
 * everybody else out.
 *
 * When the address cannot be resolved, the budget follows the signed-in
 * account instead. The account is only known when the credential has been
 * checked, so a caller cannot mint a fresh budget by adding a made-up
 * cookie or a made-up token to the request. A request with no credential
 * that checks out shares one budget with everybody else.
 */
export async function clientKey(request: Request, env: ServerEnvironment): Promise<string> {
  const ip = clientIp(request, env);
  if (ip !== "local") return ip;
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const subject = await verifiedBearerSubject(bearer.slice(7), env);
    if (subject) return `account:${fingerprint(subject)}`;
  }
  const session = await confirmedSessionToken(request);
  if (session) return `account:${fingerprint(session)}`;
  return "shared";
}

/**
 * The subject of an access token, once the token has been checked.
 *
 * The signature is verified and the claims are read from the token that was
 * signed, so a made-up token never reaches the rate limiter.
 */
async function verifiedBearerSubject(token: string, env: ServerEnvironment): Promise<string | undefined> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), { issuer: env.API_URL, audience: "data-vault-extension" });
    return typeof payload.sub === "string" && payload.sub ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The token of the session a request carries, once the session is confirmed.
 *
 * The cookie holds the token and a signature. The token is looked up in the
 * table of sessions, so a cookie that was made up finds nothing and the
 * request falls back to the shared budget.
 */
async function confirmedSessionToken(request: Request): Promise<string | undefined> {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name.endsWith(".session_token")) continue;
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    const token = value.split(".")[0];
    if (!token) continue;
    const [row] = await getDatabase()
      .select({ token: sessions.token })
      .from(sessions)
      .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (row) return row.token;
  }
  return undefined;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function normalizeIp(value: string): string {
  // Strip an IPv4 port suffix, and the IPv6 bracket form.
  if (value.startsWith("[")) {
    const closing = value.indexOf("]");
    if (closing !== -1) return value.slice(1, closing).toLowerCase();
  }
  const colon = value.indexOf(":");
  if (colon !== -1 && value.indexOf(":") === value.lastIndexOf(":")) return value.slice(0, colon);
  return value.toLowerCase();
}
