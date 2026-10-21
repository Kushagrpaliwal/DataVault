import { z } from "zod";
import { booleanQuerySchema, currencySchema, dateSchema, moneySchema, paginationQuerySchema, uuidSchema } from "./common";
import { PAYMENT_DIRECTIONS, PAYMENT_STATUSES } from "./constants";

const paymentFieldsSchema = z.object({
  direction: z.enum(PAYMENT_DIRECTIONS),
  customerId: uuidSchema.nullable().optional(),
  vendorId: uuidSchema.nullable().optional(),
  amount: moneySchema,
  currency: currencySchema.default("INR"),
  taxAmount: moneySchema.default("0.00"),
  feeAmount: moneySchema.default("0.00"),
  discountAmount: moneySchema.default("0.00"),
  paymentMethodId: uuidSchema.nullable().optional(),
  categoryId: uuidSchema.nullable().optional(),
  invoiceId: uuidSchema.nullable().optional(),
  transactionReference: z.string().trim().max(120).nullable().optional(),
  utr: z.string().trim().max(120).nullable().optional(),
  description: z.string().max(2_000).optional(),
  notes: z.string().max(5_000).optional(),
  status: z.enum(PAYMENT_STATUSES).default("pending"),
  paymentDate: dateSchema,
  idempotencyKey: z.string().optional(),
});

export const paymentCreateSchema = paymentFieldsSchema.refine((value) => !(value.customerId && value.vendorId), "A payment cannot have both a customer and vendor");

export const paymentPatchSchema = paymentFieldsSchema.omit({ idempotencyKey: true }).partial().refine((value) => Object.keys(value).length > 0, "No changes supplied");
export const paymentListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  direction: z.enum(PAYMENT_DIRECTIONS).optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  archived: booleanQuerySchema,
});
export const refundCreateSchema = z.object({ amount: moneySchema, reason: z.string().trim().min(2).max(500), refundDate: dateSchema });
