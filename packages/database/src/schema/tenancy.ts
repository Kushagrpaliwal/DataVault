import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { memberStatusEnum } from "./enums";
import { users } from "./auth";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  currency: text("currency").notNull().default("INR"),
  locale: text("locale").notNull().default("en-IN"),
  timeZone: text("time_zone").notNull().default("Asia/Kolkata"),
  isPersonal: boolean("is_personal").notNull().default(false),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [uniqueIndex("organizations_slug_unique").on(table.slug)]);

export const organizationMembers = pgTable("organization_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: memberStatusEnum("status").notNull().default("active"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("organization_members_org_user_unique").on(table.organizationId, table.userId), index("organization_members_user_idx").on(table.userId)]);

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  description: text("description").notNull(),
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("roles_org_slug_unique").on(table.organizationId, table.slug)]);

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })]);

export const userRoles = pgTable("user_roles", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.organizationId, table.userId, table.roleId] }), index("user_roles_lookup_idx").on(table.organizationId, table.userId)]);

export const organizationInvitations = pgTable("organization_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const savedViews = pgTable("saved_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
  columns: jsonb("columns").$type<string[]>().notNull().default([]),
  sort: jsonb("sort").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("saved_views_user_name_unique").on(table.organizationId, table.userId, table.name)]);
