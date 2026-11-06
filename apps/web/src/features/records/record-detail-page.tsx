import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, ArrowLeft, BookOpen, Check, Copy, ExternalLink, FileText, Quote, RotateCcw, Save, Trash2,
} from "lucide-react";
import { Badge, Button, Input, RecordTypeIcon, recordTypeLabel, cn } from "@data-vault/ui";
import type { NoteSummary, SavedRecord } from "@data-vault/types";
import { format } from "date-fns";
import { useAuth } from "../../lib/auth";
import { snapshotWithPolicy } from "../../lib/snapshot";
import { QueryState } from "../../components/data-state";
import { Modal, useToast } from "../../components/feedback";
import { AiPanel } from "../../components/ai-panel";
import { flattenFolders, folderTree } from "./folder-tree";

type Detail = SavedRecord & {
  metadata: Record<string, unknown>;
  capture: Record<string, unknown> | null;
  attachments: Attachment[];
  audit: Record<string, unknown>[];
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
  const [citeOpen, setCiteOpen] = useState(false);
  /**
   * The page as it was, when the item was saved.
   */
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);

  const showSnapshot = async () => {
    setSnapshotBusy(true);
    try {
      const html = await api.pageSnapshot(id);
      setSnapshot(html);
      setSnapshotOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The page as it was could not be loaded.", "error");
    } finally {
      setSnapshotBusy(false);
    }
  };

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
      <button className="mb-5 flex items-center gap-2 text-sm text-muted hover:text-ink" onClick={() => navigate(-1)}>
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
                        className="w-full rounded-xl border border-line bg-surface p-3 text-sm"
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
                      {query.data.description ? <p className="mt-3 text-muted">{query.data.description}</p> : null}
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void showSnapshot()} disabled={snapshotBusy}>
                    <BookOpen className="size-4" />
                    Reader mode
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setCiteOpen(true)}>
                    <Quote className="size-4" />
                    Cite
                  </Button>
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
                  {!query.data.deletedAt ? <Button size="sm" variant="ghost" className="text-red-700 dark:text-red-300" onClick={deleteCapture} disabled={remove.isPending}><Trash2 className="size-4" />Trash</Button> : null}
                </div>
              </div>
              <dl className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Type" value={query.data.recordType} />
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
                    <p className="mt-1 text-sm text-muted">Preserved exactly as clipped from the web.</p>
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
                <pre className="mt-5 overflow-x-auto whitespace-pre-wrap rounded-2xl bg-soft p-5 font-mono text-sm leading-6">
                  {query.data.originalText}
                </pre>
              </section>
            ) : null}

            {query.data.evidence.length ? <section className="panel p-6"><h2 className="text-lg font-semibold">Evidence trail</h2><p className="mt-1 text-sm text-muted">Immutable source snapshots captured with this item.</p><div className="mt-4 space-y-3">{query.data.evidence.map((evidence) => <div key={evidence.id} className="rounded-xl bg-soft p-4"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{evidence.sourceTitle ?? evidence.sourceDomain ?? "Captured evidence"}</p><Badge tone="teal">Verified snapshot</Badge></div><p className="mt-1 break-all font-mono text-[11px] text-muted">SHA-256 {evidence.contentHash}</p><p className="mt-1 text-xs text-muted">Captured {format(new Date(evidence.capturedAt), "dd MMM yyyy, h:mm a")}</p><div className="mt-2 flex flex-wrap gap-3">{evidence.sourceUrl ? <a className="inline-flex text-sm font-medium underline" href={evidence.sourceUrl} target="_blank" rel="noreferrer">Open source</a> : null}<button type="button" className="inline-flex text-sm font-medium underline" onClick={() => void showSnapshot()} disabled={snapshotBusy}>{snapshotBusy ? "Loading…" : "See the page as it was"}</button></div></div>)}</div></section> : null}

            <AiPanel content={query.data.originalText ?? query.data.title} recordId={query.data.id} />
          </div>

          <aside className="space-y-6">
            <section className="rounded-3xl bg-deep p-6 text-white">
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
                <p className="mt-3 text-sm text-muted">No attachments.</p>
              )}
            </section>

            <section className="panel p-6">
              <h2 className="text-lg font-semibold">Organization</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                Put this item in a folder, and mark it with tags so you can find it again.
              </p>
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
                    <div key={String(entry.id)} className="relative border-l-2 border-line pl-4">
                      <i className="absolute -left-[5px] top-1 size-2 rounded-full bg-[#ff4d8b]" />
                      <p className="text-sm font-semibold capitalize">
                        {String(entry.action)} {String(entry.resourceType).replaceAll("_", " ")}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {format(new Date(String(entry.createdAt)), "dd MMM yyyy, h:mm a")}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted">No history yet.</p>
                )}
              </div>
            </section>
          </aside>
        </div>
      ) : null}
      {query.data ? (
        <>
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
          <CitationModal
            open={citeOpen}
            onClose={() => setCiteOpen(false)}
            record={query.data}
          />
          <ReaderAndSnapshotModal
            open={snapshotOpen}
            onClose={() => setSnapshotOpen(false)}
            snapshotHtml={snapshot}
            record={query.data}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * Where an item lives, and what it is marked with.
 *
 * The item can be moved between folders, and marked with tags. A tag that
 * does not exist yet is made when it is used.
 */
function OrganizePanel({ record, onSaved }: { record: Detail; onSaved: () => Promise<void> | void }) {
  const { api, organization } = useAuth();
  const { notify } = useToast();
  const [vaultId, setVaultId] = useState(record.vaultId);
  const [tagText, setTagText] = useState(record.tags.map((tag) => tag.name).join(", "));

  const vaults = useQuery({ queryKey: ["vaults", organization?.id], queryFn: () => api.listVaults(), enabled: Boolean(organization) });

  /**
   * The folders, with the folders under them, so that a sub-folder can be
   * chosen as well as a folder.
   */
  const folders = useMemo(() => flattenFolders(folderTree(vaults.data ?? [])), [vaults.data]);

  const save = useMutation({
    mutationFn: () => api.organizeSavedRecord(record.id, {
      vaultId,
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
        <label htmlFor="organize-folder" className="text-xs font-semibold uppercase tracking-[.12em] text-muted">Folder</label>
        <select
          id="organize-folder"
          value={vaultId}
          onChange={(event) => setVaultId(event.target.value)}
          className="mt-2 h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm"
        >
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{`${"— ".repeat(folder.depth)}${folder.name}`}</option>)}
        </select>
        <p className="mt-1 text-xs leading-5 text-muted">
          The folder this item lives in. Every item is in one folder, and the browser extension can save into any of them.
        </p>
      </div>

      <div>
        <label htmlFor="organize-tags" className="text-xs font-semibold uppercase tracking-[.12em] text-muted">Tags</label>
        <Input
          id="organize-tags"
          className="mt-2"
          value={tagText}
          onChange={(event) => setTagText(event.target.value)}
          placeholder="research, to read"
        />
        <p className="mt-1 text-xs leading-5 text-muted">
          Separate the tags with commas. A tag is a label that works across every folder, so one item can have several.
          A tag that does not exist yet is made now.
        </p>
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
      {error ? <div className="mb-3 rounded-xl bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
      {!notes.length ? (
        <p className="text-sm text-muted">You have no docs yet. Create one on the Docs page first.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id}>
              <button
                onClick={() => void add(note.id, note.title)}
                disabled={busy !== null}
                className="flex w-full items-center gap-3 rounded-xl bg-soft p-3 text-left hover:bg-soft disabled:opacity-60"
              >
                <span className="text-lg">{note.icon ?? "📄"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{note.title}</span>
                  <span className="block truncate text-xs text-muted">{note.clipCount} pieces</span>
                </span>
                {busy === note.id ? <span className="text-xs text-muted">Adding…</span> : null}
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

  return <div className="overflow-hidden rounded-xl bg-soft p-3 text-sm">
    {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={attachment.fileName} className="mb-3 max-h-72 w-full rounded-lg border border-line bg-white object-contain" /></a> : null}
    <div className="flex items-center justify-between gap-3"><span className="truncate font-medium">{attachment.fileName}</span><span className="shrink-0 text-xs text-muted">{formatBytes(attachment.byteSize)}</span></div>
    {query.isError ? <p className="mt-1 text-xs text-red-700 dark:text-red-300">Screenshot preview could not be loaded.</p> : null}
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
      <dt className={`text-xs font-semibold uppercase tracking-[.12em] ${inverse ? "text-white/55" : "text-muted"}`}>
        {label}
      </dt>
      <dd className={`mt-1 text-sm font-medium ${capitalize ? "capitalize" : ""} ${inverse ? "text-white" : "text-ink"}`}>
        {value || "—"}
      </dd>
    </div>
  );
}

function generateCitations(record: Detail) {
  const author = (record.metadata?.author as string) || (record.metadata?.byline as string) || "";
  const title = record.title || "Untitled";
  const siteName = record.sourcePageTitle || record.sourceDomain || "Web";
  const url = record.sourceUrl || "";
  const pubDateRaw = (record.metadata?.publicationDate as string) || record.capturedAt || record.createdAt;
  const pubDate = new Date(pubDateRaw);
  const isValidDate = !isNaN(pubDate.getTime());
  const year = isValidDate ? pubDate.getFullYear().toString() : "n.d.";
  const monthDay = isValidDate ? format(pubDate, "MMMM d") : "";
  const accessedDate = format(new Date(), "MMMM d, yyyy");
  const authorDisplay = author || siteName;
  const citeKey = ((author ? author.split(" ").pop() : siteName) ?? "source").toLowerCase().replace(/[^a-z0-9]/g, "") + year;

  const apa = `${authorDisplay}. (${year}${monthDay ? `, ${monthDay}` : ""}). ${title}. ${siteName !== authorDisplay ? siteName + ". " : ""}${url}`;
  const mla = `${authorDisplay}. "${title}." ${siteName}, ${isValidDate ? format(pubDate, "d MMM. yyyy") : "n.d."}, ${url}. Accessed ${accessedDate}.`;
  const chicago = `${authorDisplay}. "${title}." ${siteName}. ${isValidDate ? format(pubDate, "MMMM d, yyyy") : ""}. Accessed ${accessedDate}. ${url}.`;
  const harvard = `${authorDisplay} (${year}) '${title}', ${siteName}, available at: ${url} (Accessed: ${accessedDate}).`;
  const bibtex = `@misc{${citeKey},
  author = {${authorDisplay}},
  title = {${title.replace(/[{}]/g, "")}},
  year = {${year}},
  howpublished = {\\url{${url}}},
  note = {Accessed: ${accessedDate}}
}`;

  return { apa, mla, chicago, harvard, bibtex };
}

function extractReaderContent(html: string) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, noscript, iframe, svg, nav, footer, header, aside").forEach((el) => el.remove());
    const bodyText = doc.body.innerText || doc.body.textContent || "";
    const words = bodyText.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    const elements = Array.from(doc.querySelectorAll("h1, h2, h3, h4, p, blockquote, pre"));
    const paragraphs = elements
      .map((el) => ({ tag: el.tagName.toLowerCase(), text: el.textContent?.trim() || "" }))
      .filter((p) => p.text.length > 20 || p.tag.startsWith("h"));

    return {
      title: doc.title || "",
      paragraphs,
      wordCount,
      readTimeMinutes,
    };
  } catch {
    return null;
  }
}

function CitationModal({
  open,
  onClose,
  record,
}: {
  open: boolean;
  onClose: () => void;
  record: Detail;
}) {
  const { notify } = useToast();
  const [formatChoice, setFormatChoice] = useState<"apa" | "mla" | "chicago" | "harvard" | "bibtex">("apa");
  const [copied, setCopied] = useState(false);

  const citations = useMemo(() => generateCitations(record), [record]);
  const activeText = citations[formatChoice];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeText);
    setCopied(true);
    notify(`${formatChoice.toUpperCase()} citation copied`);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal open={open} onClose={onClose} title="Cite this source" width="max-w-2xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 border-b border-line pb-3">
          {(["apa", "mla", "chicago", "harvard", "bibtex"] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => {
                setFormatChoice(fmt);
                setCopied(false);
              }}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition",
                formatChoice === fmt ? "bg-deep text-white" : "border border-line bg-surface text-muted hover:bg-soft hover:text-ink",
              )}
            >
              {fmt}
            </button>
          ))}
        </div>

        <div className="rounded-2xl bg-soft p-5">
          <pre className="font-mono text-xs leading-relaxed text-ink whitespace-pre-wrap break-all">
            {activeText}
          </pre>
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={() => void handleCopy()} className="gap-1.5">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy citation"}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted">
          Generated based on extracted author, title, publication date, and source domain.
        </p>
      </div>
    </Modal>
  );
}

function ReaderAndSnapshotModal({
  open,
  onClose,
  snapshotHtml,
  record,
}: {
  open: boolean;
  onClose: () => void;
  snapshotHtml: string | null;
  record: Detail;
}) {
  const [mode, setMode] = useState<"reader" | "sandbox">("reader");
  const [fontSize, setFontSize] = useState<"sm" | "base" | "lg" | "xl">("base");
  const [fontFamily, setFontFamily] = useState<"sans" | "serif">("serif");
  const [tone, setTone] = useState<"light" | "sepia" | "dark">("light");

  const snapshotDocument = useMemo(() => (snapshotHtml ? snapshotWithPolicy(snapshotHtml) : ""), [snapshotHtml]);
  const parsedContent = useMemo(() => (snapshotHtml ? extractReaderContent(snapshotHtml) : null), [snapshotHtml]);

  const rawTextParagraphs = useMemo(() => {
    if (parsedContent?.paragraphs.length) return parsedContent.paragraphs;
    if (record.originalText) {
      return record.originalText.split(/\n\n+/).map((t) => ({ tag: "p", text: t.trim() })).filter((t) => t.text.length > 0);
    }
    return [];
  }, [parsedContent, record.originalText]);

  const wordCount = parsedContent?.wordCount ?? (record.originalText ? record.originalText.split(/\s+/).length : 0);
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  const toneClass = {
    light: "bg-surface text-ink",
    sepia: "bg-[#fbf0d9] text-[#433422]",
    dark: "bg-[#18181b] text-[#f4f4f5]",
  }[tone];

  const fontClass = fontFamily === "serif" ? "font-serif" : "font-sans";
  const sizeClass = {
    sm: "text-sm leading-6",
    base: "text-base leading-7",
    lg: "text-lg leading-8",
    xl: "text-xl leading-9",
  }[fontSize];

  return (
    <Modal open={open} onClose={onClose} title={record.title} width="max-w-4xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex items-center gap-1.5 rounded-xl border border-line bg-surface p-1">
            <button
              type="button"
              onClick={() => setMode("reader")}
              className={cn("rounded-lg px-3 py-1 text-xs font-semibold transition", mode === "reader" ? "bg-deep text-white" : "text-muted hover:text-ink")}
            >
              <BookOpen className="inline-block mr-1.5 size-3.5" />
              Reader view
            </button>
            <button
              type="button"
              onClick={() => setMode("sandbox")}
              className={cn("rounded-lg px-3 py-1 text-xs font-semibold transition", mode === "sandbox" ? "bg-deep text-white" : "text-muted hover:text-ink")}
            >
              Archived page
            </button>
          </div>

          {mode === "reader" ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span>{wordCount.toLocaleString()} words · ~{readTime} min read</span>

              <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5">
                <button
                  type="button"
                  onClick={() => setFontFamily("sans")}
                  className={cn("rounded px-2 py-0.5 font-sans font-semibold", fontFamily === "sans" ? "bg-soft text-ink" : "text-muted")}
                >
                  Sans
                </button>
                <button
                  type="button"
                  onClick={() => setFontFamily("serif")}
                  className={cn("rounded px-2 py-0.5 font-serif font-semibold", fontFamily === "serif" ? "bg-soft text-ink" : "text-muted")}
                >
                  Serif
                </button>
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5">
                {(["sm", "base", "lg", "xl"] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setFontSize(sz)}
                    className={cn("rounded px-1.5 py-0.5 text-xs font-semibold uppercase", fontSize === sz ? "bg-soft text-ink" : "text-muted")}
                  >
                    {sz === "sm" ? "S" : sz === "base" ? "M" : sz === "lg" ? "L" : "XL"}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5">
                <button
                  type="button"
                  onClick={() => setTone("light")}
                  className={cn("size-5 rounded-full border border-line bg-white", tone === "light" && "ring-2 ring-deep ring-offset-1")}
                  title="Light"
                />
                <button
                  type="button"
                  onClick={() => setTone("sepia")}
                  className={cn("size-5 rounded-full bg-[#fbf0d9] border border-amber-300", tone === "sepia" && "ring-2 ring-deep ring-offset-1")}
                  title="Sepia"
                />
                <button
                  type="button"
                  onClick={() => setTone("dark")}
                  className={cn("size-5 rounded-full bg-[#18181b] border border-zinc-700", tone === "dark" && "ring-2 ring-deep ring-offset-1")}
                  title="Dark"
                />
              </div>
            </div>
          ) : (
            <span className="text-xs text-muted">Original HTML in secure sandbox</span>
          )}
        </div>

        {mode === "reader" ? (
          <div className={cn("max-h-[65vh] overflow-y-auto rounded-2xl p-8 transition-colors", toneClass)}>
            <div className={cn("mx-auto max-w-2xl space-y-4", fontClass, sizeClass)}>
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{record.title}</h1>
              {record.sourceDomain ? (
                <p className="text-xs uppercase tracking-widest opacity-70">
                  {record.sourceDomain} {record.capturedAt ? `· ${format(new Date(record.capturedAt), "MMMM d, yyyy")}` : ""}
                </p>
              ) : null}
              <hr className="my-6 border-line/50" />
              {rawTextParagraphs.length ? (
                rawTextParagraphs.map((item, idx) => {
                  if (item.tag.startsWith("h")) {
                    return <h3 key={idx} className="pt-3 text-lg font-bold">{item.text}</h3>;
                  }
                  if (item.tag === "blockquote") {
                    return <blockquote key={idx} className="border-l-4 border-line pl-4 italic opacity-85">{item.text}</blockquote>;
                  }
                  return <p key={idx}>{item.text}</p>;
                })
              ) : (
                <p className="italic opacity-60">No full article text preserved. View the archived page or check the original text snippet.</p>
              )}
            </div>
          </div>
        ) : (
          <iframe
            title="The page as it was"
            sandbox=""
            className="h-[65vh] w-full rounded-2xl border border-line bg-white shadow-inner"
            srcDoc={snapshotDocument}
          />
        )}
      </div>
    </Modal>
  );
}
