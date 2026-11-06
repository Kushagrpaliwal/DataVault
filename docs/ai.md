# AI setup and providers

DataVault is BYOK-only: AI features require a provider connection and API key supplied by the user. There is no shared DataVault model key, free AI allowance, or credit system in the application. Any provider pricing, quota, and account terms apply to the account behind the connected key.

## What uses AI

- Summarising saved items, suggesting their type and tags, and extracting details.
- Working with docs: making notes, summarising, asking questions, rearranging, and assisting with selected text.
- Search by meaning. This creates embeddings for saved items and search queries.

Text requests use the user's default connection. The API sends the requested text to that provider. The browser and extension never receive the saved API key.

## Connect a provider

Open **Settings → AI connections**, choose a supported provider, enter its API key, test the connection, and save it. DataVault supports Gemini, Anthropic, and OpenAI-compatible APIs, including compatible local services such as Ollama or LM Studio when the server allows private endpoints.

The server encrypts provider keys with AES-256-GCM before storing them. Set `AI_KEY_ENCRYPTION_KEY` in the API environment to a base64-encoded 32-byte key:

```bash
openssl rand -base64 32
```

The key is bound to the user, connection, and provider host. It is write-only in the application: the API returns a short key hint, never the full key. Without `AI_KEY_ENCRYPTION_KEY`, providers that need a secret key cannot be saved or used.

There is no fallback provider. If a connection is missing or its key cannot be read, AI requests stop and the interface points to Settings.

## Semantic search

Semantic search uses the connected provider's key too. With Gemini, DataVault uses the configured `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-2`). With OpenAI-compatible providers, it requests 768-dimensional embeddings from `text-embedding-3-small`. Anthropic connections can run text AI features, but do not support DataVault semantic search.

When a provider is connected, saving a record attempts to create its embedding. Failed or unsupported embedding calls do not prevent the record from being saved. Existing records can be indexed again with `POST /api/v1/search/semantic/reindex`. Embedding requests may incur charges or use quota under the connected provider account.

## Limits

| Setting | Default | Purpose |
| --- | ---: | --- |
| `AI_KEY_ENCRYPTION_KEY` | unset | Encrypts user-connected provider keys. Required for keyed providers. |
| `AI_ALLOW_PRIVATE_ENDPOINTS` | `false` | Allows configured local AI endpoints such as Ollama or LM Studio. |
| `AI_BYO_MAX_INPUT_TOKENS` | `32000` | Input safety cap for model requests. |
| `AI_BYO_MAX_OUTPUT_TOKENS` | `8192` | Output safety cap for model requests. |
| `AI_USER_MINUTE_REQUESTS` | `5` | Per-user request rate limit. |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-2` | Embedding model used with a user-connected Gemini key. |

Provider-side rate limits and pricing still apply. DataVault's request limits protect the service and the user's connection; they do not grant a free allowance.

## API routes

AI actions and provider connections require the `ai.use` workspace permission. Text and doc AI routes also require a connected provider.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/ai/status` | Report whether a readable default connection is configured. |
| `GET` | `/api/v1/ai/connections` | List the user's provider connections without returning keys. |
| `POST` | `/api/v1/ai/connections` | Add a provider connection. |
| `PATCH` | `/api/v1/ai/connections/:id` | Update a connection or make it the default. |
| `DELETE` | `/api/v1/ai/connections/:id` | Remove a connection and its encrypted key. |
| `POST` | `/api/v1/ai/connections/test` | Test a saved or unsaved provider connection. |
| `POST` | `/api/v1/ai/summarize` | Summarise a saved item or supplied text. |
| `POST` | `/api/v1/ai/classify` | Suggest a record type and tags. |
| `POST` | `/api/v1/ai/extract` | Extract structured details from text. |

The docs routes under `/api/v1/notes/:id` use the same default provider. Search by meaning additionally requires capture read or update permission, depending on the route.
