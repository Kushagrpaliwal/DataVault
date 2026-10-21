import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations } from "./tenancy";
import { vaults } from "./records";

/**
 * A doc.
 *
 * A doc holds rich text, exactly like a page in a word processor. The
 * content is stored as the JSON the editor works with, and the plain text
 * is kept beside it so a doc can be searched and summarised cheaply.
 */
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  vaultId: uuid("vault_id").references(() => vaults.id, { onDelete: "set null" }),
  /** A doc may sit inside another doc, which is how folders of notes work. */
  parentId: uuid("parent_id").references((): AnyPgColumn => notes.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Untitled doc"),
  icon: text("icon"),
  content: jsonb("content").$type<Record<string, unknown>>().notNull().default({ type: "doc", content: [{ type: "paragraph" }] }),
  contentText: text("content_text").notNull().default(""),
  /** How new clips are sorted into the doc. */
  arrangeMode: text("arrange_mode").$type<"page" | "site" | "day" | "none">().notNull().default("page"),
  isPinned: boolean("is_pinned").notNull().default(false),
  position: integer("position").notNull().default(0),
  /** Bumped on every change, so two people cannot overwrite each other. */
  version: integer("version").notNull().default(1),
  clipCount: integer("clip_count").notNull().default(0),
  lastClippedAt: timestamp("last_clipped_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  updatedBy: uuid("updated_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("notes_org_updated_idx").on(table.organizationId, table.updatedAt),
  index("notes_org_parent_idx").on(table.organizationId, table.parentId),
  index("notes_org_pinned_idx").on(table.organizationId, table.isPinned),
]);

/**
 * An earlier version of a doc.
 *
 * Only the last thirty versions of each doc are kept, so a long-lived doc
 * does not grow without end.
 */
export const noteRevisions = pgTable("note_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  /** Why the version was kept. */
  reason: text("reason").$type<"autosave" | "ai-organize" | "ai-write-up" | "conflict" | "restore">().notNull().default("autosave"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("note_revisions_note_idx").on(table.organizationId, table.noteId, table.createdAt),
  uniqueIndex("note_revisions_note_version_unique").on(table.noteId, table.version),
]);

/**
 * Which doc a person is currently adding to.
 *
 * The extension and the website share this, so both always agree on the doc
 * that the keyboard shortcut adds to.
 */
export const userNotePrefs = pgTable("user_note_prefs", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  currentNoteId: uuid("current_note_id").references(() => notes.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.organizationId, table.userId] })]);
