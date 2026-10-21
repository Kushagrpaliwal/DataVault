import { Elysia } from "elysia";
import { paymentCreateSchema, paymentListQuerySchema, paymentPatchSchema, refundCreateSchema, uuidSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { runIdempotent } from "../services/idempotency";
import { createPayment, createRefund, getPayment, listPayments, updatePayment } from "../services/payments";

export function createPaymentRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "payment-routes" })
    .get("/api/v1/payments", async ({ query, request }) => success(await listPayments(await getTenantContext(request, auth, env, "payments.read"), paymentListQuerySchema.parse(query))))
    .get("/api/v1/payments/:id", async ({ params, request }) => success(await getPayment(await getTenantContext(request, auth, env, "payments.read"), uuidSchema.parse(params.id))))
    .post("/api/v1/payments", async ({ body, request, set }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "payments.create");
      const input = paymentCreateSchema.parse(body);
      const result = await runIdempotent(context, "payment.create", request.headers.get("idempotency-key"), input, () => createPayment(context, request, input));
      set.status = 201;
      return success(result);
    })
    .patch("/api/v1/payments/:id", async ({ body, params, request }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "payments.update");
      return success(await updatePayment(context, request, uuidSchema.parse(params.id), paymentPatchSchema.parse(body)));
    })
    .post("/api/v1/payments/:id/refund", async ({ body, params, request, set }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "payments.refund");
      const paymentId = uuidSchema.parse(params.id);
      const input = refundCreateSchema.parse(body);
      const result = await runIdempotent(context, `payment.refund:${paymentId}`, request.headers.get("idempotency-key"), input, () => createRefund(context, request, paymentId, input));
      set.status = 201;
      return success(result);
    });
}
