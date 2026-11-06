import { AppError } from "./errors";
import { clientKey } from "./client-ip";
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
  /** Creating accounts. The tightest limit, to limit automated sign-ups. */
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
  /**
   * Creating a workspace.
   *
   * A workspace is free, so one could be made in a loop. Each new one is
   * another place to hide behind when a per-workspace allowance is looked
   * at, so the number of them is capped per account and per day.
   */
  organizationCreate: { name: "organization-create", max: 5, windowSeconds: 86_400 },
  /** Setting a password with a one-time token. */
  passwordSetup: { name: "password-setup", max: 10, windowSeconds: 900 },
  /** AI calls, per user. */
  ai: { name: "ai", max: 5, windowSeconds: 60 },
  /**
   * The AI on a selection.
   *
   * A person may try the same selection a few times, so it is a little
   * larger than the budget for writing, and it is a budget of its own so
   * that trying does not use up the writing allowance.
   */
  aiSelection: { name: "ai-selection", max: 10, windowSeconds: 60 },
  /**
   * A search by meaning.
   *
   * Every one of these asks the model for the numbers of the question, so
   * they are given a budget of their own rather than sharing the one for
   * writing.
   */
  semanticSearch: { name: "semantic-search", max: 20, windowSeconds: 60 },
  /**
   * Making the numbers of every item in the workspace again.
   *
   * It is the largest thing the AI side does, so it is allowed once a day
   * for an account.
   */
  semanticReindex: { name: "semantic-reindex", max: 3, windowSeconds: 86_400 },
  /**
   * Bringing material in.
   *
   * An import writes a great many rows, so it is not something that can be
   * done over and over.
   */
  imports: { name: "imports", max: 10, windowSeconds: 3_600 },
} satisfies Record<string, Policy>;

export interface LimitOutcome extends RateLimitResult {
  policy: string;
}

/**
 * Consume one unit of a rate-limit budget.
 *
 * The bucket is keyed on the caller, plus an optional scope such as the email
 * address being targeted, so neither a single host nor a single victim can
 * be used to grind the budget down.
 */
export async function enforceRateLimit(
  request: Request,
  env: ServerEnvironment,
  policy: Policy,
  scope?: string,
): Promise<LimitOutcome> {
  const caller = await clientKey(request, env);
  const key = scope ? `${policy.name}:${scope}:${caller}` : `${policy.name}:${caller}`;
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
  /**
   * On a developer's machine every request comes from the same place, so the
   * limits only get in the way of testing sign-up and sign-in. They are
   * always on in production (and in tests).
   */
  if (process.env.NODE_ENV === "development") {
    return { allowed: true, remaining: policy.max, retryAfter: 0, policy: policy.name };
  }
  const result = await consumeRateLimit({ key, limit: policy.max, windowSeconds: policy.windowSeconds });
  if (!result.allowed) {
    const minutes = Math.max(1, Math.ceil(result.retryAfter / 60));
    throw new AppError(429, "RATE_LIMITED", `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  return { ...result, policy: policy.name };
}
