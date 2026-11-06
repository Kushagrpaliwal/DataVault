import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { DataVaultApiError } from "@data-vault/api-client";
import { WEB_URL, withOrganization } from "../lib/api";
import { signInExtension } from "../lib/auth";
import { addClipToCurrentDoc, addClipToDoc, broadcastNoteUpdate as broadcastNoteChanged, makeCurrentDoc, refreshCurrentDoc, removeClipFromDoc, startNewDoc } from "../lib/docs";
import { folderForNewItems } from "../lib/folders";
import { enqueuePendingCapture, getAuth, getPendingCaptures, getPreferences, removePendingCapture, subscribeStorage, updatePendingCapture, type CaptureQuality, type ExtensionPreferences, type PageDetails, type PendingCapture, type PendingDocClip } from "../lib/storage";
import { recordExtensionError } from "../lib/errors";
import { openReviewPanel, openReviewWindow as openReviewPanelWindow } from "../lib/panel";
import { readPageContent } from "../lib/page-content";
import { tidyPageText } from "@data-vault/notes";

const menuSaveId = "datavault-save-selection";
const menuAddToDocId = "datavault-add-to-doc";
const menuAddToNewDocId = "datavault-add-to-new-doc";
/** The alarm that keeps trying to save the items that could not get through. */
const retryAlarm = "datavault-retry-queue";
/** The alarm that keeps the worker awake, so the settings are always known. */
const keepAwakeAlarm = "datavault-keep-awake";
let signedIn = false;
let authenticationInFlight: Promise<unknown> | undefined;
/**
 * The preferences, kept in memory.
 *
 * The browser only lets a context-menu click open the side panel while the
 * click is still being handled, so the choice between saving straight away
 * and asking for a review has to be made without waiting for anything.
 */
let cachedPreferences: ExtensionPreferences = { quickSaveSelectedText: false, pageCaptureMode: "visible", theme: "system" };
/**
 * True once the real settings have been read.
 *
 * A service worker is stopped while it is idle and started again for the
 * next event, so the first click after a long pause arrives before the
 * settings have been read. That click is handled by reading them first.
 */
let preferencesKnown = false;

/**
 * Read the settings and keep them for the next click.
 */
async function readPreferences() {
  cachedPreferences = await getPreferences();
  preferencesKnown = true;
  return cachedPreferences;
}

/**
 * Run something in the background without letting it fail quietly.
 *
 * A promise that is not waited for and not caught becomes an error on the
 * extension's card, with nothing to say what went wrong. Everything that
 * runs on its own goes through here, so the problem is recorded and can be
 * shown in the side panel.
 */
function runInBackground(scope: string, operation: Promise<unknown>) {
  void operation.catch((error: unknown) => {
    console.error(`DataVault ${scope} failed`, error);
    void recordExtensionError(scope, error);
  });
}

/**
 * The menu items that are already there.
 *
 * The menu belongs to the browser, not to the worker, so it survives the
 * worker being stopped. That is why it is only added to when it is missing.
 */
interface MenuItem {
  id: string | number;
}

function existingMenuItems(): Promise<MenuItem[]> {
  return new Promise((resolve) => {
    try {
      const menus = chrome.contextMenus as unknown as { getAll: (callback: (items: MenuItem[]) => void) => void };
      menus.getAll((items) => {
        /**
         * Reading the error stops Chrome from reporting it, even when
         * nothing went wrong.
         */
        void chrome.runtime.lastError;
        resolve(items ?? []);
      });
    } catch {
      resolve([]);
    }
  });
}

/**
 * Add a menu item.
 *
 * The error is read inside the callback on purpose. Chrome reports an
 * unread error as an unchecked error on the extension's card, even when it
 * is harmless. An item that is already there is not a problem, so the error
 * is read and dropped.
 */
function addMenuItem(id: string, title: string) {
  try {
    chrome.contextMenus.create({ id, title, contexts: ["selection"] }, () => {
      void chrome.runtime.lastError;
    });
  } catch { /* the item could not be made */ }
}

async function registerContextMenu() {
  /**
   * The menu is only added to, never taken away and made again.
   *
   * Tearing it down and rebuilding it on every start made the menu flicker,
   * and the worker starts often, because it is kept awake.
   */
  const wanted = [
    { id: menuSaveId, title: "Save to DataVault" },
    { id: menuAddToDocId, title: "Add to doc" },
    { id: menuAddToNewDocId, title: "Add to a new doc" },
  ];
  const existing = await existingMenuItems();
  const keep = new Set(wanted.map((item) => item.id));
  for (const item of existing) {
    if (keep.has(String(item.id))) continue;
    try {
      chrome.contextMenus.remove(String(item.id));
    } catch { /* the item is already gone */ }
  }
  const have = new Set(existing.map((item) => String(item.id)));
  for (const item of wanted) {
    if (have.has(item.id)) continue;
    addMenuItem(item.id, item.title);
  }
}

/**
 * The menu is only ever made once at a time.
 *
 * The worker can be asked to start again while it is still setting itself
 * up, and two runs at once would both try to add the same item.
 */
let menuSetup: Promise<void> | undefined;

function setupMenu(): Promise<void> {
  menuSetup ??= registerContextMenu().finally(() => { menuSetup = undefined; });
  return menuSetup;
}

/**
 * The name of the current doc, shown on the menu item.
 *
 * The menu is rebuilt whenever the current doc changes, so the item always
 * says where the piece will go.
 */
async function refreshContextMenuTitles() {
  const preferences = await getPreferences();
  const title = preferences.currentDocTitle ? `Add to doc: ${preferences.currentDocTitle}` : "Add to doc";
  try {
    await browser.contextMenus.update(menuAddToDocId, { title });
  } catch { /* the menu item may not exist yet */ }
}

async function refreshCaptureMode() {
  const auth = await getAuth();
  const wasSignedIn = signedIn;
  signedIn = Boolean(auth);
  if (signedIn && !wasSignedIn) runInBackground("retrying a waiting item", retryQueuedCaptures());
}

function pageSummary(tab: chrome.tabs.Tab) {
  return ["Page capture", tab.title, tab.url].filter(Boolean).join("\n") || "Page capture";
}

async function selectedTextFromTab(tab: chrome.tabs.Tab, selectedText = "") {
  if (selectedText) return selectedText.trim();
  if (!tab.id) return "";
  try {
    const result = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString().trim() ?? "",
    });
    return result[0]?.result ?? "";
  } catch {
    return "";
  }
}

async function readablePageText(tab: chrome.tabs.Tab) {
  if (!tab.id) return "";
  try {
    const content = await readPageContent(tab.id);
    return tidyPageText(content.text);
  } catch {
    return "";
  }
}

async function inspectPage(tab: chrome.tabs.Tab, capturedText: string): Promise<CaptureQuality> {
  const fallback = (warnings: string[] = []): CaptureQuality => ({
    textLength: capturedText.length,
    hasTitle: Boolean(tab.title?.trim()),
    hasSourceUrl: Boolean(tab.url?.startsWith("http")),
    likelyAccessWall: false,
    likelyCookieBanner: false,
    warnings,
  });
  if (!tab.id) return fallback(["DataVault could not read this page."]);
  try {
    const result = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const body = document.body?.innerText ?? "";
        const bodyLower = body.toLowerCase();
        const cookieSelector = "[id*='cookie' i], [class*='cookie' i], [id*='consent' i], [class*='consent' i]";
        const cookieText = Array.from(document.querySelectorAll(cookieSelector)).some((element) => /cookie|consent|privacy|accept all/i.test(element.textContent ?? ""));
        const accessWall = /sign in|log in|create an account|access denied|verify you are human|enable javascript/i.test(bodyLower) && body.length < 4_000;
        return { bodyLength: body.length, title: document.title.trim(), cookieText, accessWall, hasUrl: /^https?:/i.test(location.href) };
      },
    });
    const inspection = result[0]?.result;
    if (!inspection) return fallback(["The page could not be inspected."]);
    const warnings = [
      inspection.accessWall ? "This page may be a login or access wall." : "",
      inspection.cookieText ? "A cookie or consent banner may be covering page content." : "",
      capturedText.length < 20 ? "Very little text was captured." : "",
      !inspection.title ? "The page has no title." : "",
    ].filter(Boolean);
    return {
      textLength: capturedText.length || inspection.bodyLength,
      hasTitle: Boolean(inspection.title),
      hasSourceUrl: inspection.hasUrl,
      likelyAccessWall: inspection.accessWall,
      likelyCookieBanner: inspection.cookieText,
      warnings,
    };
  } catch {
    return fallback(["This page did not let DataVault read its details."]);
  }
}

async function pendingFromTab(tab: chrome.tabs.Tab, selectedText = "", page?: PageDetails): Promise<PendingCapture> {
  const url = page?.url ?? tab.url ?? "";
  let domain = "current-page";
  try { domain = new URL(url).hostname; } catch { /* restricted browser page */ }
  const text = page?.selection ?? await selectedTextFromTab(tab, selectedText);

  return {
    idempotencyKey: crypto.randomUUID(),
    selectedText: text || pageSummary(tab),
    pageTitle: page?.title ?? tab.title ?? "Untitled page",
    /**
     * A browser will not always tell an extension which page it is on. When
     * it cannot, the address is left out rather than sent as an empty value,
     * so the capture still saves and simply has no source link.
     */
    pageUrl: url || undefined,
    domain,
    capturedAt: new Date().toISOString(),
    contentKind: text ? "selection" : "page-info",
    captureQuality: await inspectPage(tab, text || pageSummary(tab)),
    ...(tab.id === undefined ? {} : { sourceTabId: tab.id }),
    ...(tab.windowId === undefined ? {} : { sourceWindowId: tab.windowId }),
  };
}

async function capturePreview(tab: chrome.tabs.Tab, pending: PendingCapture) {
  if (tab.windowId === undefined) return pending;
  try {
    return { ...pending, screenshotDataUrl: await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" }) };
  } catch {
    return pending;
  }
}

async function stageSelectionCapture(tab: chrome.tabs.Tab, selectedText = "", page?: PageDetails) {
  const pending = await pendingFromTab(tab, selectedText, page);
  await enqueuePendingCapture(pending);
  const preview = await capturePreview(tab, pending);
  if (preview.screenshotDataUrl) await updatePendingCapture(pending.idempotencyKey, preview);
}

async function stagePageCapture(tab: chrome.tabs.Tab, page?: PageDetails) {
  const { pageCaptureMode } = await getPreferences();
  const selectedText = page?.selection ?? await selectedTextFromTab(tab);
  const base = await pendingFromTab(tab, selectedText, page);
  let pending: PendingCapture;

  if (pageCaptureMode === "selection-only") {
    if (!selectedText) throw new Error("Select text on the page before using the Selection only capture mode.");
    pending = { ...base, selectedText, contentKind: "selection", attachScreenshot: false };
  } else if (pageCaptureMode === "full-text") {
    const content = tab.id ? await readPageContent(tab.id).catch(() => undefined) : undefined;
    const text = content ? tidyPageText(content.text) : await readablePageText(tab);
    if (!text) throw new Error("DataVault could not read text from this page. Try Visible screenshot + page info instead.");
    pending = { ...base, selectedText: text, contentKind: "page-text", attachScreenshot: true, captureQuality: await inspectPage(tab, text), ...(content?.html ? { pageHtml: content.html } : {}) };
  } else {
    pending = { ...base, selectedText: selectedText || pageSummary(tab), contentKind: selectedText ? "selection" : "page-info", attachScreenshot: true };
  }

  await enqueuePendingCapture(pending);
  if (pageCaptureMode !== "selection-only") {
    const preview = await capturePreview(tab, pending);
    if (preview.screenshotDataUrl) await updatePendingCapture(pending.idempotencyKey, preview);
  }
}

function capturePayload(pending: PendingCapture, vaultId?: string) {
  return {
    selectedText: pending.selectedText,
    originalText: pending.selectedText,
    ...(pending.pageHtml ? { pageHtml: pending.pageHtml } : {}),
    source: { url: pending.pageUrl, title: pending.pageTitle, domain: pending.domain },
    capturedAt: pending.capturedAt,
    captureQuality: pending.captureQuality,
    recordType: "other" as const,
    confirmDuplicate: true,
    captureKind: pending.contentKind === "page-text" ? "page-text" as const : pending.contentKind === "page-info" ? "page" as const : "selection" as const,
    tagNames: [],
    vaultId,
  };
}

/**
 * Save a capture into the folder that has been chosen.
 *
 * A folder that has been removed on the website would be refused by the
 * server, so the save is tried again without one. The server then puts the
 * item in the default folder, and nothing is lost.
 */
async function saveCapture(pending: PendingCapture) {
  const vaultId = await folderForNewItems();
  try {
    return await withOrganization((api) => api.createCapture(capturePayload(pending, vaultId), pending.idempotencyKey));
  } catch (error) {
    if (vaultId && error instanceof DataVaultApiError && error.code === "INVALID_VAULT") {
      return withOrganization((api) => api.createCapture(capturePayload(pending, undefined), pending.idempotencyKey));
    }
    throw error;
  }
}

async function retryQueuedCaptures() {
  const auth = await getAuth();
  if (!auth) return;
  const queued = (await getPendingCaptures()).filter((pending) => pending.queueState === "retry");
  if (!queued.length) return;
  for (const pending of queued) {
    try {
      if (pending.kind === "doc-clip" && pending.docClip) {
        await sendDocClip(pending.docClip, { noteId: pending.docClip.noteId, sourceTabId: pending.sourceTabId, idempotencyKey: pending.idempotencyKey, quiet: true });
        await removePendingCapture(pending.idempotencyKey);
        continue;
      }
      const result = await saveCapture(pending);
      const record = result.record as Record<string, unknown> | undefined;
      if (!record?.id) throw new Error("DataVault did not return the saved capture.");
      await removePendingCapture(pending.idempotencyKey);
      await announceSavedCapture({ title: typeof record.title === "string" ? record.title : pending.pageTitle, sourceDomain: typeof record.sourceDomain === "string" ? record.sourceDomain : pending.domain }, pending.sourceTabId);
    } catch (error) {
      await updatePendingCapture(pending.idempotencyKey, { attempts: (pending.attempts ?? 0) + 1, lastError: error instanceof Error ? error.message : "Retry failed." });
    }
  }
}

/**
 * Keep trying the items that could not be saved.
 *
 * This used to run only when the user signed in, so anything that failed
 * while the connection was down stayed stuck until the next sign-in.
 */
async function scheduleRetryAlarm() {
  await ensureAlarm(retryAlarm, 5);
}

/**
 * Keep the worker awake, so the settings are always known.
 *
 * Chrome stops a service worker after a short idle time, and the setting is
 * read when the worker starts. Without this, the first shortcut after a
 * pause would arrive before the setting was known, and Chrome only allows
 * the side panel to be opened while the key press is still being handled.
 *
 * The alarm reads one value from storage and does nothing else.
 */
async function scheduleKeepAwakeAlarm() {
  await ensureAlarm(keepAwakeAlarm, 1);
}

/**
 * Make an alarm, unless it is already there.
 *
 * Making it again would push the next run back, so an alarm that is already
 * set is left alone.
 */
async function ensureAlarm(name: string, periodInMinutes: number) {
  try {
    const existing = await browser.alarms.get(name);
    if (existing) return;
    await browser.alarms.create(name, { periodInMinutes });
  } catch { /* the alarm API is not available in every browser */ }
}

/**
 * The side panel can only be opened while the click is still being handled.
 *
 * Chrome refuses the call when it comes after a wait, because the gesture has
 * gone by then. So the panel is opened first, and what happens next is worked
 * out afterwards.
 */
function openSidePanelFromUserGesture(tab: chrome.tabs.Tab) {
  if (tab.windowId === undefined) return Promise.resolve(false);
  return openReviewPanel(tab.windowId);
}

/**
 * A last way of showing the review.
 *
 * When the panel cannot be opened, the review is put in a small window
 * instead. The page is the same one the panel uses, so the review works the
 * same way, and the item is not left waiting where nobody can see it.
 */
async function openReviewWindow(tab: chrome.tabs.Tab) {
  if (await openReviewPanelWindow()) return true;  if (tab.id !== undefined) {
    await showInPageToast(tab.id, "DataVault is holding that for review. Open the DataVault side panel to check it.");
  }
  return false;
}

/**
 * Save the highlighted text.
 *
 * When "Save without reviewing" is on, the item is saved straight away and
 * the review panel is never opened. Otherwise the item is staged and the
 * panel is opened so the user can check it first.
 */
function captureFromContextMenu(tab: chrome.tabs.Tab, selectedText = "") {
  if (preferencesKnown) {
    /**
     * The setting is known, so the panel can be opened straight away while
     * the click is still being handled.
     */
    if (cachedPreferences.quickSaveSelectedText) {
      runInBackground("saving the selection", quickSaveSelection(tab, selectedText));
      return;
    }
    /**
     * The panel is opened straight away, while the click is still being
     * handled, and the capture is staged beside it.
     */
    const opened = openSidePanelFromUserGesture(tab);
    runInBackground("staging the selection", stageSelectionCapture(tab, selectedText));
    runInBackground("opening the review panel", opened.then((isOpen) => (isOpen ? undefined : openReviewWindow(tab))));
    return;
  }

  /**
   * The worker has only just been woken up, so the setting is not known
   * yet. It is read first, so the decision is right. The panel may have to
   * wait for the reading, and Chrome may then refuse to open it, which is
   * why there is a window to fall back on.
   */
  void (async () => {
    const preferences = await readPreferences();
    if (preferences.quickSaveSelectedText) {
      await quickSaveSelection(tab, selectedText);
      return;
    }
    const opened = openSidePanelFromUserGesture(tab);
    await stageSelectionCapture(tab, selectedText);
    if (!(await opened)) await openReviewWindow(tab);
  })().catch((error: unknown) => console.error("Could not save DataVault capture", error));
}

async function quickSaveSelection(tab: chrome.tabs.Tab, selectedText: string, page?: PageDetails) {
  const pending = await pendingFromTab(tab, selectedText, page);
  try {
    const result = await saveCapture(pending);
    const record = result.record as Record<string, unknown> | undefined;
    if (!record?.id) throw new Error("DataVault did not return the saved item.");
    await announceSavedCapture({
      title: typeof record.title === "string" ? record.title : pending.pageTitle,
      sourceDomain: typeof record.sourceDomain === "string" ? record.sourceDomain : pending.domain,
    }, pending.sourceTabId);
  } catch (error) {
    await enqueuePendingCapture({ ...pending, queueState: "retry", attempts: (pending.attempts ?? 0) + 1, lastError: error instanceof Error ? error.message : "Quick save failed.", queuedAt: new Date().toISOString() });
    if (pending.sourceTabId !== undefined) await showInPageToast(pending.sourceTabId, "Could not save right now. Open DataVault to sign in or retry.");
    throw error;
  }
}

async function showInPageToast(tabId: number, message: string) {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: (toastMessage: string) => {
        const toastId = "datavault-floating-toast";
        document.getElementById(toastId)?.remove();
        const toast = document.createElement("div");
        toast.id = toastId;
        toast.style.cssText = "position:fixed;top:20px;right:20px;z-index:2147483647;background:#1a3a3a;color:#fff;padding:12px 18px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:500;opacity:0;transform:translateY(-12px);transition:all .3s ease;pointer-events:none;";
        toast.textContent = toastMessage;
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = "1"; toast.style.transform = "translateY(0)"; });
        setTimeout(() => { toast.style.opacity = "0"; toast.style.transform = "translateY(-12px)"; setTimeout(() => toast.remove(), 300); }, 3_200);
      },
      args: [message],
    });
  } catch { /* restricted pages cannot display a toast */ }
}

/**
 * The toast that is shown after a piece is added to a doc.
 *
 * It carries an "Undo" button, so a piece can be taken back out without
 * opening the website.
 */
async function showClipToast(tabId: number, message: string, noteId: string, clipId: string) {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: (toastMessage: string, note: string, clip: string) => {
        const toastId = "datavault-floating-toast";
        document.getElementById(toastId)?.remove();
        const toast = document.createElement("div");
        toast.id = toastId;
        toast.style.cssText = "position:fixed;top:20px;right:20px;z-index:2147483647;background:#1a3a3a;color:#fff;padding:12px 16px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:500;display:flex;align-items:center;gap:12px;opacity:0;transform:translateY(-12px);transition:all .3s ease;";
        const text = document.createElement("span");
        text.textContent = toastMessage;
        const undo = document.createElement("button");
        undo.textContent = "Undo";
        undo.style.cssText = "background:transparent;border:0;color:#a4d4c5;font:inherit;font-weight:600;cursor:pointer;text-decoration:underline;";
        undo.addEventListener("click", () => {
          chrome.runtime.sendMessage({ action: "undo-doc-clip", noteId: note, clipId: clip }).catch(() => undefined);
          toast.remove();
        });
        toast.append(text, undo);
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = "1"; toast.style.transform = "translateY(0)"; });
        setTimeout(() => { toast.style.opacity = "0"; toast.style.transform = "translateY(-12px)"; setTimeout(() => toast.remove(), 300); }, 6_000);
      },
      args: [message, noteId, clipId],
    });
  } catch { /* restricted pages cannot display a toast */ }
}

/**
 * Read the selection from a page.
 */
async function readSelection(tab: chrome.tabs.Tab) {
  if (!tab.id) return undefined;
  try {
    const result = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return undefined;
        const range = selection.getRangeAt(0);
        if (range.collapsed) return undefined;
        const fragment = range.cloneContents();

        const blocked = ["script", "style", "iframe", "object", "embed", "link", "meta", "noscript", "form", "svg"];
        fragment.querySelectorAll(blocked.join(",")).forEach((node) => node.remove());
        fragment.querySelectorAll("*").forEach((node) => {
          for (const attribute of Array.from(node.attributes)) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith("on") || name === "srcdoc") node.removeAttribute(attribute.name);
          }
          const href = node.getAttribute("href");
          if (href) {
            try { node.setAttribute("href", new URL(href, location.href).toString()); } catch { node.removeAttribute("href"); }
          }
          const src = node.getAttribute("src");
          if (src) {
            try { node.setAttribute("src", new URL(src, location.href).toString()); } catch { node.removeAttribute("src"); }
          }
        });

        /**
         * A selection that covers only part of a table brings the table
         * along with it, and the result is a table with a column missing. The
         * words are what was wanted, so they are kept as paragraphs.
         *
         * A table that was taken whole is left alone, because a table the
         * person chose is worth keeping as a table.
         */
        const startNode = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement) as Element | null;
        const endNode = (range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement) as Element | null;
        const sourceTable = startNode?.closest?.("table") ?? null;
        const sourceCells = sourceTable ? sourceTable.querySelectorAll("td, th").length : 0;
        const sameTable = sourceTable !== null && endNode?.closest?.("table") === sourceTable;
        fragment.querySelectorAll("table").forEach((table) => {
          const cells = table.querySelectorAll("td, th").length;
          const partial = (sameTable && cells < sourceCells) || cells <= 1;
          if (!partial) return;
          const lines = Array.from(table.querySelectorAll("td, th"))
            .map((cell) => (cell.innerHTML ?? "").trim())
            .filter(Boolean);
          const replacement = document.createElement("div");
          replacement.innerHTML = lines.map((line) => `<p>${line}</p>`).join("");
          table.replaceWith(replacement);
        });

        const wrapper = document.createElement("div");
        wrapper.appendChild(fragment);
        return {
          html: wrapper.innerHTML,
          text: selection.toString().trim(),
          title: document.title,
          url: location.href,
        };
      },
    });
    return result[0]?.result as { html: string; text: string; title: string; url: string } | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the selection, waiting a moment for the page to catch up.
 *
 * A shortcut is handled while the page may still be working through the key
 * press, so the selection can be empty for a moment. It is read again a few
 * times before it is called empty, otherwise a shortcut pressed straight
 * after selecting would do nothing.
 */
async function selectionFromTab(tab: chrome.tabs.Tab) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const selection = await readSelection(tab);
    if (selection?.text) return selection;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return undefined;
}

/**
 * Tell the website that a doc has changed.
 */
async function broadcastNoteUpdate(note: { id: string; title: string }) {
  await broadcastNoteChanged(note);
}

/**
 * Add a piece of a web page to a doc.
 *
 * When the piece cannot be sent, it is put on the waiting list and sent
 * later, in the order it was added.
 */
async function sendDocClip(clip: PendingDocClip, options: { noteId?: string | undefined; sourceTabId?: number | undefined; idempotencyKey?: string | undefined; quiet?: boolean | undefined } = {}) {
  const { noteId, sourceTabId, idempotencyKey, quiet } = options;
  try {
    const result = noteId
      ? await addClipToDoc(noteId, clip)
      : await addClipToCurrentDoc(clip);
    await refreshCurrentDoc();
    await broadcastNoteUpdate({ id: result.noteId, title: result.noteTitle });
    await showActionBadge("📄", "#b8a4ed");
    if (sourceTabId !== undefined) {
      const where = result.sectionTitle ? ` → ${result.sectionTitle}` : "";
      await showClipToast(sourceTabId, `Added to ${result.noteTitle}${where}`, result.noteId, result.clipId);
    }
    return result;
  } catch (error) {
    /**
     * The piece keeps the same key it had before, so a retry replaces the
     * waiting item rather than adding a second copy of it.
     */
    await enqueuePendingCapture({
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      kind: "doc-clip",
      queueState: "retry",
      selectedText: clip.text,
      pageTitle: clip.source.title,
      pageUrl: clip.source.url,
      domain: clip.source.domain,
      capturedAt: clip.capturedAt,
      sourceTabId,
      docClip: clip,
      attempts: 1,
      lastError: error instanceof Error ? error.message : "The piece could not be added.",
      queuedAt: new Date().toISOString(),
    });
    if (sourceTabId !== undefined && !quiet) await showInPageToast(sourceTabId, "Could not add that to your doc. It will be added when the connection is back.");
    throw error;
  }
}

/**
 * The keyboard shortcut that adds the selection to the current doc.
 */
async function addSelectionToCurrentDoc(tab: chrome.tabs.Tab) {
  const selection = await selectionFromTab(tab);
  if (!selection?.text) throw new Error("Select some text on the page first.");
  await sendDocClip({
    html: selection.html,
    text: selection.text,
    source: { url: selection.url, title: selection.title, domain: domainOf(selection.url) },
    capturedAt: new Date().toISOString(),
  }, { sourceTabId: tab.id });
}

/**
 * Start a new doc. The pieces that follow go into it.
 */
async function createNewDoc() {
  const created = await startNewDoc();
  await broadcastNoteUpdate({ id: created.id, title: created.title });
  return created;
}

function domainOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "current-page";
  }
}

/**
 * The page a shortcut was pressed on.
 */
async function targetTab(tab?: chrome.tabs.Tab) {
  if (tab) return tab;
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!active) throw new Error("No active browser page was found.");
  return active;
}

/**
 * Run one keyboard shortcut.
 */
async function runCommand(command: string, tab?: chrome.tabs.Tab, panel?: Promise<boolean>) {
  if (command === "add-to-doc") {
    const target = await targetTab(tab);
    await addSelectionToCurrentDoc(target);
    return;
  }
  if (command === "new-doc") {
    await createNewDoc();
    return;
  }
  if (command === "save-as-item") {
    const target = await targetTab(tab);
    const selection = await selectedTextFromTab(target);
    if (!selection) throw new Error("Select some text on the page first.");

    /**
     * The shortcut follows the same rule as the context menu and the popup.
     * With "Save without reviewing" on, the item is saved straight away.
     * With it off, the item waits to be checked and the panel is opened so
     * it can be checked.
     */
    const preferences = preferencesKnown ? cachedPreferences : await readPreferences();
    if (preferences.quickSaveSelectedText) {
      await quickSaveSelection(target, selection);
      return;
    }

    await stageSelectionCapture(target, selection);
    if (panel) {
      /**
       * The panel was opened while the key press was being handled.
       */
      if (!(await panel)) await openReviewWindow(target);
      return;
    }
    /**
     * The setting was not known when the key was pressed, so the panel was
     * not opened then. It is opened now, and a window is used if Chrome
     * will not open the panel any more.
     */
    const opened = openSidePanelFromUserGesture(target);
    if (!(await opened)) await openReviewWindow(target);
  }
}

async function showActionBadge(text = "✓", color = "#16a34a") {
  try {
    await browser.action.setBadgeText({ text });
    await browser.action.setBadgeBackgroundColor({ color });
    setTimeout(() => { void browser.action.setBadgeText({ text: "" }); }, 3_000);
  } catch { /* unsupported action API */ }
}

async function broadcastToWebsiteTabs(record: unknown) {
  const webOrigin = new URL(WEB_URL).origin;
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    try {
      if (new URL(tab.url).origin === webOrigin) {
        void browser.tabs.sendMessage(tab.id, { action: "datavault-record-saved", record }).catch(() => {});
      }
    } catch { /* non-web URL */ }
  }
}

async function announceSavedCapture(record: { title?: string; sourceDomain?: string } | undefined, sourceTabId?: number) {
  await showActionBadge();
  if (sourceTabId !== undefined) await showInPageToast(sourceTabId, `Saved to DataVault: ${record?.title ?? "New capture"}`);
  await broadcastToWebsiteTabs(record);
}

function startExtensionAuthentication() {
  if (!authenticationInFlight) {
    authenticationInFlight = signInExtension().finally(() => { authenticationInFlight = undefined; });
  }
  return authenticationInFlight;
}

export default defineBackground(() => {
  const registerAndRefresh = async () => {
    /**
     * The settings are read before the menu is made.
     *
     * The menu can only be clicked once it exists, so by the time anyone can
     * use it the setting is already known. That is what lets the panel be
     * opened straight away, which Chrome only allows during the click.
     */
    await readPreferences();
    await setupMenu();
    await refreshCaptureMode();
    await refreshContextMenuTitles();
    await scheduleRetryAlarm();
    await scheduleKeepAwakeAlarm();
  };
  browser.runtime.onInstalled.addListener(() => runInBackground("starting up", registerAndRefresh()));
  browser.runtime.onStartup.addListener(() => runInBackground("starting up", registerAndRefresh()));
  runInBackground("starting up", registerAndRefresh());
  subscribeStorage(() => {
    runInBackground("refreshing the settings", refreshCaptureMode());
    runInBackground("refreshing the settings", readPreferences());
    runInBackground("renaming the menu", refreshContextMenuTitles());
  });

  /**
   * Anything that failed to save is tried again every few minutes, and once
   * more as soon as the browser starts.
   */
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === retryAlarm) runInBackground("retrying a waiting item", retryQueuedCaptures());
    if (alarm.name === keepAwakeAlarm) runInBackground("refreshing the settings", readPreferences());
  });

  /**
   * The keyboard shortcuts.
   *
   * They add to the current doc and start a new one. The shortcut that saves
   * a separate item is the same one the popup uses.
   */
  browser.commands?.onCommand.addListener((command, tab) => {
    /**
     * Chrome only lets the side panel be opened while the key press is
     * still being handled, which is before the first wait. So the panel is
     * opened here, and only when the setting already says a review is
     * wanted.
     *
     * When the setting is not known yet, nothing is opened. The setting is
     * read first and the panel is opened afterwards, because opening it for a
     * save that does not need a review would be worse than being late.
     */
    const mightReview = command === "save-as-item" && preferencesKnown && !cachedPreferences.quickSaveSelectedText;
    const panel = mightReview && tab ? openSidePanelFromUserGesture(tab) : undefined;

    void runCommand(command, tab, panel).catch(async (error: unknown) => {
      console.error(`DataVault could not run ${command}`, error);
      void recordExtensionError(`the ${command} shortcut`, error);
      /**
       * A shortcut that fails says so on the page. Without this the shortcut
       * looks as though it does nothing at all.
       */
      const message = error instanceof Error ? error.message : "That shortcut could not be completed.";
      const target = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => active));
      if (target?.id !== undefined) await showInPageToast(target.id, message);
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab) return;
    if (info.menuItemId === menuSaveId) {
      captureFromContextMenu(tab, info.selectionText ?? "");
      return;
    }
    if (info.menuItemId === menuAddToDocId) {
      void (async () => {
        const selection = await selectionFromTab(tab);
        if (!selection?.text) throw new Error("Select some text on the page first.");
        await sendDocClip({
          html: selection.html,
          text: selection.text,
          source: { url: selection.url, title: selection.title, domain: domainOf(selection.url) },
          capturedAt: new Date().toISOString(),
        }, { sourceTabId: tab.id });
      })().catch((error: unknown) => console.error("Could not add to the doc", error));
      return;
    }
    if (info.menuItemId === menuAddToNewDocId) {
      void (async () => {
        const selection = await selectionFromTab(tab);
        if (!selection?.text) throw new Error("Select some text on the page first.");
        const created = await createNewDoc();
        await sendDocClip({
          html: selection.html,
          text: selection.text,
          source: { url: selection.url, title: selection.title, domain: domainOf(selection.url) },
          capturedAt: new Date().toISOString(),
        }, { noteId: created.id, sourceTabId: tab.id });
      })().catch((error: unknown) => console.error("Could not start a new doc", error));
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return undefined;
    const payload = message as { action?: string; record?: { title?: string; sourceDomain?: string }; sourceTabId?: number; page?: PageDetails };

    // Chrome keeps the reply channel open while `true` is returned, so the
    // async work below can answer later.
    const respond = (operation: Promise<{ ok: boolean; error?: string }>) => {
      void operation.then(sendResponse, (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Something went wrong." }));
      return true;
    };

    if (payload.action === "stage-page-capture") {
      return respond(browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab) return { ok: false, error: "No active browser page was found." };
        try {
          await stagePageCapture(tab, payload.page);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "DataVault could not capture this page." };
        }
      }));
    }
    if (payload.action === "stage-selection-capture") {
      return respond(browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab) return { ok: false, error: "No active browser page was found." };
        try {
          const selectedText = payload.page?.selection ?? await selectedTextFromTab(tab);
          if (!selectedText) return { ok: false, error: "Select some text on the page first." };
          await stageSelectionCapture(tab, selectedText, payload.page);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "DataVault could not capture the selected text." };
        }
      }));
    }
    if (payload.action === "quick-save-selection") {
      return respond(browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab) return { ok: false, error: "No active browser page was found." };
        try {
          const selectedText = payload.page?.selection ?? await selectedTextFromTab(tab);
          if (!selectedText) return { ok: false, error: "Select some text on the page first." };
          await quickSaveSelection(tab, selectedText, payload.page);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "DataVault could not save the selected text." };
        }
      }));
    }
    if (payload.action === "start-extension-auth") {
      return respond(startExtensionAuthentication().then(() => ({ ok: true })).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "Sign-in could not be completed." })));
    }
    if (payload.action === "capture-saved") runInBackground("announcing a save", announceSavedCapture(payload.record, payload.sourceTabId));
    if (payload.action === "retry-queue") {
      return respond(retryQueuedCaptures().then(() => ({ ok: true })).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "Could not save the waiting items." })));
    }
    if (payload.action === "undo-doc-clip") {
      const { noteId, clipId } = payload as { noteId?: string; clipId?: string };
      if (!noteId || !clipId) return respond(Promise.resolve({ ok: false, error: "That piece could not be taken back out." }));
      return respond(removeClipFromDoc(noteId, clipId)
        .then(async () => { await refreshCurrentDoc(); await broadcastNoteUpdate({ id: noteId, title: "your doc" }); return { ok: true }; })
        .catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "That piece could not be taken back out." })));
    }
    if (payload.action === "add-to-current-doc") {
      return respond(browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab) return { ok: false, error: "No active browser page was found." };
        try {
          await addSelectionToCurrentDoc(tab);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "DataVault could not add that to your doc." };
        }
      }));
    }
    if (payload.action === "start-new-doc") {
      return respond(createNewDoc().then(() => ({ ok: true })).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "A new doc could not be started." })));
    }
    if (payload.action === "make-current-doc") {
      const { noteId } = payload as { noteId?: string };
      if (!noteId) return respond(Promise.resolve({ ok: false, error: "That doc could not be chosen." }));
      return respond(makeCurrentDoc(noteId).then(() => ({ ok: true })).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "That doc could not be chosen." })));
    }
    if (payload.action === "refresh-current-doc") {
      return respond(refreshCurrentDoc().then(() => ({ ok: true })).catch(() => ({ ok: false, error: "The current doc could not be read." })));
    }
    return undefined;
  });
});
