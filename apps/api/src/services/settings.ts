import { and, eq, isNull } from "drizzle-orm";
import { categories, paymentMethods, withTenant } from "@data-vault/database";
import type { TenantContext } from "../auth/context";
import { AppError } from "../lib/errors";

export async function listReferenceData(context: TenantContext) {
  return withTenant(context.organizationId, async (tx) => {
    const [categoryRows, methodRows] = await Promise.all([
      tx.select().from(categories).where(and(eq(categories.organizationId, context.organizationId), isNull(categories.archivedAt))).orderBy(categories.name),
      tx.select().from(paymentMethods).where(and(eq(paymentMethods.organizationId, context.organizationId), isNull(paymentMethods.archivedAt))).orderBy(paymentMethods.name),
    ]);
    return { categories: categoryRows, paymentMethods: methodRows };
  });
}

export async function createReferenceItem(context: TenantContext, kind: "category" | "payment-method", input: { name: string; color?: string | undefined; kind?: string | undefined }) {
  return withTenant(context.organizationId, async (tx) => {
    if (kind === "category") {
      const [row] = await tx.insert(categories).values({ organizationId: context.organizationId, name: input.name, color: input.color ?? "#b8a4ed" }).returning();
      if (!row) throw new AppError(500, "CREATE_FAILED", "Category could not be created."); return row;
    }
    const [row] = await tx.insert(paymentMethods).values({ organizationId: context.organizationId, name: input.name, kind: input.kind ?? input.name.toLowerCase() }).returning();
    if (!row) throw new AppError(500, "CREATE_FAILED", "Payment method could not be created."); return row;
  });
}
