import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { cn } from "@data-vault/ui";

interface EditableTitleProps {
  title: string;
  /** Called with the new name. It is only called when the name really changed. */
  onSave: (title: string) => void;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
}

/**
 * A name that can be changed in place.
 *
 * A doc made from the extension starts with a name that says nothing, so
 * the name has to be changeable there and then, rather than only on the
 * website.
 */
export function EditableTitle({ title, onSave, className, inputClassName, disabled }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const saved = useRef(title);

  useEffect(() => {
    setValue(title);
    saved.current = title;
  }, [title]);

  const commit = () => {
    setEditing(false);
    const next = value.trim();
    if (!next || next === saved.current) {
      setValue(saved.current);
      return;
    }
    saved.current = next;
    onSave(next);
  };

  const cancel = () => {
    setEditing(false);
    setValue(saved.current);
  };

  if (!editing) {
    return (
      <div className={cn("flex items-start gap-1", className)}>
        <p className="min-w-0 flex-1 truncate font-semibold">{title}</p>
        {disabled ? null : (
          <button
            type="button"
            onClick={() => { setValue(title); setEditing(true); }}
            title="Rename this doc"
            aria-label="Rename this doc"
            className="grid size-6 shrink-0 place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Pencil className="size-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex items-start gap-1", className)}>
      <input
        autoFocus
        value={value}
        maxLength={300}
        aria-label="Name of the doc"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        onBlur={commit}
        className={cn("min-w-0 flex-1 rounded-md bg-white/10 px-1.5 py-0.5 text-sm font-semibold text-white outline-none ring-1 ring-white/40", inputClassName)}
      />
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={commit}
        title="Save the name"
        aria-label="Save the name"
        className="grid size-6 shrink-0 place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
      >
        <Check className="size-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={cancel}
        title="Keep the old name"
        aria-label="Keep the old name"
        className="grid size-6 shrink-0 place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
