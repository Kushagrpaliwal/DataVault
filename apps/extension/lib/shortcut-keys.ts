/**
 * The keys, and which of them Chrome keeps.
 *
 * Nothing here talks to the browser, so the rules can be worked out and
 * checked on their own.
 */

/**
 * The keys Chrome keeps for itself.
 *
 * Chrome owns these accelerators. It refuses to give one of them to an
 * extension by itself, and it can take them back at any moment, so a
 * shortcut bound to one of them may simply never arrive.
 *
 * `Ctrl+Shift+A` is the search-tabs menu and `Ctrl+Shift+D` is
 * bookmark-all-tabs, which is why neither is a good choice here.
 *
 * The Alt and Shift combinations were checked against Chrome itself: it
 * keeps A, B, C, N, P, R, T, W, X and Z for itself, and hands out the rest.
 */
const CHROME_OWNS = new Set([
  "Ctrl+A", "Ctrl+B", "Ctrl+C", "Ctrl+D", "Ctrl+E", "Ctrl+F", "Ctrl+G", "Ctrl+H", "Ctrl+I", "Ctrl+J", "Ctrl+K", "Ctrl+L",
  "Ctrl+M", "Ctrl+N", "Ctrl+O", "Ctrl+P", "Ctrl+Q", "Ctrl+R", "Ctrl+S", "Ctrl+T", "Ctrl+U", "Ctrl+V", "Ctrl+W", "Ctrl+X", "Ctrl+Y", "Ctrl+Z",
  "Ctrl+Shift+A", "Ctrl+Shift+B", "Ctrl+Shift+C", "Ctrl+Shift+D", "Ctrl+Shift+E", "Ctrl+Shift+F", "Ctrl+Shift+G",
  "Ctrl+Shift+H", "Ctrl+Shift+I", "Ctrl+Shift+J", "Ctrl+Shift+K", "Ctrl+Shift+L", "Ctrl+Shift+M", "Ctrl+Shift+N",
  "Ctrl+Shift+O", "Ctrl+Shift+P", "Ctrl+Shift+Q", "Ctrl+Shift+R", "Ctrl+Shift+S", "Ctrl+Shift+T", "Ctrl+Shift+U",
  "Ctrl+Shift+V", "Ctrl+Shift+W", "Ctrl+Shift+X", "Ctrl+Shift+Y", "Ctrl+Shift+Z", "Ctrl+Shift+Space", "Ctrl+Shift+Tab",
  "Ctrl+Shift+Delete", "Ctrl+Shift+Esc",
  "Ctrl+0", "Ctrl+1", "Ctrl+2", "Ctrl+3", "Ctrl+4", "Ctrl+5", "Ctrl+6", "Ctrl+7", "Ctrl+8", "Ctrl+9",
  "Ctrl+Shift+0", "Ctrl+Shift+1", "Ctrl+Shift+2", "Ctrl+Shift+3", "Ctrl+Shift+4", "Ctrl+Shift+5", "Ctrl+Shift+6",
  "Ctrl+Shift+7", "Ctrl+Shift+8", "Ctrl+Shift+9",
  "Alt+D", "Alt+E", "Alt+F", "Alt+Home", "Alt+Left", "Alt+Right",
  "Alt+Shift+A", "Alt+Shift+B", "Alt+Shift+C", "Alt+Shift+N", "Alt+Shift+P", "Alt+Shift+R", "Alt+Shift+T",
  "Alt+Shift+W", "Alt+Shift+X", "Alt+Shift+Z",
]);

/**
 * The keys DataVault offers, most wanted first.
 *
 * They are all Alt and Shift with a letter, because Chrome keeps most of the
 * Ctrl combinations for itself and the operating system keeps the rest.
 * Every one of these was watched being handed to an extension by Chrome, so
 * they are known to be free.
 */
const FREE_KEYS = [
  "Alt+Shift+D", "Alt+Shift+S", "Alt+Shift+O", "Alt+Shift+F",
  "Alt+Shift+G", "Alt+Shift+H", "Alt+Shift+I", "Alt+Shift+J", "Alt+Shift+K", "Alt+Shift+L",
  "Alt+Shift+M", "Alt+Shift+Q", "Alt+Shift+U", "Alt+Shift+V", "Alt+Shift+Y", "Alt+Shift+E",
];

/**
 * True when Chrome wants the key for itself.
 */
export function chromeOwnsShortcut(shortcut: string): boolean {
  const normalised = formatShortcut(shortcut).replace(/Command/g, "Ctrl").replace(/MacCtrl/g, "Ctrl").replace(/Option/g, "Alt");
  return CHROME_OWNS.has(normalised);
}

/**
 * Write a key the way a person reads it.
 *
 * The browser writes the modifiers in its own way, and the same key can be
 * typed in lower case, so they are all put into one shape here.
 */
export function formatShortcut(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      const key = part.trim();
      const name = key.toLowerCase();
      if (name === "command" || name === "ctrl" || name === "control") return "Ctrl";
      if (name === "alt" || name === "option") return "Alt";
      if (name === "shift") return "Shift";
      if (name === "macctrl") return "Ctrl";
      return key.length === 1 ? key.toUpperCase() : key;
    })
    .join("+");
}

/**
 * Compare two shortcuts, ignoring case and the way a modifier is written.
 */
export function sameShortcut(left: string | undefined | null, right: string | undefined | null): boolean {
  if (!left || !right) return false;
  const normalise = (value: string) => formatShortcut(value).toLowerCase().replace(/\bcommand\b/g, "ctrl");
  return normalise(left) === normalise(right);
}

/**
 * A key that will not be taken by the browser.
 *
 * The keys already used by the other commands are passed in, so the key that
 * is offered for one command is never the key another one is on.
 */
export function recommendShortcut(preferred: string, taken: string[] = []): string {
  const used = taken.map((shortcut) => formatShortcut(shortcut).toLowerCase());
  for (const candidate of [preferred, ...FREE_KEYS]) {
    if (chromeOwnsShortcut(candidate)) continue;
    if (used.includes(formatShortcut(candidate).toLowerCase())) continue;
    return candidate;
  }
  return preferred;
}
