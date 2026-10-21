import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Button, cn } from "@data-vault/ui";

export function ErrorMessage({ message }: { message: string }) {
  return <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="mt-0.5 size-4 shrink-0" />{message}</div>;
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
  return <ToastContext.Provider value={value}>{children}<div aria-live="polite" className="fixed bottom-5 right-5 z-[80] space-y-2">{toasts.map((toast) => <div key={toast.id} className={cn("flex max-w-sm items-center gap-2 rounded-xl border bg-white px-4 py-3 text-sm shadow-lg", toast.tone === "error" ? "border-red-200 text-red-800" : "border-green-200 text-green-800")}>{toast.tone === "success" ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}{toast.message}</div>)}</div></ToastContext.Provider>;
}

export function useToast() { const value = useContext(ToastContext); if (!value) throw new Error("Missing ToastProvider"); return value; }

export function Modal({ open, title, children, onClose, width = "max-w-xl" }: { open: boolean; title: string; children: ReactNode; onClose: () => void; width?: string }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={cn("max-h-[90vh] w-full overflow-y-auto rounded-3xl border border-[#dfd8c8] bg-[#fffaf0] p-6 shadow-xl", width)}><div className="mb-5 flex items-center justify-between"><h2 id="modal-title" className="text-xl font-semibold">{title}</h2><Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}><X className="size-4" /></Button></div>{children}</div></div>;
}
