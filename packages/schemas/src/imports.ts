import { z } from "zod";
import { uuidSchema } from "./common";

/**
 * The kinds of material that can be brought in.
 *
 * `bookmarks` is the file every browser writes when the bookmarks are
 * exported. `urls` is a list of addresses, one to a line. `datavault` is an
 * export of DataVault itself, so a workspace can be moved to another one.
 */
export const importKindSchema = z.enum(["bookmarks", "urls", "datavault"]);

export const importCreateSchema = z.object({
  kind: importKindSchema,
  /** The file, or the list, that is being brought in. */
  content: z.string().min(1).max(8_000_000),
  /** The folder the material goes into. The default folder is used when it is empty. */
  vaultId: uuidSchema.optional(),
  /** The name of the folder that is made for the import. */
  name: z.string().trim().max(120).optional(),
});

export type ImportKind = z.infer<typeof importKindSchema>;
export type ImportCreateInput = z.infer<typeof importCreateSchema>;
