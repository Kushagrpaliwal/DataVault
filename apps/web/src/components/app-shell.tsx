import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown, Download, FileText, LayoutDashboard, Menu, Puzzle, Search, Settings, X,
} from "lucide-react";
import { Button, cn, EmptyState, RecordTypeIcon } from "@data-vault/ui";
import { useAuth } from "../lib/auth";
import { useVaultSync } from "../lib/use-vault-sync";
import { Modal } from "./feedback";
import { ThemePicker } from "./theme-picker";
import { AiAccessNotice } from "./ai-panel";

const navigation = [
  ["Overview", "/", LayoutDashboard],
  ["Saved", "/saved", Download],
  ["Docs", "/docs", FileText],
  ["Settings", "/settings", Settings],
] as const;

export function AppShell() {
  const { session, organization, selectOrganization } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [extensionOpen, setExtensionOpen] = useState(false);

  // Mount real-time live sync from the browser extension
  useVaultSync();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-black focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <aside className={cn("fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-hover transition-transform lg:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-16 items-center justify-between px-5">
          <NavLink to="/" className="flex items-center gap-2 text-lg font-semibold" onClick={() => setMobileOpen(false)}>
            <span className="grid size-8 place-items-center rounded-xl bg-ink text-canvas font-bold">D</span>
            DataVault
          </NavLink>
          <button className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <X className="size-5" />
          </button>
        </div>
        <div className="px-3">
          <label className="sr-only" htmlFor="workspace">Workspace</label>
          <div className="relative">
            <select
              id="workspace"
              value={organization?.id ?? ""}
              onChange={(event) => selectOrganization(event.target.value)}
              className="h-11 w-full appearance-none rounded-xl border border-line bg-canvas px-3 pr-8 text-sm font-medium"
            >
              <>{session?.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3.5 size-4" />
          </div>
        </div>
        <nav className="mt-4 flex-1 overflow-y-auto px-3" aria-label="Primary">
          {navigation.map(([label, to, Icon]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn("mb-1 flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-strong", isActive ? "bg-soft font-semibold text-ink" : "hover:bg-soft")
              }
            >
              <Icon className="size-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <a
            href="/extension-install"
            onClick={(event) => {
              event.preventDefault();
              setExtensionOpen(true);
            }}
            className="flex items-start gap-2 rounded-xl bg-soft p-3 text-left text-xs leading-5 text-strong hover:bg-line"
          >
            <Puzzle className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="block font-semibold text-ink">Save from any page</span>
              <span className="block">Install the browser extension</span>
            </span>
          </a>
        </div>
      </aside>
      {mobileOpen ? <button aria-label="Close navigation overlay" className="fixed inset-0 z-40 bg-black/25 lg:hidden" onClick={() => setMobileOpen(false)} /> : null}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-canvas/95 px-4 backdrop-blur md:px-7">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <button onClick={() => setSearchOpen(true)} className="flex h-10 max-w-xl flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-left text-sm text-muted">
            <Search className="size-4" />
            Search your saved items…
            <kbd className="ml-auto hidden rounded-md border bg-soft px-2 py-0.5 text-[11px] sm:block">⌘ K</kbd>
          </button>
          <div className="hidden size-9 place-items-center rounded-full bg-[#b8a4ed] text-sm font-semibold text-deep sm:grid">
            {session?.user.name.split(" ").map((word) => word[0]).join("").slice(0, 2)}
          </div>
          <ThemePicker />
        </header>
        <main id="main" className="mx-auto max-w-[1500px] p-4 md:p-7 lg:p-8">
          <Outlet />
        </main>
      </div>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ExtensionInstall open={extensionOpen} onClose={() => setExtensionOpen(false)} />
    </div>
  );
}

/**
 * The web app depends entirely on the browser extension, but the extension is
 * invisible until it is installed. This explains the one flow that matters and
 * gives the user a working alternative if they would rather not install it.
 */
function ExtensionInstall({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const done = await copyExtensionInstructions();
    setCopied(done);
    if (done) setTimeout(() => setCopied(false), 2_500);
  };

  return (
    <Modal open={open} onClose={onClose} title="Save anything from the web" width="max-w-xl">
      <ol className="space-y-3">
        {[
          ["Install the extension", "Open your browser’s extension page and load DataVault."],
          ["Select any text", "Highlight a paragraph, price, or link on any page."],
          ["Right-click and save", "Choose “Save to DataVault”. It appears in your Saved list right away."],
        ].map(([title, description], index) => (
          <li key={title} className="flex gap-3 rounded-xl bg-soft p-4">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-canvas">
              {index + 1}
            </span>
            <span>
              <span className="block font-semibold">{title}</span>
              <span className="mt-0.5 block text-sm leading-6 text-muted">{description}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => void copy()}>{copied ? "Copied!" : "Copy the steps"}</Button>
        <Button variant="secondary" onClick={onClose}>I’ll do this later</Button>
      </div>
      <p className="mt-5 border-t border-line pt-4 text-sm leading-6 text-muted">
        Browsers do not let a website open their extension page, so the steps
        are copied to your clipboard instead. Paste them into your notes, or
        just follow them as they are.
      </p>
    </Modal>
  );
}

/**
 * The steps to install the extension.
 *
 * A website cannot open the browser's own extension page, so the steps are
 * put on the clipboard where they can be pasted into another window.
 */
async function copyExtensionInstructions() {
  const steps = [
    "Install the DataVault extension",
    "1. Open the extensions page in your browser (type 'extensions' in the address bar, or 'add-ons' in Firefox).",
    "2. Turn on Developer mode.",
    "3. Choose 'Load unpacked' and pick the extension folder.",
    "4. Select text on any page, right-click it, and choose 'Save to DataVault'.",
  ].join("\n");
  try {
    await navigator.clipboard.writeText(steps);
    return true;
  } catch {
    return false;
  }
}

/**
 * The words of a query, one at a time.
 *
 * A phrase in quotes is looked for as a phrase, and a word with a minus in
 * front of it is left out, so both are taken out of the query before the
 * words are marked.
 */
function queryTerms(query: string): string[] {
  return query
    .replace(/"[^"]*"/g, (phrase) => phrase.slice(1, -1))
    .split(/\s+/)
    .map((word) => word.replace(/^[-+]/, "").trim())
    .filter((word) => word.length > 1);
}

/**
 * A piece of text with the words of the query marked in it.
 *
 * The text is put in the page as text, so nothing that was saved can become
 * part of the page itself.
 */
function Highlighted({ text, terms }: { text: string; terms: string }) {
  const words = queryTerms(terms);
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) => (index % 2 === 1
        ? <mark key={`${part}-${index}`} className="rounded bg-[#ffe9a8] px-0.5 text-inherit">{part}</mark>
        : <span key={`${part}-${index}`}>{part}</span>))}
    </>
  );
}

function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [byMeaning, setByMeaning] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [term]);

  const query = useQuery({ queryKey: ["global-search", debounced], queryFn: () => api.search(debounced, 1, 20), enabled: open && debounced.length > 1 && !byMeaning });
  const meaning = useQuery({ queryKey: ["semantic-search", debounced], queryFn: () => api.semanticSearch(debounced, 20), enabled: open && debounced.length > 1 && byMeaning, retry: false });
  const notes = useQuery({ queryKey: ["notes", "search", debounced], queryFn: () => api.listNotes({ q: debounced, limit: 10 }), enabled: open && debounced.length > 1 });
  const quickActions = [
    ["Open your saved items", "/saved"],
    ["Open your docs", "/docs"],
    ["Organize with folders and tags", "/saved"],
  ] as const;

  const items = byMeaning
    ? (meaning.data?.items ?? []).map((item) => ({ id: item.id, title: item.title, resourceType: item.resourceType, sourceDomain: item.sourceDomain, snippet: item.snippet }))
    : (query.data?.items ?? []).map((item) => ({ id: item.id, title: item.title, resourceType: item.resourceType, sourceDomain: item.sourceDomain, snippet: item.snippet }));
  const hasRecords = Boolean(items.length);
  const hasNotes = Boolean(notes.data?.length);

  return (
    <Modal open={open} onClose={onClose} title="Search DataVault" width="max-w-2xl">
      <div className="relative">
        <Search className="absolute left-3 top-3.5 size-4 text-muted" />
        <input
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search a title, some text, or a website…"
          className="h-12 w-full rounded-xl border border-line bg-surface pl-10 pr-3 outline-none"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setByMeaning(false)}
          className={byMeaning ? "rounded-xl border border-line px-3 py-1.5 text-xs font-medium" : "rounded-xl bg-ink px-3 py-1.5 text-xs font-medium text-canvas"}
        >
          The words
        </button>
        <button
          type="button"
          onClick={() => setByMeaning(true)}
          className={byMeaning ? "rounded-xl bg-ink px-3 py-1.5 text-xs font-medium text-canvas" : "rounded-xl border border-line px-3 py-1.5 text-xs font-medium"}
        >
          The meaning
        </button>
        <span className="text-xs text-muted">
          {byMeaning ? "Finds the items that say the same thing, even when they use other words." : "Finds the items that use the words."}
        </span>
      </div>
      {!debounced ? (
        <div className="mt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[.14em] text-muted">Quick actions</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {quickActions.map(([label, to]) => (
              <button
                key={to}
                className="flex items-center gap-2 rounded-xl bg-soft p-3 text-left text-sm font-medium"
                onClick={() => {
                  onClose();
                  navigate(to);
                }}
              >
                <Download className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 max-h-80 space-y-4 overflow-y-auto">
          {hasNotes ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[.14em] text-muted">Docs</p>
              <div className="divide-y divide-line">
                {notes.data?.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => {
                      onClose();
                      navigate(`/docs/${note.id}`);
                    }}
                    className="flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-hover"
                  >
                    <span className="grid size-9 place-items-center rounded-xl bg-soft text-lg">{note.icon ?? "📄"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{note.title}</span>
                      <span className="block truncate text-xs text-muted">{note.excerpt || "Empty doc"}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {hasRecords ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[.14em] text-muted">Saved items</p>
              <div className="divide-y divide-line">
                {items.map((result) => (
                  <button
                    key={String(result.id)}
                    onClick={() => {
                      onClose();
                      navigate(`/saved/${String(result.id)}`);
                    }}
                    className="flex w-full items-start gap-3 px-2 py-3 text-left hover:bg-hover"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-soft">
                      <RecordTypeIcon type={result.resourceType} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{String(result.title)}</span>
                      {result.snippet ? (
                        <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-muted">
                          {byMeaning ? result.snippet : <Highlighted text={result.snippet} terms={debounced} />}
                        </span>
                      ) : (
                        <span className="block truncate text-xs text-muted">{result.sourceDomain ?? result.resourceType}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {byMeaning && meaning.error ? (
            <AiAccessNotice error={meaning.error} />
          ) : null}
          {!hasNotes && !hasRecords && !query.isLoading && !meaning.isLoading && !meaning.error ? (
            <EmptyState title="No matches" description="Try a different word, or check the spelling. Search looks through titles, saved text, website names and your docs." />
          ) : null}
        </div>
      )}
    </Modal>
  );
}
