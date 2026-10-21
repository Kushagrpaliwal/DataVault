import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations } from "./tenancy";

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id), action: text("action").notNull(), resourceType: text("resource_type").notNull(), resourceId: uuid("resource_id").notNull(),
  previousValues: jsonb("previous_values").$type<Record<string, unknown> | null>(), newValues: jsonb("new_values").$type<Record<string, unknown> | null>(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_logs_org_created_idx").on(table.organizationId, table.createdAt), index("audit_logs_resource_idx").on(table.organizationId, table.resourceType, table.resourceId)]);

export const extensionAuthCodes = pgTable("extension_auth_codes", {
  id: uuid("id").primaryKey().defaultRandom(), codeHash: text("code_hash").notNull().unique(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), codeChallenge: text("code_challenge").notNull(), redirectUri: text("redirect_uri").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), usedAt: timestamp("used_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const extensionSessions = pgTable("extension_sessions", {
  id: uuid("id").primaryKey().defaultRandom(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Chrome Extension"), browser: text("browser"), os: text("os"), extensionVersion: text("extension_version"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [index("extension_sessions_user_idx").on(table.userId, table.revokedAt)]);

export const extensionRefreshTokens = pgTable("extension_refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(), sessionId: uuid("session_id").notNull().references(() => extensionSessions.id, { onDelete: "cascade" }), tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), consumedAt: timestamp("consumed_at", { withTimezone: true }), replacedById: uuid("replaced_by_id"), revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("extension_refresh_session_idx").on(table.sessionId)]);

export const idempotencyKeys = pgTable("idempotency_keys", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(), key: text("key").notNull(), requestHash: text("request_hash").notNull(), responseStatus: text("response_status"), responseBody: jsonb("response_body").$type<Record<string, unknown> | null>(), resourceId: uuid("resource_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("idempotency_org_scope_key_unique").on(table.organizationId, table.scope, table.key), index("idempotency_expires_idx").on(table.expiresAt)]);

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(), hits: text("hits").notNull(), resetAt: timestamp("reset_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
