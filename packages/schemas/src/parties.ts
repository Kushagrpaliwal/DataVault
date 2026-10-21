import { z } from "zod";
import { addressSchema, booleanQuerySchema, paginationQuerySchema } from "./common";

const partyBaseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().trim().max(200).nullable().optional(),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  gstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/).nullable().optional(),
  billingAddress: addressSchema.nullable().optional(),
  notes: z.string().max(5_000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
});

export const customerCreateSchema = partyBaseSchema;
export const customerPatchSchema = partyBaseSchema.partial().refine((value) => Object.keys(value).length > 0, "No changes supplied");
export const vendorCreateSchema = partyBaseSchema;
export const vendorPatchSchema = customerPatchSchema;
export const partyListQuerySchema = paginationQuerySchema.extend({ q: z.string().trim().max(200).optional(), archived: booleanQuerySchema });
