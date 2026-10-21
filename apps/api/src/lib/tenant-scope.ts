import { and, eq, getTableColumns } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DatabaseTransaction } from "@data-vault/database";
import { AppError } from "./errors";

/**
 * Confirm that a row a client named belongs to this workspace.
 *
 * A foreign key on its own says nothing about which workspace a row is in,
 * so a client could point a doc at a folder in another workspace and the
 * database would accept it happily. Every id that comes from a client is
 * checked here before it is written down.
 *
 * The row is looked up inside the workspace and the answer is a plain "not
 * found", so a caller cannot use this to discover what exists in a workspace
 * they do not belong to.
 */
export async function assertSameOrg(
  tx: DatabaseTransaction,
  table: PgTable,
  id: string,
  organizationId: string,
  label: string,
): Promise<void> {
  const columns = getTableColumns(table) as unknown as { id: PgColumn; organizationId: PgColumn };
  const [row] = await tx
    .select({ id: columns.id })
    .from(table)
    .where(and(eq(columns.organizationId, organizationId), eq(columns.id, id)))
    .limit(1);
  if (!row) throw new AppError(404, "NOT_FOUND", `That ${label} could not be found in this workspace.`);
}
