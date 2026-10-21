# REST API

Base path: `/api/v1`. JSON responses use one envelope:

```json
{ "success": true, "data": {} }
```

```json
{ "success": false, "error": { "code": "NOTE_NOT_FOUND", "message": "That doc could not be found.", "requestId": "..." } }
```

OpenAPI UI/spec is available at `/api/v1/openapi` in the running service. Production errors never expose stack traces.

## Auth and organization

- `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`
- `GET /me`
- `GET|POST /organizations`

Protected business calls require `X-Organization-Id`. Cookie-authenticated mutations require `X-CSRF-Token`. Extension calls use `Authorization: Bearer <access-token>`.

## Core resources

- `GET|POST /saved-records`; `GET|PATCH /saved-records/:id`; `POST /saved-records/:id/archive|restore`
- `GET|POST /saved-views`; `DELETE /saved-views/:id`
- `POST /captures`; `GET /captures/recent`
- `GET /search`, `/dashboard`, `/audit-logs`
- `POST /saved-records/:id/attachments`; `GET /attachments/:id`

## Organizing

A saved item always sits in one folder. Collections group items inside a folder, and tags work across every folder. A folder, a collection and a tag can all be renamed and removed; removing a folder moves its items to the default folder first.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/vaults` | The folders of the workspace, with how many items each one holds. |
| `POST` | `/vaults` | Make a folder. |
| `PATCH` | `/vaults/:id` | Rename a folder, or change its colour. |
| `DELETE` | `/vaults/:id` | Remove a folder. Its items move to the default folder. The default folder itself cannot be removed. |
| `GET` | `/vaults/:id/collections` | The collections of one folder, with how many items each one holds. |
| `POST` | `/collections` | Make a collection in a folder. |
| `PATCH` | `/collections/:id` | Rename a collection, or change its colour. |
| `DELETE` | `/collections/:id` | Remove a collection. The items in it are kept. |
| `GET` | `/tags` | The tags of the workspace, with how many items each one holds. |
| `POST` | `/tags` | Make a tag. |
| `PATCH` | `/tags/:id` | Rename a tag, or change its colour. |
| `DELETE` | `/tags/:id` | Remove a tag. The items that had it are kept. |
| `PUT` | `/saved-records/:id/organization` | Move an item into a folder, put it in collections, and mark it with tags. The body is `{ vaultId?, collectionIds?, tagNames?, reviewStatus?, privacyLevel? }`. A tag that does not exist yet is made. Moving an item to another folder takes off the collections of the old folder. |

Critical create requests require an `Idempotency-Key` header (8–200 characters). Reusing a key with the same payload returns the original result; reusing it with another payload returns a conflict.

## Docs

A doc holds rich text. Its content is the JSON the editor works with, and the plain text is kept beside it so a doc can be searched and summarised cheaply.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/notes?q&parentId&trash` | The list: title, icon, pinned, parent, updated time, clip count and a short excerpt. |
| `POST` | `/notes` | Create. Needs an `Idempotency-Key`. |
| `GET` | `/notes/:id` | The whole content and the current version. |
| `PATCH` | `/notes/:id` | Change the title, icon, content, arrange mode, pinned state or parent. Send `baseVersion`; the server answers `409 NOTE_VERSION_CONFLICT` with the newest doc when the version no longer matches. |
| `DELETE` | `/notes/:id` | Move to Trash. |
| `POST` | `/notes/:id/restore` | Bring back out of Trash. |
| `POST` | `/notes/:id/duplicate` | Make a copy of the doc. Needs an `Idempotency-Key`. |
| `POST` | `/notes/:id/clips` | Add a piece of a web page. The body is `{ html?, text, source: { url?, title, domain }, capturedAt? }`. Answers `{ clipId, sectionTitle, duplicate, noteTitle, noteId, version, clipCount }`. |
| `DELETE` | `/notes/:id/clips/:clipId` | Take a piece back out. |
| `POST` | `/notes/:id/rearrange` | Sort the pieces again, using the doc's arrange mode. |
| `POST` | `/notes/:id/write-up` | Write the pieces up as sentences that follow each other, in paragraphs. Without `apply` it proposes the writing and keeps it on the server, answering `{ preview: true, previewId, title, sections }`. With `{ apply: true, previewId }` the proposal that was shown is written into the doc, without asking the model again. |
| `GET` | `/notes/:id/revisions` | The earlier versions of the doc. |
| `POST` | `/notes/:id/revisions/:rid/restore` | Go back to an earlier version. |
| `POST` | `/notes/:id/organize` | Sort the doc into topics with the AI. Without `apply` it proposes the topics and keeps them on the server, answering `{ preview: true, previewId, sections }`. With `{ apply: true, previewId }` the proposal that was shown is written into the doc, without asking the model again. |
| `GET` | `/notes/current` | The doc the keyboard shortcut adds to. |
| `PUT` | `/notes/current` | Choose the current doc. |
| `POST` | `/notes/current/clips` | The keyboard shortcut. It uses the current doc, or makes one named after the page when there is none. |

The content of a doc is checked against the editor's own schema before it is stored, and a doc may be at most two megabytes. Pieces are placed under a heading that matches their source: by page, by website, by day, or simply at the end. The mode is set on the doc and can be changed at any time.

The heading names the source of the pieces under it, so the link is written once, at the heading, and the pieces themselves are shown as plain text. A piece that is not under a heading of its own source keeps its own link.

## AI

The AI features need a workspace, a confirmed email address and the agreement to send content to the model provider. The allowance belongs to the person, so it is the same in every workspace.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/ai/credits` | The allowance left today, and why the features are unavailable if they are. |
| `GET` | `/ai/activity` | The recent movements of the allowance. |
| `POST` | `/ai/consent` | Record the agreement to send content to the model provider. |
| `POST` | `/ai/summarize` | Summarise a saved item or a piece of text. The body is `{ recordId?, text? }`. |
| `POST` | `/ai/classify` | Suggest a type and some tags. |
| `POST` | `/ai/extract` | Pull the fields out of a piece of text. |

A request that has been made is not made again: send an `Idempotency-Key`, and a retry is charged once. A key that another account has already used is refused.

## Extension authorization

- `POST /extension/auth/start`
- `POST /extension/auth/approve` (website session + CSRF)
- `POST /extension/auth/exchange`
- `POST /extension/auth/refresh`
- `POST /extension/auth/logout`
- `GET /extension/sessions`
- `POST /extension/sessions/:id/revoke`

List/search routes use backend pagination (`page`, `limit`, maximum 100). Search covers the title, the description, the text that was captured, the website it came from and the title of the page. A `%` or an `_` in the search is looked for as text rather than as a wildcard. A month is a date filter only when the query is a month, or a month and a year, so a word that contains the name of a month is still just a word.

A request body is at most eight megabytes. The length is taken from the `Content-Length` header, and a body that arrives in chunks is refused rather than taken on trust.
