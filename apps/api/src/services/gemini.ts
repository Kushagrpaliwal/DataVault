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

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

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

  const model = env.GEMINI_MODEL;
  const maxOutputTokens = Math.min(input.maxOutputTokens ?? env.AI_MAX_OUTPUT_TOKENS, env.AI_MAX_OUTPUT_TOKENS);
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: input.system }] },
    contents: [{ role: "user", parts: [{ text: input.contents }] }],
    generationConfig: {
      temperature: input.temperature ?? 0.2,
      maxOutputTokens,
      ...(input.responseSchema ? { responseMimeType: "application/json", responseSchema: input.responseSchema } : {}),
    },
  };

  let response: Response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.geminiApiKey },
      body: JSON.stringify(body),
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
 * The model that turns text into a list of numbers.
 *
 * The numbers say what the text is about, and two texts that mean the same
 * thing have numbers that are close together. It is a different model from
 * the one that writes, because a model that writes is not asked to do this.
 */
export const EMBEDDING_MODEL = "text-embedding-004";

/**
 * Turn a text into a list of numbers.
 *
 * The list is what the search by meaning is made of: the numbers of a
 * question and the numbers of an item are compared, and the ones that are
 * close together are the ones that mean the same thing.
 */
export async function embedText(env: ServerEnvironment, text: string): Promise<number[]> {
  if (!env.geminiApiKey) throw new AppError(503, "AI_NOT_AVAILABLE", "AI features are not switched on for this server yet.");
  const contents = text.trim().slice(0, 8_000);
  if (!contents) throw new AppError(400, "AI_EMPTY_INPUT", "There is nothing to work with yet.");

  let response: Response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(EMBEDDING_MODEL)}:embedContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.geminiApiKey },
      body: JSON.stringify({ content: { parts: [{ text: contents }] } }),
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
