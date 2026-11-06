import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { captcha } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins";
import { haveIBeenPwned } from "better-auth/plugins";
import { getDatabase, schema } from "@data-vault/database";
import type { ServerEnvironment } from "@data-vault/config";
import { createMailer } from "../lib/mailer";
import { trustedOriginsFor } from "./origins";
import { hashPassword, verifyPassword } from "./password";

export function createAuth(env: ServerEnvironment) {
  const mailer = createMailer(env);
  return betterAuth({
    appName: "DataVault",
    baseURL: env.API_URL,
    basePath: "/api/v1/internal-auth",
    secret: env.SESSION_SECRET,
    trustedOrigins: (request) => trustedOriginsFor(request, env),
    database: drizzleAdapter(getDatabase(), {
      provider: "pg",
      schema: {
        ...schema,
        user: schema.users,
        account: schema.accounts,
        session: schema.sessions,
        verification: schema.verifications,
        twoFactor: schema.twoFactors,
      },
      usePlural: true,
    }),
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      /**
       * A session younger than this counts as "fresh". Sensitive actions ask
       * for one so a stolen long-lived cookie cannot change an email address
       * or spend credits.
       */
      freshAge: 60 * 15,
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      /**
       * The app stays usable with an unconfirmed address. Only the free AI
       * credits require a verified email, which is checked when a credit is
       * granted rather than at sign-in, so nobody is locked out of the
       * product they came for.
       */
      requireEmailVerification: false,
      password: {
        hash: hashPassword,
        verify: ({ password, hash }) => verifyPassword(password, hash),
      },      sendResetPassword: async ({ user, url }) => mailer.sendPasswordReset({ email: user.email, name: user.name, url: url.replace(env.API_URL, env.WEB_URL) }),
    },
    emailVerification: {
      /** Send the confirmation email as soon as an account is created. */
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      /**
       * The link points at the API, which verifies the token and then sends
       * the browser to the website. Only the reset link is rewritten to the
       * website, because that one is handled entirely in the browser.
       */
      sendVerificationEmail: async ({ user, url }) => mailer.sendVerificationEmail({ email: user.email, name: user.name, url }),
    },
    plugins: [
      ...(env.turnstileSecretKey && env.turnstileSiteKey ? [
        captcha({
          provider: "cloudflare-turnstile",
          secretKey: env.turnstileSecretKey,
          endpoints: ["/sign-up/email", "/sign-in/email", "/request-password-reset"],
        }),
      ] : []),
      /**
       * A one-time code sent by email, so a password is not the only way in.
       */
      emailOTP({
        async sendVerificationOTP({ email, otp }) {
          await mailer.sendOneTimeCode({ email, code: otp });
        },
        disableSignUp: true,
        otpLength: 6,
        expiresIn: 60 * 10,
      }),
      /** Optional TOTP second factor. */
      twoFactor({
        issuer: "DataVault",
        skipVerificationOnEnable: false,
        otpOptions: { digits: 6, period: 30 },
      }),
      /** Rejects passwords that appear in known breaches, without sending the password anywhere. */
      haveIBeenPwned({
        customPasswordCompromisedMessage: "This password has appeared in a data breach. Please choose a different one.",
      }),
    ],
    advanced: {
      /** The id columns are uuid, so Better Auth has to generate them as uuids. */
      database: { generateId: () => crypto.randomUUID() },
      useSecureCookies: env.NODE_ENV === "production",
    },
    rateLimit: {
      enabled: true,
      /**
       * A coarse inner safety net only. The limits that actually matter for
       * abuse live in the Postgres-backed limiter, which can key on the real
       * client address and survive a restart.
       */
      storage: "memory",
      window: 60,
      max: 100,
    },
    telemetry: { enabled: false },
  });
}

export type DataVaultAuth = ReturnType<typeof createAuth>;
