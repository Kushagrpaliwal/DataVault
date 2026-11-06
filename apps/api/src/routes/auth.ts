import { Elysia } from "elysia";
import { isAPIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { accounts, getDatabase, users } from "@data-vault/database";
import {
  forgotPasswordSchema, loginSchema, registerSchema, requestPasswordSetupSchema,
  resetPasswordSchema, setPasswordSchema, twoFactorVerifySchema, verifyEmailSchema,
} from "@data-vault/schemas";
import type { ServerEnvironment } from "@data-vault/config";
import type { DataVaultAuth } from "../auth/better-auth";
import { getActor } from "../auth/context";
import { csrfForRequest, requireCsrf } from "../auth/csrf";
import { AppError } from "../lib/errors";
import { success } from "../lib/http";
import { createMailer } from "../lib/mailer";
import { enforceRateLimit, enforceScopeLimit, RATE_LIMITS } from "../lib/rate-limit-policies";
import { clientIp } from "../lib/client-ip";
import { canReceiveVerification } from "../auth/disposable-email";
import { verifyTurnstile } from "../auth/turnstile";
import {
  completePasswordSetup, findUsersWithoutPassword, issuePasswordSetupToken, passwordSetupUrl,
} from "../auth/password-setup";
import { ensurePersonalOrganization, listOrganizations } from "../services/organizations";

function applyAuthHeaders(set: { headers: Record<string, string | number | readonly string[]> }, headers: Headers) {
  for (const [key, value] of headers.entries()) if (key.toLowerCase() !== "set-cookie") set.headers[key] = value;
  const cookies = headers.getSetCookie();
  if (cookies.length) set.headers["set-cookie"] = cookies;
}

function mapAuthError(error: unknown): never {
  if (isAPIError(error)) throw new AppError(error.statusCode ?? 400, "AUTHENTICATION_FAILED", error.message || "Authentication failed.");
  throw error;
}

export function createAuthRoutes(auth: DataVaultAuth, env: ServerEnvironment) {
  const mailer = createMailer(env);
  return new Elysia({ name: "auth-routes" })
    /**
     * Reports which sign-in methods this server offers, plus whether the
     * signup captcha is active and whether Google-style OAuth is gone.
     */
    .get("/api/v1/auth/methods", () => success({
      emailAndPassword: true,
      emailOtp: false,
      twoFactor: true,
      captcha: Boolean(env.turnstileSecretKey && env.turnstileSiteKey),
      captchaSiteKey: env.turnstileSiteKey ?? null,
    }))
    .post("/api/v1/auth/register", async ({ body, request, set }) => {
      await enforceRateLimit(request, env, RATE_LIMITS.signup);
      const input = registerSchema.parse(body);
      /**
       * The captcha is checked here rather than left to Better Auth, because
       * that plugin only guards requests that arrive over HTTP and this route
       * calls the sign-up endpoint directly.
       */
      await verifyTurnstile(env, request.headers.get("x-captcha-response"), clientIp(request, env));
      /**
       * A throwaway inbox is the cheapest way to farm accounts, and every
       * account that can be verified with one is another set of free credits.
       */
      if (!await canReceiveVerification(input.email)) {
        throw new AppError(400, "EMAIL_NOT_ACCEPTED", "Use an email address that can receive mail.");
      }
      try {
        const result = await auth.api.signUpEmail({
          body: { ...input, callbackURL: `${env.WEB_URL}/verified` },
          headers: request.headers,
          returnHeaders: true,
        });
        await ensurePersonalOrganization(result.response.user.id, result.response.user.name);
        const organizations = await listOrganizations(result.response.user.id);
        applyAuthHeaders(set, result.headers);
        set.status = 201;
        return success({
          user: { ...result.response.user, createdAt: result.response.user.createdAt.toISOString() },
          organizations,
          emailVerified: result.response.user.emailVerified,
          csrfToken: result.response.token ? await import("../lib/crypto").then(({ sha256 }) => sha256(`${result.response.token}:${env.SESSION_SECRET}`)) : undefined,
        });
      } catch (error) { return mapAuthError(error); }
    })
    .post("/api/v1/auth/login", async ({ body, request, set }) => {
      const input = loginSchema.parse(body);
      await enforceRateLimit(request, env, RATE_LIMITS.login);
      await enforceScopeLimit(RATE_LIMITS.login, input.email);
      try {
        const result = await auth.api.signInEmail({ body: input, headers: request.headers, returnHeaders: true });
        /**
         * An account with two-factor authentication on gets a challenge
         * instead of a session. There is no session to read here, so the
         * answer used to be read as though there was one, and signing in
         * with a second factor failed with a server fault.
         */
        const challenge = result.response as { twoFactorRedirect?: boolean; twoFactorMethods?: string[] };
        if (challenge.twoFactorRedirect) {
          applyAuthHeaders(set, result.headers);
          return success({ twoFactorRequired: true, twoFactorMethods: challenge.twoFactorMethods ?? [] });
        }
        applyAuthHeaders(set, result.headers);
        const organizations = await listOrganizations(result.response.user.id);
        return success({
          user: { ...result.response.user, createdAt: result.response.user.createdAt.toISOString() },
          organizations,
          emailVerified: result.response.user.emailVerified,
          csrfToken: await import("../lib/crypto").then(({ sha256 }) => sha256(`${result.response.token}:${env.SESSION_SECRET}`)),
        });
      } catch (error) { return mapAuthError(error); }
    })
    /**
     * Finish a sign-in that needs a second factor.
     *
     * The password was accepted, so Better Auth left a short-lived challenge
     * cookie behind. This route exchanges the code for a real session.
     */
    .post("/api/v1/auth/two-factor/verify", async ({ body, request, set }) => {
      const input = twoFactorVerifySchema.parse(body);
      await enforceRateLimit(request, env, RATE_LIMITS.login);
      try {
        const result = await auth.api.verifyTOTP({ body: { code: input.code, trustDevice: input.trustDevice }, headers: request.headers, returnHeaders: true });
        const verified = result.response as { token: string; user: { id: string; name: string; email: string; emailVerified: boolean; createdAt: Date } };
        applyAuthHeaders(set, result.headers);
        const organizations = await listOrganizations(verified.user.id);
        return success({
          user: { ...verified.user, createdAt: verified.user.createdAt.toISOString() },
          organizations,
          emailVerified: verified.user.emailVerified,
          csrfToken: await import("../lib/crypto").then(({ sha256 }) => sha256(`${verified.token}:${env.SESSION_SECRET}`)),
        });
      } catch (error) { return mapAuthError(error); }
    })
    .post("/api/v1/auth/logout", async ({ request, set }) => {
      await requireCsrf(request, auth, env);
      try { const result = await auth.api.signOut({ headers: request.headers, returnHeaders: true }); applyAuthHeaders(set, result.headers); return success(null); } catch (error) { return mapAuthError(error); }
    })
    .post("/api/v1/auth/forgot-password", async ({ body, request }) => {
      const input = forgotPasswordSchema.parse(body);
      await enforceRateLimit(request, env, RATE_LIMITS.emailRequest);
      await enforceScopeLimit(RATE_LIMITS.emailRequest, input.email);
      try { await auth.api.requestPasswordReset({ body: { email: input.email, redirectTo: `${env.WEB_URL}/reset-password` }, headers: request.headers }); } catch (error) { if (!isAPIError(error)) throw error; }
      return success(null);
    })
    .post("/api/v1/auth/reset-password", async ({ body, request }) => {
      const input = resetPasswordSchema.parse(body);
      await enforceRateLimit(request, env, RATE_LIMITS.passwordSetup);
      try { await auth.api.resetPassword({ body: { token: input.token, newPassword: input.password }, headers: request.headers }); return success(null); } catch (error) { return mapAuthError(error); }
    })
    /**
     * Resend the confirmation email. The address is always reported as sent,
     * so this cannot be used to find out which addresses have accounts.
     */
    .post("/api/v1/auth/verify-email", async ({ body, request }) => {
      const input = verifyEmailSchema.parse(body);
      await enforceRateLimit(request, env, RATE_LIMITS.emailRequest);
      await enforceScopeLimit(RATE_LIMITS.emailRequest, input.email);
      try {
        await auth.api.sendVerificationEmail({ body: { email: input.email, callbackURL: `${env.WEB_URL}/verified` }, headers: request.headers });
      } catch (error) {
        if (!isAPIError(error)) throw error;
      }
      return success(null);
    })
    /**
     * Set a password for an account that was created through a provider we no
     * longer support. The link is single use and expires in 48 hours.
     */
    .post("/api/v1/auth/set-password", async ({ body, request }) => {
      const input = setPasswordSchema.parse(body);
      await enforceRateLimit(request, env, RATE_LIMITS.passwordSetup);
      const target = await completePasswordSetup(input.token, input.password);
      return success({ email: target.email });
    })
    /**
     * Send a fresh setup link to an account that has no password yet.
     */
    .post("/api/v1/auth/request-password-setup", async ({ body, request }) => {
      const input = requestPasswordSetupSchema.parse(body);
      await enforceRateLimit(request, env, RATE_LIMITS.emailRequest);
      await enforceScopeLimit(RATE_LIMITS.emailRequest, input.email);
      const db = getDatabase();
      const [user] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.email, input.email)).limit(1);
      if (user) {
        const [credential] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential"))).limit(1);
        if (!credential) {
          const token = await issuePasswordSetupToken(user.id);
          await mailer.sendPasswordSetup({ email: user.email, name: user.name, url: passwordSetupUrl(env, token) });
        }
      }
      return success(null);
    })
    .get("/api/v1/me", async ({ request }) => {
      const actor = await getActor(request, auth, env);
      const [user] = await getDatabase().select().from(users).where(eq(users.id, actor.userId)).limit(1);
      if (!user) throw new AppError(401, "USER_NOT_FOUND", "Your user account is unavailable.");
      let organizations = await listOrganizations(user.id);
      if (!organizations.length) {
        await ensurePersonalOrganization(user.id, user.name);
        organizations = await listOrganizations(user.id);
      }
      const csrfToken = actor.extensionSessionId ? undefined : await csrfForRequest(request, auth, env);
      return success({
        user: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, createdAt: user.createdAt.toISOString() },
        organizations,
        ...(csrfToken ? { csrfToken } : {}),
      });
    });
}

/**
 * Give every account that lost its only sign-in method a working password.
 *
 * Called from a maintenance script rather than on start-up, so a deployment
 * never sends unexpected mail by accident.
 */
export async function repairAccountsWithoutPassword(env: ServerEnvironment): Promise<{ repaired: string[] }> {
  const mailer = createMailer(env);
  const targets = await findUsersWithoutPassword();
  const repaired: string[] = [];
  for (const target of targets) {
    const token = await issuePasswordSetupToken(target.userId);
    await mailer.sendPasswordSetup({ email: target.email, name: target.name, url: passwordSetupUrl(env, token) });
    repaired.push(target.email);
  }
  return { repaired };
}
