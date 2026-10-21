import { z } from "zod";
import { uuidSchema, urlSchema } from "./common";

const passwordSchema = z.string().min(10).max(128).refine(
  (value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value),
  "Password must include upper-case, lower-case, and numeric characters",
);

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().transform((value) => value.toLowerCase()),
  password: passwordSchema,
});
export const loginSchema = z.object({ email: z.email().transform((value) => value.toLowerCase()), password: z.string().min(1) });
/** The code from an authenticator app, used to finish a sign-in with two-factor on. */
export const twoFactorVerifySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code from your authenticator app."), trustDevice: z.boolean().default(false) });
export const forgotPasswordSchema = z.object({ email: z.email().transform((value) => value.toLowerCase()) });
export const resetPasswordSchema = z.object({ token: z.string().min(20), password: passwordSchema });
/**
 * Used by accounts that were created through a provider we no longer support.
 * They set a password once and then sign in normally.
 */
export const setPasswordSchema = z.object({ token: z.string().min(20), password: passwordSchema });
export const requestPasswordSetupSchema = z.object({ email: z.email().transform((value) => value.toLowerCase()) });
export const verifyEmailSchema = z.object({ email: z.email().transform((value) => value.toLowerCase()) });
export const organizationCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  currency: z.string().length(3).default("USD"),
  locale: z.string().default("en-US"),
  timeZone: z.string().default("UTC"),
});
export const organizationSelectSchema = z.object({ organizationId: uuidSchema });
export const extensionAuthStartSchema = z.object({
  redirectUri: urlSchema,
  codeChallenge: z.string().min(43).max(128),
  state: z.string().min(20).max(200),
});
export const extensionAuthApproveSchema = extensionAuthStartSchema.extend({ organizationId: uuidSchema });
export const extensionAuthExchangeSchema = z.object({
  code: z.string().min(20),
  codeVerifier: z.string().min(43).max(128),
  redirectUri: urlSchema,
});
export const extensionRefreshSchema = z.object({ refreshToken: z.string().min(32) });
