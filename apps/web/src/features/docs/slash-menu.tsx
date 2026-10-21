import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  CheckSquare, Code, Eraser, Heading1, Heading2, Heading3, Image as ImageIcon, Link2, List, ListOrdered,
  Minus, Quote, Table2, Type,
} from "lucide-react";
import { cn } from "@data-vault/ui";

interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  run: (editor: Editor) => void;
}

const COMMANDS: SlashCommand[] = [
  { id: "text", label: "Text", hint: "A plain paragraph", icon: <Type className="size-4" />, run: (editor) => editor.chain().focus().setParagraph().run() },
  { id: "h1", label: "Heading 1", hint: "A big heading", icon: <Heading1 className="size-4" />, run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: "h2", label: "Heading 2", hint: "A section heading", icon: <Heading2 className="size-4" />, run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: "h3", label: "Heading 3", hint: "A smaller heading", icon: <Heading3 className="size-4" />, run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: "bullet", label: "Bulleted list", hint: "A list of points", icon: <List className="size-4" />, run: (editor) => editor.chain().focus().toggleBulletList().run() },
  { id: "ordered", label: "Numbered list", hint: "A list in order", icon: <ListOrdered className="size-4" />, run: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { id: "task", label: "Checklist", hint: "Things to tick off", icon: <CheckSquare className="size-4" />, run: (editor) => editor.chain().focus().toggleTaskList().run() },
  { id: "quote", label: "Quote", hint: "A quotation", icon: <Quote className="size-4" />, run: (editor) => editor.chain().focus().toggleBlockquote().run() },
  { id: "code", label: "Code block", hint: "Code that keeps its shape", icon: <Code className="size-4" />, run: (editor) => editor.chain().focus().toggleCodeBlock().run() },
  { id: "divider", label: "Divider", hint: "A line across the page", icon: <Minus className="size-4" />, run: (editor) => editor.chain().focus().setHorizontalRule().run() },
  { id: "image", label: "Image", hint: "Add a picture", icon: <ImageIcon className="size-4" />, run: (editor) => {
    const address = window.prompt("Paste the address of the image", "https://");
    if (address?.trim() && /^https:\/\//i.test(address.trim())) editor.chain().focus().setImage({ src: address.trim() }).run();
  } },
  { id: "table", label: "Table", hint: "A grid of cells", icon: <Table2 className="size-4" />, run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
];

function filtered(term: string) {
  const value = term.trim().toLowerCase();
  if (!value) return COMMANDS;
  return COMMANDS.filter((command) => command.label.toLowerCase().includes(value) || command.id.includes(value));
}

/**
 * The menu that opens when a slash is typed.
 *
 * It filters the list as more letters are typed and runs the chosen command
 * when it is picked.
 */
export function SlashMenu({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [index, setIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      const { state } = editor;
      const { $from } = state.selection;
      const text = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
      const match = /(?:^|\s)\/([a-z]*)$/i.exec(text);
      if (!match) {
        setOpen(false);
        setTerm("");
        setIndex(0);
        return;
      }
      const coordinates = editor.view.coordsAtPos($from.pos);
      setPosition({ top: coordinates.bottom + 8, left: coordinates.left });
      setTerm(match[1] ?? "");
      setOpen(true);
    };
    editor.on("update", onUpdate);
    editor.on("selectionUpdate", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      editor.off("selectionUpdate", onUpdate);
    };
  }, [editor]);

  /**
   * Run the chosen command.
   *
   * The slash and the letters are removed first, so the command starts on
   * an empty block rather than on the text that was typed.
   */
  const choose = (command: SlashCommand) => {
    if (!editor) return;
    editor.chain().focus().deleteRange({ from: editor.state.selection.from - term.length - 1, to: editor.state.selection.from }).run();
    command.run(editor);
    setOpen(false);
    setTerm("");
    setIndex(0);
  };

  useEffect(() => {
    if (!open) return;
    const matches = filtered(term);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((current) => Math.min(current + 1, matches.length - 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) => Math.max(current - 1, 0));
      }
      if (event.key === "Enter" && matches[index]) {
        event.preventDefault();
        choose(matches[index]);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!editor || !open) return null;

  const matches = filtered(term);

  return (
    <div
      style={{ top: position.top, left: position.left }}
      className="fixed z-50 max-h-80 w-72 overflow-y-auto rounded-2xl border border-line bg-white p-1.5 shadow-xl"
    >
      {matches.length ? matches.map((command, commandIndex) => (
        <button
          key={command.id}
          type="button"
          onMouseDown={(event) => { event.preventDefault(); choose(command); }}
          onMouseEnter={() => setIndex(commandIndex)}
          className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left", commandIndex === index ? "bg-soft" : "hover:bg-hover")}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-soft text-strong">{command.icon}</span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{command.label}</span>
            <span className="block truncate text-xs text-muted">{command.hint}</span>
          </span>
        </button>
      )) : (
        <p className="px-3 py-4 text-center text-sm text-muted">Nothing matches “{term}”.</p>
      )}
    </div>
  );
}

/**
 * The small bar that appears over highlighted text.
 *
 * It holds the things people reach for most often while writing.
 */
export function SelectionMenu({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  const setLink = () => {
    const current = editor.getAttributes("link").href as string | undefined;
    const address = window.prompt("Paste the address", current ?? "https://");
    if (address === null) return;
    if (!address.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: address.trim() }).run();
  };

  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-line bg-white p-1 shadow-lg">
      <BubbleButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><span className="text-xs font-bold">B</span></BubbleButton>
      <BubbleButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><span className="text-xs italic">I</span></BubbleButton>
      <BubbleButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><span className="text-xs underline">U</span></BubbleButton>
      <BubbleButton label="Highlight" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight({ color: "#fff3a3" }).run()}><span className="rounded bg-[#fff3a3] px-1 text-[10px]">H</span></BubbleButton>
      <BubbleButton label="Link" active={editor.isActive("link")} onClick={setLink}><Link2 className="size-3.5" /></BubbleButton>
      <BubbleButton label="Clear" onClick={() => editor.chain().focus().unsetAllMarks().run()}><Eraser className="size-3.5" /></BubbleButton>
    </div>
  );
}

function BubbleButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn("grid size-7 place-items-center rounded-lg text-strong hover:bg-soft", active && "bg-soft text-black")}
    >
      {children}
    </button>
  );
}
