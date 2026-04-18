# Release Secrets Setup

The desktop release workflow (`.github/workflows/release.yml`) requires
certain secrets to be configured in the GitHub repository settings.

## Required (for any release)

| Secret | Description |
|--------|-------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/freed.key`. Used to sign update artifacts so the in-app updater can verify them. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the private key. Empty string if generated without one. |

The corresponding **public key** is already embedded in
`packages/desktop/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

## macOS Code Signing + Notarization

These are required for macOS release builds. The release workflow now fails
on macOS if any required Apple secret is missing so we never publish an
unsigned DMG by accident.

| Secret | Description |
|--------|-------------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_TEAM_ID` | 10-character Apple Team ID |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_PASSWORD` | App-specific password for notarization (generate at appleid.apple.com) |
| `APPLE_PROVIDER_SHORT_NAME` | Optional. Required only if the Apple ID belongs to multiple provider teams |

### How to export the certificate

1. Open Keychain Access
2. Find your "Developer ID Application" certificate
3. Right-click -> Export Items -> save as `.p12`
4. Base64-encode: `base64 -i certificate.p12 | pbcopy`
5. Paste into the `APPLE_CERTIFICATE` secret

### Notes

- `APPLE_SIGNING_IDENTITY` is recommended for explicitness, but Tauri can infer it from `APPLE_CERTIFICATE` if needed.
- `APPLE_PROVIDER_SHORT_NAME` is only needed when the Apple ID has access to multiple providers during notarization.

## Windows Code Signing (deferred)

Without these, Windows builds produce unsigned NSIS installers. SmartScreen
will show a warning on first download until the binary builds reputation or
an EV certificate is used.

Options:
- **Azure Key Vault** with `relic` for EV code signing
- **SignPath** (free for open source)
- **SSL.com** cloud-hosted EV certificates

## Adding Secrets to GitHub

1. Go to `github.com/freed-project/freed/settings/secrets/actions`
2. Click "New repository secret"
3. Add each secret listed above

## Explicit marketing site deploys and automatic PWA deploys

`freed.wtf` is controlled by the long-lived `www` branch. Product releases from
`dev` or `main` do not deploy the marketing site directly. Use
`freed-ship-www` to publish current `www`, refresh the static changelog, or
sync approved `main` changes into `www`.

Branch promotion rules:

- `dev` carries ongoing product work and dev releases.
- `main` is only for reviewed production release promotion and rare production hotfixes.
- Promote `dev` into `main` when shipping production. Do not treat `main` as a peer development branch.
- If `main` gets a production-only fix or release adjustment that `dev` does not already have, merge or cherry-pick it back into `dev` immediately after the production release is stable.
- `www` stays separate from product branches. Sync approved `main` changes into `www` when the public website or checked-in changelog needs them. Never sync `www` from `dev`.
- If release tooling or website deploy helpers are duplicated across long-lived branches, update the matching copies in the same sweep or note the intentional divergence in the PR.

`VERCEL_TOKEN` is required for GitHub Actions preview deploys and the automated
PWA production deploy after a production desktop release.

Without it, desktop releases still complete and publish on GitHub, but the PWA
deploy step and GitHub Actions owned preview deploys are skipped.

Marketing preview routing:

- PRs targeting `www` build and deploy website previews
- PRs targeting `dev` build and deploy PWA previews
- Desktop Playwright E2E runs for product PRs targeting `dev`
- `website/vercel.json` only allows Git-triggered Vercel deploys from `www`
- `packages/pwa/vercel.json` disables Git-triggered Vercel deploys entirely
- GitHub Actions owns website and PWA previews through the deploy helpers

## Website GitHub release token

The website's download and desktop update routes can authenticate to the
GitHub Releases API with any of these environment variable names:

- `GITHUB_RELEASES_TOKEN`
- `GITHUB_TOKEN`
- `GH_TOKEN`
- `RELEASE_GITHUB_TOKEN`

On Vercel, the current project configuration uses `GITHUB_RELEASES_TOKEN`.

## Drafting release notes

`./scripts/release.sh` now prepares a release in two stages:

```bash
./scripts/release.sh --channel=production
./scripts/release.sh --channel=dev
```

That command:

1. bumps app versions
2. generates draft files under `release-notes/`
3. commits the draft release prep

Optional local environment variable:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Enables stronger AI-generated draft release notes during the prepare step. |

Review and edit:

- `release-notes/releases/vX.Y.Z.json`
- `release-notes/releases/vX.Y.Z.md`
- `release-notes/daily/<channel>/YY.M.D.json`

Set `"approved": true` in the release JSON once the copy is ready, then commit
that review change.

The release JSON now has a stricter structure:

- `release.deck`: terse noun-phrase heading for the most meaningful shipped outcomes
- `release.features`: up to 3 headline bullets
- `release.fixes`: concrete bug fixes and repairs for that day, capped at 15 lines
- `release.followUps`: the remaining supporting changes for that day, capped at 15 lines
- `daily.preferredDeck`: optional exact heading override for the latest release of a day

The generator now rewrites bullets into user-facing release-note language.
It should describe outcomes, not commit mechanics. If a day produces too many
raw items, related fixes and follow-ups are consolidated into grouped lines.

For the latest release of a day, the generated copy is cumulative. It should
describe everything newly shipped since the previous day, not just the delta
from the previous same-day build. Production releases also pull forward
relevant intermediary dev prereleases that landed after the previous
production release, so the public changelog card does not forget what just
shipped.

Freed Desktop update prompts use only the reviewed deck line. They do not
render release bullets inside the install toast.

## How to publish a reviewed release

```bash
./scripts/release.sh 26.4.107 --channel=production
# review the generated release-notes files
git add release-notes
git commit -m "docs: review release notes for v26.4.107"
./scripts/release-publish.sh 26.4.107
git push origin main --follow-tags
```

The `v*` tag triggers the release workflow which builds all platforms and
creates a **draft** GitHub Release using the approved checked-in release body.
After all platform builds succeed, the workflow publishes that release
automatically.

If `VERCEL_TOKEN` is configured, production releases deploy `packages/pwa/` so
the PWA version stays aligned with the shipped desktop release. After any
GitHub release is published, the release workflow also redeploys the public
website from current `www` so the static changelog snapshot is rebuilt against
the latest release list. Production website deploys still require the reviewed
website and changelog state to already be merged into `www`.

Dev releases are published as GitHub prereleases with a `-dev` suffix and do
not trigger production PWA deploys. They do trigger the public changelog
refresh from current `www`, so `freed.wtf/changelog/all` can pick up the dev
release without waiting for a later production ship. Use `freed-ship-www` as
the manual fallback if the website refresh needs to be rerun independently.

For dev releases, only the Git tag and release metadata use the `-dev` suffix.
The app package versions written to Desktop and PWA package files stay numeric,
for example tag `v26.4.1402-dev` writes app version `26.4.1402`. Windows MSI
rejects prerelease labels in installer versions, so the release channel must
come from the tag, not the bundled app version.

The in-app updater will pick the new GitHub release up automatically.

`./scripts/release-publish.sh` and the release workflow both validate that:

- the deck does not duplicate a feature or follow-up
- there are no more than 3 features
- there are no more than 15 fixes or 15 follow-ups after consolidation
- the latest release of a day still carries forward earlier same-day highlights
- the latest production release also carries forward intermediary dev prereleases since the prior production release

To regenerate historical artifacts and rewrite older GitHub release bodies:

```bash
node scripts/backfill-release-notes.mjs --rewrite-github
```

## Cloudflare release index follow-up

The Cloudflare R2 updater migration should also publish release metadata for
the website changelog. When that lands, the website changelog generator should
read Cloudflare release metadata at build time instead of GitHub Releases.

Expected public objects:

- `https://updates.freed.wtf/releases/index.json`
- `https://updates.freed.wtf/releases/vX.Y.Z.json`
- `https://updates.freed.wtf/releases/vX.Y.Z-dev.json`

The index must include production releases and dev prereleases. The changelog
must stay a checked-in static build snapshot so public website visitors never
wait on release metadata fetches.
