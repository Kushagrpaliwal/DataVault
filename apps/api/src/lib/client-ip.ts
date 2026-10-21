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
