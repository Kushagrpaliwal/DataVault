import { useState } from "react";
import { Check, Copy, FilePlus2, History, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@data-vault/ui";
import { Modal } from "../../components/feedback";
import type { NoteNotesSection } from "@data-vault/types";

interface DocRearrangeModalProps {
  open: boolean;
  loading: boolean;
  error?: string | null;
  title: string;
  sections: NoteNotesSection[];
  onClose: () => void;
  onApply: (target: "replace" | "subpage") => Promise<void>;
  onRegenerate: () => void;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function DocRearrangeModal({
  open,
  loading,
  error,
  title,
  sections,
  onClose,
  onApply,
  onRegenerate,
  onNotify,
}: DocRearrangeModalProps) {
  const [applying, setApplying] = useState<"replace" | "subpage" | null>(null);
  const [copied, setCopied] = useState(false);

  const copyAsMarkdown = () => {
    const parts = [`# ${title || "Notes"}\n`];
    for (const section of sections) {
      if (section.heading) parts.push(`## ${section.heading}`);
      for (const pt of section.points) parts.push(`- ${pt}`);
      parts.push("");
    }
    void navigator.clipboard.writeText(parts.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onNotify("Notes copied to clipboard");
  };

  const handleApply = async (target: "replace" | "subpage") => {
    setApplying(target);
    try {
      await onApply(target);
      onClose();
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : "Could not apply notes", "error");
    } finally {
      setApplying(null);
    }
  };

  return (
    <Modal open={open} title="Re-arrange into Notes" onClose={onClose}>
      <div className="space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted">
            <LoaderCircle className="size-8 animate-spin text-purple-600 dark:text-purple-400" />
            <p className="mt-4 font-medium text-ink">Reorganizing your doc into notes…</p>
            <p className="mt-1 text-xs text-muted">Grouping clips and ideas without changing exact facts</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <p className="font-medium">Could not re-arrange doc</p>
            <p className="mt-1 text-xs opacity-90">{error}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={onRegenerate}>
              <RefreshCw className="size-3.5" /> Try again
            </Button>
          </div>
        ) : sections.length ? (
          <>
            <div className="flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50/60 p-3 text-xs text-purple-950 dark:border-purple-900 dark:bg-purple-950/30 dark:text-purple-200">
              <History className="size-4 shrink-0 text-purple-600 dark:text-purple-400" />
              <span>
                A backup of your original doc is automatically saved to <strong>Version History</strong> before overwriting.
              </span>
            </div>

            <div className="max-h-[50vh] space-y-4 overflow-y-auto rounded-xl border border-line bg-surface p-4">
              {sections.map((section, idx) => (
                <div key={idx} className="space-y-1.5">
                  {section.heading ? (
                    <h4 className="text-sm font-semibold text-ink">{section.heading}</h4>
                  ) : null}
                  <ul className="space-y-1 pl-1">
                    {section.points.map((point, pIdx) => (
                      <li key={pIdx} className="flex items-start gap-2 text-xs leading-relaxed text-strong">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-purple-500" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={copyAsMarkdown} title="Copy notes as Markdown">
                  {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button size="sm" variant="ghost" onClick={onRegenerate} title="Re-generate arrangement">
                  <RefreshCw className="size-3.5" /> Re-try
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleApply("subpage")}
                  disabled={Boolean(applying)}
                >
                  <FilePlus2 className="size-3.5" />
                  {applying === "subpage" ? "Saving…" : "Save as subpage"}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  className="bg-purple-600 text-white hover:bg-purple-700 dark:bg-purple-600 dark:hover:bg-purple-500"
                  onClick={() => void handleApply("replace")}
                  disabled={Boolean(applying)}
                >
                  <Sparkles className="size-3.5" />
                  {applying === "replace" ? "Applying…" : "Replace & Overwrite"}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
