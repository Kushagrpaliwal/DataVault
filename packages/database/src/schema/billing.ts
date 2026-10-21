import { check, date, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { invoiceKindEnum, invoiceStatusEnum, paymentDirectionEnum, paymentStatusEnum, recurringFrequencyEnum, recurringStatusEnum, refundStatusEnum } from "./enums";
import { savedRecords } from "./records";
import { organizations } from "./tenancy";

const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const archivedTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
};

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(), color: text("color").notNull().default("#b8a4ed"), ...archivedTimestamps,
}, (table) => [uniqueIndex("categories_org_name_unique").on(table.organizationId, table.name)]);

export const paymentMethods = pgTable("payment_methods", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(), kind: text("kind").notNull(), ...archivedTimestamps,
}, (table) => [uniqueIndex("payment_methods_org_name_unique").on(table.organizationId, table.name)]);

const partyFields = {
  company: text("company"), email: text("email"), phone: text("phone"), gstin: text("gstin"),
  billingAddress: jsonb("billing_address").$type<Record<string, string> | null>(), notes: text("notes"), tags: jsonb("tags").$type<string[]>().notNull().default([]),
};

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  savedRecordId: uuid("saved_record_id").notNull().references(() => savedRecords.id), name: text("name").notNull(), ...partyFields, ...archivedTimestamps,
}, (table) => [uniqueIndex("customers_record_unique").on(table.savedRecordId), index("customers_org_name_idx").on(table.organizationId, table.name)]);

export const vendors = pgTable("vendors", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  savedRecordId: uuid("saved_record_id").notNull().references(() => savedRecords.id), name: text("name").notNull(), ...partyFields, ...archivedTimestamps,
}, (table) => [uniqueIndex("vendors_record_unique").on(table.savedRecordId), index("vendors_org_name_idx").on(table.organizationId, table.name)]);

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  savedRecordId: uuid("saved_record_id").notNull().references(() => savedRecords.id), invoiceNumber: text("invoice_number").notNull(), kind: invoiceKindEnum("kind").notNull(),
  customerId: uuid("customer_id").references(() => customers.id), vendorId: uuid("vendor_id").references(() => vendors.id), issueDate: date("issue_date").notNull(), dueDate: date("due_date").notNull(),
  currency: text("currency").notNull().default("INR"), subtotal: money("subtotal").notNull(), taxAmount: money("tax_amount").notNull().default("0.00"),
  discountAmount: money("discount_amount").notNull().default("0.00"), totalAmount: money("total_amount").notNull(), amountPaid: money("amount_paid").notNull().default("0.00"),
  outstandingAmount: money("outstanding_amount").notNull(), notes: text("notes"), terms: text("terms"), status: invoiceStatusEnum("status").notNull().default("draft"),
  createdBy: uuid("created_by").notNull().references(() => users.id), updatedBy: uuid("updated_by").notNull().references(() => users.id), ...archivedTimestamps,
}, (table) => [uniqueIndex("invoices_org_number_unique").on(table.organizationId, table.invoiceNumber), uniqueIndex("invoices_record_unique").on(table.savedRecordId), index("invoices_org_status_due_idx").on(table.organizationId, table.status, table.dueDate), check("invoice_exactly_one_party", sql`num_nonnulls(${table.customerId}, ${table.vendorId}) = 1`)]);

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }), description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(), rate: money("rate").notNull(), taxRate: numeric("tax_rate", { precision: 7, scale: 2 }).notNull().default("0"),
  discountAmount: money("discount_amount").notNull().default("0.00"), lineTotal: money("line_total").notNull(), position: numeric("position", { precision: 4, scale: 0 }).notNull(),
}, (table) => [index("invoice_items_invoice_idx").on(table.organizationId, table.invoiceId)]);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  savedRecordId: uuid("saved_record_id").references(() => savedRecords.id), paymentNumber: text("payment_number").notNull(), direction: paymentDirectionEnum("direction").notNull(),
  customerId: uuid("customer_id").references(() => customers.id), vendorId: uuid("vendor_id").references(() => vendors.id), amount: money("amount").notNull(), currency: text("currency").notNull().default("INR"),
  taxAmount: money("tax_amount").notNull().default("0.00"), feeAmount: money("fee_amount").notNull().default("0.00"), discountAmount: money("discount_amount").notNull().default("0.00"), netAmount: money("net_amount").notNull(),
  paymentMethodId: uuid("payment_method_id").references(() => paymentMethods.id), categoryId: uuid("category_id").references(() => categories.id), invoiceId: uuid("invoice_id").references(() => invoices.id),
  transactionReference: text("transaction_reference"), utr: text("utr"), description: text("description"), notes: text("notes"), status: paymentStatusEnum("status").notNull().default("pending"), paymentDate: date("payment_date").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id), updatedBy: uuid("updated_by").notNull().references(() => users.id), ...archivedTimestamps,
}, (table) => [uniqueIndex("payments_org_number_unique").on(table.organizationId, table.paymentNumber), uniqueIndex("payments_record_unique").on(table.savedRecordId), index("payments_org_date_idx").on(table.organizationId, table.paymentDate), index("payments_org_status_idx").on(table.organizationId, table.status), index("payments_org_utr_idx").on(table.organizationId, table.utr), index("payments_org_reference_idx").on(table.organizationId, table.transactionReference), check("payment_at_most_one_party", sql`num_nonnulls(${table.customerId}, ${table.vendorId}) <= 1`)]);

export const invoicePayments = pgTable("invoice_payments", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id), paymentId: uuid("payment_id").notNull().references(() => payments.id), amountApplied: money("amount_applied").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("invoice_payments_payment_unique").on(table.paymentId), index("invoice_payments_invoice_idx").on(table.organizationId, table.invoiceId)]);

export const refunds = pgTable("refunds", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  savedRecordId: uuid("saved_record_id").notNull().references(() => savedRecords.id), paymentId: uuid("payment_id").notNull().references(() => payments.id), refundNumber: text("refund_number").notNull(),
  amount: money("amount").notNull(), reason: text("reason").notNull(), status: refundStatusEnum("status").notNull().default("completed"), refundDate: date("refund_date").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [uniqueIndex("refunds_org_number_unique").on(table.organizationId, table.refundNumber), uniqueIndex("refunds_record_unique").on(table.savedRecordId), index("refunds_payment_idx").on(table.organizationId, table.paymentId)]);

export const recurringPayments = pgTable("recurring_payments", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), savedRecordId: uuid("saved_record_id").notNull().references(() => savedRecords.id),
  name: text("name").notNull(), amount: money("amount").notNull(), currency: text("currency").notNull().default("INR"), customerId: uuid("customer_id").references(() => customers.id), vendorId: uuid("vendor_id").references(() => vendors.id),
  paymentMethodId: uuid("payment_method_id").references(() => paymentMethods.id), categoryId: uuid("category_id").references(() => categories.id), frequency: recurringFrequencyEnum("frequency").notNull(), customIntervalDays: numeric("custom_interval_days", { precision: 6, scale: 0 }),
  startDate: date("start_date").notNull(), nextDueDate: date("next_due_date").notNull(), endDate: date("end_date"), status: recurringStatusEnum("status").notNull().default("active"),
  createdBy: uuid("created_by").notNull().references(() => users.id), updatedBy: uuid("updated_by").notNull().references(() => users.id), ...archivedTimestamps,
}, (table) => [uniqueIndex("recurring_record_unique").on(table.savedRecordId), index("recurring_org_due_idx").on(table.organizationId, table.status, table.nextDueDate)]);
