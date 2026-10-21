import { useEffect, useMemo, useState } from "react";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import Heading from "@tiptap/extension-heading";
import { mergeMissingClips, noteExtensions, type ArrangeMode } from "@data-vault/notes";
import type { JSONContent } from "@tiptap/core";
import { GripVertical, Star } from "lucide-react";
import { Button } from "@data-vault/ui";
import { DocToolbar } from "./toolbar";
import { SelectionMenu, SlashMenu } from "./slash-menu";
import { DocOutline } from "./outline";
import { ClipNodeView } from "./clip-node-view";
import { SectionHeadingView } from "./section-heading-view";
import { useAutosave, type SaveStatus } from "./use-autosave";

/**
 * The clip card, with its actions.
 *
 * The card itself is shared with the server, so a doc means the same thing
 * wherever it is opened. Only the view of it is different.
 */
const ClipWithActions = noteExtensions()
  .find((extension) => extension.name === "clip")!
  .extend({ addNodeView() { return ReactNodeViewRenderer(ClipNodeView); } });

/**
 * The heading that names the source of the pieces under it.
 *
 * The heading carries a key that says which page or website the section is
 * about, so the link to the source is written once, at the top, and the
 * pieces underneath are shown as plain text.
 */
const HeadingWithSource = Heading
  .extend({ addNodeView() { return ReactNodeViewRenderer(SectionHeadingView); } })
  .configure({ levels: [1, 2, 3] });

interface DocEditorProps {
  title: string;
  icon: string | null;
  content: JSONContent;
  /** The version the server last gave us. */
  version: number;
  /** How new pieces are sorted into this doc. */
  arrangeMode: ArrangeMode;
  /** True when this doc is the one the extension adds to. */
  isCurrent: boolean;
  onTitleChange: (title: string) => void;
  onIconChange: (icon: string | null) => void;
  onSave: (content: JSONContent, baseVersion: number) => Promise<number>;
  /** Called when the doc was changed somewhere else and the pieces could not be merged. */
  onConflict?: () => void;
  onMakeCurrent?: () => void;
}

/**
 * A doc, shown as a page.
 *
 * The page sits on a sheet of paper in the middle of the screen, the way a
 * word processor shows it.
 */
export function DocEditor({
  title, icon, content, version, arrangeMode, isCurrent,
  onTitleChange, onIconChange, onSave, onConflict, onMakeCurrent,
}: DocEditorProps) {
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<{ latest: JSONContent; latestVersion: number } | null>(null);

  const autosave = useAutosave({
    baseVersion: version,
    dirty,
    save: async (next, base) => {
      try {
        return await onSave(next, base);
      } catch (caught) {
        if ((caught as { code?: string })?.code === "NOTE_VERSION_CONFLICT") {
          const latest = (caught as { details?: { note?: { content: JSONContent; version: number } } })?.details?.note;
          if (latest) setConflict({ latest: latest.content, latestVersion: latest.version });
        }
        throw caught;
      }
    },
  });

  /**
   * The heading that names the source of the pieces under it gets its own
   * view, so the link to the source is written once, at the top.
   *
   * The heading is part of the starter kit, so it is turned off there and
   * put back with the view that is wanted.
   */
  const extensions = useMemo(() => [
    ...noteExtensions().map((extension) => {
      if (extension.name === "clip") return ClipWithActions;
      if (extension.name === "starterKit") return extension.configure({ heading: false });
      return extension;
    }),
    HeadingWithSource,
    Placeholder.configure({ placeholder: "Start writing, or press / for blocks" }),
    CharacterCount,
  ], []);

  const editor = useEditor({
    extensions,
    content,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "datavault-prose focus:outline-none" },
    },
    onUpdate: ({ editor: instance }) => {
      setDirty(true);
      autosave.queue(instance.getJSON());
    },
  });

  /**
   * When the doc is opened again, or the server sends a newer version, the
   * editor is filled with it. The content is only replaced when the user has
   * nothing unsaved, so their writing is never thrown away.
   */
  useEffect(() => {
    if (!editor) return;
    if (dirty) return;
    const current = JSON.stringify(editor.getJSON());
    if (current === JSON.stringify(content)) return;
    editor.commands.setContent(content, { emitUpdate: false });
  }, [content, dirty, editor]);

  /**
   * The title is part of the doc, so it is changed in the editor rather than
   * in a separate form.
   */
  const [titleValue, setTitleValue] = useState(title);
  useEffect(() => { setTitleValue(title); }, [title]);

  /**
   * The doc was changed somewhere else.
   *
   * If the only thing that changed is a piece added from the browser, that
   * piece is put into the editor's copy, in the section it belongs to. When
   * the writing itself changed, the user is asked which one to keep.
   */
  const resolveConflict = (keep: "mine" | "theirs") => {
    if (!editor || !conflict) return;
    if (keep === "theirs") {
      editor.commands.setContent(conflict.latest, { emitUpdate: false });
      setDirty(false);
      setConflict(null);
      autosave.rebase(conflict.latestVersion);
      onConflict?.();
      return;
    }
    autosave.rebase(conflict.latestVersion);
    setConflict(null);
    void autosave.saveNow();
  };

  const mergeConflict = () => {
    if (!editor || !conflict) return;
    const merged = mergeMissingClips(editor.getJSON(), conflict.latest, arrangeMode);
    /**
     * When the writing itself changed, there is nothing to merge. The banner
     * stays up so the user can choose which version to keep.
     */
    if (!merged.merged) return;
    editor.commands.setContent(merged.doc);
    autosave.rebase(conflict.latestVersion);
    setConflict(null);
  };

  useEffect(() => {
    if (conflict) mergeConflict();
  }, [conflict?.latestVersion]);

  return (
    <div className="flex min-h-0 flex-1 gap-6">
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20">
          <DocToolbar editor={editor} />
          <div className="flex items-center justify-between gap-3 border-b border-line bg-canvas/95 px-3 py-2 text-xs text-muted backdrop-blur">
            <SaveBadge status={autosave.status} error={autosave.error} />
            <div className="flex items-center gap-2">
              {isCurrent ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#dce9e5] px-2.5 py-1 font-medium text-deep-text"><Star className="size-3" />Current doc for the extension</span>
              ) : onMakeCurrent ? (
                <button onClick={onMakeCurrent} className="rounded-full border border-line px-2.5 py-1 font-medium hover:bg-soft">Use as the extension's doc</button>
              ) : null}
            </div>
          </div>
        </div>

        {conflict ? (
          <div className="mx-auto mt-4 max-w-[860px] px-4">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <span className="flex-1">This doc was changed somewhere else. Which version should be kept?</span>
              <Button size="sm" variant="secondary" onClick={() => resolveConflict("mine")}>Keep mine</Button>
              <Button size="sm" variant="secondary" onClick={() => resolveConflict("theirs")}>Load theirs</Button>
            </div>
          </div>
        ) : null}

        <div className="mx-auto mt-6 max-w-[860px] px-4 pb-24">
          <div className="rounded-2xl border border-line bg-white px-10 py-12 shadow-[0_1px_3px_rgba(0,0,0,.04)] md:px-16">
            <div className="flex items-start gap-3">
              <button
                title="Change the icon"
                aria-label="Change the icon"
                onClick={() => {
                  const next = window.prompt("Pick an emoji for this doc", icon ?? "📄");
                  if (next !== null) onIconChange(next.trim() || null);
                }}
                className="mt-1 grid size-12 shrink-0 place-items-center rounded-xl bg-soft text-2xl"
              >
                {icon ?? "📄"}
              </button>
              <textarea
                value={titleValue}
                onChange={(event) => { setTitleValue(event.target.value); onTitleChange(event.target.value); }}
                onBlur={() => { setDirty(true); }}
                rows={1}
                aria-label="Title of the doc"
                placeholder="Untitled doc"
                className="w-full resize-none overflow-hidden border-0 bg-transparent text-4xl font-semibold leading-tight tracking-tight outline-none placeholder:text-[#c4c4c4]"
              />
            </div>

            <div className="mt-6">
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </div>

      <DocOutline editor={editor} />

      {editor ? (
        <>
          <BubbleMenu editor={editor} options={{ placement: "top" }}>
            <SelectionMenu editor={editor} />
          </BubbleMenu>
          <DragHandle editor={editor}>
            <span className="grid size-6 cursor-grab place-items-center rounded-md bg-soft text-muted shadow-sm">
              <GripVertical className="size-3.5" />
            </span>
          </DragHandle>
          <SlashMenu editor={editor} />
        </>
      ) : null}
    </div>
  );
}

/**
 * A small note that says what happened to the last save.
 */
function SaveBadge({ status, error }: { status: SaveStatus; error: string | null }) {
  if (status === "saving") return <span>Saving…</span>;
  if (status === "saved") return <span className="text-green-700">Saved</span>;
  if (status === "offline") return <span className="text-amber-700">Offline, retrying</span>;
  if (status === "conflict") return <span className="text-amber-700">Changed elsewhere</span>;
  if (status === "error") return <span className="text-red-700">{error ?? "Could not save"}</span>;
  return <span>All changes saved</span>;
}
