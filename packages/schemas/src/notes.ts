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

/**
 * What the AI is asked to do with a selection.
 *
 * The actions are the ones people ask for most: put the rough notes into
 * sections, make a table out of them, make a list, make a checklist,
 * summarise, finish what was started, tidy the writing, translate it, or
 * do what the instruction says.
 */
export const noteAiActionSchema = z.enum([
  "arrange", "table", "list", "checklist", "summarize", "complete", "clean-up", "translate", "custom",
]);

/**
 * How much the AI is allowed to use.
 *
 * The person chooses this each time, and the choice is shown before
 * anything is sent.
 */
export const noteAiContextModeSchema = z.enum(["selection", "knowledge", "sources"]);

export const noteAiSelectionSchema = z.object({
  action: noteAiActionSchema,
  /**
   * What the person asked for, in their own words.
   *
   * It is needed for a custom instruction and for a translation, because
   * there is no other way to say what they want.
   */
  instruction: z.string().trim().max(500).optional(),
  selection: z.object({
    /** The selection, as Markdown. */
    markdown: z.string().max(60_000),
    /** The pieces of web pages that are in the selection. */
    clips: z.array(z.object({
      clipId: z.string().max(120),
      text: z.string().max(20_000),
    })).max(200).default([]),
  }),
  context: z.object({
    mode: noteAiContextModeSchema.default("selection"),
    /**
     * The saved items the person chose.
     *
     * They are read on the server, in the workspace of the person, so that
     * an item of another workspace can never be sent.
     */
    recordIds: z.array(uuidSchema).max(10).default([]),
  }).default({ mode: "selection", recordIds: [] }),
}).refine(
  (value) => value.action !== "custom" && value.action !== "translate" ? true : Boolean(value.instruction),
  { message: "Say what you want in the instruction box.", path: ["instruction"] },
);

export type NoteAiAction = z.infer<typeof noteAiActionSchema>;
export type NoteAiContextMode = z.infer<typeof noteAiContextModeSchema>;
export type NoteAiSelectionInput = z.infer<typeof noteAiSelectionSchema>;

/**
 * The blocks an answer is made of.
 *
 * The answer is never markup and never a link, because a model can write a
 * link that goes somewhere it should not. It is a list of blocks, and the
 * browser turns them into the editor's own shape.
 */
export const aiBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.number().int().min(1).max(4).default(2), text: z.string().max(300), added: z.boolean().optional() }),
  z.object({ type: z.literal("paragraph"), text: z.string().max(20_000), added: z.boolean().optional() }),
  z.object({ type: z.literal("bullets"), items: z.array(z.string().max(2_000)).max(200), added: z.boolean().optional() }),
  z.object({ type: z.literal("numbered"), items: z.array(z.string().max(2_000)).max(200), added: z.boolean().optional() }),
  z.object({ type: z.literal("checklist"), items: z.array(z.object({ text: z.string().max(2_000), done: z.boolean().default(false) })).max(200), added: z.boolean().optional() }),
  z.object({ type: z.literal("table"), header: z.array(z.string().max(200)).max(30), rows: z.array(z.array(z.string().max(2_000)).max(30)).max(200), added: z.boolean().optional() }),
  z.object({ type: z.literal("quote"), text: z.string().max(20_000), added: z.boolean().optional() }),
  z.object({ type: z.literal("clip"), clipId: z.string().max(120), added: z.boolean().optional() }),
]);

export const aiBlocksSchema = z.object({ blocks: z.array(aiBlockSchema).max(500) });

export type AiBlock = z.infer<typeof aiBlockSchema>;
export type AiBlocks = z.infer<typeof aiBlocksSchema>;

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
