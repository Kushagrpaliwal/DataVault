import { Elysia } from "elysia";
import { folderTagSchema, itemOrganizationSchema, tagCreateSchema, tagPatchSchema, uuidSchema, vaultCreateSchema, vaultPatchSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import {
  createTag, createVault, deleteTag, deleteVault,
  listTags, listVaults, organizeSavedRecord, tagFolder, untagFolder, updateTag, updateVault,
} from "../services/vaults";

export function createVaultRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "vault-routes" })
    .get("/api/v1/vaults", async ({ request }) => success(await listVaults(await getTenantContext(request, auth, env, "captures.read"))))
    .post("/api/v1/vaults", async ({ body, request, set }) => { await requireCsrf(request, auth, env); set.status = 201; return success(await createVault(await getTenantContext(request, auth, env, "settings.manage"), request, vaultCreateSchema.parse(body))); })
    .patch("/api/v1/vaults/:id", async ({ body, params, request }) => { await requireCsrf(request, auth, env); return success(await updateVault(await getTenantContext(request, auth, env, "settings.manage"), request, uuidSchema.parse(params.id), vaultPatchSchema.parse(body))); })
    .delete("/api/v1/vaults/:id", async ({ params, request }) => { await requireCsrf(request, auth, env); return success(await deleteVault(await getTenantContext(request, auth, env, "settings.manage"), request, uuidSchema.parse(params.id))); })
    /**
     * A tag is put on a folder.
     *
     * The tag is made in the workspace, and put on the items of the folder,
     * so that it shows up in the list of the tags of that folder at once.
     */
    .post("/api/v1/vaults/:id/tags", async ({ body, params, request }) => { await requireCsrf(request, auth, env); return success(await tagFolder(await getTenantContext(request, auth, env, "captures.update"), request, uuidSchema.parse(params.id), folderTagSchema.parse(body))); })
    .delete("/api/v1/vaults/:id/tags/:tagId", async ({ params, request }) => { await requireCsrf(request, auth, env); return success(await untagFolder(await getTenantContext(request, auth, env, "captures.update"), request, uuidSchema.parse(params.id), uuidSchema.parse(params.tagId))); })
    .get("/api/v1/tags", async ({ request, query }) => {
      /**
       * The folder is optional.
       *
       * With it, only the tags that are used in that folder are sent back, so
       * the list of tags is different for each folder. Without it, every tag
       * of the workspace is sent back.
       */
      const vaultId = typeof query.vaultId === "string" && query.vaultId ? uuidSchema.parse(query.vaultId) : undefined;
      return success(await listTags(await getTenantContext(request, auth, env, "captures.read"), vaultId));
    })
    .post("/api/v1/tags", async ({ body, request, set }) => { await requireCsrf(request, auth, env); set.status = 201; return success(await createTag(await getTenantContext(request, auth, env, "captures.update"), request, tagCreateSchema.parse(body))); })
    .patch("/api/v1/tags/:id", async ({ body, params, request }) => { await requireCsrf(request, auth, env); return success(await updateTag(await getTenantContext(request, auth, env, "captures.update"), request, uuidSchema.parse(params.id), tagPatchSchema.parse(body))); })
    .delete("/api/v1/tags/:id", async ({ params, request }) => { await requireCsrf(request, auth, env); return success(await deleteTag(await getTenantContext(request, auth, env, "captures.update"), request, uuidSchema.parse(params.id))); })
    .put("/api/v1/saved-records/:id/organization", async ({ body, params, request }) => { await requireCsrf(request, auth, env); return success(await organizeSavedRecord(await getTenantContext(request, auth, env, "captures.update"), request, uuidSchema.parse(params.id), itemOrganizationSchema.parse(body))); });
}
