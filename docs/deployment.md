# Deployment

[Overview](../README.md) · [Handoff](handoff.md) · [Testing](testing.md)

The site (GitHub Pages) and the chat API (Cloudflare Worker) deploy separately. Deploy the Worker first so the site has an API to call.

## 1. Neon Auth and Google

1. Confirm the intended Neon Auth project/branch and its Auth URL (the same value goes in `NEON_AUTH_BASE_URL` in `wrangler.jsonc` and in the `VITE_NEON_AUTH_URL` repository variable).
2. Add the Pages **origin** to Neon trusted domains: `https://<owner>.github.io` (no path). Add `http://localhost:5173` for local work.
3. Configure team-owned Google OAuth credentials for production. The shared Neon Google provider is for development. Add the Pages origin to the Google app's authorized origins and use the callback URL Neon supplies.
4. Test sign-in and sign-out on the real Pages URL.

Google sign-in does not enforce university membership. Add a rule in `worker/index.ts` if that is required. Apple and SSO are future work.

The site signs in through Neon from a different origin than Neon's auth host, so browsers that block third-party cookies (notably Safari) may fail to keep the session. Test Safari and a private window before launch; a custom domain shared by the site and Neon Auth would avoid this.

## 2. Cloudflare Worker

Settings:

- `ALLOWED_ORIGINS` and `NEON_AUTH_BASE_URL` are plain variables in `wrangler.jsonc`. Set `ALLOWED_ORIGINS` to the Pages origin (no path or trailing slash needed) plus any others, e.g. `https://greatlakesicorps.github.io,http://localhost:5173`.
- `MAIZEY_API_TOKEN` is a secret. Never put it in `wrangler.jsonc`.

Authenticate to the intended account, set the secret, then deploy:

```sh
npx wrangler login
npx wrangler whoami
npx wrangler secret put MAIZEY_API_TOKEN
npm run worker:deploy
```

Wrangler prints the Worker URL (for example `https://funding-explorer.<account>.workers.dev`). Check `GET <url>/api/health` returns `{"ok":true}`.

Keep the `FUNDING_RATE_LIMITER` binding, the `FundingRateLimiter` export, and the `funding-rate-limit-v1` migration tag when updating an existing Worker. Moving accounts or Worker names creates separate storage. Do not rename bindings or migrations to clear usage.

See Cloudflare's [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) references.

## 3. GitHub Pages

1. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**. Pages on a private repository requires a paid GitHub plan.
2. Under **Settings → Secrets and variables → Actions → Variables**, add:
   - `VITE_API_URL`: the Worker URL from step 2 (no trailing slash).
   - `VITE_NEON_AUTH_URL`: the Neon Auth URL.
3. Push to `main` (or run the **Deploy site to GitHub Pages** workflow). It runs `npm run check`, builds with `VITE_BASE=/<repository-name>/`, and publishes `dist/`.

These variables are public; they end up in the site's JavaScript. Do not store secrets in them.

Local preview of the sub-path build:

```sh
$env:VITE_BASE="/funding-recommender/"; npm run build; npm run preview
```

## Verify a release

Record the commit, Worker version ID, Pages URL, date, and operator. Perform the [browser checklist](testing.md#browser-checks) on the Pages URL. Confirm an unauthenticated `POST /api/chat` returns 401 and that Google returns to the exact Pages origin. Automated tests mock the provider.

## Recovery

- **Site:** re-run an earlier successful workflow, or revert the commit on `main`.
- **Worker:** in Cloudflare, identify the last verified version in deployment history and roll back, or redeploy an earlier commit. A rollback does not undo secret rotation or provider settings. See Cloudflare's [rollback guide](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
- **Incident:** restrict traffic through approved account controls (for example, remove the origin from `ALLOWED_ORIGINS` and redeploy, or rotate `MAIZEY_API_TOKEN`). Preserve migration history; deleting the Worker/storage is not a routine rollback.

To reduce reachable URLs once an approved domain exists, set `"workers_dev": false` in `wrangler.jsonc` after the custom route works.
