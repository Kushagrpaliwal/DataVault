import { AppError } from "./errors";
import { clientIp } from "./client-ip";
import { consumeRateLimit, type RateLimitResult } from "./rate-limit";
import type { ServerEnvironment } from "@data-vault/config";

interface Policy {
  /** Bucket name, so different policies do not share a counter. */
  name: string;
  /** How many requests are allowed in the window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export const RATE_LIMITS = {
  /** Creating accounts. The tightest limit, because each account can earn credits. */
  signup: { name: "signup", max: 5, windowSeconds: 3_600 },
  /** Signing in. */
  login: { name: "login", max: 20, windowSeconds: 900 },
  /** Better Auth's own endpoints, reached directly rather than through our routes. */
  internalAuth: { name: "internal-auth", max: 30, windowSeconds: 60 },
  /**
   * Renewing an extension sign-in.
   *
   * This has its own budget. It used to share the sign-in budget, so saving a
   * few items in a row could lock the user out of the extension entirely.
   */
  extensionRefresh: { name: "extension-refresh", max: 60, windowSeconds: 60 },
  /**
   * Saving captures and adding clips to a doc.
   *
   * Saving is the most common thing the extension does, so it gets a budget
   * of its own rather than borrowing the sign-in one.
   */
  captures: { name: "captures", max: 120, windowSeconds: 60 },
  /** Requesting a reset or verification email. */
  emailRequest: { name: "email-request", max: 5, windowSeconds: 3_600 },
  /** Setting a password with a one-time token. */
  passwordSetup: { name: "password-setup", max: 10, windowSeconds: 900 },
  /** AI calls, per user. */
  ai: { name: "ai", max: 5, windowSeconds: 60 },
} satisfies Record<string, Policy>;

export interface LimitOutcome extends RateLimitResult {
  policy: string;
}

/**
 * Consume one unit of a rate-limit budget.
 *
 * The bucket is keyed on the address the request really came from, plus an
 * optional scope such as the email address being targeted, so neither a single
 * host nor a single victim can be used to grind the budget down.
 */
export async function enforceRateLimit(
  request: Request,
  env: ServerEnvironment,
  policy: Policy,
  scope?: string,
): Promise<LimitOutcome> {
  const ip = clientIp(request, env);
  const key = scope ? `${policy.name}:${scope}:${ip}` : `${policy.name}:${ip}`;
  return consume(policy, key);
}

/**
 * The same budget, but keyed on the target rather than the caller.
 *
 * This is the one that matters for email: a limit tied to the caller's
 * address can be side-stepped by rotating addresses, so the budget follows
 * the address being targeted instead.
 */
export async function enforceScopeLimit(
  policy: Policy,
  scope: string,
): Promise<LimitOutcome> {
  return consume(policy, `${policy.name}:${scope}`);
}

async function consume(policy: Policy, key: string): Promise<LimitOutcome> {
  const result = await consumeRateLimit({ key, limit: policy.max, windowSeconds: policy.windowSeconds });
  if (!result.allowed) {
    const minutes = Math.max(1, Math.ceil(result.retryAfter / 60));
    throw new AppError(429, "RATE_LIMITED", `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  return { ...result, policy: policy.name };
}
