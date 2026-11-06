import { sql } from "drizzle-orm";
import { boolean, customType, index, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdViaEnum, recordTypeEnum, sourceTypeEnum } from "./enums";
import { organizations } from "./tenancy";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * The words of a saved item, as PostgreSQL understands them.
 *
 * The column is worked out by the database itself, so it can never fall
 * behind the text it was made from.
 */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/**
 * The words of a saved item, in the order they matter.
 *
 * A title says more than a description, and a description says more than
 * the text that was captured, so the three are given different weights. The
 * search is ordered by the weight, so the best match comes first.
 */
const searchVector = sql`setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("description", '')), 'B') || setweight(to_tsvector('english', coalesce("source_page_title", '')), 'B') || setweight(to_tsvector('english', coalesce("original_text", '')), 'C')`;

export const vaults = pgTable("vaults", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /**
   * The folder this one sits inside.
   *
   * A folder with no parent is at the top. The default folder is always at
   * the top, so the tree always has a place to fall back to.
   */
  parentId: uuid("parent_id").references((): AnyPgColumn => vaults.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  kind: text("kind").$type<"personal" | "workspace">().notNull().default("workspace"),
  color: text("color").notNull().default("#b8a4ed"),
  isDefault: boolean("is_default").notNull().default(false),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  /**
   * A name has to be apart from its siblings only.
   *
   * Two folders in different places may carry the same name, but two
   * folders in the same place may not. The parent is folded into the index
   * with coalesce, because PostgreSQL treats a null as different from every
   * other null, and two folders at the top would otherwise be allowed to
   * share a name.
   */
  uniqueIndex("vaults_sibling_slug_unique").on(table.organizationId, sql`coalesce(${table.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`, table.slug),
  index("vaults_org_parent_idx").on(table.organizationId, table.parentId),
  index("vaults_org_default_idx").on(table.organizationId, table.isDefault),
]);

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
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  captureKind: text("capture_kind").$type<"selection" | "page" | "page-text" | "link" | "image" | "document" | "note">().notNull().default("note"),
  reviewStatus: text("review_status").$type<"inbox" | "reviewed" | "archived" | "trashed">().notNull().default("inbox"),
  privacyLevel: text("privacy_level").$type<"private" | "workspace" | "cloud-ai-opt-in">().notNull().default("private"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  /**
   * The words of the item, kept by the database itself.
   *
   * The search looks through this column, and the index on it is what makes
   * that quick. A generated column cannot be written to, so it cannot fall
   * behind the text it was made from.
   */
  searchVector: tsvector("search_vector").generatedAlwaysAs(searchVector),
}, (table) => [
  index("saved_records_org_created_idx").on(table.organizationId, table.createdAt),
  index("saved_records_org_type_idx").on(table.organizationId, table.recordType),
  index("saved_records_vault_created_idx").on(table.organizationId, table.vaultId, table.createdAt),
  index("saved_records_source_domain_idx").on(table.organizationId, table.sourceDomain),
  index("saved_records_search_idx").using("gin", table.searchVector),
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
  /**
   * The page as it was, as the markup of the parts that were kept.
   *
   * A page changes, and a page that is gone cannot be read again. The
   * snapshot is what the item was made of, so the item can always be
   * traced back to what the page said at the time.
   */
  pageHtml: text("page_html"),
  contentHash: text("content_hash").notNull(),
  extractorId: text("extractor_id").notNull(),
  extractorVersion: text("extractor_version").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("evidence_snapshots_record_idx").on(table.organizationId, table.savedRecordId), uniqueIndex("evidence_snapshots_record_hash_unique").on(table.savedRecordId, table.contentHash)]);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#b8a4ed"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("tags_org_name_unique").on(table.organizationId, table.name)]);

export const savedRecordTags = pgTable("saved_record_tags", {
  savedRecordId: uuid("saved_record_id").notNull().references(() => savedRecords.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.savedRecordId, table.tagId] }), index("saved_record_tags_org_tag_idx").on(table.organizationId, table.tagId)]);

export const vaultTags = pgTable("vault_tags", {
  vaultId: uuid("vault_id").notNull().references(() => vaults.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.vaultId, table.tagId] }),
  index("vault_tags_org_tag_idx").on(table.organizationId, table.tagId),
  index("vault_tags_org_vault_idx").on(table.organizationId, table.vaultId),
]);

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
