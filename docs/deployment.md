# Cloudflare deployment

[Overview](../README.md) · [Handoff](handoff.md) · [Testing](testing.md)

## Current status

The intended arrangement is GitHub source under `Greatlakesicorps`, with the full application on Cloudflare Workers. No GitHub deployment workflow is configured; publishing source alone will not update the site.

The personal test Worker is `funding-explorer`, at `https://funding-explorer.jaleeldrones1.workers.dev`. The first test version was deployed November 11, 2026, before the latest local authentication/onboarding work. Its current code and access behavior were not reverified during this cleanup. Do not assume it is the current authenticated release.

Public launch and institutional hosting approval remain pending. Choose the intended account, Worker, and domain before deployment. Use fictional inputs for tests.

## Authentication before deployment

1. Confirm the intended Neon Auth project/branch and its Auth URL.
2. Configure team-owned Google OAuth credentials. The current shared Google provider is for development. Use the callback/redirect values supplied by that Neon branch in the Google application.
3. Register the exact deployment origin in Neon trusted domains. Register local origins separately. Preview URLs are distinct origins and do not automatically become valid auth destinations.
4. Set a separate stable production `NEON_AUTH_COOKIE_SECRET` with at least 32 random characters. Rotation invalidates existing app cookies.
5. Test sign-in, sign-out, and session recovery on the actual deployed origin.

Google sign-in does not enforce university membership. Implement an explicit server-side access rule if that is required. Apple and SSO remain future work.

## Build and inspect

```sh
npm run check
```

The final step builds `dist/server/wrangler.json`, the Worker bundle, and static assets. Configuration comes from `vite.config.ts`, especially `localBindingConfig`. There is no authored root `wrangler.jsonc`; do not edit generated configuration.

Inspect the generated JSON for:

- The intended Worker name (`funding-explorer` in current source).
- `nodejs_compat` in compatibility flags.
- Binding `FUNDING_RATE_LIMITER` to class `FundingRateLimiter`.
- Migration tag `funding-rate-limit-v1` with `new_sqlite_classes: ["FundingRateLimiter"]`.

Keep migration history and the class export when updating an existing Worker. Moving accounts or Worker names creates separate storage. Do not rename bindings or migrations to clear usage.

## Runtime settings and deploy

The Worker needs **all three** values from `.env.example` at runtime: `MAIZEY_API_TOKEN`, `NEON_AUTH_BASE_URL`, and `NEON_AUTH_COOKIE_SECRET`.

Authenticate Wrangler to the intended account and check its identity:

```sh
npx wrangler login
npx wrangler whoami
```

For an intentional test deployment, after confirming `.env.local` contains the intended environment's values:

```sh
npx wrangler deploy --config dist/server/wrangler.json --secrets-file .env.local
```

This uploads the Worker **and that file's values**. Do not use a developer's local settings for production accidentally. Obtain production settings through the approved secrets process, using an ignored file or host secret configuration. Never commit real secrets. All three values can be uploaded as encrypted Worker secrets; the Auth URL is configuration rather than a password, but keeping it with the secrets avoids incomplete setup.

See Cloudflare's [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) references. Build-time access and Worker runtime settings are separate; a successful build does not prove Neon or Maizey is correctly configured.

## Verify a release

Record the commit, account, Worker, deployed version ID, URL, date, and operator. Perform the [browser checklist](testing.md#browser-checks) on that URL. Confirm signed-out chat requests cannot spend quota and Google returns to that exact origin. Automated tests mock the provider.

Assets may take a short time to become available after upload. Check asset requests and Worker logs if loading fails. Keep tokens, cookies, and private team inputs out of screenshots and shared logs.

Preview URLs and `workers.dev` are enabled unless configured otherwise. To reduce reachable URLs after an approved domain is ready, deliberately set `preview_urls: false` and, once the custom domain works, `workers_dev: false` in `localBindingConfig`. Rebuild and inspect the emitted settings. This cleanup does not change public access settings.

## Recovery

Identify the last verified compatible version in Cloudflare deployment history. Review its authentication first: the initial test version predates required sign-in, so reverting to it could restore anonymous access. Code rollback does not undo provider settings, secret rotation, or data migrations.

For an incident, restrict traffic using approved account controls, then have the responsible operator select and verify a compatible release. Preserve migration history. Consult Cloudflare's [rollback guide](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) for platform limits. Deleting the Worker/storage is not a routine rollback.

## Automation later

Once the repository and institutional host exist, a workflow can install with `npm run install:ci`, run `npm run check`, and invoke Wrangler for the approved environment. Keep deployment credentials in protected repository/environment secrets and require the team's release review. No automated deployment or credential provisioning is enabled by this cleanup.
