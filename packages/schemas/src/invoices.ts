import { z } from "zod";
import { booleanQuerySchema, currencySchema, dateSchema, moneySchema, paginationQuerySchema, uuidSchema } from "./common";
import { INVOICE_KINDS, INVOICE_STATUSES } from "./constants";

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.string().regex(/^\d{1,10}(?:\.\d{1,4})?$/),
  rate: moneySchema,
  taxRate: z.string().regex(/^\d{1,3}(?:\.\d{1,2})?$/).default("0"),
  discountAmount: moneySchema.default("0.00"),
});

const invoiceFieldsSchema = z.object({
  kind: z.enum(INVOICE_KINDS).default("receivable"),
  customerId: uuidSchema.nullable().optional(),
  vendorId: uuidSchema.nullable().optional(),
  issueDate: dateSchema,
  dueDate: dateSchema,
  currency: currencySchema.default("INR"),
  items: z.array(invoiceItemSchema).min(1).max(100),
  notes: z.string().max(5_000).nullable().optional(),
  terms: z.string().max(5_000).nullable().optional(),
  status: z.enum(INVOICE_STATUSES).default("draft"),
});

export const invoiceCreateSchema = invoiceFieldsSchema.refine((value) => Boolean(value.customerId) !== Boolean(value.vendorId), "Select exactly one customer or vendor");

export const invoicePatchSchema = invoiceFieldsSchema.partial().refine((value) => Object.keys(value).length > 0, "No changes supplied");
export const invoiceListQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(200).optional(), status: z.enum(INVOICE_STATUSES).optional(), kind: z.enum(INVOICE_KINDS).optional(),
  from: dateSchema.optional(), to: dateSchema.optional(), archived: booleanQuerySchema,
});
export const invoicePaymentCreateSchema = z.object({ paymentId: uuidSchema, amountApplied: moneySchema });
