import type { ServerEnvironment } from "@data-vault/config";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/crypto";

export interface GeminiGenerateInput {
  /** The system instruction. Kept short and fixed by the caller. */
  system: string;
  /** The user content. Saved text always arrives here, as data. */
  contents: string;
  /** The JSON schema the answer should follow. */
  responseSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface GeminiGenerateResult {
  /** The parsed JSON answer. */
  data: unknown;
  inputTokens: number;
  outputTokens: number;
  /** A stable key for the request, used to serve repeats from cache. */
  cacheKey: string;
}

const GEMINI_ROOT = "https://generativelanguage.googleapis.com";

/**
 * The Google model a request is made to.
 *
 * The key and the model are given, so that the server's own key and the
 * key of a person are asked in exactly the same way.
 */
export interface GeminiTarget {
  apiKey: string;
  model: string;
  /** Where Google is. It is here so that a person may point it elsewhere. */
  baseUrl?: URL;
}

/**
 * Where the models are.
 *
 * Google keeps them under a version and a path, and the path is added
 * here so that the address of a provider is only ever the root of it.
 */
function modelsEndpoint(base: URL): string {
  return `${base.pathname.replace(/\/+$/, "")}/v1beta/models`;
}

/**
 * The models Google offers.
 */
export async function listGeminiModels(baseUrl: URL, apiKey: string): Promise<string[]> {
  const endpoint = new URL(`${modelsEndpoint(baseUrl)}`, baseUrl.origin);
  const response = await fetch(endpoint, { headers: { "x-goog-api-key": apiKey, accept: "application/json" } });
  if (!response.ok) throw new AppError(502, "AI_PROVIDER_FAILED", "Google did not answer with its list of models.");
  const payload = await response.json() as { models?: { name?: string }[] };
  return (payload.models ?? []).map((entry) => entry.name ?? "").filter(Boolean);
}

/**
 * A stable key for a request.
 *
 * Repeating the same request must not spend another credit, so the answer is
 * cached against a hash of everything that could change the result.
 */
export async function cacheKeyFor(input: GeminiGenerateInput, model: string): Promise<string> {
  return sha256(JSON.stringify({ model, system: input.system, contents: input.contents, schema: input.responseSchema ?? null }));
}

/**
 * Ask the model for an answer.
 *
 * The API key never leaves the server: it is only ever read from the
 * environment here, and the request is made by the API, not by the browser or
 * the extension.
 */
export async function generateJson(env: ServerEnvironment, input: GeminiGenerateInput): Promise<GeminiGenerateResult> {
  if (!env.geminiApiKey) throw new AppError(503, "AI_NOT_AVAILABLE", "AI features are not switched on for this server yet.");
  return generateJsonFor({ apiKey: env.geminiApiKey, model: env.GEMINI_MODEL }, {
    ...input,
    maxOutputTokens: Math.min(input.maxOutputTokens ?? env.AI_MAX_OUTPUT_TOKENS, env.AI_MAX_OUTPUT_TOKENS),
  });
}

/**
 * Ask a Google model for an answer.
 *
 * This is the same code the server's own key uses, with the key and the
 * model of whoever is asking.
 */
export async function generateJsonFor(target: GeminiTarget, input: GeminiGenerateInput): Promise<GeminiGenerateResult> {
  const model = target.model;
  const maxOutputTokens = Math.min(input.maxOutputTokens ?? 400, 8_192);
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: input.system }] },
    contents: [{ role: "user", parts: [{ text: input.contents }] }],
    generationConfig: {
      temperature: input.temperature ?? 0.2,
      maxOutputTokens,
      ...(input.responseSchema ? { responseMimeType: "application/json", responseSchema: input.responseSchema } : {}),
    },
  };
  const base = target.baseUrl ?? new URL(GEMINI_ROOT);
  const endpoint = new URL(`${modelsEndpoint(base)}/${encodeURIComponent(model)}:generateContent`, base.origin);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": target.apiKey },
      body: JSON.stringify(body),
      /**
       * The call is given a time to live, so that a model that does not
       * answer does not hold the server for ever.
       */
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new AppError(502, "AI_UNREACHABLE", "The AI service could not be reached. Please try again.");
  }

  if (response.status === 429) {
    throw new AppError(429, "AI_RATE_LIMITED", "The free AI allowance is busy right now. Please try again in a few minutes.");
  }
  if (response.status === 400) {
    const detail = await response.text().catch(() => "");
    console.warn(JSON.stringify({ level: "warn", event: "gemini_request_rejected", status: 400, detail: detail.slice(0, 400) }));
    throw new AppError(400, "AI_REQUEST_REJECTED", "The AI service could not handle that request.");
  }
  if (!response.ok) {
    throw new AppError(502, "AI_FAILED", "The AI service could not answer right now. Please try again.");
  }

  const payload = await response.json() as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const candidate = payload.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
  if (!text) {
    // An empty answer usually means the output was cut short by the token cap.
    throw new AppError(502, "AI_EMPTY_RESPONSE", "The AI service did not return an answer. Try a shorter piece of text.");
  }

  const inputTokens = payload.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = payload.usageMetadata?.candidatesTokenCount ?? 0;

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an answer we could not read. Please try again.");
  }

  return { data, inputTokens, outputTokens, cacheKey: await cacheKeyFor(input, model) };
}

/**
 * What the numbers are for.
 *
 * A document and a question are not the same thing. A document is the thing
 * that is being looked for, and a question is somebody looking for it. The
 * model is told which is which, because the numbers are better when it
 * knows, and because a question and a document are then close to each other
 * for the right reasons.
 */
export type EmbeddingPurpose = "document" | "query";

const TASK_TYPES: Record<EmbeddingPurpose, "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"> = {
  document: "RETRIEVAL_DOCUMENT",
  query: "RETRIEVAL_QUERY",
};

/**
 * How long the list of numbers is.
 *
 * The model can make a shorter list, and a shorter list is a smaller row in
 * the database and a quicker search. The size is the one Google's own guide
 * recommends, and the quality hardly changes at it.
 */
const EMBEDDING_DIMENSIONS = 768;

/**
 * Turn a text into a list of numbers.
 *
 * The list is what the search by meaning is made of: the numbers of a
 * question and the numbers of an item are compared, and the ones that are
 * close together are the ones that mean the same thing.
 *
 * The model is named in the environment, because its name changes: the model
 * this used to ask for was switched off by Google, and a name written in the
 * code cannot be changed without a new release.
 */
export async function embedText(env: ServerEnvironment, text: string, purpose: EmbeddingPurpose = "document"): Promise<number[]> {
  if (!env.geminiApiKey) throw new AppError(503, "AI_NOT_AVAILABLE", "AI features are not switched on for this server yet.");
  const model = env.GEMINI_EMBEDDING_MODEL;
  const contents = text.trim().slice(0, 8_000);
  if (!contents) throw new AppError(400, "AI_EMPTY_INPUT", "There is nothing to work with yet.");

  let response: Response;
  try {
    const endpoint = new URL(`${modelsEndpoint(new URL(GEMINI_ROOT))}/${encodeURIComponent(model)}:embedContent`, GEMINI_ROOT);
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.geminiApiKey },
      body: JSON.stringify({
        content: { parts: [{ text: contents }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
        taskType: TASK_TYPES[purpose],
      }),
    });
  } catch {
    throw new AppError(502, "AI_UNREACHABLE", "The AI service could not be reached. Please try again.");
  }
  if (response.status === 429) {
    throw new AppError(429, "AI_RATE_LIMITED", "The free AI allowance is busy right now. Please try again in a few minutes.");
  }
  if (!response.ok) {
    throw new AppError(502, "AI_FAILED", "The AI service could not answer right now. Please try again.");
  }
  const payload = await response.json() as { embedding?: { values?: number[] } };
  const values = payload.embedding?.values;
  if (!values?.length) throw new AppError(502, "AI_EMPTY_RESPONSE", "The AI service did not return an answer. Please try again.");
  return values;
}
