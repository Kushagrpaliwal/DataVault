import { z } from "zod";
import { dateSchema, dateTimeSchema, moneySchema, uuidSchema } from "./common";
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
export const parsedCaptureSchema = z.object({
  recordType: z.enum(RECORD_TYPES).optional(),
  title: z.string().max(250).optional(),
  amount: moneySchema.optional(),
  currency: z.string().length(3).optional(),
  party: z.string().max(250).optional(),
  utr: z.string().max(120).optional(),
  transactionReference: z.string().max(120).optional(),
  paymentMethod: z.string().max(80).optional(),
  date: dateSchema.optional(),
  confidence: captureConfidenceSchema.default({}),
});

export const captureCreateSchema = z.object({
  selectedText: z.string().trim().min(1).max(100_000),
  originalText: z.string().max(100_000).optional(),
  source: sourceSchema,
  capturedAt: dateTimeSchema.optional(),
  captureQuality: captureQualitySchema.optional(),
  parsedData: parsedCaptureSchema.optional(),
  recordType: z.enum(RECORD_TYPES).default("other"),
  categoryId: uuidSchema.nullable().optional(),
  paymentMethodId: uuidSchema.nullable().optional(),
  confirmDuplicate: z.boolean().default(false),
  vaultId: uuidSchema.optional(),
  captureKind: z.enum(CAPTURE_KINDS).default("selection"),
  tagNames: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});
