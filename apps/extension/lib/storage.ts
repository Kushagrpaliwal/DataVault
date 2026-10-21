import { browser } from "wxt/browser";
import type { ExtensionTokenSet } from "@data-vault/types";

const AUTH_KEY = "dataVaultAuth";
const PENDING_KEY = "dataVaultPendingCapturesV3";
const LEGACY_PENDING_KEY = "dataVaultPendingCapture";
const PREFERENCES_KEY = "dataVaultCapturePreferencesV2";

export interface StoredAuth extends ExtensionTokenSet { expiresAt: number }
export type PageCaptureMode = "visible" | "full-text" | "selection-only";
export interface ExtensionPreferences {
  quickSaveSelectedText: boolean;
  pageCaptureMode: PageCaptureMode;
  defaultVaultId?: string | undefined;
  /**
   * The workspace the chosen folder belongs to.
   *
   * A folder belongs to one workspace, so it is only used when the
   * extension is still in that workspace.
   */
  defaultVaultOrganizationId?: string | undefined;
  /**
   * The doc that the keyboard shortcut adds to.
   *
   * It is a mirror of the server's own answer, so the extension and the
   * website always agree on which doc is current.
   */
  currentDocId?: string | undefined;
  currentDocTitle?: string | undefined;
}
export interface PendingCapture {
  idempotencyKey: string;
  selectedText: string;
  pageTitle: string;
  /** Missing when the browser would not tell the extension the page address. */
  pageUrl?: string | undefined;
  domain: string;
  capturedAt: string;
  sourceTabId?: number | undefined;
  sourceWindowId?: number | undefined;
  screenshotDataUrl?: string | undefined;
  attachScreenshot?: boolean | undefined;
  contentKind?: "selection" | "page-info" | "page-text" | undefined;
  /**
   * The page as it was, as the markup of the parts that were kept.
   *
   * It is sent along so that the item can be traced back to the page, even
   * after the page itself has changed.
   */
  pageHtml?: string | undefined;
  captureQuality?: CaptureQuality | undefined;
  queueState?: "review" | "retry" | undefined;
  attempts?: number | undefined;
  lastError?: string | undefined;
  queuedAt?: string | undefined;
  savedRecord?: { id: string; title: string; sourceDomain?: string | null } | undefined;
  /**
   * What kind of waiting item this is.
   *
   * A saved item is the usual case. A piece of a web page waiting to be
   * added to a doc is the other one.
   */
  kind?: "capture" | "doc-clip" | undefined;
  /** The details of a piece that is waiting to be added to a doc. */
  docClip?: PendingDocClip | undefined;
}

/**
 * A piece of a web page that is waiting to be added to a doc.
 */
export interface PendingDocClip {
  /** The doc it should go into. The current doc is used when this is empty. */
  noteId?: string | undefined;
  /** The formatting of the selection, as it was on the page. */
  html?: string | undefined;
  /** The words of the selection. */
  text: string;
  source: { url?: string | undefined; title: string; domain: string };
  capturedAt: string;
}

export interface CaptureQuality {
  textLength: number;
  hasTitle: boolean;
  hasSourceUrl: boolean;
  likelyAccessWall: boolean;
  likelyCookieBanner: boolean;
  warnings: string[];
}

/**
 * What the popup could read from the active page.
 *
 * The popup is the only place with access to the tab, because a toolbar
 * click grants temporary access that is taken away as soon as the popup
 * closes. The background worker therefore uses these details instead of
 * reading the tab itself.
 */
export interface PageDetails {
  url?: string | undefined;
  title?: string | undefined;
  selection?: string | undefined;
}

export async function getAuth() { return (await browser.storage.local.get(AUTH_KEY))[AUTH_KEY] as StoredAuth | undefined; }
export async function setAuth(value?: StoredAuth) { if (value) await browser.storage.local.set({ [AUTH_KEY]: value }); else await browser.storage.local.remove(AUTH_KEY); }
export async function getPreferences() {
  const stored = (await browser.storage.local.get(PREFERENCES_KEY))[PREFERENCES_KEY] as Partial<ExtensionPreferences> | undefined;
  return { quickSaveSelectedText: false, pageCaptureMode: "visible" as const, ...stored };
}export async function setPreferences(value: ExtensionPreferences) { await browser.storage.local.set({ [PREFERENCES_KEY]: value }); }

/**
 * The workspace the extension saves into.
 *
 * It is the workspace the sign-in was authorised for. The token is bound to
 * it, so the extension cannot be pointed at another one.
 */
export async function effectiveWorkspaceId(): Promise<string | undefined> {
  const auth = await getAuth();
  return auth?.organizationId;
}

function normalizePending(value: Partial<PendingCapture>): PendingCapture {
  return {
    ...value,
    idempotencyKey: value.idempotencyKey ?? crypto.randomUUID(),
    contentKind: value.contentKind ?? "selection",
    queueState: value.queueState ?? "review",
    attempts: value.attempts ?? 0,
  } as PendingCapture;
}

export async function getPendingCaptures(): Promise<PendingCapture[]> {
  const stored = (await browser.storage.local.get(PENDING_KEY))[PENDING_KEY];
  if (Array.isArray(stored)) return stored.map((value) => normalizePending(value as Partial<PendingCapture>));

  const legacy = (await browser.storage.session.get(LEGACY_PENDING_KEY))[LEGACY_PENDING_KEY] as Partial<PendingCapture> | undefined;
  if (!legacy) return [];
  const migrated = [normalizePending(legacy)];
  await browser.storage.local.set({ [PENDING_KEY]: migrated });
  await browser.storage.session.remove(LEGACY_PENDING_KEY);
  return migrated;
}

/**
 * How many items may wait for a review at the same time.
 *
 * A review is a decision the user has to make, so a small number is enough.
 */
const MAX_REVIEW_CAPTURES = 8;
/**
 * How many items may wait to be synced.
 *
 * These are items the user already asked to save, so the queue is much
 * larger. They are never thrown away to make room for a review item.
 */
const MAX_RETRY_CAPTURES = 50;

export async function setPendingCaptures(values: PendingCapture[]) {
  /**
   * The two kinds of waiting item are capped separately. Before, a single
   * cap of eight covered everything, so a burst of failed saves pushed out
   * items that were still waiting to be reviewed.
   */
  const retry = values.filter((item) => item.queueState === "retry").slice(0, MAX_RETRY_CAPTURES);
  const review = values.filter((item) => item.queueState !== "retry").slice(0, MAX_REVIEW_CAPTURES);
  const kept = [...retry, ...review];
  if (kept.length) await browser.storage.local.set({ [PENDING_KEY]: kept });
  else await browser.storage.local.remove(PENDING_KEY);
}

/**
 * The item waiting to be reviewed.
 *
 * Items that are only waiting for the connection to come back are kept out of
 * the way, so a failed quick save never turns into a review the user did not
 * ask for.
 */
export async function getReviewCapture() {
  const all = await getPendingCaptures();
  return all.find((item) => item.queueState !== "retry");
}

/** The items that were saved but could not reach DataVault yet. */
export async function getRetryCaptures() {
  const all = await getPendingCaptures();
  return all.filter((item) => item.queueState === "retry");
}

export async function getPendingCapture() {
  return (await getPendingCaptures())[0];
}

export async function setPendingCapture(value?: PendingCapture) {
  const current = await getPendingCaptures();
  const review = current.filter((item) => item.queueState !== "retry");
  const retry = current.filter((item) => item.queueState === "retry");
  await setPendingCaptures(value ? [value, ...review.slice(0, MAX_REVIEW_CAPTURES - 1), ...retry] : [...review.slice(1), ...retry]);
}

export async function enqueuePendingCapture(value: PendingCapture) {
  const current = await getPendingCaptures();
  await setPendingCaptures([value, ...current.filter((item) => item.idempotencyKey !== value.idempotencyKey)]);
}

export async function updatePendingCapture(idempotencyKey: string, patch: Partial<PendingCapture>) {
  const current = await getPendingCaptures();
  await setPendingCaptures(current.map((item) => item.idempotencyKey === idempotencyKey ? { ...item, ...patch } : item));
}

export async function removePendingCapture(idempotencyKey: string) {
  await setPendingCaptures((await getPendingCaptures()).filter((value) => value.idempotencyKey !== idempotencyKey));
}

/** Throw away every item that is waiting to be synced. */
export async function clearRetryCaptures() {
  await setPendingCaptures((await getPendingCaptures()).filter((value) => value.queueState !== "retry"));
}

export function subscribeStorage(listener: () => void) {
  const callback = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes[AUTH_KEY] || changes[PENDING_KEY] || changes[LEGACY_PENDING_KEY] || changes[PREFERENCES_KEY]) listener();
  };
  browser.storage.onChanged.addListener(callback);
  return () => browser.storage.onChanged.removeListener(callback);
}
