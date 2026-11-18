# Funding Explorer

Great Lakes I-Corps Hub prototype for exploring follow-on funding and support. Visitors sign in with Google, describe their team, and ask follow-up questions. Answers come from U-M Maizey and include sources searched.

**Source repository:** [Greatlakesicorps/funding-recommender](https://github.com/Greatlakesicorps/funding-recommender) (private), with the application on Cloudflare Workers. `Greatlakesicorps` is a GitHub user account; teammates need individual collaborator invitations. Service-account transfers remain pending. GitHub Pages alone cannot run the server routes.

**Release status:** local Google sign-in works through Neon's development provider. The [personal Cloudflare test URL](https://funding-explorer.jaleeldrones1.workers.dev) predates the latest authentication and onboarding work; do not assume it matches this source. Public launch, production OAuth, and institutional ownership are pending.

## Start here

| Task                                                 | Guide                                          |
| ---------------------------------------------------- | ---------------------------------------------- |
| Install, configure, run locally, troubleshoot        | [Development](docs/development.md)             |
| Understand routes, state, limits, and code locations | [Architecture](docs/architecture.md)           |
| Build, deploy, verify, and recover                   | [Deployment](docs/deployment.md)               |
| Transfer accounts and responsibilities               | [Manager handoff](docs/handoff.md)             |
| Check sign-in and try prompts for different schools  | [Testing](docs/testing.md)                     |
| Understand inherited framework tooling               | [Starter reference](docs/starter-reference.md) |

## Quick start

Use Node.js **22.18 or newer**. `.nvmrc` records the tested version, **24.4.0**. Run from the directory containing `package.json`:

```sh
npm run install:ci
```

Copy `.env.example` to `.env.local` and fill in **all three** values using the [development guide](docs/development.md#environment). Then:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. Google sign-in is required; trust that exact origin in Neon Auth.

```sh
npm run check
```

This checks formatting, TypeScript, ESLint, automated tests, and the production build. Automated tests mock authentication and Maizey; they do not prove the real Google flow works. See [browser checks](docs/testing.md#browser-checks).

## Important limits

- Use fictional or public information during prototype testing. Verify funding eligibility, amounts, and deadlines with each funder.
- Saved searches live in browser local storage for 30 days after last use. They are shared across accounts using that browser profile and do not sync across devices. Signing out does not erase them.
- The server permits 12 accepted chat requests per IP per 10-minute window. This is not a global spending cap.
- Apple and university SSO are not implemented. Google sign-in does not restrict access to a specific university or organization.
- Keep `.env.local`, credentials, and runtime state out of Git. Read the [handoff checklist](docs/handoff.md) before sharing or launching.

## Technology

React 19, Next.js APIs through Vinext/Vite, Cloudflare Workers with a SQLite-backed Durable Object limiter, Neon Auth, and U-M Maizey. Exact versions are recorded in `package-lock.json`. Vinext and the Neon Auth SDK are beta dependencies; upgrade deliberately and rerun authentication and deployment checks.
