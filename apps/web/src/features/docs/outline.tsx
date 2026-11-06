import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";

interface OutlineEntry {
  id: string;
  text: string;
  level: number;
  pos: number;
}

interface DocOutlineProps {
  editor: Editor | null;
}

/**
 * The list of headings in the doc and stats.
 */
export function DocOutline({ editor }: DocOutlineProps) {
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  const [words, setWords] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const read = () => {
      const found: OutlineEntry[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "heading") return;
        const level = typeof node.attrs.level === "number" ? node.attrs.level : 1;
        const text = node.textContent.trim();
        if (!text) return;
        found.push({ id: `heading-${pos}`, text, level, pos });
      });
      setEntries(found);
      const text = editor.state.doc.textContent.trim();
      setWords(text ? text.split(/\s+/).length : 0);
    };
    read();
    editor.on("update", read);
    editor.on("selectionUpdate", read);
    return () => {
      editor.off("update", read);
      editor.off("selectionUpdate", read);
    };
  }, [editor]);

  const jump = (entry: OutlineEntry) => {
    if (!editor) return;
    /**
     * Moving the caret to the heading scrolls the page to it, which is what
     * the reader expects.
     */
    editor.chain().focus().setTextSelection(entry.pos + 1).scrollIntoView().run();
  };

  return (
    <aside className="hidden w-60 shrink-0 xl:block">
      <div className="sticky top-24 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-muted">On this page</p>
          {entries.length ? (
            <ul className="mt-3 space-y-1 border-l border-line">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    onClick={() => jump(entry)}
                    className="block w-full truncate py-1 text-left text-sm text-strong hover:text-ink"
                    style={{ paddingLeft: `${(entry.level - 1) * 12 + 12}px` }}
                    title={entry.text}
                  >
                    {entry.text}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">No headings yet.</p>
          )}
        </div>
        <p className="border-t border-line pt-3 text-xs text-muted">{words} {words === 1 ? "word" : "words"}</p>
      </div>
    </aside>
  );
}
