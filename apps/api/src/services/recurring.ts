import { addDays, addMonths, addQuarters, addWeeks, addYears, format } from "date-fns";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { recurringPayments, savedRecords, withTenant } from "@data-vault/database";
import type { TenantContext } from "../auth/context";
import { defaultVaultId } from "./vaults";

export interface RecurringInput {
  name: string; amount: string; currency: string; customerId?: string | null | undefined; vendorId?: string | null | undefined; paymentMethodId?: string | null | undefined; categoryId?: string | null | undefined;
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "custom"; customIntervalDays?: number | null | undefined; startDate: string; nextDueDate?: string | undefined; endDate?: string | null | undefined; status?: "active" | "paused" | "completed" | "cancelled" | undefined;
}

export function nextRecurringDate(current: string, frequency: RecurringInput["frequency"], customIntervalDays?: number | null) {
  const date = new Date(`${current}T00:00:00Z`);
  const next = frequency === "daily" ? addDays(date, 1) : frequency === "weekly" ? addWeeks(date, 1) : frequency === "monthly" ? addMonths(date, 1) : frequency === "quarterly" ? addQuarters(date, 1) : frequency === "yearly" ? addYears(date, 1) : addDays(date, customIntervalDays ?? 1);
  return format(next, "yyyy-MM-dd");
}

export async function listRecurring(context: TenantContext, page: number, limit: number) {
  return withTenant(context.organizationId, async (tx) => {
    const where = and(eq(recurringPayments.organizationId, context.organizationId), isNull(recurringPayments.archivedAt));
    const [rows, totals] = await Promise.all([tx.select().from(recurringPayments).where(where).orderBy(desc(recurringPayments.nextDueDate)).limit(limit).offset((page - 1) * limit), tx.select({ count: count() }).from(recurringPayments).where(where)]);
    const total = totals[0]?.count ?? 0; return { items: rows, page, limit, total, totalPages: Math.ceil(total / limit) };
  });
}

export async function createRecurring(context: TenantContext, input: RecurringInput) {
  return withTenant(context.organizationId, async (tx) => {
    const nextDueDate = input.nextDueDate ?? input.startDate;
    const vaultId = await defaultVaultId(tx, context.organizationId);
    const [record] = await tx.insert(savedRecords).values({ organizationId: context.organizationId, vaultId, recordType: "subscription", title: input.name, sourceType: "manual", createdVia: "website", summaryAmount: input.amount, summaryCurrency: input.currency, summaryStatus: input.status ?? "active", createdBy: context.userId }).returning(); if (!record) throw new Error("Recurring record insert failed");
    const [row] = await tx.insert(recurringPayments).values({ organizationId: context.organizationId, savedRecordId: record.id, name: input.name, amount: input.amount, currency: input.currency, customerId: input.customerId ?? null, vendorId: input.vendorId ?? null, paymentMethodId: input.paymentMethodId ?? null, categoryId: input.categoryId ?? null, frequency: input.frequency, customIntervalDays: input.customIntervalDays ? String(input.customIntervalDays) : null, startDate: input.startDate, nextDueDate, endDate: input.endDate ?? null, status: input.status ?? "active", createdBy: context.userId, updatedBy: context.userId }).returning();
    return row;
  });
}
