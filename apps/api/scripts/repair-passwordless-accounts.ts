import { and, eq } from "drizzle-orm";
import { accounts, getDatabase } from "@data-vault/database";
import { getServerEnvironment } from "@data-vault/config";
import { createMailer } from "../src/lib/mailer";
import { findUsersWithoutPassword, issuePasswordSetupToken, passwordSetupUrl } from "../src/auth/password-setup";

/**
 * Give every account that lost its only sign-in method a working password.
 *
 * When Google sign-in was removed, accounts that were created with Google had
 * no credential to sign in with. Rather than deleting those users and their
 * saved items, this issues each one a single-use link that sets a password,
 * and removes the now-useless provider account row.
 *
 * The link is only sent to the address already on the account, so this cannot
 * be used to reach anyone else's account.
 */
const env = getServerEnvironment();
const mailer = createMailer(env);
const db = getDatabase();

const targets = await findUsersWithoutPassword();
const report: { email: string; linked: boolean; cleaned: boolean }[] = [];

for (const target of targets) {
  const token = await issuePasswordSetupToken(target.userId);
  await mailer.sendPasswordSetup({
    email: target.email,
    name: target.name,
    url: passwordSetupUrl(env, token),
  });

  const providerAccounts = await db
    .select({ id: accounts.id, providerId: accounts.providerId })
    .from(accounts)
    .where(eq(accounts.userId, target.userId));
  const removable = providerAccounts.filter((row) => row.providerId !== "credential");
  if (removable.length) {
    await db.delete(accounts).where(and(eq(accounts.userId, target.userId)));
  }

  report.push({ email: target.email, linked: true, cleaned: removable.length > 0 });
}

console.log(JSON.stringify({ repaired: report.length, accounts: report }, null, 2));
process.exit(0);
