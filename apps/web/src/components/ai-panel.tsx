import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Sparkles, Wand2 } from "lucide-react";
import { Button } from "@data-vault/ui";
import { DataVaultApiError } from "@data-vault/api-client";
import type { AiClassificationResult, AiExtractionResult, AiSummaryResult } from "@data-vault/types";
import { useAuth } from "../lib/auth";
import { useToast } from "./feedback";

/** The provider connection currently used by AI features. */
export function useAiStatus() {
  const { api } = useAuth();
  return useQuery({ queryKey: ["ai-status"], queryFn: () => api.aiStatus() });
}

export function AiProviderBadge() {
  const status = useAiStatus();
  if (status.data?.available && status.data.ownConnection) {
    return (
      <Link
        to="/settings"
        title={`Using ${status.data.ownConnection.label} · ${status.data.ownConnection.model}`}
        className="flex items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 text-xs font-medium text-strong hover:bg-soft/80"
      >
        <Sparkles className="size-3.5" />
        Your AI
      </Link>
    );
  }
  return (
    <Link to="/settings" title="Connect an AI provider in Settings" className="flex items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 text-xs font-medium text-muted hover:text-strong">
      <Sparkles className="size-3.5" />
      Set up AI
    </Link>
  );
}

export interface AiPanelProps {
  /** The text to work on. */
  content: string;
  /** The saved item the text belongs to, when there is one. */
  recordId?: string | undefined;
  /** Called with the suggested type and tags, so the caller can apply them. */
  onApply?: (result: AiClassificationResult) => void;
}

/** Explain the BYOK setup needed for an AI feature. */
export function AiAccessNotice({ error }: { error: unknown }) {
  const code = error instanceof DataVaultApiError ? error.code : "";
  if (["AI_CONNECTION_REQUIRED", "AI_KEY_UNREADABLE", "AI_KEYS_UNAVAILABLE", "AI_EMBEDDING_UNSUPPORTED"].includes(code)) {
    return (
      <div className="rounded-2xl bg-soft p-4">
        <p className="text-sm font-semibold">Connect your AI provider</p>
        <p className="mt-1 text-sm leading-6 text-muted">
          {error instanceof Error ? error.message : "Add your provider and API key in Settings to use AI features."}
        </p>
        <Link to="/settings" className="mt-3 inline-block text-sm font-medium underline">Open AI settings</Link>
      </div>
    );
  }
  return (
    <p className="rounded-2xl bg-soft p-4 text-sm leading-6 text-muted">
      {error instanceof Error ? error.message : "That did not work."}
    </p>
  );
}

/** The three AI actions use the provider connected in Settings. */
export function AiPanel({ content, recordId, onApply }: AiPanelProps) {
  const { api } = useAuth();
  const { notify } = useToast();
  const status = useAiStatus();
  const [summary, setSummary] = useState<AiSummaryResult | null>(null);
  const [classification, setClassification] = useState<AiClassificationResult | null>(null);
  const [extraction, setExtraction] = useState<AiExtractionResult | null>(null);

  const run = useMutation({
    mutationFn: async (feature: "summarize" | "classify" | "extract") => {
      const body = recordId ? { recordId } : { text: content };
      if (feature === "summarize") return api.aiSummarize(body);
      if (feature === "classify") return api.aiClassify(body);
      return api.aiExtract(body);
    },
    onSuccess: (result, feature) => {
      if (feature === "summarize") setSummary(result.data as AiSummaryResult);
      else if (feature === "classify") {
        const data = result.data as AiClassificationResult;
        setClassification(data);
        onApply?.(data);
      } else setExtraction(result.data as AiExtractionResult);
      notify("Done");
    },
    onError: (error) => notify(error instanceof Error ? error.message : "That did not work", "error"),
  });

  const locked = status.data?.available !== true;
  const reason = status.data?.reason ?? "Connect an AI provider in Settings to use AI features.";
  const own = status.data?.ownConnection;

  return (
    <section className="panel p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-soft"><Sparkles className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">AI help</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            {own
              ? `Summarise this, suggest a type and tags, or pull out the details. Using ${own.label} · ${own.model}.`
              : reason}
          </p>
          {!own ? <Link to="/settings" className="mt-2 inline-block text-sm font-medium underline">Connect a provider</Link> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" disabled={locked || run.isPending} onClick={() => run.mutate("summarize")}>
              <Wand2 className="size-4" />Summarise
            </Button>
            <Button size="sm" variant="secondary" disabled={locked || run.isPending} onClick={() => run.mutate("classify")}>
              Suggest a type
            </Button>
            <Button size="sm" variant="secondary" disabled={locked || run.isPending} onClick={() => run.mutate("extract")}>
              Pull out details
            </Button>
          </div>
          {run.error ? <p className="mt-3 text-sm text-red-700 dark:text-red-300">{run.error instanceof Error ? run.error.message : "That did not work."}</p> : null}
        </div>
      </div>

      {summary ? (
        <div className="mt-5 rounded-2xl bg-soft p-4">
          <p className="text-sm leading-6">{summary.summary}</p>
          {summary.keyPoints.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-strong">
              {summary.keyPoints.map((point) => <li key={point}>{point}</li>)}
            </ul>
          ) : null}
          {summary.suggestedTitle ? <p className="mt-3 text-xs font-semibold uppercase tracking-[.12em] text-muted">Suggested title · {summary.suggestedTitle}</p> : null}
        </div>
      ) : null}

      {classification ? (
        <div className="mt-5 rounded-2xl bg-soft p-4">
          <p className="text-sm">
            <span className="font-semibold">{classification.recordType}</span>
            {classification.tags.length ? <span className="text-muted"> · {classification.tags.map((tag) => `#${tag}`).join(" ")}</span> : null}
          </p>
          <p className="mt-1 text-xs text-muted">{classification.reason}</p>
        </div>
      ) : null}

      {extraction ? (
        <div className="mt-5 rounded-2xl bg-soft p-4">
          <dl className="grid gap-2 sm:grid-cols-2">
            {Object.entries(extraction).filter(([, value]) => value).map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs uppercase tracking-[.12em] text-muted">{key}</dt>
                <dd className="text-sm font-medium">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
