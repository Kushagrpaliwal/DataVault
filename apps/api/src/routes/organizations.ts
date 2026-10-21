import { Elysia } from "elysia";
import { organizationCreateSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getActor } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { createOrganization, listOrganizations } from "../services/organizations";

export function createOrganizationRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "organization-routes" })
    .get("/api/v1/organizations", async ({ request }) => { const actor = await getActor(request, auth, env); return success(await listOrganizations(actor.userId)); })
    .post("/api/v1/organizations", async ({ body, request, set }) => { await requireCsrf(request, auth, env); const actor = await getActor(request, auth, env); const organization = await createOrganization(actor.userId, organizationCreateSchema.parse(body)); set.status = 201; return success(organization); });
}
