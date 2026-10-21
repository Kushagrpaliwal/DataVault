import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Check, Copy, ExternalLink, Globe, Puzzle } from "lucide-react";
import { Badge, Button, EmptyState, RecordTypeIcon, RecordTypeLabel } from "@data-vault/ui";
import type { DashboardSummary, SavedRecord } from "@data-vault/types";
import { useAuth } from "../../lib/auth";
import { PageHeader, StatCard } from "../../components/page";
import { QueryState } from "../../components/data-state";
import { ExtensionInstallModal } from "../../components/extension-install";

interface DashboardData {
  summary: DashboardSummary;
  recentRecords: SavedRecord[];
}

export function DashboardPage() {
  const { api, organization } = useAuth();
  const query = useQuery({
    queryKey: ["dashboard", organization?.id],
    queryFn: () => api.dashboard() as Promise<unknown> as Promise<DashboardData>,
    enabled: Boolean(organization),
  });

  const summary = query.data?.summary;
  const totalSaved = summary?.savedRecords ?? 0;
  const isEmpty = totalSaved === 0;

  return (
    <>
      <PageHeader
        eyebrow={organization?.name ?? "Your workspace"}
        title="Overview"
        description="Everything you have saved, and where it came from."
      />
      <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()} />
      {query.data ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Saved items"
              value={totalSaved.toLocaleString()}
              tone="teal"
              hint="Everything you have kept"
            />
            <StatCard
              label="Saved this week"
              value={(summary?.savedThisWeek ?? 0).toLocaleString()}
              tone="lavender"
              hint="In the last 7 days"
            />
            <StatCard
              label="Sources"
              value={(summary?.uniqueSources ?? 0).toLocaleString()}
              tone="peach"
              hint="Websites you saved from"
            />
            <StatCard
              label="Last saved"
              value={summary?.lastSavedAt ? formatDistanceToNow(new Date(summary.lastSavedAt), { addSuffix: true }) : "—"}
              tone="cream"
              hint="Most recent addition"
            />
          </div>

          {isEmpty ? <GettingStarted /> : null}

          <RecentItemsSection
            records={query.data.recentRecords}
            title="Recently saved"
            subtitle="The latest items added to this workspace"
          />
        </div>
      ) : null}
    </>
  );
}

/**
 * The web app cannot capture anything on its own, so a brand-new workspace
 * used to look like a dead end. This explains the one flow that matters and
 * offers a working alternative for people who would rather not install an
 * extension.
 */
function GettingStarted() {
  const [installOpen, setInstallOpen] = useState(false);
  return (
    <>
    <section className="panel overflow-hidden">
      <div className="border-b border-line bg-deep p-6 text-white">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#a4d4c5]">
          <Puzzle className="size-4" />
          Get started
        </div>
        <h2 className="display mt-3 text-3xl">Save anything from the web</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">
          DataVault keeps the text you save, along with the page it came from, so you can find it again later.
        </p>
      </div>
      <div className="grid gap-px bg-line md:grid-cols-3">
        {[
          ["Install the extension", "Load DataVault from your browser’s extension page."],
          ["Select any text", "Highlight a paragraph, price, or link on any page."],
          ["Right-click and save", "Choose “Save to DataVault”. It shows up here instantly."],
        ].map(([title, description], index) => (
          <div key={title} className="bg-surface p-6">
            <span className="grid size-8 place-items-center rounded-full bg-ink text-sm font-semibold text-white">
              {index + 1}
            </span>
            <h3 className="mt-4 font-semibold">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 p-6">
        <Button onClick={() => setInstallOpen(true)}>
          <Puzzle className="size-4" />
          Install the extension
        </Button>
        <Link to="/saved" className="text-sm font-semibold underline">
          Or save a link by hand
        </Link>
      </div>
    </section>
    <ExtensionInstallModal open={installOpen} onClose={() => setInstallOpen(false)} />
    </>
  );
}

function RecentItemsSection({
  records,
  title,
  subtitle,
}: {
  records: SavedRecord[];
  title: string;
  subtitle: string;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line p-5">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
        <Badge tone="teal">All saved items</Badge>
      </div>
      {records.length === 0 ? (
        <div className="p-8">
          <EmptyState
            title="Nothing saved yet"
            description="Once you save something it will appear here, with the page it came from."
          />
        </div>
      ) : (
        <div className="divide-y divide-line">
          {records.map((record) => (
            <ItemCard key={record.id} record={record} />
          ))}
        </div>
      )}
    </section>
  );
}

function ItemCard({ record }: { record: SavedRecord }) {
  const [copied, setCopied] = useState(false);

  const copySnippet = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (record.originalText) {
      void navigator.clipboard.writeText(record.originalText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="p-4 transition-colors hover:bg-hover">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-soft">
          {record.sourceDomain ? <Globe className="size-4 text-strong" /> : <RecordTypeIcon type={record.recordType} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Link to={`/saved/${record.id}`} className="truncate text-sm font-semibold hover:underline">
              {record.title}
            </Link>
            <span className="shrink-0 text-xs text-muted">
              {formatDistanceToNow(new Date(record.createdAt), { addSuffix: true })}
            </span>
          </div>

          {record.originalText ? (
            <p className="mt-1.5 line-clamp-2 rounded-lg border border-line bg-surface p-2 font-mono text-xs text-strong">
              {record.originalText}
            </p>
          ) : null}

          <div className="mt-2.5 flex items-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-1">
              <RecordTypeIcon type={record.recordType} className="size-3" />
              <RecordTypeLabel type={record.recordType} />
            </span>

            {record.sourceDomain ? (
              <span className="flex items-center gap-1">
                <Globe className="size-3" />
                {record.sourceUrl ? (
                  <a
                    href={record.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-xs truncate text-blue-700 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {record.sourceDomain}
                  </a>
                ) : (
                  <span>{record.sourceDomain}</span>
                )}
              </span>
            ) : null}

            {record.originalText ? (
              <button
                type="button"
                onClick={copySnippet}
                className="flex items-center gap-1 transition-colors hover:text-black"
                title="Copy saved text"
              >
                {copied ? <Check className="size-3 text-green-600" /> : <Copy className="size-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            ) : null}

            <span className="ml-auto shrink-0 text-muted">{format(new Date(record.createdAt), "dd MMM yyyy")}</span>

            <Link
              to={`/saved/${record.id}`}
              className="flex shrink-0 items-center gap-1 font-medium hover:text-black"
            >
              Details
              <ExternalLink className="size-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
