import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, ArrowDownUp, Bookmark, BookmarkPlus, ChevronLeft, ChevronRight, Download, ExternalLink,
  Folder, FolderOpen, GripVertical, Library, Link2, Plus, RotateCcw, Search, Tag, Trash2, X,
} from "lucide-react";
import {
  Badge, Button, EmptyState, Input, Label, PRIMARY_RECORD_TYPES, RecordTypeIcon,
  RecordTypeLabel, recordTypeLabel, cn,
} from "@data-vault/ui";
import type { SavedRecord } from "@data-vault/types";
import { RECORD_TYPES } from "@data-vault/schemas";
import { format } from "date-fns";
import { useAuth } from "../../lib/auth";
import { QueryState } from "../../components/data-state";
import { Modal, useToast } from "../../components/feedback";
import { PageHeader } from "../../components/page";
import { FolderTree, flattenFolders, folderTree } from "./folder-tree";
import { SaveViewModal } from "./save-view-modal";
import { downloadCsv, toCsv } from "../../lib/csv";

const CSV_HEADER = ["Title", "Text", "Source", "Saved at", "Type"];
const csvRow = (record: SavedRecord) => [record.title, record.originalText ?? "", record.sourceDomain ?? "", record.capturedAt ?? record.createdAt, recordTypeLabel(record.recordType)];


/**
 * The single place where every saved item lives.
 *
 * This page used to be split in two — a "Vault" page and a "Saved Captures"
 * page — which showed the same records behind two different filter UIs and
 * made it impossible to guess where to look. Folders and tags now live in a
 * rail beside the list, and an item is moved into a folder by dragging it
 * there.
 */
export function SavedPage() {
  const { api, organization } = useAuth();
  const client = useQueryClient();
  const { notify } = useToast();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(search);
  const [page, setPage] = useState(1);
  const [manualOpen, setManualOpen] = useState(false);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const recordType = params.get("type") ?? "";
  const archived = params.get("archived") === "true";
  const trash = params.get("trash") === "true";
  const sort = params.get("sort") ?? "createdAt";
  const direction = params.get("direction") ?? "desc";
  const vaultId = params.get("vault") ?? "";
  const tag = params.get("tag") ?? "";

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const vaults = useQuery({ queryKey: ["vaults", organization?.id], queryFn: () => api.listVaults(), enabled: Boolean(organization) });
  /**
   * Every folder is shown until one is chosen.
   *
   * The page used to open on the first folder, so everything that was saved
   * somewhere else was hidden without saying so.
   */
  const activeVaultId = vaultId;
  const tree = useMemo(() => folderTree(vaults.data ?? []), [vaults.data]);
  /**
   * The tags of the folder that is open.
   *
   * A tag is a label that works across every folder, but the list on screen
   * only holds the tags that are used in this folder. Otherwise every folder
   * showed the same tags, which made it look as though the folders were not
   * being filtered at all.
   */
  const tags = useQuery({ queryKey: ["tags", organization?.id, activeVaultId], queryFn: () => api.listTags(activeVaultId || undefined), enabled: Boolean(organization) });

  const query = useQuery({
    queryKey: ["records", organization?.id, page, debounced, recordType, archived, trash, sort, direction, activeVaultId, tag],
    queryFn: () => api.listSavedRecords({
      page,
      limit: 25,
      q: debounced || undefined,
      recordType: recordType || undefined,
      archived,
      trash,
      sort,
      direction,
      vaultId: activeVaultId || undefined,
      tag: tag || undefined,
    }),
    enabled: Boolean(organization),
  });

  const archive = useMutation({
    mutationFn: (record: SavedRecord) => record.archivedAt ? api.restoreSavedRecord(record.id) : api.archiveSavedRecord(record.id),
    onSuccess: async (_result, record) => {
      notify(record.archivedAt ? "Item restored" : "Item archived");
      await client.invalidateQueries({ queryKey: ["records"] });
    },
  });
  const remove = useMutation({
    mutationFn: (record: SavedRecord) => api.deleteSavedRecord(record.id),
    onSuccess: async () => {
      notify("Item moved to Trash");
      await client.invalidateQueries({ queryKey: ["records"] });
    },
  });
  const restoreTrash = useMutation({
    mutationFn: (record: SavedRecord) => api.restoreTrashedRecord(record.id),
    onSuccess: async () => {
      notify("Item restored from Trash");
      await client.invalidateQueries({ queryKey: ["records"] });
    },
  });

  /**
   * An item is moved into another folder.
   *
   * The folder is the place the item lives in, so this is the one thing
   * that has to change. The tags of the item are left alone.
   */
  const moveRecord = useMutation({
    mutationFn: (input: { id: string; vaultId: string }) => api.organizeSavedRecord(input.id, { vaultId: input.vaultId }),
    onSuccess: async () => {
      notify("Moved");
      await client.invalidateQueries({ queryKey: ["records"] });
      await client.invalidateQueries({ queryKey: ["vaults"] });
    },
  });

  const createFolder = useMutation({
    mutationFn: (input: { name: string; parentId: string | null }) => api.createVault({
      name: input.name,
      parentId: input.parentId,
      kind: organization?.isPersonal ? "personal" : "workspace",
      color: "#b8a4ed",
    }),
    onSuccess: async () => {
      notify("Folder created");
      await client.invalidateQueries({ queryKey: ["vaults"] });
    },
  });
  const renameFolder = useMutation({
    mutationFn: (input: { id: string; name: string }) => api.updateVault(input.id, { name: input.name }),
    onSuccess: async () => {
      notify("Folder renamed");
      await client.invalidateQueries({ queryKey: ["vaults"] });
    },
  });
  const deleteFolder = useMutation({
    mutationFn: (id: string) => api.deleteVault(id),
    onSuccess: async () => {
      notify("Folder removed, its items moved to the default folder");
      await client.invalidateQueries({ queryKey: ["vaults"] });
      await client.invalidateQueries({ queryKey: ["records"] });
    },
  });

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };
  /**
   * The filters are taken off, but the folder stays.
   *
   * The folder is the place that is being looked at rather than a filter on
   * top of it, so clearing the filters leaves the folder open.
   */
  const clearFilters = () => {
    setSearch("");
    const next = new URLSearchParams(params);
    for (const key of ["type", "tag", "archived", "trash"]) next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };
  const toggleSort = (nextSort: string) => {
    const next = new URLSearchParams(params);
    next.set("sort", nextSort);
    next.set("direction", sort === nextSort && direction === "asc" ? "desc" : "asc");
    setParams(next, { replace: true });
  };
  const deleteCapture = (record: SavedRecord) => {
    if (!window.confirm(`Move “${record.title}” to Trash? You can restore it later.`)) return;
    remove.mutate(record);
  };

  /**
   * The views a person has saved.
   *
   * A view keeps the filters that are on the screen, so a folder that is
   * looked at every week is one click away instead of a set of filters put
   * together again.
   */
  const views = useQuery({ queryKey: ["saved-views", organization?.id], queryFn: () => api.listSavedViews(), enabled: Boolean(organization) });
  const saveView = useMutation({
    mutationFn: (name: string) => api.createSavedView({
      name,
      filters: { q: debounced, type: recordType, archived: archived ? "true" : "", trash: trash ? "true" : "", vault: vaultId, tag },
      columns: [],
      sort: { field: sort, direction },
    }),
    onSuccess: async () => {
      notify("The view was saved");
      setSaveViewOpen(false);
      await client.invalidateQueries({ queryKey: ["saved-views"] });
    },
  });
  const removeView = useMutation({
    mutationFn: (id: string) => api.deleteSavedView(id),
    onSuccess: async () => {
      notify("The view was removed");
      await client.invalidateQueries({ queryKey: ["saved-views"] });
    },
  });
  const applyView = (view: Record<string, unknown>) => {
    const filters = (view.filters ?? {}) as Record<string, unknown>;
    const viewSort = (view.sort ?? {}) as Record<string, unknown>;
    const next = new URLSearchParams();
    for (const key of ["q", "type", "archived", "trash", "vault", "tag"]) {
      const value = filters[key];
      if (typeof value === "string" && value) next.set(key, value);
    }
    if (typeof viewSort.field === "string") next.set("sort", viewSort.field);
    if (typeof viewSort.direction === "string") next.set("direction", viewSort.direction);
    setSearch(typeof filters.q === "string" ? filters.q : "");
    setParams(next, { replace: true });
    setPage(1);
  };

  const activeViewId = useMemo(() => {
    if (!views.data?.length) return undefined;
    const match = views.data.find((v) => {
      const f = (v.filters ?? {}) as Record<string, unknown>;
      const s = (v.sort ?? {}) as Record<string, unknown>;
      if ((f.q ?? "") !== debounced) return false;
      if ((f.type ?? "") !== recordType) return false;
      if ((f.archived ?? "") !== (archived ? "true" : "")) return false;
      if ((f.trash ?? "") !== (trash ? "true" : "")) return false;
      if ((f.vault ?? "") !== vaultId) return false;
      if ((f.tag ?? "") !== tag) return false;
      if (s.field && s.field !== sort) return false;
      if (s.direction && s.direction !== direction) return false;
      return true;
    });
    return match ? String(match.id) : undefined;
  }, [views.data, debounced, recordType, archived, trash, vaultId, tag, sort, direction]);

  const exportCsv = async () => {
    if (!query.data?.total) return;
    const records: SavedRecord[] = [];
    for (let exportPage = 1; exportPage <= Math.ceil(query.data.total / 100); exportPage += 1) {
      const result = await api.listSavedRecords({ page: exportPage, limit: 100, q: debounced || undefined, recordType: recordType || undefined, archived, trash, sort, direction, vaultId: activeVaultId || undefined, tag: tag || undefined });
      records.push(...result.items);
    }
    downloadCsv(`datavault-saved-${format(new Date(), "yyyy-MM-dd")}.csv`, toCsv(CSV_HEADER, records.map(csvRow)));
  };

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, debounced, recordType, archived, trash, activeVaultId, tag]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pageItems = query.data?.items ?? [];
  const allPageSelected = pageItems.length > 0 && pageItems.every((item) => selectedIds.has(item.id));

  const toggleSelectAll = () => {
    if (allPageSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pageItems.map((item) => item.id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkMove = async (folderId: string) => {
    if (!selectedIds.size) return;
    setBulkBusy(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => api.organizeSavedRecord(id, { vaultId: folderId })));
      notify(`Moved ${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"}`);
      setSelectedIds(new Set());
      setBulkMoving(false);
      await client.invalidateQueries({ queryKey: ["records"] });
      await client.invalidateQueries({ queryKey: ["vaults"] });
    } catch {
      notify("Some items could not be moved", "error");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkArchive = async () => {
    if (!selectedIds.size) return;
    setBulkBusy(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => (archived ? api.restoreSavedRecord(id) : api.archiveSavedRecord(id))));
      notify(archived ? `Restored ${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"}` : `Archived ${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"}`);
      setSelectedIds(new Set());
      await client.invalidateQueries({ queryKey: ["records"] });
    } catch {
      notify("Some items could not be updated", "error");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkTrash = async () => {
    if (!selectedIds.size) return;
    const count = selectedIds.size;
    const actionLabel = trash ? "Restore" : "Move to Trash";
    if (!window.confirm(`${actionLabel} ${count} selected item${count === 1 ? "" : "s"}?`)) return;
    setBulkBusy(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => (trash ? api.restoreTrashedRecord(id) : api.deleteSavedRecord(id))));
      notify(trash ? `Restored ${count} item${count === 1 ? "" : "s"}` : `Moved ${count} item${count === 1 ? "" : "s"} to Trash`);
      setSelectedIds(new Set());
      await client.invalidateQueries({ queryKey: ["records"] });
    } catch {
      notify("Some items could not be deleted", "error");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkExportCsv = () => {
    const selectedRecords = (query.data?.items ?? []).filter((r) => selectedIds.has(r.id));
    if (!selectedRecords.length) return;
    downloadCsv(`datavault-selected-${format(new Date(), "yyyy-MM-dd")}.csv`, toCsv(CSV_HEADER, selectedRecords.map(csvRow)));
  };

  const activeFilterCount = [recordType, tag, archived ? "1" : "", trash ? "1" : ""].filter(Boolean).length;
  const hasItems = Boolean(query.data?.items.length);
  /**
   * The folder that is open, when nothing else is narrowing the list.
   *
   * An empty folder says so, instead of pretending the filters hid
   * something. Before, every empty folder said "Nothing matches", which
   * looked like the folder was broken.
   */
  const activeFolder = vaults.data?.find((vault) => vault.id === activeVaultId);
  const onlyFolderIsOpen = Boolean(activeFolder) && !recordType && !tag && !archived && !trash && !debounced;

  const [newTag, setNewTag] = useState("");
  const [addingTag, setAddingTag] = useState(false);

  const addTag = useMutation({
    mutationFn: async (name: string) => {
      if (!activeVaultId) {
        await api.createTag({ name, color: "#b8a4ed" });
        return;
      }
      await api.tagFolder(activeVaultId, { name });
    },
    onSuccess: async () => {
      setNewTag("");
      setAddingTag(false);
      notify(activeVaultId ? "Tag added to folder" : "Tag created");
      await client.invalidateQueries({ queryKey: ["tags"] });
      await client.invalidateQueries({ queryKey: ["records"] });
      await client.invalidateQueries({ queryKey: ["vaults"] });
    },
  });

  const untagFolder = useMutation({
    mutationFn: async (tagId: string) => {
      if (!activeVaultId) return;
      await api.untagFolder(activeVaultId, tagId);
    },
    onSuccess: async () => {
      notify("Tag removed from folder");
      await client.invalidateQueries({ queryKey: ["tags"] });
      await client.invalidateQueries({ queryKey: ["vaults"] });
      await client.invalidateQueries({ queryKey: ["records"] });
    },
  });

  const breadcrumbs = useMemo(() => {
    if (!activeVaultId || !vaults.data) return [];
    const vaultMap = new Map(vaults.data.map((v) => [v.id, v]));
    const path: Array<{ id: string; name: string }> = [];
    let currentId: string | null = activeVaultId;
    const seen = new Set<string>();
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const v = vaultMap.get(currentId);
      if (!v) break;
      path.unshift({ id: v.id, name: v.name });
      currentId = v.parentId;
    }
    return path;
  }, [activeVaultId, vaults.data]);

  const selectVault = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("vault", id); else next.delete("vault");
    next.delete("tag");
    setParams(next, { replace: true });
    setPage(1);
  };

  /**
   * The item that is being dragged, so that the folder it is dropped on
   * knows where it came from.
   */
  const dragging = useRef<string | null>(null);

  return <>
    <PageHeader
      eyebrow={organization?.name ?? "Your workspace"}
      title={trash ? "Trash" : "Saved"}
      description={trash ? "Deleted items stay recoverable until you remove them for good." : "Everything you have saved, from any website."}
      actions={
        <>
          <Button onClick={() => setManualOpen(true)}><Plus className="size-4" />Save something</Button>
          <Button variant="secondary" onClick={() => void exportCsv()} disabled={!query.data?.total}><Download className="size-4" />Export</Button>
        </>
      }
    />

    <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <FilterRail
          views={views.data ?? []}
          activeViewId={activeViewId}
          onApplyView={applyView}
          onSaveView={() => setSaveViewOpen(true)}
          onRemoveView={(id) => removeView.mutate(id)}
          tree={tree}
          activeVaultId={activeVaultId}
          onVault={selectVault}
          onCreateFolder={(name, parentId) => createFolder.mutate({ name, parentId })}
          onRenameFolder={(id, name) => renameFolder.mutate({ id, name })}
          onDeleteFolder={(id) => {
            const folder = vaults.data?.find((vault) => vault.id === id);
            const under = vaults.data?.filter((vault) => vault.parentId === id).length ?? 0;
            const question = under
              ? `Remove the folder “${folder?.name ?? ""}” and the ${under} folder${under === 1 ? "" : "s"} inside it? The items in all of them move to the default folder.`
              : `Remove the folder “${folder?.name ?? ""}”? Its items move to the default folder.`;
            if (!window.confirm(question)) return;
            deleteFolder.mutate(id);
          }}
          onMoveItem={(folderId) => {
            const id = dragging.current;
            dragging.current = null;
            if (!id) return;
            moveRecord.mutate({ id, vaultId: folderId });
          }}
        />
      </aside>

      <section className="panel overflow-hidden">
        {/* Top Breadcrumb & Folder Hierarchy */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas/40 px-5 py-3">
          <nav aria-label="Folder hierarchy" className="flex flex-wrap items-center gap-1.5 text-sm">
            <button
              onClick={() => selectVault("")}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1 transition ${
                !activeVaultId ? "bg-soft font-semibold text-ink" : "text-muted hover:bg-soft hover:text-ink"
              }`}
            >
              <Library className="size-4 shrink-0 text-muted" />
              <span>All folders</span>
            </button>

            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <div key={crumb.id} className="flex items-center gap-1.5">
                  <span className="text-muted/60 select-none text-xs">→</span>
                  <button
                    onClick={() => selectVault(crumb.id)}
                    disabled={isLast}
                    className={`flex items-center gap-1.5 rounded-lg px-2 py-1 transition ${
                      isLast
                        ? "bg-deep text-white font-medium shadow-2xs cursor-default"
                        : "text-muted hover:bg-soft hover:text-ink"
                    }`}
                  >
                    <Folder className={`size-3.5 shrink-0 ${isLast ? "text-white" : "text-muted"}`} />
                    <span>{crumb.name}</span>
                  </button>
                </div>
              );
            })}
          </nav>

          {/* Folder Tags Display */}
          {activeFolder?.tags && activeFolder.tags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {activeFolder.tags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-ink shadow-2xs"
                >
                  <Tag className="size-3 text-muted" />
                  <span>#{t.name}</span>
                  <button
                    onClick={() => untagFolder.mutate(t.id)}
                    title={`Remove #${t.name} from ${activeFolder.name}`}
                    aria-label={`Remove #${t.name} from ${activeFolder.name}`}
                    className="grid size-3.5 place-items-center rounded-full text-muted hover:bg-soft hover:text-ink"
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* Toolbar Bar */}
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 size-4 text-muted" />
            <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles, saved text, or websites…" />
          </div>

          <select aria-label="Type" value={recordType} onChange={(event) => updateFilter("type", event.target.value)} className="h-11 rounded-xl border border-line bg-surface px-3 text-sm">
            <option value="">All types</option>
            {RECORD_TYPES.map((type) => <option key={type} value={type}>{recordTypeLabel(type)}</option>)}
          </select>

          {/* Tags Filter Selector */}
          <select
            aria-label="Filter by tag"
            value={tag}
            onChange={(event) => updateFilter("tag", event.target.value)}
            className={`h-11 rounded-xl border border-line bg-surface px-3 text-sm ${tag ? "font-semibold text-ink" : "text-strong"}`}
          >
            <option value="">All tags</option>
            {tags.data?.map((t) => (
              <option key={t.id} value={t.name}>
                #{t.name}{typeof t.itemCount === "number" ? ` (${t.itemCount})` : ""}
              </option>
            ))}
          </select>

          {/* Add Tag Section */}
          {addingTag ? (
            <div className="flex items-center gap-1.5 rounded-xl border border-line bg-surface p-1 shadow-2xs">
              <input
                autoFocus
                value={newTag}
                maxLength={80}
                placeholder={activeFolder ? `Tag for ${activeFolder.name}` : "Tag name"}
                aria-label="Name of the tag"
                onChange={(event) => setNewTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); if (newTag.trim()) addTag.mutate(newTag.trim()); }
                  if (event.key === "Escape") { event.preventDefault(); setAddingTag(false); }
                }}
                className="h-8 min-w-32 rounded-lg border border-line bg-surface px-2.5 text-xs text-ink placeholder:text-muted outline-none transition focus:border-muted"
              />
              <Button size="sm" className="h-8 px-2.5 text-xs" onClick={() => { if (newTag.trim()) addTag.mutate(newTag.trim()); }} disabled={!newTag.trim() || addTag.isPending}>
                Add
              </Button>
              <button
                onClick={() => setAddingTag(false)}
                title="Cancel"
                aria-label="Cancel"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => setAddingTag(true)}
              className="gap-1.5"
              title={activeFolder ? `Add a tag to ${activeFolder.name}` : "Add a tag"}
            >
              <Tag className="size-4" />
              <span>Add tag</span>
            </Button>
          )}

          <Button variant={archived ? "primary" : "secondary"} onClick={() => updateFilter("archived", archived ? "" : "true")}>
            {archived ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
            {archived ? "Archived" : "Archive"}
          </Button>

          <Button variant={trash ? "primary" : "secondary"} onClick={() => updateFilter("trash", trash ? "" : "true")}>
            <Trash2 className="size-4" />
            {trash ? "Trash" : "View Trash"}
          </Button>
        </div>

        {activeFilterCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-hover px-4 py-3 text-sm">
            <span className="text-muted">{activeFilterCount} {activeFilterCount === 1 ? "filter" : "filters"} applied</span>
            <button className="font-semibold underline" onClick={clearFilters}>Clear filters</button>
          </div>
        ) : null}

        <QueryState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} />

        {!query.isLoading && !query.error && !hasItems ? (
          onlyFolderIsOpen ? (
            <EmptyState
              title="This folder is empty"
              description={`Nothing has been saved into “${activeFolder?.name}” yet. Save something and it lands in this folder, the same folder the browser extension uses.`}
              action={<Button onClick={() => setManualOpen(true)}><Link2 className="size-4" />Save something into this folder</Button>}
            />
          ) : activeFilterCount > 0 || debounced ? (
            <EmptyState
              title="Nothing matches"
              description="No saved items match your filters. Try a different search, or clear the filters to see everything."
              action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              title="Nothing saved yet"
              description="Install the browser extension, then right-click any text on a page and choose “Save to DataVault”. You can also save a link by hand."
              action={<Button onClick={() => setManualOpen(true)}><Link2 className="size-4" />Save a link by hand</Button>}
            />
          )
        ) : null}

        {hasItems ? <>
          {selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-deep px-5 py-3 text-white transition-all">
              <div className="flex items-center gap-2.5">
                <span className="grid size-6 place-items-center rounded-full bg-white text-xs font-bold text-deep">
                  {selectedIds.size}
                </span>
                <span className="text-sm font-semibold">
                  {selectedIds.size} {selectedIds.size === 1 ? "item" : "items"} selected
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setBulkMoving(true)} disabled={bulkBusy}>
                  <FolderOpen className="size-3.5" />
                  Move to folder
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void handleBulkArchive()} disabled={bulkBusy}>
                  {archived ? <RotateCcw className="size-3.5" /> : <Archive className="size-3.5" />}
                  {archived ? "Restore" : "Archive"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void handleBulkTrash()} disabled={bulkBusy} className="text-red-600 dark:text-red-400">
                  <Trash2 className="size-3.5" />
                  {trash ? "Restore from Trash" : "Move to Trash"}
                </Button>
                <Button size="sm" variant="secondary" onClick={handleBulkExportCsv} disabled={bulkBusy}>
                  <Download className="size-3.5" />
                  Export CSV
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection} disabled={bulkBusy} className="text-white/80 hover:bg-white/10 hover:text-white">
                  <X className="size-3.5" />
                  Deselect
                </Button>
              </div>
            </div>
          ) : null}

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b border-line bg-hover text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={allPageSelected}
                      onChange={toggleSelectAll}
                      className="size-4 cursor-pointer rounded border-line accent-ink"
                    />
                  </th>
                  <Sortable label="Title" onClick={() => toggleSort("title")} />
                  <th className="px-4 py-3 font-semibold">Saved text</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <Sortable label="Type" onClick={() => toggleSort("recordType")} />
                  <Sortable label="Saved" onClick={() => toggleSort("createdAt")} />
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {query.data?.items.map((record) => (
                  <tr key={record.id} className={cn("hover:bg-surface transition-colors", selectedIds.has(record.id) && "bg-soft/75")}>
                    <td className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${record.title}`}
                        checked={selectedIds.has(record.id)}
                        onChange={() => toggleSelect(record.id)}
                        className="size-4 cursor-pointer rounded border-line accent-ink"
                      />
                    </td>
                    <td className="max-w-52 px-4 py-3">
                      <Link to={`/saved/${record.id}`} className="font-semibold hover:underline">{record.title}</Link>
                    </td>
                    <td
                      className="max-w-64 px-4 py-3"
                      draggable
                      onDragStart={(event) => {
                        dragging.current = record.id;
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", record.id);
                      }}
                      onDragEnd={() => {
                        dragging.current = null;
                      }}
                    >
                      {/**
                       * The saved text is the handle that is grabbed, so the
                       * item can be dragged into a folder.
                       */}
                      <span className="flex items-center gap-1.5">
                        <GripVertical className="size-4 shrink-0 cursor-grab text-muted opacity-60" />
                        <span className="block truncate font-mono text-xs text-strong">{record.originalText ?? "—"}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {record.sourceUrl ? (
                        <a href={record.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-40 items-center gap-1 truncate text-blue-700 hover:underline">
                          {record.sourceDomain ?? "Source"}<ExternalLink className="size-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-muted">{record.sourceDomain ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs">
                        <RecordTypeIcon type={record.recordType} />
                        <RecordTypeLabel type={record.recordType} />
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{format(new Date(record.capturedAt ?? record.createdAt), "dd MMM yyyy, HH:mm")}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {trash ? (
                          <Button size="sm" variant="ghost" onClick={() => restoreTrash.mutate(record)} disabled={restoreTrash.isPending}>Restore</Button>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setMovingId(record.id)}>Move</Button>
                            <Button size="sm" variant="ghost" onClick={() => archive.mutate(record)} disabled={archive.isPending || remove.isPending}>
                              {record.archivedAt ? "Restore" : "Archive"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => deleteCapture(record)} disabled={remove.isPending} aria-label={`Move ${record.title} to Trash`}>
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-line md:hidden">
            {query.data?.items.map((record) => (
              <div key={record.id} className={cn("block p-4 transition-colors", selectedIds.has(record.id) && "bg-soft/75")}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${record.title}`}
                    checked={selectedIds.has(record.id)}
                    onChange={() => toggleSelect(record.id)}
                    className="mt-2.5 size-4 cursor-pointer rounded border-line accent-ink"
                  />
                  <Link to={`/saved/${record.id}`} className="grid size-9 shrink-0 place-items-center rounded-xl bg-soft">
                    <RecordTypeIcon type={record.recordType} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link to={`/saved/${record.id}`} className="truncate font-semibold">{record.title}</Link>
                      <Badge tone="teal">{recordTypeLabel(record.recordType)}</Badge>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted">{record.originalText ?? record.sourceDomain ?? "Saved item"}</p>
                    <p className="mt-2 text-xs text-muted">{record.sourceDomain ?? "No source"} · {format(new Date(record.capturedAt ?? record.createdAt), "dd MMM yyyy")}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </> : null}

        {query.data ? (
          <div className="flex items-center justify-between border-t border-line p-4 text-sm">
            <span className="text-muted">{query.data.total.toLocaleString()} saved · Page {query.data.page} of {Math.max(1, query.data.totalPages)}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="size-4" />Previous</Button>
              <Button size="sm" variant="secondary" disabled={page >= query.data.totalPages} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight className="size-4" /></Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>

    <MoveDialog
      open={Boolean(movingId)}
      onClose={() => setMovingId(null)}
      folders={flattenFolders(tree)}
      onMove={(folderId) => {
        if (!movingId) return;
        moveRecord.mutate({ id: movingId, vaultId: folderId });
        setMovingId(null);
      }}
    />

    <MoveDialog
      open={bulkMoving}
      onClose={() => setBulkMoving(false)}
      folders={flattenFolders(tree)}
      onMove={(folderId) => {
        void handleBulkMove(folderId);
      }}
    />

    <ManualSaveModal
      open={manualOpen}
      onClose={() => setManualOpen(false)}
      folders={flattenFolders(tree)}
      vaults={vaults.data ?? []}
      initialVaultId={activeVaultId}
      onSaved={async () => {
        setManualOpen(false);
        notify("Saved");
        await client.invalidateQueries({ queryKey: ["records"] });
        await client.invalidateQueries({ queryKey: ["vaults"] });
        await client.invalidateQueries({ queryKey: ["tags"] });
      }}
    />

    <SaveViewModal
      open={saveViewOpen}
      onClose={() => setSaveViewOpen(false)}
      onSave={(name) => saveView.mutate(name)}
      isPending={saveView.isPending}
      error={saveView.error}
      filters={{
        folderName: activeFolder?.name ?? "All folders",
        search: debounced,
        recordType,
        tag,
        archived,
        trash,
        sort,
        direction,
      }}
      totalMatches={query.data?.total}
    />
  </>;
}

function FilterRail({
  views, activeViewId, onApplyView, onSaveView, onRemoveView,
  tree, activeVaultId, onVault, onCreateFolder, onRenameFolder, onDeleteFolder, onMoveItem,
}: {
  views: Record<string, unknown>[];
  activeViewId?: string | undefined;
  onApplyView: (view: Record<string, unknown>) => void;
  onSaveView: () => void;
  onRemoveView: (id: string) => void;
  tree: ReturnType<typeof folderTree>;
  activeVaultId: string;
  onVault: (id: string) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveItem: (folderId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="panel p-3">
        <div className="flex items-center justify-between px-2 pb-2">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-muted">Views</p>
          <button
            type="button"
            onClick={onSaveView}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink transition underline-offset-2 hover:underline"
            title="Save current filters as a view"
          >
            <BookmarkPlus className="size-3.5" />
            <span>Save this view</span>
          </button>
        </div>
        {views.length ? (
          <div className="space-y-0.5">
            {views.map((view) => {
              const isActive = activeViewId === String(view.id);
              return (
                <div key={String(view.id)} className="flex items-center gap-1">
                  <button
                    onClick={() => onApplyView(view)}
                    className={`flex min-w-0 flex-1 items-center gap-2 truncate rounded-lg px-2 py-1.5 text-left text-sm transition ${
                      isActive ? "bg-soft font-semibold text-ink" : "text-strong hover:bg-soft hover:text-ink"
                    }`}
                  >
                    <Bookmark className={`size-3.5 shrink-0 ${isActive ? "text-ink" : "text-muted"}`} />
                    <span className="truncate">{String(view.name ?? "View")}</span>
                  </button>
                  <button
                    onClick={() => onRemoveView(String(view.id))}
                    title="Remove this view"
                    aria-label={`Remove the view ${String(view.name ?? "")}`}
                    className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft hover:text-red-700 dark:text-red-300"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-2 pb-1 text-xs leading-5 text-muted">A view keeps the filters that are on the screen, so the same search is one click away.</p>
        )}
      </section>

      <section className="panel p-3">
        <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-[.14em] text-muted">Folders</p>
        <button
          onClick={() => onVault("")}
          className={`mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm ${activeVaultId === "" ? "bg-deep text-white" : "hover:bg-soft"}`}
        >
          <Library className="size-4" />
          <span className="truncate">All folders</span>
        </button>
        <FolderTree
          tree={tree}
          activeId={activeVaultId}
          onSelect={onVault}
          onMoveItem={onMoveItem}
          onCreate={onCreateFolder}
          onRename={onRenameFolder}
          onDelete={onDeleteFolder}
          dropHint="Drop the item here to move it into this folder"
          emptyHint="No folders yet."
        />
        <p className="px-3 pb-1 pt-2 text-xs leading-5 text-muted">
          Every saved item lives in one folder. Drag the saved text onto a folder to move the item into it, or make a
          sub-folder inside any of them.
        </p>
      </section>
    </div>
  );
}

/**
 * The box for putting an item into another folder.
 *
 * A screen without a mouse cannot drag, so the same thing can be done by
 * choosing the folder from a list.
 */
function MoveDialog({
  open, onClose, folders, onMove,
}: {
  open: boolean;
  onClose: () => void;
  folders: ReturnType<typeof flattenFolders>;
  onMove: (folderId: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Move to a folder">
      <div className="space-y-1">
        {folders.map((folder) => (
          <button
            key={folder.id}
            onClick={() => onMove(folder.id)}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-soft"
            style={{ paddingLeft: `${folder.depth * 14 + 12}px` }}
          >
            <FolderOpen className="size-4 shrink-0" />
            <span className="truncate">{folder.name}</span>
            <span className="ml-auto text-xs text-muted">{folder.itemCount ?? 0}</span>
          </button>
        ))}
      </div>
      {folders.length === 0 ? <p className="text-sm text-muted">There are no folders yet.</p> : null}
    </Modal>
  );
}

/**
 * The escape hatch for people without the extension: paste a link or a note by
 * hand and it lands in the same list as everything else.
 *
 * The folder is chosen here, not taken from the page. Before, the item always
 * went into the folder that was open on the page, and into the default folder
 * when no folder was open, so there was no way to choose.
 */
function ManualSaveModal({
  open, onClose, folders, vaults, initialVaultId, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  folders: ReturnType<typeof flattenFolders>;
  vaults: { id: string; name: string; isDefault?: boolean }[];
  initialVaultId: string;
  onSaved: () => void | Promise<void>;
}) {
  const { api } = useAuth();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [recordType, setRecordType] = useState<string>("note");
  const [vaultId, setVaultId] = useState("");
  const [tags, setTags] = useState("");

  /**
   * The folder the item goes into.
   *
   * The folder that was open on the page is used when there is one. Otherwise
   * the default folder is used, which is where the server puts anything that
   * has not been given a folder.
   */
  const defaultFolderId = initialVaultId || vaults.find((vault) => vault.isDefault)?.id || vaults[0]?.id || "";

  useEffect(() => {
    if (!open) {
      setTitle(""); setText(""); setUrl(""); setRecordType("note"); setTags("");
      return;
    }
    setVaultId(defaultFolderId);
  }, [open, defaultFolderId]);

  const save = useMutation({
    mutationFn: async () => {
      let source: { url: string; title: string; domain: string } | undefined;
      if (url.trim()) {
        const parsed = new URL(url.trim());
        source = { url: parsed.toString(), title: title.trim() || parsed.hostname, domain: parsed.hostname };
      }
      const item = await api.createSavedRecord({
        recordType,
        title: title.trim() || source?.title || "Untitled item",
        originalText: text.trim() || undefined,
        sourceType: "manual",
        source,
        vaultId: vaultId || undefined,
        captureKind: source ? "link" : "note",
        reviewStatus: "inbox",
        privacyLevel: "private",
        metadata: {},
      });
      const tagNames = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
      if (tagNames.length) {
        await api.organizeSavedRecord(item.id, { tagNames });
      }
      return item;
    },
    onSuccess: onSaved,
  });

  return (
    <Modal open={open} onClose={onClose} title="Save something">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <div>
          <Label htmlFor="manual-title">Title</Label>
          <Input id="manual-title" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What is this?" />
        </div>
        <div>
          <Label htmlFor="manual-url">Link <span className="font-normal text-muted">(optional)</span></Label>
          <Input id="manual-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/page" />
        </div>
        <div>
          <Label htmlFor="manual-text">Text <span className="font-normal text-muted">(optional)</span></Label>
          <textarea id="manual-text" className="min-h-24 w-full rounded-xl border border-line bg-surface p-3 text-sm" value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste the text you want to keep…" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="manual-type">Type</Label>
            <select id="manual-type" className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm" value={recordType} onChange={(event) => setRecordType(event.target.value)}>
              {PRIMARY_RECORD_TYPES.map((type) => <option key={type} value={type}>{recordTypeLabel(type)}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="manual-folder">Folder</Label>
            <select
              id="manual-folder"
              className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm"
              value={vaultId}
              onChange={(event) => setVaultId(event.target.value)}
            >
              {folders.length ? folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{`${"— ".repeat(folder.depth)}${folder.name}`}</option>
              )) : <option value="">The default folder</option>}
            </select>
            <p className="mt-1 text-xs leading-5 text-muted">The folder this item is saved into. It is the same folder you see on the left.</p>
          </div>
        </div>
        <div>
          <Label htmlFor="manual-tags">Tags <span className="font-normal text-muted">(separate with commas)</span></Label>
          <Input id="manual-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="research, urgent" />
        </div>
        {save.error ? <p className="text-sm text-red-700 dark:text-red-300">{save.error.message}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending || (!title.trim() && !text.trim() && !url.trim())}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Sortable({ label, onClick }: { label: string; onClick: () => void }) {
  return <th className="px-4 py-3 font-semibold"><button onClick={onClick} className="flex items-center gap-1">{label}<ArrowDownUp className="size-3" /></button></th>;
}
