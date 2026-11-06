import { useEffect, useRef, useState } from "react";
import {
  Archive, ArrowDownUp, Folder, Search, SlidersHorizontal, Tag, Trash2,
} from "lucide-react";
import { Button, Input, Label, RecordTypeIcon, recordTypeLabel } from "@data-vault/ui";
import { Modal } from "../../components/feedback";

export interface ViewFilterState {
  search?: string | undefined;
  recordType?: string | undefined;
  tag?: string | undefined;
  folderName?: string | undefined;
  archived?: boolean | undefined;
  trash?: boolean | undefined;
  sort?: string | undefined;
  direction?: string | undefined;
}

interface SaveViewModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  isPending: boolean;
  error?: Error | null | undefined;
  filters: ViewFilterState;
  totalMatches?: number | undefined;
}

const SORT_LABELS: Record<string, string> = {
  createdAt: "Date saved",
  updatedAt: "Date updated",
  title: "Title",
  recordType: "Type",
};

export function getSuggestedViewName(filters: ViewFilterState): string {
  const parts: string[] = [];
  if (filters.folderName && filters.folderName !== "All folders") {
    parts.push(filters.folderName);
  }
  if (filters.tag) {
    parts.push(`#${filters.tag}`);
  }
  if (filters.recordType) {
    parts.push(recordTypeLabel(filters.recordType));
  }
  if (filters.search) {
    parts.push(`"${filters.search}"`);
  }
  if (filters.trash) {
    parts.push("Trash");
  } else if (filters.archived) {
    parts.push("Archived");
  }

  return parts.length > 0 ? parts.join(" · ") : "My view";
}

export function SaveViewModal({
  open,
  onClose,
  onSave,
  isPending,
  error,
  filters,
  totalMatches,
}: SaveViewModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    setName(getSuggestedViewName(filters));

    // Auto-select text after opening so user can press enter to keep or immediately type over it
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);

    return () => window.clearTimeout(timer);
  }, [open, filters]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isPending) return;
    onSave(trimmed);
  };

  const sortName = SORT_LABELS[filters.sort ?? "createdAt"] ?? filters.sort ?? "Date saved";
  const sortDirection = filters.direction === "asc" ? "Oldest first" : "Newest first";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save this view"
      subtitle="Save your active filters, folder, and search as a shortcut in your sidebar."
      width="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label htmlFor="view-name" className="mb-0">
              View name
            </Label>
            <span className="text-xs text-muted">
              {name.length}/80
            </span>
          </div>
          <Input
            ref={inputRef}
            id="view-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="e.g. Research, Highlights, Unprocessed..."
            required
            autoComplete="off"
          />
        </div>

        {/* View Configuration Summary */}
        <div className="rounded-2xl border border-line bg-surface/70 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted">
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal className="size-3.5" />
              Included in this view
            </span>
            {typeof totalMatches === "number" ? (
              <span className="font-normal normal-case text-muted">
                {totalMatches} {totalMatches === 1 ? "item" : "items"}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-1.5 pt-0.5 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-soft/70 px-2.5 py-1 text-strong">
              <Folder className="size-3 text-muted shrink-0" />
              <span className="text-muted">Folder:</span>
              <span className="font-medium">{filters.folderName ?? "All folders"}</span>
            </span>

            {filters.search ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-soft/70 px-2.5 py-1 text-strong">
                <Search className="size-3 text-muted shrink-0" />
                <span className="text-muted">Search:</span>
                <span className="font-medium">"{filters.search}"</span>
              </span>
            ) : null}

            {filters.recordType ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-soft/70 px-2.5 py-1 text-strong">
                <RecordTypeIcon type={filters.recordType} className="size-3 text-muted shrink-0" />
                <span className="text-muted">Type:</span>
                <span className="font-medium">{recordTypeLabel(filters.recordType)}</span>
              </span>
            ) : null}

            {filters.tag ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-soft/70 px-2.5 py-1 text-strong">
                <Tag className="size-3 text-muted shrink-0" />
                <span className="text-muted">Tag:</span>
                <span className="font-medium">#{filters.tag}</span>
              </span>
            ) : null}

            {filters.trash ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-2.5 py-1 text-red-800 dark:text-red-200 font-medium">
                <Trash2 className="size-3 shrink-0" />
                <span>Trash</span>
              </span>
            ) : filters.archived ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-soft/70 px-2.5 py-1 text-strong font-medium">
                <Archive className="size-3 text-muted shrink-0" />
                <span>Archived</span>
              </span>
            ) : null}

            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-soft/70 px-2.5 py-1 text-strong">
              <ArrowDownUp className="size-3 text-muted shrink-0" />
              <span className="text-muted">Sort:</span>
              <span className="font-medium">{sortName} ({sortDirection})</span>
            </span>
          </div>
        </div>

        <p className="text-xs leading-5 text-muted">
          A view saves all current search and filter settings. Clicking the view in your sidebar restores this exact view in one click.
        </p>

        {error ? (
          <p className="text-xs text-red-600 dark:text-red-400">
            {error.message || "Failed to save view. Please try again."}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || isPending}>
            {isPending ? "Saving view…" : "Save view"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
