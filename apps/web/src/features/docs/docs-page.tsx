import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import {
  CheckSquare, ChevronDown, Copy, FilePlus2, FileText, HelpCircle, History,
  MessageCircle, MoreHorizontal, Plus, Quote, RefreshCw, RotateCcw, Search, Sparkles, Trash2, Wand2,
} from "lucide-react";
import { Button, Input, cn } from "@data-vault/ui";
import type { AiBlock, Note, NoteChatTurn, NoteNotesSection, NoteSummaryDetail } from "@data-vault/types";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../components/feedback";
import { Modal } from "../../components/feedback";
import { QueryState } from "../../components/data-state";
import { DocEditor } from "./doc-editor";
import { DocTree } from "./doc-tree";
import { DocSummaryModal } from "./doc-summary-modal";
import { DocRearrangeModal } from "./doc-rearrange-modal";
import { DocChatDrawer } from "./doc-chat-drawer";
import { DocQaModal } from "./doc-qa-modal";
import { blocksToContent, clipNodesInDoc } from "../../lib/ai-selection";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState<{ id: string; title: string } | null>(null);

  // Active Editor instance
  const [editor, setEditor] = useState<Editor | null>(null);

  // AI Feature State
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryData, setSummaryData] = useState<NoteSummaryDetail | null>(null);

  const [rearrangeOpen, setRearrangeOpen] = useState(false);
  const [rearrangeSections, setRearrangeSections] = useState<NoteNotesSection[]>([]);
  const [rearrangePreviewId, setRearrangePreviewId] = useState<string | null>(null);
  const [rearrangeTitle, setRearrangeTitle] = useState("");

  const [chatOpen, setChatOpen] = useState(false);

  const [qaOpen, setQaOpen] = useState(false);
  const [qaBlocks, setQaBlocks] = useState<AiBlock[]>([]);
  const [qaLoading, setQaLoading] = useState(false);

  const list = useQuery({
    queryKey: ["notes", organization?.id, term],
    queryFn: () => api.listNotes({ q: term || undefined, limit: 100 }),
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

  const createSubpage = useMutation({
    mutationFn: (parentId: string) => api.createNote({ title: "Untitled doc", parentId }),
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: ["notes"] });
      navigate(`/docs/${created.id}`);
      notify("A new doc was made inside it");
    },
    onError: (caught) => notify(caught instanceof Error ? caught.message : "The doc could not be made.", "error"),
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

  const deleteDoc = useMutation({
    mutationFn: (targetId: string) => api.deleteNote(targetId, { permanent: true }),
    onSuccess: async (_, targetId) => {
      await client.invalidateQueries({ queryKey: ["notes"] });
      if (id === targetId) {
        navigate("/docs");
      }
      notify("Doc deleted");
    },
    onError: (caught) => notify(caught instanceof Error ? caught.message : "The doc could not be deleted.", "error"),
  });

  const rearrangeClips = useMutation({
    mutationFn: () => api.rearrangeNote(id!),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["note", organization?.id, id] });
      await client.invalidateQueries({ queryKey: ["notes"] });
      notify("The pieces were sorted again");
    },
    onError: (caught) => notify(caught instanceof Error ? caught.message : "The doc could not be sorted again.", "error"),
  });

  // AI 1: Summary
  const summaryMutation = useMutation({
    mutationFn: () => api.summarizeNote(id!),
    onSuccess: (data) => {
      setSummaryData(data);
    },
    onError: (caught) => notify(caught instanceof Error ? caught.message : "Could not summarize doc.", "error"),
  });

  const handleOpenSummary = () => {
    if (!id) return;
    setSummaryOpen(true);
    setSummaryData(null);
    summaryMutation.mutate();
  };

  // AI 2: Re-arrange into Notes
  const rearrangeMutation = useMutation({
    mutationFn: () => api.notesFromNote(id!),
    onSuccess: (result) => {
      setRearrangeSections(result.sections);
      setRearrangeTitle(result.title ?? "");
      setRearrangePreviewId(result.previewId ?? null);
    },
    onError: (caught) => notify(caught instanceof Error ? caught.message : "Could not re-arrange doc.", "error"),
  });

  const handleOpenRearrange = () => {
    if (!id) return;
    setRearrangeOpen(true);
    setRearrangeSections([]);
    setRearrangePreviewId(null);
    rearrangeMutation.mutate();
  };

  const handleApplyRearrange = async (target: "replace" | "subpage") => {
    if (!id || !rearrangePreviewId) return;
    const result = await api.notesFromNote(id, {
      apply: true,
      previewId: rearrangePreviewId,
      target,
    });
    if (target === "subpage" && result.subpageId) {
      await client.invalidateQueries({ queryKey: ["notes"] });
      navigate(`/docs/${result.subpageId}`);
      notify("Notes saved to a new subpage");
    } else {
      await client.invalidateQueries({ queryKey: ["note", organization?.id, id] });
      notify("Doc reorganized into notes");
    }
  };

  // AI 3: Doc AI Chat
  const handleAskChat = async (question: string, history: NoteChatTurn[]) => {
    if (!id) throw new Error("No doc is selected.");
    return api.noteAiChat(id, { question, history });
  };

  const handleInsertBlocks = (blocks: AiBlock[]) => {
    if (!editor) {
      notify("Editor is not ready", "error");
      return;
    }
    const clips = clipNodesInDoc(editor);
    const content = blocksToContent(blocks, clips);
    const insertPos = editor.state.selection.to;
    editor.chain().focus().insertContentAt(insertPos, content).run();
  };

  // AI 4: Extract Action Items Checklist
  const handleExtractTasks = async () => {
    if (!id || !editor) return;
    notify("Extracting action items…");
    try {
      const res = await api.noteAiChat(id, {
        question: "Extract all action items, tasks, deadlines, and follow-ups from this document as a checklist block. Be direct and concise.",
      });
      const clips = clipNodesInDoc(editor);
      const content = blocksToContent(res.blocks, clips);
      editor.chain().focus().insertContentAt(0, content).run();
      notify("Action items added to top of doc");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not extract action items", "error");
    }
  };

  // AI 5: Insert TL;DR Callout
  const handleInsertTldr = async () => {
    if (!id || !editor) return;
    notify("Writing TL;DR callout…");
    try {
      const res = await api.noteAiChat(id, {
        question: "Write an executive 2-sentence key takeaway of this document as a quote block. Start with 'Key Takeaway:'.",
      });
      const clips = clipNodesInDoc(editor);
      const content = blocksToContent(res.blocks, clips);
      editor.chain().focus().insertContentAt(0, content).run();
      notify("TL;DR callout inserted at top");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not generate TL;DR", "error");
    }
  };

  // AI 6: Q&A Flashcards
  const handleOpenQa = async () => {
    if (!id) return;
    setQaOpen(true);
    setQaBlocks([]);
    setQaLoading(true);
    try {
      const res = await api.noteAiChat(id, {
        question: "Create 5 key study questions with answers based on this document. Use headings for each question and paragraphs for answers.",
      });
      setQaBlocks(res.blocks);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not generate Q&A", "error");
    } finally {
      setQaLoading(false);
    }
  };

  // Subpage save helper
  const handleSaveSubpageDoc = async (content: JSONContent, title: string) => {
    if (!id) return;
    const created = await api.createNote({ title, parentId: id, content });
    await client.invalidateQueries({ queryKey: ["notes"] });
    navigate(`/docs/${created.id}`);
    notify("Saved as subpage");
  };

  const notes_ = list.data ?? [];
  const selected = note.data as Note | undefined;
  const firstNoteId = notes_[0]?.id;

  useEffect(() => {
    if (id) return;
    if (current.isLoading || list.isLoading) return;
    const target = current.data?.noteId ?? firstNoteId;
    if (!target) return;
    navigate(`/docs/${target}`, { replace: true });
  }, [id, current.isLoading, current.data?.noteId, list.isLoading, firstNoteId, navigate]);

  useEffect(() => {
    if (!id) return;
    const timer = window.setInterval(() => {
      void client.invalidateQueries({ queryKey: ["note", organization?.id, id] });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [client, id, organization?.id]);

  const isCurrent = current.data?.noteId === id;

  useEffect(() => {
    if (!menuOpen && !aiMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setAiMenuOpen(false);
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[role='menu']")) return;
      if (target?.closest("[aria-haspopup='menu']")) return;
      setMenuOpen(false);
      setAiMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [menuOpen, aiMenuOpen]);

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

          <div className="mt-3 flex-1 space-y-1 overflow-y-auto">
            <DocTree
              notes={notes_}
              activeId={id}
              currentId={current.data?.noteId ?? undefined}
              onOpen={(noteId) => navigate(`/docs/${noteId}`)}
              onMakeCurrent={(noteId) => makeCurrent.mutate(noteId)}
              onNewSubpage={(parentId) => createSubpage.mutate(parentId)}
              onDelete={(noteId, title) => setDocToDelete({ id: noteId, title })}
            />
            {!notes_.length && !list.isLoading ? (
              <p className="px-2 py-6 text-center text-sm text-muted">
                No docs yet. Press the plus button to start one.
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
              <div className="relative ml-auto flex items-center gap-2">
                {/* Ask AI Chat button */}
                <Button
                  size="sm"
                  variant={chatOpen ? "primary" : "secondary"}
                  onClick={() => setChatOpen((open) => !open)}
                  className="flex items-center gap-1.5"
                >
                  <MessageCircle className="size-3.5 text-purple-600 dark:text-purple-400" />
                  <span>Ask AI</span>
                </Button>

                {/* AI Tools dropdown */}
                <div className="relative">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setAiMenuOpen((open) => !open)}
                    className="flex items-center gap-1.5 border-purple-200 dark:border-purple-800"
                    aria-expanded={aiMenuOpen}
                    aria-haspopup="menu"
                  >
                    <Sparkles className="size-3.5 text-purple-600 dark:text-purple-400" />
                    <span>AI Tools</span>
                    <ChevronDown className="size-3 text-muted" />
                  </Button>
                  {aiMenuOpen ? (
                    <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-64 rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
                      <MenuHeading>Document AI</MenuHeading>
                      <MenuItem onClick={() => { handleOpenSummary(); setAiMenuOpen(false); }}>
                        <FileText className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        <div className="min-w-0">
                          <span className="block font-medium">Summarize doc</span>
                          <span className="block text-xs text-muted">Key takeaways & subpage export</span>
                        </div>
                      </MenuItem>
                      <MenuItem onClick={() => { handleOpenRearrange(); setAiMenuOpen(false); }}>
                        <Wand2 className="size-4 text-purple-600 dark:text-purple-400 shrink-0" />
                        <div className="min-w-0">
                          <span className="block font-medium">Re-arrange into Notes</span>
                          <span className="block text-xs text-muted">Clean structure, exact facts</span>
                        </div>
                      </MenuItem>
                      <MenuDivider />
                      <MenuItem onClick={() => { void handleExtractTasks(); setAiMenuOpen(false); }}>
                        <CheckSquare className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <div className="min-w-0">
                          <span className="block font-medium">Extract action items</span>
                          <span className="block text-xs text-muted">Generate task checklist</span>
                        </div>
                      </MenuItem>
                      <MenuItem onClick={() => { void handleInsertTldr(); setAiMenuOpen(false); }}>
                        <Quote className="size-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <div className="min-w-0">
                          <span className="block font-medium">Insert TL;DR callout</span>
                          <span className="block text-xs text-muted">2-sentence top summary</span>
                        </div>
                      </MenuItem>
                      <MenuItem onClick={() => { void handleOpenQa(); setAiMenuOpen(false); }}>
                        <HelpCircle className="size-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        <div className="min-w-0">
                          <span className="block font-medium">Q&A study cards</span>
                          <span className="block text-xs text-muted">Review questions & answers</span>
                        </div>
                      </MenuItem>
                    </div>
                  ) : null}
                </div>

                {/* More Menu */}
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
                    <MenuItem onClick={() => { handleOpenRearrange(); setMenuOpen(false); }}><Wand2 className="size-4 text-purple-600" />Re-arrange into Notes</MenuItem>
                    <MenuItem onClick={() => { handleOpenSummary(); setMenuOpen(false); }}><FileText className="size-4 text-amber-600" />Summarize doc</MenuItem>
                    <MenuItem onClick={() => { void rearrangeClips.mutate(); setMenuOpen(false); }}><RefreshCw className="size-4" />Re-arrange by page</MenuItem>
                    <MenuItem onClick={() => { void createSubpage.mutate(id); setMenuOpen(false); }}><FilePlus2 className="size-4" />New subpage</MenuItem>
                    <MenuItem onClick={() => { setHistoryOpen(true); setMenuOpen(false); }}><History className="size-4" />Version history</MenuItem>
                    <MenuDivider />
                    <MenuItem onClick={() => { download(selected?.content ?? { type: "doc" }, "md"); setMenuOpen(false); }}><Copy className="size-4" />Export as Markdown</MenuItem>
                    <MenuItem onClick={() => { download(selected?.content ?? { type: "doc" }, "html"); setMenuOpen(false); }}><FileText className="size-4" />Export as HTML</MenuItem>
                    <MenuItem onClick={() => { print(); setMenuOpen(false); }}><FileText className="size-4" />Print or save as PDF</MenuItem>
                    <MenuItem onClick={() => { void navigator.clipboard.writeText(docToMarkdown(selected?.content ?? { type: "doc" })); notify("The doc was copied as Markdown"); setMenuOpen(false); }}><Copy className="size-4" />Copy as Markdown</MenuItem>
                    <MenuDivider />
                    <MenuItem onClick={() => { void api.duplicateNote(id).then(async (copy) => { await client.invalidateQueries({ queryKey: ["notes"] }); notify("A copy was made"); navigate(`/docs/${copy.id}`); }); setMenuOpen(false); }}><Copy className="size-4" />Duplicate</MenuItem>
                    <MenuItem danger onClick={() => { setDocToDelete({ id, title: selected?.title ?? "Untitled doc" }); setMenuOpen(false); }}><Trash2 className="size-4" />Delete doc</MenuItem>
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
                noteId={selected.id}
                onTitleChange={(title) => { void api.updateNote(id, { title }); }}
                onIconChange={(icon) => { void api.updateNote(icon ? id : id, { icon }); }}
                onSave={async (content, baseVersion) => {
                  const result = await api.updateNote(id, { content, baseVersion });
                  return result.version;
                }}
                onConflict={() => {
                  void client.invalidateQueries({ queryKey: ["note", organization?.id, id] });
                }}
                onMakeCurrent={() => makeCurrent.mutate(id)}
                onEditorReady={(ed) => setEditor(ed)}
              />
            ) : null}
          </>
        ) : current.isLoading || list.isLoading ? (
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

      {/* Doc AI Chat Drawer */}
      <DocChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        noteTitle={selected?.title ?? "Doc"}
        onAsk={handleAskChat}
        onInsertToDoc={handleInsertBlocks}
        onNotify={notify}
      />

      {/* AI Summary Modal */}
      <DocSummaryModal
        open={summaryOpen}
        data={summaryData}
        loading={summaryMutation.isPending && !summaryData}
        error={summaryMutation.error instanceof Error ? summaryMutation.error.message : null}
        onClose={() => setSummaryOpen(false)}
        onRegenerate={() => {
          setSummaryData(null);
          summaryMutation.mutate();
        }}
        onSaveSubpage={handleSaveSubpageDoc}
        onNotify={notify}
      />

      {/* AI Re-arrange Modal */}
      <DocRearrangeModal
        open={rearrangeOpen}
        loading={rearrangeMutation.isPending && !rearrangeSections.length}
        error={rearrangeMutation.error instanceof Error ? rearrangeMutation.error.message : null}
        title={rearrangeTitle}
        sections={rearrangeSections}
        onClose={() => setRearrangeOpen(false)}
        onApply={handleApplyRearrange}
        onRegenerate={() => {
          setRearrangeSections([]);
          setRearrangePreviewId(null);
          rearrangeMutation.mutate();
        }}
        onNotify={notify}
      />

      {/* AI Q&A Flashcards Modal */}
      <DocQaModal
        open={qaOpen}
        loading={qaLoading}
        blocks={qaBlocks}
        noteTitle={selected?.title ?? "Doc"}
        onClose={() => setQaOpen(false)}
        onRegenerate={() => void handleOpenQa()}
        onInsertToDoc={handleInsertBlocks}
        onSaveSubpage={handleSaveSubpageDoc}
        onNotify={notify}
      />

      {/* Version History Modal */}
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

      {/* Delete Confirmation Modal */}
      <Modal open={Boolean(docToDelete)} title="Delete doc" onClose={() => setDocToDelete(null)}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Are you sure you want to delete <strong className="text-ink">{docToDelete?.title || "this doc"}</strong>? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDocToDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (docToDelete) {
                  deleteDoc.mutate(docToDelete.id);
                  setDocToDelete(null);
                }
              }}
              disabled={deleteDoc.isPending}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
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
