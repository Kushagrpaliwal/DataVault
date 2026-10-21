import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@data-vault/ui";
import type { AiClassificationResult, AiExtractionResult, AiSummaryResult } from "@data-vault/types";
import { useAuth } from "../lib/auth";
import { ErrorMessage, Modal, useToast } from "./feedback";

/**
 * The free AI allowance.
 *
 * The wording deliberately avoids the word "quota". Users are given a number
 * of credits that comes back each day, which is a far easier thing to
 * understand than a rate limit.
 */
export function useAiCredits() {
  const { api } = useAuth();
  return useQuery({ queryKey: ["ai-credits"], queryFn: () => api.aiCredits() });
}

export function AiCreditBadge() {
  const credits = useAiCredits();
  if (!credits.data?.available) return null;
  const locked = !credits.data.emailVerified || !credits.data.consented;
  if (locked) {
    return (
      <span
        title={credits.data.reason ?? "Confirm your email address to unlock AI credits."}
        className="flex items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 text-xs font-medium text-muted"
      >
        <Lock className="size-3.5" />
        AI locked
      </span>
    );
  }
  return (
    <span
      title={`${credits.data.remaining} of ${credits.data.allowance} free AI credits left today`}
      className="flex items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 text-xs font-medium text-strong"
    >
      <Sparkles className="size-3.5" />
      {credits.data.remaining} AI
    </span>
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

/**
 * The three AI actions: summarise, classify, and pull out fields.
 *
 * Each one spends a credit, so the buttons say how many are left. The first
 * use asks for permission to send content to the model provider, because on
 * the free tier that content may be used to improve the provider's products.
 */
export function AiPanel({ content, recordId, onApply }: AiPanelProps) {
  const { api } = useAuth();
  const client = useQueryClient();
  const { notify } = useToast();
  const credits = useAiCredits();
  const [summary, setSummary] = useState<AiSummaryResult | null>(null);
  const [classification, setClassification] = useState<AiClassificationResult | null>(null);
  const [extraction, setExtraction] = useState<AiExtractionResult | null>(null);
  const [declined, setDeclined] = useState(false);

  const consent = useMutation({
    mutationFn: () => api.aiConsent(),
    onSuccess: () => void credits.refetch(),
  });

  const run = useMutation({
    mutationFn: async (feature: "summarize" | "classify" | "extract") => {
      const body = recordId ? { recordId } : { text: content };
      if (feature === "summarize") return api.aiSummarize(body);
      if (feature === "classify") return api.aiClassify(body);
      return api.aiExtract(body);
    },
    onSuccess: (result, feature) => {
      void client.invalidateQueries({ queryKey: ["ai-credits"] });
      if (feature === "summarize") setSummary(result.data as AiSummaryResult);
      else if (feature === "classify") {
        const data = result.data as AiClassificationResult;
        setClassification(data);
        onApply?.(data);
      } else setExtraction(result.data as AiExtractionResult);
      notify(result.cached ? "Already worked out — no credit used" : "Done");
    },
    onError: (error) => notify(error instanceof Error ? error.message : "That did not work", "error"),
  });

  const status = credits.data;
  const locked = status?.available === false;
  const reason = status?.reason;
  const remaining = status?.remaining ?? 0;
  const needsConsent = status?.available === true && !status.consented && !declined;

  if (needsConsent) {
    return (
      <Modal open onClose={() => setDeclined(true)} title="Send content to Google for AI features">
        <p className="text-sm leading-6 text-strong">
          AI features work by sending the text you choose to Google&apos;s Gemini model. The free tier we use may allow Google to use that content to improve their products.
        </p>
        <p className="mt-3 text-sm leading-6 text-strong">
          We send only the text you ask about, never your whole library, and you can stop at any time by not using AI features.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button disabled={consent.isPending} onClick={() => consent.mutate()}>
            {consent.isPending ? "Saving…" : "Agree and continue"}
          </Button>
          <Button variant="ghost" onClick={() => setDeclined(true)}>Not now</Button>
        </div>
        {consent.error ? (
          <div className="mt-4">
            <ErrorMessage message={consent.error instanceof Error ? consent.error.message : "Could not save your choice."} />
          </div>
        ) : null}
      </Modal>
    );
  }

  return (
    <section className="panel p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-soft"><Sparkles className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">AI help</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            {locked
              ? reason
              : remaining > 0
                ? `Summarise this, suggest a type and tags, or pull out the details. ${remaining} free ${remaining === 1 ? "credit" : "credits"} left today.`
                : "You have used all of today's free AI credits. They come back when the day rolls over."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" disabled={locked || remaining <= 0 || run.isPending} onClick={() => run.mutate("summarize")}>
              <Wand2 className="size-4" />Summarise
            </Button>
            <Button size="sm" variant="secondary" disabled={locked || remaining <= 0 || run.isPending} onClick={() => run.mutate("classify")}>
              Suggest a type
            </Button>
            <Button size="sm" variant="secondary" disabled={locked || remaining <= 0 || run.isPending} onClick={() => run.mutate("extract")}>
              Pull out details
            </Button>
          </div>
          {run.error ? <p className="mt-3 text-sm text-red-700">{run.error instanceof Error ? run.error.message : "That did not work."}</p> : null}
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
