import { browser } from "wxt/browser";

/**
 * The panel that shows what was captured.
 *
 * Chrome has a side panel and Firefox has a sidebar. Both are the same
 * page, so the panel is opened the way the browser allows.
 *
 * The call is made straight away, because a browser only opens its panel
 * while the click that asked for it is still being handled.
 */
export function openReviewPanel(windowId?: number): Promise<boolean> {
  const sidePanel = (browser as { sidePanel?: { open: (options: { windowId?: number }) => Promise<void> } }).sidePanel;
  if (sidePanel) {
    return sidePanel.open(windowId === undefined ? {} : { windowId }).then(() => true, () => false);
  }
  const sidebar = (browser as { sidebarAction?: { open: () => Promise<void> } }).sidebarAction;
  if (sidebar) {
    return sidebar.open().then(() => true, () => false);
  }
  return Promise.resolve(false);
}

/**
 * A small window with the same page in it.
 *
 * It is the way of showing the review when the browser will not open its
 * own panel, so the item is not left waiting where nobody can see it.
 */
export async function openReviewWindow(): Promise<boolean> {
  try {
    const url = (browser.runtime as unknown as { getURL: (path: string) => string }).getURL("sidepanel.html");
    await browser.windows.create({ url, type: "popup", width: 420, height: 720, focused: true });
    return true;
  } catch {
    return false;
  }
}
