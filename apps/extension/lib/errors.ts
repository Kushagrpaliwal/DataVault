import { browser } from "wxt/browser";

const ERROR_KEY = "dataVaultErrorsV1";

export interface RecordedError {
  /** Where it happened. */
  scope: string;
  /** What went wrong. */
  message: string;
  /** When it happened. */
  at: string;
}

/**
 * Keep the last few problems, so the side panel can show them.
 *
 * Chrome keeps its own list of extension errors, but it is hidden behind the
 * extensions page. Showing them in the panel means the person can see what
 * went wrong without leaving the browser.
 */
export async function recordExtensionError(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const stored = (await browser.storage.local.get(ERROR_KEY))[ERROR_KEY] as RecordedError[] | undefined;
    const next: RecordedError[] = [{ scope, message, at: new Date().toISOString() }, ...(stored ?? [])].slice(0, 10);
    await browser.storage.local.set({ [ERROR_KEY]: next });
  } catch { /* there is nowhere to keep it */ }
}

/** The problems that have been recorded. */
export async function readExtensionErrors(): Promise<RecordedError[]> {
  try {
    const stored = (await browser.storage.local.get(ERROR_KEY))[ERROR_KEY] as RecordedError[] | undefined;
    return stored ?? [];
  } catch {
    return [];
  }
}

/** Forget the recorded problems. */
export async function clearExtensionErrors() {
  try {
    await browser.storage.local.remove(ERROR_KEY);
  } catch { /* there is nothing to clear */ }
}
