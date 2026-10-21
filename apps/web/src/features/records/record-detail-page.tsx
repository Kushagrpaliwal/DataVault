import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, ExternalLink, FileText, RotateCcw, Save, Trash2 } from "lucide-react";
import { Badge, Button, Input, RecordTypeIcon, recordTypeLabel } from "@data-vault/ui";
import type { NoteSummary, SavedRecord } from "@data-vault/types";
import { format } from "date-fns";
import { useAuth } from "../../lib/auth";
import { QueryState } from "../../components/data-state";
import { Modal, useToast } from "../../components/feedback";
import { AiPanel } from "../../components/ai-panel";

type Detail = SavedRecord & {
  metadata: Record<string, unknown>;
  capture: Record<string, unknown> | null;
  payment: Record<string, unknown> | null;
  attachments: Attachment[];
  audit: Record<string, unknown>[];
  collections: Array<{ id: string; name: string; color: string }>;
  tags: Array<{ id: string; name: string; color: string }>;
  evidence: Array<{ id: string; sourceUrl: string | null; sourceTitle: string | null; sourceDomain: string | null; contentHash: string; capturedAt: string }>;
};

type Attachment = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: string;
  createdAt: string;
};

export function RecordDetailPage() {
  const { id = "" } = useParams();
  const { api, organization } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { notify } = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const query = useQuery({
    queryKey: ["record", organization?.id, id],
    queryFn: async () => {
      const detail = (await api.getSavedRecord(id)) as Detail;
      return detail;
    },
  });

  /**
   * Start editing.
   *
   * The form starts from the record that is on screen. Filling the fields
   * while the query was loading would throw away whatever the user had
   * already typed whenever the page was refetched.
   */
  const startEditing = () => {
    if (!query.data) return;
    setTitle(query.data.title);
    setDescription(query.data.description ?? "");
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: () => api.updateSavedRecord(id, { title, description }),
    onSuccess: async () => {
      notify("Record updated");
      setEditing(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["record", organization?.id, id] }),
        client.invalidateQueries({ queryKey: ["records"] }),
      ]);
    },
  });

  const archive = useMutation({
    mutationFn: () => (query.data?.archivedAt ? api.restoreSavedRecord(id) : api.archiveSavedRecord(id)),
    onSuccess: async () => {
      notify(query.data?.archivedAt ? "Item restored" : "Item archived");
      await client.invalidateQueries({ queryKey: ["record", organization?.id, id] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteSavedRecord(id),
    onSuccess: async () => {
      notify("Item moved to Trash");
      await client.invalidateQueries({ queryKey: ["records"] });
      navigate("/saved");
    },
  });
  const restoreTrash = useMutation({
    mutationFn: () => api.restoreTrashedRecord(id),
    onSuccess: async () => {
      notify("Item restored from Trash");
      await client.invalidateQueries({ queryKey: ["record", organization?.id, id] });
    },
  });
  const deleteCapture = () => {
    if (!query.data || !window.confirm(`Move "${query.data.title}" to Trash? You can restore it later.`)) return;
    remove.mutate();
  };

  return (
    <>
      <button className="mb-5 flex items-center gap-2 text-sm text-[#6a6a6a] hover:text-black" onClick={() => navigate(-1)}>
        <ArrowLeft className="size-4" />
        Back to saved items
      </button>
      <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()} />
      {query.data ? (
        <div className="grid gap-6 xl:grid-cols-[1.45fr_.8fr]">
          <div className="space-y-6">
            <section className="panel p-6">
              <div className="flex flex-wrap items-start gap-4">
                <span className="grid size-12 place-items-center rounded-2xl bg-[#b8a4ed]">
                  <RecordTypeIcon type={query.data.recordType} className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <div className="space-y-3">
                      <Input value={title} onChange={(event) => setTitle(event.target.value)} />
                      <textarea
                        className="w-full rounded-xl border bg-white p-3 text-sm"
                        rows={3}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="display text-3xl">{query.data.title}</h1>
                        <Badge>{recordTypeLabel(query.data.recordType)}</Badge>
                        {query.data.createdVia === "extension" ? (
                          <Badge tone="teal">Saved from the extension</Badge>
                        ) : null}
                      </div>
                      {query.data.description ? <p className="mt-3 text-[#6a6a6a]">{query.data.description}</p> : null}
                    </>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
                    <FileText className="size-4" />
                    Add to doc
                  </Button>
                  {editing ? (
                    <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                      <Save className="size-4" />
                      Save
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={startEditing}>
                      Edit
                    </Button>
                  )}
                  {query.data.deletedAt ? <Button size="sm" variant="secondary" onClick={() => restoreTrash.mutate()} disabled={restoreTrash.isPending}><RotateCcw className="size-4" />Restore from Trash</Button> : <Button size="sm" variant="secondary" onClick={() => archive.mutate()}>
                    {query.data.archivedAt ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
                    {query.data.archivedAt ? "Restore" : "Archive"}
                  </Button>}
                  {!["payment", "invoice", "customer", "vendor", "refund", "subscription"].includes(query.data.recordType) && !query.data.deletedAt ? <Button size="sm" variant="ghost" className="text-red-700" onClick={deleteCapture} disabled={remove.isPending}><Trash2 className="size-4" />Trash</Button> : null}
                </div>
              </div>
              <dl className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Category" value={query.data.category} />
                <Field label="Created via" value={query.data.createdVia} />
                <Field label="Review state" value={query.data.reviewStatus} />
                <Field label="Created" value={format(new Date(query.data.createdAt), "dd MMM yyyy, h:mm a")} />
                <Field label="Updated" value={format(new Date(query.data.updatedAt), "dd MMM yyyy, h:mm a")} />
              </dl>
            </section>

            {query.data.originalText ? (
              <section className="panel p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Original captured text</h2>
                    <p className="mt-1 text-sm text-[#6a6a6a]">Preserved exactly as clipped from the web.</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard.writeText(query.data?.originalText ?? "");
                      notify("Text copied to clipboard");
                    }}
                  >
                    Copy snippet
                  </Button>
                </div>
                <pre className="mt-5 overflow-x-auto whitespace-pre-wrap rounded-2xl bg-[#f5f0e0] p-5 font-mono text-sm leading-6">
                  {query.data.originalText}
                </pre>
              </section>
            ) : null}

            {query.data.evidence.length ? <section className="panel p-6"><h2 className="text-lg font-semibold">Evidence trail</h2><p className="mt-1 text-sm text-[#6a6a6a]">Immutable source snapshots captured with this item.</p><div className="mt-4 space-y-3">{query.data.evidence.map((evidence) => <div key={evidence.id} className="rounded-xl bg-[#f5f0e0] p-4"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{evidence.sourceTitle ?? evidence.sourceDomain ?? "Captured evidence"}</p><Badge tone="teal">Verified snapshot</Badge></div><p className="mt-1 break-all font-mono text-[11px] text-[#6a6a6a]">SHA-256 {evidence.contentHash}</p><p className="mt-1 text-xs text-[#6a6a6a]">Captured {format(new Date(evidence.capturedAt), "dd MMM yyyy, h:mm a")}</p>{evidence.sourceUrl ? <a className="mt-2 inline-flex text-sm font-medium underline" href={evidence.sourceUrl} target="_blank" rel="noreferrer">Open source</a> : null}</div>)}</div></section> : null}

            <AiPanel content={query.data.originalText ?? query.data.title} recordId={query.data.id} />
          </div>

          <aside className="space-y-6">
            <section className="rounded-3xl bg-[#1a3a3a] p-6 text-white">
              <h2 className="text-lg font-semibold">Source context</h2>
              <dl className="mt-5 space-y-4">
                <Field label="Source Domain" value={query.data.sourceDomain ?? "Manual entry"} inverse capitalize={false} />
                <Field label="Page Title" value={query.data.sourcePageTitle} inverse />
                <Field
                  label="Captured At"
                  value={query.data.capturedAt ? format(new Date(query.data.capturedAt), "dd MMM yyyy, h:mm a") : null}
                  inverse
                />
              </dl>
              {query.data.sourceUrl ? (
                <Button asChild variant="secondary" className="mt-5">
                  <a href={query.data.sourceUrl} target="_blank" rel="noreferrer">
                    Open original page
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              ) : null}
            </section>

            <section className="panel p-6">
              <h2 className="text-lg font-semibold">Attachments</h2>
              {query.data.attachments.length ? (
                <div className="mt-4 space-y-2">
                  {query.data.attachments.map((item) => <AttachmentPreview key={item.id} attachment={item} />)}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[#6a6a6a]">No attachments.</p>
              )}
            </section>

            <section className="panel p-6">
              <h2 className="text-lg font-semibold">Organization</h2>
              <p className="mt-1 text-sm leading-6 text-[#6a6a6a]">Put this item in a folder, and mark it so you can find it again.</p>
              <OrganizePanel record={query.data} onSaved={async () => {
                await client.invalidateQueries({ queryKey: ["record", organization?.id, id] });
                await client.invalidateQueries({ queryKey: ["records"] });
              }} />
            </section>

            <section className="panel p-6">
              <h2 className="text-lg font-semibold">Activity Timeline</h2>
              <div className="mt-5 space-y-5">
                {query.data.audit.length ? (
                  query.data.audit.map((entry) => (
                    <div key={String(entry.id)} className="relative border-l-2 border-[#ded8ca] pl-4">
                      <i className="absolute -left-[5px] top-1 size-2 rounded-full bg-[#ff4d8b]" />
                      <p className="text-sm font-semibold capitalize">
                        {String(entry.action)} {String(entry.resourceType).replaceAll("_", " ")}
                      </p>
                      <p className="mt-1 text-xs text-[#6a6a6a]">
                        {format(new Date(String(entry.createdAt)), "dd MMM yyyy, h:mm a")}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[#6a6a6a]">No history yet.</p>
                )}
              </div>
            </section>
          </aside>
        </div>
      ) : null}
      {query.data ? (
        <AddToDocDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          record={query.data}
          onAdded={(noteTitle) => {
            setAddOpen(false);
            notify(`Added to ${noteTitle}`);
            void client.invalidateQueries({ queryKey: ["notes"] });
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Where an item lives, and what it is marked with.
 *
 * The item can be moved between folders, put in collections, and marked with
 * tags. A tag that does not exist yet is made when it is used.
 */
function OrganizePanel({ record, onSaved }: { record: Detail; onSaved: () => Promise<void> | void }) {
  const { api, organization } = useAuth();
  const { notify } = useToast();
  const [vaultId, setVaultId] = useState(record.vaultId);
  const [collectionIds, setCollectionIds] = useState<string[]>(record.collections.map((collection) => collection.id));
  const [tagText, setTagText] = useState(record.tags.map((tag) => tag.name).join(", "));

  const vaults = useQuery({ queryKey: ["vaults", organization?.id], queryFn: () => api.listVaults(), enabled: Boolean(organization) });
  const collections = useQuery({ queryKey: ["collections", vaultId], queryFn: () => api.listCollections(vaultId), enabled: Boolean(vaultId) });

  /**
   * A collection belongs to one folder, so the ones left behind when the
   * folder changes are dropped.
   */
  useEffect(() => {
    if (!collections.data) return;
    const allowed = collections.data.map((collection) => collection.id);
    setCollectionIds((current) => current.filter((id) => allowed.includes(id)));
  }, [collections.data]);

  const save = useMutation({
    mutationFn: () => api.organizeSavedRecord(record.id, {
      vaultId,
      collectionIds,
      tagNames: tagText.split(",").map((tag) => tag.trim()).filter(Boolean),
    }),
    onSuccess: async () => {
      notify("The item was organized");
      await onSaved();
    },
  });

  return (
    <div className="mt-4 space-y-4">
      <div>
        <label htmlFor="organize-folder" className="text-xs font-semibold uppercase tracking-[.12em] text-[#6a6a6a]">Folder</label>
        <select
          id="organize-folder"
          value={vaultId}
          onChange={(event) => setVaultId(event.target.value)}
          className="mt-2 h-11 w-full rounded-xl border border-[#ded8ca] bg-white px-3 text-sm"
        >
          {vaults.data?.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}</option>)}
        </select>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[.12em] text-[#6a6a6a]">Collections</p>
        {collections.data?.length ? (
          <div className="mt-2 space-y-1">
            {collections.data.map((collection) => (
              <label key={collection.id} className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-[#f5f0e0]">
                <input
                  type="checkbox"
                  checked={collectionIds.includes(collection.id)}
                  onChange={(event) => setCollectionIds((current) => event.target.checked
                    ? [...current, collection.id]
                    : current.filter((id) => id !== collection.id))}
                />
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: collection.color }} />
                {collection.name}
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-[#6a6a6a]">This folder has no collections. They are made in Organize.</p>
        )}
      </div>

      <div>
        <label htmlFor="organize-tags" className="text-xs font-semibold uppercase tracking-[.12em] text-[#6a6a6a]">Tags</label>
        <Input
          id="organize-tags"
          className="mt-2"
          value={tagText}
          onChange={(event) => setTagText(event.target.value)}
          placeholder="research, to read"
        />
        <p className="mt-1 text-xs text-[#6a6a6a]">Separate the tags with commas. A tag that does not exist yet is made now.</p>
      </div>

      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save the organization"}
      </Button>
    </div>
  );
}

/**
 * Choose which doc a saved item is added to.
 */
function AddToDocDialog({
  open, onClose, record, onAdded,
}: {
  open: boolean;
  onClose: () => void;
  record: Detail;
  onAdded: (noteTitle: string) => void;
}) {
  const { api } = useAuth();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    void api.listNotes({ limit: 50 })
      .then(setNotes)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Your docs could not be loaded."));
  }, [api, open]);

  const add = async (noteId: string, title: string) => {
    setBusy(noteId);
    setError("");
    try {
      await api.addNoteClip(noteId, {
        text: record.originalText ?? record.title,
        source: {
          url: record.sourceUrl ?? undefined,
          title: record.sourcePageTitle ?? record.title,
          domain: record.sourceDomain ?? "",
        },
        capturedAt: record.capturedAt ?? new Date().toISOString(),
      });
      onAdded(title);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The item could not be added to that doc.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} title="Add to a doc" onClose={onClose}>
      {error ? <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {!notes.length ? (
        <p className="text-sm text-[#6a6a6a]">You have no docs yet. Create one on the Docs page first.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id}>
              <button
                onClick={() => void add(note.id, note.title)}
                disabled={busy !== null}
                className="flex w-full items-center gap-3 rounded-xl bg-[#f5f0e0] p-3 text-left hover:bg-[#ebe6d6] disabled:opacity-60"
              >
                <span className="text-lg">{note.icon ?? "📄"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{note.title}</span>
                  <span className="block truncate text-xs text-[#6a6a6a]">{note.clipCount} pieces</span>
                </span>
                {busy === note.id ? <span className="text-xs text-[#6a6a6a]">Adding…</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const { api, organization } = useAuth();
  const [url, setUrl] = useState<string>();
  const query = useQuery({
    queryKey: ["attachment", organization?.id, attachment.id],
    queryFn: () => api.getAttachmentBlob(attachment.id),
    enabled: attachment.mimeType.startsWith("image/"),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!query.data) return;
    const objectUrl = URL.createObjectURL(query.data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [query.data]);

  return <div className="overflow-hidden rounded-xl bg-[#f5f0e0] p-3 text-sm">
    {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={attachment.fileName} className="mb-3 max-h-72 w-full rounded-lg border bg-white object-contain" /></a> : null}
    <div className="flex items-center justify-between gap-3"><span className="truncate font-medium">{attachment.fileName}</span><span className="shrink-0 text-xs text-[#6a6a6a]">{formatBytes(attachment.byteSize)}</span></div>
    {query.isError ? <p className="mt-1 text-xs text-red-700">Screenshot preview could not be loaded.</p> : null}
  </div>;
}

function formatBytes(value: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  return bytes < 1_024 ? `${bytes} B` : `${(bytes / 1_024).toFixed(1)} KB`;
}

function Field({
  label,
  value,
  inverse = false,
  capitalize = true,
}: {
  label: string;
  value?: string | null | undefined;
  inverse?: boolean;
  /** Set for values that are not words, such as a domain or an email address. */
  capitalize?: boolean;
}) {
  return (
    <div>
      <dt className={`text-xs font-semibold uppercase tracking-[.12em] ${inverse ? "text-white/55" : "text-[#6a6a6a]"}`}>
        {label}
      </dt>
      <dd className={`mt-1 text-sm font-medium ${capitalize ? "capitalize" : ""} ${inverse ? "text-white" : "text-[#222]"}`}>
        {value || "—"}
      </dd>
    </div>
  );
}
