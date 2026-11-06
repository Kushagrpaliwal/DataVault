import { useCallback, useEffect, useState } from "react";
import { getPreferences, setPreferences, subscribeStorage, type ExtensionTheme } from "./storage";

export type { ExtensionTheme };

/**
 * The themes that may be chosen, in the order they are offered.
 */
export const THEME_OPTIONS: readonly ExtensionTheme[] = ["light", "dark", "system"];

/**
 * What each theme is called on the screen.
 */
export const THEME_LABELS: Record<ExtensionTheme, string> = {
  light: "Light",
  dark: "Dark",
  system: "Follow the system",
};

/**
 * The theme that is on the screen, once the system has been asked.
 *
 * A choice of light or dark is taken as it is. "Follow the system" asks the
 * browser what it prefers, which is what the panel used to do for itself.
 */
export function resolvedTheme(theme: ExtensionTheme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Put the theme on the page.
 *
 * The class is what the stylesheet looks at. It is the only thing that
 * decides the colours, so a person who asks for the light theme gets it
 * even when the browser is dark.
 */
export function applyTheme(theme: ExtensionTheme): void {
  if (typeof document === "undefined") return;
  const dark = resolvedTheme(theme) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Keep the theme in step with the system, when the system is the one that
 * was chosen.
 */
export function watchSystemTheme(onChange?: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => {
    applyTheme("system");
    onChange?.();
  };
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/**
 * The theme of the panel, and the way to change it.
 *
 * The choice is kept in the browser, so it is still there the next time the
 * panel is opened.
 */
export function useExtensionTheme() {
  const [theme, setThemeState] = useState<ExtensionTheme>("system");
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolvedTheme("system"));

  useEffect(() => {
    let cancelled = false;
    void getPreferences().then((preferences) => {
      if (cancelled) return;
      setThemeState(preferences.theme);
      setResolved(resolvedTheme(preferences.theme));
    });
    return () => { cancelled = true; };
  }, []);

  /**
   * The theme is put on before the panel is painted, so that the colours
   * do not change in front of the reader.
   */
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /**
   * The system is only watched while the system is the one that was chosen.
   */
  useEffect(() => {
    if (theme !== "system") return;
    return watchSystemTheme(() => setResolved(resolvedTheme("system")));
  }, [theme]);

  /**
   * The panel is open in more than one place at once, and a choice made in
   * one of them has to show in the others.
   */
  useEffect(() => subscribeStorage(() => {
    void getPreferences().then((preferences) => {
      setThemeState(preferences.theme);
      setResolved(resolvedTheme(preferences.theme));
    });
  }), []);

  const setTheme = useCallback(async (next: ExtensionTheme) => {
    setThemeState(next);
    setResolved(resolvedTheme(next));
    applyTheme(next);
    const preferences = await getPreferences();
    await setPreferences({ ...preferences, theme: next });
  }, []);

  return { theme, resolved, setTheme };
}
