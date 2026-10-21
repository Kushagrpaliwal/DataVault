import { z } from "zod";
import { booleanQuerySchema, dateTimeSchema, optionalHttpUrlSchema, paginationQuerySchema, uuidSchema } from "./common";

/**
 * How new clips are sorted into a doc.
 */
export const ARRANGE_MODES = ["page", "site", "day", "none"] as const;
export const arrangeModeSchema = z.enum(ARRANGE_MODES);

/** The largest doc the server will accept, in characters of JSON. */
export const NOTE_CONTENT_LIMIT = 2_000_000;

export const noteCreateSchema = z.object({
  title: z.string().trim().max(300).optional(),
  icon: z.string().max(32).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  contentText: z.string().max(500_000).optional(),
  parentId: uuidSchema.nullable().optional(),
  arrangeMode: arrangeModeSchema.optional(),
  isPinned: z.boolean().optional(),
  vaultId: uuidSchema.optional(),
});

export const notePatchSchema = z.object({
  title: z.string().trim().max(300).optional(),
  icon: z.string().max(32).nullable().optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  contentText: z.string().max(500_000).optional(),
  arrangeMode: arrangeModeSchema.optional(),
  isPinned: z.boolean().optional(),
  parentId: uuidSchema.nullable().optional(),
  /** The version the editor had when it started. */
  baseVersion: z.number().int().positive().optional(),
}).refine((value) => Object.keys(value).length > 0, "No changes supplied");

export const noteListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  parentId: uuidSchema.optional(),
  pinned: booleanQuerySchema,
  trash: booleanQuerySchema,
});

export const noteClipSchema = z.object({
  /** The formatting of the selection, as it was on the page. */
  html: z.string().max(NOTE_CONTENT_LIMIT).optional(),
  /** The words of the selection, used when there is no HTML. */
  text: z.string().max(500_000).default(""),
  source: z.object({
    url: optionalHttpUrlSchema,
    title: z.string().max(500).default(""),
    domain: z.string().trim().toLowerCase().max(253).default(""),
  }),
  capturedAt: dateTimeSchema.optional(),
});

export const noteCurrentSchema = z.object({
  noteId: uuidSchema.nullable(),
});

/**
 * What the AI is asked for.
 *
 * `apply` says the answer the user agreed to should be written into the
 * doc, and `previewId` says which answer that is. The answer is kept on the
 * server, so applying it costs no second credit and writes exactly what was
 * shown.
 */
export const noteAiRequestSchema = z.object({
  apply: z.boolean().default(false),
  previewId: uuidSchema.optional(),
});

export const noteRevisionRestoreSchema = z.object({
  noteId: uuidSchema,
});

export const noteSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  vaultId: uuidSchema.nullable(),
  parentId: uuidSchema.nullable(),
  title: z.string(),
  icon: z.string().nullable(),
  content: z.record(z.string(), z.unknown()),
  contentText: z.string(),
  arrangeMode: arrangeModeSchema,
  isPinned: z.boolean(),
  position: z.number().int(),
  version: z.number().int(),
  clipCount: z.number().int(),
  lastClippedAt: z.string().nullable(),
  createdBy: uuidSchema,
  updatedBy: uuidSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export const noteSummarySchema = noteSchema.omit({ content: true }).extend({
  excerpt: z.string(),
});
