/**
 * The theme of the interface.
 *
 * The colours are named rather than written out, so that the whole
 * interface can be turned over at once. The choice is kept in the browser,
 * so it is still there the next time the site is opened.
 */
export type Theme = "light" | "dark" | "system";

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
 * Put the theme on the page.
 *
 * The class is what the stylesheet looks at, and it is put on before the
 * page is drawn so that the colours do not change in front of the reader.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Keep the theme in step with the system, when the system is the one that
 * was chosen.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => {
    if (storedTheme() === "system") applyTheme("system");
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
