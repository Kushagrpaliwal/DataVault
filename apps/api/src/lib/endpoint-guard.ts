import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { AppError } from "./errors";
import type { ServerEnvironment } from "@data-vault/config";

/**
 * The addresses the server must not call.
 *
 * The base address of a model is written by a person, so the server ends up
 * calling whatever they wrote. Without a check, that is a way of reaching
 * things that are not meant to be reached from the internet: the machine the
 * server runs on, the network it sits in, and the address that holds the
 * credentials of the cloud it runs in.
 */

/**
 * Is this address one of the private ones?
 *
 * The list covers the addresses of the machine itself, the networks that
 * are not reachable from outside, and the address that holds the
 * credentials of the cloud.
 */
export function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  const kind = isIP(value);
  if (kind === 4) {
    const parts = value.split(".").map(Number);
    const [a = 0, b = 0] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (kind === 6) {
    if (value === "::1" || value === "::") return true;
    /**
     * The addresses that are written in a few ways: the local one, the one
     * that stands for the local network, and the one that holds the
     * credentials of the cloud.
     */
    if (value.startsWith("fe80")) return true;
    if (value.startsWith("fc") || value.startsWith("fd")) return true;
    if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
    if (value.startsWith("2001:db8")) return true;
    return false;
  }
  return false;
}

/**
 * Check an address before the server calls it.
 *
 * The address must be one the server may reach: it must use https, and it
 * must not point at the machine or at a network that is not open to the
 * internet. A person who runs a model on their own network can allow that
 * with a setting, because that is their own network to open.
 *
 * The name is looked up as well, because a name that points at a private
 * address is the same thing with a friendlier face.
 */
export async function assertSafeEndpoint(env: ServerEnvironment, rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(400, "AI_ENDPOINT_INVALID", "That address is not one the server can call.");
  }
  if (url.protocol !== "https:" && !(env.aiAllowPrivateEndpoints && url.protocol === "http:")) {
    throw new AppError(400, "AI_ENDPOINT_INVALID", "The address must use https.");
  }
  if (env.aiAllowPrivateEndpoints) return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new AppError(400, "AI_ENDPOINT_BLOCKED", "That address is on the local network, which the server does not call. Set AI_ALLOW_PRIVATE_ENDPOINTS to allow it.");
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new AppError(400, "AI_ENDPOINT_BLOCKED", "That address is on the local network, which the server does not call. Set AI_ALLOW_PRIVATE_ENDPOINTS to allow it.");
    return url;
  }
  /**
   * The name is resolved, because a name may point at a private address.
   */
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new AppError(400, "AI_ENDPOINT_INVALID", "That address could not be found.");
  }
  if (!addresses.length) throw new AppError(400, "AI_ENDPOINT_INVALID", "That address could not be found.");
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new AppError(400, "AI_ENDPOINT_BLOCKED", "That address is on the local network, which the server does not call. Set AI_ALLOW_PRIVATE_ENDPOINTS to allow it.");
  }
  return url;
}

/**
 * The options every call to a model is made with.
 *
 * A redirect is not followed, because a redirect can take the call to an
 * address that was never checked. The call is given a time to live, so that
 * a provider that does not answer does not hold the server for ever.
 */
export function guardedFetchOptions(timeoutMs = 60_000): RequestInit {
  return { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) };
}
