import { Elysia } from "elysia";
import { invoiceCreateSchema, invoiceListQuerySchema, invoicePatchSchema, uuidSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { runIdempotent } from "../services/idempotency";
import { createInvoice, getInvoice, listInvoices, updateInvoice } from "../services/invoices";

export function createInvoiceRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "invoice-routes" })
    .get("/api/v1/invoices", async ({ query, request }) => success(await listInvoices(await getTenantContext(request, auth, env, "invoices.read"), invoiceListQuerySchema.parse(query))))
    .get("/api/v1/invoices/:id", async ({ params, request }) => success(await getInvoice(await getTenantContext(request, auth, env, "invoices.read"), uuidSchema.parse(params.id))))
    .post("/api/v1/invoices", async ({ body, request, set }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "invoices.create");
      const input = invoiceCreateSchema.parse(body);
      const result = await runIdempotent(context, "invoice.create", request.headers.get("idempotency-key"), input, () => createInvoice(context, request, input));
      set.status = 201;
      return success(result);
    })
    .patch("/api/v1/invoices/:id", async ({ body, params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "invoices.update");
      return success(await updateInvoice(context, request, uuidSchema.parse(params.id), invoicePatchSchema.parse(body)));
    });
}
