import { useEffect, useRef, useState } from "react";
import { defaultCaptureExtractor } from "@data-vault/capture-parser";
import type { AuthSession, AiSummaryResult, ParsedCapture, SavedRecord } from "@data-vault/types";
import {
  Camera, CheckCircle2, ExternalLink, FileText, FolderOpen, Library, ScanText, Search, Settings, UserRound, Wand2,
} from "lucide-react";
import {
  Badge, Button, Input, Label, PRIMARY_RECORD_TYPES, recordTypeLabel,
} from "@data-vault/ui";
import { browser } from "wxt/browser";
import { ExtensionHeader } from "../../components/header";
import { LoggedOut } from "../../components/logged-out";
import { RecordList } from "../../components/record-list";
import { AiConsentPrompt, AiCreditStrip, AiErrorNote, describeAiFailure } from "../../components/ai-strip";
import { DocsView } from "../../components/docs-view";
import { ShortcutHelp } from "../../components/shortcut-help";
import { clearExtensionErrors, readExtensionErrors, type RecordedError } from "../../lib/errors";
import { recordAiConsent, summariseItem, useAiCredits } from "../../lib/ai";
import { signOutExtension } from "../../lib/auth";
import { WEB_URL, withOrganization } from "../../lib/api";
import { currentFolderId, listFolders, rememberFolder, type FolderOption } from "../../lib/folders";
import {
  getAuth, getPreferences, getReviewCapture, getRetryCaptures, clearRetryCaptures, setPendingCapture, setPreferences,
  subscribeStorage, type ExtensionPreferences, type PageCaptureMode, type PendingCapture,
} from "../../lib/storage";

type Tab = "review" | "docs" | "saved" | "settings";
type SavedCapture = { id: string; title: string; sourceDomain?: string | null };

const tabItems = [["review", "Review", ScanText], ["docs", "Docs", FileText], ["saved", "Saved", Library]] as const;

export function SidePanelApp() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [hasPendingCapture, setHasPendingCapture] = useState(false);
  const [tab, setTab] = useState<Tab>("review");
  const [refreshKey, setRefreshKey] = useState(0);

  const loadAuth = async () => {
    const [auth, pending] = await Promise.all([getAuth(), getReviewCapture()]);
    setAuthenticated(Boolean(auth));
    setHasPendingCapture(Boolean(pending));
  };

  useEffect(() => { void loadAuth(); return subscribeStorage(() => void loadAuth()); }, []);

  return (
    <main className="min-h-screen bg-[#fffaf0]">
      <ExtensionHeader />
      <nav className="flex items-center gap-1 border-b border-[#e5dfd1] p-2">
        {tabItems.map(([value, label, Icon]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm font-medium ${tab === value ? "bg-[#ebe6d6] text-black" : "text-[#6a6a6a] hover:bg-[#f5f0e0]"}`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
        <button
          onClick={() => setTab("settings")}
          aria-label="Settings"
          title="Settings"
          className={`grid size-9 shrink-0 place-items-center rounded-xl ${tab === "settings" ? "bg-[#ebe6d6] text-black" : "text-[#6a6a6a] hover:bg-[#f5f0e0]"}`}
        >
          <Settings className="size-4" />
        </button>
      </nav>

      {authenticated === false ? (
        <LoggedOut capturePending={hasPendingCapture} onSignedIn={() => { void loadAuth(); setTab("review"); setRefreshKey((key) => key + 1); }} />
      ) : null}
      {authenticated === null ? <p className="p-8 text-center text-sm text-[#6a6a6a]">Opening DataVault…</p> : null}
      {authenticated === true ? <>
        <AiCreditStrip />
        {tab === "review" ? (
          <ReviewView
            onSaved={(record, sourceTabId) => {
              setRefreshKey((key) => key + 1);
              setTab("saved");
              void browser.runtime.sendMessage({ action: "capture-saved", record, sourceTabId }).catch(() => {});
            }}
          />
        ) : null}
        {tab === "saved" ? <SavedView refreshKey={refreshKey} /> : null}
        {tab === "docs" ? <DocsView /> : null}
        {tab === "settings" ? <SettingsView onSignedOut={() => setAuthenticated(false)} /> : null}
      </> : null}
    </main>
  );
}

function ReviewView({ onSaved }: { onSaved: (record: SavedCapture, sourceTabId?: number) => void }) {
  const [pending, setPending] = useState<PendingCapture>();
  const [parsed, setParsed] = useState<ParsedCapture>({ confidence: {} });
  const [folderId, setFolderId] = useState("");
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<SavedCapture>();
  const [waiting, setWaiting] = useState<PendingCapture[]>([]);
  /**
   * The capture that was last read.
   *
   * The panel re-reads itself whenever anything is stored, and the sign-in is
   * renewed every few minutes. Reading the text again each time would throw
   * away whatever the user had already typed.
   */
  const readKey = useRef<string | null>(null);
  /**
   * The folder the user picked for this item.
   *
   * The panel re-reads itself every few minutes when the sign-in is renewed.
   * The folder that was picked here is kept, so it is not thrown away while
   * the item is being looked at.
   */
  const folderChosen = useRef(false);

  const load = async () => {
    const value = await getReviewCapture();
    setPending(value);
    const key = value?.idempotencyKey ?? null;
    if (value && !value.savedRecord && readKey.current !== key) {
      readKey.current = key;
      /**
       * A new item starts with the folder that is set, so the folder picked
       * for the last item is not carried over to the next one.
       */
      folderChosen.current = false;
      setParsed(await defaultCaptureExtractor.extract({
        text: value.selectedText,
        pageTitle: value.pageTitle,
        pageUrl: value.pageUrl,
        capturedAt: new Date(value.capturedAt),
      }));
    }
    if (!value) readKey.current = null;
    setWaiting(await getRetryCaptures());
    try {
      const listed = await listFolders();
      setFolders(listed);
      /**
       * The folder the settings point at is only used when it belongs to
       * the workspace the panel is in.
       */
      if (!folderChosen.current) setFolderId(await currentFolderId(listed));
    } catch { /* The folder list is optional. */ }
  };

  useEffect(() => { void load(); return subscribeStorage(() => void load()); }, []);

  const retryWaiting = async () => {
    const result = await browser.runtime.sendMessage({ action: "retry-queue" }) as { ok?: boolean; error?: string } | undefined;
    if (!result?.ok) setError(result?.error ?? "Could not save the waiting items.");
    await load();
  };

  const discardWaiting = async () => {
    await clearRetryCaptures();
    setWaiting([]);
  };

  const set = (key: keyof ParsedCapture, value: string) => setParsed((current) => ({ ...current, [key]: value }));

  const chooseScreenshot = async (attachScreenshot: boolean) => {
    if (!pending) return;
    const next = { ...pending, attachScreenshot };
    setPending(next);
    await setPendingCapture(next);
  };

  const discard = async () => { await setPendingCapture(); setPending(undefined); setError(""); };

  const save = async () => {
    if (!pending) return;
    setSaving(true); setError("");
    try {
      let current = pending;
      let record = current.savedRecord;
      if (!record) {
        const cleanTitle = parsed.title?.trim() || current.pageTitle || current.selectedText.slice(0, 60);
        const result = await withOrganization((api) => api.createCapture({
          selectedText: current.selectedText, originalText: current.selectedText,
          source: { url: current.pageUrl, title: cleanTitle, domain: current.domain }, capturedAt: current.capturedAt,
          captureQuality: current.captureQuality,
          parsedData: { ...parsed, title: cleanTitle }, recordType: parsed.recordType ?? "other", confirmDuplicate: true,
          captureKind: current.contentKind === "page-text" ? "page-text" : current.contentKind === "page-info" ? "page" : "selection", tagNames: [], vaultId: folderId || undefined,
        }, current.idempotencyKey));
        const resultRecord = result.record as Record<string, unknown> | undefined;
        if (!resultRecord?.id) throw new Error("DataVault did not return the saved item.");
        record = { id: String(resultRecord.id), title: typeof resultRecord.title === "string" ? resultRecord.title : cleanTitle, sourceDomain: typeof resultRecord.sourceDomain === "string" ? resultRecord.sourceDomain : current.domain };
        current = { ...current, savedRecord: record };
        setPending(current);
        await setPendingCapture(current);
      }
      if (current.attachScreenshot) {
        if (!current.screenshotDataUrl) throw new Error("A screenshot was not available. Turn off the screenshot to save this item without an image.");
        const screenshot = await screenshotFile(current.screenshotDataUrl);
        await withOrganization((api) => api.uploadScreenshot(record.id, screenshot));
      }
      await setPendingCapture();
      setPending(undefined);
      setSaved(record);
      onSaved(record, current.sourceTabId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this item. You can retry safely.");
    } finally { setSaving(false); }
  };

  if (saved) {
    return (
      <div className="p-6 text-center">
        <CheckCircle2 className="mx-auto size-12 text-green-600" />
        <h2 className="mt-4 text-xl font-semibold">Saved</h2>
        <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">
          “{saved.title}” is now in your Saved list. It is also on the DataVault website.
        </p>
        <Button className="mt-5 w-full" variant="secondary" onClick={() => void browser.tabs.create({ url: `${WEB_URL}/saved` })}>
          Open DataVault<ExternalLink className="size-4" />
        </Button>
      </div>
    );
  }

  if (!pending) {
    return (
      <div className="p-4">
        <div className="p-6 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#b8a4ed]"><ScanText className="size-6" /></span>
          <h2 className="mt-5 text-xl font-semibold">Nothing to review</h2>
          <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">
            Select text on any page, right-click it, and choose <strong>Save to DataVault</strong>. It will show up here to check before saving.
          </p>
        </div>
        <WaitingCard items={waiting} onRetry={() => void retryWaiting()} onDiscard={() => void discardWaiting()} />
      </div>
    );
  }

  const currentType = parsed.recordType ?? "other";
  const typeOptions = PRIMARY_RECORD_TYPES.includes(currentType as (typeof PRIMARY_RECORD_TYPES)[number])
    ? PRIMARY_RECORD_TYPES
    : [currentType, ...PRIMARY_RECORD_TYPES];

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.15em] text-[#6a6a6a]">New item</p>
          <h2 className="mt-1 text-xl font-semibold">Review and save</h2>
        </div>
        <Badge tone="teal">Not saved yet</Badge>
      </div>

      <div className="space-y-3">
        <div>
          <Label htmlFor="capture-title">Title</Label>
          <Input id="capture-title" value={parsed.title ?? pending.pageTitle ?? ""} onChange={(event) => set("title", event.target.value)} placeholder="What is this?" />
        </div>

        <div>
          <Label htmlFor="capture-type">Type</Label>
          <select id="capture-type" className="h-11 w-full rounded-xl border border-[#ded8ca] bg-white px-3 text-sm" value={currentType} onChange={(event) => set("recordType", event.target.value)}>
            {typeOptions.map((item) => <option key={item} value={item}>{recordTypeLabel(item)}</option>)}
          </select>
        </div>

        <div>
          <Label htmlFor="capture-folder">Folder</Label>
          <select
            id="capture-folder"
            className="h-11 w-full rounded-xl border border-[#ded8ca] bg-white px-3 text-sm"
            value={folderId}
            onChange={(event) => { folderChosen.current = true; setFolderId(event.target.value); }}
          >
            {folders.length
              ? folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}{typeof folder.itemCount === "number" ? ` (${folder.itemCount})` : ""}
                </option>
              ))
              : <option value="">The default folder</option>}
          </select>
          <p className="mt-1 text-xs leading-5 text-[#6a6a6a]">
            A folder holds your saved items, the same folders the website has. The folder chosen here is used for this item.
          </p>
        </div>

        <details open className="rounded-xl bg-[#f5f0e0] p-3">
          <summary className="cursor-pointer text-xs font-semibold">
            {{ selection: "Selected text", "page-info": "Page information", "page-text": "Page text" }[pending.contentKind ?? "selection"]}
            {pending.pageUrl ? ` · ${pending.domain}` : " · address not available"}
          </summary>
          <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-5">{pending.selectedText}</pre>
        </details>

        {pending.captureQuality?.warnings?.length ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <strong>Worth checking</strong>
            <ul className="mt-1 list-disc pl-4">{pending.captureQuality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            <p className="mt-2">Have a look at the text and screenshot before you save it.</p>
          </div>
        ) : null}

        {pending.queueState === "retry" ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
            <strong>Waiting to sync</strong>
            <p className="mt-1">This was not lost. DataVault will retry it as soon as the connection is back.</p>
            {pending.lastError ? <p className="mt-1 opacity-75">Last error: {pending.lastError}</p> : null}
          </div>
        ) : null}

        <WaitingCard items={waiting} onRetry={() => void retryWaiting()} onDiscard={() => void discardWaiting()} />

        {pending.screenshotDataUrl ? (
          <section className="rounded-xl border border-[#e5dfd1] bg-white p-3">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1" checked={Boolean(pending.attachScreenshot)} onChange={(event) => void chooseScreenshot(event.target.checked)} />
              <span>
                <strong className="flex items-center gap-1"><Camera className="size-4" />Also save a screenshot</strong>
                <span className="mt-1 block text-xs leading-5 text-[#6a6a6a]">Keeps a picture of the page as it looks right now.</span>
              </span>
            </label>
            {pending.attachScreenshot ? (
              <img className="mt-3 max-h-40 w-full rounded-lg border object-cover object-top" src={pending.screenshotDataUrl} alt="Screenshot of the page" />
            ) : null}
          </section>
        ) : (
          <p className="rounded-xl bg-[#f5f0e0] p-3 text-xs leading-5 text-[#6a6a6a]">
            A screenshot is not available on this page. You can still save the text.
          </p>
        )}

        {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => void discard()} disabled={saving}>Discard</Button>
          <Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

async function screenshotFile(dataUrl: string) {
  const response = await fetch(dataUrl);
  return new File([await response.blob()], `capture-${Date.now()}.png`, { type: "image/png" });
}

/**
 * The items that were saved but could not reach DataVault yet.
 *
 * They are shown apart from the review list on purpose: the user already
 * asked for these to be saved, so they do not need to be checked again.
 */
function WaitingCard({ items, onRetry, onDiscard }: { items: PendingCapture[]; onRetry: () => void; onDiscard: () => void }) {
  if (!items.length) return null;
  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      <p className="font-semibold">Waiting to sync ({items.length})</p>
      <p className="mt-1 text-xs leading-5">
        These were saved on your device but could not reach DataVault yet. Nothing has been lost.
      </p>
      <ul className="mt-2 space-y-1 text-xs leading-5 opacity-80">
        {items.slice(0, 3).map((item) => (
          <li key={item.idempotencyKey} className="truncate">· {item.pageTitle}</li>
        ))}
        {items.length > 3 ? <li>· and {items.length - 3} more</li> : null}
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" onClick={onRetry}>Retry now</Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>Discard</Button>
      </div>
    </section>
  );
}

function SavedView({ refreshKey }: { refreshKey: number }) {
  const [records, setRecords] = useState<SavedRecord[]>();
  const [selected, setSelected] = useState<SavedRecord>();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState("");
  /**
   * The folder being looked at.
   *
   * Every item is in one folder, so the list can be narrowed to a single
   * folder. It is the same folder the items were saved into.
   */
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [folderId, setFolderId] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    void listFolders().then(setFolders).catch(() => undefined);
  }, []);

  useEffect(() => {
    setRecords(undefined);
    /**
     * Everything in the workspace, not just what the extension saved.
     *
     * The panel used to hide anything saved on the website, which made the
     * list look empty even when there was plenty to read.
     */
    void withOrganization((api) => api.listSavedRecords({ q: debounced || undefined, limit: 30, vaultId: folderId || undefined }))
      .then((data) => setRecords(data.items))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load your saved items."));
  }, [refreshKey, debounced, folderId]);

  const remove = async (record: SavedRecord) => {
    if (!window.confirm(`Move “${record.title}” to Trash? You can restore it later from the DataVault website.`)) return;
    try {
      await withOrganization((api) => api.deleteSavedRecord(record.id));
      setRecords((current) => current?.filter((item) => item.id !== record.id));
      setSelected(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete this item.");
    }
  };

  if (selected) return <QuickDetail record={selected} onBack={() => setSelected(undefined)} onDeleted={() => void remove(selected)} />;

  return (
    <>
      <div className="space-y-3 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 size-4 text-[#6a6a6a]" />
          <Input className="pl-9" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search your saved items…" />
        </div>
        {folders.length ? (
          <div>
            <label htmlFor="saved-folder" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-[#6a6a6a]">
              <FolderOpen className="size-3.5" />
              Folder
            </label>
            <select
              id="saved-folder"
              className="mt-2 h-11 w-full rounded-xl border border-[#ded8ca] bg-white px-3 text-sm"
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
            >
              <option value="">All folders</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}{typeof folder.itemCount === "number" ? ` (${folder.itemCount})` : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      {error ? <p className="mx-4 mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <RecordList
        records={records}
        loading={!records && !error}
        empty={debounced ? "No saved items matched that search." : "Items you save from the browser extension will appear here."}
        onSelect={setSelected}
        onDelete={(record) => void remove(record)}
      />
      <div className="border-t border-[#e5dfd1] p-4">
        <Button className="w-full" variant="secondary" onClick={() => void browser.tabs.create({ url: `${WEB_URL}/saved` })}>
          Open the full library<ExternalLink className="size-4" />
        </Button>
      </div>
    </>
  );
}

function QuickDetail({ record, onBack, onDeleted }: { record: SavedRecord; onBack: () => void; onDeleted?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [summary, setSummary] = useState<AiSummaryResult | null>(null);
  const [summarising, setSummarising] = useState(false);
  const [aiError, setAiError] = useState<{ message: string; needsWebsite: boolean } | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const { status, refresh } = useAiCredits();

  const copy = () => {
    if (record.originalText) {
      void navigator.clipboard.writeText(record.originalText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    }
  };

  const summarise = async () => {
    setSummarising(true);
    setAiError(null);
    try {
      setSummary(await summariseItem(record.id));
      void refresh();
    } catch (caught) {
      const failure = describeAiFailure(caught);
      if (failure.reason === "consent") setNeedsConsent(true);
      else setAiError({ message: failure.message, needsWebsite: failure.needsWebsite });
    } finally {
      setSummarising(false);
    }
  };

  const agree = async () => {
    setNeedsConsent(false);
    await recordAiConsent();
    await summarise();
  };

  const aiReady = status?.available && status.emailVerified && status.consented && status.remaining > 0;

  return (
    <div className="p-4">
      <button className="mb-4 text-sm underline" onClick={onBack}>Back to saved items</button>
      <div className="rounded-3xl bg-[#b8a4ed] p-5">
        <Badge>{recordTypeLabel(record.recordType)}</Badge>
        <h2 className="mt-4 text-xl font-semibold">{record.title}</h2>
        <p className="mt-3 text-sm">{record.sourceDomain ?? "Saved in DataVault"}</p>
      </div>

      {needsConsent ? (
        <AiConsentPrompt onAgreed={() => void agree()} onDeclined={() => setNeedsConsent(false)} />
      ) : null}

      {aiError ? <div className="mt-4"><AiErrorNote message={aiError.message} onOpenWebsite={aiError.needsWebsite} /></div> : null}

      {summary ? (
        <div className="mt-4 rounded-2xl bg-[#f5f0e0] p-4">
          <p className="text-xs font-semibold uppercase tracking-[.12em] text-[#6a6a6a]">Summary</p>
          <p className="mt-2 text-sm leading-6">{summary.summary}</p>
          {summary.keyPoints.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[#4a4a4a]">
              {summary.keyPoints.map((point) => <li key={point}>{point}</li>)}
            </ul>
          ) : null}
        </div>
      ) : (
        <Button
          className="mt-4 w-full"
          variant="secondary"
          disabled={!aiReady || summarising}
          onClick={() => void summarise()}
          title={aiReady ? undefined : status?.reason ?? "AI features are not available yet."}
        >
          <Wand2 className="size-4" />
          {summarising ? "Working it out…" : "Summarise this"}
        </Button>
      )}

      {record.originalText ? (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6a6a6a]">Saved text</span>
            <button onClick={copy} className="text-xs text-[#4a4a4a] underline">{copied ? "Copied!" : "Copy text"}</button>
          </div>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-[#f5f0e0] p-4 font-mono text-xs leading-5">{record.originalText}</pre>
        </div>
      ) : null}
      <Button className="mt-4 w-full" variant="secondary" onClick={() => void browser.tabs.create({ url: `${WEB_URL}/saved/${record.id}` })}>
        Open in DataVault<ExternalLink className="size-4" />
      </Button>
      {onDeleted ? <Button className="mt-2 w-full text-red-700" variant="ghost" onClick={onDeleted}>Move to Trash</Button> : null}
    </div>
  );
}

function SettingsView({ onSignedOut }: { onSignedOut: () => void }) {
  const [session, setSession] = useState<AuthSession>();
  const [workspaceId, setWorkspaceId] = useState<string | undefined>();
  const [vaultOptions, setVaultOptions] = useState<FolderOption[]>([]);
  const [preferences, setPreferenceState] = useState<ExtensionPreferences>({ quickSaveSelectedText: false, pageCaptureMode: "visible" });
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [errors, setErrors] = useState<RecordedError[]>([]);
  const credits = useAiCredits();

  /**
   * The problems the extension has run into.
   *
   * Chrome keeps its own list on the extensions page, which is hidden away.
   * Showing them here means the person can see what went wrong without
   * leaving the browser.
   */
  const loadErrors = async () => {
    setErrors(await readExtensionErrors());
  };

  useEffect(() => {
    void loadErrors();
  }, []);

  /**
   * The preferences are read on their own.
   *
   * They used to be read together with the account details, so a failure in
   * one of those calls left the panel showing the defaults. Saving the panel
   * then wrote those defaults over the real preferences.
   */
  const loadPreferences = async () => {
    const saved = await getPreferences();
    setPreferenceState(saved);
    setPreferencesLoaded(true);
  };

  useEffect(() => {
    void loadPreferences();
    return subscribeStorage(() => void loadPreferences());
  }, []);

  useEffect(() => {
    void Promise.all([withOrganization((api) => api.getMe()), listFolders()])
      .then(([me, loadedVaults]) => { setSession(me); setVaultOptions(loadedVaults); })
      .catch(() => { /* The account card stays blank until the API responds. */ });
    void getAuth().then((auth) => setWorkspaceId(auth?.organizationId));
  }, []);

  /**
   * The folders belong to one workspace, so they are read again whenever the
   * sign-in changes.
   */
  useEffect(() => {
    void listFolders().then(setVaultOptions).catch(() => undefined);
  }, [workspaceId]);

  const updatePreferences = (updates: Partial<ExtensionPreferences>) => {
    const next = { ...preferences, ...updates };
    setPreferenceState(next);
    void setPreferences(next);
  };

  /**
   * Choose the folder new items go into.
   *
   * The folder belongs to the workspace the extension is in, so that is
   * recorded with it. A folder from another workspace would be refused by
   * the server.
   */
  const changeFolder = (vaultId: string) => {
    void rememberFolder(vaultId || undefined);
  };

  /**
   * The folder new items go into, as it is on screen.
   *
   * The folder that was chosen is used when it still belongs to the workspace
   * the extension is in. Otherwise the default folder of the workspace is
   * used, which is where the server puts anything that has not been given a
   * folder.
   */
  const folderValue = preferences.defaultVaultId
    && preferences.defaultVaultOrganizationId === workspaceId
    && vaultOptions.some((folder) => folder.id === preferences.defaultVaultId)
    ? preferences.defaultVaultId
    : (vaultOptions.find((folder) => folder.isDefault)?.id ?? vaultOptions[0]?.id ?? "");

  const captureModes: ReadonlyArray<[PageCaptureMode, string, string]> = [
    ["visible", "Page image and details", "Saves a picture of the page plus its title and link."],
    ["full-text", "Full page text and image", "Reads the whole page and saves a picture of it too."],
    ["selection-only", "Selected text only", "Only saves text you highlight. No picture is taken."],
  ];

  return (
    <div className="p-4">
      <div className="rounded-3xl bg-[#1a3a3a] p-5 text-white">
        <div className="grid size-12 place-items-center rounded-2xl bg-[#ff4d8b] text-lg font-semibold">{session?.user.name?.[0] ?? "D"}</div>
        <h2 className="mt-4 text-lg font-semibold">{session?.user.name}</h2>
        <p className="text-sm text-white/70">{session?.user.email}</p>
        {session?.organizations.length ? <p className="mt-4 text-xs font-semibold uppercase tracking-[.13em] text-[#a4d4c5]">{session.organizations.find((item) => item.id === workspaceId)?.name ?? "Your workspace"}</p> : null}
        {session && !session.user.emailVerified ? (
          <div className="mt-4 rounded-xl bg-white/10 p-3">
            <p className="text-xs font-semibold">Email address not confirmed</p>
            <p className="mt-1 text-xs leading-5 text-white/70">Confirm it on the website to unlock AI credits. Everything else works either way.</p>
            <button
              type="button"
              className="mt-2 text-xs font-semibold underline"
              onClick={() => void browser.tabs.create({ url: `${WEB_URL}/settings` })}
            >
              Confirm now
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-2xl border bg-white p-4 text-sm">
        <h3 className="font-semibold">Free AI credits</h3>
        {credits.status?.available ? (
          <>
            <p className="mt-2 text-xs leading-5 text-[#6a6a6a]">
              {credits.status.emailVerified && credits.status.consented
                ? `${credits.status.remaining} of ${credits.status.allowance} left today. They come back when the day rolls over.`
                : credits.status.reason}
            </p>
            {credits.status.reason && (!credits.status.emailVerified || !credits.status.consented) ? (
              <button
                type="button"
                className="mt-2 text-xs font-semibold underline"
                onClick={() => void browser.tabs.create({ url: `${WEB_URL}/settings` })}
              >
                Open DataVault
              </button>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-xs leading-5 text-[#6a6a6a]">AI features are not switched on for this server yet.</p>
        )}
      </div>

      {errors.length ? (
        <section className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">Something went wrong</h3>
            <button onClick={() => { void clearExtensionErrors().then(() => setErrors([])); }} className="text-xs underline">Clear</button>
          </div>
          <ul className="mt-2 space-y-2">
            {errors.map((error, index) => (
              <li key={`${error.at}-${index}`}>
                <p className="text-xs font-semibold">{error.scope}</p>
                <p className="text-xs leading-5">{error.message}</p>
                <p className="text-[11px] opacity-70">{new Date(error.at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-4 rounded-2xl border bg-white p-4 text-sm">
        <h3 className="font-semibold">Docs</h3>
        <p className="mt-2 text-xs leading-5 text-[#6a6a6a]">
          The shortcut adds the selected text to this doc. Start a new one whenever you want to change where things go.
        </p>
        <p className="mt-2 rounded-xl bg-[#f5f0e0] p-3 text-sm font-medium">
          {preferences.currentDocTitle ?? "No doc yet"}
        </p>
        <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => void browser.runtime.sendMessage({ action: "start-new-doc" })}>
          Start a new doc
        </Button>
        <ShortcutHelp />
      </div>

      <div className="mt-4 rounded-2xl border bg-white p-4 text-sm">
        <h3 className="font-semibold">Where things go</h3>
        <p className="mt-1 text-xs leading-5 text-[#6a6a6a]">
          Everything the extension saves goes into this workspace. Change it here whenever you like.
        </p>
        {session?.organizations.length ? (
          <div className="mt-3">
            <p className="block font-medium">Workspace</p>
            <p className="mt-1 rounded-xl border border-[#ded8ca] bg-[#fffdf8] px-3 py-2.5 text-sm">
              {session.organizations.find((item) => item.id === workspaceId)?.name ?? "The signed-in workspace"}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#6a6a6a]">
              The extension saves into the workspace it was signed in for. To work in another one, sign in again from the DataVault website.
            </p>
          </div>
        ) : null}
        <label className="mt-3 block">
          <span className="block font-medium">Save new items to</span>
          <select
            className="mt-2 h-11 w-full rounded-xl border border-[#ded8ca] bg-[#fffdf8] px-3 text-sm"
            value={folderValue}
            onChange={(event) => changeFolder(event.target.value)}
          >
            {vaultOptions.length
              ? vaultOptions.map((vault) => (
                <option key={vault.id} value={vault.id}>
                  {vault.name}{typeof vault.itemCount === "number" ? ` (${vault.itemCount})` : ""}
                </option>
              ))
              : <option value="">The default folder</option>}
          </select>
          <span className="mt-1 block text-xs leading-5 text-[#6a6a6a]">
            The folder new items go into. It is the same folder you have on the website, and you can change it here at any time.
          </span>
        </label>

        <label className="mt-4 flex cursor-pointer items-start justify-between gap-3">
          <span>
            <span className="block font-medium">Save without reviewing</span>
            <span className="mt-1 block text-xs leading-5 text-[#6a6a6a]">Save highlighted text straight away instead of opening the review panel.</span>
          </span>
          <input type="checkbox" className="mt-1" checked={preferences.quickSaveSelectedText} disabled={!preferencesLoaded} onChange={(event) => updatePreferences({ quickSaveSelectedText: event.target.checked })} />
        </label>

        <fieldset className="mt-4 border-t border-[#eee8da] pt-3">
          <legend className="font-semibold">What “Save this page” keeps</legend>
          <p className="mt-1 text-xs leading-5 text-[#6a6a6a]">Choose what the popup captures when you save a whole page.</p>
          {captureModes.map(([value, label, description]) => (
            <label key={value} className="mt-3 flex cursor-pointer items-start gap-3">
              <input type="radio" name="page-capture-mode" className="mt-1" checked={preferences.pageCaptureMode === value} disabled={!preferencesLoaded} onChange={() => updatePreferences({ pageCaptureMode: value })} />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-[#6a6a6a]">{description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <Button className="mt-4 w-full" variant="secondary" onClick={() => void browser.tabs.create({ url: WEB_URL })}>
        Open DataVault<ExternalLink className="size-4" />
      </Button>
      <Button className="mt-2 w-full" variant="ghost" onClick={async () => { await signOutExtension(); onSignedOut(); }}>
        <UserRound className="size-4" />
        Sign out
      </Button>
    </div>
  );
}
