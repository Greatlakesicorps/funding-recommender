# Testing

[Overview](../README.md) · [Development](development.md) · [Deployment](deployment.md)

## Automated checks

```sh
npm run check
```

Runs formatting, TypeScript, ESLint, tests, and production build in order. Individual commands are in the [development guide](development.md#commands).

| File                            | Coverage                                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/funding-chat.test.mjs`   | Transcript bounds, context construction, source validation, URL rules.                                                                                                                               |
| `tests/search-history.test.mjs` | Storage validation, retention, caps, quota eviction, titles, transcript export.                                                                                                                      |
| `tests/chat-api.test.mjs`       | The real Worker and SQLite-backed Durable Objects in Miniflare: token verification, CORS, per-user limits and concurrency, restart persistence, body checks, conversation tokens, upstream failures. |

The Worker tests bundle `worker/index.ts` through `tests/fixtures/chat-worker.ts`, sign test tokens with a throwaway key whose public half is served by a mocked Neon JWKS endpoint, and intercept Maizey with fictional responses. Runs use isolated temporary storage and remove it afterward. No real Maizey token, Google sign-in, or paid Maizey requests are needed. These tests do not verify the real provider, third-party cookie behavior, or account settings.

## Smoke test the Worker

With `npm run worker:dev` running:

```sh
curl http://localhost:8787/api/health
curl -i -X POST http://localhost:8787/api/chat -H "Content-Type: application/json" -d "{}"
```

The first returns `{"ok":true}`; the second returns 401 without calling Maizey.

## Browser checks

Use public or fictional input. Real chat tests may consume Maizey quota. Run against the release origin (the Pages URL), using a separate profile for clean-session checks. Also try Safari or a browser with third-party cookies blocked: the site and Neon Auth are different origins.

- [ ] Signed-out `/` shows the sign-in screen; direct unsigned `/api/chat` returns 401 without upstream calls.
- [ ] Google returns to the app. Cancellation/browser Back leaves an enabled sign-in button and usable retry behavior.
- [ ] Sign-out returns to sign-in; an older open tab cannot spend quota after session revocation.
- [ ] Recovery: save one answer in tab A, sign out in tab B, then ask a follow-up in A. Choose **Sign in again**, complete Google, and confirm the saved transcript and exact unsent draft return.
- [ ] Close/reopen How to use. Closing restores focus to its toggle.
- [ ] Ask a fictional question, inspect sources/links, and ask a follow-up relying on the original profile.
- [ ] Save, filter, reopen, continue, download Markdown, delete, clear all, and check two-tab sync. Confirm shared-profile history behavior is understood.
- [ ] At desktop, 400 px, and 320 px: no page overflow; answer tables scroll; header, composer, and History fit.
- [ ] Mobile History traps keyboard focus, locks background scrolling, and closes with Escape while restoring focus.
- [ ] Skip link, composer, source links, privacy notice, retry, history, and sign-out work by keyboard with visible focus.
- [ ] Rate-limit cooldown restores the draft, blocks sending, and survives New search. Prefer mocked/local checks instead of exhausting live paid calls.

Browser QA has not been performed on the Pages + Worker architecture. Earlier QA applied to the previous single-origin version.

## Prompts for different schools

These fictional profiles test relevance, not actual eligibility. Verify real programs with current official sources.

| Scenario                                | Prompt                                                                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| University of Illinois Urbana-Champaign | “For a fictional UIUC team in Illinois: we completed Regional I-Corps, have an agricultural sensor prototype, and have not formed a company. What funding or support should we explore next? Separate school, state, and national paths.” |
| Michigan State University               | “We are a fictional Michigan State team developing sustainable packaging. We completed customer interviews but not I-Corps and have no company. What should we do before applying for funding?”                                           |
| Purdue University                       | “For a fictional Purdue team in Indiana: we completed National I-Corps and formed an industrial robotics company. What non-dilutive funding categories might fit, and what facts must we verify?”                                         |
| University of Wisconsin–Madison         | “We are a fictional UW–Madison medical-device team in Wisconsin with a lab prototype and no company. Suggest a staged funding path without assuming clinical readiness or current deadlines.”                                             |
| University of Minnesota                 | “For a fictional University of Minnesota water-treatment team: we completed Regional I-Corps and need prototype validation. What school, state, and federal resources should we investigate?”                                             |
| Northwestern University                 | “We are a fictional Northwestern software team in Illinois with customer discovery and a pilot user. Compare funding that does not require giving up equity; explain what eligibility facts you need.”                                    |
| Outside the region                      | “For a fictional Georgia Tech team in Georgia with an energy prototype, which guidance applies nationally and which Great Lakes resources may not apply? Do not assume regional eligibility.”                                             |
| Missing details                         | “We need funding for our research. What key details do you need before suggesting a path?”                                                                                                                                                |

Follow-ups: “We are still at the same school and stage; narrow this to prototype validation,” “Which claims need verification on the funder's page?”, and “If we do not form a company, how does the path change?” Expect reuse of the original profile, clear uncertainty, and no invented amounts/deadlines/eligibility.
