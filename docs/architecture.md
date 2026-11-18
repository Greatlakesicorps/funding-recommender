# Architecture

[Overview](../README.md) · [Development](development.md)

## Request flow

```mermaid
sequenceDiagram
    participant B as Browser (Cloudflare static assets)
    participant N as Neon Auth
    participant W as Cloudflare Worker
    participant D as Rate limiter
    participant M as U-M Maizey
    B->>N: Sign in with Google, get session token (JWT)
    B->>W: POST /api/chat with Bearer token, question, transcript
    W->>N: Fetch signing keys (cached), verify token
    W->>D: Consume allowance for the signed-in user
    W->>M: Create conversation if needed; send query
    M-->>W: Answer and retrieved documents
    W-->>B: Answer, sources, signed conversation token
    B->>B: Save successful search in localStorage
```

Invalid requests, missing or invalid tokens, and failed limiter checks stop before any Maizey call. Google sign-in identifies visitors; it does not enforce university membership or an account allowlist.

## Code map

| Location                                                   | Responsibility                                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/App.tsx`                                              | Chat state, submit/retry/cooldown, history selection, download, draft recovery, sign-in gate.  |
| `src/lib/auth.ts`                                          | Neon Auth client: session status, Google sign-in/out, token for the Worker, Worker base URL.   |
| `src/components/sign-in.tsx`, `sign-out.tsx`               | Google sign-in screen and sign-out button.                                                     |
| `src/components/usage-guide.tsx`, `privacy-notice.tsx`     | Onboarding and expandable data-use copy.                                                       |
| `src/components/markdown-answer.tsx`, `answer-sources.tsx` | Markdown without raw HTML; sources-searched list.                                              |
| `src/components/search-history-panel.tsx`                  | History filter, deletion, mobile drawer/focus handling.                                        |
| `src/hooks/use-search-history.ts`                          | History store, retention pruning, cross-tab sync.                                              |
| `src/lib/search-history.ts`                                | Storage validation/caps, retention, titles, Markdown export.                                   |
| `src/lib/funding-chat.ts`                                  | Shared validation, bounded context, response guidance, source normalization. No secrets.       |
| `src/globals.css`                                          | All styling.                                                                                   |
| `worker/index.ts`                                          | Chat API: CORS, token verification, validation, rate limiting, signed conversation, Maizey.    |
| `worker/funding-rate-limiter.ts`                           | Atomic SQLite-backed fixed-window limiter and alarm cleanup.                                   |
| `wrangler.jsonc`                                           | Worker name, static assets, variables, Durable Object binding and migration history.           |
| `vite.config.ts`, `index.html`                             | Site build. `VITE_BASE` sets the deployment sub-path.                                          |
| `.github/workflows/ci.yml`                                 | Checks and builds the site; does not deploy.                                                   |
| `tests/`                                                   | Unit tests and a Miniflare integration test of the real Worker; `fixtures/` holds the wrapper. |

There is no application database. Neon manages its own auth records; saved searches stay in the browser.

## Sign-in and tokens

- The site calls Neon Auth directly. After Google sign-in it asks the Neon client for a JWT and sends it as `Authorization: Bearer <token>`.
- The Worker verifies the token against Neon's published keys (`<NEON_AUTH_BASE_URL>/.well-known/jwks.json`, cached per isolate). Only EdDSA is accepted; `iss` and `aud` must equal the Neon Auth origin; `sub` must be present.
- Bad or expired tokens return 401 (the site offers **Sign in again**). If Neon's keys cannot be fetched or `NEON_AUTH_BASE_URL` is unset, the Worker fails closed with a retryable 503.
- CORS: only origins listed in `ALLOWED_ORIGINS` may call `/api/chat`. A browser request from another origin is rejected before auth.

## Conversation and storage

- Maizey base URL and project ID are constants at the top of `worker/index.ts`; the token is a Worker secret.
- The Worker returns a `conversation` value in the JSON body when it starts a new Maizey conversation. It is `<id>.<HMAC>`, bound to the signed-in user. The site sends it back with follow-ups. An invalid or other-user value starts a fresh conversation. (Cookies are not used: the site and Worker are different origins.)
- Maizey does not apply earlier turns automatically. The browser sends up to 30 turns within a 20,000-character transport budget. Server context uses a 12,000-character budget, preserving the original team profile and recent turns.
- Reopened saved searches start a fresh upstream conversation with bounded saved context. New search clears the visible conversation but leaves saved searches intact.
- Successful answers save under `funding-explorer:history:v1` in localStorage. Limits: 50 searches, 80 messages/search, 50,000 characters/message. Expiry is 30 days after last use. Concurrent tabs use last-write-wins updates.
- History belongs to the browser profile, shared across accounts and unsynced across devices. Sign-out leaves it intact. Deleting it does not delete Maizey logs.
- Session recovery temporarily stores the pending question and saved-search ID in sessionStorage, then removes them after restoration.

## API contract

`POST /api/chat` requires `Content-Type: application/json` and a Bearer token:

```json
{
  "question": "What should our fictional prototype team explore next?",
  "newConversation": true,
  "conversation": null,
  "history": []
}
```

Success returns `answer`, `sources`, and, when a conversation was created, `conversation`. Normalized sources contain `title`, nullable `url`, and `kind` (`web` or `knowledge-base`). Errors return `error` and `retryable`. A 429 also returns `retryAfter` seconds and a `Retry-After` header. Chat responses use `Cache-Control: no-store`. `GET /api/health` returns `{"ok":true}`.

Questions are capped at 4,000 characters; bodies at 256 KiB measured while streaming. Conversation creation times out after 20 seconds; message calls after 90 seconds. Sources are retrieved documents, not per-claim citations. Internal knowledge-base URLs stay hidden unless `SHOW_KNOWLEDGE_BASE_LINKS` in `src/lib/funding-chat.ts` is enabled after access review.

## Rate limiting

Each signed-in user gets 12 accepted requests per 10-minute fixed window. Object names derive from an HMAC of the user ID using the Maizey token, so records hold a count and reset time, not the user ID. Token rotation changes the keys and starts new effective windows.

Transactions enforce concurrency. Alarms schedule expiry without deleting newer windows. Upstream failures after the limiter consume allowance. A missing binding or failing storage returns 503 with no memory fallback. This does not cap overall spending.

## Common changes

| Change                       | Start here                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Appearance/responsive layout | `src/globals.css`; keep 320 px and drawer checks.                                              |
| Welcome/privacy wording      | `src/components/usage-guide.tsx`, `privacy-notice.tsx`; align with storage behavior.           |
| Suggested questions          | `suggestions` in `src/App.tsx`.                                                                |
| Answer guidance/source rules | `src/lib/funding-chat.ts` and Maizey's project configuration.                                  |
| Maizey project               | Constants in `worker/index.ts`, matching the private token.                                    |
| History format/retention     | `src/lib/search-history.ts`, tests, privacy notice. Version/migrate changed persisted shapes.  |
| Rate limit                   | `worker/funding-rate-limiter.ts` and `worker/index.ts`, integration tests, privacy copy, docs. |
| Allowed websites             | `ALLOWED_ORIGINS` in `wrangler.jsonc`, then redeploy the Worker.                               |
| Access restrictions          | Check email/domain from the verified token in `worker/index.ts`; perform real browser QA.      |
