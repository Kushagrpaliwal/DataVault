import { useState } from "react";
import { Check, Copy, FilePlus2, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@data-vault/ui";
import { Modal } from "../../components/feedback";
import type { NoteSummaryDetail } from "@data-vault/types";
import type { JSONContent } from "@tiptap/core";

interface DocSummaryModalProps {
  open: boolean;
  data: NoteSummaryDetail | null;
  loading: boolean;
  error?: string | null;
  onClose: () => void;
  onRegenerate: () => void;
  onSaveSubpage: (content: JSONContent, title: string) => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function DocSummaryModal({
  open,
  data,
  loading,
  error,
  onClose,
  onRegenerate,
  onSaveSubpage,
  onNotify,
}: DocSummaryModalProps) {
  const [copied, setCopied] = useState(false);
  const [savingSubpage, setSavingSubpage] = useState(false);

  const copyAsMarkdown = () => {
    if (!data) return;
    const parts: string[] = [`# Summary: ${data.title || "Doc"}\n`];
    if (data.overview) {
      parts.push(`## Overview\n${data.overview}\n`);
    }
    if (data.keyPoints?.length) {
      parts.push(`## Key Takeaways\n${data.keyPoints.map((p) => `- ${p}`).join("\n")}\n`);
    }
    if (data.sections?.length) {
      parts.push(`## Breakdown\n${data.sections.map((s) => `### ${s.heading}\n${s.summary}`).join("\n\n")}\n`);
    }
    if (data.questions?.length) {
      parts.push(`## Open Questions & Gaps\n${data.questions.map((q) => `- ${q}`).join("\n")}\n`);
    }
    const text = parts.join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onNotify("Summary copied to clipboard");
  };

  const handleSaveSubpage = async () => {
    if (!data) return;
    setSavingSubpage(true);
    try {
      const docContent: JSONContent = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1, sectionKey: null }, content: [{ type: "text", text: `Summary: ${data.title || "Doc"}` }] },
          ...(data.overview ? [{ type: "paragraph", content: [{ type: "text", text: data.overview }] }] : []),
          ...(data.keyPoints?.length ? [
            { type: "heading", attrs: { level: 2, sectionKey: null }, content: [{ type: "text", text: "Key Takeaways" }] },
            {
              type: "bulletList",
              content: data.keyPoints.map((point) => ({
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: point }] }],
              })),
            },
          ] : []),
          ...(data.sections?.length ? [
            { type: "heading", attrs: { level: 2, sectionKey: null }, content: [{ type: "text", text: "Section Breakdown" }] },
            ...data.sections.flatMap((section) => [
              ...(section.heading ? [{ type: "heading", attrs: { level: 3, sectionKey: null }, content: [{ type: "text", text: section.heading }] }] : []),
              { type: "paragraph", content: [{ type: "text", text: section.summary }] },
            ]),
          ] : []),
          ...(data.questions?.length ? [
            { type: "heading", attrs: { level: 2, sectionKey: null }, content: [{ type: "text", text: "Open Questions & Gaps" }] },
            {
              type: "bulletList",
              content: data.questions.map((q) => ({
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: q }] }],
              })),
            },
          ] : []),
        ],
      };
      await onSaveSubpage(docContent, `Summary: ${data.title || "Doc"}`);
      onClose();
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : "Could not save subpage", "error");
    } finally {
      setSavingSubpage(false);
    }
  };

  return (
    <Modal open={open} title={data?.title ? `Summary: ${data.title}` : "Doc Summary"} onClose={onClose}>
      <div className="space-y-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted">
            <LoaderCircle className="size-8 animate-spin text-purple-600 dark:text-purple-400" />
            <p className="mt-4 font-medium text-ink">Analyzing document…</p>
            <p className="mt-1 text-xs text-muted">Reading all text and web clips</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <p className="font-medium">Could not summarize doc</p>
            <p className="mt-1 text-xs opacity-90">{error}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={onRegenerate}>
              <RefreshCw className="size-3.5" /> Try again
            </Button>
          </div>
        ) : data ? (
          <>
            {data.overview ? (
              <div className="rounded-xl bg-soft p-4">
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted">Overview</p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink">{data.overview}</p>
              </div>
            ) : null}

            {data.keyPoints?.length ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted">Key Takeaways</p>
                <ul className="mt-2 space-y-1.5">
                  {data.keyPoints.map((point, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-ink leading-relaxed">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-purple-600 dark:bg-purple-400" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {data.sections?.length ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted">Breakdown</p>
                {data.sections.map((section, idx) => (
                  <div key={idx} className="rounded-xl border border-line p-3">
                    {section.heading ? <h4 className="text-sm font-semibold text-ink">{section.heading}</h4> : null}
                    <p className="mt-1 text-xs leading-relaxed text-muted">{section.summary}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {data.questions?.length ? (
              <div className="rounded-xl border border-line/60 bg-amber-50/50 p-3.5 dark:bg-amber-950/20">
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-amber-900 dark:text-amber-300">Open Questions & Gaps</p>
                <ul className="mt-2 space-y-1 text-xs text-amber-900/90 dark:text-amber-200">
                  {data.questions.map((q, i) => (
                    <li key={i}>• {q}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <Button size="sm" variant="ghost" onClick={onRegenerate} title="Re-run summary">
                <RefreshCw className="size-3.5" /> Re-summarize
              </Button>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={copyAsMarkdown}>
                  {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy summary"}
                </Button>
                <Button size="sm" variant="primary" onClick={() => void handleSaveSubpage()} disabled={savingSubpage}>
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
