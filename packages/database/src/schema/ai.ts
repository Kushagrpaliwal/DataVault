import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./tenancy";
import { users } from "./auth";

/**
 * The allowance a user holds for one day.
 *
 * The period matches the Gemini free tier, which resets requests per day at
 * midnight Pacific, so a user's credits and the shared quota refresh at the
 * same moment.
 */
export const aiCreditPeriods = pgTable("ai_credit_periods", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** The first instant of the period, in UTC. */
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  granted: integer("granted").notNull().default(0),
  used: integer("used").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.organizationId, table.userId, table.periodStart] }),
  index("ai_credit_periods_period_idx").on(table.periodStart),
]);

/** Append-only audit trail for every credit movement. */
export const aiCreditLedger = pgTable("ai_credit_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** grant | usage | refund | adjustment */
  kind: text("kind").notNull(),
  /** Signed: grants are positive, usage is negative, refunds are positive. */
  credits: integer("credits").notNull(),
  reason: text("reason"),
  requestId: text("request_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("ai_credit_ledger_user_idx").on(table.userId, table.createdAt),
  uniqueIndex("ai_credit_ledger_request_unique").on(table.requestId),
]);

/** Token-level metering for every request that reached the model. */
export const aiUsageEvents = pgTable("ai_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  feature: text("feature").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  /** True when the answer was served from cache and cost no quota. */
  cached: integer("cached").notNull().default(0),
  requestId: text("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("ai_usage_events_user_idx").on(table.userId, table.createdAt),
]);

/**
 * Consent for sending saved content to a third-party model.
 *
 * The Gemini free tier may use submitted content to improve Google's products,
 * so the user has to agree to that explicitly before anything is sent.
 */
export const aiConsents = pgTable("ai_consents", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("gemini"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.provider] }),
]);

/**
 * Cached model output, keyed by a hash of the exact prompt.
 *
 * The Gemini free tier allows only a few hundred requests a day for the whole
 * product, so serving a repeated request from cache is the single biggest
 * way to stretch it.
 */
export const aiResponseCache = pgTable("ai_response_cache", {
  contentHash: text("content_hash").notNull(),
  feature: text("feature").notNull(),
  model: text("model").notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.contentHash, table.feature] }),
  index("ai_response_cache_created_idx").on(table.createdAt),
]);
