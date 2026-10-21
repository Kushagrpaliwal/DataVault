import { resolveMx } from "node:dns/promises";

/**
 * Domains that hand out throwaway inboxes.
 *
 * A disposable inbox is the cheapest way to farm accounts, and every account
 * that can be verified with one is another set of free AI credits. The list
 * below covers the services that are actually used for this; it is a first
 * filter, not the only one.
 */
const DISPOSABLE_DOMAINS = new Set([
  "0-mail.com", "10minutemail.com", "10minutemail.net", "20minutemail.com", "33mail.com",
  "anonaddy.com", "anonaddy.me", "binkmail.com", "bobmail.info", "bugmenot.com",
  "burnermail.io", "cool.fr.nf", "correotemporal.org", "curryworld.de", "dayrep.com",
  "discard.email", "discardmail.com", "dispostable.com", "dropmail.me", "einrot.com",
  "email-fake.com", "emailondeck.com", "emailtemporanea.com", "emailtemporar.ro", "emltmp.com",
  "fakeinbox.com", "fakemail.net", "fakemailgenerator.com", "fastmailbox.net", "filzmail.com",
  "fleckens.hu", "forgetmail.com", "getairmail.com", "getnada.com", "gishpuppy.com",
  "guerrillamail.biz", "guerrillamail.com", "guerrillamail.de", "guerrillamail.net", "guerrillamail.org",
  "harakirimail.com", "hidemail.de", "inboxbear.com", "inboxkitten.com", "jetable.org",
  "mail-temp.com", "mail7.io", "mailcatch.com", "maildrop.cc", "maildu.de", "mailexpire.com",
  "mailinator.com", "mailnesia.com", "mailnull.com", "mailsac.com", "mailtemp.info",
  "mailtothis.com", "mintemail.com", "mohmal.com", "mytemp.email", "nowmymail.com",
  "one-time.email", "opayq.com", "pokemail.net", "protonmail.ch", "rcpt.at",
  "rhyta.com", "sharklasers.com", "shieldedmail.com", "sogetthis.com", "spam4.me",
  "spamavert.com", "spamgourmet.com", "spamhole.com", "temp-mail.org", "tempail.com",
  "tempe4mail.com", "tempemail.com", "tempemail.net", "tempmail.dev", "tempmail.net",
  "tempmail.plus", "tempmailo.com", "tempr.email", "temporary-mail.net", "temporaryemail.net",
  "throwawaymail.com", "trashmail.com", "trashmail.de", "trashmail.net", "trashmail.ws",
  "yopmail.com", "yopmail.fr", "yopmail.net", "zetmail.com",
]);

/** Provider domains that are always legitimate. */
const ALLOWED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "tutanota.com", "zoho.com", "fastmail.com",
  "hey.com", "gmx.com", "gmx.de", "mail.com", "aol.com", "yandex.com", "duck.com",
]);

export type DisposableEmailVerdict = "allowed" | "blocked" | "unknown";

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

/** A quick, synchronous check against the curated lists. */
export function classifyEmailDomain(email: string): DisposableEmailVerdict {
  const domain = emailDomain(email);
  if (!domain) return "unknown";
  if (ALLOWED_DOMAINS.has(domain)) return "allowed";
  if (DISPOSABLE_DOMAINS.has(domain)) return "blocked";
  return "unknown";
}

const mxCache = new Map<string, { verdict: DisposableEmailVerdict; expiresAt: number }>();
const MX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Confirm the domain can actually receive mail.
 *
 * A domain with no MX record cannot receive a verification email, so it can
 * never be verified, and therefore can never earn credits. This catches the
 * long tail of throwaway services that are not on the list above.
 */
export async function hasMailbox(email: string): Promise<DisposableEmailVerdict> {
  const domain = emailDomain(email);
  if (!domain) return "unknown";
  const cached = mxCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return cached.verdict;

  let verdict: DisposableEmailVerdict;
  try {
    const records = await resolveMx(domain);
    verdict = records.length > 0 ? "allowed" : "blocked";
  } catch {
    // NXDOMAIN means the domain does not exist at all.
    verdict = "blocked";
  }
  mxCache.set(domain, { verdict, expiresAt: Date.now() + MX_CACHE_TTL_MS });
  return verdict;
}

/**
 * The full check used before credits are granted.
 *
 * Known-good providers short-circuit. Everything else must resolve an MX
 * record, which rules out the overwhelming majority of disposable inboxes.
 */
export async function canReceiveVerification(email: string): Promise<boolean> {
  const quick = classifyEmailDomain(email);
  if (quick === "allowed") return true;
  if (quick === "blocked") return false;
  return (await hasMailbox(email)) !== "blocked";
}
