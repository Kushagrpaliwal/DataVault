# Authentication and authorization

## How people sign in

Better Auth manages email and password credentials, opaque HttpOnly SameSite session cookies, one-time codes, and optional two-factor. Passwords are hashed with Argon2id by Bun, with an explicit memory and time cost. Passwords that appear in known breaches are rejected before the account is created, using k-anonymity so the password itself is never sent anywhere.

The web client receives a session-derived CSRF token and sends it on mutations. Mutations also verify the request origin against `ALLOWED_ORIGINS`.

| Route | Purpose |
| --- | --- |
| `POST /api/v1/auth/register` | Create an account. Sends the confirmation email. |
| `POST /api/v1/auth/login` | Sign in with a password. |
| `POST /api/v1/auth/logout` | End the session. |
| `POST /api/v1/auth/forgot-password` | Send a reset link. Always reports success, so it cannot be used to find out which addresses have accounts. |
| `POST /api/v1/auth/reset-password` | Set a new password. |
| `POST /api/v1/auth/verify-email` | Resend the confirmation email. |
| `POST /api/v1/auth/set-password` | Set a password with a single-use token. |
| `POST /api/v1/auth/request-password-setup` | Request a fresh setup link. |
| `GET /api/v1/auth/methods` | Which sign-in methods this server offers. |
| `GET /api/v1/me` | The current session. |

Google sign-in was removed. Accounts that were created with Google were given a single-use password setup link instead of being deleted, so nobody lost their saved items. The maintenance script is `bun run db:repair-accounts`.

## Confirming the email address

The app works with an unconfirmed address. **Free AI credits require a confirmed one**, because a throwaway inbox is the cheapest way to farm accounts, and every confirmed account is another set of credits.

Two things protect this beyond the confirmation itself:

- **Disposable domains are rejected.** Known throwaway services are on a blocklist, and every other domain must resolve an MX record. A domain that cannot receive mail can never be confirmed, so it can never earn credits.
- **A confirmed address is not enough on its own.** Credits are also capped per user per day, and the whole product shares a daily budget that is enforced server-side.

The confirmation link points at the API, which verifies the token and then sends the browser to `/verified` on the website.

## Two-factor and one-time codes

Optional TOTP two-factor and email one-time codes are available through the Better Auth plugins. They are wired up but the settings screens for managing them are not built yet.

## Rate limiting

Two layers, because they protect different things.

**Better Auth's own limit** is a coarse in-process safety net over its internal endpoints.

**The Postgres-backed limiter** is the one that matters. It is keyed on the address the request really came from, and on the target of the request where that matters. The previous implementation lived in an in-process `Map`, which meant every restart reset every counter and no two instances shared state.

`X-Forwarded-For` is only believed when `TRUSTED_PROXY_HOPS` is greater than zero. Without a trusted proxy in front, a client could otherwise send any address it liked and walk straight past every limit.

| Policy | Limit | Window |
| --- | --- | --- |
| `signup` | 5 | 1 hour |
| `login` | 20 | 15 minutes, per address and per account |
| `internalAuth` | 30 | 1 minute |
| `extensionRefresh` | 60 | 1 minute |
| `captures` | 120 | 1 minute |
| `emailRequest` | 5 | 1 hour, per address and per account |
| `passwordSetup` | 10 | 15 minutes |
| `ai` | `AI_USER_MINUTE_REQUESTS` | 1 minute |

Renewing an extension sign-in and saving a capture have their own budgets. They used to share the sign-in budget, so saving a few items in a row could answer a renewal with a rate-limit error, and the extension then signed the user out. Only Better Auth's own endpoints and the sign-in routes use `internalAuth` now.

## Browser extension

The extension never renders a password form. It creates a PKCE verifier and challenge and uses `identity.launchWebAuthFlow` to open `/extension/authorize` on the website. After normal website authentication and workspace consent:

1. The API creates a two-minute, one-use authorization code, stored only as a hash.
2. The extension exchanges the code plus verifier.
3. The API issues a fifteen-minute signed access token and a 30-day opaque refresh token.
4. Refresh tokens rotate on every use. Reuse revokes the installation session.
5. Website settings can revoke any extension installation. Protected access stops immediately, because bearer verification checks the database session on every request.

Because the extension uses the website authorization page, it signs in with the same account as the website.

Refresh tokens are stored in extension local storage, and pending capture data uses extension storage. Server secrets, credentials, and database access never enter the extension.

### Renewing the sign-in

The popup, the side panel and the service worker all use the same stored tokens, so they can all wake up at the same moment and reach for the same refresh token. Two things keep that safe.

- **One renewal at a time.** The extension takes a `navigator.locks` lock named `datavault-auth-refresh` before it renews. Inside the lock it reads the stored tokens again. If another part of the extension has already renewed them, the fresh access token is used straight away and the server is not asked for anything.
- **A grace window on the server.** A refresh token that was used less than thirty seconds ago is reported as `REFRESH_TOKEN_STALE` rather than treated as a stolen token, and the session is left alone. Outside that window, reuse still revokes the session.

The access token is renewed a minute before it runs out, so a long session never has to wait for a request to fail first. A network error, a busy server or a rate limit keeps the sign-in and raises a retryable error; only `INVALID_REFRESH_TOKEN`, `SESSION_EXPIRED` and `REFRESH_TOKEN_REUSED` sign the user out.

### The website sign-in page

The website's sign-in pages wait for the session to be read before they decide what to do. The extension's authorization page used to redirect to the sign-in page while the session was still loading, which sent an already signed-in user to the sign-in form. The extension then waited for a connection that never came, and asked for a sign-in again. The page now says **Checking your sign-in…** while it waits, and keeps the page the user was heading for.

## RBAC

Roles are organization-scoped. Built-ins are Super Admin, Admin, Accountant, Viewer, and Custom. Permissions are granular (`payments.*`, `captures.*`, `invoices.*`, `customers.*`, `vendors.*`, `reports.read`, `users.manage`, `settings.manage`, `ai.use`). Routes resolve permissions from role joins for every protected request. UI visibility is not a security boundary.

`ai.use` is a separate permission so a workspace can be given AI features without giving it everything else.

## Production checklist

- Use long, unrelated `SESSION_SECRET` and `JWT_SECRET` values.
- Set HTTPS `API_URL`, `WEB_URL`, exact `ALLOWED_ORIGINS`, and the exact extension redirect URL.
- Set `TRUSTED_PROXY_HOPS` to the number of proxies in front of the API, and zero when there are none.
- Configure SMTP. It is required in production; in development the reset and verification mails are printed to the API console.
- Configure `TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY` to turn on the sign-up captcha. Both must be set together.
- Configure `GEMINI_API_KEY` to turn on the AI features, and set `AI_GLOBAL_DAILY_REQUESTS` to the free-tier quota shown in AI Studio.
- Store `GEMINI_API_KEY` and `TURNSTILE_SECRET_KEY` only in the API environment.
- Keep secure cookies enabled (`NODE_ENV=production`).
- Put the API behind a trusted TLS reverse proxy, and normalise forwarded client addresses there.
