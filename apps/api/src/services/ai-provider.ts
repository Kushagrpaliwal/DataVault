import type { ServerEnvironment } from "@data-vault/config";
import { AppError } from "../lib/errors";
import { assertSafeEndpoint, guardedFetchOptions } from "../lib/endpoint-guard";
import { embedGeminiText, generateJsonFor, listGeminiModels, tryRepairTruncatedJson, type EmbeddingPurpose } from "./gemini";

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

/** Model used for semantic search with OpenAI-compatible providers. */
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 768;

/** Pick the embedding model for the provider the user connected. */
export function embeddingModelFor(target: AiTarget, env: ServerEnvironment): string {
  if (target.kind === "gemini") return env.GEMINI_EMBEDDING_MODEL;
  if (target.kind === "openai-compatible") return OPENAI_EMBEDDING_MODEL;
  throw new AppError(422, "AI_EMBEDDING_UNSUPPORTED", "This provider does not support semantic search. Connect Gemini or an OpenAI-compatible provider.");
}

/** Generate a vector through the user's connected provider. */
export async function embedTextForTarget(
  env: ServerEnvironment,
  target: AiTarget,
  text: string,
  purpose: EmbeddingPurpose = "document",
): Promise<number[]> {
  const model = embeddingModelFor(target, env);
  const contents = text.trim().slice(0, 8_000);
  if (!contents) throw new AppError(400, "AI_EMPTY_INPUT", "There is nothing to work with yet.");
  const normalized = { ...target, baseUrl: normalizeBaseUrl(target.baseUrl) };
  const url = await assertSafeEndpoint(env, normalized.baseUrl);
  if (normalized.kind === "gemini") {
    return embedGeminiText({ apiKey: normalized.apiKey, model: normalized.model, baseUrl: url }, model, contents, purpose);
  }

  const endpoint = new URL("embeddings", ensureTrailingSlash(url));
  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...guardedFetchOptions(30_000),
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(normalized) },
      body: JSON.stringify({ model, input: contents, dimensions: EMBEDDING_DIMENSIONS }),
    });
  } catch {
    throw new AppError(502, "AI_UNREACHABLE", "The AI provider could not be reached. Please check your network connection.");
  }
  if (response.status === 429) throw new AppError(429, "AI_RATE_LIMITED", "Your AI provider is busy. Please try again in a few minutes.");
  if (response.status === 401 || response.status === 403) throw new AppError(502, "AI_PROVIDER_REFUSED", "Your AI provider refused the key. Please check it in Settings.");
  if (!response.ok) {
    throw new AppError(422, "AI_EMBEDDING_UNSUPPORTED", "This provider could not create embeddings with text-embedding-3-small. Use a compatible provider or Gemini for semantic search.");
  }
  const payload = await response.json() as { data?: { embedding?: unknown }[] };
  const values = payload.data?.[0]?.embedding;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS || !values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new AppError(422, "AI_EMBEDDING_UNSUPPORTED", "This provider returned an unsupported embedding format. Use a compatible provider or Gemini for semantic search.");
  }
  return values as number[];
}

/**
 * Automatically normalize common AI base URLs so that missing path prefixes
 * (such as /v1 or /api/v1) are added automatically.
 */
export function normalizeBaseUrl(raw: string): string {
  let trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  try {
    const url = new URL(trimmed);
    const host = url.host.toLowerCase();
    const pathname = url.pathname.replace(/\/+$/, "");

    // OpenRouter: ensure /api/v1
    if ((host === "openrouter.ai" || host.endsWith(".openrouter.ai")) && !pathname.includes("/api/v1")) {
      url.pathname = "/api/v1";
      return url.toString().replace(/\/+$/, "");
    }
    // xAI Grok: ensure /v1
    if ((host === "api.x.ai" || host === "x.ai") && !pathname.includes("/v1")) {
      url.host = "api.x.ai";
      url.pathname = "/v1";
      return url.toString().replace(/\/+$/, "");
    }
    // OpenAI: ensure /v1
    if ((host === "api.openai.com" || host === "openai.com") && !pathname.includes("/v1")) {
      url.host = "api.openai.com";
      url.pathname = "/v1";
      return url.toString().replace(/\/+$/, "");
    }
    // Groq: ensure /openai/v1
    if ((host === "api.groq.com" || host === "groq.com") && !pathname.includes("/openai/v1")) {
      url.host = "api.groq.com";
      url.pathname = "/openai/v1";
      return url.toString().replace(/\/+$/, "");
    }
    // DeepSeek: ensure /v1
    if ((host === "api.deepseek.com" || host === "deepseek.com") && !pathname.includes("/v1")) {
      url.host = "api.deepseek.com";
      url.pathname = "/v1";
      return url.toString().replace(/\/+$/, "");
    }
    // Mistral: ensure /v1
    if ((host === "api.mistral.ai" || host === "mistral.ai") && !pathname.includes("/v1")) {
      url.host = "api.mistral.ai";
      url.pathname = "/v1";
      return url.toString().replace(/\/+$/, "");
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Ask a model for an answer in a known shape.
 *
 * Every provider is asked in the way it understands, and every answer is
 * checked by the caller, so a model that answers in the wrong shape is
 * refused rather than written into a doc.
 */
export async function generateStructured(env: ServerEnvironment, target: AiTarget, input: StructuredInput): Promise<StructuredResult> {
  const normalizedTarget = { ...target, baseUrl: normalizeBaseUrl(target.baseUrl) };
  const url = await assertSafeEndpoint(env, normalizedTarget.baseUrl);
  if (normalizedTarget.kind === "anthropic") return anthropicStructured(url, normalizedTarget, input);
  if (normalizedTarget.kind === "gemini") return geminiStructured(url, normalizedTarget, input);
  return openAiStructured(url, normalizedTarget, input);
}

/**
 * The models a provider offers.
 *
 * It is what the "Test connection" button shows, so that a person can pick
 * the model they want without knowing the name of it.
 */
export async function listModels(env: ServerEnvironment, target: AiTarget): Promise<string[]> {
  const normalizedTarget = { ...target, baseUrl: normalizeBaseUrl(target.baseUrl) };
  const url = await assertSafeEndpoint(env, normalizedTarget.baseUrl);
  if (normalizedTarget.kind === "gemini") {
    return listGeminiModels(url, normalizedTarget.apiKey);
  }
  const endpoint = normalizedTarget.kind === "anthropic"
    ? new URL("v1/models", ensureTrailingSlash(url))
    : new URL("models", ensureTrailingSlash(url));
  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...guardedFetchOptions(30_000),
      headers: { accept: "application/json", ...authHeaders(normalizedTarget) },
    });
  } catch {
    throw new AppError(502, "AI_UNREACHABLE", "That provider could not be reached. Please check your network connection.");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn(JSON.stringify({ level: "warn", event: "ai_models_rejected", status: response.status, detail: detail.slice(0, 200) }));
    /**
     * A key that was refused is said as such, because that is the most
     * common reason for this call to fail and the person can do something
     * about it.
     */
    if (response.status === 401 || response.status === 403 || /incorrect api key|invalid api key/i.test(detail)) {
      throw new AppError(502, "AI_PROVIDER_REFUSED", "That provider refused the key. Please check your API key.");
    }
    if (response.status === 429) throw new AppError(429, "AI_RATE_LIMITED", "That provider is busy right now. Please try again in a few minutes.");
    throw new AppError(502, "AI_PROVIDER_FAILED", `That provider returned error ${response.status} when listing models.`);
  }
  const payload = await response.json() as { data?: { id?: string }[]; models?: { name?: string }[] };
  let names = (payload.data ?? []).map((entry) => entry.id ?? "").filter(Boolean);
  if (!names.length) {
    names = (payload.models ?? []).map((entry) => (entry.name ?? "").replace(/^models\//, "")).filter(Boolean);
  }

  // For OpenAI-compatible providers, filter out non-chat/non-generative models
  if (normalizedTarget.kind === "openai-compatible") {
    const nonChat = /(dall-e|tts|whisper|embedding|moderation|babbage|davinci|canary|orpheus|canopylabs|guard|rerank|audio|speech|transcribe)/i;
    const chatOnly = names.filter((name) => !nonChat.test(name));
    if (chatOnly.length) names = chatOnly;

    // Prioritize target model at front of list if present
    if (normalizedTarget.model && names.includes(normalizedTarget.model)) {
      names = [normalizedTarget.model, ...names.filter((m) => m !== normalizedTarget.model)];
    }
  }

  return names;
}

/**
 * Ask a model to say one word, so that it is known to work.
 *
 * The list of models says what a provider has. It does not say that this
 * key may use that model, or that the model answers at all. The request is
 * a very small one, and it asks for the shape the app asks for, so that a
 * model that cannot do the work is found out here rather than later.
 *
 * The answer is given room to think. The newer models of Google spend their
 * tokens on thinking before they answer, and a request that is cut short
 * gives nothing back at all, which would look like a model that does not
 * work.
 */
export async function probeModel(env: ServerEnvironment, target: AiTarget): Promise<{ answered: boolean; detail: string }> {
  try {
    await generateStructured(env, target, {
      system: "You answer with a shape and nothing else.",
      contents: "Reply with ok set to true as a JSON object: {\"ok\": true}",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      maxOutputTokens: 64,
    });
    return { answered: true, detail: "" };
  } catch (error) {
    if (error instanceof AppError && (error.code === "AI_PROVIDER_REFUSED" || /incorrect api key|invalid api key/i.test(error.message))) {
      return { answered: false, detail: "that provider refused the key. Please check your API key." };
    }
    if (error instanceof AppError && error.code === "AI_RATE_LIMITED") {
      return { answered: false, detail: "that provider is busy right now. Please try again in a few minutes." };
    }
    if (error instanceof AppError && error.code === "AI_MODEL_NOT_FOUND") {
      return { answered: false, detail: `model “${target.model}” is not available or not supported by this key.` };
    }
    const msg = error instanceof Error ? error.message : "";
    return { answered: false, detail: msg ? `model “${target.model}”: ${msg}` : `model “${target.model}” did not answer.` };
  }
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
  const headers: Record<string, string> = { authorization: `Bearer ${target.apiKey}` };
  const lower = target.baseUrl.toLowerCase();
  if (lower.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://datavault.app";
    headers["X-Title"] = "DataVault";
  }
  return headers;
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
  const strict = strictSchema(input.schema);
  /**
   * The words that ask for JSON.
   *
   * A provider that is asked for JSON will not give it otherwise, so the
   * word is in the request of every attempt that needs it.
   */
  const jsonNote = "\n\nAnswer with a single JSON object and nothing else.";
  const plain = [
    { role: "system", content: input.system },
    { role: "user", content: input.contents },
  ];
  const asked = [
    { role: "system", content: input.system },
    { role: "user", content: `${input.contents}${jsonNote}` },
  ];
  /**
   * The attempts, in the order they are tried.
   *
   * The first asks for the shape in the way the provider promises it, the
   * second asks for JSON by name, and the third asks for it in the words of
   * the model itself.
   */
  const attempts: Array<Record<string, unknown>> = [
    { model: target.model, messages: plain, response_format: { type: "json_schema", json_schema: { name: "answer", schema: strict, strict: true } } },
    { model: target.model, messages: asked, response_format: { type: "json_object" } },
    { model: target.model, messages: asked },
  ];
  /**
   * Newer models do not take the older name for the limit.
   *
   * The models of the o-series and of GPT-5 refuse `max_tokens` outright and
   * ask for `max_completion_tokens` instead, so the request is made again
   * with that name when the provider says so.
   */
  let useMaxCompletionTokens = false;

  let lastError: unknown;
  for (const [index, attempt] of attempts.entries()) {
    const body = useMaxCompletionTokens
      ? { ...attempt, max_completion_tokens: input.maxOutputTokens }
      : { ...attempt, max_tokens: input.maxOutputTokens };
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
    const detail = await response.text().catch(() => "");
    /**
     * The provider has said that the limit has another name. The same
     * attempt is made again with it, rather than dropping to a plainer
     * request that would lose the shape of the answer.
     */
    if (response.status === 400 && !useMaxCompletionTokens && /max_completion_tokens/i.test(detail)) {
      useMaxCompletionTokens = true;
      lastError = detail;
      continue;
    }
    /**
     * A provider that does not support the requested shape or parameter (such as xAI or OpenRouter)
     * returns 400, 422 (Unprocessable Entity) or 404. Try the next simpler shape.
     */
    if ((response.status === 400 || response.status === 422 || response.status === 404) && index < attempts.length - 1) {
      lastError = detail;
      continue;
    }
    // OpenRouter 402: balance too low for max_tokens request, but states how many tokens can be afforded
    if (response.status === 402) {
      const match = detail.match(/can only afford (\d+)/i);
      if (match && match[1]) {
        const affordable = Math.max(128, parseInt(match[1], 10) - 20);
        const retryBody = useMaxCompletionTokens
          ? { ...attempt, max_completion_tokens: affordable }
          : { ...attempt, max_tokens: affordable };
        try {
          const retryRes = await fetch(endpoint, {
            ...guardedFetchOptions(),
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json", ...authHeaders(target) },
            body: JSON.stringify(retryBody),
          });
          if (retryRes.ok) {
            const payload = await retryRes.json() as {
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
        } catch {
          // fall through
        }
      }
      throw new AppError(402, "AI_PROVIDER_BALANCE_LOW", "Your OpenRouter balance is too low for this request. Top up your OpenRouter account or choose a cheaper model.");
    }
    if (response.status === 429) throw new AppError(429, "AI_RATE_LIMITED", "That provider is busy right now. Please try again in a few minutes.");
    if (response.status === 401 || response.status === 403 || /incorrect api key|invalid api key/i.test(detail)) {
      throw new AppError(502, "AI_PROVIDER_REFUSED", "That provider refused the key. Please check your API key.");
    }
    console.warn(JSON.stringify({ level: "warn", event: "ai_provider_rejected", status: response.status, detail: detail.slice(0, 200) }));
    throw new AppError(502, "AI_PROVIDER_FAILED", detail.slice(0, 160) || "That provider could not answer right now. Please try again.");
  }
  console.warn(JSON.stringify({ level: "warn", event: "ai_provider_rejected", detail: String(lastError).slice(0, 200) }));
  throw new AppError(502, "AI_PROVIDER_FAILED", String(lastError).slice(0, 160) || "That provider could not answer right now. Please try again.");
}

/**
 * The words that are not allowed in a shape a provider is strict about.
 *
 * A strict shape is a smaller language than the one we write in. The limits
 * on the length of a text and the number of things in a list are left out,
 * because the provider will not accept them, and the answer is checked
 * afterwards anyway.
 */
const STRICT_KEYWORDS_IGNORED = new Set([
  "maxLength", "minLength", "pattern", "format", "maxItems", "minItems", "uniqueItems",
  "maximum", "minimum", "exclusiveMaximum", "exclusiveMinimum", "multipleOf",
  "default", "examples", "title", "$comment",
]);

/**
 * A shape that a provider in strict mode will accept.
 *
 * Strict mode asks for two things that the shapes we write do not have:
 * every object must say that it takes nothing else, and every property must
 * be in the list of the ones that are required. A property that was not
 * required is made able to be null, so that a model may still leave it out.
 *
 * The shape is copied and never changed in place, because callers can reuse
 * it to validate multiple provider responses.
 */
export function strictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(schema)) {
    if (STRICT_KEYWORDS_IGNORED.has(name)) continue;
    out[name] = value;
  }
  const properties = out.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    const props = properties as Record<string, Record<string, unknown>>;
    const required = new Set<string>(Array.isArray(out.required) ? (out.required as string[]) : []);
    const next: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(props)) {
      const cleaned = strictSchema(value);
      if (required.has(name)) next[name] = cleaned;
      else {
        required.add(name);
        next[name] = nullable(cleaned);
      }
    }
    out.properties = next;
    out.required = [...required];
    out.additionalProperties = false;
  }
  if (Array.isArray(out.items)) out.items = (out.items as Record<string, unknown>[]).map((item) => strictSchema(item));
  else if (out.items && typeof out.items === "object") out.items = strictSchema(out.items as Record<string, unknown>);
  if (Array.isArray(out.anyOf)) out.anyOf = (out.anyOf as Record<string, unknown>[]).map((item) => strictSchema(item));
  if (Array.isArray(out.oneOf)) out.oneOf = (out.oneOf as Record<string, unknown>[]).map((item) => strictSchema(item));
  return out;
}

/**
 * A shape that may be left out.
 *
 * A strict shape has to name every property as one that is required, so a
 * property that may be absent has to be able to be null.
 */
function nullable(schema: Record<string, unknown>): Record<string, unknown> {
  const type = schema.type;
  const values = Array.isArray(schema.enum) ? [...(schema.enum as unknown[])] : null;
  if (typeof type === "string") {
    const next: Record<string, unknown> = { ...schema, type: [type, "null"] };
    /**
     * A list of the values that are allowed has to have the empty one in it
     * as well, or the shape says two different things at once.
     */
    if (values) next.enum = [...values, null];
    return next;
  }
  if (Array.isArray(type)) return schema;
  if (type === undefined && values) return { ...schema, enum: [...values, null] };
  return schema;
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
    content?: { type?: string; input?: unknown; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const tool = payload.content?.find((part) => part.type === "tool_use");
  let data: unknown;
  if (tool && tool.input) {
    data = tool.input;
  } else {
    const textPart = payload.content?.find((part) => part.type === "text")?.text ?? "";
    if (textPart) {
      data = parseJson(textPart);
    } else {
      throw new AppError(502, "AI_INVALID_RESPONSE", "That provider did not answer in the shape that was asked for.");
    }
  }
  return {
    data,
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
    model: target.model,
  };
}

/**
 * Google.
 *
 * The request sent through the user's selected provider connection.
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
 * Clean markdown code fences and <think>...</think> blocks from raw AI text output.
 */
export function cleanRawJsonText(raw: string): string {
  let cleaned = raw.trim();
  // Remove <think>...</think> reasoning blocks from reasoning models (DeepSeek-R1, Qwen, etc.)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Extract from markdown code fence ```json ... ``` or ``` ... ```
  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(cleaned);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleaned = codeBlockMatch[1].trim();
  }

  return cleaned;
}

/**
 * The JSON in the words of a model.
 *
 * A model that was not asked for JSON may still write it, wrapped in
 * something, and that is better than nothing.
 */
export function parseJson(text: string): unknown {
  const cleaned = cleanRawJsonText(text);
  if (!cleaned) throw new AppError(502, "AI_EMPTY_RESPONSE", "That provider did not answer.");

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* The words are not JSON either. */
      }
    }
    const candidate = start >= 0 ? cleaned.slice(start) : cleaned;
    const repaired = tryRepairTruncatedJson(candidate);
    if (repaired !== null) return repaired;
    throw new AppError(502, "AI_INVALID_RESPONSE", "That provider did not answer in the shape that was asked for.");
  }
}
