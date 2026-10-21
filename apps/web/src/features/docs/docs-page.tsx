import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy, FileText, History, MoreHorizontal, PenLine, Pin, Plus, RefreshCw, RotateCcw, Search, Star, Trash2, Wand2,
} from "lucide-react";
import { Button, Input, cn } from "@data-vault/ui";
import type { Note, NoteSummary } from "@data-vault/types";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../components/feedback";
import { Modal } from "../../components/feedback";
import { QueryState } from "../../components/data-state";
import { DocEditor } from "./doc-editor";
import { docToMarkdown } from "@data-vault/notes";
import { docToHtml } from "@data-vault/notes/html";
import type { JSONContent } from "@tiptap/core";

const ARRANGE_LABELS: Record<string, string> = {
  page: "By page",
  site: "By website",
  day: "By day",
  none: "Just append",
};

export function DocsPage() {
  const { id } = useParams();
  const { api, organization } = useAuth();
  const { notify } = useToast();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [organizePreview, setOrganizePreview] = useState<Array<{ title: string; clipIds: string[] }> | null>(null);
  const [organizePreviewId, setOrganizePreviewId] = useState<string | null>(null);
  const [writeUpOpen, setWriteUpOpen] = useState(false);
  const [writeUpPreview, setWriteUpPreview] = useState<Array<{ heading: string; paragraphs: string[] }> | null>(null);
  const [writeUpPreviewId, setWriteUpPreviewId] = useState<string | null>(null);
  const [writeUpTitle, setWriteUpTitle] = useState("");

  const list = useQuery({
    queryKey: ["notes", organization?.id, showTrash, term],
    queryFn: () => api.listNotes({ q: term || undefined, trash: showTrash || undefined, limit: 100 }),
  });
  const current = useQuery({
    queryKey: ["notes", "current", organization?.id],
    queryFn: () => api.currentNote(),
  });
  const note = useQuery({
    queryKey: ["note", organization?.id, id],
    queryFn: () => api.getNote(id!),
    enabled: Boolean(id),
  });

  const create = useMutation({
    mutationFn: () => api.createNote({ title: "Untitled doc" }),
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: ["notes"] });
      navigate(`/docs/${created.id}`);
    },
  });

  const makeCurrent = useMutation({
    mutationFn: (noteId: string) => api.setCurrentNote(noteId),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["notes", "current"] }),
        client.invalidateQueries({ queryKey: ["notes"] }),
      ]);
      notify("The extension will now add to this doc");
    },
  });

  const trash = useMutation({
    mutationFn: () => api.deleteNote(id!),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["notes"] });
      navigate("/docs");
      notify("Doc moved to Trash");
    },
  });

  const restore = useMutation({
    mutationFn: () => api.restoreNote(id!),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["notes"] });
      notify("Doc restored");
    },
  });

  const rearrange = useMutation({
    mutationFn: () => api.rearrangeNote(id!),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["note", organization?.id, id] });
      await client.invalidateQueries({ queryKey: ["notes"] });
      notify("The pieces were sorted again");
    },
    onError: (caught) => notify(caught instanceof Error ? caught.message : "The doc could not be sorted again.", "error"),
  });

  const writeUp = useMutation({
    mutationFn: (apply: boolean) => api.writeUpNote(id!, apply ? { apply: true, ...(writeUpPreviewId ? { previewId: writeUpPreviewId } : {}) } : {}),
    onSuccess: async (result) => {
      if (result.preview) {
        setWriteUpPreview(result.sections);
        setWriteUpTitle(result.title ?? "");
        setWriteUpPreviewId(result.previewId ?? null);
        setWriteUpOpen(true);
        return;
      }
      await client.invalidateQueries({ queryKey: ["note", organization?.id, id] });
      await client.invalidateQueries({ queryKey: ["notes"] });
      setWriteUpOpen(false);
      setWriteUpPreview(null);
      setWriteUpPreviewId(null);
      notify("The doc was written up");
    },
    onError: (caught) => notify(caught instanceof Error ? caught.message : "The doc could not be written up.", "error"),
  });

  const organize = useMutation({
    mutationFn: (apply: boolean) => api.organizeNote(id!, apply ? { apply: true, ...(organizePreviewId ? { previewId: organizePreviewId } : {}) } : {}),
    onSuccess: async (result) => {
      if (result.preview) {
        setOrganizePreview(result.sections);
        setOrganizePreviewId(result.previewId ?? null);
        setOrganizeOpen(true);
        return;
      }
      await client.invalidateQueries({ queryKey: ["note", organization?.id, id] });
      await client.invalidateQueries({ queryKey: ["notes"] });
      setOrganizeOpen(false);
      setOrganizePreview(null);
      setOrganizePreviewId(null);
      notify("The doc was sorted into topics");
    },
    onError: (caught) => notify(caught instanceof Error ? caught.message : "The AI could not sort this doc.", "error"),
  });

  const notes = list.data ?? [];
  const selected = note.data as Note | undefined;
  const firstNoteId = notes[0]?.id;

  /**
   * The doc that is open when the page is entered without one.
   *
   * The page used to show "Your docs live here" even when there were docs
   * waiting, which looked as though nothing had been saved. The doc the
   * browser extension adds to is opened first, because that is the one being
   * worked on, and the newest doc is opened when there is no current one.
   */
  useEffect(() => {
    if (id) return;
    if (showTrash) return;
    if (current.isLoading || list.isLoading) return;
    const target = current.data?.noteId ?? firstNoteId;
    if (!target) return;
    navigate(`/docs/${target}`, { replace: true });
  }, [id, showTrash, current.isLoading, current.data?.noteId, list.isLoading, firstNoteId, navigate]);

  /**
   * The doc is refetched every so often, so a clip added from the extension
   * shows up without the page being reloaded.
   */
  useEffect(() => {
    if (!id) return;
    const timer = window.setInterval(() => {
      void client.invalidateQueries({ queryKey: ["note", organization?.id, id] });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [client, id, organization?.id]);

  const isCurrent = current.data?.noteId === id;

  /**
   * The menu closes when the escape key is pressed and when the pointer
   * goes somewhere else, so it never sits over the page after it is done.
   */
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[role='menu']")) return;
      if (target?.closest("[aria-haspopup='menu']")) return;
      setMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [menuOpen]);

  const download = (content: JSONContent, format: "md" | "html") => {
    const title = selected?.title ?? "Doc";
    const body = format === "md" ? docToMarkdown(content) : docToHtml(content);
    const blob = new Blob([body], { type: format === "md" ? "text/markdown" : "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^\w-]+/g, "-").toLowerCase()}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const print = () => window.print();

  return (
    <div className="flex min-h-[calc(100vh-8rem)] gap-6">
      <aside className="hidden w-72 shrink-0 flex-col lg:flex">
        <div className="sticky top-24 flex max-h-[calc(100vh-7rem)] flex-col rounded-2xl border border-line bg-surface p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 size-4 text-muted" />
              <Input className="pl-9" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search your docs…" />
            </div>
            <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending} aria-label="New doc"><Plus className="size-4" /></Button>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs">
            <button onClick={() => setShowTrash(false)} className={cn("rounded-full px-2 py-1 font-medium", !showTrash ? "bg-soft text-ink" : "text-muted")}>Docs</button>
            <button onClick={() => setShowTrash(true)} className={cn("rounded-full px-2 py-1 font-medium", showTrash ? "bg-soft text-ink" : "text-muted")}>Trash</button>
          </div>

          <div className="mt-3 flex-1 space-y-1 overflow-y-auto">
            {notes.map((item) => (
              <DocListItem
                key={item.id}
                item={item}
                active={item.id === id}
                isCurrent={current.data?.noteId === item.id}
                onOpen={() => navigate(`/docs/${item.id}`)}
                onMakeCurrent={() => makeCurrent.mutate(item.id)}
              />
            ))}
            {!notes.length && !list.isLoading ? (
              <p className="px-2 py-6 text-center text-sm text-muted">
                {showTrash ? "The trash is empty." : "No docs yet. Press the plus button to start one."}
              </p>
            ) : null}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {id ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h1 className="display text-2xl">{selected?.title ?? "Doc"}</h1>
              <div className="relative ml-auto">
                <Button size="sm" variant="secondary" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-haspopup="menu">
                  <MoreHorizontal className="size-4" />Menu
                </Button>
                {menuOpen ? (
                  <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-64 rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
                    <MenuHeading>Arrange new clips by</MenuHeading>
                    {Object.entries(ARRANGE_LABELS).map(([value, label]) => (
                      <MenuItem key={value} active={selected?.arrangeMode === value} onClick={() => {
                        void api.updateNote(id, { arrangeMode: value }).then(async () => {
                          await client.invalidateQueries({ queryKey: ["note", organization?.id, id] });
                          notify(`New clips will be arranged ${label.toLowerCase()}`);
                        });
                        setMenuOpen(false);
                      }}>{label}</MenuItem>
                    ))}
                    <MenuDivider />
                    <MenuItem onClick={() => { void rearrange.mutate(); setMenuOpen(false); }}><RefreshCw className="size-4" />Re-arrange by page</MenuItem>
                    <MenuItem onClick={() => { void writeUp.mutate(false); setMenuOpen(false); }}><PenLine className="size-4" />Write it up as sentences</MenuItem>
                    <MenuItem onClick={() => { setOrganizePreview(null); organize.mutate(false); setMenuOpen(false); }}><Wand2 className="size-4" />Organize with AI</MenuItem>
                    <MenuItem onClick={() => { setHistoryOpen(true); setMenuOpen(false); }}><History className="size-4" />Version history</MenuItem>
                    <MenuDivider />
                    <MenuItem onClick={() => { download(selected?.content ?? { type: "doc" }, "md"); setMenuOpen(false); }}><Copy className="size-4" />Export as Markdown</MenuItem>
                    <MenuItem onClick={() => { download(selected?.content ?? { type: "doc" }, "html"); setMenuOpen(false); }}><FileText className="size-4" />Export as HTML</MenuItem>
                    <MenuItem onClick={() => { print(); setMenuOpen(false); }}><FileText className="size-4" />Print or save as PDF</MenuItem>
                    <MenuItem onClick={() => { void navigator.clipboard.writeText(docToMarkdown(selected?.content ?? { type: "doc" })); notify("The doc was copied as Markdown"); setMenuOpen(false); }}><Copy className="size-4" />Copy as Markdown</MenuItem>
                    <MenuDivider />
                    <MenuItem onClick={() => { void api.duplicateNote(id).then(async (copy) => { await client.invalidateQueries({ queryKey: ["notes"] }); notify("A copy was made"); navigate(`/docs/${copy.id}`); }); setMenuOpen(false); }}><Copy className="size-4" />Duplicate</MenuItem>
                    {selected?.deletedAt ? (
                      <MenuItem onClick={() => { restore.mutate(); setMenuOpen(false); }}><RotateCcw className="size-4" />Restore from Trash</MenuItem>
                    ) : (
                      <MenuItem danger onClick={() => { trash.mutate(); setMenuOpen(false); }}><Trash2 className="size-4" />Move to Trash</MenuItem>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <QueryState loading={note.isLoading} error={note.error} onRetry={() => note.refetch()} />
            {selected ? (
              <DocEditor
                key={selected.id}
                title={selected.title}
                icon={selected.icon}
                content={selected.content as JSONContent}
                version={selected.version}
                arrangeMode={selected.arrangeMode}
                isCurrent={Boolean(isCurrent)}
                onTitleChange={(title) => { void api.updateNote(id, { title }); }}
                onIconChange={(icon) => { void api.updateNote(id, { icon }); }}
                onSave={async (content, baseVersion) => {
                  const result = await api.updateNote(id, { content, baseVersion });
                  return result.version;
                }}
                onConflict={() => {
                  void client.invalidateQueries({ queryKey: ["note", organization?.id, id] });
                }}
                onMakeCurrent={() => makeCurrent.mutate(id)}
              />
            ) : null}
          </>
        ) : current.isLoading || list.isLoading ? (
          /**
           * The doc is being opened.
           *
           * The empty message is not shown while this is happening, because
           * it would flash up on the way to a doc that is really there.
           */
          <div className="grid min-h-[60vh] place-items-center">
            <p className="text-sm text-muted">Opening your doc…</p>
          </div>
        ) : (
          <div className="grid min-h-[60vh] place-items-center">
            <div className="max-w-md text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#b8a4ed]"><FileText className="size-6" /></span>
              <h2 className="mt-5 text-xl font-semibold">Your docs live here</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Select text on any page and press the shortcut to add it to a doc. New pieces are sorted into
                sections by page, website or day.
              </p>
              <Button className="mt-5" onClick={() => create.mutate()} disabled={create.isPending}>
                <Plus className="size-4" />New doc
              </Button>
            </div>
          </div>
        )}
      </div>

      <Modal open={historyOpen} title="Version history" onClose={() => setHistoryOpen(false)}>
        <VersionHistory
          noteId={id!}
          onRestore={async (revisionId) => {
            await api.restoreNoteRevision(id!, revisionId);
            await client.invalidateQueries({ queryKey: ["note", organization?.id, id] });
            await client.invalidateQueries({ queryKey: ["notes"] });
            setHistoryOpen(false);
            notify("That version was restored");
          }}
        />
      </Modal>

      <Modal open={writeUpOpen} title="Write it up as sentences" onClose={() => setWriteUpOpen(false)} width="max-w-2xl">
        <p className="text-sm leading-6 text-muted">
          The pieces are joined into sentences that follow each other, and the sentences that belong together are put
          in the same paragraph. Nothing has changed yet.
        </p>
        {writeUpTitle ? <p className="mt-3 font-semibold">{writeUpTitle}</p> : null}
        <div className="mt-3 max-h-80 space-y-4 overflow-y-auto rounded-2xl bg-soft p-4">
          {(writeUpPreview ?? []).map((section) => (
            <div key={section.heading || section.paragraphs[0]}>
              {section.heading ? <p className="mb-1 font-semibold">{section.heading}</p> : null}
              {section.paragraphs.map((paragraph) => <p key={paragraph.slice(0, 40)} className="mb-2 text-sm leading-6 last:mb-0">{paragraph}</p>)}
            </div>
          ))}
        </div>
        <div className="mt-5 flex gap-2">
          <Button onClick={() => writeUp.mutate(true)} disabled={writeUp.isPending}>{writeUp.isPending ? "Working…" : "Use this writing"}</Button>
          <Button variant="secondary" onClick={() => setWriteUpOpen(false)}>Keep it as it is</Button>
        </div>
      </Modal>

      <Modal open={organizeOpen} title="Sort this doc into topics" onClose={() => setOrganizeOpen(false)}>
        <p className="text-sm text-muted">The AI read every piece and grouped them. Nothing has changed yet.</p>
        <ul className="mt-4 space-y-2">
          {(organizePreview ?? []).map((section) => (
            <li key={section.title} className="rounded-xl bg-soft p-3">
              <p className="font-semibold">{section.title}</p>
              <p className="text-xs text-muted">{section.clipIds.length} {section.clipIds.length === 1 ? "piece" : "pieces"}</p>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex gap-2">
          <Button onClick={() => organize.mutate(true)} disabled={organize.isPending}>{organize.isPending ? "Working…" : "Apply this order"}</Button>
          <Button variant="secondary" onClick={() => setOrganizeOpen(false)}>Keep it as it is</Button>
        </div>
      </Modal>
    </div>
  );
}

function DocListItem({ item, active, isCurrent, onOpen, onMakeCurrent }: { item: NoteSummary; active: boolean; isCurrent: boolean; onOpen: () => void; onMakeCurrent: () => void }) {
  return (
    <div className={cn("group flex items-start gap-1 rounded-xl", active ? "bg-soft" : "hover:bg-soft")}>
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left">
        <span className="mt-0.5 text-base">{item.icon ?? "📄"}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{item.title}</span>
            {item.isPinned ? <Pin className="size-3 shrink-0 text-muted" /> : null}
          </span>
          <span className="block truncate text-xs text-muted">{item.excerpt || "Empty doc"}</span>
        </span>
      </button>
      {/**
       * The doc the extension shortcut adds to. It is marked here so it can
       * be chosen without opening the doc first.
       */}
      <button
        onClick={onMakeCurrent}
        title={isCurrent ? "This is the doc the extension adds to" : "Use as the doc the extension adds to"}
        aria-label={isCurrent ? `${item.title} is the current doc` : `Make ${item.title} the current doc`}
        aria-pressed={isCurrent}
        className={cn("mr-1 mt-2 grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft", isCurrent ? "text-deep-text" : "opacity-0 group-hover:opacity-100")}
      >
        <Star className={cn("size-3.5", isCurrent && "fill-current")} />
      </button>
    </div>
  );
}

function MenuHeading({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-[.12em] text-muted">{children}</p>;
}

function MenuDivider() {
  return <span className="my-1 block h-px bg-line" aria-hidden />;
}

function MenuItem({ children, onClick, active, danger }: { children: React.ReactNode; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-soft", active && "bg-soft", danger && "text-red-700 dark:text-red-300")}>
      {children}
    </button>
  );
}

function VersionHistory({ noteId, onRestore }: { noteId: string; onRestore: (revisionId: string) => Promise<void> }) {
  const { api } = useAuth();
  const query = useQuery({ queryKey: ["note", "revisions", noteId], queryFn: () => api.listNoteRevisions(noteId) });
  const revisions = useMemo(() => query.data ?? [], [query.data]);
  if (query.isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (!revisions.length) return <p className="text-sm text-muted">There are no earlier versions yet.</p>;
  return (
    <ul className="space-y-2">
      {revisions.map((revision) => (
        <li key={revision.id} className="flex items-center gap-3 rounded-xl bg-soft p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{revision.title}</p>
            <p className="text-xs text-muted">Version {revision.version} · {new Date(revision.createdAt).toLocaleString()}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void onRestore(revision.id)}><RotateCcw className="size-3.5" />Restore</Button>
        </li>
      ))}
    </ul>
  );
}

