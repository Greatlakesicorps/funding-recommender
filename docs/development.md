# Development

[Overview](../README.md) · [Architecture](architecture.md) · [Testing](testing.md)

## Requirements

- Node.js 22.18+ and npm; `.nvmrc` records the tested version, 24.4.0. Tests use native TypeScript loading and module hooks.
- Windows PowerShell, macOS, or Linux. Normal local development does not require Bash.
- Access to the intended Neon Auth and Maizey projects. Request credentials through an approved secret-sharing channel.

Run commands from the repository root. Use the committed npm lockfile and one installer at a time:

```sh
npm run install:ci
```

This runs a locked install with development/optional dependencies and isolates parent-workspace discovery. The beta Neon dependency tree may emit peer-dependency warnings; avoid forced upgrades as a cleanup step.

## Environment

Copy `.env.example` to `.env.local`. PowerShell:

```powershell
Copy-Item .env.example .env.local
```

macOS/Linux:

```sh
cp .env.example .env.local
```

| Variable                  | Purpose                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAIZEY_API_TOKEN`        | Private Maizey project token. Server-only upstream calls, conversation-cookie signing, and limiter IP hashing. A Toolkit API key is not interchangeable.    |
| `NEON_AUTH_BASE_URL`      | Intended Neon branch's Auth URL, including its `/auth` path. Copy from the project's Auth configuration.                                                    |
| `NEON_AUTH_COOKIE_SECRET` | Stable random secret of at least 32 characters for SDK cookies. Use the same value across instances in one environment and a separate value for production. |

Generate a cookie secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste it into the ignored local file. Never put secrets into browser code, `NEXT_PUBLIC_*` variables, screenshots, or issues. `.env.example` is tracked and contains placeholders only. Both local and hosted runtimes need all three values.

## Sign-in setup

Funding Explorer uses required Google sign-in through Neon Auth. Enable the Google provider in the intended branch and trust `http://127.0.0.1:5173` as an app origin. `localhost`, `127.0.0.1`, and different ports are distinct origins; register each one you use.

The existing development project uses Neon's shared Google credentials. Production needs team-owned OAuth credentials and approved origins; see [deployment](deployment.md#authentication-before-deployment). Apple and SSO are not configured.

The starter's optional ChatGPT sign-in helpers are unrelated to Funding Explorer's Neon session and do not bypass the required sign-in.

## Commands

| Command                | Purpose                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run dev`          | Vinext dev server with HMR, default port 5173. Use the printed loopback URL.                                     |
| `npm run build`        | Generate the Worker, static assets, and config under `dist/`. Does not deploy.                                   |
| `npm start`            | Preview the built Worker locally with Wrangler. Build first. Register the printed origin with Neon if different. |
| `npm run format`       | Format owned source/docs, excluding starter/vendor files listed in `.prettierignore`.                            |
| `npm run format:check` | Check formatting without rewriting.                                                                              |
| `npm run typecheck`    | Check TypeScript without emitting.                                                                               |
| `npm run lint`         | Run ESLint.                                                                                                      |
| `npm test`             | Unit and local Workers tests with mocked upstream services.                                                      |
| `npm run check`        | Formatting, types, lint, tests, then production build. Stops at first failure.                                   |
| `npm run db:generate`  | Optional starter D1 migration generation; not used by current funding or Neon Auth flows.                        |

To change ports: `npm run dev -- --port 5174`, then trust the new origin. Do not run two previews on the same port.

## Troubleshooting

| Symptom                           | Check                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Invalid origin during sign-in/out | Exact scheme, host, and port in Neon trusted domains. Restart after environment changes.                            |
| Google error or repeated sign-in  | Branch URL, provider settings, cookie-secret consistency, and fresh top-level sign-in.                              |
| Chat 401                          | Live session missing/expired. **Sign in again** temporarily preserves the draft and saved-search ID.                |
| Chat 429                          | Wait for countdown; shared IPs share allowance. New search does not reset it.                                       |
| Chat 503                          | Runtime settings, Neon availability, Maizey token, and limiter binding. Auth/limiter failures block upstream calls. |
| Cannot save history               | Browser storage may be blocked or full; the open transcript remains usable.                                         |
| Built preview is stale            | Rebuild and restart `npm start`; `dist/` is generated.                                                              |

Ignored `.vinext/`, `.wrangler/`, and `.sites-runtime/` hold local tool state. `.wrangler/state` includes local limiter storage. Clearing browser history or restarting the preview does not reset server-side limits.

Clean clones default to the portable execution profile. Keep the Sites/Vinext build plugins unless deliberately replacing that integration. See [starter reference](starter-reference.md) for inherited internals.
