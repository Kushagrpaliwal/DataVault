import { browser } from "wxt/browser";
import { API_URL } from "./api";

/**
 * The address of the server, as the browser is asked for it.
 *
 * Chrome allows the extension to reach the server from the start. Firefox
 * keeps the address of the server behind a question, and the extension has
 * to ask for it before it may reach the server.
 */
const origin = `${new URL(API_URL).origin}/*`;

/**
 * Ask the browser for the address of the server.
 *
 * The question has to be asked while the click that started the work is
 * still being handled, so this is called from a button. A browser that
 * gives the address without being asked is answered at once.
 *
 * It says whether the extension may reach the server.
 */
export async function ensureServerAccess(): Promise<boolean> {
  const permissions = (browser as { permissions?: { contains: (request: { origins: string[] }) => Promise<boolean>; request: (request: { origins: string[] }) => Promise<boolean> } }).permissions;
  if (!permissions) return true;
  try {
    if (await permissions.contains({ origins: [origin] })) return true;
    return await permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}
