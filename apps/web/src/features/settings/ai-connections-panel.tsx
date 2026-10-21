import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, LoaderCircle, Plug, Trash2 } from "lucide-react";
import { Button, Input, Label } from "@data-vault/ui";
import { AI_PROVIDER_PRESETS, type AiProviderPreset } from "@data-vault/schemas";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../components/feedback";

/**
 * The model providers the person connects themselves.
 *
 * The key is write-only: it goes in and it is never sent back. The list
 * shows the last four of it, which is enough to tell two keys apart.
 */
export function AiConnectionsPanel() {
  const { api } = useAuth();
  const { notify } = useToast();
  const client = useQueryClient();
  const connections = useQuery({ queryKey: ["ai-connections"], queryFn: () => api.listAiConnections() });

  const [preset, setPreset] = useState<AiProviderPreset>("openai");
  const [baseUrl, setBaseUrl] = useState(AI_PROVIDER_PRESETS[0]!.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(AI_PROVIDER_PRESETS[0]!.model);
  const [label, setLabel] = useState("");
  const [models, setModels] = useState<string[]>([]);

  const details = AI_PROVIDER_PRESETS.find((entry) => entry.preset === preset) ?? AI_PROVIDER_PRESETS[0]!;

  /**
   * Choose a provider.
   *
   * The address and the model are filled in, and they stay editable, so
   * that a provider that is not on the list still works.
   */
  const choosePreset = (next: AiProviderPreset) => {
    const entry = AI_PROVIDER_PRESETS.find((item) => item.preset === next) ?? AI_PROVIDER_PRESETS[0]!;
    setPreset(next);
    setBaseUrl(entry.baseUrl);
    setModel(entry.model);
    setModels([]);
  };

  const test = useMutation({
    mutationFn: () => api.testAiConnection({
      kind: details.kind,
      preset,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    }),
    onSuccess: (result) => {
      setModels(result.models);
      if (!model.trim() && result.models.length) setModel(result.models[0]!);
      notify(result.models.length ? `${result.models.length} models found.` : "The provider answered, but it has no models to show.");
    },
    onError: (error) => notify(error instanceof Error ? error.message : "That provider could not be reached.", "error"),
  });

  const save = useMutation({
    mutationFn: () => api.createAiConnection({
      label: label.trim() || details.label,
      kind: details.kind,
      preset,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      isDefault: (connections.data?.length ?? 0) === 0,
    }),
    onSuccess: async (created) => {
      setApiKey("");
      setLabel("");
      setModels([]);
      notify(`${created.label} is connected.`);
      await client.invalidateQueries({ queryKey: ["ai-connections"] });
      await client.invalidateQueries({ queryKey: ["ai-credits"] });
    },
    onError: (error) => notify(error instanceof Error ? error.message : "The connection could not be saved.", "error"),
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) => api.patchAiConnection(id, { isDefault: true }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["ai-connections"] });
      await client.invalidateQueries({ queryKey: ["ai-credits"] });
    },
    onError: (error) => notify(error instanceof Error ? error.message : "That could not be changed.", "error"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAiConnection(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["ai-connections"] });
      await client.invalidateQueries({ queryKey: ["ai-credits"] });
    },
    onError: (error) => notify(error instanceof Error ? error.message : "That could not be removed.", "error"),
  });

  return (
    <section className="panel p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-soft"><KeyRound className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Your AI</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Bring a model of your own and use it instead of the free credits. Any provider that speaks the OpenAI
            language works, and so do Anthropic and Google.
          </p>
        </div>
      </div>

      {connections.data?.length ? (
        <ul className="mt-4 space-y-2">
          {connections.data.map((connection) => (
            <li key={connection.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-soft p-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{connection.label}</span>
                <span className="block text-xs text-muted">
                  {connection.preset} · {connection.model}{connection.keyHint ? ` · …${connection.keyHint}` : ""}
                </span>
              </span>
              {connection.isDefault ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-deep px-2.5 py-1 text-xs font-medium text-white">
                  <Check className="size-3" />In use
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate(connection.id)} disabled={makeDefault.isPending}>
                  Use this one
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-red-700 dark:text-red-300"
                onClick={() => { if (window.confirm(`Remove “${connection.label}”? The key goes with it.`)) remove.mutate(connection.id); }}
                disabled={remove.isPending}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="text-sm font-semibold">Connect a provider</h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="ai-preset">Provider</Label>
            <select
              id="ai-preset"
              value={preset}
              onChange={(event) => choosePreset(event.target.value as AiProviderPreset)}
              className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm"
            >
              {AI_PROVIDER_PRESETS.map((entry) => <option key={entry.preset} value={entry.preset}>{entry.label}</option>)}
            </select>
            <p className="mt-1 text-xs leading-5 text-muted">{details.note}</p>
          </div>
          <div>
            <Label htmlFor="ai-label">Name</Label>
            <Input id="ai-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={details.label} />
          </div>
        </div>

        <div className="mt-3">
          <Label htmlFor="ai-base-url">Address</Label>
          <Input id="ai-base-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://…" />
          <p className="mt-1 text-xs leading-5 text-muted">
            The address of the provider. Change it when the provider is on your own network.
          </p>
        </div>

        <div className="mt-3">
          <Label htmlFor="ai-key">Key</Label>
          <Input
            id="ai-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={details.needsKey ? "sk-…" : "Not needed for a local model"}
            autoComplete="off"
          />
          <p className="mt-1 text-xs leading-5 text-muted">It is stored encrypted, and it is only used for your requests.</p>
        </div>

        <div className="mt-3">
          <Label htmlFor="ai-model">Model</Label>
          {models.length ? (
            <select id="ai-model" value={model} onChange={(event) => setModel(event.target.value)} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm">
              {models.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          ) : (
            <Input id="ai-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="The name of the model" />
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={test.isPending || !baseUrl.trim()} onClick={() => test.mutate()}>
            {test.isPending ? <><LoaderCircle className="size-4 animate-spin" />Testing…</> : <><Plug className="size-4" />Test &amp; load models</>}
          </Button>
          <Button disabled={save.isPending || !baseUrl.trim() || !model.trim()} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>

        <ul className="mt-4 space-y-1 text-xs leading-5 text-muted">
          <li>The key is stored encrypted and is only used for your requests.</li>
          <li>Content is sent only when you run an AI action, and only what you choose.</li>
          <li>Set a spending limit at your provider, because we cannot set one for you.</li>
        </ul>
      </div>
    </section>
  );
}
