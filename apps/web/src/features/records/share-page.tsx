import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Button, Input, Label, PRIMARY_RECORD_TYPES, recordTypeLabel } from "@data-vault/ui";
import { PageHeader } from "../../components/page";
import { ErrorMessage } from "../../components/feedback";
import { useAuth } from "../../lib/auth";

/**
 * The page a phone opens when something is shared into DataVault.
 *
 * The share target sends the title, the text and the address of whatever was
 * shared. They arrive here and are put into the form, so the person can look
 * at them and add them to their library. The share used to be sent to a page
 * that only redirected, which threw the shared material away.
 */
export function SharePage() {
  const { api, organization } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const shared = useMemo(() => ({
    title: params.get("title") ?? "",
    text: params.get("text") ?? "",
    url: params.get("url") ?? "",
  }), [params]);

  const [title, setTitle] = useState(shared.title);
  const [text, setText] = useState(shared.text);
  const [url, setUrl] = useState(shared.url);
  const [recordType, setRecordType] = useState<string>("article");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      let source: { url: string; title: string; domain: string } | undefined;
      if (url.trim()) {
        const parsed = new URL(url.trim());
        source = { url: parsed.toString(), title: title.trim() || parsed.hostname, domain: parsed.hostname };
      }
      return api.createSavedRecord({
        recordType,
        title: title.trim() || source?.title || text.trim().slice(0, 60) || "Shared item",
        originalText: text.trim() || undefined,
        sourceType: "manual",
        source,
        captureKind: source ? "link" : "selection",
        reviewStatus: "inbox",
        privacyLevel: "private",
        metadata: {},
      });
    },
    onSuccess: (item) => { navigate(`/saved/${item.id}`); },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "The shared item could not be saved."),
  });

  const nothing = !shared.title && !shared.text && !shared.url;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow={organization?.name ?? "Your workspace"}
        title="Save what you shared"
        description={nothing ? "Nothing was shared with DataVault." : "Check it over, then add it to your library."}
      />
      {error ? <div className="mb-4"><ErrorMessage message={error} /></div> : null}
      {nothing ? (
        <div className="panel p-6">
          <p className="text-sm leading-6 text-[#6a6a6a]">Share a page from your phone's share menu and it will appear here, ready to save.</p>
          <Button className="mt-4" onClick={() => navigate("/saved")}>Go to Saved</Button>
        </div>
      ) : (
        <form className="panel space-y-4 p-6" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <div>
            <Label htmlFor="share-title">Title</Label>
            <Input id="share-title" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What is this?" />
          </div>
          <div>
            <Label htmlFor="share-url">Link <span className="font-normal text-[#6a6a6a]">(optional)</span></Label>
            <Input id="share-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/page" />
          </div>
          <div>
            <Label htmlFor="share-text">Text <span className="font-normal text-[#6a6a6a]">(optional)</span></Label>
            <textarea id="share-text" className="min-h-32 w-full rounded-xl border border-[#ded8ca] bg-[#fffdf8] p-3 text-sm" value={text} onChange={(event) => setText(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="share-type">Type</Label>
            <select id="share-type" className="h-11 w-full rounded-xl border border-[#ded8ca] bg-[#fffdf8] px-3 text-sm" value={recordType} onChange={(event) => setRecordType(event.target.value)}>
              {PRIMARY_RECORD_TYPES.map((type) => <option key={type} value={type}>{recordTypeLabel(type)}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save it"}</Button>
            <Button type="button" variant="secondary" onClick={() => navigate("/saved")}>Not now</Button>
          </div>
        </form>
      )}
    </div>
  );
}
