import type { ServerEnvironment } from "@data-vault/config";
import { AppError } from "../lib/errors";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Check a Turnstile token with Cloudflare.
 *
 * Better Auth's captcha plugin only runs for requests that arrive over HTTP,
 * so our own sign-up route, which calls the sign-up endpoint directly, has to
 * make this check itself. Without it the captcha could be walked around by
 * calling the endpoint the way our route does.
 *
 * When no secret is configured the captcha is switched off, and there is
 * nothing to check.
 */
export async function verifyTurnstile(env: ServerEnvironment, token: string | null, remoteIp?: string): Promise<void> {
  if (!env.turnstileSecretKey) return;
  if (!token) throw new AppError(400, "CAPTCHA_REQUIRED", "Please finish the captcha and try again.");
  const body = new URLSearchParams({ secret: env.turnstileSecretKey, response: token });
  if (remoteIp && remoteIp !== "local") body.set("remoteip", remoteIp);

  let result: { success?: boolean };
  try {
    const response = await fetch(VERIFY_URL, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    if (!response.ok) throw new Error(`Turnstile answered with ${response.status}`);
    result = await response.json() as { success?: boolean };
  } catch {
    throw new AppError(503, "CAPTCHA_UNAVAILABLE", "The captcha could not be checked. Please try again in a moment.");
  }
  if (!result.success) throw new AppError(400, "CAPTCHA_FAILED", "The captcha could not be verified. Please try again.");
}
