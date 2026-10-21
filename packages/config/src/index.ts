import { z } from "zod";

export const productConfig = {
  name: "DataVault",
  slug: "data-vault",
  description: "Save anything from the web and find it again later.",
  defaultCurrency: "USD",
  defaultLocale: "en-US",
  defaultTimeZone: "UTC",
} as const;

/**
 * The workspace defaults a browser can tell us about.
 *
 * A new workspace should feel like it belongs to the person who made it, so
 * the locale, the time zone and the currency come from the browser rather
 * than from a fixed guess on the server. When there is no browser, or the
 * browser says nothing useful, the product defaults are used instead.
 */
export function browserWorkspaceDefaults(): { currency: string; locale: string; timeZone: string } {
  const fallback: { currency: string; locale: string; timeZone: string } = { currency: productConfig.defaultCurrency, locale: productConfig.defaultLocale, timeZone: productConfig.defaultTimeZone };
  if (typeof navigator === "undefined" || typeof Intl === "undefined") return fallback;
  const locale = typeof navigator.language === "string" && navigator.language.trim() ? navigator.language : fallback.locale;
  let timeZone = fallback.timeZone;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || fallback.timeZone;
  } catch {
    // A browser that cannot resolve its own time zone keeps the default.
  }
  let currency = fallback.currency;
  try {
    currency = Intl.NumberFormat(locale, { style: "currency" }).resolvedOptions().currency || fallback.currency;
  } catch {
    // A locale the runtime cannot price keeps the default currency.
  }
  return { currency, locale, timeZone };
}

const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  API_URL: z.url().default("http://localhost:3000"),
  WEB_URL: z.url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  JWT_SECRET: z.string().min(32),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  EXTENSION_REDIRECT_URL: z.url(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("DataVault <no-reply@example.com>"),
  MAX_ATTACHMENT_BYTES: z.coerce.number().int().positive().default(5_242_880),
  /**
   * How many trusted reverse proxies sit in front of the API. X-Forwarded-For
   * is only believed when this is greater than zero, otherwise a client can
   * spoof its own address and walk straight past the rate limits.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  /** Cloudflare Turnstile. The signup captcha stays inert while these are blank. */
  TURNSTILE_SECRET_KEY: z.string().optional(),
  TURNSTILE_SITE_KEY: z.string().optional(),
  /** Gemini. The AI features stay inert while the key is blank. */
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
  /**
   * The model that turns text into numbers.
   *
   * It is a different model from the one that writes, and it has its own
   * life: the old one was switched off by Google, so the name is a setting
   * rather than a constant in the code.
   */
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-2"),
  /**
   * The Gemini free tier enforces requests-per-day per project, shared by
   * every user of the product. These mirror the quota shown in AI Studio so
   * the server throttles itself before Google does.
   */
  AI_GLOBAL_DAILY_REQUESTS: z.coerce.number().int().min(0).default(900),
  /**
   * The budget for the numbers that make a search by meaning work.
   *
   * Making numbers is cheaper than writing, but it is not free, and it is
   * shared by everybody, so it has a budget of its own.
   */
  AI_GLOBAL_DAILY_EMBEDDINGS: z.coerce.number().int().min(0).default(900),
  AI_GLOBAL_MINUTE_REQUESTS: z.coerce.number().int().min(0).default(12),
  AI_USER_DAILY_CREDITS: z.coerce.number().int().min(0).default(20),
  AI_USER_MINUTE_REQUESTS: z.coerce.number().int().min(0).default(5),
  AI_MAX_INPUT_TOKENS: z.coerce.number().int().min(256).default(4_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).default(400),
  /** Free-tier Gemini may use submitted content to improve Google's products. */
  AI_FREE_TIER_CONTENT_NOTICE: z.enum(["true", "false"]).default("true"),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema> & {
  allowedOrigins: string[];
  smtpSecure: boolean;
  trustedProxyHops: number;
  turnstileSecretKey?: string | undefined;
  turnstileSiteKey?: string | undefined;
  geminiApiKey?: string | undefined;
  aiFreeTierContentNotice: boolean;
};

export function getServerEnvironment(source: Record<string, string | undefined> = process.env): ServerEnvironment {
  const parsed = serverEnvironmentSchema.parse(source);
  const trim = (value: string | undefined) => value?.trim() || undefined;
  const turnstileSecretKey = trim(parsed.TURNSTILE_SECRET_KEY);
  const turnstileSiteKey = trim(parsed.TURNSTILE_SITE_KEY);
  if (Boolean(turnstileSecretKey) !== Boolean(turnstileSiteKey)) {
    throw new Error("TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY must be configured together.");
  }
  return {
    ...parsed,
    allowedOrigins: parsed.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    smtpSecure: parsed.SMTP_SECURE === "true",
    trustedProxyHops: parsed.TRUSTED_PROXY_HOPS,
    turnstileSecretKey,
    turnstileSiteKey,
    geminiApiKey: trim(parsed.GEMINI_API_KEY),
    aiFreeTierContentNotice: parsed.AI_FREE_TIER_CONTENT_NOTICE === "true",
  };
}

export const designTokens = {
  canvas: "#fffaf0",
  surface: "#faf5e8",
  card: "#f5f0e0",
  border: "#e5e5e5",
  ink: "#0a0a0a",
  muted: "#6a6a6a",
  teal: "#1a3a3a",
  pink: "#ff4d8b",
  lavender: "#b8a4ed",
  peach: "#ffb084",
  ochre: "#e8b94a",
} as const;
