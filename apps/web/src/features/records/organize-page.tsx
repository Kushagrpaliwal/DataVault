import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FolderOpen, FolderPlus, Pencil, Plus, Tag, Trash2, X } from "lucide-react";
import { Button, EmptyState, Input } from "@data-vault/ui";
import { PageHeader } from "../../components/page";
import { useToast } from "../../components/feedback";
import { useAuth } from "../../lib/auth";

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);

/**
 * Folder, collection, and tag management.
 *
 * This used to be the "Vault" page and it also listed every saved record, so
 * it duplicated the saved-items list and made "Vault" mean three different
 * things across the product. Now it only organises; the list lives in one
 * place.
 *
 * Everything here can also be changed from the item itself, so a folder or a
 * tag that was spelled wrong can be put right rather than left as it is.
 */
export function OrganizePage() {
  const { api, organization } = useAuth();
  const client = useQueryClient();
  const { notify } = useToast();
  const [folderName, setFolderName] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [tagName, setTagName] = useState("");
  const [activeFolderId, setActiveFolderId] = useState("");
  const [renaming, setRenaming] = useState<{ kind: "folder" | "collection" | "tag"; id: string; name: string } | null>(null);

  const vaults = useQuery({ queryKey: ["vaults", organization?.id], queryFn: () => api.listVaults(), enabled: Boolean(organization) });
  const selectedFolderId = activeFolderId || vaults.data?.[0]?.id || "";
  const collections = useQuery({ queryKey: ["collections", selectedFolderId], queryFn: () => api.listCollections(selectedFolderId), enabled: Boolean(selectedFolderId) });
  const tags = useQuery({ queryKey: ["tags", organization?.id], queryFn: () => api.listTags(), enabled: Boolean(organization) });

  const refresh = () => Promise.all(["vaults", "collections", "tags", "records"].map((key) => client.invalidateQueries({ queryKey: [key] })));

  const createFolder = useMutation({
    mutationFn: () => api.createVault({ name: folderName.trim(), slug: slugify(folderName), kind: organization?.isPersonal ? "personal" : "workspace", color: "#b8a4ed" }),
    onSuccess: async (vault) => { setFolderName(""); setActiveFolderId(vault.id); notify("Folder created"); await refresh(); },
  });
  const createCollection = useMutation({
    mutationFn: () => api.createCollection({ vaultId: selectedFolderId, name: collectionName.trim(), color: "#b8a4ed" }),
    onSuccess: async () => { setCollectionName(""); notify("Collection created"); await refresh(); },
  });
  const createTag = useMutation({
    mutationFn: () => api.createTag({ name: tagName.trim(), color: "#b8a4ed" }),
    onSuccess: async () => { setTagName(""); notify("Tag created"); await refresh(); },
  });

  /**
   * A name that was spelled wrong is changed in place, so the items that
   * carry it keep it.
   */
  const renameFolder = useMutation({
    mutationFn: (input: { id: string; name: string }) => api.updateVault(input.id, { name: input.name }),
    onSuccess: async () => { setRenaming(null); notify("Folder renamed"); await refresh(); },
  });
  const renameCollection = useMutation({
    mutationFn: (input: { id: string; name: string }) => api.updateCollection(input.id, { name: input.name }),
    onSuccess: async () => { setRenaming(null); notify("Collection renamed"); await refresh(); },
  });
  const renameTag = useMutation({
    mutationFn: (input: { id: string; name: string }) => api.updateTag(input.id, { name: input.name }),
    onSuccess: async () => { setRenaming(null); notify("Tag renamed"); await refresh(); },
  });

  /**
   * Removing a folder moves what was in it to the default folder, so
   * nothing is lost. A collection or a tag is simply taken off the items
   * that had it.
   */
  const deleteFolder = useMutation({
    mutationFn: (id: string) => api.deleteVault(id),
    onSuccess: async () => { notify("Folder removed, its items moved to the default folder"); await refresh(); },
  });
  const deleteCollection = useMutation({
    mutationFn: (id: string) => api.deleteCollection(id),
    onSuccess: async () => { notify("Collection removed"); await refresh(); },
  });
  const deleteTag = useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: async () => { notify("Tag removed"); await refresh(); },
  });

  const selectedFolder = useMemo(() => vaults.data?.find((folder) => folder.id === selectedFolderId), [selectedFolderId, vaults.data]);

  const startRename = (kind: "folder" | "collection" | "tag", id: string, name: string) => setRenaming({ kind, id, name });

  const saveRename = () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    if (renaming.kind === "folder") renameFolder.mutate({ id: renaming.id, name });
    else if (renaming.kind === "collection") renameCollection.mutate({ id: renaming.id, name });
    else renameTag.mutate({ id: renaming.id, name });
  };

  return <>
    <PageHeader
      eyebrow={organization?.name ?? "Your workspace"}
      title="Organize"
      description="Group your saved items into folders, collections, and tags so you can find them later."
    />

    <div className="grid gap-5 lg:grid-cols-3">
      <section className="panel p-5">
        <div className="flex items-center gap-2">
          <FolderOpen className="size-5" />
          <h2 className="text-lg font-semibold">Folders</h2>
        </div>
        <p className="mt-1 text-sm leading-6 text-[#6a6a6a]">A folder is a top-level space for your saved items.</p>
        <div className="mt-4 space-y-1">
          {vaults.data?.map((folder) => (
            <div key={folder.id} className={`flex items-center gap-1 rounded-xl px-2 py-1.5 ${selectedFolderId === folder.id ? "bg-[#1a3a3a] text-white" : "hover:bg-[#f5f0e0]"}`}>
              {renaming?.kind === "folder" && renaming.id === folder.id ? (
                <RenameBox
                  value={renaming.name}
                  onChange={(value) => setRenaming({ ...renaming, name: value })}
                  onSave={saveRename}
                  onCancel={() => setRenaming(null)}
                  light
                />
              ) : (
                <>
                  <button
                    onClick={() => setActiveFolderId(folder.id)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left text-sm ${selectedFolderId === folder.id ? "hover:bg-white/10" : "hover:bg-[#ebe6d6]"}`}
                  >
                    <FolderOpen className="size-4 shrink-0" />
                    <span className="truncate">{folder.name}</span>
                    <span className="ml-auto text-xs opacity-70">{folder.itemCount ?? 0}</span>
                  </button>
                  <RowActions
                    onRename={() => startRename("folder", folder.id, folder.name)}
                    onDelete={() => {
                      if (!window.confirm(`Remove the folder “${folder.name}”? Its items move to the default folder.`)) return;
                      deleteFolder.mutate(folder.id);
                    }}
                    disabled={folder.isDefault}
                    deleteTitle="The default folder cannot be removed"
                    light={selectedFolderId === folder.id}
                  />
                </>
              )}
            </div>
          ))}
        </div>
        {vaults.data?.length === 0 ? (
          <EmptyState title="No folders yet" description="Create your first folder to start grouping saved items." />
        ) : null}
        <div className="mt-4 border-t border-[#eee8da] pt-4">
          <label className="mb-1.5 block text-sm font-medium text-[#3a3a3a]" htmlFor="new-folder">New folder</label>
          <Input id="new-folder" value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="e.g. Research" />
          <Button
            className="mt-2 w-full"
            size="sm"
            variant="secondary"
            disabled={!slugify(folderName) || createFolder.isPending}
            onClick={() => createFolder.mutate()}
          >
            <FolderPlus className="size-4" />Create folder
          </Button>
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex items-center gap-2">
          <FolderOpen className="size-5" />
          <h2 className="text-lg font-semibold">Collections</h2>
        </div>
        <p className="mt-1 text-sm leading-6 text-[#6a6a6a]">
          Collections group items inside <span className="font-semibold text-black">{selectedFolder?.name ?? "a folder"}</span>.
        </p>
        <div className="mt-4 space-y-1">
          {collections.data?.map((collection) => (
            <div key={collection.id} className="flex items-center gap-1 rounded-xl px-2 py-1.5 hover:bg-[#f5f0e0]">
              {renaming?.kind === "collection" && renaming.id === collection.id ? (
                <RenameBox
                  value={renaming.name}
                  onChange={(value) => setRenaming({ ...renaming, name: value })}
                  onSave={saveRename}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <>
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: collection.color }} />
                  <span className="min-w-0 flex-1 truncate text-sm">{collection.name}</span>
                  <span className="text-xs text-[#6a6a6a]">{collection.itemCount ?? 0}</span>
                  <RowActions
                    onRename={() => startRename("collection", collection.id, collection.name)}
                    onDelete={() => {
                      if (!window.confirm(`Remove the collection “${collection.name}”? The items in it are kept.`)) return;
                      deleteCollection.mutate(collection.id);
                    }}
                  />
                </>
              )}
            </div>
          ))}
        </div>
        {collections.data?.length === 0 ? (
          <EmptyState title="No collections yet" description="Collections are optional. Use them when a folder needs finer grouping." />
        ) : null}
        <div className="mt-4 border-t border-[#eee8da] pt-4">
          <label className="mb-1.5 block text-sm font-medium text-[#3a3a3a]" htmlFor="new-collection">New collection</label>
          <Input id="new-collection" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder="e.g. Reading list" />
          <Button
            className="mt-2 w-full"
            size="sm"
            variant="secondary"
            disabled={!collectionName.trim() || !selectedFolderId || createCollection.isPending}
            onClick={() => createCollection.mutate()}
          >
            <Plus className="size-4" />Create collection
          </Button>
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex items-center gap-2">
          <Tag className="size-5" />
          <h2 className="text-lg font-semibold">Tags</h2>
        </div>
        <p className="mt-1 text-sm leading-6 text-[#6a6a6a]">Tags work across every folder, so one item can have many.</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {tags.data?.map((tag) => (
            <div key={tag.id} className="flex items-center gap-1 rounded-full bg-[#f5f0e0] px-2.5 py-1 text-xs">
              {renaming?.kind === "tag" && renaming.id === tag.id ? (
                <RenameBox
                  value={renaming.name}
                  onChange={(value) => setRenaming({ ...renaming, name: value })}
                  onSave={saveRename}
                  onCancel={() => setRenaming(null)}
                  small
                />
              ) : (
                <>
                  <button onClick={() => startRename("tag", tag.id, tag.name)} className="font-medium" title="Rename this tag">
                    #{tag.name}
                  </button>
                  <span className="text-[#6a6a6a]">{tag.itemCount ?? 0}</span>
                  <button
                    onClick={() => {
                      if (!window.confirm(`Remove the tag “${tag.name}”? The items that had it are kept.`)) return;
                      deleteTag.mutate(tag.id);
                    }}
                    title="Remove this tag"
                    aria-label={`Remove the tag ${tag.name}`}
                    className="text-[#6a6a6a] hover:text-red-700"
                  >
                    <X className="size-3" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        {tags.data?.length === 0 ? (
          <EmptyState title="No tags yet" description="Tag items by topic so you can find them from any folder." />
        ) : null}
        <div className="mt-4 border-t border-[#eee8da] pt-4">
          <label className="mb-1.5 block text-sm font-medium text-[#3a3a3a]" htmlFor="new-tag">New tag</label>
          <Input id="new-tag" value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="e.g. reference" />
          <Button
            className="mt-2 w-full"
            size="sm"
            variant="secondary"
            disabled={!tagName.trim() || createTag.isPending}
            onClick={() => createTag.mutate()}
          >
            <Plus className="size-4" />Create tag
          </Button>
        </div>
      </section>
    </div>

    <p className="mt-5 text-sm text-[#6a6a6a]">
      Looking for the items themselves? They are all on the{" "}
      <Link to={selectedFolderId ? `/saved?vault=${selectedFolderId}` : "/saved"} className="font-semibold text-black underline">Saved page</Link>.
    </p>
  </>;
}

/**
 * The two small actions that every folder, collection and tag needs.
 */
function RowActions({
  onRename, onDelete, disabled, deleteTitle, light,
}: {
  onRename: () => void;
  onDelete: () => void;
  disabled?: boolean;
  deleteTitle?: string;
  light?: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button
        onClick={onRename}
        title="Rename"
        aria-label="Rename"
        className={`grid size-7 place-items-center rounded-lg ${light ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-[#6a6a6a] hover:bg-[#ebe6d6]"}`}
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        onClick={onDelete}
        disabled={disabled}
        title={disabled ? deleteTitle : "Remove"}
        aria-label="Remove"
        className={`grid size-7 place-items-center rounded-lg disabled:cursor-not-allowed disabled:opacity-40 ${light ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-[#6a6a6a] hover:bg-[#ebe6d6] hover:text-red-700"}`}
      >
        <Trash2 className="size-3.5" />
      </button>
    </span>
  );
}

/**
 * A name being changed in place.
 */
function RenameBox({
  value, onChange, onSave, onCancel, small, light,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  small?: boolean;
  light?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <input
        autoFocus
        value={value}
        maxLength={100}
        aria-label="New name"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); onSave(); }
          if (event.key === "Escape") { event.preventDefault(); onCancel(); }
        }}
        className={`min-w-0 flex-1 rounded-lg border bg-white px-2 py-1 text-sm outline-none ${small ? "text-xs" : ""}`}
      />
      <button onClick={onSave} title="Save the name" aria-label="Save the name" className={`grid size-7 shrink-0 place-items-center rounded-lg ${light ? "text-white" : "text-[#1a3a3a]"}`}>
        <Check className="size-3.5" />
      </button>
      <button onClick={onCancel} title="Keep the old name" aria-label="Keep the old name" className={`grid size-7 shrink-0 place-items-center rounded-lg ${light ? "text-white/70" : "text-[#6a6a6a]"}`}>
        <X className="size-3.5" />
      </button>
    </span>
  );
}
