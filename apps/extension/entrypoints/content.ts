import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";

const webOrigin = new URL(import.meta.env.VITE_WEB_URL ?? "http://localhost:5173").origin;

export default defineContentScript({
  matches: [`${webOrigin}/*`],
  main() {
    document.documentElement.dataset.dataVaultExtension = browser.runtime.getManifest().version;

    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== "object") return undefined;
      const msg = message as { action?: string; record?: unknown; note?: unknown };
      if (msg.action === "get-selection") {
        return {
          selectedText: window.getSelection()?.toString().trim() ?? "",
          pageTitle: document.title,
          pageUrl: location.href,
        };
      }
      if (msg.action === "datavault-record-saved") {
        /**
         * The message goes to this page only. The address is used instead of
         * a wildcard so no other page can read what was saved.
         */
        window.postMessage(
          {
            type: "DATA_VAULT_RECORD_SAVED",
            record: msg.record,
          },
          location.origin
        );
      }
      if (msg.action === "datavault-note-updated") {
        window.postMessage(
          {
            type: "DATA_VAULT_NOTE_UPDATED",
            note: msg.note,
          },
          location.origin
        );
      }
      return undefined;
    });
  },
});
