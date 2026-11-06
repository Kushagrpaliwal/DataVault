import { z } from "zod";
import { CAPTURE_KINDS, CREATED_VIA, PRIVACY_LEVELS, RECORD_TYPES, SOURCE_TYPES, VAULT_ITEM_STATUSES } from "./constants";
import { booleanQuerySchema, dateTimeSchema, optionalHttpUrlSchema, paginationQuerySchema, sortDirectionSchema, uuidSchema } from "./common";

export const sourceSchema = z.object({
  /** Missing when the browser would not tell the extension the page address. */
  url: optionalHttpUrlSchema,
  title: z.string().max(500),
  domain: z.string().trim().toLowerCase().max(253),
});

export const savedRecordCreateSchema = z.object({
  recordType: z.enum(RECORD_TYPES),
  title: z.string().trim().min(1).max(250),
  description: z.string().max(5_000).optional(),
  originalText: z.string().max(100_000).optional(),
  sourceType: z.enum(SOURCE_TYPES).default("manual"),
  source: sourceSchema.optional(),
  capturedAt: dateTimeSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  vaultId: uuidSchema.optional(),
  captureKind: z.enum(CAPTURE_KINDS).default("note"),
  reviewStatus: z.enum(VAULT_ITEM_STATUSES).default("inbox"),
  privacyLevel: z.enum(PRIVACY_LEVELS).default("private"),
});

export const savedRecordPatchSchema = savedRecordCreateSchema.partial().refine((value) => Object.keys(value).length > 0, "No changes supplied");

export const savedRecordListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  recordType: z.enum(RECORD_TYPES).optional(),
  createdVia: z.enum(CREATED_VIA).optional(),
  vaultId: uuidSchema.optional(),
  reviewStatus: z.enum(VAULT_ITEM_STATUSES).optional(),
  tag: z.string().trim().max(80).optional(),
  archived: booleanQuerySchema,
  trash: booleanQuerySchema,
  sort: z.enum(["createdAt", "updatedAt", "title", "recordType"]).default("createdAt"),
  direction: sortDirectionSchema.default("desc"),
});

export const savedRecordViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filters: z.record(z.string(), z.unknown()).default({}),
  columns: z.array(z.string().max(80)).max(30).default([]),
  sort: z.record(z.string(), z.unknown()).default({}),
});

export const archiveManySchema = z.object({ ids: z.array(uuidSchema).min(1).max(100) });

export const savedRecordSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  recordType: z.enum(RECORD_TYPES),
  title: z.string(),
  description: z.string().nullable(),
  originalText: z.string().nullable(),
  sourceType: z.enum(SOURCE_TYPES),
  sourceUrl: z.string().nullable(),
  sourceDomain: z.string().nullable(),
  sourcePageTitle: z.string().nullable(),
  capturedAt: z.string().nullable(),
  createdVia: z.enum(CREATED_VIA),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  vaultId: uuidSchema,
  captureKind: z.enum(CAPTURE_KINDS),
  reviewStatus: z.enum(VAULT_ITEM_STATUSES),
  privacyLevel: z.enum(PRIVACY_LEVELS),
  deletedAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.object({ id: uuidSchema, name: z.string(), color: z.string() })).default([]),
});

export const vaultCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  kind: z.enum(["personal", "workspace"]),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#b8a4ed"),
  /**
   * The folder this one goes inside.
   *
   * A folder with no parent sits at the top.
   */
  parentId: uuidSchema.nullable().optional(),
});

export const tagCreateSchema = z.object({ name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#b8a4ed") });

/**
 * A tag that is put on a folder.
 *
 * The tag is made in the workspace, and put on the items of the folder, so
 * that it shows up in the list of the tags of that folder at once.
 */
export const folderTagSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});

/**
 * The changes that can be made to a folder or a tag.
 *
 * A name is the only thing that is really worth changing, so the colour is
 * there as well and nothing else.
 */
export const vaultPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  /**
   * The folder this one goes inside.
   *
   * It is set to nothing to bring the folder back to the top.
   */
  parentId: uuidSchema.nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "No changes supplied");

export const tagPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
}).refine((value) => Object.keys(value).length > 0, "No changes supplied");

export const itemOrganizationSchema = z.object({
  vaultId: uuidSchema.optional(),
  tagNames: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  reviewStatus: z.enum(VAULT_ITEM_STATUSES).optional(),
  privacyLevel: z.enum(PRIVACY_LEVELS).optional(),
});
