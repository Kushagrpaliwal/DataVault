import { browser } from "wxt/browser";
import { DataVaultApiClient } from "@data-vault/api-client";
import { API_URL } from "./api";
import { getAuth, setAuth } from "./storage";

function randomBase64Url(bytes: number) { const data = crypto.getRandomValues(new Uint8Array(bytes)); return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
async function challenge(verifier: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)); return btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }

export async function signInExtension() {
  const redirectUri = browser.identity.getRedirectURL("data-vault-auth"); const codeVerifier = randomBase64Url(48); const state = randomBase64Url(32);
  const client = new DataVaultApiClient({ baseUrl: API_URL }); const started = await client.extensionStart({ redirectUri, codeChallenge: await challenge(codeVerifier), state });
  const callback = await browser.identity.launchWebAuthFlow({ url: started.authorizationUrl, interactive: true });
  if (!callback) throw new Error("DataVault sign-in was cancelled."); const url = new URL(callback); if (url.searchParams.get("state") !== state) throw new Error("The authorization response could not be verified."); const code = url.searchParams.get("code"); if (!code) throw new Error("DataVault did not return an authorization code.");
  const tokens = await client.extensionExchange({ code, codeVerifier, redirectUri }); await setAuth({ ...tokens, expiresAt: Date.now() + tokens.expiresIn * 1000 }); return tokens;
}

export async function signOutExtension() { const auth = await getAuth(); if (auth) { try { await fetch(`${API_URL}/api/v1/extension/auth/logout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: auth.refreshToken }) }); } catch { /* local sign-out still applies */ } } await setAuth(); }
