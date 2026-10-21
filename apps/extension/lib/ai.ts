import { useCallback, useEffect, useState } from "react";
import { DataVaultApiError } from "@data-vault/api-client";
import type { AiCreditStatus, AiSummaryResult } from "@data-vault/types";
import { withOrganization } from "./api";

/**
 * The user's free AI allowance.
 *
 * The extension asks the same API the website uses, so the two never show
 * different numbers.
 */
export function useAiCredits(enabled = true) {
  const [status, setStatus] = useState<AiCreditStatus>();
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      setStatus(await withOrganization((api) => api.aiCredits()));
    } catch {
      setStatus(undefined);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { status, loading, refresh };
}

export type AiBlockReason = "unavailable" | "unverified" | "consent" | "no-credits" | "busy" | "forbidden" | "error";

export interface AiFailure {
  reason: AiBlockReason;
  message: string;
  /** Set when the user has to do something on the website first. */
  needsWebsite: boolean;
}

/**
 * Turn an API error into something a person can act on.
 *
 * The API deliberately distinguishes the reasons, so the extension can say
 * the right thing instead of showing a generic failure.
 */
export function describeAiFailure(error: unknown): AiFailure {
  if (error instanceof DataVaultApiError) {
    switch (error.code) {
      case "AI_NOT_AVAILABLE":
        return { reason: "unavailable", message: "AI features are not switched on for this server yet.", needsWebsite: false };
      case "EMAIL_NOT_VERIFIED":
        return { reason: "unverified", message: "Confirm your email address on the DataVault website to unlock AI credits.", needsWebsite: true };
      case "AI_CONSENT_REQUIRED":
        return { reason: "consent", message: "Agree to send content to Google before using AI features.", needsWebsite: true };
      case "NO_CREDITS_REMAINING":
        return { reason: "no-credits", message: "You have used all of today's free AI credits. They come back when the day rolls over.", needsWebsite: false };
      case "AI_BUDGET_EXHAUSTED":
        return { reason: "busy", message: "The free AI allowance for today has been used up. Please try again tomorrow.", needsWebsite: false };
      case "AI_RATE_LIMITED":
        return { reason: "busy", message: "Too many AI requests in a row. Give it a moment.", needsWebsite: false };
      case "PERMISSION_DENIED":
        return { reason: "forbidden", message: "You do not have permission to use AI features in this workspace.", needsWebsite: true };
      default:
        return { reason: "error", message: error.message || "That did not work.", needsWebsite: false };
    }
  }
  return { reason: "error", message: error instanceof Error ? error.message : "That did not work.", needsWebsite: false };
}

/** Summarise a saved item, spending one credit. */
export async function summariseItem(recordId: string): Promise<AiSummaryResult> {
  const result = await withOrganization((api) => api.aiSummarize({ recordId }));
  return result.data;
}

/** Record the agreement to send content to the model provider. */
export async function recordAiConsent(): Promise<void> {
  await withOrganization((api) => api.aiConsent());
}
