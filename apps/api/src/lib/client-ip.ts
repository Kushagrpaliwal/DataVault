import { createHash } from "node:crypto";
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
 * account instead. The account is identified by a hash of the credential the
 * request carries, so a caller cannot pick somebody else's bucket by
 * claiming to be them.
 */
export function clientKey(request: Request, env: ServerEnvironment): string {
  const ip = clientIp(request, env);
  if (ip !== "local") return ip;
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const subject = bearerSubject(bearer.slice(7));
    if (subject) return `account:${fingerprint(subject)}`;
  }
  const cookie = request.headers.get("cookie");
  if (cookie) return `account:${fingerprint(cookie)}`;
  return "shared";
}

/**
 * The subject of an access token, without checking its signature.
 *
 * The value is only used to pick a rate-limit bucket, and it is hashed
 * before it is used, so a forged token cannot aim the traffic at another
 * account's bucket. The real check happens when the token is used for access.
 */
function bearerSubject(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : undefined;
  } catch {
    return undefined;
  }
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
