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

## Automatic website + PWA deploys

`VERCEL_TOKEN` is required if you want the release workflow to deploy
`freed.wtf` and `app.freed.wtf` automatically after a production desktop
release is published.

Without it, the release still completes and publishes on GitHub, but the
workflow will skip the website and PWA deploy steps.

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
from the previous same-day build.

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

If `VERCEL_TOKEN` is configured, production releases then:

- redeploys `website/` so `freed.wtf/changelog` rebuilds its checked-in
  snapshot against the published GitHub release
- deploys `packages/pwa/` so the PWA version stays aligned with the shipped
  desktop release

Dev releases are published as GitHub prereleases with a `-dev` suffix and do
not trigger the production Vercel deploy steps.

The in-app updater will pick the new GitHub release up automatically.

`./scripts/release-publish.sh` and the release workflow both validate that:

- the deck does not duplicate a feature or follow-up
- there are no more than 3 features
- there are no more than 15 fixes or 15 follow-ups after consolidation
- the latest release of a day still carries forward earlier same-day highlights

To regenerate historical artifacts and rewrite older GitHub release bodies:

```bash
node scripts/backfill-release-notes.mjs --rewrite-github
```
