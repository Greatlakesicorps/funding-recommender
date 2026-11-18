# Manager handoff

[Overview](../README.md) · [Deployment](deployment.md)

## Ownership status

Source lives in the [Greatlakesicorps/funding-recommender](https://github.com/Greatlakesicorps/funding-recommender) repository. `Greatlakesicorps` is a GitHub user account, not an organization; teammates need individual collaborator invitations. Repository access does not grant access to the services below.

| Service        | Current resource                                                                                   | Handoff action                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub         | Private repository `Greatlakesicorps/funding-recommender`; GitHub Pages hosts the site             | Grant individual manager access; assign branch/review administration and Pages settings.                                                         |
| Cloudflare     | Personal test Worker `funding-explorer`, `funding-explorer.jaleeldrones1.workers.dev` (chat API)   | Choose approved account/domain and assign deployment, logs, secrets, billing, and recovery access. Verify how to transfer or recreate resources. |
| Neon Auth      | Personal project `funding-explorer` (`square-bonus-21290837`), main branch `br-tiny-leaf-bemdx3df` | Assign project/organization administration and billing. Confirm the Auth URL, Google provider, trusted origins, and account recovery.            |
| Google OAuth   | Shared Neon development provider                                                                   | Configure a team-owned production application, administrators, support contact, and correct Neon callbacks/app origins.                          |
| U-M Maizey     | Project `98ae38ad-ee38-4ddb-a92e-24c5f3cff364`                                                     | Assign project/content administration, token rotation, quotas/billing monitoring, and support; confirm permitted external use.                   |
| Domain/support | No approved production arrangement recorded                                                        | Assign DNS, privacy approval, support contact, incident response, and ongoing ownership.                                                         |

Resource IDs are references, not credentials. Confirm current account details with the responsible owner. Update this record when transfers actually happen.

## Transfer checklist

- [x] Put source under the confirmed GitHub owner and record the repository URL in `README.md`.
- [ ] Grant individual access; verify the manager can clone and administer resources without the original developer's browser session.
- [ ] Transfer or recreate Cloudflare/Neon resources in approved accounts with billing/recovery contacts.
- [ ] Deliver credentials through an approved secret manager. Keep `.env.local` and `.dev.vars` out of Git and archives.
- [ ] Review token exposure history. An earlier `.env.example` reportedly held a real Maizey token; rotate it (`wrangler secret put MAIZEY_API_TOKEN` after rotating in Maizey) if that file was shared. The current template contains placeholders only.
- [ ] Configure production Google OAuth and exact origins. Apple and SSO are not implemented.
- [ ] Confirm Maizey data sources, update cadence, retention/deletion, permissions, quotas, and spending alerts.
- [ ] Enable Pages (Source: GitHub Actions) and set the `VITE_API_URL` / `VITE_NEON_AUTH_URL` repository variables.
- [ ] Complete setup and validation from a clean environment on the incoming maintainer's machine.
- [ ] Record the verified commit, Worker version, and Pages URL after each launch deployment.
- [ ] Complete ITS/privacy/hosting/billing approvals and assign support before public launch.
- [ ] After verifying the replacement, decide who retires the personal test deployment and removes obsolete access.

## Source package

Include authored source, `package.json`, `package-lock.json`, configuration, tests, docs, `.github/`, and `.env.example`. Preserve the limiter implementation and migration configuration in `wrangler.jsonc`.

Exclude `.env.local`, `.dev.vars*`, `.neon`, credentials, `node_modules/`, `dist/`, `.wrangler/`, TypeScript build state, logs, browser profiles, and generated archives. `.gitignore` covers local data. Review staged files before the first commit; a ZIP made without ignore rules can still include secrets.

This workspace was nested inside an unrelated Git repository. Check `git rev-parse --show-toplevel` before committing. If it points above this project, use a separate repository/checkout for Funding Explorer. Do not commit through the parent or reuse its remote.

## Limitations to explain

- Required Google sign-in does not enforce institutional membership.
- History is shared browser-profile storage, unsynced across devices. Sign-out leaves it behind; use **Clear all** on shared computers.
- Browser deletion does not delete Maizey logs. The prototype notice is not an approved institutional privacy policy.
- Sources are documents searched, not proof for every claim. Verify funding information and maintain Maizey content.
- Per-user limiting does not cap global costs.
- The site and Neon Auth are on different origins, so third-party-cookie blocking (Safari, some Chrome settings) can break sign-in.
- Real Google browser checks are separate from automated tests. The Neon Auth SDK is a beta dependency.
- Production Apple, SSO, and account-specific histories are not configured.

## Acceptance exercise

Have the incoming maintainer follow [development](development.md), run `npm run check`, and complete [browser checks](testing.md#browser-checks). They should identify the active Maizey project, update guidance, deploy the Worker and the Pages site, find deployment history, and explain data storage. Record the accepting maintainer, date, repository URL, verified deployed version, and remaining launch work after completion.
