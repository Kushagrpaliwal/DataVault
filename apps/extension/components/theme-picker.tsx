import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@data-vault/ui";
import { THEME_LABELS, THEME_OPTIONS, useExtensionTheme, type ExtensionTheme } from "../lib/theme";

/**
 * The icon that names a theme.
 */
const themeIcons = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * The button that chooses the theme.
 *
 * The panel took the colour of the browser and had no say in it, so there
 * was nothing on the screen that said the theme could be changed. This
 * button is that thing, and it works whether the person is signed in or
 * not.
 */
export function ThemePicker({ className }: { className?: string }) {
  const { theme, resolved, setTheme } = useExtensionTheme();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const Icon = themeIcons[theme];

  useEffect(() => {
    if (!open) return;
    /**
     * A click anywhere else closes the menu, and so does the escape key.
     */
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${THEME_LABELS[theme]}`}
        title={`Theme: ${THEME_LABELS[theme]}`}
        className="grid size-8 place-items-center rounded-lg text-strong transition-colors hover:bg-soft hover:text-ink"
      >
        <Icon className="size-4" aria-hidden />
      </button>
      {open ? (
        <div role="menu" aria-label="Theme" className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
          {THEME_OPTIONS.map((option) => {
            const OptionIcon = themeIcons[option];
            const chosen = option === theme;
            return (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={chosen}
                onClick={() => {
                  void setTheme(option);
                  setOpen(false);
                  trigger.current?.focus();
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors",
                  chosen ? "bg-soft text-ink" : "text-strong hover:bg-soft hover:text-ink",
                )}
              >
                <OptionIcon className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">{THEME_LABELS[option]}</span>
                {chosen ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                {option === "system" && !chosen ? <span className="shrink-0 text-[11px] text-muted">{resolved}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The themes, side by side.
 *
 * This is the shape the settings use, so the same choice can be offered in
 * more than one place without the two places drifting apart.
 */
export function ThemeOptions({ className }: { className?: string }) {
  const { theme, setTheme } = useExtensionTheme();
  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="group" aria-label="Theme">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === theme}
          onClick={() => void setTheme(option)}
          className={cn(
            "rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
            option === theme ? "bg-ink text-canvas" : "border border-line hover:bg-soft",
          )}
        >
          {THEME_LABELS[option]}
        </button>
      ))}
    </div>
  );
}

/**
 * The name of a theme, for the places that only say it in words.
 */
export function themeName(theme: ExtensionTheme): string {
  return THEME_LABELS[theme];
}
