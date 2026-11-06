import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, Check, CheckCircle2, ChevronDown, ChevronUp, KeyRound,
  LoaderCircle, Plug, Sliders, Sparkles, Trash2,
} from "lucide-react";
import { Button, Input, Label } from "@data-vault/ui";
import { AI_PROVIDER_PRESETS, type AiProviderPreset, detectProviderFromKey } from "@data-vault/schemas";
import { useAuth } from "../../lib/auth";
import { Modal, useToast } from "../../components/feedback";

/**
 * What a check of a key says.
 */
interface CheckResult {
  keyAccepted: boolean;
  models: string[];
  model: string | null;
  modelAnswered: boolean | null;
  detail: string;
}

function friendlyErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/failed to fetch/i.test(error.message) || /networkerror/i.test(error.message)) {
      return "Unable to reach the DataVault server. Please check your network connection and verify the server is running.";
    }
    return error.message;
  }
  return "That provider could not be reached.";
}

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
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [showManual, setShowManual] = useState(false);

  const detected = detectProviderFromKey(apiKey);

  /**
   * The check state for testing a key being added in the form before saving.
   */
  const [newCheck, setNewCheck] = useState<CheckResult | null>(null);
  const [newCheckError, setNewCheckError] = useState("");
  const [newChosenModel, setNewChosenModel] = useState("");

  /**
   * The check state for testing an already saved connection in the list.
   */
  const [savedCheck, setSavedCheck] = useState<CheckResult | null>(null);
  const [savedCheckError, setSavedCheckError] = useState("");
  const [savedCheckConnection, setSavedCheckConnection] = useState<string | null>(null);
  const [savedChosenModel, setSavedChosenModel] = useState("");

  const details = AI_PROVIDER_PRESETS.find((entry) => entry.preset === preset) ?? AI_PROVIDER_PRESETS[0]!;
  const custom = preset === "custom";
  const address = custom ? baseUrl.trim() : details.baseUrl;

  /**
   * Choose a provider manually.
   */
  const choosePreset = (next: AiProviderPreset) => {
    const entry = AI_PROVIDER_PRESETS.find((item) => item.preset === next) ?? AI_PROVIDER_PRESETS[0]!;
    setPreset(next);
    setBaseUrl(entry.baseUrl);
    setNewCheck(null);
    setNewCheckError("");
    setNewChosenModel("");
  };

  const handleKeyChange = (value: string) => {
    setApiKey(value);
    setNewCheck(null);
    setNewCheckError("");
    setNewChosenModel("");

    const detectedPreset = detectProviderFromKey(value);
    if (detectedPreset) {
      setPreset(detectedPreset.preset);
      setBaseUrl(detectedPreset.baseUrl);
      if (!label || AI_PROVIDER_PRESETS.some((p) => p.label === label)) {
        setLabel(detectedPreset.label);
      }
    }
  };

  /**
   * Check a key that is being configured now, before saving.
   *
   * The models that this key can access are retrieved and verified,
   * allowing the person to see and choose from accessible models in the form.
   */
  const checkNew = useMutation({
    mutationFn: () => {
      const activeDetails = (showManual && custom) ? details : (detected ?? details);
      const effectiveBaseUrl = (showManual && custom) ? baseUrl.trim() : (detected?.baseUrl || address);
      return api.testAiConnection({
        kind: activeDetails.kind,
        preset: activeDetails.preset,
        baseUrl: effectiveBaseUrl,
        ...(newChosenModel.trim() ? { model: newChosenModel.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
    },
    onSuccess: (result) => {
      setNewCheck(result);
      setNewCheckError("");
      setNewChosenModel(result.model ?? result.models[0] ?? "");
    },
    onError: (error) => {
      setNewCheck(null);
      setNewCheckError(friendlyErrorMessage(error));
      setNewChosenModel("");
    },
  });

  /**
   * Check a connection that is already saved.
   */
  const checkSaved = useMutation({
    mutationFn: (id: string) => api.testAiConnection({ id }),
    onSuccess: (result, id) => {
      setSavedCheck(result);
      setSavedCheckError("");
      setSavedCheckConnection(id);
      const candidate = (result.model && result.models.includes(result.model) && result.modelAnswered)
        ? result.model
        : (result.models[0] ?? result.model ?? "");
      setSavedChosenModel(candidate);
      void client.invalidateQueries({ queryKey: ["ai-connections"] });
    },
    onError: (error) => {
      setSavedCheck(null);
      setSavedCheckError(friendlyErrorMessage(error));
      setSavedCheckConnection(null);
      setSavedChosenModel("");
    },
  });

  const save = useMutation({
    mutationFn: () => {
      const activeDetails = (showManual && custom) ? details : (detected ?? details);
      const effectiveBaseUrl = (showManual && custom) ? baseUrl.trim() : (detected?.baseUrl || address);
      return api.createAiConnection({
        label: label.trim() || activeDetails.label,
        kind: activeDetails.kind,
        preset: activeDetails.preset,
        baseUrl: effectiveBaseUrl,
        model: newChosenModel.trim() || activeDetails.model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        isDefault: (connections.data?.length ?? 0) === 0,
      });
    },
    onSuccess: async (created) => {
      setApiKey("");
      setLabel("");
      setNewCheck(null);
      setNewCheckError("");
      setNewChosenModel("");
      notify(`${created.label} is connected.`);
      await client.invalidateQueries({ queryKey: ["ai-connections"] });
      await client.invalidateQueries({ queryKey: ["ai-credits"] });
    },
    onError: (error) => notify(friendlyErrorMessage(error), "error"),
  });

  /**
   * Change the model of a saved connection.
   */
  const changeModel = useMutation({
    mutationFn: (input: { id: string; model: string }) => api.patchAiConnection(input.id, { model: input.model }),
    onSuccess: async () => {
      closeSavedCheck();
      notify("The model was changed.");
      await client.invalidateQueries({ queryKey: ["ai-connections"] });
    },
    onError: (error) => notify(friendlyErrorMessage(error), "error"),
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) => api.patchAiConnection(id, { isDefault: true }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["ai-connections"] });
      await client.invalidateQueries({ queryKey: ["ai-credits"] });
    },
    onError: (error) => notify(friendlyErrorMessage(error), "error"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAiConnection(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["ai-connections"] });
      await client.invalidateQueries({ queryKey: ["ai-credits"] });
    },
    onError: (error) => notify(friendlyErrorMessage(error), "error"),
  });

  const closeSavedCheck = () => {
    setSavedCheck(null);
    setSavedCheckError("");
    setSavedCheckConnection(null);
    setSavedChosenModel("");
  };

  const savedModalOpen = Boolean(savedCheck || savedCheckError);
  const isNetworkError = savedCheckError && (/unable to reach/i.test(savedCheckError) || /network/i.test(savedCheckError));
  const savedModalTitle = savedCheckError
    ? (isNetworkError ? "Connection problem" : "That key was not accepted")
    : "Your key works";

  return (
    <section className="panel p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-soft"><KeyRound className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Your AI</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Connect your own model provider (BYOK). Any provider that speaks the OpenAI
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
                  {connection.lastVerifiedAt ? ` · checked ${new Date(connection.lastVerifiedAt).toLocaleDateString()}` : ""}
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
                variant="secondary"
                onClick={() => checkSaved.mutate(connection.id)}
                disabled={checkSaved.isPending}
                title="Check whether the key works and which models it can use"
              >
                {checkSaved.isPending && checkSaved.variables === connection.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
                Check
              </Button>
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
        <h3 className="text-sm font-semibold">Connect an AI provider</h3>
        <p className="mt-1 text-xs text-muted">
          Paste your API key below. DataVault will auto-detect your provider and fetch available models.
        </p>

        <div className="mt-3">
          <Label htmlFor="ai-key">API Key</Label>
          <Input
            id="ai-key"
            type="password"
            value={apiKey}
            onChange={(event) => handleKeyChange(event.target.value)}
            placeholder="Paste your API key (OpenRouter, xAI Grok, Groq, OpenAI, Anthropic, Gemini, DeepSeek…)"
            autoComplete="off"
          />
          <p className="mt-1 text-xs leading-5 text-muted">It is stored encrypted, and it is only used for your requests.</p>
        </div>

        {detected ? (
          <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-purple-200 bg-purple-50/70 p-2.5 text-xs text-purple-950 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-200">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-purple-600 dark:text-purple-400 shrink-0" />
              <span>
                Auto-detected: <strong>{detected.providerName}</strong> ({detected.baseUrl})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowManual(true)}
              className="text-[11px] underline opacity-80 hover:opacity-100"
            >
              Manual settings
            </button>
          </div>
        ) : null}

        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-ink font-medium transition-colors"
          >
            <Sliders className="size-3.5" />
            <span>{showManual ? "Hide manual settings" : "Configure manually or connect local model (Ollama, LM Studio, Custom)"}</span>
            {showManual ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        </div>

        {showManual ? (
          <div className="mt-3 space-y-3 rounded-xl border border-line bg-soft/40 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ai-preset">Provider</Label>
                <select
                  id="ai-preset"
                  value={preset}
                  onChange={(event) => choosePreset(event.target.value as AiProviderPreset)}
                  className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm"
                >
                  {AI_PROVIDER_PRESETS.map((entry) => (
                    <option key={entry.preset} value={entry.preset}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs leading-5 text-muted">{details.note}</p>
              </div>
              <div>
                <Label htmlFor="ai-label">Connection Name</Label>
                <Input
                  id="ai-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={details.label}
                />
              </div>
            </div>

            {custom ? (
              <div>
                <Label htmlFor="ai-base-url">Endpoint Address</Label>
                <Input
                  id="ai-base-url"
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                    setNewCheck(null);
                    setNewCheckError("");
                    setNewChosenModel("");
                  }}
                  placeholder="https://…"
                />
                <p className="mt-1 text-xs leading-5 text-muted">
                  The base address of your custom endpoint or proxy.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {newCheckError ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-900 dark:bg-red-950/40 dark:text-red-200">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
            <p>{newCheckError}</p>
          </div>
        ) : null}

        {newCheck ? (
          <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>{newCheck.detail}</span>
            </div>

            {newCheck.models.length ? (
              <div>
                <Label htmlFor="ai-new-model-choice">Model to use</Label>
                <select
                  id="ai-new-model-choice"
                  value={newChosenModel}
                  onChange={(event) => setNewChosenModel(event.target.value)}
                  className="mt-1 h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm"
                >
                  {newCheck.models.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <p className="mt-1 text-xs leading-5 text-muted">
                  This key can access {newCheck.models.length} model{newCheck.models.length === 1 ? "" : "s"}.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted">The provider has no models to show.</p>
            )}

            {newCheck.modelAnswered === false ? (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p>
                  The selected model did not answer. It may be unavailable to this key. Choose another model above.
                </p>
              </div>
            ) : null}

            <div className="pt-1">
              <Button
                disabled={save.isPending || !newChosenModel.trim()}
                onClick={() => save.mutate()}
              >
                {save.isPending ? <><LoaderCircle className="size-4 animate-spin" />Connecting…</> : <><Check className="size-4" />Save and connect</>}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <Button
              disabled={checkNew.isPending || (!apiKey.trim() && details.needsKey)}
              onClick={() => checkNew.mutate()}
            >
              {checkNew.isPending ? <><LoaderCircle className="size-4 animate-spin" />Checking key…</> : <><Sparkles className="size-4" />Check & connect key</>}
            </Button>
          </div>
        )}

        <ul className="mt-4 space-y-1 text-xs leading-5 text-muted">
          <li>The key is stored encrypted and is only used for your requests.</li>
          <li>Content is sent only when you run an AI action, and only what you choose.</li>
          <li>Set a spending limit at your provider, because we cannot set one for you.</li>
        </ul>
      </div>

      <Modal
        open={savedModalOpen}
        onClose={closeSavedCheck}
        title={savedModalTitle}
        width="max-w-lg"
      >
        {savedCheckError ? (
          <p className="text-sm leading-6 text-strong">{savedCheckError}</p>
        ) : (
          <>
            <p className="text-sm leading-6 text-strong">{savedCheck?.detail}</p>
            {savedCheck?.models.length ? (
              <div className="mt-5">
                <label htmlFor="ai-saved-model-choice" className="block text-xs font-semibold uppercase tracking-[.13em] text-muted">
                  The model to use
                </label>
                <select
                  id="ai-saved-model-choice"
                  value={savedChosenModel}
                  onChange={(event) => setSavedChosenModel(event.target.value)}
                  className="mt-1 h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm"
                >
                  {savedCheck.models.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <p className="mt-1 text-xs leading-5 text-muted">
                  This key can use {savedCheck.models.length} model{savedCheck.models.length === 1 ? "" : "s"}.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">The provider has no models to show.</p>
            )}
            {savedCheck?.modelAnswered === false ? (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                The model that was in use did not answer. It may be the wrong name, or the key may not have access to it.
                Another model may still work.
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-2">
              {savedCheckConnection ? (
                <Button disabled={changeModel.isPending || !savedChosenModel.trim()} onClick={() => changeModel.mutate({ id: savedCheckConnection, model: savedChosenModel.trim() })}>
                  {changeModel.isPending ? "Saving…" : "Use this model"}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={closeSavedCheck}>Close</Button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}