import { and, count, desc, eq, gte } from "drizzle-orm";
import {
  aiConsents, aiCreditLedger, aiCreditPeriods, aiUsageEvents, getDatabase, users,
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

/** How many requests are left in the shared daily budget. */
async function globalBudgetRemaining(env: ServerEnvironment, periodStart: Date): Promise<number> {
  if (env.AI_GLOBAL_DAILY_REQUESTS <= 0) return 0;
  const db = getDatabase();
  const [row] = await db
    .select({ count: count() })
    .from(aiUsageEvents)
    .where(gte(aiUsageEvents.createdAt, periodStart));
  return Math.max(0, env.AI_GLOBAL_DAILY_REQUESTS - Number(row?.count ?? 0));
}

/** How many distinct users have spent a credit since the period started. */
async function countActiveUsers(periodStart: Date): Promise<number> {
  const db = getDatabase();
  const rows = await db
    .selectDistinct({ userId: aiUsageEvents.userId })
    .from(aiUsageEvents)
    .where(gte(aiUsageEvents.createdAt, periodStart));
  return rows.length;
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
  const [period] = await db
    .select({ granted: aiCreditPeriods.granted, used: aiCreditPeriods.used })
    .from(aiCreditPeriods)
    .where(and(
      eq(aiCreditPeriods.organizationId, context.organizationId),
      eq(aiCreditPeriods.userId, context.userId),
      eq(aiCreditPeriods.periodStart, periodStart),
    ))
    .limit(1);
  const [consent] = await db
    .select({ acceptedAt: aiConsents.acceptedAt })
    .from(aiConsents)
    .where(and(eq(aiConsents.userId, context.userId), eq(aiConsents.provider, "gemini")))
    .limit(1);

  const { base, effective } = await effectiveAllowance(env, periodStart);
  const used = period?.used ?? 0;
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

/**
 * Take one credit out of the user's allowance.
 *
 * The period row is locked for the duration of the transaction, so two
 * concurrent requests cannot both see the last credit and both spend it.
 */
export async function reserveCredit(
  env: ServerEnvironment,
  context: CreditContext,
  feature: string,
  model: string,
  requestId: string,
): Promise<CreditReservation> {
  const db = getDatabase();
  const existing = await db
    .select({ id: aiCreditLedger.id })
    .from(aiCreditLedger)
    .where(eq(aiCreditLedger.requestId, requestId))
    .limit(1);
  if (existing.length) {
    return { requestId, userId: context.userId, organizationId: context.organizationId, periodStart: pacificDayStart(), feature, model, replay: true };
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

  const periodStart = pacificDayStart();
  await db.transaction(async (tx) => {
    const [period] = await tx
      .select({ granted: aiCreditPeriods.granted, used: aiCreditPeriods.used })
      .from(aiCreditPeriods)
      .where(and(
        eq(aiCreditPeriods.organizationId, context.organizationId),
        eq(aiCreditPeriods.userId, context.userId),
        eq(aiCreditPeriods.periodStart, periodStart),
      ))
      .limit(1)
      .for("update");

    if (!period) {
      await tx.insert(aiCreditPeriods).values({
        organizationId: context.organizationId,
        userId: context.userId,
        periodStart,
        granted: status.allowance,
        used: 1,
      });
    } else {
      await tx.update(aiCreditPeriods)
        .set({ used: period.used + 1, updatedAt: new Date() })
        .where(and(
          eq(aiCreditPeriods.organizationId, context.organizationId),
          eq(aiCreditPeriods.userId, context.userId),
          eq(aiCreditPeriods.periodStart, periodStart),
        ));
    }

    await tx.insert(aiCreditLedger).values({
      organizationId: context.organizationId,
      userId: context.userId,
      kind: "usage",
      credits: -1,
      reason: feature,
      requestId,
      metadata: { model },
    });
  });

  return { requestId, userId: context.userId, organizationId: context.organizationId, periodStart, feature, model, replay: false };
}

/** Record the token usage of a request that succeeded. */
export async function recordUsage(reservation: CreditReservation, input: { inputTokens: number; outputTokens: number; cached?: boolean }): Promise<void> {
  await getDatabase().insert(aiUsageEvents).values({
    organizationId: reservation.organizationId,
    userId: reservation.userId,
    feature: reservation.feature,
    model: reservation.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cached: input.cached ? 1 : 0,
    requestId: reservation.requestId,
  });
}

/** Give a credit back when the request never produced a usable answer. */
export async function refundCredit(reservation: CreditReservation, reason: string): Promise<void> {
  if (reservation.replay) return;
  const db = getDatabase();
  await db.transaction(async (tx) => {
    const [period] = await tx
      .select({ used: aiCreditPeriods.used })
      .from(aiCreditPeriods)
      .where(and(
        eq(aiCreditPeriods.organizationId, reservation.organizationId),
        eq(aiCreditPeriods.userId, reservation.userId),
        eq(aiCreditPeriods.periodStart, reservation.periodStart),
      ))
      .limit(1)
      .for("update");
    if (period && period.used > 0) {
      await tx.update(aiCreditPeriods)
        .set({ used: period.used - 1, updatedAt: new Date() })
        .where(and(
          eq(aiCreditPeriods.organizationId, reservation.organizationId),
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
  const db = getDatabase();
  const [existing] = await db
    .select({ userId: aiConsents.userId })
    .from(aiConsents)
    .where(and(eq(aiConsents.userId, userId), eq(aiConsents.provider, "gemini")))
    .limit(1);
  if (existing) return;
  await db.insert(aiConsents).values({ userId, provider: "gemini" });
}

/** Recent credit movements, for the usage panel. */
export async function listCreditActivity(context: CreditContext, limit = 20): Promise<{ id: string; kind: string; credits: number; reason: string | null; createdAt: string }[]> {
  const rows = await getDatabase()
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
    .limit(limit);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
