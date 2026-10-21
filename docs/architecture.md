# Architecture

## System shape

```text
React/Vite web ─────────────┐
                           ├── HTTPS REST /api/v1 ── Bun/Elysia ── Drizzle ── PostgreSQL
WXT Chromium extension ────┘
```

There is no extension database and no special sync store. Both clients refetch the authoritative API. TanStack Query controls web cache freshness; extension lists are explicitly refreshed after writes.

## Package boundaries

- `@data-vault/schemas` owns request validation and centralized enums.
- `@data-vault/types` owns transport-facing types.
- `@data-vault/api-client` owns URLs, headers, cookies/bearer auth, refresh behavior, error normalization, query encoding, and pagination calls.
- `@data-vault/capture-parser` exposes the `CaptureExtractor` interface and the rule-based `RuleBasedExtractor`, which reads the author, the publication date, the claim and any figure out of a passage. A future AI adapter can implement the same interface without entering UI code.
- `@data-vault/notes` owns the doc schema shared by the website, the API and the extension, the arranger that sorts pieces into sections, and the Markdown and HTML exports.
- `@data-vault/database` owns schema, migrations, connection creation, and tenant transaction context.
- `@data-vault/ui` contains only primitives useful in both differently-sized clients.

The API is split into routes, auth/context, services, and infrastructure helpers.

## Capture flow

1. The background service worker receives the selected text from the `selection` context-menu event.
2. It records only text, page URL/title/domain, timestamp, and an explicitly enabled screenshot.
3. The side panel uses the shared deterministic parser to prepare an editable preview.
4. `POST /api/v1/captures` revalidates the payload, reruns deterministic extraction, checks duplicates, validates organization membership/permission, and inserts a generic saved record.
5. The same transaction keeps a snapshot of the text that was captured, and the tags that were chosen with it.
6. The extension refreshes recent records; the website sees the same row on its next query/refetch.

## Doc flow

1. The extension reads the selection from the page, keeping its formatting and dropping anything that could run on its own.
2. `POST /api/v1/notes/current/clips` finds the current doc, or makes one named after the page, and appends the piece under a heading that matches its source.
3. The doc row is locked while the piece is added, so two pieces arriving together cannot overwrite each other.
4. The doc's version goes up, and the plain text is kept beside the rich text for search and summaries.
5. The website sees the new piece on its next refetch, and merges it into the editor rather than throwing away anything the reader was writing.

The heading above a piece names its source, so the link is written once, at the heading, and the pieces underneath are shown as plain text. A piece that is not under a heading of its own source keeps its own link. This is a rule about how a doc is *shown*: the pieces stay in the document, so the server still knows what has been saved.

## Organizing saved items

Three layers of grouping sit on top of a saved item, and each one is used for a different thing:

- A **folder** (`vaults`) holds the item. Every saved item has exactly one, because the column is not allowed to be empty. Every workspace has a default folder, and the extension can be pointed at another one.
- A **collection** belongs to one folder and groups items inside it. It is for the finer grouping a folder sometimes needs.
- A **tag** works across every folder, so one item can carry many of them.

The three are managed on the Organize page, but they can also be changed on the item itself, so a name that was spelled wrong can be put right. Removing a folder moves its items to the default folder first, and removing a collection or a tag only takes the mark off the items that had it.

## Multi-tenancy

Every business record has `organization_id`. The backend ignores organization IDs in bodies and derives the workspace from an authenticated `X-Organization-Id` header after membership validation. Service queries include an organization predicate and run in `withTenant`, which sets `app.organization_id` for PostgreSQL row-level security policies. An id that a client names is checked against the workspace before it is written down, so a doc cannot be pointed at a folder in another one.

The rules are forced, so they apply to the owner of the table as well, and production must use a non-superuser role so that PostgreSQL enforces them as a second boundary. The credit tables follow the person rather than the workspace, because the allowance belongs to the person, and they read `app.user_id` for the same reason.

Every account is given a personal workspace when it signs up, and every workspace has a default folder in it. The workspace list is ordered so a real workspace comes first and the personal one comes last, because the first entry is what the interface falls back to when nothing has been chosen yet. Without that order the personal bucket was first for everyone, so every capture landed in it. The order is fixed rather than left to the database, so the fallback does not change from one request to the next.

## Consistency

- PostgreSQL transactions wrap compound creates, captures, and organization bootstrap.
- Idempotency records prevent duplicate critical writes after retries.
- A request key is scoped to the account that sent it, so one account cannot spend another account's request.
- `saved_records` rows preserve the original capture text, and the snapshot of it kept in `evidence_snapshots`.
- Audit events record prior/new values and request context.

Redis is intentionally optional. A future adapter can move rate limits, short auth state, queues, caching, and webhook deduplication out of process without changing product domain services.
