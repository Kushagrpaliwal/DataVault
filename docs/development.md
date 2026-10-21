# Development

## Environment

Copy `.env.example` to `.env`. Required values are `DATABASE_URL`, `SESSION_SECRET`, `JWT_SECRET`, `API_URL`, `WEB_URL`, `ALLOWED_ORIGINS`, and `EXTENSION_REDIRECT_URL`. Never commit `.env`; it is ignored.

The bootstrap script connects through `DATABASE_ADMIN_URL` only to create a missing local database. Normal API traffic uses `DATABASE_URL`.

## Workflow

```bash
bun install
bun run db:migrate
bun run dev
```

Run clients individually with `dev:web`, `dev:api`, or `dev:extension`. WXT hot-reload may require reloading the unpacked extension after manifest/background changes.

The ports are intentionally separate: API `3000`, web `5173`, and WXT `3002`. Do not point the website at the WXT port.

## Quality gates

After schema/API/shared contract changes, run:

```bash
bun run db:check
bun run typecheck
bun run lint
bun run test
bun run build
```

For the browser smoke check, keep the API and web app running, set `SMOKE_EMAIL` and `SMOKE_PASSWORD` to a real account, and execute `bun run smoke:web`. It signs in through the UI and verifies the Overview, Saved, Organize, and Settings pages, plus the legacy route redirects, using headless Chrome.

Business tests use the actual Elysia application and PostgreSQL schema. Test-created organizations use unique slugs and remain useful for inspecting audit/tenancy behavior. A dedicated `TEST_DATABASE_URL` is included for CI isolation when the runner provisions and migrates that database.

## Adding features

- Put validation/enums in `packages/schemas` before implementing clients.
- Add transport types in `packages/types`, endpoint calls in `packages/api-client`, domain logic in API services, and thin route handlers last.
- All organization-owned queries must validate membership and include organization predicates inside `withTenant`.
- Use `Decimal` helpers for money; never use floats for authoritative values.
- Create audit logs for important mutations and archive financial data instead of deleting it.
- Add an idempotency scope to critical writes.
- Keep capture extraction behind `CaptureExtractor`; do not place regex or future AI calls in React components.

## Generated brand asset

`apps/web/public/data-vault-clay.png` is an original generated asset used by the authentication UI. Its generation prompt and tool mode are recorded in the implementation handoff.
