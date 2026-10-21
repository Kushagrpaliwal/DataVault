import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string | undefined; title: string; description?: string | undefined; actions?: ReactNode | undefined }) {
  return <header className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div>{eyebrow ? <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-muted">{eyebrow}</p> : null}<h1 className="display text-3xl md:text-4xl">{title}</h1>{description ? <p className="mt-2 max-w-2xl text-sm text-muted md:text-base">{description}</p> : null}</div>{actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}</header>;
}

export function StatCard({ label, value, hint, tone = "cream" }: { label: string; value: ReactNode; hint?: string; tone?: "cream" | "pink" | "teal" | "lavender" | "peach" }) {
  /**
   * The pale colours keep dark words in both themes, because the colour
   * itself does not change when the page is turned over.
   */
  const colors = { cream: "bg-soft text-ink", pink: "bg-[#ff4d8b] text-white", teal: "bg-deep text-white", lavender: "bg-[#b8a4ed] text-deep", peach: "bg-[#ffb084] text-deep" };
  return <div className={`min-h-36 rounded-3xl p-5 ${colors[tone]}`}><p className="text-sm opacity-80">{label}</p><div className="mt-5 text-2xl font-semibold tabular-nums">{value}</div>{hint ? <p className="mt-1 text-xs opacity-80">{hint}</p> : null}</div>;
}
