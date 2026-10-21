import { z } from "zod";

export const uuidSchema = z.uuid();
export const booleanQuerySchema = z.preprocess((value) => {
  if (value === undefined) return false;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return value;
}, z.boolean());
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, "Use a three-letter ISO currency code");
export const dateSchema = z.iso.date();
export const dateTimeSchema = z.iso.datetime({ offset: true });

/**
 * A URL check that reports a validation problem instead of throwing.
 *
 * `z.url()` parses the value with the URL constructor, and a blank or
 * malformed value throws a raw `TypeError` rather than a validation issue. The
 * result is that a bad request is reported as a server fault, with no hint
 * about which field was wrong. This never throws.
 */
export const urlSchema = z.string().trim().min(1, "Enter a valid URL.").superRefine((value, ctx) => {
  try {
    new URL(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Enter a valid URL." });
  }
});

/** A URL that has to be a web address, so `http` or `https`. */
export const httpUrlSchema = urlSchema.superRefine((value, ctx) => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    ctx.addIssue({ code: "custom", message: "Only web addresses are allowed." });
  }
});

/**
 * A web address that may be missing.
 *
 * A browser will not always tell an extension which page it is on, so a
 * capture can arrive without a source address. That is a normal thing, not a
 * mistake, so a blank value is treated as "not known".
 */
export const optionalHttpUrlSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value !== undefined && value.trim() === "" ? undefined : value))
  .superRefine((value, ctx) => {
    if (value === undefined) return;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid URL." });
      return;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      ctx.addIssue({ code: "custom", message: "Only web addresses are allowed." });
    }
  });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const sortDirectionSchema = z.enum(["asc", "desc"]);

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});

export const apiFailureSchema = z.object({ success: z.literal(false), error: apiErrorSchema });

export function apiSuccessSchema<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data });
}

export function paginationResultSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  });
}
