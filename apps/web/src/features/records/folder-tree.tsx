import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@data-vault/ui";

/**
 * A folder as the tree needs it.
 *
 * The folders are a tree now, so every folder knows the folder it sits
 * inside, and the tree is made from that.
 */
export interface FolderNode {
  id: string;
  parentId: string | null;
  name: string;
  color: string;
  isDefault: boolean;
  itemCount?: number | undefined;
  tags?: Array<{ id: string; name: string; color: string }> | undefined;
}

/**
 * A folder and the folders inside it.
 */
export interface FolderTreeNode extends FolderNode {
  children: FolderTreeNode[];
}

/**
 * The folders of a workspace, arranged as a tree.
 *
 * The tree is made here rather than on the server, because the whole list of
 * folders is small and the server should not have to know how they are
 * drawn.
 */
export function folderTree(folders: FolderNode[]): FolderTreeNode[] {
  const children = new Map<string | null, FolderNode[]>();
  for (const folder of folders) {
    const list = children.get(folder.parentId) ?? [];
    list.push(folder);
    children.set(folder.parentId, list);
  }
  const byName = (a: FolderNode, b: FolderNode) => a.name.localeCompare(b.name);
  /**
   * The default folder is always at the top, so it is found first even when
   * it is the only one that is not.
   */
  const roots = (children.get(null) ?? []).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || byName(a, b));
  const walk = (list: FolderNode[]): FolderTreeNode[] => list.map((folder) => ({ ...folder, children: walk(children.get(folder.id) ?? []) }));
  return walk(roots);
}

/**
 * The folders, one after another, with the depth of each one.
 *
 * This is what a plain list of folders needs, such as the list in a box
 * where a folder is chosen.
 */
export interface FlatFolder extends FolderNode {
  depth: number;
}
export function flattenFolders(tree: FolderTreeNode[]): FlatFolder[] {
  const flat: FlatFolder[] = [];
  const walk = (list: FolderTreeNode[], depth: number) => {
    for (const folder of list) {
      flat.push({
        id: folder.id,
        parentId: folder.parentId,
        name: folder.name,
        color: folder.color,
        isDefault: folder.isDefault,
        itemCount: folder.itemCount,
        tags: folder.tags,
        depth,
      });
      walk(folder.children, depth + 1);
    }
  };
  walk(tree, 0);
  return flat;
}

/**
 * The tree of folders, drawn as a list with nested guide lines.
 *
 * Every folder can be dropped on, so that a saved item can be dragged into
 * it. A folder that is being dropped on says so, so it is clear where the
 * item will go.
 */
export function FolderTree({
  tree,
  activeId,
  onSelect,
  onMoveItem,
  onCreate,
  onRename,
  onDelete,
  dropHint,
  emptyHint,
}: {
  tree: FolderTreeNode[];
  activeId?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  /** Called with the folder an item was dropped on. */
  onMoveItem?: ((folderId: string) => void) | undefined;
  /** Called with the name of a new folder and the folder it goes inside. */
  onCreate?: ((name: string, parentId: string | null) => void) | undefined;
  onRename?: ((id: string, name: string) => void) | undefined;
  onDelete?: ((id: string) => void) | undefined;
  dropHint?: string | undefined;
  emptyHint?: string | undefined;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const isCollapsed = (id: string) => collapsed.includes(id);
  const toggle = (id: string) => setCollapsed((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const startAdd = (parentId: string | null) => {
    if (parentId && isCollapsed(parentId)) {
      toggle(parentId);
    }
    setAdding({ parentId });
    setNewName("");
  };
  const commitAdd = () => {
    const name = newName.trim();
    if (!name || !onCreate || !adding) return;
    onCreate(name, adding.parentId);
    setAdding(null);
    setNewName("");
  };

  const startRename = (folder: FolderTreeNode) => {
    setRenaming(folder.id);
    setRenameValue(folder.name);
  };
  const commitRename = () => {
    const name = renameValue.trim();
    if (renaming && name && onRename) onRename(renaming, name);
    setRenaming(null);
  };

  return (
    <div className="space-y-1">
      {tree.length === 0 && emptyHint ? <p className="px-3 py-2 text-sm leading-6 text-muted">{emptyHint}</p> : null}

      {adding && adding.parentId === null ? (
        <div className="flex items-center gap-1.5 px-1 py-1">
          <Folder className="size-4 shrink-0 text-muted ml-0.5" />
          <input
            autoFocus
            value={newName}
            maxLength={100}
            placeholder="Folder name"
            aria-label="Folder name"
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); commitAdd(); }
              if (event.key === "Escape") { event.preventDefault(); setAdding(null); }
            }}
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-muted outline-none transition focus:border-muted"
          />
          <Button size="sm" className="h-8 px-2.5 text-xs" onClick={commitAdd} disabled={!newName.trim()}>Add</Button>
          <button onClick={() => setAdding(null)} title="Cancel" aria-label="Cancel" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {tree.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          depth={0}
          activeId={activeId}
          collapsed={isCollapsed}
          onToggle={toggle}
          onSelect={onSelect}
          onMoveItem={onMoveItem}
          onRename={onRename}
          onDelete={onDelete}
          dragOver={dragOver}
          setDragOver={setDragOver}
          renaming={renaming}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          startRename={startRename}
          commitRename={commitRename}
          cancelRename={() => setRenaming(null)}
          adding={adding}
          startAdd={startAdd}
          newName={newName}
          setNewName={setNewName}
          commitAdd={commitAdd}
          cancelAdd={() => setAdding(null)}
          hovered={hovered}
          setHovered={setHovered}
          dropHint={dropHint}
        />
      ))}

      {onCreate && !adding ? (
        <button
          onClick={() => startAdd(null)}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-muted hover:bg-soft hover:text-ink transition"
          title="Make a new folder"
        >
          <Plus className="size-4" />
          <span>New folder</span>
        </button>
      ) : null}
    </div>
  );
}

function FolderRow({
  folder, depth, activeId, collapsed, onToggle, onSelect, onMoveItem, onRename, onDelete,
  dragOver, setDragOver, renaming, renameValue, setRenameValue, startRename, commitRename, cancelRename,
  adding, startAdd, newName, setNewName, commitAdd, cancelAdd, hovered, setHovered, dropHint,
}: {
  folder: FolderTreeNode;
  depth: number;
  activeId?: string | undefined;
  collapsed: (id: string) => boolean;
  onToggle: (id: string) => void;
  onSelect?: ((id: string) => void) | undefined;
  onMoveItem?: ((folderId: string) => void) | undefined;
  onRename?: ((id: string, name: string) => void) | undefined;
  onDelete?: ((id: string) => void) | undefined;
  dragOver: string | null;
  setDragOver: (value: string | null | ((current: string | null) => string | null)) => void;
  renaming: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  startRename: (folder: FolderTreeNode) => void;
  commitRename: () => void;
  cancelRename: () => void;
  adding: { parentId: string | null } | null;
  startAdd: (parentId: string | null) => void;
  newName: string;
  setNewName: (value: string) => void;
  commitAdd: () => void;
  cancelAdd: () => void;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  dropHint?: string | undefined;
}) {
  const isOpen = !collapsed(folder.id);
  const isDragOver = dragOver === folder.id;
  const isActive = activeId === folder.id;
  const hasChildren = folder.children.length > 0;
  const isAddingSubfolder = adding?.parentId === folder.id;

  return (
    <div className="space-y-0.5">
      <div
        className={`group relative flex items-center gap-1 rounded-xl pr-1 transition ${
          isDragOver
            ? "bg-deep text-white"
            : isActive
            ? "bg-deep text-white font-medium"
            : "hover:bg-soft text-ink"
        }`}
        style={{ paddingLeft: "4px" }}
        onMouseEnter={() => setHovered(folder.id)}
        onMouseLeave={() => setHovered(null)}
        onDragOver={(event) => {
          if (!onMoveItem) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDragOver(folder.id);
        }}
        onDragLeave={() => setDragOver((current) => (current === folder.id ? null : current))}
        onDrop={(event) => {
          if (!onMoveItem) return;
          event.preventDefault();
          setDragOver(null);
          onMoveItem(folder.id);
        }}
      >
        {/* Expand / Collapse toggle or alignment spacer */}
        {hasChildren ? (
          <button
            onClick={() => onToggle(folder.id)}
            title={isOpen ? "Collapse" : "Expand"}
            aria-label={isOpen ? "Collapse" : "Expand"}
            className={`grid size-6 shrink-0 place-items-center rounded-lg transition ${
              isActive || isDragOver ? "hover:bg-white/10 text-white" : "hover:bg-line text-muted"
            }`}
          >
            {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}

        {renaming === folder.id ? (
          <span className="flex min-w-0 flex-1 items-center gap-1 py-1">
            <input
              autoFocus
              value={renameValue}
              maxLength={100}
              aria-label="New name"
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); commitRename(); }
                if (event.key === "Escape") { event.preventDefault(); cancelRename(); }
              }}
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-sm text-ink outline-none transition focus:border-muted"
            />
            <button onClick={commitRename} title="Save" aria-label="Save" className="grid size-8 shrink-0 place-items-center rounded-lg text-emerald-600 hover:bg-soft">
              <Check className="size-3.5" />
            </button>
            <button onClick={cancelRename} title="Cancel" aria-label="Cancel" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft">
              <X className="size-3.5" />
            </button>
          </span>
        ) : (
          <>
            <button
              onClick={() => onSelect?.(folder.id)}
              disabled={!onSelect}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 text-left text-sm ${
                isActive ? "text-white" : ""
              }`}
              title={isDragOver && dropHint ? dropHint : folder.name}
            >
              {isOpen && hasChildren ? (
                <FolderOpen className={`size-4 shrink-0 ${isActive ? "text-white" : "text-muted"}`} />
              ) : (
                <Folder className={`size-4 shrink-0 ${isActive ? "text-white" : "text-muted"}`} />
              )}
              <span className="truncate">{folder.name}</span>

              {/* Tag badges */}
              {folder.tags && folder.tags.length > 0 ? (
                <span className="flex items-center gap-1 shrink-0 ml-1">
                  {folder.tags.slice(0, 2).map((t) => (
                    <span
                      key={t.id}
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-mono leading-none ${
                        isActive ? "bg-white/20 text-white" : "bg-soft text-muted border border-line/50"
                      }`}
                      title={`#${t.name}`}
                    >
                      #{t.name}
                    </span>
                  ))}
                  {folder.tags.length > 2 ? (
                    <span className={`text-[10px] ${isActive ? "text-white/70" : "text-muted"}`}>
                      +{folder.tags.length - 2}
                    </span>
                  ) : null}
                </span>
              ) : null}

              <span className={`ml-auto text-xs ${isActive ? "text-white/80" : "text-muted"}`}>
                {folder.itemCount ?? 0}
              </span>
            </button>

            {/* Hover Actions Toolbar */}
            <span
              className={`absolute right-1 flex shrink-0 items-center gap-0.5 rounded-lg px-1 py-0.5 transition ${
                isActive || isDragOver ? "bg-deep shadow-xs" : "bg-surface border border-line shadow-xs"
              } opacity-0 group-hover:opacity-100 focus-within:opacity-100`}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startAdd(folder.id);
                }}
                title="Add sub-folder"
                aria-label={`Add sub-folder to ${folder.name}`}
                className={`grid size-6 place-items-center rounded-md ${
                  isActive || isDragOver ? "text-white/90 hover:bg-white/10" : "text-muted hover:bg-soft hover:text-ink"
                }`}
              >
                <Plus className="size-3.5" />
              </button>
              {onRename ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(folder);
                  }}
                  title="Rename"
                  aria-label={`Rename ${folder.name}`}
                  className={`grid size-6 place-items-center rounded-md ${
                    isActive || isDragOver ? "text-white/90 hover:bg-white/10" : "text-muted hover:bg-soft hover:text-ink"
                  }`}
                >
                  <Pencil className="size-3.5" />
                </button>
              ) : null}
              {onDelete && !folder.isDefault ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(folder.id);
                  }}
                  title="Remove"
                  aria-label={`Remove ${folder.name}`}
                  className={`grid size-6 place-items-center rounded-md ${
                    isActive || isDragOver
                      ? "text-white/90 hover:bg-white/10 hover:text-red-200"
                      : "text-muted hover:bg-soft hover:text-red-700 dark:text-red-300"
                  }`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </span>
          </>
        )}
      </div>

      {/* Nested children container with clear guideline */}
      {isOpen && (hasChildren || isAddingSubfolder) ? (
        <div className="relative ml-4 border-l border-line/60 pl-2 space-y-0.5">
          {isAddingSubfolder ? (
            <div className="flex items-center gap-1.5 py-1 pr-1">
              <Folder className="size-4 shrink-0 text-muted ml-0.5" />
              <input
                autoFocus
                value={newName}
                maxLength={100}
                placeholder="Sub-folder name"
                aria-label="Sub-folder name"
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); commitAdd(); }
                  if (event.key === "Escape") { event.preventDefault(); cancelAdd(); }
                }}
                className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-muted outline-none transition focus:border-muted"
              />
              <Button size="sm" className="h-8 px-2.5 text-xs" onClick={commitAdd} disabled={!newName.trim()}>
                Add
              </Button>
              <button
                onClick={cancelAdd}
                title="Cancel"
                aria-label="Cancel"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}

          {folder.children.map((child) => (
            <FolderRow
              key={child.id}
              folder={child}
              depth={depth + 1}
              activeId={activeId}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
              onMoveItem={onMoveItem}
              onRename={onRename}
              onDelete={onDelete}
              dragOver={dragOver}
              setDragOver={setDragOver}
              renaming={renaming}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              startRename={startRename}
              commitRename={commitRename}
              cancelRename={cancelRename}
              adding={adding}
              startAdd={startAdd}
              newName={newName}
              setNewName={setNewName}
              commitAdd={commitAdd}
              cancelAdd={cancelAdd}
              hovered={hovered}
              setHovered={setHovered}
              dropHint={dropHint}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
