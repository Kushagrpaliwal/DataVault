import { useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold, ChevronDown, Code, Highlighter, Italic, Link2, List,
  ListChecks, ListOrdered, Minus, Palette, Quote, Redo2, Strikethrough, Table2, Underline,
  Undo2, Image as ImageIcon, AlignLeft, AlignCenter, AlignRight, Eraser,
} from "lucide-react";
import { cn } from "@data-vault/ui";

const FONT_FAMILIES = [
  { label: "Default", value: "" },
  { label: "Inter", value: "Inter, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times", value: "'Times New Roman', serif" },
  { label: "Courier", value: "'Courier New', monospace" },
  { label: "Verdana", value: "Verdana, sans-serif" },
];

const FONT_SIZES = [
  { label: "Small", value: "13px" },
  { label: "Normal", value: "15px" },
  { label: "Medium", value: "17px" },
  { label: "Large", value: "20px" },
  { label: "Huge", value: "24px" },
];

const TEXT_COLOURS = ["#0a0a0a", "#b3261e", "#1a3a3a", "#1a5fb4", "#7b1fa2", "#e8710a", "#00897b", "#6a6a6a"];
const HIGHLIGHT_COLOURS = ["#fff3a3", "#c8f7c5", "#cfe8ff", "#ffd6e7", "#e6dcff"];

interface ToolbarProps {
  editor: Editor | null;
  /** The user is looking at a table cell. */
  inTable?: boolean;
}

/**
 * The formatting bar above the page.
 *
 * Everything here works on the current selection, the same way it does in
 * any word processor.
 */
export function DocToolbar({ editor, inTable = false }: ToolbarProps) {
  const [showColours, setShowColours] = useState(false);
  if (!editor) return null;

  const heading = editor.isActive("heading", { level: 1 }) ? 1 : editor.isActive("heading", { level: 2 }) ? 2 : editor.isActive("heading", { level: 3 }) ? 3 : 0;
  const textStyle = editor.getAttributes("textStyle") as { fontFamily?: string; fontSize?: string };

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

  const addImage = () => {
    const address = window.prompt("Paste the address of the image", "https://");
    if (!address?.trim()) return;
    if (!/^https:\/\//i.test(address.trim())) {
      window.alert("Only an https address can be used for an image.");
      return;
    }
    editor.chain().focus().setImage({ src: address.trim() }).run();
  };

  const addTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-3 py-2 text-sm">
      <ToolButton label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 className="size-4" /></ToolButton>
      <ToolButton label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 className="size-4" /></ToolButton>
      <Separator />

      <Select label="Style" value={String(heading)} onChange={(value) => {
        const level = Number(value);
        if (!level) editor.chain().focus().setParagraph().run();
        else editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run();
      }} options={[
        { value: "0", label: "Normal" },
        { value: "1", label: "Heading 1" },
        { value: "2", label: "Heading 2" },
        { value: "3", label: "Heading 3" },
      ]} />

      <Select label="Font" value={textStyle.fontFamily ?? ""} onChange={(value) => {
        if (!value) editor.chain().focus().unsetFontFamily().run();
        else editor.chain().focus().setFontFamily(value).run();
      }} options={FONT_FAMILIES} />

      <Select label="Size" value={textStyle.fontSize ?? ""} onChange={(value) => {
        if (!value) editor.chain().focus().unsetFontSize().run();
        else editor.chain().focus().setFontSize(value).run();
      }} options={FONT_SIZES} />
      <Separator />

      <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="size-4" /></ToolButton>
      <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="size-4" /></ToolButton>
      <ToolButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline className="size-4" /></ToolButton>
      <ToolButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="size-4" /></ToolButton>
      <ToolButton label="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}><Code className="size-4" /></ToolButton>
      <Separator />

      <div className="relative">
        <ToolButton label="Text colour" active={showColours} onClick={() => setShowColours((open) => !open)}><Palette className="size-4" /></ToolButton>
        {showColours ? (
          <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-2xl border border-line bg-white p-3 shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted">Text</p>
            <div className="mt-2 grid grid-cols-8 gap-1">
              {TEXT_COLOURS.map((colour) => (
                <button key={colour} title={colour} aria-label={`Text colour ${colour}`} className="size-6 rounded-md border border-black/10" style={{ background: colour }} onClick={() => { editor.chain().focus().setColor(colour).run(); setShowColours(false); }} />
              ))}
            </div>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[.12em] text-muted">Highlight</p>
            <div className="mt-2 grid grid-cols-5 gap-1">
              {HIGHLIGHT_COLOURS.map((colour) => (
                <button key={colour} title={colour} aria-label={`Highlight ${colour}`} className="size-6 rounded-md border border-black/10" style={{ background: colour }} onClick={() => { editor.chain().focus().toggleHighlight({ color: colour }).run(); setShowColours(false); }} />
              ))}
            </div>
            <button className="mt-3 text-xs underline" onClick={() => { editor.chain().focus().unsetColor().run(); setShowColours(false); }}>Remove colour</button>
          </div>
        ) : null}
      </div>
      <ToolButton label="Highlight" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight({ color: "#fff3a3" }).run()}><Highlighter className="size-4" /></ToolButton>
      <Separator />

      <ToolButton label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft className="size-4" /></ToolButton>
      <ToolButton label="Align centre" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter className="size-4" /></ToolButton>
      <ToolButton label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight className="size-4" /></ToolButton>
      <Separator />

      <ToolButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="size-4" /></ToolButton>
      <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="size-4" /></ToolButton>
      <ToolButton label="Checklist" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks className="size-4" /></ToolButton>
      <ToolButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="size-4" /></ToolButton>
      <ToolButton label="Code block" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code className="size-4" /></ToolButton>
      <ToolButton label="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus className="size-4" /></ToolButton>
      <Separator />

      <ToolButton label="Link" active={editor.isActive("link")} onClick={setLink}><Link2 className="size-4" /></ToolButton>
      <ToolButton label="Image" onClick={addImage}><ImageIcon className="size-4" /></ToolButton>
      <ToolButton label="Table" active={inTable} onClick={addTable}><Table2 className="size-4" /></ToolButton>
      <ToolButton label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><Eraser className="size-4" /></ToolButton>
    </div>
  );
}

function ToolButton({ label, onClick, active, disabled, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn("grid size-8 place-items-center rounded-lg text-strong transition-colors hover:bg-soft disabled:pointer-events-none disabled:opacity-35", active && "bg-soft text-black")}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <span className="mx-1 h-5 w-px bg-[#e5dfd1]" aria-hidden />;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 appearance-none rounded-lg border border-transparent bg-transparent py-0 pl-2 pr-6 text-xs font-medium text-strong hover:bg-soft focus:border-line"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 size-3 text-muted" />
    </label>
  );
}
