import { Elysia } from "elysia";
import { importCreateSchema } from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getTenantContext } from "../auth/context";
import { requireCsrf } from "../auth/csrf";
import { success } from "../lib/http";
import { enforceRateLimit, RATE_LIMITS } from "../lib/rate-limit-policies";
import { exportWorkspaceArchive, runImport } from "../services/imports";

export function createImportRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  return new Elysia({ name: "import-routes" })
    /**
     * Bring material into the workspace.
     *
     * The file is read on the server, so the folders it came from are kept
     * and the items are filed in a folder of their own.
     *
     * An import writes a great many rows, so it has a budget of its own.
     */
    .post("/api/v1/imports", async ({ body, request, set }) => {
      await requireCsrf(request, auth, env);
      await enforceRateLimit(request, env, RATE_LIMITS.imports);
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
     * else, or brought back if it is lost. It is an archive, so it can be
     * opened like a folder and the attachments come out as they are.
     */
    .get("/api/v1/export", async ({ request, set }) => {
      const context = await getTenantContext(request, auth, env, "records.read");
      const archive = await exportWorkspaceArchive(context);
      set.headers["content-type"] = "application/zip";
      set.headers["content-disposition"] = `attachment; filename="datavault-export-${new Date().toISOString().slice(0, 10)}.zip"`;
      return archive;
    });
}
