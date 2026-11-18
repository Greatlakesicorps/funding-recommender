# Deployment

[Overview](../README.md) · [Handoff](handoff.md) · [Testing](testing.md)

The company Cloudflare account hosts the static Vite site and chat API in one Worker. The intended URL is `https://funding-explorer.fancy-violet-d5d3.workers.dev`. Verify it and the full sign-in/chat flow before sharing it as a working release.

## Neon Auth and Google

1. Confirm the Neon Auth project/branch and its Auth URL. The same value is used by `NEON_AUTH_BASE_URL` in `wrangler.jsonc` and `VITE_NEON_AUTH_URL` when building the site.
2. Add the exact site origin to the branch's Neon trusted domains. Add local development origins as needed.
3. Configure team-owned Google OAuth credentials for production. The shared Neon Google provider is for development. Use the callback URL Neon supplies and its production setup guidance.
4. Test Google sign-in and sign-out on the real site. Google sign-in does not enforce university membership.

The site and Neon Auth have different origins, so third-party-cookie blocking can prevent sign-in. Test Safari and a private window before launch.

## Build and deploy

Confirm `npx wrangler whoami` is the intended account. `wrangler.jsonc` explicitly targets the company account and serves `dist/` while routing `/api/*` to the Worker. Set the private `MAIZEY_API_TOKEN` using the provider's secure secret input; never put it in source, a `VITE_*` variable, or a command argument:

```sh
npx wrangler secret put MAIZEY_API_TOKEN
```

Set `VITE_NEON_AUTH_URL` to the public Auth URL from `wrangler.jsonc`. Build for the site root with an empty `VITE_API_URL` so requests use the same origin. On PowerShell:

```powershell
$env:VITE_BASE = "/"
$env:VITE_API_URL = ""
$env:VITE_NEON_AUTH_URL = "<Neon Auth URL>"
npm run build
npm run worker:deploy
```

On macOS or Linux, set the same variables for the build:

```sh
VITE_BASE=/ VITE_API_URL='' VITE_NEON_AUTH_URL='<Neon Auth URL>' npm run build
npm run worker:deploy
```

Always rebuild before deploying: `wrangler deploy` uploads the existing `dist/`. Local `.env.local` values can otherwise cause the build to target a different API. The GitHub Actions workflow runs checks only; it does not deploy.

Keep the `FUNDING_RATE_LIMITER` binding, `FundingRateLimiter` export, and `funding-rate-limit-v1` migration tag. A different account or Worker name has separate limiter storage.

## Verify and recover

Check the site and `GET /api/health`, confirm an unauthenticated `POST /api/chat` returns 401, and complete the [browser checklist](testing.md#browser-checks), including real Google sign-in and an authenticated Maizey chat. Record the commit and Worker version. Automated tests mock the external providers.

For rollback, redeploy a previously verified commit or use Cloudflare's deployment history. A rollback does not undo secret rotation or provider settings. Preserve the Durable Object migration history.
