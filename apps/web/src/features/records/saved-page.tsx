import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, ArrowDownUp, ChevronLeft, ChevronRight, Download, ExternalLink,
  FolderOpen, Library, Link2, Plus, RotateCcw, Search, Trash2, X,
} from "lucide-react";
import {
  Badge, Button, EmptyState, Input, Label, PRIMARY_RECORD_TYPES, RecordTypeIcon,
  RecordTypeLabel, recordTypeLabel,
} from "@data-vault/ui";
import type { SavedRecord } from "@data-vault/types";
import { RECORD_TYPES } from "@data-vault/schemas";
import { format } from "date-fns";
import { useAuth } from "../../lib/auth";
import { QueryState } from "../../components/data-state";
import { Modal, useToast } from "../../components/feedback";
import { PageHeader } from "../../components/page";

/**
 * The single place where every saved item lives.
 *
 * This page used to be split in two — a "Vault" page and a "Saved Captures"
 * page — which showed the same records behind two different filter UIs and
 * made it impossible to guess where to look. Folders, collections, and tags
 * now live in a filter rail beside the list.
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

  const recordType = params.get("type") ?? "";
  const archived = params.get("archived") === "true";
  const trash = params.get("trash") === "true";
  const sort = params.get("sort") ?? "createdAt";
  const direction = params.get("direction") ?? "desc";
  const vaultId = params.get("vault") ?? "";
  const collectionId = params.get("collection") ?? "";
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
  const collections = useQuery({ queryKey: ["collections", activeVaultId], queryFn: () => api.listCollections(activeVaultId), enabled: Boolean(organization && activeVaultId) });
  const tags = useQuery({ queryKey: ["tags", organization?.id], queryFn: () => api.listTags(), enabled: Boolean(organization) });

  const query = useQuery({
    queryKey: ["records", organization?.id, page, debounced, recordType, archived, trash, sort, direction, activeVaultId, collectionId, tag],
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
      collectionId: collectionId || undefined,
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

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };
  const clearFilters = () => {
    setSearch("");
    setParams(new URLSearchParams(), { replace: true });
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
      filters: { q: debounced, type: recordType, archived: archived ? "true" : "", trash: trash ? "true" : "", vault: vaultId, collection: collectionId, tag },
      columns: [],
      sort: { field: sort, direction },
    }),
    onSuccess: async () => {
      notify("The view was saved");
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
    for (const key of ["q", "type", "archived", "trash", "vault", "collection", "tag"]) {
      const value = filters[key];
      if (typeof value === "string" && value) next.set(key, value);
    }
    if (typeof viewSort.field === "string") next.set("sort", viewSort.field);
    if (typeof viewSort.direction === "string") next.set("direction", viewSort.direction);
    setSearch(typeof filters.q === "string" ? filters.q : "");
    setParams(next, { replace: true });
    setPage(1);
  };
  const storeView = () => {
    const name = window.prompt("Name this view", "My view");
    if (!name?.trim()) return;
    saveView.mutate(name.trim());
  };

  const exportCsv = async () => {
    if (!query.data?.total) return;
    const records: SavedRecord[] = [];
    for (let exportPage = 1; exportPage <= Math.ceil(query.data.total / 100); exportPage += 1) {
      const result = await api.listSavedRecords({ page: exportPage, limit: 100, q: debounced || undefined, recordType: recordType || undefined, archived, trash, sort, direction, vaultId: activeVaultId || undefined, collectionId: collectionId || undefined, tag: tag || undefined });
      records.push(...result.items);
    }
    const rows = records.map((record) => [record.title, record.originalText ?? "", record.sourceDomain ?? "", record.capturedAt ?? record.createdAt, recordTypeLabel(record.recordType)].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
    const blob = new Blob([["Title,Text,Source,Saved at,Type", ...rows].join("\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `datavault-saved-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const activeFilterCount = [recordType, vaultId, collectionId, tag, archived ? "1" : "", trash ? "1" : ""].filter(Boolean).length;
  const hasItems = Boolean(query.data?.items.length);

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

    <div className="grid gap-5 xl:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <FilterRail
          views={views.data ?? []}
          onApplyView={applyView}
          onSaveView={storeView}
          onRemoveView={(id) => removeView.mutate(id)}
          vaults={vaults.data ?? []}
          activeVaultId={activeVaultId}
          onVault={(id) => { const next = new URLSearchParams(params); if (id) next.set("vault", id); else next.delete("vault"); next.delete("collection"); setParams(next, { replace: true }); setPage(1); }}
          collections={collections.data ?? []}
          activeCollectionId={collectionId}
          onCollection={(id) => updateFilter("collection", id)}
          tags={tags.data ?? []}
          activeTag={tag}
          onTag={(name) => updateFilter("tag", name)}
        />
      </aside>

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 size-4 text-muted" />
            <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles, saved text, or websites…" />
          </div>
          <select aria-label="Type" value={recordType} onChange={(event) => updateFilter("type", event.target.value)} className="h-11 rounded-xl border border-line bg-surface px-3 text-sm">
            <option value="">All types</option>
            {RECORD_TYPES.map((type) => <option key={type} value={type}>{recordTypeLabel(type)}</option>)}
          </select>
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
            <button className="font-semibold underline" onClick={clearFilters}>Clear all</button>
          </div>
        ) : null}

        <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()} />

        {!query.isLoading && !query.error && !hasItems ? (
          activeFilterCount > 0 || debounced ? (
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
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b border-line bg-hover text-xs uppercase tracking-wide text-muted">
                <tr>
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
                  <tr key={record.id} className="hover:bg-surface">
                    <td className="max-w-52 px-4 py-3">
                      <Link to={`/saved/${record.id}`} className="font-semibold hover:underline">{record.title}</Link>
                    </td>
                    <td className="max-w-64 px-4 py-3">
                      <span className="block truncate font-mono text-xs text-strong">{record.originalText ?? "—"}</span>
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
              <Link to={`/saved/${record.id}`} key={record.id} className="block p-4">
                <div className="flex gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-soft"><RecordTypeIcon type={record.recordType} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">{record.title}</p>
                      <Badge tone="teal">{recordTypeLabel(record.recordType)}</Badge>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted">{record.originalText ?? record.sourceDomain ?? "Saved item"}</p>
                    <p className="mt-2 text-xs text-muted">{record.sourceDomain ?? "No source"} · {format(new Date(record.capturedAt ?? record.createdAt), "dd MMM yyyy")}</p>
                  </div>
                </div>
              </Link>
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

    <ManualSaveModal
      open={manualOpen}
      onClose={() => setManualOpen(false)}
      vaultId={activeVaultId}
      collections={collections.data ?? []}
      onSaved={async () => {
        setManualOpen(false);
        notify("Saved");
        await client.invalidateQueries({ queryKey: ["records"] });
      }}
    />
  </>;
}

function FilterRail({
  vaults, activeVaultId, onVault, collections, activeCollectionId, onCollection, tags, activeTag, onTag,
  views, onApplyView, onSaveView, onRemoveView,
}: {
  vaults: { id: string; name: string; itemCount?: number }[];
  activeVaultId: string;
  onVault: (id: string) => void;
  collections: { id: string; name: string; color: string; itemCount?: number }[];
  activeCollectionId: string;
  onCollection: (id: string) => void;
  tags: { id: string; name: string; color: string; itemCount?: number }[];
  activeTag: string;
  onTag: (name: string) => void;
  views: Record<string, unknown>[];
  onApplyView: (view: Record<string, unknown>) => void;
  onSaveView: () => void;
  onRemoveView: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="panel p-3">
        <div className="flex items-center justify-between px-2 pb-2">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-muted">Views</p>
          <button onClick={onSaveView} className="text-xs underline">Save this view</button>
        </div>
        {views.length ? (
          <div className="space-y-0.5">
            {views.map((view) => (
              <div key={String(view.id)} className="flex items-center gap-1">
                <button onClick={() => onApplyView(view)} className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-soft">
                  {String(view.name ?? "View")}
                </button>
                <button
                  onClick={() => onRemoveView(String(view.id))}
                  title="Remove this view"
                  aria-label={`Remove the view ${String(view.name ?? "")}`}
                  className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft hover:text-red-700"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
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
        {vaults.map((vault) => (
          <button
            key={vault.id}
            onClick={() => onVault(vault.id)}
            className={`mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm ${activeVaultId === vault.id ? "bg-deep text-white" : "hover:bg-soft"}`}
          >
            <FolderOpen className="size-4" />
            <span className="truncate">{vault.name}</span>
            <span className="ml-auto text-xs opacity-70">{vault.itemCount ?? 0}</span>
          </button>
        ))}
        {vaults.length === 0 ? <p className="px-3 py-2 text-sm text-muted">No folders yet.</p> : null}
        <p className="mt-2 border-t border-line px-2 pt-3 text-xs text-muted">
          Manage folders, collections, and tags in <Link to="/organize" className="font-semibold text-black underline">Organize</Link>.
        </p>
      </section>

      <section className="panel p-3">
        <div className="flex items-center justify-between px-2 pb-2">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-muted">Collections</p>
          <button className="text-xs underline" onClick={() => onCollection("")}>All</button>
        </div>
        {collections.map((collection) => (
          <button
            key={collection.id}
            onClick={() => onCollection(collection.id)}
            className={`mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ${activeCollectionId === collection.id ? "bg-soft font-semibold" : "hover:bg-soft"}`}
          >
            <span className="size-2 rounded-full" style={{ backgroundColor: collection.color }} />
            {collection.name}
            <span className="ml-auto text-xs text-muted">{collection.itemCount}</span>
          </button>
        ))}
        {collections.length === 0 ? <p className="px-3 py-2 text-sm text-muted">No collections in this folder.</p> : null}
      </section>

      <section className="panel p-3">
        <div className="flex items-center justify-between px-2 pb-2">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-muted">Tags</p>
          <button className="text-xs underline" onClick={() => onTag("")}>All</button>
        </div>
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => onTag(tag.name)}
              className={`rounded-full px-2 py-1 text-xs ${activeTag === tag.name ? "bg-deep text-white" : "bg-soft"}`}
            >
              #{tag.name}
            </button>
          ))}
        </div>
        {tags.length === 0 ? <p className="px-3 py-2 text-sm text-muted">No tags yet.</p> : null}
      </section>
    </div>
  );
}

/**
 * The escape hatch for people without the extension: paste a link or a note by
 * hand and it lands in the same list as everything else.
 */
function ManualSaveModal({
  open, onClose, vaultId, collections, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  vaultId: string;
  collections: { id: string; name: string }[];
  onSaved: () => void | Promise<void>;
}) {
  const { api } = useAuth();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [recordType, setRecordType] = useState<string>("note");
  const [collectionId, setCollectionId] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (!open) {
      setTitle(""); setText(""); setUrl(""); setRecordType("note"); setCollectionId(""); setTags("");
    }
  }, [open]);

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
      if (collectionId || tagNames.length) {
        await api.organizeSavedRecord(item.id, { collectionIds: collectionId ? [collectionId] : [], tagNames });
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
            <Label htmlFor="manual-collection">Collection</Label>
            <select id="manual-collection" className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
              <option value="">None</option>
              {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <Label htmlFor="manual-tags">Tags <span className="font-normal text-muted">(separate with commas)</span></Label>
          <Input id="manual-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="research, urgent" />
        </div>
        {save.error ? <p className="text-sm text-red-700">{save.error.message}</p> : null}
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
  return <th className="px-4 py-3 font-semibold"><button className="flex items-center gap-1" onClick={onClick}>{label}<ArrowDownUp className="size-3" /></button></th>;
}
