import { Badge, EmptyState, LoadingState, RecordTypeIcon, recordTypeLabel } from "@data-vault/ui";
import type { SavedRecord } from "@data-vault/types";
import { formatDistanceToNow } from "date-fns";
import { Trash2 } from "lucide-react";
import { WEB_URL } from "../lib/api";

export function RecordList({ records, loading, empty = "No saved items yet.", onSelect, onDelete }: {
  records?: SavedRecord[] | undefined;
  loading?: boolean | undefined;
  empty?: string | undefined;
  onSelect?: ((record: SavedRecord) => void) | undefined;
  onDelete?: ((record: SavedRecord) => void) | undefined;
}) {
  if (loading) return <LoadingState label="Loading your saved items…" />;
  if (!records?.length) return <EmptyState title="Nothing here yet" description={empty} />;
  return (
    <div className="divide-y divide-line-soft">
      {records.map((record) => (
        <div key={record.id} className="flex items-center hover:bg-hover">
          <button
            className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
            onClick={() => onSelect ? onSelect(record) : void chrome.tabs.create({ url: `${WEB_URL}/saved/${record.id}` })}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-soft"><RecordTypeIcon type={record.recordType} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{record.title}</span>
              <span className="mt-0.5 block truncate text-xs text-muted">
                {record.sourceDomain ?? recordTypeLabel(record.recordType)} · {formatDistanceToNow(new Date(record.createdAt), { addSuffix: true })}
              </span>
            </span>
            <Badge className="shrink-0" tone="neutral">{recordTypeLabel(record.recordType)}</Badge>
          </button>
          {onDelete ? (
            <button
              className="mr-3 rounded-lg p-2 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
              title={`Move ${record.title} to Trash`}
              aria-label={`Move ${record.title} to Trash`}
              onClick={() => onDelete(record)}
            >
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
