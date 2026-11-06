# Security notes

## Model
Every request is authenticated (cookie session + CSRF token for the web app, short-lived bearer tokens with rotating refresh tokens for the extension). Data is scoped to a workspace in the application and again by PostgreSQL row-level security; the API must connect as the unprivileged `data_vault_app` role, and production refuses to start otherwise.

## Controls
- Password rules with breach check, optional TOTP 2FA, Turnstile on sign-up, disposable-address rejection, Postgres-backed rate limits.
- The email one-time-code endpoints of Better Auth are closed (they bypassed 2FA and sign-up checks).
- Security headers on every API response (nosniff, frame deny, no-referrer, HSTS in production, CORP). Saved page snapshots are served sandboxed with a strict CSP.
- User-chosen AI endpoints: https only, public addresses only, redirects not followed, keys encrypted with AES-256-GCM bound to user, connection and host. AI responses are not shared across users.
- Imports are size-limited and parsed with bounded patterns; CSV exports neutralise spreadsheet formulas.
- Extension: minimal host permissions, PKCE sign-in, messages accepted only from the extension itself.
- Production configuration is validated at startup (see `docs/deployment.md`).

## Known limitations
- `bun audit` still reports a few advisories in **development-only** tooling (brace-expansion via eslint/minimatch, esbuild via drizzle-kit/wxt). They are not part of any shipped artifact.
- With `TRUSTED_PROXY_HOPS=0` anonymous rate limits are shared; run behind a proxy and set it.
- Extension sessions are not yet revoked when a password is changed through Better Auth's own reset flow (password *setup* links do revoke them).
- The extension sign-in page approves immediately; a consent screen is planned.
- The mobile app has no native secure storage module yet; it keeps only a cookie session.

Report vulnerabilities privately to the maintainer rather than in a public issue.
