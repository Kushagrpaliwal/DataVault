import type { Vault } from "@data-vault/types";
import { withOrganization } from "./api";
import { pickFolder, type FolderOption } from "./folder-choice";
import { effectiveWorkspaceId, getPreferences, setPreferences } from "./storage";

export type { FolderOption } from "./folder-choice";

/**
 * The folders of the workspace the extension is in.
 *
 * The folders belong to the workspace, so they are read again whenever the
 * sign-in changes.
 */
export async function listFolders(force = false): Promise<FolderOption[]> {
  if (!force && cachedFolders && Date.now() - cachedFolders.at < FOLDER_CACHE_MS) return cachedFolders.folders;
  const vaults = await withOrganization((api) => api.listVaults());
  const folders = vaults.map((vault: Vault) => ({
    id: vault.id,
    name: vault.name,
    parentId: vault.parentId,
    isDefault: vault.isDefault,
    itemCount: vault.itemCount,
  }));
  cachedFolders = { folders, at: Date.now() };
  return folders;
}

/**
 * The folders, with the folder they sit inside, so that a sub-folder can be
 * shown under the folder it belongs to.
 */
export function folderDepths(folders: FolderOption[]): Map<string, number> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const depths = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string>): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const folder = byId.get(id);
    const parentId = folder?.parentId;
    const depth = parentId ? depthOf(parentId, seen) + 1 : 0;
    depths.set(id, depth);
    return depth;
  };
  for (const folder of folders) depthOf(folder.id, new Set());
  return depths;
}

/**
 * The folders, remembered for a short while.
 *
 * The extension saves without asking, so the folder has to be known without
 * asking the server every time. The list is kept for a minute, which is short
 * enough that a folder made on the website turns up quickly and long enough
 * that a burst of saves does not ask the same question again and again.
 */
let cachedFolders: { folders: FolderOption[]; at: number } | undefined;
const FOLDER_CACHE_MS = 60_000;

/**
 * Remember the folder that new items go into.
 *
 * The folder belongs to a workspace, so the workspace is remembered with it.
 * A folder from another workspace would be refused by the server, so it is
 * only used while the extension is still in that workspace.
 */
export async function rememberFolder(folderId: string | undefined) {
  const preferences = await getPreferences();
  if (!folderId) {
    await setPreferences({ ...preferences, defaultVaultId: undefined, defaultVaultOrganizationId: undefined });
    return;
  }
  const workspace = await effectiveWorkspaceId();
  await setPreferences({ ...preferences, defaultVaultId: folderId, defaultVaultOrganizationId: workspace });
}

/**
 * The folder new items go into, as it is known right now.
 *
 * The folder that was chosen is used when it still belongs to the workspace
 * the extension is in. Otherwise the default folder of the workspace is used,
 * which is where the server puts anything that has not been given a folder.
 */
export async function currentFolderId(folders: FolderOption[]): Promise<string> {
  const preferences = await getPreferences();
  const workspace = await effectiveWorkspaceId();
  return pickFolder(folders, preferences, workspace);
}

/**
 * The folder a new item goes into, or nothing when there is no answer.
 *
 * The folder that was chosen is used when it is still there. A folder that
 * has been removed on the website is not used, because the server would
 * refuse the save.
 */
export async function folderForNewItems(): Promise<string | undefined> {
  try {
    const folders = await listFolders();
    if (!folders.length) return undefined;
    return (await currentFolderId(folders)) || undefined;
  } catch {
    return undefined;
  }
}
