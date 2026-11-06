import { useEffect, useMemo, useState } from "react";
import { browser } from "wxt/browser";
import { generateHTML } from "@tiptap/core";
import { markInlineClips, noteExtensions } from "@data-vault/notes";
import { ExternalLink, FileText, Plus, RotateCcw, Search, Star, Undo2 } from "lucide-react";
import { Button, Input, cn } from "@data-vault/ui";
import type { NoteSummary } from "@data-vault/types";
import { WEB_URL, withOrganization } from "../lib/api";
import { addClipToCurrentDoc, makeCurrentDoc, refreshCurrentDoc, removeClipFromDoc, renameDoc, startNewDoc } from "../lib/docs";
import { EditableTitle } from "./editable-title";

/**
 * The docs panel.
 *
 * It shows the current doc so it can be read without leaving the browser,
 * and it can add a short note to it without any ceremony.
 */
export function DocsView({ onSignedOut }: { onSignedOut?: () => void }) {
  const [docs, setDocs] = useState<NoteSummary[]>([]);
  const [current, setCurrent] = useState<{ noteId: string | null; title?: string | null; clipCount?: number }>({ noteId: null });
  const [currentDoc, setCurrentDoc] = useState<NoteSummary | undefined>();
  const [currentHtml, setCurrentHtml] = useState("");
  const [body, setBody] = useState("");
  const [term, setTerm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastClip, setLastClip] = useState<{ noteId: string; clipId: string } | null>(null);

  /**
   * The doc, rendered the same way the website renders it.
   *
   * The extension only reads a doc. Writing is done on the website, where
   * the full editor lives.
   */
  const extensions = useMemo(() => noteExtensions(), []);

  const load = async () => {
    try {
      const [list, answer] = await Promise.all([
        withOrganization((api) => api.listNotes({ limit: 50 })),
        withOrganization((api) => api.currentNote()),
      ]);
      setDocs(list);
      setCurrent(answer);
      setCurrentDoc(list.find((item) => item.id === answer.noteId));
      const noteId = answer.noteId;
      if (noteId) {
        const full = await withOrganization((api) => api.getNote(noteId));
        /**
         * The pieces whose source the heading above already names are shown as
         * plain text, so the same link is not written again and again.
         */
        setCurrentHtml(generateHTML(markInlineClips(full.content as never) as never, extensions));
      } else {
        setCurrentHtml("");
      }      await refreshCurrentDoc();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your docs could not be loaded.");
      onSignedOut?.();
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const quickAdd = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const result = await addClipToCurrentDoc({
        text,
        source: { title: "A note typed in the side panel", domain: "datavault" },
        capturedAt: new Date().toISOString(),
      });
      setBody("");
      setLastClip({ noteId: result.noteId, clipId: result.clipId });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That note could not be added.");
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!lastClip) return;
    try {
      await removeClipFromDoc(lastClip.noteId, lastClip.clipId);
      setLastClip(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That note could not be taken back out.");
    }
  };

  const newDoc = async () => {
    setBusy(true);
    setError("");
    try {
      await startNewDoc();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A new doc could not be started.");
    } finally {
      setBusy(false);
    }
  };

  const choose = async (noteId: string) => {
    try {
      await makeCurrentDoc(noteId);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That doc could not be chosen.");
    }
  };

  const visible = term.trim()
    ? docs.filter((doc) => doc.title.toLowerCase().includes(term.trim().toLowerCase()))
    : docs;

  return (
    <div className="p-4">
      <div className="rounded-2xl bg-deep p-4 text-white">
        <p className="text-xs font-semibold uppercase tracking-[.13em] text-on-deep">Current doc</p>
        <EditableTitle
          title={current.title ?? "No doc yet"}
          disabled={!current.noteId}
          className="mt-1"
          onSave={(title) => {
            if (!current.noteId) return;
            void renameDoc(current.noteId, title)
              .then(() => load())
              .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "The doc could not be renamed."));
          }}
        />
        <p className="mt-0.5 text-xs text-white/70">
          {currentDoc ? `${currentDoc.clipCount} ${currentDoc.clipCount === 1 ? "piece" : "pieces"}` : "The first clip makes one."}
        </p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => void newDoc()} disabled={busy}><Plus className="size-3.5" />New doc</Button>
          {current.noteId ? (
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => void browser.tabs.create({ url: `${WEB_URL}/docs/${current.noteId}` })}>Open</Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="quick-add" className="text-xs font-semibold uppercase tracking-[.13em] text-muted">Quick add</label>
        <textarea
          id="quick-add"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          placeholder="Type a thought and add it to the doc…"
          className="mt-2 w-full rounded-xl border border-line-strong bg-surface p-3 text-sm outline-none focus:border-deep"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button size="sm" disabled={busy || !body.trim()} onClick={() => void quickAdd()}>{busy ? "Adding…" : "Add to doc"}</Button>
          <Button size="sm" variant="secondary" disabled={!lastClip} onClick={() => void undo()}><Undo2 className="size-3.5" />Undo last</Button>
        </div>
      </div>

      {currentHtml ? (
        <details className="mt-4 rounded-2xl border border-line bg-surface p-3" open>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[.13em] text-muted">Read the doc</summary>
          <div className="datavault-prose mt-3 text-sm" dangerouslySetInnerHTML={{ __html: currentHtml }} />
        </details>
      ) : null}

      {error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}

      <div className="mt-5">
        <div className="relative">
          <Search className="absolute left-3 top-3 size-4 text-muted" />
          <Input className="pl-9" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Find a doc…" />
        </div>
        <ul className="mt-3 space-y-1">
          {visible.map((doc) => (
            <li key={doc.id} className="flex items-center gap-1">
              <button
                onClick={() => void choose(doc.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-soft"
                title={doc.id === current.noteId ? "This is the current doc" : "Make this the current doc"}
              >
                <span className="text-base">{doc.icon ?? "📄"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{doc.title}</span>
                  <span className="block truncate text-xs text-muted">{doc.clipCount} pieces</span>
                </span>
              </button>
              {/**
               * The doc the shortcut adds to. It is marked here so it can be
               * chosen without opening anything.
               */}
              <button
                onClick={() => void choose(doc.id)}
                title={doc.id === current.noteId ? "This is the current doc" : "Make this the current doc"}
                aria-label={doc.id === current.noteId ? `${doc.title} is the current doc` : `Make ${doc.title} the current doc`}
                aria-pressed={doc.id === current.noteId}
                className={cn("grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft", doc.id === current.noteId ? "text-deep" : "opacity-60")}
              >
                <Star className={cn("size-3.5", doc.id === current.noteId && "fill-current")} />
              </button>
              <button
                onClick={() => void browser.tabs.create({ url: `${WEB_URL}/docs/${doc.id}` })}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft"
                title="Open in DataVault"
                aria-label={`Open ${doc.title} in DataVault`}
              >
                <ExternalLink className="size-3.5" />
              </button>
            </li>
          ))}
          {!visible.length ? (
            <li className="flex items-center gap-2 px-2 py-4 text-sm text-muted"><FileText className="size-4" />No docs yet.</li>
          ) : null}
        </ul>
      </div>

      {lastClip ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted">
          <RotateCcw className="size-3.5" />The last note can still be taken back out.
        </p>
      ) : null}
    </div>
  );
}
