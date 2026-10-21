import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Check, LoaderCircle, Sparkles, X } from "lucide-react";
import { Button, Input, cn } from "@data-vault/ui";
import type { AiBlock, NoteAiAction, NoteAiContextMode } from "@data-vault/types";
import { useAuth } from "../../lib/auth";
import { blocksToContent, clipNodes, estimateTokens, selectionPayload } from "../../lib/ai-selection";
import { useAiCredits } from "../../components/ai-panel";

/**
 * The AI, on a selection.
 *
 * The person selects something, says what should be done with it, and the
 * answer is shown before anything is written. A change is never made
 * behind their back, and the answer is never a link or a picture.
 */

/**
 * The actions that are offered.
 */
const ACTIONS: { id: NoteAiAction; label: string }[] = [
  { id: "arrange", label: "Arrange" },
  { id: "table", label: "Table" },
  { id: "list", label: "List" },
  { id: "checklist", label: "Checklist" },
  { id: "summarize", label: "Summarize" },
  { id: "complete", label: "Complete" },
  { id: "clean-up", label: "Clean up" },
  { id: "translate", label: "Translate" },
  { id: "custom", label: "Ask…" },
];

/**
 * The ways the AI is allowed to use.
 */
const CONTEXTS: { id: NoteAiContextMode; label: string; hint: string }[] = [
  { id: "selection", label: "Only my selection", hint: "Nothing is added that is not in the selection." },
  { id: "knowledge", label: "+ AI knowledge", hint: "The AI may fill the gaps, and says which parts it added." },
  { id: "sources", label: "+ Saved items", hint: "The AI may use the saved items you pick." },
];

interface DocAiValue {
  /** Open the assistant for a part of the doc. */
  openAi: (range?: { from: number; to: number }) => void;
  noteId: string | undefined;
  /** True when there is something to work with. */
  ready: boolean;
}

const DocAiContext = createContext<DocAiValue | null>(null);

/**
 * The assistant, from the menus that open it.
 */
export function useDocAi(): DocAiValue {
  const value = useContext(DocAiContext);
  if (!value) throw new Error("Missing DocAiContext");
  return value;
}

interface DocAiProviderProps {
  noteId: string | undefined;
  editor: Editor | null;
  children: ReactNode;
}

export function DocAiProvider({ noteId, editor, children }: DocAiProviderProps) {
  const { api } = useAuth();
  const credits = useAiCredits();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [action, setAction] = useState<NoteAiAction>("arrange");
  const [instruction, setInstruction] = useState("");
  const [mode, setMode] = useState<NoteAiContextMode>("selection");
  const [chosen, setChosen] = useState<string[]>([]);
  const [answer, setAnswer] = useState<AiBlock[] | null>(null);
  const [error, setError] = useState("");
  /**
   * The text that was sent, and whether it has changed since.
   *
   * A person may type while the model is thinking. When the text has
   * changed, the answer is only offered below the selection, because
   * replacing it would throw away what they have just written.
   */
  const [sent, setSent] = useState("");
  const [changed, setChanged] = useState(false);

  const openAi = useCallback((next?: { from: number; to: number }) => {
    if (!editor) return;
    let selection = next ?? { from: editor.state.selection.from, to: editor.state.selection.to };
    if (selection.from === selection.to) {
      /**
       * Nothing is selected, so the whole block is used. That is what the
       * slash command means when nothing is highlighted.
       */
      const { $from } = editor.state.selection;
      selection = { from: $from.start(), to: $from.end() };
    }
    setRange(selection);
    setAnswer(null);
    setError("");
    setOpen(true);
  }, [editor]);

  const value = useMemo<DocAiValue>(() => ({ openAi, noteId, ready: Boolean(noteId && editor) }), [openAi, noteId, editor]);

  /**
   * The request.
   *
   * The selection is taken when the button is pressed, not when the panel
   * opened, so that the answer is made of what the person is looking at.
   */
  const run = useMutation({
    mutationFn: async () => {
      if (!editor || !range || !noteId) throw new Error("There is nothing to work with.");
      const selection = selectionPayload(editor, range.from, range.to);
      if (!selection.markdown.trim()) throw new Error("Select some text first.");
      setSent(selection.markdown);
      return api.noteAiSelection(noteId, {
        action,
        ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
        selection,
        context: { mode, recordIds: mode === "sources" ? chosen : [] },
      });
    },
    onSuccess: (result) => {
      setAnswer(result.blocks);
      setError("");
      /**
       * The text may have changed while the model was thinking, and the
       * answer is about the text that was sent.
       */
      if (editor && range) {
        setChanged(selectionPayload(editor, range.from, range.to).markdown !== sent);
      }
    },
    onError: (caught) => {
      setAnswer(null);
      setError(caught instanceof Error ? caught.message : "That did not work.");
    },
  });

  /**
   * The answer is written into the doc in one step, so that a single undo
   * takes it back out.
   */
  const accept = (where: "replace" | "below") => {
    if (!editor || !range || !answer) return;
    const clips = clipNodes(editor, range.from, range.to);
    const content = blocksToContent(answer, clips);
    if (where === "replace") {
      editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, content).run();
    } else {
      editor.chain().focus().insertContentAt(range.to, content).run();
    }
    setOpen(false);
    setAnswer(null);
  };

  /**
   * Where the panel is put.
   *
   * It sits under the selection, the way a suggestion does.
   */
  const position = useMemo(() => {
    if (!editor || !range) return { top: 0, left: 0 };
    const coordinates = editor.view.coordsAtPos(range.from);
    return { top: coordinates.bottom + 8, left: coordinates.left };
  }, [editor, range]);

  const own = credits.data?.ownConnection;
  const ready = Boolean(noteId && editor);
  const estimate = range && editor ? estimateTokens(selectionPayload(editor, range.from, range.to).markdown) : 0;

  return (
    <DocAiContext.Provider value={value}>
      {children}
      {open && ready ? (
        <div
          style={{ top: position.top, left: position.left }}
          className="fixed z-50 w-[420px] max-w-[92vw] rounded-2xl border border-line bg-surface p-3 shadow-xl"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-muted">
              <Sparkles className="size-3.5" />AI
            </p>
            <button onClick={() => setOpen(false)} className="text-muted hover:text-ink" aria-label="Close the AI panel">
              <X className="size-4" />
            </button>
          </div>

          {!own && !credits.data?.available ? (
            <div className="mt-3 rounded-xl bg-soft p-3 text-sm text-strong">
              <p>The AI is not switched on for this server yet. Connect a key of your own and it will be used instead.</p>
              <Link to="/settings" className="mt-2 inline-block font-medium underline">Open Settings</Link>
            </div>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ACTIONS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => { setAction(entry.id); setAnswer(null); }}
                    className={cn("rounded-lg px-2.5 py-1 text-xs font-medium", action === entry.id ? "bg-deep text-white" : "bg-soft text-strong hover:bg-hover")}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              {action === "custom" || action === "translate" ? (
                <Input
                  className="mt-2"
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder={action === "translate" ? "Translate into…" : "What should the AI do?"}
                />
              ) : null}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {CONTEXTS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    title={entry.hint}
                    onClick={() => { setMode(entry.id); setAnswer(null); }}
                    className={cn("rounded-lg px-2.5 py-1 text-xs font-medium", mode === entry.id ? "bg-soft text-ink" : "text-muted hover:bg-soft")}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              {mode === "sources" ? (
                <SavedPicker api={api} chosen={chosen} onChange={setChosen} />
              ) : null}

              <p className="mt-2 text-[11px] leading-4 text-muted">
                {own
                  ? `Will be sent to ${own.label} · ${own.model} · about ${estimate} tokens${mode === "sources" && chosen.length ? ` · ${chosen.length} saved items` : ""}`
                  : `Will be sent to Google · ${credits.data?.allowance ? "free AI credit" : "free AI"} · about ${estimate} tokens${mode === "sources" && chosen.length ? ` · ${chosen.length} saved items` : ""}`}
              </p>

              {error ? <p className="mt-2 rounded-xl bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}

              {answer ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-[.13em] text-muted">The answer</p>
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-xl bg-soft p-3 text-sm">
                    <BlockPreview blocks={answer} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {changed ? (
                      <p className="w-full text-xs text-amber-800 dark:text-amber-200">
                        The selection has changed since the question was asked, so the answer can only be put below it.
                      </p>
                    ) : (
                      <Button size="sm" onClick={() => accept("replace")}>Replace the selection</Button>
                    )}
                    <Button size="sm" variant={changed ? "secondary" : "secondary"} onClick={() => accept("below")}>Insert below</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setAnswer(null); run.mutate(); }}>Try again</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setAnswer(null); setOpen(false); }}>Discard</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex justify-end">
                  <Button size="sm" disabled={run.isPending} onClick={() => run.mutate()}>
                    {run.isPending ? <><LoaderCircle className="size-3.5 animate-spin" />Thinking…</> : "Show the answer"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </DocAiContext.Provider>
  );
}

/**
 * The answer, shown as it would be written.
 *
 * The parts the AI added are marked, so that a person can see what is
 * theirs and what is not.
 */
function BlockPreview({ blocks }: { blocks: AiBlock[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        const added = block.added === true;
        const mark = added ? "rounded-lg bg-amber-100 px-1.5 py-0.5 dark:bg-amber-900/40" : "";
        switch (block.type) {
          case "heading": {
            const level = Math.min(4, Math.max(1, block.level || 2));
            return <p key={index} className={cn("font-semibold", mark)} style={{ fontSize: `${1.25 - (level - 1) * 0.12}rem` }}>{block.text}</p>;
          }
          case "bullets":
            return <ul key={index} className={cn("list-disc pl-5", mark)}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>;
          case "numbered":
            return <ol key={index} className={cn("list-decimal pl-5", mark)}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ol>;
          case "checklist":
            return <ul key={index} className={cn("list-disc pl-5", mark)}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item.done ? "☑" : "☐"} {item.text}</li>)}</ul>;
          case "table":
            return (
              <table key={index} className={cn("w-full text-left", mark)}>
                <thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex} className="border border-line px-2 py-1">{cell}</th>)}</tr></thead>
                <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="border border-line px-2 py-1">{cell}</td>)}</tr>)}</tbody>
              </table>
            );
          case "quote":
            return <blockquote key={index} className={cn("border-l-2 border-line pl-3 italic", mark)}>{block.text}</blockquote>;
          case "clip":
            return <p key={index} className={cn("rounded-lg border border-line px-2 py-1 text-xs text-muted", mark)}>A piece from the web page</p>;
          default:
            return <p key={index} className={mark}>{block.type === "paragraph" ? block.text : ""}</p>;
        }
      })}
    </div>
  );
}

/**
 * The saved items that the AI may use.
 */
function SavedPicker({
  api,
  chosen,
  onChange,
}: {
  api: ReturnType<typeof useAuth>["api"];
  chosen: string[];
  onChange: (ids: string[]) => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ id: string; title: string; sourceDomain?: string | null }[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void api.search(term.trim(), 1, 8)
        .then((page) => setResults(page.items.map((item) => ({ id: item.id, title: item.title, sourceDomain: item.sourceDomain }))))
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [api, term]);

  return (
    <div className="mt-2 rounded-xl bg-soft p-2">
      <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Find a saved item…" />
      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
        {results.map((item) => {
          const on = chosen.includes(item.id);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onChange(on ? chosen.filter((id) => id !== item.id) : [...chosen, item.id].slice(0, 10))}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-hover"
              >
                <span className={cn("grid size-4 shrink-0 place-items-center rounded border", on ? "border-deep bg-deep text-white" : "border-line")}>
                  {on ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
              </button>
            </li>
          );
        })}
        {!results.length ? <li className="px-2 py-1 text-xs text-muted">Nothing matches yet.</li> : null}
      </ul>
    </div>
  );
}
