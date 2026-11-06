import { useCallback, useEffect, useState } from "react";
import { DataVaultApiError } from "@data-vault/api-client";
import type { AiStatus, AiSummaryResult } from "@data-vault/types";
import { withOrganization } from "./api";

/** Read the BYOK provider state used by the website and extension. */
export function useAiStatus(enabled = true) {
  const [status, setStatus] = useState<AiStatus>();
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      setStatus(await withOrganization((api) => api.aiStatus()));
    } catch {
      setStatus(undefined);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { status, loading, refresh };
}

export type AiBlockReason = "setup" | "busy" | "forbidden" | "error";

export interface AiFailure {
  reason: AiBlockReason;
  message: string;
  /** Set when the user has to open Settings first. */
  needsWebsite: boolean;
}

/** Turn provider setup and API errors into a useful next step. */
export function describeAiFailure(error: unknown): AiFailure {
  if (error instanceof DataVaultApiError) {
    switch (error.code) {
      case "AI_CONNECTION_REQUIRED":
      case "AI_KEY_UNREADABLE":
      case "AI_KEYS_UNAVAILABLE":
      case "AI_EMBEDDING_UNSUPPORTED":
        return { reason: "setup", message: error.message || "Configure your AI provider in DataVault Settings (BYOK).", needsWebsite: true };
      case "AI_RATE_LIMITED":
        return { reason: "busy", message: "Your provider is busy. Give it a moment and try again.", needsWebsite: false };
      case "PERMISSION_DENIED":
        return { reason: "forbidden", message: "You do not have permission to use AI features in this workspace.", needsWebsite: true };
      default:
        return { reason: "error", message: error.message || "That did not work.", needsWebsite: false };
    }
  }
  return { reason: "error", message: error instanceof Error ? error.message : "That did not work.", needsWebsite: false };
}

/** Summarise a saved item with the user's connected provider. */
export async function summariseItem(recordId: string): Promise<AiSummaryResult> {
  const result = await withOrganization((api) => api.aiSummarize({ recordId }));
  return result.data;
}
