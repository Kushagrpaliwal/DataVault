# DataVault

DataVault is a production-oriented, multi-tenant web-clipping memory system. A React web application and a Chrome/Edge extension use the same Bun + Elysia REST API and the same PostgreSQL database, so saved items, edits, searches, and session revocations are immediately consistent across both clients.

The web app has four destinations:

| Page | What it is for |
| --- | --- |
| **Overview** | How much you have saved, where it came from, and how to get started. |
| **Saved** | Everything you have saved, with nested folders and tags as filters. |
| **Docs** | Long-form notes, written like a document and fed by the browser. |
| **Settings** | Your account, sign-in methods, AI keys, and connected browsers. |

## Stack

- Web: React 19, TypeScript, Vite, React Router, Tailwind CSS, shadcn-style shared primitives, TanStack Query, React Hook Form, Zod, date-fns, Lucide, Tiptap v3
- Extension: WXT, React, Manifest V3, background service worker, popup, Chrome side panel, context menus, keyboard commands, extension storage
- API: Bun, Elysia, Better Auth, Zod, Drizzle ORM, PostgreSQL
- AI: Gemini (`gemini-3.1-flash-lite` on the free tier), called only from the server
- Shared workspaces: types, schemas, typed API client, deterministic capture parser, shared doc schema, UI primitives, config, and database package

## Signing in

Email and password, with optional two-factor and one-time codes. Google sign-in was removed.

The app works with an unconfirmed address, but **free AI credits need a confirmed one**. Disposable email domains are rejected, every domain must resolve an MX record, and sign-up, sign-in, and email requests are rate limited against a Postgres-backed counter that survives restarts. See [authentication](docs/auth.md).

## Free AI credits

Every confirmed user gets a daily allowance of AI credits for summarising a saved item, suggesting its type and tags, and pulling out its details. Credits come back when the day rolls over at midnight Pacific, which is the same moment the Gemini free-tier quota resets.

The Gemini key never leaves the server. Answers are cached, so the same request never costs a second credit. See [AI features and free credits](docs/ai.md).

## Docs

**Docs** are long-form notes, written like a document and fed by the browser. The editor on the website has the full set of tools you would expect: headings, fonts, sizes, colours, lists, checklists, tables, quotes, code, links, images, a slash menu, a drag handle for reordering, and an outline of the headings.

Select text on any page and press `Alt+Shift+D`. The piece goes straight into the current doc, with its formatting kept. No right-click, no review panel, no popup. Press `Alt+Shift+D` again on another page and the piece goes into the same doc under a new section. Press `Alt+Shift+F` to start a fresh doc, and the pieces that follow go into it.

Pieces are arranged by page by default. A doc can be arranged by website or by day instead, **Organize with AI** sorts the whole doc into topics, and **Write it up as sentences** turns the pieces into writing — sentences that follow each other, grouped into paragraphs. Both show you what they would do before they do it, and the earlier version is kept so you can undo it. The doc can be exported as Markdown or HTML, printed to PDF, and put back to an earlier version.

The extension keeps working on the same doc: the side panel has a **Docs** tab that shows the current doc, adds a quick note, and lets you choose which doc is current.

## Repository layout

```text
apps/
  api/          Bun + Elysia REST API
  web/          React/Vite dashboard
  extension/    WXT Chromium extension
packages/
  api-client/   shared authenticated REST client
  capture-parser/
  config/
  database/     Drizzle schema and migrations
  notes/        shared doc schema, arranger, and Markdown export
  schemas/      shared Zod schemas and constants
  types/
  ui/
docs/
```

## Local setup

Requirements: Bun 1.4+, PostgreSQL 17+ (or Docker), and Chrome, Edge, or another Chromium browser.

```bash
cp .env.example .env
bun install
bun run db:migrate
bun run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`. Update `DATABASE_URL` and `DATABASE_ADMIN_URL` before migrating. The local database in this workspace is configured on port `5432`; credentials remain only in the ignored `.env` file.

`bun dev` starts the API, web app, and WXT development process. It uses ports 5173, 3000, and 3002 by default, automatically choosing the next available port when one is busy and printing the resolved URLs.

Create a real account at `http://localhost:5173/register`, then create your first workspace. The same account is used by the web app and extension.

## Commands

```bash
bun run dev
bun run dev:web
bun run dev:api
bun run dev:extension
bun run build
bun run build:web
bun run build:api
bun run build:extension
bun run test
bun run smoke:web
bun run lint
bun run typecheck
bun run db:generate
bun run db:migrate
bun run db:bootstrap
bun run db:check
```

## Extension installation

1. Run `bun run dev:extension`, or build with `bun run build:extension`.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer Mode.
4. Choose **Load unpacked**.
5. Select `apps/extension/.output/chrome-mv3`.
6. Open DataVault and choose **Sign in**. Authentication happens in the DataVault website; the extension never receives a password.
7. Highlight any text on an ordinary webpage.
8. Right-click and choose **Save to DataVault**.
9. Review the parsed fields in the side panel and choose **Save**.

The popup offers the same two actions directly: **Save this page** and **Save highlighted text**. Turn on **Save without reviewing** to save highlighted text immediately instead of opening the review panel. The context-menu label never changes, so it always behaves the same way.

The extension keeps failed quick saves in a durable local retry queue, and retries them every five minutes. Items that are waiting for the connection show up under **Waiting to sync** in the side panel, where they can be retried or thrown away. Explicit review captures stay pending until the user confirms them, and each confirmed save creates a new saved item even when the source text matches an earlier capture. Deleting a saved item moves it to recoverable Trash; restore it from the **Saved** page on the website.

The extension also has two keyboard shortcuts. `Alt+Shift+D` adds the selected text to the current doc, and `Alt+Shift+F` starts a new one. The keys can be changed on the browser's own shortcut page; the popup and the side panel show the keys that are actually bound.

For a stable production extension ID, configure the Chromium manifest key or store identity, set `EXTENSION_REDIRECT_URL` to `https://<extension-id>.chromiumapp.org/data-vault-auth`, and rebuild. See [docs/extension.md](docs/extension.md).

## Optional Docker database

```bash
docker compose up -d postgres
```

Redis is defined behind the optional `redis` profile but is not required:

```bash
docker compose --profile redis up -d
```

## Verification

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

The same four run on every push, in `.github/workflows/ci.yml`, against a Postgres service.

The integration suite covers auth, organization isolation, RBAC, captures, extension authorization and revocation, sign-in renewal races, docs, idempotency, validation, tenant-scoped search, the credit allowance, and the checks that keep one workspace from reaching into another. It runs against its own database, taken from `TEST_DATABASE_URL`, so it never touches the data a person is working in.

With the API and web development servers running, set `SMOKE_EMAIL` and `SMOKE_PASSWORD` to a real account, then run `bun run smoke:web`. It signs in, opens every page, shares a page into the app, checks that every folder is shown, and copies a doc. `bun run make-smoke-account` makes an account to use.

Going live: [deployment](docs/deployment.md) and [security](docs/security.md).

More detail: [architecture](docs/architecture.md), [database](docs/database.md), [authentication](docs/auth.md), [AI credits](docs/ai.md), [API](docs/api.md), [extension](docs/extension.md), and [development](docs/development.md).
