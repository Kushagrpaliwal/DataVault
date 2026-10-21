import { index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";import { organizations } from "./tenancy";
import { users } from "./auth";
import { notes } from "./notes";
import { savedRecords } from "./records";

/**
 * The allowance a user holds for one day.
 *
 * The period matches the Gemini free tier, which resets requests per day at
 * midnight Pacific, so a user's credits and the shared quota refresh at the
 * same moment.
 *
 * The row belongs to the user and not to a workspace, because the allowance
 * belongs to the user too. It used to be counted per workspace, which meant
 * a new workspace was a fresh allowance, and the free credits could be
 * multiplied simply by making another one.
 */
export const aiCreditPeriods = pgTable("ai_credit_periods", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** The first instant of the period, in UTC. */
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  granted: integer("granted").notNull().default(0),
  used: integer("used").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.periodStart] }),
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
  /**
   * The key the client sent, kept as it was.
   *
   * The request id is scoped to the account, so this is what lets the server
   * notice that one account has handed its key to another one.
   */
  idempotencyKey: text("idempotency_key"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("ai_credit_ledger_user_idx").on(table.userId, table.createdAt),
  index("ai_credit_ledger_idempotency_idx").on(table.idempotencyKey),
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

/**
 * The counters the whole product shares.
 *
 * The daily budget and the number of people using it are about everybody, so
 * they cannot live in a table that is scoped to one person or one workspace.
 * They hold nothing but two numbers, and they carry no information about
 * who made a request.
 */
export const aiGlobalCounters = pgTable("ai_global_counters", {
  /** "requests" or "users". */
  key: text("key").notNull(),
  /** The first instant of the period, in UTC. */
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  value: integer("value").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.key, table.periodStart] }),
  index("ai_global_counters_period_idx").on(table.periodStart),
]);

/**
 * The numbers that say what a saved item is about.
 *
 * Two texts that mean the same thing have numbers that are close together,
 * so a search can find an item by what it is about rather than by the words
 * it happens to use.
 *
 * The column is a plain list of numbers rather than the vector type of the
 * pgvector extension, so that the search works on any PostgreSQL. The table
 * is the same either way, so the extension can be used later without
 * changing anything else.
 */
export const recordEmbeddings = pgTable("record_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  savedRecordId: uuid("saved_record_id").notNull().references(() => savedRecords.id, { onDelete: "cascade" }),
  /** The model that made the numbers, so that old numbers are not compared with new ones. */
  model: text("model").notNull(),
  /** The numbers themselves. */
  embedding: real("embedding").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("record_embeddings_record_idx").on(table.organizationId, table.savedRecordId),
  index("record_embeddings_model_idx").on(table.model),
]);
export const noteAiPreviews = pgTable("note_ai_previews", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** organize | write-up */
  feature: text("feature").notNull(),
  /** The version of the doc the answer was made from. */
  baseVersion: integer("base_version").notNull(),
  /** The answer, ready to be written. */
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  /** True once the answer has been written into the doc. */
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("note_ai_previews_note_idx").on(table.organizationId, table.noteId),
  index("note_ai_previews_expiry_idx").on(table.expiresAt),
]);
