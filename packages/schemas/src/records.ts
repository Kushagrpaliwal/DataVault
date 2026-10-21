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
  /**
   * The collections the item goes into.
   *
   * A collection belongs to one folder, so every collection named here has
   * to belong to the folder the item is in.
   */
  collectionIds: z.array(uuidSchema).max(20).default([]),
});

export const savedRecordPatchSchema = savedRecordCreateSchema.partial().refine((value) => Object.keys(value).length > 0, "No changes supplied");

export const savedRecordListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  recordType: z.enum(RECORD_TYPES).optional(),
  createdVia: z.enum(CREATED_VIA).optional(),
  vaultId: uuidSchema.optional(),
  reviewStatus: z.enum(VAULT_ITEM_STATUSES).optional(),
  tag: z.string().trim().max(80).optional(),
  collectionId: uuidSchema.optional(),
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
});

export const vaultCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  description: z.string().trim().max(500).optional(),
  kind: z.enum(["personal", "workspace"]),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#b8a4ed"),
});

export const collectionCreateSchema = z.object({
  vaultId: uuidSchema,
  name: z.string().trim().min(1).max(100),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#b8a4ed"),
});

export const tagCreateSchema = z.object({ name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#b8a4ed") });

/**
 * The changes that can be made to a folder, a collection or a tag.
 *
 * A name is the only thing that is really worth changing, so the colour is
 * there as well and nothing else.
 */
export const vaultPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
}).refine((value) => Object.keys(value).length > 0, "No changes supplied");

export const collectionPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
}).refine((value) => Object.keys(value).length > 0, "No changes supplied");

export const tagPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
}).refine((value) => Object.keys(value).length > 0, "No changes supplied");

export const itemOrganizationSchema = z.object({
  vaultId: uuidSchema.optional(),
  collectionIds: z.array(uuidSchema).max(25).optional(),
  tagNames: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  reviewStatus: z.enum(VAULT_ITEM_STATUSES).optional(),
  privacyLevel: z.enum(PRIVACY_LEVELS).optional(),
});
