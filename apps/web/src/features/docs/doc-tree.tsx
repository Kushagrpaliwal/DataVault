import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FilePlus2, Pin, Star, Trash2 } from "lucide-react";
import { cn } from "@data-vault/ui";
import type { NoteSummary } from "@data-vault/types";

/**
 * The docs of the workspace, as a tree.
 *
 * A doc may sit inside another doc, which is how a folder of notes is
 * made. The list is flat when it comes from the server, and it is put back
 * into a tree here, because a person thinks of their notes as a set of
 * things inside other things.
 */

interface DocTreeProps {
  notes: NoteSummary[];
  activeId: string | undefined;
  /** The doc the browser extension adds to. */
  currentId: string | undefined;
  onOpen: (id: string) => void;
  onMakeCurrent: (id: string) => void;
  /** A new doc is made inside the one that was asked for. */
  onNewSubpage: (parentId: string) => void;
  onDelete?: ((id: string, title: string) => void) | undefined;
}

interface Tree {
  roots: NoteSummary[];
  children: Map<string, NoteSummary[]>;
}

/**
 * The docs, put into a tree.
 *
 * A doc whose parent is not in the list, because the parent was trashed or
 * is in another workspace, is shown at the top rather than being lost. A
 * doc that is in a loop is also shown at the top, so that the list always
 * shows every doc.
 */
function buildTree(notes: NoteSummary[]): Tree {
  const known = new Set(notes.map((note) => note.id));
  const children = new Map<string, NoteSummary[]>();
  const roots: NoteSummary[] = [];

  for (const note of notes) {
    const parent = note.parentId && known.has(note.parentId) ? note.parentId : null;
    if (!parent) {
      roots.push(note);
      continue;
    }
    const list = children.get(parent) ?? [];
    list.push(note);
    children.set(parent, list);
  }

  /**
   * The docs that are not reachable from the top are in a loop, and they
   * are put at the top as well so that none of them disappears.
   */
  const reachable = new Set<string>();
  const walk = (ids: string[]) => {
    for (const id of ids) {
      if (reachable.has(id)) continue;
      reachable.add(id);
      walk((children.get(id) ?? []).map((child) => child.id));
    }
  };
  walk(roots.map((note) => note.id));
  for (const note of notes) {
    if (!reachable.has(note.id)) roots.push(note);
  }

  return { roots, children };
}

export function DocTree({ notes, activeId, currentId, onOpen, onMakeCurrent, onNewSubpage, onDelete }: DocTreeProps) {
  const { roots, children } = useMemo(() => buildTree(notes), [notes]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  /**
   * The branch that holds the doc being read is open.
   *
   * A person who opens a doc that is inside another one wants to see where
   * it is, so the way to it is opened without being asked.
   */
  useEffect(() => {
    if (!activeId) return;
    const byId = new Map(notes.map((note) => [note.id, note]));
    const path: string[] = [];
    let current = byId.get(activeId);
    const seen = new Set<string>();
    while (current?.parentId && byId.has(current.parentId) && !seen.has(current.parentId)) {
      seen.add(current.parentId);
      path.push(current.parentId);
      current = byId.get(current.parentId);
    }
    if (!path.length) return;
    setExpanded((current_) => {
      const next = new Set(current_);
      for (const id of path) next.add(id);
      return next;
    });
  }, [activeId, notes]);

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * The rows of the tree.
   *
   * The path of the rows above is carried along, so that a doc that is in a
   * loop is shown once and never again.
   */
  const render = (note: NoteSummary, depth: number, path: Set<string>): React.ReactNode => {
    if (path.has(note.id)) return null;
    const nextPath = new Set(path).add(note.id);
    const kids = children.get(note.id) ?? [];
    const open = expanded.has(note.id);
    const active = note.id === activeId;

    return (
      <li key={note.id}>
        <div
          className={cn(
            "group flex items-start gap-1 rounded-xl",
            active ? "bg-soft" : "hover:bg-soft",
          )}
          style={{ paddingLeft: depth === 0 ? undefined : `${depth * 14}px` }}
        >
          {kids.length ? (
            <button
              onClick={() => toggle(note.id)}
              aria-label={open ? "Collapse" : "Expand"}
              aria-expanded={open}
              className="mt-2 grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-hover"
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </button>
          ) : (
            <span className="mt-2 size-5 shrink-0" aria-hidden />
          )}

          <button onClick={() => onOpen(note.id)} className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left">
            <span className="mt-0.5 text-base">{note.icon ?? "📄"}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{note.title}</span>
                {note.isPinned ? <Pin className="size-3 shrink-0 text-muted" /> : null}
                {kids.length ? (
                  <span className="shrink-0 rounded-full bg-soft px-1.5 text-[10px] font-medium text-muted">{kids.length}</span>
                ) : null}
              </span>
              <span className="block truncate text-xs text-muted">{note.excerpt || "Empty doc"}</span>
            </span>
          </button>

          <button
            onClick={() => onNewSubpage(note.id)}
            title="Make a doc inside this one"
            aria-label={`Make a doc inside ${note.title}`}
            className="mr-1 mt-2 grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft"
          >
            <FilePlus2 className="size-3.5 opacity-0 group-hover:opacity-100" />
          </button>

          {/**
           * The doc the extension shortcut adds to. It is marked here so it
           * can be chosen without opening the doc first.
           */}
          <button
            onClick={() => onMakeCurrent(note.id)}
            title={note.id === currentId ? "This is the doc the extension adds to" : "Use as the doc the extension adds to"}
            aria-label={note.id === currentId ? `${note.title} is the current doc` : `Make ${note.title} the current doc`}
            aria-pressed={note.id === currentId}
            className={cn("mr-1 mt-2 grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft", note.id === currentId ? "text-deep-text" : "opacity-0 group-hover:opacity-100")}
          >
            <Star className={cn("size-3.5", note.id === currentId && "fill-current")} />
          </button>

          {onDelete ? (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onDelete(note.id, note.title);
              }}
              title="Delete doc"
              aria-label={`Delete ${note.title}`}
              className="mr-1 mt-2 grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              <Trash2 className="size-3.5 opacity-0 group-hover:opacity-100" />
            </button>
          ) : null}
        </div>

        {open && kids.length ? (
          <ul className="border-l border-line" style={{ marginLeft: `${depth * 14 + 10}px` }}>
            {kids.map((kid) => render(kid, depth + 1, nextPath))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <ul className="space-y-0.5">
      {roots.map((note) => render(note, 0, new Set()))}
    </ul>
  );
}
