/**
 * The theme of the interface.
 *
 * The colours are named rather than written out, so that the whole
 * interface can be turned over at once. The choice is kept in the browser,
 * so it is still there the next time the site is opened.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";

/**
 * The themes that may be chosen, in the order they are offered.
 */
export const THEME_OPTIONS: readonly Theme[] = ["light", "dark", "system"];

/**
 * What each theme is called on the screen.
 */
export const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "Follow the system",
};

const STORAGE_KEY = "dataVaultTheme";

/**
 * The theme that was chosen, or the one the system asks for.
 */
export function storedTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

/**
 * The theme that is on the screen, once the system has been asked.
 *
 * A choice of light or dark is taken as it is. "Follow the system" asks the
 * browser what it prefers.
 */
export function resolvedTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Put the theme on the page.
 *
 * The class is what the stylesheet looks at, and it is put on before the
 * page is drawn so that the colours do not change in front of the reader.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const dark = resolvedTheme(theme) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  /**
   * The bar of the browser takes the colour of the page, so it is changed
   * with it. The page reads the choice before it is drawn, so this is only
   * needed when the choice is changed while the page is open.
   */
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#121110" : "#fffaf0");
}

/**
 * Keep the theme in step with the system, when the system is the one that
 * was chosen.
 *
 * The listener is told when the system changes, so that the part of the
 * screen that names the theme can be told as well.
 */
export function watchSystemTheme(onChange?: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => {
    if (storedTheme() === "system") {
      applyTheme("system");
      onChange?.();
    }
  };
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/**
 * Choose a theme and keep the choice.
 */
export function setTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

interface ThemeValue {
  /** The theme that was chosen. */
  theme: Theme;
  /** The theme that is on the screen, once the system has been asked. */
  resolved: "light" | "dark";
  /** Choose a theme and keep the choice. */
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * The theme of the whole interface.
 *
 * Every part of the screen asks this for the theme, so the header, the
 * settings, and the panel that opens over the page can never disagree
 * about what is chosen.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(storedTheme);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolvedTheme(storedTheme()));

  const choose = useCallback((next: Theme) => {
    setThemeState(next);
    setTheme(next);
    setResolved(resolvedTheme(next));
  }, []);

  useEffect(() => {
    applyTheme(theme);
    setResolved(resolvedTheme(theme));
  }, [theme]);

  /**
   * The system is only watched when the system is the one that was chosen.
   */
  useEffect(() => watchSystemTheme(() => setResolved(resolvedTheme("system"))), []);

  const value = useMemo(() => ({ theme, resolved, setTheme: choose }), [theme, resolved, choose]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The theme of the interface, and the way to change it.
 */
export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("Missing ThemeProvider");
  return value;
}
