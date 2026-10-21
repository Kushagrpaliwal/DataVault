import type { VaultCollection } from "@data-vault/types";
import { withOrganization } from "./api";
import { getPreferences, setPreferences } from "./storage";

/**
 * A collection the extension can put an item into.
 *
 * It is the same collection the website has, so an item saved here shows up
 * in the same place on the website.
 */
export interface CollectionOption {
  id: string;
  name: string;
  /** How many saved items are in this collection. */
  itemCount?: number | undefined;
}

/**
 * The part of the settings that says which collection is used.
 */
export interface CollectionPreference {
  defaultCollectionId?: string | undefined;
  defaultCollectionVaultId?: string | undefined;
}

/**
 * The collections of a folder.
 *
 * A collection belongs to one folder, so the list is asked for again
 * whenever the folder changes. The answer is kept for a minute, so that
 * choosing a collection does not ask the server over and over.
 */
export async function listCollections(vaultId: string | undefined): Promise<CollectionOption[]> {
  if (!vaultId) return [];
  const cached = cachedCollections.get(vaultId);
  if (cached && Date.now() - cached.at < COLLECTION_CACHE_MS) return cached.collections;
  const collections = await withOrganization((api) => api.listCollections(vaultId));
  const options = collections.map((collection: VaultCollection) => ({
    id: collection.id,
    name: collection.name,
    itemCount: collection.itemCount,
  }));
  cachedCollections.set(vaultId, { collections: options, at: Date.now() });
  return options;
}

/**
 * The collections of each folder, kept for a short while.
 */
const cachedCollections = new Map<string, { collections: CollectionOption[]; at: number }>();
const COLLECTION_CACHE_MS = 60_000;

/**
 * Forget the collections of a folder.
 *
 * The list is asked for again when it is needed, so a collection made on
 * the website turns up straight away.
 */
export function forgetCollections(vaultId?: string): void {
  if (!vaultId) {
    cachedCollections.clear();
    return;
  }
  cachedCollections.delete(vaultId);
}

/**
 * Remember the collection new items go into.
 *
 * The collection belongs to one folder, so the folder is remembered with
 * it. A collection is only used while the extension is still in that
 * folder.
 */
export async function rememberCollection(collectionId: string | undefined, vaultId: string | undefined): Promise<void> {
  const preferences = await getPreferences();
  if (!collectionId || !vaultId) {
    await setPreferences({ ...preferences, defaultCollectionId: undefined, defaultCollectionVaultId: undefined });
    return;
  }
  await setPreferences({ ...preferences, defaultCollectionId: collectionId, defaultCollectionVaultId: vaultId });
}

/**
 * The collection new items go into.
 *
 * A collection belongs to one folder, so the collection that was chosen is
 * only used when it still belongs to the folder that is chosen, and when it
 * is still there. Otherwise the item goes into the folder without a
 * collection, which is never wrong.
 */
export function pickCollection(
  collections: CollectionOption[],
  preferences: CollectionPreference,
  vaultId: string | undefined,
): string {
  if (!vaultId) return "";
  if (
    preferences.defaultCollectionId
    && preferences.defaultCollectionVaultId === vaultId
    && collections.some((collection) => collection.id === preferences.defaultCollectionId)
  ) {
    return preferences.defaultCollectionId;
  }
  return "";
}

/**
 * The collection new items go into, as it is known right now.
 *
 * The list of the collections of the folder is needed to know whether the
 * one that was chosen is still there, so it is asked for when it is not
 * already at hand.
 */
export async function collectionForFolder(vaultId: string | undefined, collections?: CollectionOption[]): Promise<string | undefined> {
  if (!vaultId) return undefined;
  const preferences = await getPreferences();
  const inside = collections ?? await listCollections(vaultId);
  return pickCollection(inside, preferences, vaultId) || undefined;
}

/**
 * The collection a new item goes into, or nothing when there is no answer.
 *
 * A collection that has been removed on the website is not used, because
 * the server would refuse the save.
 */
export async function collectionForNewItems(vaultId: string | undefined): Promise<string | undefined> {
  try {
    if (!vaultId) return undefined;
    const inside = await listCollections(vaultId);
    const preferences = await getPreferences();
    return pickCollection(inside, preferences, vaultId) || undefined;
  } catch {
    return undefined;
  }
}
