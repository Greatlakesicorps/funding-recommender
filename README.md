# Funding Explorer

Great Lakes I-Corps Hub prototype for exploring follow-on funding and support. Visitors sign in with Google, describe their team, and ask follow-up questions. Answers come from U-M Maizey and include sources searched.

**Source repository:** [Greatlakesicorps/funding-recommender](https://github.com/Greatlakesicorps/funding-recommender). `Greatlakesicorps` is a GitHub user account; teammates need individual collaborator invitations.

## How it is hosted

| Part     | Where             | What it does                                                                          |
| -------- | ----------------- | ------------------------------------------------------------------------------------- |
| Site     | GitHub Pages      | Static Vite + React app. Google sign-in through Neon Auth. Search history in browser. |
| Chat API | Cloudflare Worker | `POST /api/chat`: verifies the sign-in token, rate-limits per user, calls Maizey.     |
| Identity | Neon Auth         | Google sign-in and the signed token the Worker verifies.                              |

The Maizey token never reaches the browser; it lives only in the Worker.

## Start here

| Task                                        | Guide                                |
| ------------------------------------------- | ------------------------------------ |
| Install, configure, run locally             | [Development](docs/development.md)   |
| Understand the request flow and code layout | [Architecture](docs/architecture.md) |
| Deploy the Worker and the Pages site        | [Deployment](docs/deployment.md)     |
| Check sign-in and try prompts for schools   | [Testing](docs/testing.md)           |
| Transfer accounts and responsibilities      | [Manager handoff](docs/handoff.md)   |

## Quick start

Use Node.js **22.18 or newer** (`.nvmrc` records the tested version, 24.4.0).

```sh
npm ci
```

Copy `.env.example` to `.env.local` and `.dev.vars`, fill in the values using the [development guide](docs/development.md#environment), then run the Worker and the site in two terminals:

```sh
npm run worker:dev
npm run dev
```

Open `http://localhost:5173`.

```sh
npm run check
```

This checks formatting, TypeScript, ESLint, automated tests, and the production build. Automated tests mock authentication and Maizey; they do not prove the real Google flow works. See [browser checks](docs/testing.md#browser-checks).

## Important limits

- Use fictional or public information during prototype testing. Verify funding eligibility, amounts, and deadlines with each funder.
- Saved searches live in browser local storage for 30 days after last use. They are shared across accounts using that browser profile and do not sync across devices. Signing out does not erase them.
- The Worker permits 12 accepted chat requests per signed-in user per 10-minute window. This is not a global spending cap.
- Google sign-in does not restrict access to a specific university or organization. The sign-in gate in the site is a convenience; the Worker's token check is what protects Maizey.
- Keep `.env.local`, `.dev.vars`, and credentials out of Git. Read the [handoff checklist](docs/handoff.md) before sharing or launching.

## Technology

React 19, Vite, Cloudflare Workers with a SQLite-backed Durable Object limiter, Neon Auth, `jose` for token verification, and U-M Maizey. Exact versions are in `package-lock.json`. The Neon Auth SDK is a beta dependency; upgrade deliberately and re-run the sign-in checks.
