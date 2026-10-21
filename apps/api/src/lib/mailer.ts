import nodemailer from "nodemailer";
import type { ServerEnvironment } from "@data-vault/config";

export interface Mailer {
  sendPasswordReset(input: { email: string; name: string; url: string }): Promise<void>;
  sendVerificationEmail(input: { email: string; name: string; url: string }): Promise<void>;
  sendPasswordSetup(input: { email: string; name: string; url: string }): Promise<void>;
  sendOneTimeCode(input: { email: string; code: string }): Promise<void>;
  sendWelcome(input: { email: string; name: string }): Promise<void>;
}

export function createMailer(env: ServerEnvironment): Mailer {
  const mailer = createTransport(env);
  return {
    async sendPasswordReset({ email, name, url }) {
      await mailer.send({
        to: email,
        subject: "Reset your DataVault password",
        text: `Hi ${name},\n\nReset your password: ${url}\n\nThis link expires shortly. If you did not request it, you can ignore this email.`,
      });
    },
    async sendVerificationEmail({ email, name, url }) {
      await mailer.send({
        to: email,
        subject: "Confirm your email address",
        text: `Hi ${name},\n\nConfirm your email address to unlock your AI credits: ${url}\n\nYou can still use DataVault without confirming, but AI credits stay locked until you do. If you did not create an account, ignore this email.`,
      });
    },
    async sendPasswordSetup({ email, name, url }) {
      await mailer.send({
        to: email,
        subject: "Set your DataVault password",
        text: `Hi ${name},\n\nYour DataVault account needs a password so you can sign in: ${url}\n\nThis link expires in 48 hours. If you did not request it, you can ignore this email.`,
      });
    },
    async sendOneTimeCode({ email, code }) {
      await mailer.send({
        to: email,
        subject: "Your DataVault sign-in code",
        text: `Your DataVault sign-in code is ${code}\n\nIt expires in 10 minutes. If you did not request it, you can ignore this email.`,
      });
    },
    async sendWelcome({ email, name }) {
      await mailer.send({
        to: email,
        subject: "Welcome to DataVault",
        text: `Hi ${name},\n\nDataVault is ready. Save anything from the web with the browser extension, then find it again here.\n\nConfirm your email address to unlock your free AI credits.`,
      });
    },
  };
}

function createTransport(env: ServerEnvironment) {
  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === "production") throw new Error("SMTP_HOST is required in production");
    return {
      async send(input: { to: string; subject: string; text: string }) {
        console.info(JSON.stringify({ level: "info", event: `development_email_${input.subject.toLowerCase().replace(/[^a-z]+/g, "_")}`, email: input.to, text: input.text }));
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.smtpSecure,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } } : {}),
  });
  return {
    async send(input: { to: string; subject: string; text: string }) {
      await transport.sendMail({ from: env.SMTP_FROM, ...input });
    },
  };
}
