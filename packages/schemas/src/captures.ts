import { z } from "zod";
import { dateSchema, dateTimeSchema, uuidSchema } from "./common";
import { CAPTURE_KINDS, RECORD_TYPES } from "./constants";
import { sourceSchema } from "./records";

export const captureConfidenceSchema = z.record(z.string(), z.number().min(0).max(1));
export const captureQualitySchema = z.object({
  textLength: z.number().int().min(0).max(1_000_000),
  hasTitle: z.boolean(),
  hasSourceUrl: z.boolean(),
  likelyAccessWall: z.boolean(),
  likelyCookieBanner: z.boolean(),
  warnings: z.array(z.string().max(200)).max(10).default([]),
});

/**
 * What a clip looks like once it has been read.
 *
 * These are the fields a researcher needs in order to cite the source later,
 * so they describe the material itself rather than any transaction it may
 * happen to mention.
 */
export const parsedCaptureSchema = z.object({
  recordType: z.enum(RECORD_TYPES).optional(),
  title: z.string().max(250).optional(),
  /** The person or organisation credited as the author. */
  author: z.string().max(250).optional(),
  /** When the material was first published, as `YYYY-MM-DD`. */
  publishedAt: dateSchema.optional(),
  /** The one-line claim the passage makes. */
  claim: z.string().max(500).optional(),
  /** A figure quoted in the passage, kept exactly as it was written. */
  number: z.string().max(120).optional(),
  /** True when the clip is a short quotation rather than a paragraph. */
  isQuote: z.boolean().optional(),
  confidence: captureConfidenceSchema.default({}),
});

export const captureCreateSchema = z.object({
  selectedText: z.string().trim().min(1).max(100_000),
  originalText: z.string().max(100_000).optional(),
  /**
   * The page as it was, as the markup of the parts that were kept.
   *
   * It is kept so that the item can be traced back to the page, even after
   * the page itself has changed.
   */
  pageHtml: z.string().max(500_000).optional(),
  source: sourceSchema,
  capturedAt: dateTimeSchema.optional(),
  captureQuality: captureQualitySchema.optional(),
  parsedData: parsedCaptureSchema.optional(),
  recordType: z.enum(RECORD_TYPES).default("other"),
  confirmDuplicate: z.boolean().default(false),
  vaultId: uuidSchema.optional(),
  captureKind: z.enum(CAPTURE_KINDS).default("selection"),
  tagNames: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});
