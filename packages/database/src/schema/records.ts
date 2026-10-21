import { boolean, customType, index, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdViaEnum, recordTypeEnum, sourceTypeEnum } from "./enums";
import { organizations } from "./tenancy";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({ dataType: () => "bytea" });

export const vaults = pgTable("vaults", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  kind: text("kind").$type<"personal" | "workspace">().notNull().default("workspace"),
  color: text("color").notNull().default("#b8a4ed"),
  isDefault: boolean("is_default").notNull().default(false),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("vaults_org_slug_unique").on(table.organizationId, table.slug), index("vaults_org_default_idx").on(table.organizationId, table.isDefault)]);

export const savedRecords = pgTable("saved_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  vaultId: uuid("vault_id").notNull().references(() => vaults.id, { onDelete: "restrict" }),
  recordType: recordTypeEnum("record_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  originalText: text("original_text"),
  sourceType: sourceTypeEnum("source_type").notNull().default("manual"),
  sourceUrl: text("source_url"),
  sourceDomain: text("source_domain"),
  sourcePageTitle: text("source_page_title"),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  createdVia: createdViaEnum("created_via").notNull().default("website"),
  summaryAmount: numeric("summary_amount", { precision: 18, scale: 2 }),
  summaryCurrency: text("summary_currency"),
  summaryParty: text("summary_party"),
  summaryStatus: text("summary_status"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  captureKind: text("capture_kind").$type<"selection" | "page" | "page-text" | "link" | "image" | "document" | "note" | "receipt">().notNull().default("note"),
  reviewStatus: text("review_status").$type<"inbox" | "reviewed" | "archived" | "trashed">().notNull().default("inbox"),
  privacyLevel: text("privacy_level").$type<"private" | "workspace" | "cloud-ai-opt-in">().notNull().default("private"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  index("saved_records_org_created_idx").on(table.organizationId, table.createdAt),
  index("saved_records_org_type_idx").on(table.organizationId, table.recordType),
  index("saved_records_vault_created_idx").on(table.organizationId, table.vaultId, table.createdAt),
  index("saved_records_source_domain_idx").on(table.organizationId, table.sourceDomain),
]);

export const captureSources = pgTable("capture_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  savedRecordId: uuid("saved_record_id").notNull().references(() => savedRecords.id, { onDelete: "cascade" }),
  selectedText: text("selected_text").notNull(),
  captureHash: text("capture_hash").notNull(),
  extractorId: text("extractor_id").notNull(),
  extractorVersion: text("extractor_version").notNull(),
  parsedData: jsonb("parsed_data").$type<Record<string, unknown>>().notNull().default({}),
  confidence: jsonb("confidence").$type<Record<string, number>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("capture_sources_record_unique").on(table.savedRecordId), index("capture_sources_org_hash_idx").on(table.organizationId, table.captureHash)]);

export const evidenceSnapshots = pgTable("evidence_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  savedRecordId: uuid("saved_record_id").notNull().references(() => savedRecords.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url"),
  sourceTitle: text("source_title"),
  sourceDomain: text("source_domain"),
  capturedText: text("captured_text"),
  contentHash: text("content_hash").notNull(),
  extractorId: text("extractor_id").notNull(),
  extractorVersion: text("extractor_version").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("evidence_snapshots_record_idx").on(table.organizationId, table.savedRecordId), uniqueIndex("evidence_snapshots_record_hash_unique").on(table.savedRecordId, table.contentHash)]);

export const vaultCollections = pgTable("vault_collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  vaultId: uuid("vault_id").notNull().references(() => vaults.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#b8a4ed"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("vault_collections_name_unique").on(table.vaultId, table.name), index("vault_collections_org_vault_idx").on(table.organizationId, table.vaultId)]);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#b8a4ed"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("tags_org_name_unique").on(table.organizationId, table.name)]);

export const savedRecordCollections = pgTable("saved_record_collections", {
  savedRecordId: uuid("saved_record_id").notNull().references(() => savedRecords.id, { onDelete: "cascade" }),
  collectionId: uuid("collection_id").notNull().references(() => vaultCollections.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.savedRecordId, table.collectionId] }), index("saved_record_collections_org_collection_idx").on(table.organizationId, table.collectionId)]);

export const savedRecordTags = pgTable("saved_record_tags", {
  savedRecordId: uuid("saved_record_id").notNull().references(() => savedRecords.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.savedRecordId, table.tagId] }), index("saved_record_tags_org_tag_idx").on(table.organizationId, table.tagId)]);

export const processingJobs = pgTable("processing_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  savedRecordId: uuid("saved_record_id").notNull().references(() => savedRecords.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("ready"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  attempts: numeric("attempts", { precision: 4, scale: 0 }).notNull().default("0"),
  lastError: text("last_error"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("processing_jobs_org_status_idx").on(table.organizationId, table.status, table.createdAt)]);

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  savedRecordId: uuid("saved_record_id").references(() => savedRecords.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: numeric("byte_size", { precision: 12, scale: 0 }).notNull(),
  sha256: text("sha256").notNull(),
  width: numeric("width", { precision: 8, scale: 0 }),
  height: numeric("height", { precision: 8, scale: 0 }),
  content: bytea("content").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("attachments_record_idx").on(table.organizationId, table.savedRecordId), uniqueIndex("attachments_record_hash_unique").on(table.organizationId, table.savedRecordId, table.sha256)]);
