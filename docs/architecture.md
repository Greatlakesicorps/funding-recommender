# Architecture

[Overview](../README.md) · [Development](development.md)

## Request flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant W as Cloudflare Worker
    participant N as Neon Auth
    participant D as Rate limiter
    participant M as U-M Maizey
    B->>W: Open /
    W->>N: Check session through middleware
    W-->>B: Search page or sign-in
    B->>W: POST /api/chat (question and transcript)
    W->>N: Validate live session, bypass cookie cache
    W->>D: Consume allowance for hashed client IP
    W->>M: Create conversation if needed; send query
    M-->>W: Answer and retrieved documents
    W-->>B: Answer, sources, signed conversation cookie
    B->>B: Save successful search in localStorage
```

Invalid requests, absent sessions, and failed limiter checks stop before Maizey calls. Required Google sign-in identifies visitors; it does not enforce university membership or an account allowlist.

## Code map

| Location                                                          | Responsibility                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `app/page.tsx`                                                    | Chat state, submit/retry/cooldown, history selection, download, draft recovery, page composition. |
| `components/usage-guide.tsx`, `components/privacy-notice.tsx`     | Onboarding and expandable data-use copy.                                                          |
| `components/markdown-answer.tsx`, `components/answer-sources.tsx` | Markdown without raw HTML; sources-searched list.                                                 |
| `components/search-history-panel.tsx`                             | History filter, deletion, mobile drawer/focus handling.                                           |
| `hooks/use-search-history.ts`                                     | History store, retention pruning, cross-tab sync.                                                 |
| `lib/search-history.ts`                                           | Storage validation/caps, retention, titles, Markdown export.                                      |
| `lib/funding-chat.ts`                                             | Shared validation, bounded context, response guidance, source normalization. No secrets.          |
| `app/api/chat/route.ts`                                           | Origin/body validation, live auth, rate limiting, signed cookie, Maizey calls, error mapping.     |
| `lib/auth/`, `proxy.ts`, `app/api/auth/[...path]/route.ts`        | Neon integration, page gate, SDK auth proxy.                                                      |
| `app/auth/sign-in/page.tsx`, `components/sign-out.tsx`            | Google sign-in and full-page sign-out.                                                            |
| `worker/funding-rate-limiter.ts`                                  | Atomic SQLite-backed fixed-window limiter and alarm cleanup.                                      |
| `worker/index.ts`                                                 | Worker fetch entrypoint, Durable Object export, starter connector context.                        |
| `vite.config.ts`                                                  | Plugins, Worker name, flags, bindings, migration history, preview services.                       |
| `tests/`                                                          | Unit and Miniflare integration tests; `fixtures/` contains auth mocks and test-only routes.       |

`components/ui/`, `hooks/use-mobile.ts`, `db/`, `drizzle/`, `examples/d1/`, connector helpers, and `app/chatgpt-auth.ts` are retained starter capabilities, unused by the funding experience. D1/R2 are disabled in `.openai/hosting.json`. There is no application database for saved chats; Neon manages its own auth records. Preserve vendor licenses when changing starter code.

## Conversation and storage

- Maizey base URL and project ID are constants at the top of `app/api/chat/route.ts`; its token is a runtime secret.
- Conversation IDs come only from a verified HMAC-signed, HttpOnly, SameSite=Lax cookie. HTTPS adds Secure. The browser cookie lifetime is 24 hours; signature verification itself has no embedded server-side expiry timestamp.
- Maizey does not apply earlier turns automatically. The browser sends up to 30 turns within a 20,000-character transport budget. Server context uses a 12,000-character budget, preserving the original team profile and recent turns.
- Reopened saved searches start a fresh upstream conversation with bounded saved context. New search clears the visible conversation but leaves saved searches intact.
- Successful answers save under `funding-explorer:history:v1` in localStorage. Limits: 50 searches, 80 messages/search, 50,000 characters/message. Expiry is 30 days after last use. Concurrent tabs use last-write-wins updates.
- History belongs to the browser profile, shared across accounts and unsynced across devices. Sign-out leaves it intact. Deleting it does not delete Maizey logs.
- Session recovery temporarily stores the pending question and saved-search ID in sessionStorage, then removes them after restoration. Unsaved transcripts cannot be recovered from local history.

## API contract

`POST /api/chat` requires a valid Neon session and same-origin JSON browser requests:

```json
{
  "question": "What should our fictional prototype team explore next?",
  "newConversation": true,
  "history": []
}
```

Success returns `answer` and `sources`. Normalized sources contain `title`, nullable `url`, and `kind` (`web` or `knowledge-base`). Errors return `error` and `retryable`. A 429 also returns `retryAfter` seconds and a `Retry-After` header. Chat responses use `Cache-Control: no-store`.

Questions are capped at 4,000 characters; bodies at 256 KiB measured while streaming. Conversation creation times out after 20 seconds; message calls after 90 seconds. The UI restores failed questions. Sources are retrieved documents, not per-claim citations. Internal knowledge-base URLs stay hidden unless `SHOW_KNOWLEDGE_BASE_LINKS` is enabled after access review.

## Rate limiting

Each trusted `CF-Connecting-IP` gets 12 accepted requests per 10-minute fixed window. Missing identity is blocked except on loopback development hosts; forwarded-IP headers are ignored. Object names derive from an HMAC of the IP using the Maizey token. Records contain a count and reset time, not the raw IP. Token rotation changes the keys and starts new effective windows.

Transactions enforce concurrency. Alarms schedule expiry without deleting newer windows. Upstream failures after the limiter consume allowance. Missing bindings/storage return 503 with no memory fallback. This does not cap overall spending; hosting logs/backups may have different retention.

## Common changes

| Change                        | Start here                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Appearance/responsive layout  | `app/globals.css`; keep 320 px and drawer checks.                                                        |
| Welcome/privacy wording       | `components/usage-guide.tsx`, `components/privacy-notice.tsx`; align with storage behavior.              |
| Suggested questions           | `suggestions` in `app/page.tsx`.                                                                         |
| Answer guidance/source rules  | `lib/funding-chat.ts` and Maizey's project configuration.                                                |
| Maizey project                | Constants in `app/api/chat/route.ts`, matching private token.                                            |
| History format/retention      | `lib/search-history.ts`, tests, privacy notice. Version/migrate changed persisted shapes.                |
| Rate limit                    | `worker/funding-rate-limiter.ts`, integration tests, privacy copy, docs. Preserve migration identifiers. |
| Providers/access restrictions | Neon configuration and auth UI/server checks; perform real browser QA.                                   |
