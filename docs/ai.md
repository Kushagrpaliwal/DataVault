# AI features and free credits

## The constraint that shapes everything

The Gemini free tier enforces a **requests-per-day quota per project**, shared by every user of the product, and it resets at **midnight Pacific**. Pro models are not on the free tier at all, so only the Flash and Flash-Lite models are available.

That means the credit system is not really about the user's own allowance. It is about making sure a few hundred people cannot exhaust a quota that was designed for a single developer.

## How credits work

| Setting | Default | Meaning |
| --- | --- | --- |
| `AI_GLOBAL_DAILY_REQUESTS` | 900 | The shared daily budget. Set this to the requests-per-day shown in your AI Studio account, minus headroom. |
| `AI_GLOBAL_DAILY_EMBEDDINGS` | 900 | The shared daily budget for the numbers that make a search by meaning work. It is a budget of its own, because making numbers is not the same as writing an answer. |
| `AI_GLOBAL_MINUTE_REQUESTS` | 12 | The shared per-minute cap, under the 15 RPM limit of `gemini-3.1-flash-lite`. |
| `AI_USER_DAILY_CREDITS` | 20 | How many credits one user gets per day. |
| `AI_USER_MINUTE_REQUESTS` | 5 | How many requests one user can make per minute. |
| `AI_MAX_INPUT_TOKENS` | 4000 | The largest amount of text sent to the model. |
| `AI_MAX_OUTPUT_TOKENS` | 400 | The largest answer accepted back. |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | The model to use. Must be free-tier eligible. |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-2` | The model that turns text into numbers. It is a different model from the one that writes, and its name is a setting because the old one was switched off by Google on 2026-01-14. |

**Credits are daily, not monthly, and reset at midnight Pacific.** That is the same moment the Gemini quota resets, so a user's allowance and the shared pool they draw from refresh together and nothing is wasted.

**Credits belong to the person, not to the workspace.** The allowance is counted for the account, across every workspace it is in. It used to be counted per workspace, which meant a new workspace was a fresh allowance, and the free credits could be multiplied simply by making another one.

### The fair-share rule

A fixed personal allowance is not enough on its own. If the daily budget is 900 and one user is allowed 20, fifty users can use everything. If ten users are active, one of them could use two hundred requests and lock out the rest.

The effective allowance is therefore:

```
min(AI_USER_DAILY_CREDITS, max(1, floor(globalRemaining / activeUsersToday)))
```

Every active user always keeps at least one request, and the rest of the budget is shared.

## What a credit buys

One credit is one request to the model. There are three features:

| Feature | What it does |
| --- | --- |
| `summarize` | A short summary, key points, and a suggested title. |
| `classify` | A suggested record type, tags, and a confidence. |
| `extract` | Structured fields: the author, the publication date, the claim the passage makes, and any figure it quotes. |

Answers are cached against a hash of the exact request, so asking the same question twice costs one credit, not two. With a quota this small, that is the single biggest saving available.

## The search by meaning

The search by meaning is a fourth thing that asks the model, and it is behind the same controls as the other three: the server must have a key, the address must be confirmed, the person must have agreed to send content to the provider, and there must be room in the shared budget. The numbers of a question are kept, so a question that is asked twice is asked of the model once. The search is limited to twenty a minute, and making the numbers of every item again is allowed three times a day.

Making numbers does **not** spend the person's own credits. Nothing is asked of them and nothing is read by them, so it is counted only against `AI_GLOBAL_DAILY_EMBEDDINGS`.

The numbers themselves are 768 long, which is the size Google's own guide recommends, and the rows are small because of it. An item that was archived is not found by a search by meaning, and neither is one that is in the trash.

## Privacy

**On the free tier, content sent to Gemini may be used to improve Google's products.** DataVault holds personal saved content, so this is not a footnote.

The user is asked to agree, explicitly, before anything is sent. The agreement is recorded in `ai_consents` and is shown the first time an AI feature is used. The disclosure names the behaviour rather than burying it.

Only the text the user asked about is sent. The whole library is never sent, and the context builder only ever reads rows the caller could already read.

## How abuse is prevented

| Attack | Control |
| --- | --- |
| Farming accounts with throwaway inboxes | Credits need a confirmed address. Disposable domains are on a blocklist, and every other domain must resolve an MX record. |
| Disposable inbox providers not on the list | The MX check catches them: a domain that cannot receive mail can never be confirmed. |
| One user burning the shared pool | Per-user daily and per-minute caps, plus the fair-share floor. |
| Bot sign-ups | Cloudflare Turnstile on sign-up, checked by the sign-up route itself, plus Postgres-backed rate limits on the address and on the account. Better Auth's own sign-up endpoint is not reachable over HTTP. |
| Spoofing the client address | `X-Forwarded-For` is only believed when `TRUSTED_PROXY_HOPS` says a trusted proxy set it. |
| Losing the limits on a restart | The counters live in Postgres, not in process memory. |
| Resetting the limits by waiting | The counters roll over on their own, atomically, in a single statement. |
| Stealing an account to spend its credits | Argon2id hashing, breach checking, session revocation, and a fresh session for sensitive actions. |
| Making every request expensive | Input and output token caps, and truncation before the request is sent. |
| Stealing the Gemini key | The key is only ever read from the environment inside the API. It never reaches a response, a log, or a client bundle. |
| The key of a person being read by another | The key is encrypted with a key the server has, and it is tied to the person and the connection it belongs to. A ciphertext that is moved to another row cannot be read, and the rule on the table hides the row from anybody else. |
| The key of a person being read back | It is write-only. It never comes back in an answer, and only the last four of it are kept. |
| The server being pointed at something inside | The address of a provider is checked before it is called: it must use https, it must not be on the local network, and the name is looked up as well. A redirect is not followed. |
| The model writing a link into a doc | The answer is a list of blocks and never markup. Only bold and italic are written, so there is nothing to click. |
| Instructions hidden in saved content | Saved text is passed as delimited data, and the model is told that it is data and never instructions. |
| A saved item of another workspace being sent | The saved items are read in the workspace of the person, so an item of another workspace is never found, and the rule on the table hides it as well. |
| Reaching another workspace's content | The context is scoped to the caller's workspace, and the `ai.use` permission is required. |
| Prompt injection through saved content | Saved text is passed as delimited data. The system instructions live server-side and the model is told to ignore instructions found in the text. |
| Being charged twice for one request | The `Idempotency-Key` header is recorded with a unique index, so a retry replays instead of charging again. The key is scoped to the account that sent it, and a key that another account has used is refused. |
| Being charged for a failed request | Credits are debited only on a successful response, and refunded otherwise. |
| Paying twice for one suggestion | The suggestion is kept on the server between the preview and the moment it is applied, so applying it asks the model nothing further and costs no second credit. |
| Reaching another workspace's content | The context is scoped to the caller's workspace, and the `ai.use` permission is required. |
| Reading other tenants' data | Every query is scoped by organization, and the tenant context is resolved from the membership on every request. The row-level security rules are forced, so they apply to the owner of the table as well. |

## Bring your own key

A person may have a subscription of their own, or a model on their own machine. The AI features use that instead of the shared free key when it is connected.

### How the key is held

| Setting | Default | Meaning |
| --- | --- | --- |
| `AI_KEY_ENCRYPTION_KEY` | unset | The key that encrypts the keys of the users: 32 bytes, base64. Without it nobody can connect a provider of their own. |
| `AI_ALLOW_PRIVATE_ENDPOINTS` | `false` | Whether the server may call a model on the local network, which is where Ollama and LM Studio usually are. |
| `AI_BYO_MAX_INPUT_TOKENS` | 32000 | The largest amount of text sent with a key of their own. |
| `AI_BYO_MAX_OUTPUT_TOKENS` | 4000 | The largest answer accepted back with a key of their own. |

The key of a person is encrypted with AES-256-GCM before it is written down, with a fresh nonce each time, and it is tied to the person and the connection it belongs to. A ciphertext that is moved to another row cannot be read. The key is write-only: it is never sent back to the browser, and only the last four of it are kept, which is enough to tell two keys apart.

A request that is paid for by the person spends no credit and no part of the shared budget. The tokens are still recorded, so that a person can see what their key was used for.

### The address the server calls

The base address of a provider is written by a person, so the server ends up calling whatever they wrote. The address is checked before every call: it must use https, it must not be on the local network, and the name is looked up as well, because a name may point at a private address. A redirect is not followed, and every call has a time to live. `AI_ALLOW_PRIVATE_ENDPOINTS` opens the local network for the people who run a model on their own machine.

### The providers

| Preset | How it is talked to |
| --- | --- |
| OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together | The OpenAI language: `POST {base}/chat/completions`, with the shape asked for in `response_format`. A provider that refuses that is asked again in a simpler way, and the JSON is taken out of the words it wrote. |
| Ollama, LM Studio, Custom | The same, with an address of your own. |
| Anthropic | `POST /v1/messages` with a single forced tool whose input schema is the shape that is asked for, which works on every Claude model. |
| Google | The same request the shared key makes, with the key and the model of the person. |

Every answer is read with a schema, so a model that answers in the wrong shape is refused rather than written into a doc.

### The AI on a selection

The first feature that uses a key of their own is in the Docs editor: select something, and the AI arranges it, makes a table out of it, summarises it, finishes it, tidies it, translates it, or does what the instruction says. The answer is shown before anything is written, and it is a list of blocks and never markup, so a model cannot write a link or a picture into a doc.

The person chooses how much the AI may use each time: only the selection, the selection and the model's own knowledge, or the selection and the saved items they pick. The saved items are read in the workspace of the person, so an item of another workspace can never be sent. The line under the buttons says what will be sent, and to whom.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/ai/credits` | The current allowance, and why it may be locked. |
| `GET` | `/api/v1/ai/activity` | Recent credit movements. |
| `POST` | `/api/v1/ai/consent` | Record the agreement to send content to the provider. |
| `POST` | `/api/v1/ai/summarize` | Summarise a saved item. |
| `POST` | `/api/v1/ai/classify` | Suggest a type and tags. |
| `POST` | `/api/v1/ai/extract` | Pull out structured fields. |
| `GET` | `/api/v1/search/semantic` | A search by meaning. |
| `POST` | `/api/v1/search/semantic/reindex` | Make the numbers of every item again. |
| `GET` | `/api/v1/ai/connections` | The providers the person has connected. The key is never in it. |
| `POST` | `/api/v1/ai/connections` | Connect a provider. |
| `PATCH` | `/api/v1/ai/connections/:id` | Change the name, the model, or the key, or make it the one in use. |
| `DELETE` | `/api/v1/ai/connections/:id` | Remove a connection. The key goes with it. |
| `POST` | `/api/v1/ai/connections/test` | Try a provider and ask it which models it has. |
| `POST` | `/api/v1/notes/:id/ai/selection` | Do something with a selection of a doc. The answer is a list of blocks, and it is not written into the doc. |

All three AI routes require the `ai.use` permission, a confirmed email address, a recorded consent, and an available credit. The search by meaning asks for the same three things, and a budget of its own besides. The routes for the connections need the `ai.use` permission and the agreement that goes with them.

## Turning it on

The AI features are inert while `GEMINI_API_KEY` is blank. Nothing breaks, and the interface explains that the features are switched off. To turn them on:

1. Create a project in AI Studio and copy the key into `GEMINI_API_KEY`.
2. Check the requests-per-day and requests-per-minute shown in AI Studio for that project.
3. Set `AI_GLOBAL_DAILY_REQUESTS` and `AI_GLOBAL_MINUTE_REQUESTS` to those numbers, minus a little headroom.
