import { Puzzle } from "lucide-react";
import { Button } from "@data-vault/ui";
import { Modal } from "./feedback";

/**
 * How to put the extension into the browser.
 *
 * A browser will not open its own extension page from a web page, so the
 * button used to do nothing at all. The steps are written out instead, with
 * the one page to open.
 */
export function ExtensionInstallModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Install the DataVault extension">
      <ol className="space-y-3 text-sm leading-6 text-strong">
        <li className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-soft text-xs font-semibold">1</span>
          <span>Open your browser’s extension page: <strong>chrome://extensions</strong> in Chrome or Edge, <strong>about:addons</strong> in Firefox.</span>
        </li>
        <li className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-soft text-xs font-semibold">2</span>
          <span>Turn on <strong>Developer mode</strong>.</span>
        </li>
        <li className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-soft text-xs font-semibold">3</span>
          <span>Choose <strong>Load unpacked</strong> and pick the <code className="rounded bg-soft px-1 py-0.5 text-xs">apps/extension/.output/chrome-mv3</code> folder. Build it first with <code className="rounded bg-soft px-1 py-0.5 text-xs">bun run build:extension</code>.</span>
        </li>
        <li className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-soft text-xs font-semibold">4</span>
          <span>Open DataVault and choose <strong>Sign in</strong>. Then select any text on a page, right-click it, and choose <strong>Save to DataVault</strong>.</span>
        </li>
      </ol>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button onClick={() => { window.open("https://docs.datavault.app/extension", "_blank", "noopener"); onClose(); }}>
          <Puzzle className="size-4" />
          Read the guide
        </Button>
      </div>
    </Modal>
  );
}
