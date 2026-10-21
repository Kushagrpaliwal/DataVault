import { Elysia } from "elysia";
import { importCreateSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { exportWorkspace, runImport } from "../services/imports";

export function createImportRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "import-routes" })
    /**
     * Bring material into the workspace.
     *
     * The file is read on the server, so the folders it came from are kept
     * and the items are filed in a folder of their own.
     */
    .post("/api/v1/imports", async ({ body, request, set }) => {
      await requireCsrf(request, auth, env);
      const context = await getTenantContext(request, auth, env, "records.create");
      const input = importCreateSchema.parse(body);
      const result = await runImport(context, request, input);
      set.status = 201;
      return success(result);
    })
    /**
     * Everything in the workspace, as one file.
     *
     * The file holds the items, the folders, the collections, the tags, the
     * docs and the attachments, so that the workspace can be read somewhere
     * else, or brought back if it is lost.
     */
    .get("/api/v1/export", async ({ request, set }) => {
      const context = await getTenantContext(request, auth, env, "records.read");
      const data = await exportWorkspace(context);
      set.headers["content-type"] = "application/json; charset=utf-8";
      set.headers["content-disposition"] = `attachment; filename="datavault-export-${new Date().toISOString().slice(0, 10)}.json"`;
      return JSON.stringify(data, null, 2);
    });
}
