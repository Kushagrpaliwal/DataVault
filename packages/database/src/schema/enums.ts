import { pgEnum } from "drizzle-orm/pg-core";
import { CREATED_VIA, INVOICE_KINDS, INVOICE_STATUSES, PAYMENT_DIRECTIONS, PAYMENT_STATUSES, RECORD_TYPES, RECURRING_FREQUENCIES, RECURRING_STATUSES, SOURCE_TYPES } from "@data-vault/schemas";

export const recordTypeEnum = pgEnum("record_type", RECORD_TYPES);
export const createdViaEnum = pgEnum("created_via", CREATED_VIA);
export const sourceTypeEnum = pgEnum("source_type", SOURCE_TYPES);
export const paymentDirectionEnum = pgEnum("payment_direction", PAYMENT_DIRECTIONS);
export const paymentStatusEnum = pgEnum("payment_status", PAYMENT_STATUSES);
export const invoiceStatusEnum = pgEnum("invoice_status", INVOICE_STATUSES);
export const invoiceKindEnum = pgEnum("invoice_kind", INVOICE_KINDS);
export const recurringFrequencyEnum = pgEnum("recurring_frequency", RECURRING_FREQUENCIES);
export const recurringStatusEnum = pgEnum("recurring_status", RECURRING_STATUSES);
export const memberStatusEnum = pgEnum("member_status", ["active", "invited", "suspended"]);
export const refundStatusEnum = pgEnum("refund_status", ["pending", "completed", "failed", "cancelled"]);
