import { Elysia } from "elysia";
import { z } from "zod";
import { paginationQuerySchema, reportQuerySchema, searchQuerySchema, uuidSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { getDashboard } from "../services/dashboard";
import { createRecurring, listRecurring } from "../services/recurring";
import { globalSearch } from "../services/search";
import { createReferenceItem, listReferenceData } from "../services/settings";
import { getReport, listAuditLogs } from "../services/analytics";
import { getAttachment, saveScreenshot } from "../services/attachments";

const referenceSchema = z.object({ name: z.string().trim().min(1).max(100), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), kind: z.string().trim().max(60).optional() });
const recurringSchema = z.object({
  name: z.string().trim().min(1).max(200), amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/), currency: z.string().length(3).default("INR"),
  customerId: z.uuid().nullable().optional(), vendorId: z.uuid().nullable().optional(), paymentMethodId: z.uuid().nullable().optional(), categoryId: z.uuid().nullable().optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "custom"]), customIntervalDays: z.number().int().positive().max(3650).nullable().optional(),
  startDate: z.iso.date(), nextDueDate: z.iso.date().optional(), endDate: z.iso.date().nullable().optional(), status: z.enum(["active", "paused", "completed", "cancelled"]).default("active"),
});
const auditQuerySchema = paginationQuerySchema.extend({ resourceType: z.string().max(80).optional() });
const reportRequestSchema = reportQuerySchema.extend({ type: z.enum(["income", "expense", "cash-flow", "payment-method", "customer-revenue", "vendor-expense", "category", "outstanding-invoice", "refund", "extension-capture"]) });

export function createMiscRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "misc-routes" })
    .get("/api/v1/dashboard", async ({ request }) => success(await getDashboard(await getTenantContext(request, auth, env, "reports.read"))))
    .get("/api/v1/audit-logs", async ({ query, request }) => success(await listAuditLogs(await getTenantContext(request, auth, env, "reports.read"), auditQuerySchema.parse(query))))
    .get("/api/v1/reports", async ({ query, request }) => { const parsed = reportRequestSchema.parse(query); const now = new Date(); const to = parsed.to ?? now.toISOString().slice(0, 10); const from = parsed.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10); return success(await getReport(await getTenantContext(request, auth, env, "reports.read"), { type: parsed.type, from, to })); })
    .get("/api/v1/search", async ({ query, request }) => success(await globalSearch(await getTenantContext(request, auth, env, "captures.read"), searchQuerySchema.parse(query))))
    .get("/api/v1/settings/reference-data", async ({ request }) => success(await listReferenceData(await getTenantContext(request, auth, env, "captures.read"))))
    .post("/api/v1/settings/categories", async ({ body, request, set }) => { await requireCsrf(request, auth, env); set.status = 201; return success(await createReferenceItem(await getTenantContext(request, auth, env, "settings.manage"), "category", referenceSchema.parse(body))); })
    .post("/api/v1/settings/payment-methods", async ({ body, request, set }) => { await requireCsrf(request, auth, env); set.status = 201; return success(await createReferenceItem(await getTenantContext(request, auth, env, "settings.manage"), "payment-method", referenceSchema.parse(body))); })
    .get("/api/v1/recurring-payments", async ({ query, request }) => { const parsed = paginationQuerySchema.parse(query); return success(await listRecurring(await getTenantContext(request, auth, env, "payments.read"), parsed.page, parsed.limit)); })
    .post("/api/v1/recurring-payments", async ({ body, request, set }) => { await requireCsrf(request, auth, env); set.status = 201; return success(await createRecurring(await getTenantContext(request, auth, env, "payments.create"), recurringSchema.parse(body))); })
    .post("/api/v1/saved-records/:id/attachments", async ({ params, request, set }) => { await requireCsrf(request, auth, env); set.status = 201; return success(await saveScreenshot(await getTenantContext(request, auth, env, "captures.update"), request, env, uuidSchema.parse(params.id))); })
    .get("/api/v1/attachments/:id", async ({ params, request, set }) => { const attachment = await getAttachment(await getTenantContext(request, auth, env, "captures.read"), uuidSchema.parse(params.id)); set.headers["content-type"] = attachment.mimeType; set.headers["content-disposition"] = `inline; filename="${attachment.fileName.replaceAll('"', "")}"`; return attachment.content; });
}
