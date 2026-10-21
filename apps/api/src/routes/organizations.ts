import { Elysia } from "elysia";
import { organizationCreateSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getActor } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { enforceRateLimit, RATE_LIMITS } from "../lib/rate-limit-policies";
import { createOrganization, listOrganizations } from "../services/organizations";

export function createOrganizationRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "organization-routes" })
    .get("/api/v1/organizations", async ({ request }) => { const actor = await getActor(request, auth, env); return success(await listOrganizations(actor.userId)); })
    /**
     * A new workspace is free, so it can be made in a loop. Each one is
     * another place to hide behind when a limit that is counted per workspace
     * is looked at, so the number of them is capped per account.
     */
    .post("/api/v1/organizations", async ({ body, request, set }) => {
      await requireCsrf(request, auth, env);
      await enforceRateLimit(request, env, RATE_LIMITS.organizationCreate);
      const actor = await getActor(request, auth, env);
      const organization = await createOrganization(actor.userId, organizationCreateSchema.parse(body));
      set.status = 201;
      return success(organization);
    });
}
