import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { SignJWT } from "jose";
import { extensionAuthCodes, extensionRefreshTokens, extensionSessions, getDatabase, organizationMembers } from "@data-vault/database";
import type { ServerEnvironment } from "@data-vault/config";
import type { ExtensionTokenSet } from "@data-vault/types";
import { AppError } from "../lib/errors";
import { pkceChallenge, randomToken, sha256 } from "../lib/crypto";

function validateRedirect(env: ServerEnvironment, redirectUri: string) {
  if (redirectUri === env.EXTENSION_REDIRECT_URL) return;
  if (env.NODE_ENV !== "production" && /^https:\/\/[a-p]{32}\.chromiumapp\.org\/data-vault-auth$/.test(redirectUri)) return;
  throw new AppError(400, "INVALID_EXTENSION_REDIRECT", "The extension redirect URL is not registered.");
}

/**
 * How long a refresh token stays "just used" rather than "stolen".
 *
 * The popup, the side panel and the service worker can all wake up together
 * and reach for the same refresh token. Inside this window that is treated as
 * a harmless overlap instead of a stolen token, so the session survives.
 */
const REFRESH_GRACE_MS = 30_000;

async function signAccessToken(env: ServerEnvironment, userId: string, sessionId: string, organizationId: string) {
  /**
   * The workspace is in the token itself, so the token only works for the
   * workspace it was authorised for. Without it, a token that was taken
   * could be used against any workspace the person happens to be in.
   */
  return new SignJWT({ sid: sessionId, org: organizationId }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(userId).setIssuer(env.API_URL).setAudience("data-vault-extension").setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(env.JWT_SECRET));
}

export function startExtensionAuthorization(env: ServerEnvironment, input: { redirectUri: string; codeChallenge: string; state: string }) {
  validateRedirect(env, input.redirectUri);
  const query = new URLSearchParams(input);
  return { authorizationUrl: `${env.WEB_URL}/extension/authorize?${query.toString()}` };
}

export async function approveExtensionAuthorization(env: ServerEnvironment, userId: string, input: { organizationId: string; redirectUri: string; codeChallenge: string; state: string }) {
  validateRedirect(env, input.redirectUri);
  const db = getDatabase();
  const [membership] = await db.select({ id: organizationMembers.id }).from(organizationMembers).where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.organizationId, input.organizationId), eq(organizationMembers.status, "active"))).limit(1);
  if (!membership) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED", "You cannot authorize this workspace.");
  const code = randomToken(32);
  await db.insert(extensionAuthCodes).values({ codeHash: await sha256(code), userId, organizationId: input.organizationId, codeChallenge: input.codeChallenge, redirectUri: input.redirectUri, expiresAt: new Date(Date.now() + 2 * 60_000) });
  const redirect = new URL(input.redirectUri);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", input.state);
  return { redirectUrl: redirect.toString() };
}

export async function exchangeExtensionCode(env: ServerEnvironment, request: Request, input: { code: string; codeVerifier: string; redirectUri: string }): Promise<ExtensionTokenSet> {
  validateRedirect(env, input.redirectUri);
  const db = getDatabase();
  const codeHash = await sha256(input.code);
  return db.transaction(async (tx) => {
    const [code] = await tx.select().from(extensionAuthCodes).where(and(eq(extensionAuthCodes.codeHash, codeHash), eq(extensionAuthCodes.redirectUri, input.redirectUri), isNull(extensionAuthCodes.usedAt), gt(extensionAuthCodes.expiresAt, new Date()))).for("update").limit(1);
    if (!code || await pkceChallenge(input.codeVerifier) !== code.codeChallenge) throw new AppError(400, "INVALID_AUTHORIZATION_CODE", "This sign-in link is invalid or has expired.");
    await tx.update(extensionAuthCodes).set({ usedAt: new Date() }).where(eq(extensionAuthCodes.id, code.id));
    const [session] = await tx.insert(extensionSessions).values({ userId: code.userId, organizationId: code.organizationId, userAgent: request.headers.get("user-agent"), extensionVersion: request.headers.get("x-extension-version"), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000) }).returning();
    if (!session) throw new Error("Extension session insert failed");
    const refreshToken = randomToken(48);
    await tx.insert(extensionRefreshTokens).values({ sessionId: session.id, tokenHash: await sha256(refreshToken), expiresAt: session.expiresAt });
    return { accessToken: await signAccessToken(env, session.userId, session.id, session.organizationId), refreshToken, expiresIn: 900, sessionId: session.id, organizationId: session.organizationId };
  });
}

export async function refreshExtensionSession(env: ServerEnvironment, refreshToken: string): Promise<ExtensionTokenSet> {
  const db = getDatabase();
  const tokenHash = await sha256(refreshToken);
  return db.transaction(async (tx) => {
    const [token] = await tx.select().from(extensionRefreshTokens).where(eq(extensionRefreshTokens.tokenHash, tokenHash)).for("update").limit(1);
    if (!token) throw new AppError(401, "INVALID_REFRESH_TOKEN", "Please sign in to the extension again.");
    const [session] = await tx.select().from(extensionSessions).where(eq(extensionSessions.id, token.sessionId)).limit(1);
    if (!session || session.revokedAt || session.expiresAt <= new Date() || token.revokedAt || token.expiresAt <= new Date()) throw new AppError(401, "SESSION_EXPIRED", "Your extension session has expired.");
    if (token.consumedAt) {
      /**
       * A refresh token that was used a moment ago is almost always another
       * part of the extension waking up at the same time. It is reported as
       * stale, so the client can read the tokens the other part stored, and
       * the session is left alone.
       */
      const usedAgo = Date.now() - token.consumedAt.getTime();
      if (usedAgo >= 0 && usedAgo < REFRESH_GRACE_MS) {
        throw new AppError(401, "REFRESH_TOKEN_STALE", "The sign-in was renewed a moment ago. Please try again.");
      }
      await tx.update(extensionSessions).set({ revokedAt: new Date() }).where(eq(extensionSessions.id, session.id));
      await tx.update(extensionRefreshTokens).set({ revokedAt: new Date() }).where(eq(extensionRefreshTokens.sessionId, session.id));
      throw new AppError(401, "REFRESH_TOKEN_REUSED", "This extension session was revoked for safety.");
    }
    const nextRefresh = randomToken(48);
    const [replacement] = await tx.insert(extensionRefreshTokens).values({ sessionId: session.id, tokenHash: await sha256(nextRefresh), expiresAt: session.expiresAt }).returning();
    await tx.update(extensionRefreshTokens).set({ consumedAt: new Date(), replacedById: replacement?.id }).where(eq(extensionRefreshTokens.id, token.id));
    await tx.update(extensionSessions).set({ lastUsedAt: new Date() }).where(eq(extensionSessions.id, session.id));
    return { accessToken: await signAccessToken(env, session.userId, session.id, session.organizationId), refreshToken: nextRefresh, expiresIn: 900, sessionId: session.id, organizationId: session.organizationId };
  });
}

export async function listExtensionSessions(userId: string) {
  const rows = await getDatabase().select().from(extensionSessions).where(and(eq(extensionSessions.userId, userId), isNull(extensionSessions.revokedAt))).orderBy(desc(extensionSessions.lastUsedAt));
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt.toISOString(), expiresAt: row.expiresAt.toISOString() }));
}

export async function revokeExtensionSession(userId: string, sessionId: string) {
  const db = getDatabase();
  const [session] = await db.update(extensionSessions).set({ revokedAt: new Date() }).where(and(eq(extensionSessions.id, sessionId), eq(extensionSessions.userId, userId), isNull(extensionSessions.revokedAt))).returning();
  if (!session) throw new AppError(404, "EXTENSION_SESSION_NOT_FOUND", "Extension session could not be found.");
  await db.update(extensionRefreshTokens).set({ revokedAt: new Date() }).where(eq(extensionRefreshTokens.sessionId, sessionId));
}

export async function logoutExtensionSession(refreshToken: string) {
  const db = getDatabase();
  const tokenHash = await sha256(refreshToken);
  await db.transaction(async (tx) => {
    const [token] = await tx.select().from(extensionRefreshTokens).where(eq(extensionRefreshTokens.tokenHash, tokenHash)).limit(1);
    if (!token) return;
    await tx.update(extensionSessions).set({ revokedAt: new Date() }).where(eq(extensionSessions.id, token.sessionId));
    await tx.update(extensionRefreshTokens).set({ revokedAt: new Date() }).where(eq(extensionRefreshTokens.sessionId, token.sessionId));
  });
}
