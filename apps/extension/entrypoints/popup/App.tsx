import { useCallback, useEffect, useMemo, useState } from "react";
import { browser } from "wxt/browser";
import { ExternalLink, FileText, FolderOpen, Highlighter, LogOut, Plus, ScanText } from "lucide-react";
import { Button } from "@data-vault/ui";
import type { AuthSession } from "@data-vault/types";
import { ExtensionHeader } from "../../components/header";
import { LoggedOut } from "../../components/logged-out";
import { ShortcutHelp } from "../../components/shortcut-help";
import { EditableTitle } from "../../components/editable-title";
import { clearExtensionErrors, readExtensionErrors, type RecordedError } from "../../lib/errors";
import { getAuth, getPreferences, setPreferences, subscribeStorage, type PageDetails } from "../../lib/storage";
import { signOutExtension } from "../../lib/auth";
import { WEB_URL, withOrganization } from "../../lib/api";
import { refreshCurrentDoc, renameDoc, startNewDoc } from "../../lib/docs";
import { currentFolderId, folderDepths, listFolders, rememberFolder, type FolderOption } from "../../lib/folders";
import { openReviewPanel, openReviewWindow } from "../../lib/panel";

/**
 * The popup used to hold a search box, a recent-items list, and three
 * competing buttons, which left a new user unsure what to press. It now does
 * one job: offer the two ways to save, and nothing else.
 */
export function PopupApp() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [session, setSession] = useState<AuthSession>();
  const [selection, setSelection] = useState("");
  const [quickSave, setQuickSave] = useState(false);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [busy, setBusy] = useState<"page" | "selection" | null>(null);
  const [currentDoc, setCurrentDoc] = useState<{ id: string; title: string; clipCount: number } | null>(null);
  const [errors, setErrors] = useState<RecordedError[]>([]);
  /**
   * The folder new items go into.
   *
   * It is chosen here, the same way the current doc is, so that a quick save
   * lands in the folder the person is working in rather than always in the
   * first one.
   */
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [folderId, setFolderId] = useState("");
  /**
   * How deep each folder sits, so that a sub-folder is shown under the
   * folder it belongs to.
   */
  const depths = useMemo(() => folderDepths(folders), [folders]);

  const load = async () => {
    const auth = await getAuth();
    setAuthenticated(Boolean(auth));
    const preferences = await getPreferences();
    setQuickSave(preferences.quickSaveSelectedText);
    if (!auth) return;
    try {
      setSession(await withOrganization((api) => api.getMe()));
      const current = await refreshCurrentDoc();
      setCurrentDoc(current?.noteId ? { id: current.noteId, title: current.title ?? "Untitled doc", clipCount: current.clipCount ?? 0 } : null);
      const listed = await listFolders();
      setFolders(listed);
      const folder = await currentFolderId(listed);
      setFolderId(folder);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach DataVault.");
    }
  };

  useEffect(() => {
    void load();
    return subscribeStorage(() => void load());
  }, []);

  /**
   * The problems the extension has run into.
   *
   * Chrome keeps its own list on the extensions page, which is hidden away.
   * Showing them here means the person can see what went wrong without
   * leaving the browser.
   */
  useEffect(() => {
    void readExtensionErrors().then(setErrors).catch(() => undefined);
  }, []);

  const openSidePanel = async () => {
    /**
     * Chrome opens its side panel and Firefox opens its sidebar. Both are
     * the same page, and a small window is used when the browser will not
     * open its own.
     */
    const currentWindow = await browser.windows.getCurrent();
    if (currentWindow?.id === undefined) throw new Error("DataVault could not find the current browser window.");
    if (await openReviewPanel(currentWindow.id)) return;
    if (await openReviewWindow()) return;
    throw new Error("DataVault could not open the review panel.");
  };

  /**
   * Read the active page while the popup still has access to it.
   *
   * Opening the side panel closes the popup, and the browser takes the
   * temporary access that a toolbar click granted with it. Everything the
   * capture needs has to be read first, while the access still holds.
   */
  const readActivePage = useCallback(async (): Promise<PageDetails> => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab) return {};
      let selection = "";
      if (tab.id !== undefined) {
        const result = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.getSelection()?.toString().trim() ?? "",
        });
        selection = result[0]?.result ?? "";
      }
      return { url: tab.url ?? undefined, title: tab.title ?? undefined, selection };
    } catch {
      // A restricted page cannot be read. The capture still works, it just
      // has no source address.
      return {};
    }
  }, []);

  useEffect(() => {
    void readActivePage().then((page) => setSelection(page.selection ?? ""));
  }, [readActivePage]);

  const savePage = async () => {
    setError("");
    setBusy("page");
    try {
      const page = await readActivePage();
      await openSidePanel();
      const result = await browser.runtime.sendMessage({ action: "stage-page-capture", page }) as { ok?: boolean; error?: string } | undefined;
      if (!result?.ok) throw new Error(result?.error ?? "DataVault could not capture this page.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "DataVault could not capture this page.");
    } finally {
      setBusy(null);
    }
  };

  const saveSelection = async () => {
    setError("");
    setBusy("selection");
    try {
      // Read the selection before the side panel opens, for the same reason
      // as saving a whole page.
      const page = await readActivePage();
      if (quickSave) {
        const result = await browser.runtime.sendMessage({ action: "quick-save-selection", page }) as { ok?: boolean; error?: string } | undefined;
        if (!result?.ok) throw new Error(result?.error ?? "DataVault could not save the selected text.");
        window.close();
        return;
      }
      await openSidePanel();
      const result = await browser.runtime.sendMessage({ action: "stage-selection-capture", page }) as { ok?: boolean; error?: string } | undefined;
      if (!result?.ok) throw new Error(result?.error ?? "DataVault could not save the selected text.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "DataVault could not save the selected text.");
    } finally {
      setBusy(null);
    }
  };

  const toggleQuickSave = async (next: boolean) => {
    setQuickSave(next);
    const preferences = await getPreferences();
    await setPreferences({ ...preferences, quickSaveSelectedText: next });
  };

  /**
   * Choose the folder new items go into.
   *
   * It is remembered, so the next quick save goes into the same folder
   * without asking again.
   */
  const chooseFolder = async (next: string) => {
    setFolderId(next);
    await rememberFolder(next);
  };

  const signOut = async () => {
    setSigningOut(true);
    setError("");
    try {
      await signOutExtension();
      setAuthenticated(false);
      setSession(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "DataVault could not sign out.");
    } finally {
      setSigningOut(false);
    }
  };

  const newDoc = async () => {
    setError("");
    try {
      const created = await startNewDoc();
      setCurrentDoc({ id: created.id, title: created.title, clipCount: created.clipCount });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A new doc could not be started.");
    }
  };

  return (
    <main className="w-[360px] bg-canvas">
      <ExtensionHeader />
      {authenticated === false ? (
        <LoggedOut onSignedIn={() => void load()} />
      ) : authenticated === null ? (
        <div className="p-8 text-center text-sm text-muted">Opening DataVault…</div>
      ) : (
        <>
          <section className="space-y-2 border-b border-line p-4">
            <div className="rounded-2xl bg-deep p-4 text-white">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface/10"><FileText className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[.13em] text-on-deep">Current doc</p>
                  <EditableTitle
                    title={currentDoc?.title ?? "No doc yet"}
                    disabled={!currentDoc}
                    className="mt-1"
                    onSave={(title) => {
                      if (!currentDoc) return;
                      void renameDoc(currentDoc.id, title)
                        .then((updated) => setCurrentDoc({ ...currentDoc, title: updated.title }))
                        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "The doc could not be renamed."));
                    }}
                  />
                  <p className="mt-0.5 text-xs text-white/70">
                    {currentDoc ? `${currentDoc.clipCount} ${currentDoc.clipCount === 1 ? "piece" : "pieces"}` : "The first clip makes one."}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => void newDoc()}><Plus className="size-3.5" />New doc</Button>
                {currentDoc ? (
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => void browser.tabs.create({ url: `${WEB_URL}/docs/${currentDoc.id}` })}>Open</Button>
                ) : null}
              </div>
            </div>

            <ShortcutHelp />

          {errors.length ? (
            <section className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">Something went wrong</p>
                <button onClick={() => { void clearExtensionErrors().then(() => setErrors([])); }} className="text-xs underline">Clear</button>
              </div>
              <ul className="mt-1 space-y-1">
                {errors.slice(0, 3).map((error, index) => (
                  <li key={`${error.at}-${index}`} className="text-xs leading-4">
                    <span className="font-semibold">{error.scope}:</span> {error.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          </section>

          <section className="space-y-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-[.13em] text-muted">Save as a separate item</p>
            <div className="rounded-2xl border border-line bg-surface p-3">
              <label htmlFor="popup-folder" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-muted">
                <FolderOpen className="size-3.5" />
                Save into
              </label>
              <select
                id="popup-folder"
                className="mt-2 h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm"
                value={folderId}
                onChange={(event) => void chooseFolder(event.target.value)}
              >
                {folders.length
                  ? folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {`${"— ".repeat(depths.get(folder.id) ?? 0)}${folder.name}${typeof folder.itemCount === "number" ? ` (${folder.itemCount})` : ""}`}
                    </option>
                  ))
                  : <option value="">The default folder</option>}
              </select>
              <p className="mt-1 text-xs leading-5 text-muted">
                The folder new items go into. It is the same folder you have on the website, and it is remembered for next time.
              </p>
            </div>
            <Button className="w-full justify-start" onClick={() => void savePage()} disabled={busy !== null}>
              <ScanText className="size-4" />
              {busy === "page" ? "Capturing…" : "Save this page"}
            </Button>
            <Button
              className="w-full justify-start"
              variant="secondary"
              onClick={() => void saveSelection()}
              disabled={busy !== null || !selection}
              title={selection ? undefined : "Highlight some text on the page first"}
            >
              <Highlighter className="size-4" />
              {busy === "selection" ? "Saving…" : "Save highlighted text"}
            </Button>
            {!selection ? (
              <p className="px-1 text-xs leading-5 text-muted">
                Highlight text on the page to save just that part.
              </p>
            ) : null}

            {error ? <p className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
          </section>

          <section className="border-t border-line p-4">
            <label className="flex cursor-pointer items-start justify-between gap-3 text-sm">
              <span>
                <span className="block font-medium">Save without reviewing</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">
                  Skip the review step and save highlighted text straight away.
                </span>
              </span>
              <input
                type="checkbox"
                className="mt-1"
                checked={quickSave}
                onChange={(event) => void toggleQuickSave(event.target.checked)}
              />
            </label>
          </section>

          <section className="border-t border-line">
            <button
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-hover"
              onClick={() => void browser.tabs.create({ url: `${WEB_URL}/saved` })}
            >
              <ExternalLink className="size-4" />
              Open DataVault
            </button>
          </section>

          <footer className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-muted">
            <span className="min-w-0 truncate">{session?.user.email}</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto shrink-0 px-2 text-xs"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              <LogOut className="size-3.5" />
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </footer>
        </>
      )}
    </main>
  );
}
