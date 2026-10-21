# Browser extension

The WXT extension targets Chrome, Edge, and Chromium Manifest V3. Its generated Chrome directory is `apps/extension/.output/chrome-mv3`.

## Entrypoints

- `background.ts`: service worker, context menu registration, active-tab metadata/selection, optional screenshot, side-panel opening, the keyboard shortcuts, and the retry queue
- `content.ts`: narrow DataVault website integration marker; capture itself does not require broad content-script access
- `popup/`: the current doc card with the shortcut hints, the two ways to save (**Save this page** and **Save highlighted text**), the **Save without reviewing** toggle, and a link to the DataVault website
- `sidepanel/`: three tabs — **Review** (edit and save the pending capture), **Docs** (the current doc, quick add, and the doc list) and **Saved** (saved items with debounced search) — plus a settings view behind the gear icon

The popup deliberately does not list saved items. The side panel owns that surface, so there is one place to look rather than two overlapping ones.

## Keyboard shortcuts

| Command | Default key | What it does |
| --- | --- | --- |
| `_execute_action` | `Alt+Shift+O` | Opens the panel without saving anything. Chrome adds this command on its own for the toolbar button. |
| `add-to-doc` | `Alt+Shift+D` | Adds the selected text to the current doc. The formatting is kept. |
| `new-doc` | `Alt+Shift+F` | Starts a new doc and makes it the current one. The pieces that follow go into it. |
| `save-as-item` | `Alt+Shift+S` | Saves the selected text as a separate saved item, the same as the popup button. It needs a selection. |

Chrome allows at most four suggested keys, and there are four commands, so each one is given a key of its own. The keys were not guessed: each one was watched being handed to an extension by Chrome.

Chrome keeps a list of accelerators for itself. `Ctrl+Shift+D` is bookmark-all-tabs and `Ctrl+Shift+A` is the tab search, and Chrome will not hand either of them to an extension by itself. A shortcut bound to one of those keys may never arrive. With Alt and Shift, Chrome keeps A, B, C, N, P, R, T, W, X and Z for itself and hands out the rest, which is why the suggested keys are all Alt and Shift with a letter.

Chrome only fills the suggested keys in the first time the extension is installed. A key that is cleared afterwards stays cleared until it is chosen again on the shortcuts page.

The popup and the side panel list every command, with the key it has now, or with **Not set** when it has none. A command without a key is given a free one that Chrome is known to hand out and that none of the other commands is on. When the key a command has is one Chrome keeps, that is said, and a free key is offered beside it.

The free key can be copied straight from the panel and pasted into the browser's shortcut box, because Chrome does not let an extension change its own shortcuts — only Firefox does that, and there the key is set straight away. The panel also lists the keys Chrome has already taken, each with what Chrome uses it for, so a free one can be picked.

The keys Chrome keeps, and what it uses them for:

| Key | Chrome uses it for |
| --- | --- |
| `Ctrl+D` | Bookmark this tab |
| `Ctrl+Shift+D` | Bookmark all tabs |
| `Ctrl+Shift+A` | Search tabs |
| `Ctrl+Shift+B` | Show the bookmarks bar |
| `Ctrl+Shift+C` | Inspect the element |
| `Ctrl+Shift+G` | Find the next match |
| `Ctrl+Shift+I` / `Ctrl+Shift+J` | Developer tools |
| `Ctrl+Shift+M` | Switch profile |
| `Ctrl+Shift+N` | Incognito window |
| `Ctrl+Shift+O` | Bookmark manager |
| `Ctrl+Shift+P` | Command menu |
| `Ctrl+Shift+R` | Reload without the cache |
| `Ctrl+Shift+T` | Reopen the closed tab |
| `Ctrl+Shift+U` | View the page source |
| `Ctrl+Shift+W` | Close the window |
| `Ctrl+F` / `Ctrl+L` / `Ctrl+P` / `Ctrl+R` / `Ctrl+S` / `Ctrl+T` / `Ctrl+W` / `Ctrl+N` | Find, address bar, print, reload, save, new tab, close tab, new window |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next or previous tab |
| `Ctrl+1 … Ctrl+9` | Go to that tab |

The popup and the side panel list every command of the extension, with the key it has now, or with **Not set** when it has none. Each row says where the shortcut sends the selected text, because "save" means two different things here: a doc, or the Saved list. The list is read again when the panel comes back into view, so a key changed on the shortcuts page shows up straight away.

A shortcut that collides with a browser key behaves like that browser key. `Ctrl+A` is Select All, so a shortcut bound to it picks up the whole page rather than the selection. The selection is read a few times over before it is called empty, because a shortcut is handled while the page may still be working through the key press. Without that, a shortcut pressed straight after selecting would find nothing and do nothing.

A piece added to a doc shows a 📄 badge on the toolbar icon and a toast on the page that says where it went. A saved item shows a ✓ badge.

## The current doc

The current doc is the doc that `add-to-doc` adds to. It is stored on the server (`user_note_prefs`), so the website and the extension always agree on it. The extension keeps a copy of the name in its own storage so it can show it without asking the server every time.

There is no current doc at first. The first `add-to-doc` press makes one and names it after the page the piece came from. `new-doc` makes a fresh doc and makes it current; it keeps its "Untitled doc" name until the first piece arrives, and is then named after that page.

The name of the current doc can be changed in the extension. The pencil beside the name turns it into a field: Enter saves it, Escape keeps the old name. The website shows the new name straight away, because the change is announced to any open tab.

The current doc is chosen from the doc list, in the website and in the side panel. The star on a row marks the doc the shortcut adds to, and pressing it on any other row makes that one current. The choice is kept on the server, so the website and the extension always show the same one.

A shortcut that cannot be completed says so on the page. It used to fail quietly, which made it look as though the shortcut did nothing.

## Workspaces

Every account is given a personal workspace when it signs up, and every workspace has a default folder in it. A capture goes into the default folder of the workspace it was sent to.

The workspace list is ordered so that a real workspace comes first and the personal one comes last. The first entry is what the interface falls back to when nothing has been chosen, so a capture does not land in the personal bucket by default just because that bucket was made first. The order is fixed, so the fallback does not move from one request to the next.

The extension works in the workspace its sign-in was authorised for. The access token carries that workspace, so a token that was taken cannot be pointed at another one, and the server refuses a request that names a different workspace. To work in another workspace, sign in again from the DataVault website and choose it there.

The extension's **Where things go** setting chooses the folder new items go into. A folder belongs to one workspace, so it is only used while the extension is still in that workspace.

## Free AI credits in the extension

The extension asks the same API the website uses, so the two never show a different allowance.

- A **credit strip** sits under the tabs. It says how many credits are left today, or why there are none: the address is not confirmed, the content agreement has not been made, the day's credits are used up, or AI is switched off on the server.
- The **Saved** tab has a **Summarise this** action on every item. It spends one credit, and the summary appears above the saved text.
- The **settings** view shows the allowance and a shortcut to confirm the email address.

The Gemini key is never in the extension. The extension calls DataVault's API, and the API calls Gemini.

The free tier may use submitted content to improve Google's products, so the first AI request asks for agreement, in the panel where the request is made. The API refuses the request with `AI_CONSENT_REQUIRED` until that agreement is recorded, so the panel can explain what is needed rather than failing silently.

## Permission rationale

- `contextMenus`: show **Save to DataVault**, **Add to doc** and **Add to a new doc** for selected text.
- `storage`: hold the rotated extension auth session, small preferences, the mirror of the current doc, and a durable queue of reviewable or retryable pending items.
- `identity`: perform the browser-mediated PKCE callback.
- `sidePanel`: display the capture review, the docs view and the richer extension experience.
- `activeTab`: read/capture only the tab on which the user acted.
- `scripting`: retrieve a current selection for the popup quick action and the doc shortcut on the active tab.
- `alarms`: retry the items that could not be saved every five minutes, and read the settings again every minute so they are always known.
- API host permission: call the configured DataVault API only.

The manifest does not request `<all_urls>` or the broad `tabs` permission. The development content script matches only the configured local DataVault website. Context-menu `selectionText` enables universal capture without injecting code into every site.

## Saving behaviour

There are two ways to save, and they behave predictably:

| Trigger | Behaviour |
| --- | --- |
| Right-click → **Save to DataVault** | Opens the side panel for review, or saves immediately when **Save without reviewing** is on. |
| Popup → **Save this page** | Opens the side panel for review. |
| Popup → **Save highlighted text** | Opens the side panel for review, or saves immediately when **Save without reviewing** is on. |
| `Alt+Shift+D` | Adds the selection to the current doc. No panel, no review, no popup. |
| `Alt+Shift+F` | Starts a new doc. |
| `Alt+Shift+S` | Saves the selection as a separate item. |
| Right-click → **Add to doc** | Adds the selection to the current doc. |
| Right-click → **Add to a new doc** | Starts a new doc and adds the selection to it. |

The context-menu label never changes. Whether a save is reviewed is decided by the explicit **Save without reviewing** toggle in the popup (off by default), so the menu item always means the same thing.

The setting is read at the moment of the click, not taken from a value the service worker happened to have in memory. A Manifest V3 service worker is stopped while it is idle and started again for the next event, so a click that arrives after a pause would otherwise be handled with a stale setting and would open the review panel even though the user had asked for no review. Reading the setting first means a quick save never opens the panel, and a review always does.

If the review panel cannot be opened, the page says so rather than leaving the item waiting where nobody can see it.

The doc shortcut is a separate flow from saving an item. A piece added to a doc never appears in the **Saved** list, and a saved item never appears in a doc.

## The setting and the review panel

**Save without reviewing** governs every way of saving, not just the right-click menu:

| Trigger | Setting off | Setting on |
| --- | --- | --- |
| Right-click → **Save to DataVault** | Staged and the panel opens | Saved straight away |
| Popup → **Save this page** | Staged and the panel opens | Staged and the panel opens |
| Popup → **Save highlighted text** | Staged and the panel opens | Saved straight away |
| The **save as an item** shortcut | Staged and the panel opens | Saved straight away |
| The **add to the current doc** shortcut | Added to the doc | Added to the doc |

Chrome only lets the side panel be opened while the click or the key press is still being handled, which is before the first wait. Two things make that work:

- **The setting is read before the menu is made.** The menu can only be clicked once it exists, so the setting is always known by then.
- **The worker is kept awake.** Chrome stops a service worker after a short idle time, and the setting is read when it starts. A short alarm reads it again, so the first shortcut after a pause still knows what the user wants.

The menu itself is only added to, never taken away and made again. Tearing it down and rebuilding it made it flicker, and the worker starts often now.

When the panel cannot be opened at all, the review is put in a small window instead, so the item is never left waiting where nobody can see it.

## When something goes wrong

Chrome keeps a list of extension errors on the extensions page, and it is not easy to get at. The extension keeps its own list of the last ten problems, and shows them in the **popup** and in the side panel's settings, with a button to clear them.

Nothing is left to fail quietly. Every promise that runs on its own is watched, so a problem is recorded rather than showing up as an unexplained error on the extension's card.

## What a piece keeps

The formatting of the selection is kept, so a heading stays a heading and a link stays a link. Anything that could run on its own — scripts, styles, frames, and every `on…` handler — is removed first, and a relative address is made absolute so it still works in the doc.

A selection that covers only part of a table brings the table along with it, and the result is a table with a column missing. The words are what was wanted, so a partly selected table is kept as paragraphs. A table that was taken whole stays a table.

## Screenshot behavior

Screenshots are off by default. Attaching one is an explicit checkbox in the review panel. A capture then takes the visible tab only; it never captures full-page/history content. The API accepts PNG/JPEG/WebP up to `MAX_ATTACHMENT_BYTES`, hashes the payload, stores bytes in PostgreSQL for V1, and serves files only after tenant authorization.

The extension keeps up to eight captures waiting for a review and up to fifty waiting to be synced. The two queues are capped separately, so a burst of failed saves never pushes an item that is waiting for a review out of the panel. A failed quick save is marked for retry with its idempotency key, and the background service retries it every five minutes, when the browser starts, and after every successful sign-in renewal. The side panel shows how many items are waiting, with **Retry now** and **Discard**. A review capture is never submitted automatically; it remains in the side panel until the user chooses **Save**. Capture-quality warnings can flag likely login walls, cookie banners, missing titles, or unusually short content before saving.

Deleting a saved item moves it to the recoverable Trash. Restore it from the website's **View Trash** filter on the **Saved** page; business records remain protected from deletion and should be archived instead.

## Production identity

Chrome identity callback URLs include the extension ID. Use a stable store ID or manifest key, then set:

```env
EXTENSION_REDIRECT_URL=https://<extension-id>.chromiumapp.org/data-vault-auth
VITE_API_URL=https://api.example.com
VITE_WEB_URL=https://app.example.com
```

Build Chrome with `bun run build:extension`; build Edge from `apps/extension` with `bun run build:edge`.
