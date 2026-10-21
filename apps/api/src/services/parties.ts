import { and, count, desc, eq, ilike, isNotNull, isNull, or, sum } from "drizzle-orm";
import { customers, invoices, payments, savedRecords, vendors, withTenant } from "@data-vault/database";
import type { customerCreateSchema, customerPatchSchema, partyListQuerySchema } from "@data-vault/schemas";
import type { z } from "zod";
import type { TenantContext } from "../auth/context";
import { notFound } from "../lib/errors";
import { writeAudit } from "./audit";
import { defaultVaultId } from "./vaults";

type PartyKind = "customer" | "vendor";
type CreateInput = z.infer<typeof customerCreateSchema>;
type PatchInput = z.infer<typeof customerPatchSchema>;
type ListQuery = z.infer<typeof partyListQuerySchema>;

function tableFor(kind: PartyKind) { return kind === "customer" ? customers : vendors; }

export async function createParty(context: TenantContext, request: Request, kind: PartyKind, input: CreateInput) {
  return withTenant(context.organizationId, async (tx) => {
    const vaultId = await defaultVaultId(tx, context.organizationId);
    const [record] = await tx.insert(savedRecords).values({ organizationId: context.organizationId, vaultId, recordType: kind, title: input.name, description: input.notes ?? null, sourceType: "manual", createdVia: "website", summaryParty: input.name, createdBy: context.userId }).returning();
    if (!record) throw new Error("Party record insert failed");
    const billingAddress = input.billingAddress ? Object.fromEntries(Object.entries(input.billingAddress).filter(([, value]) => value !== undefined)) as Record<string, string> : null;
    const values = { organizationId: context.organizationId, savedRecordId: record.id, name: input.name, company: input.company ?? null, email: input.email ?? null, phone: input.phone ?? null, gstin: input.gstin ?? null, billingAddress, notes: input.notes ?? null, tags: input.tags };
    const [party] = kind === "customer" ? await tx.insert(customers).values(values).returning() : await tx.insert(vendors).values(values).returning();
    if (!party) throw new Error("Party insert failed");
    await writeAudit(tx, context, request, { action: "created", resourceType: kind, resourceId: party.id, newValues: { name: party.name, email: party.email } });
    return { ...party, createdAt: party.createdAt.toISOString(), updatedAt: party.updatedAt.toISOString(), archivedAt: null };
  });
}

export async function listParties(context: TenantContext, kind: PartyKind, query: ListQuery) {
  return withTenant(context.organizationId, async (tx) => {
    const table = tableFor(kind);
    const conditions = [eq(table.organizationId, context.organizationId), query.archived ? isNotNull(table.archivedAt) : isNull(table.archivedAt)];
    if (query.q) conditions.push(or(ilike(table.name, `%${query.q}%`), ilike(table.company, `%${query.q}%`), ilike(table.email, `%${query.q}%`), ilike(table.gstin, `%${query.q}%`))!);
    const where = and(...conditions);
    const [rows, totals] = await Promise.all([tx.select().from(table).where(where).orderBy(desc(table.createdAt)).limit(query.limit).offset((query.page - 1) * query.limit), tx.select({ count: count() }).from(table).where(where)]);
    const total = totals[0]?.count ?? 0;
    return { items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null })), page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  });
}

export async function getParty(context: TenantContext, kind: PartyKind, id: string) {
  return withTenant(context.organizationId, async (tx) => {
    const table = tableFor(kind);
    const [party] = await tx.select().from(table).where(and(eq(table.organizationId, context.organizationId), eq(table.id, id))).limit(1);
    if (!party) throw notFound(kind);
    const partyCondition = kind === "customer" ? eq(payments.customerId, id) : eq(payments.vendorId, id);
    const invoicePartyCondition = kind === "customer" ? eq(invoices.customerId, id) : eq(invoices.vendorId, id);
    const [paymentRows, invoiceRows, totals, outstanding] = await Promise.all([
      tx.select().from(payments).where(and(eq(payments.organizationId, context.organizationId), partyCondition)).orderBy(desc(payments.paymentDate)).limit(50),
      tx.select().from(invoices).where(and(eq(invoices.organizationId, context.organizationId), invoicePartyCondition)).orderBy(desc(invoices.issueDate)).limit(50),
      tx.select({ total: sum(payments.netAmount) }).from(payments).where(and(eq(payments.organizationId, context.organizationId), partyCondition, eq(payments.status, "completed"))),
      tx.select({ total: sum(invoices.outstandingAmount) }).from(invoices).where(and(eq(invoices.organizationId, context.organizationId), invoicePartyCondition, or(eq(invoices.status, "sent"), eq(invoices.status, "partially_paid"), eq(invoices.status, "overdue")))),
    ]);
    return { ...party, createdAt: party.createdAt.toISOString(), updatedAt: party.updatedAt.toISOString(), total: totals[0]?.total ?? "0.00", outstanding: outstanding[0]?.total ?? "0.00", payments: paymentRows, invoices: invoiceRows };
  });
}

export async function updateParty(context: TenantContext, request: Request, kind: PartyKind, id: string, input: PatchInput) {
  return withTenant(context.organizationId, async (tx) => {
    const table = tableFor(kind);
    const [before] = await tx.select().from(table).where(and(eq(table.organizationId, context.organizationId), eq(table.id, id))).limit(1);
    if (!before) throw notFound(kind);
    const { billingAddress: inputAddress, ...fields } = input;
    const billingAddress = inputAddress ? Object.fromEntries(Object.entries(inputAddress).filter(([, value]) => value !== undefined)) as Record<string, string> : inputAddress;
    const [after] = await tx.update(table).set({ ...fields, ...(inputAddress !== undefined ? { billingAddress } : {}), updatedAt: new Date() }).where(and(eq(table.organizationId, context.organizationId), eq(table.id, id))).returning();
    if (!after) throw notFound(kind);
    if (input.name || input.notes !== undefined) await tx.update(savedRecords).set({ ...(input.name ? { title: input.name, summaryParty: input.name } : {}), ...(input.notes !== undefined ? { description: input.notes } : {}), updatedAt: new Date() }).where(and(eq(savedRecords.organizationId, context.organizationId), eq(savedRecords.id, after.savedRecordId)));
    await writeAudit(tx, context, request, { action: "updated", resourceType: kind, resourceId: id, previousValues: { name: before.name, email: before.email }, newValues: { name: after.name, email: after.email } });
    return { ...after, createdAt: after.createdAt.toISOString(), updatedAt: after.updatedAt.toISOString() };
  });
}
