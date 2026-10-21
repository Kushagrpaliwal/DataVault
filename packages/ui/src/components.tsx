import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import {
  Bookmark, DatabaseZap, File, FileText, Globe, Highlighter, Image, Inbox, Lightbulb,
  LoaderCircle, Quote, ScrollText, ShoppingBag, StickyNote, Tags, UserRound, Zap,
} from "lucide-react";
import { cn } from "./utils";

const buttonVariants = cva("inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#1a3a3a] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: {
      primary: "bg-[#0a0a0a] text-white hover:bg-[#1f1f1f]",
      secondary: "border border-[#ded8ca] bg-[#fffaf0] text-[#0a0a0a] hover:bg-[#f5f0e0]",
      ghost: "text-[#3a3a3a] hover:bg-[#f5f0e0]",
      danger: "bg-red-600 text-white hover:bg-red-700",
    },
    size: { sm: "min-h-8 rounded-lg px-3 text-xs", md: "min-h-10", lg: "min-h-11 px-5" },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export function Button({ asChild, className, variant, size, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-11 w-full rounded-xl border border-[#ded8ca] bg-[#fffdf8] px-3 text-sm text-[#0a0a0a] outline-none placeholder:text-[#6a6a6a] focus:border-[#1a3a3a] focus:ring-1 focus:ring-[#1a3a3a]", className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-[#3a3a3a]", className)} {...props} />;
}

export function Badge({ className, tone = "neutral", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "warning" | "danger" | "teal" }) {
  const tones = { neutral: "bg-[#f5f0e0] text-[#3a3a3a]", success: "bg-green-100 text-green-800", warning: "bg-amber-100 text-amber-800", danger: "bg-red-100 text-red-800", teal: "bg-[#dce9e5] text-[#1a3a3a]" };
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", tones[tone], className)} {...props} />;
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 p-8 text-sm text-[#6a6a6a]"><LoaderCircle aria-hidden className="size-4 animate-spin" />{label}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center"><Inbox aria-hidden className="mb-4 size-9 text-[#9a9a9a]" /><h3 className="font-semibold">{title}</h3><p className="mt-1 max-w-sm text-sm text-[#6a6a6a]">{description}</p>{action ? <div className="mt-4">{action}</div> : null}</div>;
}

/**
 * Icons for every record type. Unknown types fall back to a generic database
 * glyph so a new backend type never renders as a blank slot.
 */
const recordTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  article: ScrollText,
  quote: Quote,
  statistic: Zap,
  definition: Lightbulb,
  person: UserRound,
  product: ShoppingBag,
  event: Tags,
  note: StickyNote,
  highlight: Highlighter,
  webpage: Globe,
  document: File,
  link: FileText,
  image: Image,
  bookmark: Bookmark,
  other: DatabaseZap,
};

export function RecordTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = recordTypeIcons[type] ?? DatabaseZap;
  return <Icon aria-hidden className={cn("size-4", className)} />;
}

/**
 * User-facing labels for record types. The raw enum values are an API contract
 * and must not change, but they are lowercase identifiers that read poorly in
 * the interface, so every picker renders through this map instead.
 */
export const RECORD_TYPE_LABELS: Record<string, string> = {
  article: "Article",
  quote: "Quote",
  statistic: "Statistic",
  definition: "Definition",
  person: "Person",
  product: "Product",
  event: "Event",
  note: "Note",
  webpage: "Webpage",
  highlight: "Highlight",
  document: "Document",
  image: "Image",
  bookmark: "Bookmark",
  link: "Link",
  other: "Other",
};

export function recordTypeLabel(type: string | null | undefined) {
  if (!type) return "Other";
  return RECORD_TYPE_LABELS[type] ?? "Other";
}

/**
 * The record types offered in the simplified pickers, in display order.
 *
 * These are the ones a person is likely to reach for. The rest stay
 * reachable through "Other", so nothing becomes unsaveable.
 */
export const PRIMARY_RECORD_TYPES = [
  "article", "quote", "statistic", "highlight", "note", "webpage", "other",
] as const;

export function RecordTypeLabel({ type, className }: { type: string; className?: string }) {
  return <span className={cn("capitalize", className)}>{recordTypeLabel(type)}</span>;
}
