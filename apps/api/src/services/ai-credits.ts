import { and, desc, eq, sql } from "drizzle-orm";
import {
  aiConsents, aiCreditLedger, aiCreditPeriods, aiGlobalCounters, aiUsageEvents, getDatabase, setClaimKey, users,
  type DatabaseTransaction, withAccount, withUser,
} from "@data-vault/database";
import type { ServerEnvironment } from "@data-vault/config";
import { AppError } from "../lib/errors";
import { pacificDayEnd, pacificDayStart } from "../lib/pacific";

export interface CreditContext {
  userId: string;
  organizationId: string;
}

export interface CreditStatus {
  /** Credits left in the current period. */
  remaining: number;
  /** The allowance this user is currently entitled to. */
  allowance: number;
  /** The allowance the account was granted at the start of the period. */
  baseAllowance: number;
  used: number;
  periodStart: string;
  periodEnd: string;
  /** Requests left in the shared daily budget. */
  dailyBudgetRemaining: number;
  /** The email address has been confirmed. */
  emailVerified: boolean;
  /** The user agreed to send content to the model provider. */
  consented: boolean;
  /** True when the AI features are switched off entirely. */
  available: boolean;
  /** Why the AI features are unavailable, when they are. */
  reason: string | null;
}

/**
 * The allowance a single user may spend in one day.
 *
 * The Gemini free tier quota is shared by every user of the product, so a
 * fixed personal allowance is not enough on its own: one heavy user could
 * consume the whole pool and lock everyone else out. The effective allowance
 * is therefore the smaller of the personal cap and an equal share of what is
 * left of the daily budget, with a floor of one request so an active user is
 * never left with nothing.
 */
async function effectiveAllowance(env: ServerEnvironment, periodStart: Date): Promise<{ base: number; effective: number }> {
  const base = env.AI_USER_DAILY_CREDITS;
  if (base <= 0) return { base: 0, effective: 0 };
  const globalRemaining = await globalBudgetRemaining(env, periodStart);
  if (globalRemaining <= 0) return { base, effective: 0 };
  const activeUsers = await countActiveUsers(periodStart);
  const share = Math.max(1, Math.floor(globalRemaining / Math.max(1, activeUsers)));
  return { base, effective: Math.max(1, Math.min(base, share)) };
}

/**
 * Read a counter that the whole product shares.
 *
 * The counters live in a table of their own because they are about
 * everybody, so they cannot be kept in a table that is scoped to one person
 * or one workspace.
 */
async function globalCounter(key: "requests" | "users", periodStart: Date): Promise<number> {
  const [row] = await getDatabase()
    .select({ value: aiGlobalCounters.value })
    .from(aiGlobalCounters)
    .where(and(eq(aiGlobalCounters.key, key), eq(aiGlobalCounters.periodStart, periodStart)))
    .limit(1);
  return row?.value ?? 0;
}

/** How many requests are left in the shared daily budget. */
async function globalBudgetRemaining(env: ServerEnvironment, periodStart: Date): Promise<number> {
  if (env.AI_GLOBAL_DAILY_REQUESTS <= 0) return 0;
  const used = await globalCounter("requests", periodStart);
  return Math.max(0, env.AI_GLOBAL_DAILY_REQUESTS - used);
}

/** How many distinct users have spent a credit since the period started. */
async function countActiveUsers(periodStart: Date): Promise<number> {
  return globalCounter("users", periodStart);
}

/**
 * Count one request and, the first time a person spends a credit in the
 * period, count that person too.
 */
async function countGlobalUsage(tx: DatabaseTransaction, periodStart: Date, firstRequestOfTheDay: boolean) {
  await tx.insert(aiGlobalCounters).values({ key: "requests", periodStart, value: 1 })
    .onConflictDoUpdate({ target: [aiGlobalCounters.key, aiGlobalCounters.periodStart], set: { value: sql`${aiGlobalCounters.value} + 1`, updatedAt: new Date() } });
  if (!firstRequestOfTheDay) return;
  await tx.insert(aiGlobalCounters).values({ key: "users", periodStart, value: 1 })
    .onConflictDoUpdate({ target: [aiGlobalCounters.key, aiGlobalCounters.periodStart], set: { value: sql`${aiGlobalCounters.value} + 1`, updatedAt: new Date() } });
}

/**
 * How many credits this user has spent today.
 *
 * The allowance belongs to the person, not to the workspace, so the count
 * covers every workspace the person is in. Counting per workspace meant a
 * new workspace was a fresh allowance, and the free credits could be
 * multiplied simply by making another one.
 */
async function usedCredits(userId: string, organizationId: string, periodStart: Date): Promise<number> {
  const [row] = await withUser(userId, organizationId, (tx) => tx
    .select({ used: aiCreditPeriods.used })
    .from(aiCreditPeriods)
    .where(and(eq(aiCreditPeriods.userId, userId), eq(aiCreditPeriods.periodStart, periodStart)))
    .limit(1));
  return row?.used ?? 0;
}

/** Read the current balance without spending anything. */
export async function readCreditStatus(env: ServerEnvironment, context: CreditContext): Promise<CreditStatus> {
  const periodStart = pacificDayStart();
  const db = getDatabase();
  const [user] = await db
    .select({ emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, context.userId))
    .limit(1);
  /**
   * The agreement belongs to the person, not to the workspace, so it is read
   * with the person set. Without the person the rule on the table hides the
   * row, and the AI features would look unavailable to everybody.
   */
  const [consent] = await withAccount(context.userId, (tx) => tx
    .select({ acceptedAt: aiConsents.acceptedAt })
    .from(aiConsents)
    .where(and(eq(aiConsents.userId, context.userId), eq(aiConsents.provider, "gemini")))
    .limit(1));

  const { base, effective } = await effectiveAllowance(env, periodStart);
  const used = await usedCredits(context.userId, context.organizationId, periodStart);
  const available = Boolean(env.geminiApiKey);
  const reason = !available
    ? "AI features are not switched on for this server yet."
    : !user?.emailVerified
      ? "Confirm your email address to unlock AI credits."
      : !consent
        ? "Agree to send content to Google before using AI features."
        : null;

  return {
    /** Credits that can actually be spent right now. A locked allowance is zero. */
    remaining: reason ? 0 : Math.max(0, effective - used),
    allowance: effective,
    baseAllowance: base,
    used,
    periodStart: periodStart.toISOString(),
    periodEnd: pacificDayEnd().toISOString(),
    dailyBudgetRemaining: await globalBudgetRemaining(env, periodStart),
    emailVerified: Boolean(user?.emailVerified),
    consented: Boolean(consent),
    available,
    reason,
  };
}

export interface CreditReservation {
  requestId: string;
  userId: string;
  organizationId: string;
  periodStart: Date;
  feature: string;
  model: string;
  /** True when this request was already charged and is being replayed. */
  replay: boolean;
}

export interface ReserveOptions {
  /** The key the client sent, kept as it was so reuse can be spotted. */
  idempotencyKey?: string | undefined;
}

/**
 * Take one credit out of the user's allowance.
 *
 * The period row is locked for the duration of the transaction, so two
 * concurrent requests cannot both see the last credit and both spend it.
 *
 * The request id is scoped to the account, so one person cannot spend
 * another person's request by guessing their key. A key that has already
 * been used, whether by this person or by anybody else, is refused rather
 * than quietly turned into a free second call.
 */
export async function reserveCredit(
  env: ServerEnvironment,
  context: CreditContext,
  feature: string,
  model: string,
  requestId: string,
  options: ReserveOptions = {},
): Promise<CreditReservation> {
  const periodStart = pacificDayStart();

  /**
   * Has this key already been used?
   *
   * The key is remembered as the client sent it, so a key that turns up in
   * another account is caught here rather than being treated as a new
   * request. The ledger follows the person, so the key is named for the
   * length of the transaction and the rule on the table lets that one row
   * through, whoever owns it.
   */
  if (options.idempotencyKey) {
    const key = options.idempotencyKey;
    const seen = await withUser(context.userId, context.organizationId, async (tx) => {
      await setClaimKey(tx, key);
      return tx
        .select({ userId: aiCreditLedger.userId, organizationId: aiCreditLedger.organizationId, feature: aiCreditLedger.reason })
        .from(aiCreditLedger)
        .where(eq(aiCreditLedger.idempotencyKey, key))
        .limit(1);
    });
    const owner = seen[0];
    if (owner) {
      if (owner.userId !== context.userId) {
        throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This request key has already been used. Send a new one.");
      }
      if (owner.organizationId !== context.organizationId || owner.feature !== feature) {
        throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This request key has already been used for a different request. Send a new one.");
      }
    }
  }

  const existing = await withUser(context.userId, context.organizationId, (tx) => tx
    .select({ id: aiCreditLedger.id })
    .from(aiCreditLedger)
    .where(eq(aiCreditLedger.requestId, requestId))
    .limit(1));
  if (existing.length) {
    /**
     * The same request, charged already. The caller must serve the answer
     * from the response cache instead of asking the model again, otherwise
     * the retry would be a second free call to the shared quota.
     */
    return { requestId, userId: context.userId, organizationId: context.organizationId, periodStart, feature, model, replay: true };
  }

  const status = await readCreditStatus(env, context);
  if (!status.available) throw new AppError(503, "AI_NOT_AVAILABLE", status.reason ?? "AI features are not available.");
  if (!status.emailVerified) throw new AppError(403, "EMAIL_NOT_VERIFIED", "Confirm your email address to unlock AI credits.");
  if (!status.consented) throw new AppError(403, "AI_CONSENT_REQUIRED", "Agree to send content to Google before using AI features.");
  if (status.remaining <= 0) {
    throw new AppError(429, "NO_CREDITS_REMAINING", `You have used all of today's free AI credits. They come back when the daily allowance resets.`);
  }
  if (status.dailyBudgetRemaining <= 0) {
    throw new AppError(429, "AI_BUDGET_EXHAUSTED", "The free AI allowance for today has been used up. Please try again tomorrow.");
  }

  await withUser(context.userId, context.organizationId, async (tx) => {
    const [period] = await tx
      .select({ used: aiCreditPeriods.used })
      .from(aiCreditPeriods)
      .where(and(eq(aiCreditPeriods.userId, context.userId), eq(aiCreditPeriods.periodStart, periodStart)))
      .limit(1)
      .for("update");

    const firstRequestOfTheDay = !period;
    if (!period) {
      await tx.insert(aiCreditPeriods).values({
        userId: context.userId,
        periodStart,
        granted: status.allowance,
        used: 1,
      });
    } else {
      await tx.update(aiCreditPeriods)
        .set({ used: period.used + 1, updatedAt: new Date() })
        .where(and(eq(aiCreditPeriods.userId, context.userId), eq(aiCreditPeriods.periodStart, periodStart)));
    }

    await tx.insert(aiCreditLedger).values({
      organizationId: context.organizationId,
      userId: context.userId,
      kind: "usage",
      credits: -1,
      reason: feature,
      requestId,
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      metadata: { model },
    });

    await countGlobalUsage(tx, periodStart, firstRequestOfTheDay);
  });

  return { requestId, userId: context.userId, organizationId: context.organizationId, periodStart, feature, model, replay: false };
}

/** Record the token usage of a request that succeeded. */
export async function recordUsage(reservation: CreditReservation, input: { inputTokens: number; outputTokens: number; cached?: boolean }): Promise<void> {
  await withUser(reservation.userId, reservation.organizationId, (tx) => tx.insert(aiUsageEvents).values({
    organizationId: reservation.organizationId,
    userId: reservation.userId,
    feature: reservation.feature,
    model: reservation.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cached: input.cached ? 1 : 0,
    requestId: reservation.requestId,
  }));
}

/** Give a credit back when the request never produced a usable answer. */
export async function refundCredit(reservation: CreditReservation, reason: string): Promise<void> {
  if (reservation.replay) return;
  await withUser(reservation.userId, reservation.organizationId, async (tx) => {
    const [period] = await tx
      .select({ used: aiCreditPeriods.used })
      .from(aiCreditPeriods)
      .where(and(
        eq(aiCreditPeriods.userId, reservation.userId),
        eq(aiCreditPeriods.periodStart, reservation.periodStart),
      ))
      .limit(1)
      .for("update");
    if (period && period.used > 0) {
      await tx.update(aiCreditPeriods)
        .set({ used: period.used - 1, updatedAt: new Date() })
        .where(and(
          eq(aiCreditPeriods.userId, reservation.userId),
          eq(aiCreditPeriods.periodStart, reservation.periodStart),
        ));
    }
    await tx.insert(aiCreditLedger).values({
      organizationId: reservation.organizationId,
      userId: reservation.userId,
      kind: "refund",
      credits: 1,
      reason,
      requestId: `${reservation.requestId}:refund`,
    });
  });
}

/** Record that the user agreed to send content to the model provider. */
export async function recordConsent(userId: string): Promise<void> {
  /**
   * The agreement belongs to the person, so it is written with the person
   * set and nothing else.
   */
  await withAccount(userId, async (tx) => {
    const [existing] = await tx
      .select({ userId: aiConsents.userId })
      .from(aiConsents)
      .where(and(eq(aiConsents.userId, userId), eq(aiConsents.provider, "gemini")))
      .limit(1);
    if (existing) return;
    await tx.insert(aiConsents).values({ userId, provider: "gemini" });
  });
}

/** Recent credit movements, for the usage panel. */
export async function listCreditActivity(context: CreditContext, limit = 20): Promise<{ id: string; kind: string; credits: number; reason: string | null; createdAt: string }[]> {
  const rows = await withUser(context.userId, context.organizationId, (tx) => tx
    .select({
      id: aiCreditLedger.id,
      kind: aiCreditLedger.kind,
      credits: aiCreditLedger.credits,
      reason: aiCreditLedger.reason,
      createdAt: aiCreditLedger.createdAt,
    })
    .from(aiCreditLedger)
    .where(and(
      eq(aiCreditLedger.organizationId, context.organizationId),
      eq(aiCreditLedger.userId, context.userId),
    ))
    .orderBy(desc(aiCreditLedger.createdAt))
    .limit(limit));
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
