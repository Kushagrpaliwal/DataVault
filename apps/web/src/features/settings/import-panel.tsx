import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, FileUp } from "lucide-react";
import { Button, Input } from "@data-vault/ui";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../components/feedback";
import { AiAccessNotice } from "../../components/ai-panel";

/**
 * Bringing material in, and taking it out.
 *
 * The bookmarks file is the one every browser writes when the bookmarks
 * are exported. A list of addresses is read as well, one to a line, with an
 * optional title in front of it. The file that Pocket, Raindrop and
 * Instapaper write is read as well.
 */
export function ImportPanel() {
  const { api } = useAuth();
  const { notify } = useToast();
  const [kind, setKind] = useState<"bookmarks" | "urls" | "csv">("bookmarks");
  const [content, setContent] = useState("");
  const [name, setName] = useState("");

  const runImport = useMutation({
    mutationFn: () => api.importItems({ kind, content, ...(name.trim() ? { name: name.trim() } : {}) }),
    onSuccess: (result) => {
      notify(`${result.imported} item${result.imported === 1 ? "" : "s"} brought in${result.skipped ? `, ${result.skipped} skipped` : ""}.`);
      setContent("");
      setName("");
    },
    onError: (error) => notify(error instanceof Error ? error.message : "The material could not be brought in.", "error"),
  });

  /**
   * Make the numbers of every item in the workspace again.
   *
   * It is what is needed after the model has changed, or after material has
   * been brought in from somewhere else.
   */
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<unknown>(null);
  const indexEverything = async () => {
    setIndexing(true);
    setIndexError(null);
    try {
      const result = await api.reindexSemantic();
      const waiting = result.remaining > 0 ? ` ${result.remaining} still waiting, so run it again later.` : "";
      notify(`${result.indexed} item${result.indexed === 1 ? "" : "s"} given their numbers.${waiting}`);
    } catch (error) {
      setIndexError(error);
      notify(error instanceof Error ? error.message : "The numbers could not be made.", "error");
    } finally {
      setIndexing(false);
    }
  };

  /**
   * The whole workspace, written to a file.
   *
   * The file is asked for with the workspace in the request, because the
   * export is of one workspace and not of the account.
   */
  const takeEverythingOut = async () => {
    try {
      const file = await api.exportWorkspace();
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = `datavault-export-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The workspace could not be taken out.", "error");
    }
  };

  return (
    <section className="panel p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-soft"><FileUp className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Bring material in</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Paste a bookmarks file, a list of addresses, or the file that Pocket, Raindrop or Instapaper writes, and
            the links are saved in a folder of their own. The folders they came from are kept as collections.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {([
          ["bookmarks", "Bookmarks file"],
          ["urls", "List of addresses"],
          ["csv", "Pocket / Raindrop / Instapaper CSV"],
        ] as const).map(([option, label]) => (
          <button
            key={option}
            type="button"
            onClick={() => setKind(option)}
            className={option === kind ? "rounded-xl bg-deep px-3 py-1.5 text-sm font-medium text-white" : "rounded-xl border border-line px-3 py-1.5 text-sm font-medium hover:bg-soft"}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-sm font-medium" htmlFor="import-content">
        {kind === "bookmarks" ? "The contents of the bookmarks file" : kind === "csv" ? "The contents of the CSV file" : "One address to a line"}
      </label>
      <textarea
        id="import-content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={6}
        placeholder={kind === "bookmarks" ? "<!DOCTYPE NETSCAPE-Bookmark-file-1>…" : kind === "csv" ? "title,url,tags,time_added,status" : "A title | https://example.com"}
        className="mt-1 w-full rounded-xl border border-line p-3 font-mono text-xs outline-none focus:border-deep"
      />

      <label className="mt-3 block text-sm font-medium" htmlFor="import-name">The name of the folder</label>
      <Input
        id="import-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={kind === "bookmarks" ? "Imported bookmarks" : kind === "csv" ? "Imported items" : "Imported links"}
        className="mt-1"
      />

      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={() => runImport.mutate()} disabled={!content.trim() || runImport.isPending}>
          {runImport.isPending ? "Bringing in…" : "Bring in"}
        </Button>
        <Button variant="secondary" onClick={() => void takeEverythingOut()}>
          <Download className="size-4" />Take everything out
        </Button>
      </div>
      {runImport.data ? (
        <p className="mt-3 text-sm text-muted">
          {runImport.data.imported} item{runImport.data.imported === 1 ? "" : "s"} brought in, {runImport.data.skipped}{" "}
          skipped. An item that was already saved, or that was in the file twice, is skipped.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted">
        Taking everything out writes one file with the items, the folders, the collections, the tags, the docs and the
        attachments, so the workspace can be read somewhere else, or brought back if it is lost.
      </p>

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="text-sm font-semibold">Search by meaning</h3>
        <p className="mt-1 text-xs leading-5 text-muted">
          The search by meaning finds the items that say the same thing as the question, even when they use other
          words. It needs the numbers of every item, and they are made when an item is saved.
        </p>
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => {
            void indexEverything();
          }}
          disabled={indexing}
        >
          {indexing ? "Making the numbers…" : "Make the numbers of every item again"}
        </Button>
        {indexError ? (
          <div className="mt-3">
            <AiAccessNotice error={indexError} onAgreed={() => { void indexEverything(); }} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
