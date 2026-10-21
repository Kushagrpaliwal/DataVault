import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Keyboard } from "lucide-react";
import { Button } from "@data-vault/ui";
import { browser } from "wxt/browser";
import { applyShortcut, readCommandStates, type CommandState } from "../lib/commands";

/**
 * The keys Chrome keeps for itself.
 *
 * Chrome hands these to an extension only if the user insists, and it can
 * take them back at any moment. A shortcut on one of them may simply never
 * arrive, so the ones that are pressed by accident are shown to keep people
 * away from them.
 */
const CHROME_KEYS: Array<[string, string]> = [
  ["Ctrl+D", "Bookmark this tab"],
  ["Ctrl+Shift+D", "Bookmark all tabs"],
  ["Ctrl+Shift+A", "Search tabs"],
  ["Ctrl+Shift+B", "Show the bookmarks bar"],
  ["Ctrl+Shift+C", "Inspect the element"],
  ["Ctrl+Shift+I", "Developer tools"],
  ["Ctrl+Shift+N", "Incognito window"],
  ["Ctrl+Shift+O", "Bookmark manager"],
  ["Ctrl+Shift+T", "Reopen the closed tab"],
  ["Ctrl+Shift+W", "Close the window"],
  ["Ctrl+F", "Find on the page"],
  ["Ctrl+L", "Go to the address bar"],
  ["Ctrl+P", "Print"],
  ["Ctrl+R", "Reload the page"],
  ["Ctrl+S", "Save the page"],
  ["Ctrl+T", "New tab"],
  ["Ctrl+W", "Close the tab"],
];

/**
 * The shortcut panel.
 *
 * Every command of the extension is listed with the key it has now, or with
 * "Not set" when it has none. A key that Chrome keeps for itself is called
 * out, and a free one is offered beside it, so a command that has no key
 * can be given one without guessing.
 */
export function ShortcutHelp() {
  const [commands, setCommands] = useState<CommandState[]>([]);
  const [showTaken, setShowTaken] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const load = () => {
    void readCommandStates().then(setCommands).catch(() => undefined);
  };

  useEffect(() => {
    load();
    /**
     * The keys can be changed in another tab, on the page where Chrome sets
     * them. The list is read again when the person comes back.
     */
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(null), 2_000);
    } catch {
      setCopied(null);
    }
  };

  /**
   * Use the key that is offered.
   *
   * Chrome only lets the person choose the keys, so the key is copied and
   * the page where they can choose it is opened. In the browsers that allow
   * an extension to do it, the key is set straight away.
   */
  const chooseKey = async (command: CommandState) => {
    const changed = await applyShortcut(command.id, command.suggested);
    if (changed) {
      setApplied(command.id);
      setTimeout(() => setApplied(null), 2_000);
      load();
      return;
    }
    await copy(command.suggested);
    await browser.tabs.create({ url: "chrome://extensions/shortcuts" });
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-muted"><Keyboard className="size-3.5" />Shortcuts</p>
      <p className="mt-1 text-xs leading-5 text-muted">
        Chrome chooses the keys: press <strong>Change shortcuts</strong>, then the pencil beside a command.
      </p>

      {commands.length ? (
        <dl className="mt-2 space-y-2 text-sm">
          {commands.map((command) => (
            <div key={command.id} className="flex items-center justify-between gap-3">
              <dt className="min-w-0">
                <span className="block font-medium">{command.label}</span>
                {command.conflicts ? (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-danger">
                    <AlertTriangle className="size-3" />Chrome keeps {command.shortcut}
                  </span>
                ) : null}
                {command.suggested && command.suggested !== command.shortcut ? (
                  <button
                    onClick={() => void chooseKey(command)}
                    title="Copy this key and open the page where shortcuts are set"
                    className="mt-1 flex items-center gap-1.5 rounded-lg bg-soft px-2 py-1 text-xs font-medium hover:bg-hover"
                  >
                    <kbd className="rounded border border-line bg-surface px-1 py-0.5 text-[11px]">{command.suggested}</kbd>
                    {copied === command.suggested
                      ? <Check className="size-3 text-green-600" />
                      : <Copy className="size-3 text-muted" />}
                    {applied === command.id
                      ? "Set"
                      : copied === command.suggested
                        ? "Copied — press it on the page that opens"
                        : "Use this one"}
                  </button>
                ) : null}
              </dt>
              <dd className="shrink-0">
                {command.shortcut ? (
                  <kbd className="rounded-md border border-line bg-soft px-1.5 py-0.5 text-[11px]">{command.shortcut}</kbd>
                ) : (
                  <span className="rounded-md border border-dashed border-line-strong px-1.5 py-0.5 text-[11px] text-muted">Not set</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-xs leading-5 text-muted">
          The shortcuts of this extension could not be read. They are on the page where shortcuts are set.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-2">
        <Button size="sm" variant="secondary" onClick={() => void browser.tabs.create({ url: "chrome://extensions/shortcuts" })}>
          Change shortcuts
        </Button>
        <button onClick={() => setShowTaken((open) => !open)} className="text-xs underline">
          {showTaken ? "Hide the keys Chrome uses" : "See the keys Chrome already uses"}
        </button>
      </div>

      {showTaken ? (
        <div className="mt-2 rounded-xl bg-soft p-3">
          <p className="text-xs leading-5 text-strong">
            Chrome keeps these keys for itself, so pick one that is not on this list.
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {CHROME_KEYS.map(([keys, purpose]) => (
              <li key={keys} className="flex items-start justify-between gap-2">
                <kbd className="shrink-0 rounded border border-line bg-surface px-1 py-0.5 text-[11px]">{keys}</kbd>
                <span className="text-right text-muted">{purpose}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
