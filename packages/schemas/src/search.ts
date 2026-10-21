import { z } from "zod";
import { dateSchema, paginationQuerySchema } from "./common";

export const searchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200),
  types: z.string().optional(),
});
export const reportQuerySchema = z.object({
  preset: z.enum(["today", "week", "month", "quarter", "year", "custom"]).default("month"),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
}).refine((value) => value.preset !== "custom" || Boolean(value.from && value.to), "Custom ranges require from and to dates");
