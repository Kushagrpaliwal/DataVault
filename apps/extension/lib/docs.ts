import { browser } from "wxt/browser";
import { withOrganization, WEB_URL } from "./api";
import { getPreferences, setPreferences, type PendingDocClip } from "./storage";

/**
 * The doc that the keyboard shortcut adds to.
 *
 * The extension keeps a copy of the answer so it can show the name of the
 * doc without asking the server every time. The website and the extension
 * always agree, because the copy comes from the server.
 */
export async function refreshCurrentDoc() {
  try {
    const current = await withOrganization((api) => api.currentNote());
    const preferences = await getPreferences();
    const next = {
      ...preferences,
      currentDocId: current.noteId ?? undefined,
      currentDocTitle: current.title ?? undefined,
    };
    await setPreferences(next);
    return current;
  } catch {
    return null;
  }
}

/** The name of the current doc, as it is known to the extension. */
export async function currentDocTitle() {
  const preferences = await getPreferences();
  return preferences.currentDocTitle ?? "your doc";
}

/**
 * Add a piece of a web page to a doc.
 *
 * The server works out which doc to use. When the user has no current doc,
 * one is made and named after the page the piece came from.
 */
export async function addClipToCurrentDoc(clip: PendingDocClip) {
  return withOrganization((api) => api.addCurrentNoteClip({
    html: clip.html,
    text: clip.text,
    source: clip.source,
    capturedAt: clip.capturedAt,
  }));
}

/**
 * Add a piece to a doc that is named.
 */
export async function addClipToDoc(noteId: string, clip: PendingDocClip) {
  return withOrganization((api) => api.addNoteClip(noteId, {
    html: clip.html,
    text: clip.text,
    source: clip.source,
    capturedAt: clip.capturedAt,
  }));
}

/**
 * Take a piece back out of a doc.
 */
export async function removeClipFromDoc(noteId: string, clipId: string) {
  return withOrganization((api) => api.removeNoteClip(noteId, clipId));
}

/**
 * Start a new doc and make it the current one.
 */
export async function startNewDoc(title?: string) {
  const name = title ?? `Untitled doc · ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  const created = await withOrganization((api) => api.createNote({ title: name }));
  await withOrganization((api) => api.setCurrentNote(created.id));
  const preferences = await getPreferences();
  await setPreferences({ ...preferences, currentDocId: created.id, currentDocTitle: created.title });
  return created;
}

/**
 * Make a doc the current one.
 */
export async function makeCurrentDoc(noteId: string) {
  await withOrganization((api) => api.setCurrentNote(noteId));
  await refreshCurrentDoc();
}

/**
 * Give a doc a name.
 *
 * A doc made from the extension starts with a name that says nothing, so it
 * has to be changeable here and then.
 */
export async function renameDoc(noteId: string, title: string) {
  const updated = await withOrganization((api) => api.updateNote(noteId, { title }));
  await broadcastNoteUpdate({ id: updated.id, title: updated.title });
  return updated;
}

/**
 * Tell the website that a doc has changed.
 *
 * The website has the doc open, so it shows the new name without waiting.
 */
export async function broadcastNoteUpdate(note: { id: string; title: string }) {
  const webOrigin = new URL(WEB_URL).origin;
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    try {
      if (new URL(tab.url).origin === webOrigin) {
        void browser.tabs.sendMessage(tab.id, { action: "datavault-note-updated", note }).catch(() => {});
      }
    } catch { /* not a web address */ }
  }
}
