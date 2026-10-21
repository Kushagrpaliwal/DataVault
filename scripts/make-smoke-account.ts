/**
 * Make a throwaway account for the web smoke test.
 *
 * The account is real enough to sign in with, and it is removed afterwards
 * so the database is left as it was found.
 */
export {};

const base = process.env.SMOKE_API_URL ?? "http://localhost:3000";
const webOrigin = process.env.WEB_URL ?? "http://localhost:5173";
const email = process.env.SMOKE_EMAIL ?? `smoke-${crypto.randomUUID().slice(0, 8)}@example.com`;
const password = process.env.SMOKE_PASSWORD ?? `Smoke-${crypto.randomUUID().slice(0, 8)}-Aa1`;

const response = await fetch(`${base}/api/v1/auth/register`, {
  method: "POST",
  headers: { origin: webOrigin, "content-type": "application/json" },
  body: JSON.stringify({ name: "Smoke Test", email, password }),
});
const payload = await response.json() as { success: boolean; data?: { user?: { id: string } }; error?: { code: string; message: string } };
if (!response.ok) {
  console.error(JSON.stringify({ status: response.status, error: payload.error }));
  process.exit(1);
}
console.log(JSON.stringify({ email, password, userId: payload.data?.user?.id }));
