import { and, eq, gt } from "drizzle-orm";
import { accounts, extensionRefreshTokens, extensionSessions, getDatabase, sessions, users, verifications } from "@data-vault/database";
import type { ServerEnvironment } from "@data-vault/config";
import { AppError } from "../lib/errors";
import { randomToken, sha256 } from "../lib/crypto";
import { hashPassword } from "./password";

const SETUP_IDENTIFIER = "password-setup";
const SETUP_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Password setup for accounts that were created through a provider we no
 * longer support.
 *
 * Removing Google sign-in would otherwise lock those users out, because they
 * have an account row but no credential to sign in with. Instead of deleting
 * them, the account is issued a single-use link that sets a password.
 */
export async function issuePasswordSetupToken(userId: string): Promise<string> {
  const token = randomToken(32);
  const db = getDatabase();
  await db
    .insert(verifications)
    .values({ identifier: `${SETUP_IDENTIFIER}:${userId}`, value: await sha256(token), expiresAt: new Date(Date.now() + SETUP_TTL_MS) });
  return token;
}

export interface PasswordSetupTarget {
  userId: string;
  email: string;
  name: string;
}

/** Find the account a setup token belongs to, if the token is still valid. */
export async function resolvePasswordSetupToken(token: string): Promise<PasswordSetupTarget | undefined> {
  const hashed = await sha256(token);
  const db = getDatabase();
  const [row] = await db
    .select({ identifier: verifications.identifier, expiresAt: verifications.expiresAt })
    .from(verifications)
    .where(and(eq(verifications.value, hashed), gt(verifications.expiresAt, new Date())))
    .limit(1);
  if (!row) return undefined;
  const userId = row.identifier.startsWith(`${SETUP_IDENTIFIER}:`) ? row.identifier.slice(SETUP_IDENTIFIER.length + 1) : "";
  if (!userId) return undefined;
  const [user] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return undefined;
  return { userId: user.id, email: user.email, name: user.name };
}

/** Consume the token and record the new password. */
export async function completePasswordSetup(token: string, password: string): Promise<PasswordSetupTarget> {
  const target = await resolvePasswordSetupToken(token);
  if (!target) throw new AppError(400, "INVALID_SETUP_TOKEN", "This setup link is invalid or has expired. Request a new one.");
  const db = getDatabase();
  const hashed = await hashPassword(password);
  const [credential] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, target.userId), eq(accounts.providerId, "credential")))
    .limit(1);
  if (credential) {
    await db.update(accounts).set({ password: hashed }).where(eq(accounts.id, credential.id));
  } else {
    await db.insert(accounts).values({ accountId: target.userId, providerId: "credential", userId: target.userId, password: hashed });
  }
  // Every setup link for this account stops working, not only the one used.
  await db.delete(verifications).where(eq(verifications.identifier, `${SETUP_IDENTIFIER}:${target.userId}`));
  // A new password signs every other device out, the extension included.
  await db.delete(sessions).where(eq(sessions.userId, target.userId));
  const revokedAt = new Date();
  const extension = await db.update(extensionSessions).set({ revokedAt }).where(eq(extensionSessions.userId, target.userId)).returning({ id: extensionSessions.id });
  for (const { id } of extension) {
    await db.update(extensionRefreshTokens).set({ revokedAt }).where(eq(extensionRefreshTokens.sessionId, id));
  }
  return target;
}

/** Every user that can sign in but has no password to sign in with. */
export async function findUsersWithoutPassword(): Promise<PasswordSetupTarget[]> {
  const db = getDatabase();
  const credentialRows = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(eq(accounts.providerId, "credential"));
  const withCredential = new Set(credentialRows.map((row) => row.userId));
  const allUsers = await db.select({ id: users.id, email: users.email, name: users.name }).from(users);
  return allUsers
    .filter((user) => !withCredential.has(user.id))
    .map((user) => ({ userId: user.id, email: user.email, name: user.name }));
}

/** The web page a setup link should point at. */
export function passwordSetupUrl(env: ServerEnvironment, token: string): string {
  return `${env.WEB_URL}/set-password?token=${encodeURIComponent(token)}`;
}
