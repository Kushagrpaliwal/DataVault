# Deployment

DataVault is three pieces: the **API** (Bun + Elysia), the **web app** (static files from Vite) and **PostgreSQL 17+**. `deploy/` holds a ready-made Docker setup with automatic TLS (Caddy); anything that runs a Bun process, serves static files and reaches Postgres works as well.

## 1. Prepare the settings

Copy `deploy/.env.production.example` to `deploy/.env.production` and fill it in. Generate every secret yourself:

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 48   # JWT_SECRET (must differ)
openssl rand -base64 32   # AI_KEY_ENCRYPTION_KEY (exactly 32 bytes)
```

With `NODE_ENV=production` the API **refuses to start** when a secret is a placeholder, when `API_URL`, `WEB_URL` or `ALLOWED_ORIGINS` are not https non-localhost addresses, when `SMTP_HOST` is empty, when `AI_ALLOW_PRIVATE_ENDPOINTS=true`, or when it would connect to the database as a role that bypasses row-level security. Database passwords placed in a URL must be URL-encoded; prefer long alphanumeric passwords.

`TRUSTED_PROXY_HOPS` must equal the number of reverse proxies in front of the API (the bundled Caddy is `1`). With `0`, anonymous requests share one rate-limit bucket.

## 2. Start

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build
```

The `migrate` service runs `bun run db:migrate` (migrations as the admin role, then creates and grants the unprivileged `data_vault_app` role) before the API starts. Re-run it on every upgrade; it is idempotent.

Checks: `GET /api/v1/live` (process is up), `GET /api/v1/health` (database reachable, 503 otherwise). The OpenAPI page is disabled in production.

## 3. Browser extension

1. Build with the real addresses: `VITE_API_URL=https://vault.example.org VITE_WEB_URL=https://vault.example.org bun run build:extension` (a build against localhost fails on purpose; set `ALLOW_LOCAL_BUILD=true` only for local testing).
2. Publish to the store (or pin the manifest key) to obtain a stable extension id.
3. Set `EXTENSION_REDIRECT_URL=https://<extension-id>.chromiumapp.org/data-vault-auth` on the API and restart it.

## 4. Mobile app

`MobileDataVaut` is built separately with the Sparkling CLI; set `VITE_API_URL` to the https address of the API. Release builds need your own signing configuration (Android: `keystore.properties`, ignored by git; iOS: your team in Xcode).

## 5. Operations

- Back up the `postgres` volume (`pg_dump`) and keep `AI_KEY_ENCRYPTION_KEY`; without it saved AI keys cannot be decrypted.
- Rotating `SESSION_SECRET` signs everyone out. Rotating `AI_KEY_ENCRYPTION_KEY` requires users to re-enter their AI keys.
- Logs are JSON lines on stdout. Every response carries `x-request-id`.
- The API shuts down gracefully on SIGTERM.
- CI runs typecheck, lint, tests, build and `bun audit` on every push.
