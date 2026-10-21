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
import { AiCreditBadge } from "./ai-panel";

const navigation = [
  ["Overview", "/", LayoutDashboard],
  ["Saved", "/saved", Download],
  ["Docs", "/docs", FileText],
  ["Organize", "/organize", Puzzle],
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
    <div className="min-h-screen bg-[#fffaf0] text-[#0a0a0a]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-black focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <aside className={cn("fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-[#e5dfd1] bg-[#faf5e8] transition-transform lg:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-16 items-center justify-between px-5">
          <NavLink to="/" className="flex items-center gap-2 text-lg font-semibold" onClick={() => setMobileOpen(false)}>
            <span className="grid size-8 place-items-center rounded-xl bg-[#0a0a0a] text-white font-bold">D</span>
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
              className="h-11 w-full appearance-none rounded-xl border border-[#dfd8c8] bg-[#fffaf0] px-3 pr-8 text-sm font-medium"
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
                cn("mb-1 flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-[#4a4a4a]", isActive ? "bg-[#ebe6d6] font-semibold text-black" : "hover:bg-[#f5f0e0]")
              }
            >
              <Icon className="size-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-[#e5dfd1] p-3">
          <a
            href="/extension-install"
            onClick={(event) => {
              event.preventDefault();
              setExtensionOpen(true);
            }}
            className="flex items-start gap-2 rounded-xl bg-[#ebe6d6] p-3 text-left text-xs leading-5 text-[#3a3a3a] hover:bg-[#e5dfd1]"
          >
            <Puzzle className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="block font-semibold text-black">Save from any page</span>
              <span className="block">Install the browser extension</span>
            </span>
          </a>
        </div>
      </aside>
      {mobileOpen ? <button aria-label="Close navigation overlay" className="fixed inset-0 z-40 bg-black/25 lg:hidden" onClick={() => setMobileOpen(false)} /> : null}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[#e5dfd1] bg-[#fffaf0]/95 px-4 backdrop-blur md:px-7">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <button onClick={() => setSearchOpen(true)} className="flex h-10 max-w-xl flex-1 items-center gap-2 rounded-xl border border-[#dfd8c8] bg-[#fffdf8] px-3 text-left text-sm text-[#7a7a7a]">
            <Search className="size-4" />
            Search your saved items…
            <kbd className="ml-auto hidden rounded-md border bg-[#f5f0e0] px-2 py-0.5 text-[11px] sm:block">⌘ K</kbd>
          </button>
          <div className="hidden size-9 place-items-center rounded-full bg-[#b8a4ed] text-sm font-semibold sm:grid">
            {session?.user.name.split(" ").map((word) => word[0]).join("").slice(0, 2)}
          </div>
          <AiCreditBadge />
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
          <li key={title} className="flex gap-3 rounded-xl bg-[#f5f0e0] p-4">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#0a0a0a] text-xs font-semibold text-white">
              {index + 1}
            </span>
            <span>
              <span className="block font-semibold">{title}</span>
              <span className="mt-0.5 block text-sm leading-6 text-[#6a6a6a]">{description}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => void copy()}>{copied ? "Copied!" : "Copy the steps"}</Button>
        <Button variant="secondary" onClick={onClose}>I’ll do this later</Button>
      </div>
      <p className="mt-5 border-t border-[#eee8da] pt-4 text-sm leading-6 text-[#6a6a6a]">
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

function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [term]);

  const query = useQuery({ queryKey: ["global-search", debounced], queryFn: () => api.listSavedRecords({ q: debounced, limit: 20 }), enabled: open && debounced.length > 1 });
  const notes = useQuery({ queryKey: ["notes", "search", debounced], queryFn: () => api.listNotes({ q: debounced, limit: 10 }), enabled: open && debounced.length > 1 });
  const quickActions = [
    ["Open your saved items", "/saved"],
    ["Open your docs", "/docs"],
    ["Organize with folders and tags", "/organize"],
  ] as const;

  const hasRecords = Boolean(query.data?.items.length);
  const hasNotes = Boolean(notes.data?.length);

  return (
    <Modal open={open} onClose={onClose} title="Search DataVault" width="max-w-2xl">
      <div className="relative">
        <Search className="absolute left-3 top-3.5 size-4 text-[#6a6a6a]" />
        <input
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search a title, some text, or a website…"
          className="h-12 w-full rounded-xl border border-[#d9d2c4] bg-white pl-10 pr-3 outline-none"
        />
      </div>
      {!debounced ? (
        <div className="mt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[.14em] text-[#6a6a6a]">Quick actions</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {quickActions.map(([label, to]) => (
              <button
                key={to}
                className="flex items-center gap-2 rounded-xl bg-[#f5f0e0] p-3 text-left text-sm font-medium"
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
              <p className="mb-2 text-xs font-semibold uppercase tracking-[.14em] text-[#6a6a6a]">Docs</p>
              <div className="divide-y divide-[#eee8da]">
                {notes.data?.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => {
                      onClose();
                      navigate(`/docs/${note.id}`);
                    }}
                    className="flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-[#faf5e8]"
                  >
                    <span className="grid size-9 place-items-center rounded-xl bg-[#f5f0e0] text-lg">{note.icon ?? "📄"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{note.title}</span>
                      <span className="block truncate text-xs text-[#6a6a6a]">{note.excerpt || "Empty doc"}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {hasRecords ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[.14em] text-[#6a6a6a]">Saved items</p>
              <div className="divide-y divide-[#eee8da]">
                {query.data?.items.map((result) => (
                  <button
                    key={String(result.id)}
                    onClick={() => {
                      onClose();
                      navigate(`/saved/${String(result.id)}`);
                    }}
                    className="flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-[#faf5e8]"
                  >
                    <span className="grid size-9 place-items-center rounded-xl bg-[#f5f0e0]">
                      <RecordTypeIcon type={result.recordType} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{String(result.title)}</span>
                      <span className="block truncate text-xs text-[#6a6a6a]">{result.sourceDomain ?? result.recordType}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {!hasNotes && !hasRecords && !query.isLoading ? (
            <EmptyState title="No matches" description="Try a different word, or check the spelling. Search looks through titles, saved text, website names and your docs." />
          ) : null}
        </div>
      )}
    </Modal>
  );
}
