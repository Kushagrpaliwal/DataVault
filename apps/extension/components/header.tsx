import { ExternalLink } from "lucide-react";
import { WEB_URL } from "../lib/api";

export function ExtensionHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className="flex items-center gap-2 border-b border-line px-4 py-3">
      <span className="grid size-8 place-items-center rounded-xl bg-ink font-semibold text-canvas">D</span>
      <div className="min-w-0">
        <h1 className="font-semibold leading-tight">DataVault</h1>
        {!compact ? <p className="text-[11px] text-muted">Save anything from the web</p> : null}
      </div>
      <button
        className="ml-auto text-strong hover:text-ink"
        title="Open DataVault"
        aria-label="Open DataVault"
        onClick={() => void chrome.tabs.create({ url: WEB_URL })}
      >
        <ExternalLink className="size-4" />
      </button>
    </header>
  );
}
