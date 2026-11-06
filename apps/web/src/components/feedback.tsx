import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, cn } from "@data-vault/ui";

export function ErrorMessage({ message }: { message: string }) {
  return <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-800 dark:text-red-200"><AlertCircle className="mt-0.5 size-4 shrink-0" />{message}</div>;
}

interface Toast { id: string; message: string; tone: "success" | "error" }
const ToastContext = createContext<{ notify: (message: string, tone?: Toast["tone"]) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = crypto.randomUUID(); setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3500);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return <ToastContext.Provider value={value}>{children}<div aria-live="polite" className="fixed bottom-5 right-5 z-[80] space-y-2">{toasts.map((toast) => <div key={toast.id} className={cn("flex max-w-sm items-center gap-2 rounded-xl border bg-surface px-4 py-3 text-sm shadow-lg", toast.tone === "error" ? "border-red-200 dark:border-red-900 text-red-800 dark:text-red-200" : "border-green-200 dark:border-green-900 text-green-800 dark:text-green-200")}>{toast.tone === "success" ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}{toast.message}</div>)}</div></ToastContext.Provider>;
}

export function useToast() { const value = useContext(ToastContext); if (!value) throw new Error("Missing ToastProvider"); return value; }

/**
 * A panel that sits over the page.
 *
 * The keyboard is kept inside the panel while it is open: escape closes it,
 * and tabbing past the last control comes back to the first one. The
 * control that opened the panel gets the focus back when it closes.
 */
export function Modal({
  open,
  title,
  subtitle,
  children,
  onClose,
  width = "max-w-xl",
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  width?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    const timer = window.setTimeout(() => {
      const autoFocusEl = panel.current?.querySelector<HTMLElement>("[autofocus]");
      if (autoFocusEl) {
        autoFocusEl.focus();
      } else {
        panel.current?.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href]")?.focus();
      }
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.clearTimeout(timer);
      opener.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={cn("max-h-[90vh] w-full overflow-y-auto rounded-3xl border border-line bg-canvas p-6 shadow-xl", width)}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="modal-title" className="text-xl font-semibold">
              {title}
            </h2>
            {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
