import { useCallback, useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";

export type SaveStatus = "idle" | "saving" | "saved" | "offline" | "conflict" | "error";

export interface AutosaveOptions {
  /** The version the editor started from. */
  baseVersion: number;
  /** Called when the doc has to be saved. It returns the new version. */
  save: (content: JSONContent, baseVersion: number) => Promise<number>;
  /** How long to wait after the last keystroke. */
  delay?: number;
  /** True when there are changes that have not been saved yet. */
  dirty: boolean;
}

export interface AutosaveResult {
  status: SaveStatus;
  error: string | null;
  /** The newest version the server knows about. */
  version: number;
  /** Hand the newest content over. It is saved a moment later. */
  queue: (content: JSONContent) => void;
  /** Save right now, rather than waiting for the next pause in typing. */
  saveNow: () => Promise<void>;
  /** Say which version the next save is based on. */
  rebase: (version: number) => void;
}

/**
 * Save the doc a moment after the user stops typing.
 *
 * The version the editor started from is sent with every save. When the doc
 * has moved on, the server refuses the change and the caller is told, so
 * nothing that was saved in the meantime is quietly thrown away.
 */
export function useAutosave({ baseVersion, save, delay = 800, dirty }: AutosaveOptions): AutosaveResult {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(baseVersion);
  const timer = useRef<number | undefined>(undefined);
  const content = useRef<JSONContent | null>(null);
  /**
   * The version the next save is based on.
   *
   * It only ever moves forward when a save succeeds. A newer version on the
   * server does not change it, because then a piece added from the browser
   * would be quietly overwritten instead of being merged in.
   */
  const knownVersion = useRef(baseVersion);

  const saveNow = useCallback(async () => {
    const current = content.current;
    if (!current) return;
    setStatus("saving");
    setError(null);
    try {
      const next = await save(current, knownVersion.current);
      knownVersion.current = next;
      setVersion(next);
      setStatus("saved");
    } catch (caught) {
      const code = (caught as { code?: string })?.code;
      if (code === "NOTE_VERSION_CONFLICT") {
        setStatus("conflict");
        return;
      }
      setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
      setError(caught instanceof Error ? caught.message : "The doc could not be saved.");
    }
  }, [save]);

  /**
   * The editor hands over its content whenever it changes. The save is
   * started a moment later, so a burst of typing is only saved once.
   */
  const queue = useCallback((next: JSONContent) => {
    content.current = next;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveNow(), delay);
  }, [delay, saveNow]);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  /**
   * When the connection comes back, the waiting changes are saved right away
   * rather than waiting for the next keystroke.
   */
  useEffect(() => {
    const onOnline = () => { if (dirty) void saveNow(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [dirty, saveNow]);

  const rebase = useCallback((next: number) => {
    knownVersion.current = next;
    setVersion(next);
  }, []);

  return { status, error, version, queue, saveNow, rebase };
}
