/**
 * Which folder new items go into.
 *
 * This is kept on its own, away from the browser, so the rule can be
 * checked on its own.
 */

/**
 * A folder the extension can save into.
 *
 * It is the same folder the website has, so an item saved here shows up in
 * the same place on the website.
 */
export interface FolderOption {
  id: string;
  name: string;
  /** The folder this one sits inside. Empty when it is at the top. */
  parentId?: string | null | undefined;
  isDefault: boolean;
  /** How many saved items are in this folder. */
  itemCount?: number | undefined;
}

/**
 * The part of the settings that says which folder is used.
 */
export interface FolderPreference {
  defaultVaultId?: string | undefined;
  defaultVaultOrganizationId?: string | undefined;
}

/**
 * The folder new items go into.
 *
 * The folder that was chosen is used when it still belongs to the workspace
 * the extension is in, and when it is still there. Otherwise the default
 * folder of the workspace is used, which is where the server puts anything
 * that has not been given a folder.
 */
export function pickFolder(
  folders: FolderOption[],
  preferences: FolderPreference,
  workspace?: string,
): string {
  if (
    preferences.defaultVaultId
    && preferences.defaultVaultOrganizationId === workspace
    && folders.some((folder) => folder.id === preferences.defaultVaultId)
  ) {
    return preferences.defaultVaultId;
  }
  return folders.find((folder) => folder.isDefault)?.id ?? folders[0]?.id ?? "";
}
