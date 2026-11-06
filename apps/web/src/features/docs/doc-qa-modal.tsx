import { useState } from "react";
import { Check, Copy, CornerDownLeft, FilePlus2, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@data-vault/ui";
import { Modal } from "../../components/feedback";
import type { AiBlock } from "@data-vault/types";
import type { JSONContent } from "@tiptap/core";

interface DocQaModalProps {
  open: boolean;
  loading: boolean;
  error?: string | null;
  blocks: AiBlock[];
  noteTitle: string;
  onClose: () => void;
  onRegenerate: () => void;
  onInsertToDoc: (blocks: AiBlock[]) => void;
  onSaveSubpage: (content: JSONContent, title: string) => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function DocQaModal({
  open,
  loading,
  error,
  blocks,
  noteTitle,
  onClose,
  onRegenerate,
  onInsertToDoc,
  onSaveSubpage,
  onNotify,
}: DocQaModalProps) {
  const [copied, setCopied] = useState(false);
  const [savingSubpage, setSavingSubpage] = useState(false);

  const copyMarkdown = () => {
    const text = blocksToPlainText(blocks);
    void navigator.clipboard.writeText(`# Q&A: ${noteTitle}\n\n${text}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onNotify("Q&A copied to clipboard");
  };

  const handleSaveSubpage = async () => {
    setSavingSubpage(true);
    try {
      const bodyNodes: JSONContent[] = [];
      for (const b of blocks) {
        if (b.type === "heading") {
          bodyNodes.push({ type: "heading", attrs: { level: 2, sectionKey: null }, content: [{ type: "text", text: b.text ?? "" }] });
        } else if (b.type === "paragraph") {
          bodyNodes.push({ type: "paragraph", content: [{ type: "text", text: b.text ?? "" }] });
        } else if (b.type === "bullets" && b.items) {
          bodyNodes.push({
            type: "bulletList",
            content: b.items.map((it) => ({
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: it }] }],
            })),
          });
        }
      }

      const docContent: JSONContent = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1, sectionKey: null }, content: [{ type: "text", text: `Q&A: ${noteTitle || "Doc"}` }] },
          ...bodyNodes,
        ],
      };
      await onSaveSubpage(docContent, `Q&A: ${noteTitle || "Doc"}`);
      onClose();
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : "Could not save subpage", "error");
    } finally {
      setSavingSubpage(false);
    }
  };

  return (
    <Modal open={open} title="Q&A & Study Cards" onClose={onClose}>
      <div className="space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted">
            <LoaderCircle className="size-8 animate-spin text-purple-600 dark:text-purple-400" />
            <p className="mt-4 font-medium text-ink">Generating Q&A cards from doc…</p>
            <p className="mt-1 text-xs text-muted">Extracting key concepts and study questions</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <p className="font-medium">Could not generate Q&A</p>
            <p className="mt-1 text-xs opacity-90">{error}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={onRegenerate}>
              <RefreshCw className="size-3.5" /> Try again
            </Button>
          </div>
        ) : blocks.length ? (
          <>
            <div className="max-h-[50vh] space-y-3 overflow-y-auto rounded-xl border border-line bg-surface p-4 text-xs leading-relaxed">
              {blocks.map((block, idx) => (
                <div key={idx}>
                  {block.type === "heading" ? (
                    <h4 className="font-semibold text-sm text-purple-900 dark:text-purple-300 pt-2 first:pt-0">
                      {block.text}
                    </h4>
                  ) : block.type === "paragraph" ? (
                    <p className="text-strong">{block.text}</p>
                  ) : block.type === "bullets" && block.items ? (
                    <ul className="list-disc pl-4 space-y-1 text-muted">
                      {block.items.map((it, i) => <li key={i}>{it}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={copyMarkdown} title="Copy Q&A">
                  {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button size="sm" variant="ghost" onClick={onRegenerate} title="Re-generate">
                  <RefreshCw className="size-3.5" /> Re-try
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onInsertToDoc(blocks);
                    onNotify("Inserted into doc");
                    onClose();
                  }}
                >
                  <CornerDownLeft className="size-3.5" />
                  Insert into doc
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void handleSaveSubpage()}
                  disabled={savingSubpage}
                >
                  <FilePlus2 className="size-3.5" />
                  {savingSubpage ? "Saving…" : "Save as subpage"}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function blocksToPlainText(blocks: AiBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "heading") parts.push(`\n### ${block.text}\n`);
    else if (block.type === "paragraph") parts.push(block.text ?? "");
    else if (block.type === "bullets" && block.items) {
      parts.push(block.items.map((it) => `- ${it}`).join("\n"));
    }
  }
  return parts.join("\n\n");
}
