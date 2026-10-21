import { DataVaultApiClient } from "@data-vault/api-client";
import { getAuth, setAuth, type StoredAuth } from "./storage";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
export const WEB_URL = import.meta.env.VITE_WEB_URL ?? "http://localhost:5173";

/**
 * The lock every context shares while it renews the sign-in.
 *
 * The popup, the side panel and the service worker all read the same stored
 * tokens. Without a lock they would each spend the refresh token, and the
 * server would see the second use as a stolen token and revoke the session.
 */
const REFRESH_LOCK = "datavault-auth-refresh";
/** Renew a little before the access token actually runs out. */
const REFRESH_SKEW_MS = 60_000;

/**
 * The sign-in is gone for good and the user has to sign in again.
 */
class AuthExpiredError extends Error {
  constructor(public readonly code: string) {
    super("The extension sign-in has expired.");
    this.name = "AuthExpiredError";
  }
}

/**
 * Another context spent the refresh token a moment ago.
 *
 * This is not a theft, it is two parts of the extension waking up at the same
 * time. The stored tokens already hold the answer, so nothing is lost.
 */
class StaleRefreshError extends Error {
  constructor() {
    super("The sign-in was renewed by another part of the extension.");
    this.name = "StaleRefreshError";
  }
}

/** Errors that only mean "try again later". The sign-in stays valid. */
class RetryableAuthError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "RetryableAuthError";
  }
}

function extensionVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "0.0.0";
  }
}

async function performRefresh(refreshToken: string): Promise<StoredAuth> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/extension/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-extension-version": extensionVersion() },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (error) {
    throw new RetryableAuthError(error instanceof Error ? error.message : "DataVault could not be reached.");
  }

  const payload = await response.json().catch(() => undefined) as { success?: boolean; data?: StoredAuth; error?: { code?: string; message?: string } } | undefined;

  if (!response.ok || !payload?.success || !payload.data) {
    const code = payload?.error?.code;
    const message = payload?.error?.message ?? `DataVault could not renew the sign-in (${response.status}).`;
    if (code === "REFRESH_TOKEN_STALE") throw new StaleRefreshError();
    if (response.status === 401 && (code === "INVALID_REFRESH_TOKEN" || code === "SESSION_EXPIRED" || code === "REFRESH_TOKEN_REUSED")) {
      await setAuth();
      throw new AuthExpiredError(code);
    }
    // A busy server, a rate limit or a dropped connection. The sign-in is
    // still good, so it is kept and the work is put back on the queue.
    throw new RetryableAuthError(message, response.status);
  }

  const next: StoredAuth = { ...payload.data, expiresAt: Date.now() + payload.data.expiresIn * 1000 };
  await setAuth(next);
  return next;
}

/**
 * Renew the sign-in, with only one renewal happening at a time.
 *
 * Inside the lock the stored tokens are read again. If another context has
 * already renewed them, the fresh access token is returned straight away and
 * the server is not asked for anything.
 */
async function refresh(staleRefreshToken: string): Promise<string | null> {
  const run = async () => {
    const current = await getAuth();
    if (!current) return null;
    if (current.refreshToken !== staleRefreshToken) return current.accessToken;
    try {
      const next = await performRefresh(current.refreshToken);
      return next.accessToken;
    } catch (error) {
      if (error instanceof StaleRefreshError) {
        const latest = await getAuth();
        if (latest && latest.refreshToken !== staleRefreshToken) return latest.accessToken;
      }
      throw error;
    }
  };

  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(REFRESH_LOCK, run);
  }
  return run();
}

/**
 * One token provider for the whole extension.
 *
 * Sharing it means the access token is renewed ahead of time, and the renewal
 * happens once even when several calls need a token at the same moment.
 */
const tokenProvider = {
  async getAccessToken(): Promise<string | null> {
    const auth = await getAuth();
    if (!auth) return null;
    if (auth.expiresAt - Date.now() < REFRESH_SKEW_MS) {
      try {
        return await refresh(auth.refreshToken);
      } catch (error) {
        if (error instanceof AuthExpiredError) return null;
        throw error;
      }
    }
    return auth.accessToken;
  },
  async refreshAccessToken(): Promise<string | null> {
    const auth = await getAuth();
    if (!auth) return null;
    try {
      return await refresh(auth.refreshToken);
    } catch (error) {
      if (error instanceof AuthExpiredError) return null;
      throw error;
    }
  },
};

/**
 * The workspace the extension saves into.
 *
 * It is the workspace the sign-in was authorised for. The token is bound to
 * that workspace, so the extension cannot be pointed at another one, and a
 * token that was taken cannot be used against the rest of the account. To
 * work in a different workspace, the person signs in again from the website.
 */
let activeOrganizationId: string | null = null;

/**
 * A single client for the whole extension.
 *
 * One client means the internal de-duplication of a renewal works, and one
 * place decides how a request is authenticated.
 */
const sharedClient = new DataVaultApiClient({
  baseUrl: API_URL,
  organizationId: () => activeOrganizationId,
  tokenProvider,
});

export function extensionApi() {
  return sharedClient;
}

export async function withOrganization<T>(operation: (client: DataVaultApiClient) => Promise<T>) {
  const auth = await getAuth();
  if (!auth) throw new Error("Sign in to DataVault first.");
  activeOrganizationId = auth.organizationId;
  return operation(sharedClient);
}
