import { AppError } from "./errors";

/**
 * The keys people bring themselves.
 *
 * A key is a secret that belongs to one person, so it is held encrypted
 * with a key the server has and nobody else has. The cipher is AES-256-GCM,
 * which is authenticated, so a ciphertext that has been changed is refused
 * rather than quietly read.
 *
 * The text that is stored is `v1:<iv>:<ciphertext>`, with the two parts
 * written as base64. The version is there so that the way the key is held
 * can be changed later without guessing which way a row was written.
 */

/**
 * The data that is tied to a ciphertext.
 *
 * It is the person and the connection, so a ciphertext that is taken from
 * one row and put in another cannot be read, and a connection cannot be
 * moved to another person by changing the row it is in.
 */
function associatedData(userId: string, connectionId: string): Uint8Array {
  return new TextEncoder().encode(`${userId}:${connectionId}`);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

/**
 * Encrypt a key.
 *
 * A fresh nonce is used every time, so the same key never looks the same
 * twice, and the person and the connection are tied to the ciphertext.
 */
export async function sealSecret(masterKey: Uint8Array, userId: string, connectionId: string, secret: string): Promise<string> {
  if (masterKey.length !== 32) throw new AppError(500, "AI_KEYS_UNAVAILABLE", "The server cannot hold the keys of the users right now.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", masterKey as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    iv: iv as BufferSource,
    additionalData: associatedData(userId, connectionId) as BufferSource,
    name: "AES-GCM",
  }, key, new TextEncoder().encode(secret) as BufferSource));
  return `v1:${toBase64(iv)}:${toBase64(ciphertext)}`;
}

/**
 * Read a key back.
 *
 * The ciphertext is only read when it belongs to this person and this
 * connection, and it is refused when it has been changed.
 */
export async function openSecret(masterKey: Uint8Array, userId: string, connectionId: string, sealed: string): Promise<string> {
  if (masterKey.length !== 32) throw new AppError(500, "AI_KEYS_UNAVAILABLE", "The server cannot hold the keys of the users right now.");
  const parts = sealed.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") throw new AppError(500, "AI_KEY_UNREADABLE", "The stored key could not be read.");
  try {
    const key = await crypto.subtle.importKey("raw", masterKey as BufferSource, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({
      iv: fromBase64(parts[1]!) as BufferSource,
      additionalData: associatedData(userId, connectionId) as BufferSource,
      name: "AES-GCM",
    }, key, fromBase64(parts[2]!) as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    /**
     * The key is not the one this row was written with, or the ciphertext
     * has been changed. Either way it is not read.
     */
    throw new AppError(500, "AI_KEY_UNREADABLE", "The stored key could not be read.");
  }
}

/**
 * The last four of a key.
 *
 * It is enough for a person to tell two of their keys apart, and it is not
 * enough to use one.
 */
export function keyHint(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) return "";
  return trimmed.slice(-4);
}
