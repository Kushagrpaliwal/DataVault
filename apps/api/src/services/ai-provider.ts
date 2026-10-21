import type { ServerEnvironment } from "@data-vault/config";
import { AppError } from "../lib/errors";
import { assertSafeEndpoint, guardedFetchOptions } from "../lib/endpoint-guard";
import { generateJsonFor, listGeminiModels } from "./gemini";

/**
 * The providers a person can bring.
 *
 * The key is passed in and is never held here, and it is never written to
 * a log. The address is checked before it is called, because it was written
 * by a person.
 */
export interface AiTarget {
  kind: "openai-compatible" | "anthropic" | "gemini";
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface StructuredInput {
  /** The instructions. */
  system: string;
  /** The material. */
  contents: string;
  /** The shape the answer must have. */
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface StructuredResult {
  data: unknown;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Ask a model for an answer in a known shape.
 *
 * Every provider is asked in the way it understands, and every answer is
 * checked by the caller, so a model that answers in the wrong shape is
 * refused rather than written into a doc.
 */
export async function generateStructured(env: ServerEnvironment, target: AiTarget, input: StructuredInput): Promise<StructuredResult> {
  const url = await assertSafeEndpoint(env, target.baseUrl);
  if (target.kind === "anthropic") return anthropicStructured(url, target, input);
  if (target.kind === "gemini") return geminiStructured(url, target, input);
  return openAiStructured(url, target, input);
}

/**
 * The models a provider offers.
 *
 * It is what the "Test connection" button shows, so that a person can pick
 * the model they want without knowing the name of it.
 */
export async function listModels(env: ServerEnvironment, target: AiTarget): Promise<string[]> {
  const url = await assertSafeEndpoint(env, target.baseUrl);
  if (target.kind === "gemini") {
    const models = await listGeminiModels(url, target.apiKey);
    return models.map((model) => model.replace(/^models\//, ""));
  }
  const endpoint = target.kind === "anthropic" ? new URL("/v1/models", url) : new URL("/models", ensureTrailingSlash(url));
  const response = await fetch(endpoint, {
    ...guardedFetchOptions(30_000),
    headers: { accept: "application/json", ...authHeaders(target) },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn(JSON.stringify({ level: "warn", event: "ai_models_rejected", status: response.status, detail: detail.slice(0, 200) }));
    throw new AppError(502, "AI_PROVIDER_FAILED", "That provider did not answer with its list of models.");
  }
  const payload = await response.json() as { data?: { id?: string }[]; models?: { name?: string }[] };
  const names = (payload.data ?? []).map((entry) => entry.id ?? "").filter(Boolean);
  if (names.length) return names;
  return (payload.models ?? []).map((entry) => (entry.name ?? "").replace(/^models\//, "")).filter(Boolean);
}

/**
 * The address a provider is called at.
 *
 * Most providers keep their models under a path, so the address is given a
 * slash when it does not have one.
 */
function ensureTrailingSlash(url: URL): URL {
  if (url.pathname.endsWith("/")) return url;
  const next = new URL(url.toString());
  next.pathname = `${next.pathname}/`;
  return next;
}

function authHeaders(target: AiTarget): Record<string, string> {
  if (target.kind === "anthropic") return { "x-api-key": target.apiKey, "anthropic-version": "2023-06-01" };
  if (target.kind === "gemini") return { "x-goog-api-key": target.apiKey };
  return { authorization: `Bearer ${target.apiKey}` };
}

/**
 * The providers that speak the OpenAI language.
 *
 * The answer is asked for in a shape the provider promises, and when it
 * refuses that, it is asked for a shape it is known to give, and when it
 * refuses that too, the JSON is taken out of the words it wrote.
 */
async function openAiStructured(url: URL, target: AiTarget, input: StructuredInput): Promise<StructuredResult> {
  const endpoint = new URL("chat/completions", ensureTrailingSlash(url));
  const messages = [
    { role: "system", content: input.system },
    { role: "user", content: input.contents },
  ];
  const base = { model: target.model, messages, max_tokens: input.maxOutputTokens };
  const attempts: Array<Record<string, unknown>> = [
    { ...base, response_format: { type: "json_schema", json_schema: { name: "answer", schema: input.schema, strict: true } } },
    { ...base, response_format: { type: "json_object" } },
    base,
  ];

  let lastError: unknown;
  for (const [index, body] of attempts.entries()) {
    const response = await fetch(endpoint, {
      ...guardedFetchOptions(),
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...authHeaders(target) },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const payload = await response.json() as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = payload.choices?.[0]?.message?.content ?? "";
      const data = parseJson(text);
      return {
        data,
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
        model: target.model,
      };
    }
    /**
     * A provider that does not know the shape is asked again in a simpler
     * way, and the last answer is refused.
     */
    if (response.status === 400 && index < attempts.length - 1) {
      lastError = await response.text().catch(() => "");
      continue;
    }
    if (response.status === 429) throw new AppError(429, "AI_RATE_LIMITED", "That provider is busy right now. Please try again in a few minutes.");
    if (response.status === 401 || response.status === 403) throw new AppError(502, "AI_PROVIDER_REFUSED", "That provider refused the key. Please check it.");
    const detail = await response.text().catch(() => "");
    console.warn(JSON.stringify({ level: "warn", event: "ai_provider_rejected", status: response.status, detail: detail.slice(0, 200) }));
    throw new AppError(502, "AI_PROVIDER_FAILED", "That provider could not answer right now. Please try again.");
  }
  console.warn(JSON.stringify({ level: "warn", event: "ai_provider_rejected", detail: String(lastError).slice(0, 200) }));
  throw new AppError(502, "AI_PROVIDER_FAILED", "That provider could not answer right now. Please try again.");
}

/**
 * Anthropic.
 *
 * The answer is asked for as a tool, and the tool is the shape the answer
 * must have. That works on every Claude model, which is more than can be
 * said for asking for JSON in the words themselves.
 */
async function anthropicStructured(url: URL, target: AiTarget, input: StructuredInput): Promise<StructuredResult> {
  const endpoint = new URL("/v1/messages", url);
  const response = await fetch(endpoint, {
    ...guardedFetchOptions(),
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...authHeaders(target) },
    body: JSON.stringify({
      model: target.model,
      max_tokens: input.maxOutputTokens,
      system: input.system,
      messages: [{ role: "user", content: input.contents }],
      tools: [{ name: "answer", description: "The answer, in the shape that was asked for.", input_schema: input.schema }],
      tool_choice: { type: "tool", name: "answer" },
    }),
  });
  if (!response.ok) {
    if (response.status === 429) throw new AppError(429, "AI_RATE_LIMITED", "That provider is busy right now. Please try again in a few minutes.");
    if (response.status === 401 || response.status === 403) throw new AppError(502, "AI_PROVIDER_REFUSED", "That provider refused the key. Please check it.");
    const detail = await response.text().catch(() => "");
    console.warn(JSON.stringify({ level: "warn", event: "ai_provider_rejected", status: response.status, detail: detail.slice(0, 200) }));
    throw new AppError(502, "AI_PROVIDER_FAILED", "That provider could not answer right now. Please try again.");
  }
  const payload = await response.json() as {
    content?: { type?: string; input?: unknown }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const tool = payload.content?.find((part) => part.type === "tool_use");
  if (!tool) throw new AppError(502, "AI_INVALID_RESPONSE", "That provider did not answer in the shape that was asked for.");
  return {
    data: tool.input,
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
    model: target.model,
  };
}

/**
 * Google.
 *
 * The same request the server's own key makes, with the key and the model
 * of the person instead.
 */
async function geminiStructured(url: URL, target: AiTarget, input: StructuredInput): Promise<StructuredResult> {
  const result = await generateJsonFor({ apiKey: target.apiKey, model: target.model, baseUrl: url }, {
    system: input.system,
    contents: input.contents,
    responseSchema: input.schema,
    maxOutputTokens: input.maxOutputTokens,
  });
  return { data: result.data, inputTokens: result.inputTokens, outputTokens: result.outputTokens, model: target.model };
}

/**
 * The JSON in the words of a model.
 *
 * A model that was not asked for JSON may still write it, wrapped in
 * something, and that is better than nothing.
 */
export function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new AppError(502, "AI_EMPTY_RESPONSE", "That provider did not answer.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* The words are not JSON either. */
      }
    }
    throw new AppError(502, "AI_INVALID_RESPONSE", "That provider did not answer in the shape that was asked for.");
  }
}
