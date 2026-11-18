# Development

[Overview](../README.md) · [Architecture](architecture.md) · [Testing](testing.md)

## Requirements

- Node.js 22.18+ and npm; `.nvmrc` records the tested version, 24.4.0. Tests use native TypeScript loading.
- Windows PowerShell, macOS, or Linux.
- Access to the intended Neon Auth and Maizey projects. Request credentials through an approved secret-sharing channel.

Run commands from the repository root:

```sh
npm ci
```

The beta Neon dependency tree may emit peer-dependency warnings; avoid forced upgrades as a cleanup step.

## Environment

Two ignored files, both created from `.env.example`:

| File         | Read by         | Variable             | Purpose                                                                                             |
| ------------ | --------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| `.env.local` | Vite (the site) | `VITE_NEON_AUTH_URL` | Neon branch's Auth URL, including its `/auth` path. Public, not a secret.                           |
|              |                 | `VITE_API_URL`       | Worker origin, e.g. `http://localhost:8787` for `wrangler dev`.                                     |
| `.dev.vars`  | `wrangler dev`  | `MAIZEY_API_TOKEN`   | Private Maizey project token. Worker-only; also keys the conversation signature and limiter hashes. |
|              |                 | `NEON_AUTH_BASE_URL` | Same Auth URL as above; used to verify sign-in tokens.                                              |
|              |                 | `ALLOWED_ORIGINS`    | Comma-separated browser origins allowed to call the Worker. Overrides `wrangler.jsonc` locally.     |

PowerShell:

```powershell
Copy-Item .env.example .env.local
Copy-Item .env.example .dev.vars
```

Delete the lines each file does not use. Never put secrets in `VITE_*` variables: they are bundled into the public site.

## Sign-in setup

Funding Explorer uses required Google sign-in through Neon Auth. In the intended Neon branch, enable the Google provider and add `http://localhost:5173` and the production site origin to trusted domains. `localhost`, `127.0.0.1`, and different ports are distinct origins.

The existing development project uses Neon's shared Google credentials. Production needs team-owned OAuth credentials and approved origins; see [deployment](deployment.md#neon-auth-and-google). Apple and SSO are not configured.

## Commands

| Command                 | Purpose                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`           | Vite dev server with HMR on port 5173.                                                 |
| `npm run worker:dev`    | Worker locally on port 8787 with `.dev.vars` and a local limiter; build `dist/` first. |
| `npm run build`         | Typecheck and build the site into `dist/`. Does not deploy.                            |
| `npm run preview`       | Serve the built site locally.                                                          |
| `npm run worker:deploy` | Deploy the Worker with Wrangler. See [deployment](deployment.md).                      |
| `npm run format`        | Format source and docs. `format:check` verifies without rewriting.                     |
| `npm run typecheck`     | Check TypeScript for the site and the Worker.                                          |
| `npm run lint`          | Run ESLint.                                                                            |
| `npm test`              | Unit tests and the Worker integration test with mocked services.                       |
| `npm run check`         | Formatting, types, lint, tests, then build. Stops at first failure.                    |

To change the site port: `npm run dev -- --port 5174`, then add that origin to `ALLOWED_ORIGINS` and to Neon trusted domains.

## Troubleshooting

| Symptom                          | Check                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| "Sign-in is not configured"      | `VITE_NEON_AUTH_URL` missing from `.env.local`; restart `npm run dev`.                                           |
| Invalid origin during sign-in    | Exact scheme, host, and port in Neon trusted domains.                                                            |
| Google error or repeated sign-in | Branch URL, Google provider settings; some browsers block third-party cookies (see [deployment](deployment.md)). |
| Browser "CORS" error on chat     | The site's origin is missing from `ALLOWED_ORIGINS` (Worker) or `VITE_API_URL` is wrong.                         |
| Chat 401                         | Session missing/expired. **Sign in again** preserves the draft and saved-search ID.                              |
| Chat 429                         | Wait for the countdown. New search does not reset it.                                                            |
| Chat 503                         | Worker settings, Neon availability, Maizey token, and limiter binding. Auth/limiter failures block Maizey calls. |
| Cannot save history              | Browser storage may be blocked or full; the open transcript remains usable.                                      |

`.wrangler/` holds local Worker state, including local limiter storage. Restarting `wrangler dev` or clearing browser history does not reset server-side limits in production.
