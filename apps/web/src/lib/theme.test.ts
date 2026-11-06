import { afterEach, describe, expect, test } from "bun:test";
import { applyTheme, resolvedTheme, setTheme, storedTheme, THEME_LABELS, THEME_OPTIONS } from "./theme";

/**
 * The browser that was there before the fake one.
 *
 * The fake is taken away again after each test, so that the other tests
 * still find the browser they expect to find.
 */
const originalWindow = "window" in globalThis ? (globalThis as unknown as { window?: unknown }).window : undefined;
const originalDocument = "document" in globalThis ? (globalThis as unknown as { document?: unknown }).document : undefined;

afterEach(() => {
  const scope = globalThis as unknown as { window?: unknown; document?: unknown };
  if (originalWindow === undefined) delete scope.window;
  else scope.window = originalWindow;
  if (originalDocument === undefined) delete scope.document;
  else scope.document = originalDocument;
});

/**
 * A browser, of the kind the theme module needs.
 *
 * The module asks the browser two things: what colour scheme it prefers,
 * and where to put the class that turns the page over. Both are answered
 * here so that the behaviour can be checked without a window.
 */
function fakeBrowser(dark: boolean) {
  const classes = new Set<string>();
  const store: Record<string, string> = {};
  const scope = globalThis as unknown as { window?: unknown; document?: unknown };
  scope.window = {
    matchMedia: (query: string) => ({
      matches: query.includes("dark") ? dark : false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
    },
  };
  scope.document = {
    documentElement: {
      classList: {
        toggle: (name: string, on: boolean) => { if (on) classes.add(name); else classes.delete(name); },
      },
      style: {} as { colorScheme?: string },
    },
    querySelector: () => null,
  };
  return { classes, store };
}

describe("the theme of the interface", () => {
  test("the themes that are offered are the three that exist", () => {
    expect([...THEME_OPTIONS]).toEqual(["light", "dark", "system"]);
    expect(THEME_LABELS.light).toBe("Light");
    expect(THEME_LABELS.dark).toBe("Dark");
    expect(THEME_LABELS.system).toBe("Follow the system");
  });

  test("a theme that was chosen is the one that is on the screen", () => {
    const browser = fakeBrowser(false);
    expect(resolvedTheme("light")).toBe("light");
    expect(resolvedTheme("dark")).toBe("dark");
    expect(browser.classes.size).toBe(0);
  });

  test("following the system asks the browser what it prefers", () => {
    fakeBrowser(true);
    expect(resolvedTheme("system")).toBe("dark");
    fakeBrowser(false);
    expect(resolvedTheme("system")).toBe("light");
  });

  test("the dark theme is put on the page when it is chosen", () => {
    const browser = fakeBrowser(false);
    applyTheme("dark");
    expect(browser.classes.has("dark")).toBe(true);
    applyTheme("light");
    expect(browser.classes.has("dark")).toBe(false);
  });

  test("a choice of light is the one that is kept, even on a dark system", () => {
    const browser = fakeBrowser(true);
    setTheme("light");
    expect(storedTheme()).toBe("light");
    expect(browser.classes.has("dark")).toBe(false);
  });

  test("the choice is kept in the browser, so it is still there next time", () => {
    const browser = fakeBrowser(false);
    setTheme("dark");
    expect(browser.store.dataVaultTheme).toBe("dark");
    setTheme("system");
    expect(browser.store.dataVaultTheme).toBe("system");
  });
});
