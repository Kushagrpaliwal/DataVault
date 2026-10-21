# AI features and free credits

## The constraint that shapes everything

The Gemini free tier enforces a **requests-per-day quota per project**, shared by every user of the product, and it resets at **midnight Pacific**. Pro models are not on the free tier at all, so only the Flash and Flash-Lite models are available.

That means the credit system is not really about the user's own allowance. It is about making sure a few hundred people cannot exhaust a quota that was designed for a single developer.

## How credits work

| Setting | Default | Meaning |
| --- | --- | --- |
| `AI_GLOBAL_DAILY_REQUESTS` | 900 | The shared daily budget. Set this to the requests-per-day shown in your AI Studio account, minus headroom. |
| `AI_GLOBAL_MINUTE_REQUESTS` | 12 | The shared per-minute cap, under the 15 RPM limit of `gemini-3.1-flash-lite`. |
| `AI_USER_DAILY_CREDITS` | 20 | How many credits one user gets per day. |
| `AI_USER_MINUTE_REQUESTS` | 5 | How many requests one user can make per minute. |
| `AI_MAX_INPUT_TOKENS` | 4000 | The largest amount of text sent to the model. |
| `AI_MAX_OUTPUT_TOKENS` | 400 | The largest answer accepted back. |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | The model to use. Must be free-tier eligible. |

**Credits are daily, not monthly, and reset at midnight Pacific.** That is the same moment the Gemini quota resets, so a user's allowance and the shared pool they draw from refresh together and nothing is wasted.

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
| `extract` | Structured fields: amount, currency, date, party, reference, payment method. |

Answers are cached against a hash of the exact request, so asking the same question twice costs one credit, not two. With a quota this small, that is the single biggest saving available.

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
| Bot sign-ups | Cloudflare Turnstile on sign-up, plus Postgres-backed rate limits on the address and on the account. |
| Spoofing the client address | `X-Forwarded-For` is only believed when `TRUSTED_PROXY_HOPS` says a trusted proxy set it. |
| Losing the limits on a restart | The counters live in Postgres, not in process memory. |
| Resetting the limits by waiting | The counters roll over on their own, atomically, in a single statement. |
| Stealing an account to spend its credits | Argon2id hashing, breach checking, session revocation, and a fresh session for sensitive actions. |
| Making every request expensive | Input and output token caps, and truncation before the request is sent. |
| Stealing the Gemini key | The key is only ever read from the environment inside the API. It never reaches a response, a log, or a client bundle. |
| Reaching another workspace's content | The context is scoped to the caller's workspace, and the `ai.use` permission is required. |
| Prompt injection through saved content | Saved text is passed as delimited data. The system instructions live server-side and the model is told to ignore instructions found in the text. |
| Being charged twice for one request | The `Idempotency-Key` header is recorded with a unique index, so a retry replays instead of charging again. |
| Being charged for a failed request | Credits are debited only on a successful response, and refunded otherwise. |
| Reading other tenants' data | Every query is scoped by organization, and the tenant context is resolved from the membership on every request. |

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/ai/credits` | The current allowance, and why it may be locked. |
| `GET` | `/api/v1/ai/activity` | Recent credit movements. |
| `POST` | `/api/v1/ai/consent` | Record the agreement to send content to the provider. |
| `POST` | `/api/v1/ai/summarize` | Summarise a saved item. |
| `POST` | `/api/v1/ai/classify` | Suggest a type and tags. |
| `POST` | `/api/v1/ai/extract` | Pull out structured fields. |

All three AI routes require the `ai.use` permission, a confirmed email address, a recorded consent, and an available credit.

## Turning it on

The AI features are inert while `GEMINI_API_KEY` is blank. Nothing breaks, and the interface explains that the features are switched off. To turn them on:

1. Create a project in AI Studio and copy the key into `GEMINI_API_KEY`.
2. Check the requests-per-day and requests-per-minute shown in AI Studio for that project.
3. Set `AI_GLOBAL_DAILY_REQUESTS` and `AI_GLOBAL_MINUTE_REQUESTS` to those numbers, minus a little headroom.
