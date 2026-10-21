import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "../components/feedback";

export function useVaultSync() {
  const queryClient = useQueryClient();
  const { notify } = useToast();

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      /**
       * Only messages from this page are trusted. Anything can post a
       * message into a window, so the sender and the origin are both checked
       * before the content is used.
       */
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!event.data || typeof event.data !== "object") return;
      const type = (event.data as { type?: string }).type;
      if (type === "DATA_VAULT_RECORD_SAVED") {
        const record = (event.data as { record?: { title?: string; sourceDomain?: string } }).record;
        void queryClient.invalidateQueries({ queryKey: ["records"] });
        void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        
        const title = record?.title || "New web clip";
        const domain = record?.sourceDomain ? ` from ${record.sourceDomain}` : "";
        notify(`✓ Saved${domain}: ${title}`);
      }
      if (type === "DATA_VAULT_NOTE_UPDATED") {
        const note = (event.data as { note?: { id?: string; title?: string } }).note;
        void queryClient.invalidateQueries({ queryKey: ["notes"] });
        void queryClient.invalidateQueries({ queryKey: ["note"] });
        notify(`✓ Added to ${note?.title || "your doc"}`);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [queryClient, notify]);
}
