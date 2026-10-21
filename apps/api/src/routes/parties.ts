import { Elysia } from "elysia";
import { customerCreateSchema, customerPatchSchema, partyListQuerySchema, uuidSchema, vendorCreateSchema, vendorPatchSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { createParty, getParty, listParties, updateParty } from "../services/parties";

export function createPartyRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  const routes = new Elysia({ name: "party-routes" });
  for (const definition of [
    { path: "customers", kind: "customer" as const, create: customerCreateSchema, patch: customerPatchSchema, read: "customers.read", write: "customers.create", update: "customers.update" },
    { path: "vendors", kind: "vendor" as const, create: vendorCreateSchema, patch: vendorPatchSchema, read: "vendors.read", write: "vendors.create", update: "vendors.update" },
  ]) {
    routes
      .get(`/api/v1/${definition.path}`, async ({ query, request }) => success(await listParties(await getTenantContext(request, auth, env, definition.read), definition.kind, partyListQuerySchema.parse(query))))
      .get(`/api/v1/${definition.path}/:id`, async ({ params, request }) => success(await getParty(await getTenantContext(request, auth, env, definition.read), definition.kind, uuidSchema.parse(params.id))))
      .post(`/api/v1/${definition.path}`, async ({ body, request, set }) => {
        await requireCsrf(request, auth, env);
        const context = await getTenantContext(request, auth, env, definition.write);
        set.status = 201;
        return success(await createParty(context, request, definition.kind, definition.create.parse(body)));
      })
      .patch(`/api/v1/${definition.path}/:id`, async ({ body, params, request }) => {
        await requireCsrf(request, auth, env);
        const context = await getTenantContext(request, auth, env, definition.update);
        return success(await updateParty(context, request, definition.kind, uuidSchema.parse(params.id), definition.patch.parse(body)));
      });
  }
  return routes;
}
