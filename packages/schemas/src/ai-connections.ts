import { z } from "zod";
import { uuidSchema } from "./common";

/**
 * The ways a provider can be talked to.
 *
 * Most providers speak the same language, so one adapter covers them all.
 * The two that do not are given their own.
 */
export const aiProviderKindSchema = z.enum(["openai-compatible", "anthropic", "gemini"]);

/**
 * The providers that are set up with one click.
 *
 * The list is shared, so that the website and the server agree on what a
 * provider is called and where it lives. The address stays editable, so
 * that a provider that is not on the list, or one that is on their own
 * network, can still be used.
 */
export const aiProviderPresetSchema = z.enum([
  "openai", "openrouter", "groq", "deepseek", "mistral", "together", "ollama", "lmstudio", "custom", "anthropic", "gemini",
]);

export type AiProviderKind = z.infer<typeof aiProviderKindSchema>;
export type AiProviderPreset = z.infer<typeof aiProviderPresetSchema>;

export interface AiProviderPresetDetails {
  preset: AiProviderPreset;
  /** The name that is shown. */
  label: string;
  kind: AiProviderKind;
  /** Where the provider is. It can be changed. */
  baseUrl: string;
  /** The model that is used to begin with. */
  model: string;
  /** True when the provider runs on the machine of the person. */
  local: boolean;
  /** False when the provider needs no key, which is the case for a local model. */
  needsKey: boolean;
  /** A word about the provider, for the person choosing one. */
  note: string;
}

export const AI_PROVIDER_PRESETS: readonly AiProviderPresetDetails[] = [
  { preset: "openai", label: "OpenAI", kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", local: false, needsKey: true, note: "ChatGPT and the OpenAI API." },
  { preset: "openrouter", label: "OpenRouter", kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", local: false, needsKey: true, note: "One key for many models." },
  { preset: "groq", label: "Groq", kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", local: false, needsKey: true, note: "Very fast, on open models." },
  { preset: "deepseek", label: "DeepSeek", kind: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", local: false, needsKey: true, note: "Cheap and steady." },
  { preset: "mistral", label: "Mistral", kind: "openai-compatible", baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest", local: false, needsKey: true, note: "European models, and a free tier." },
  { preset: "together", label: "Together", kind: "openai-compatible", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", local: false, needsKey: true, note: "Many open models at once." },
  { preset: "ollama", label: "Ollama", kind: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "llama3.2", local: true, needsKey: false, note: "A model on your own machine." },
  { preset: "lmstudio", label: "LM Studio", kind: "openai-compatible", baseUrl: "http://localhost:1234/v1", model: "local-model", local: true, needsKey: false, note: "A model on your own machine." },
  { preset: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-3-5-haiku-latest", local: false, needsKey: true, note: "The Claude models." },
  { preset: "gemini", label: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-2.5-flash", local: false, needsKey: true, note: "Your own Google AI Studio key." },
  { preset: "custom", label: "Custom", kind: "openai-compatible", baseUrl: "", model: "", local: false, needsKey: true, note: "Any service that speaks the OpenAI language." },
];

/**
 * The preset with that name.
 */
export function aiProviderPreset(preset: AiProviderPreset): AiProviderPresetDetails {
  return AI_PROVIDER_PRESETS.find((entry) => entry.preset === preset) ?? AI_PROVIDER_PRESETS[AI_PROVIDER_PRESETS.length - 1]!;
}

export const aiConnectionCreateSchema = z.object({
  /** What the person calls it. */
  label: z.string().trim().min(1).max(80),
  kind: aiProviderKindSchema,
  preset: aiProviderPresetSchema.default("custom"),
  /** Where the provider is. */
  baseUrl: z.string().trim().min(1).max(500),
  /** The model that is asked. */
  model: z.string().trim().min(1).max(120),
  /** The key of the provider. It is never sent back. */
  apiKey: z.string().trim().max(500).optional(),
  /** True for the connection that is used when nothing else is named. */
  isDefault: z.boolean().default(false),
});

export const aiConnectionPatchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().trim().min(1).max(500).optional(),
  isDefault: z.boolean().optional(),
  /** A new key for the connection. The old one is replaced. */
  apiKey: z.string().trim().max(500).optional(),
}).refine((value) => Object.keys(value).length > 0, "No changes supplied");

/**
 * A connection that has not been saved yet, or one that has.
 *
 * The test button takes either, so that a person can try a provider before
 * they keep it.
 */
export const aiConnectionTestSchema = z.object({
  /** A connection that is already saved. */
  id: uuidSchema.optional(),
  kind: aiProviderKindSchema.optional(),
  preset: aiProviderPresetSchema.optional(),
  baseUrl: z.string().trim().min(1).max(500).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().trim().max(500).optional(),
});

export type AiConnectionCreateInput = z.infer<typeof aiConnectionCreateSchema>;
export type AiConnectionPatchInput = z.infer<typeof aiConnectionPatchSchema>;
export type AiConnectionTestInput = z.infer<typeof aiConnectionTestSchema>;
