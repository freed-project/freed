# Release Secrets Setup

The desktop release workflow (`.github/workflows/release.yml`) requires
certain secrets to be configured in the GitHub repository settings.

## Required (for any release)

| Secret                               | Description                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | Contents of `~/.tauri/freed.key`. Used to sign update artifacts so the in-app updater can verify them. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the private key. Empty string if generated without one.                                   |

The corresponding **public key** is already embedded in
`packages/desktop/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

## macOS Code Signing + Notarization

These are required for macOS release builds. The release workflow now fails
on macOS if any required Apple secret is missing so we never publish an
unsigned DMG by accident.

| Secret                       | Description                                                                |
| ---------------------------- | -------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | Base64-encoded `.p12` Developer ID Application certificate                 |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` file                                               |
| `APPLE_SIGNING_IDENTITY`     | e.g. `Developer ID Application: Your Name (TEAMID)`                        |
| `APPLE_TEAM_ID`              | 10-character Apple Team ID                                                 |
| `APPLE_ID`                   | Apple ID email for notarization                                            |
| `APPLE_PASSWORD`             | App-specific password for notarization (generate at appleid.apple.com)     |
| `APPLE_PROVIDER_SHORT_NAME`  | Optional. Required only if the Apple ID belongs to multiple provider teams |

### How to export the certificate

1. Open Keychain Access
2. Find your "Developer ID Application" certificate
3. Right-click -> Export Items -> save as `.p12`
4. Base64-encode: `base64 -i certificate.p12 | pbcopy`
5. Paste into the `APPLE_CERTIFICATE` secret

### Notes

- `APPLE_SIGNING_IDENTITY` is recommended for explicitness, but Tauri can infer it from `APPLE_CERTIFICATE` if needed.
- `APPLE_PROVIDER_SHORT_NAME` is only needed when the Apple ID has access to multiple providers during notarization.

## Windows Code Signing (planned)

Without these, Windows builds produce unsigned NSIS installers. SmartScreen
will show a warning on first download until the binary builds reputation or
Windows signing is enabled.

The planned provider is Microsoft Artifact Signing. The implementation plan
and disabled scaffold live in `docs/WINDOWS-SIGNING.md`.

Planned GitHub configuration:

| Secret or variable                     | Description                                                       |
| -------------------------------------- | ----------------------------------------------------------------- |
| `AZURE_TENANT_ID`                      | Microsoft Entra tenant ID                                         |
| `AZURE_CLIENT_ID`                      | App registration client ID for GitHub Actions OIDC                |
| `WINDOWS_TRUSTED_SIGNING_ACCOUNT_NAME` | Microsoft Artifact Signing account name                           |
| `WINDOWS_TRUSTED_SIGNING_CERT_PROFILE` | Public Trust certificate profile name                             |
| `WINDOWS_TRUSTED_SIGNING_ENDPOINT`     | Region endpoint, for example `https://eus.codesigning.azure.net/` |

Do not add `AZURE_CLIENT_SECRET` unless GitHub Actions OIDC cannot be made to
work. If a client secret is used temporarily, document its expiration and
remove it after OIDC works.

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
- `main` carries reviewed production promotions, release-only prep PRs, and rare production hotfixes.
- Promote `dev` into `main` when shipping production. Do not treat `main` as a peer development branch.
- After every production release, open a dedicated reverse-integration PR that merges `main` back into `dev`.
- If `main` gets a production-only fix or release adjustment, include it in that reverse-integration PR immediately after the production release is stable.
- `www` stays separate from product branches. Sync approved `main` changes into `www` when the public website or checked-in changelog needs them. Never sync `www` from `dev`.
- If release tooling or website deploy helpers are duplicated across long-lived branches, update the matching copies in the same sweep or note the intentional divergence in the PR.

`VERCEL_TOKEN` is required for the website preview workflow and the automated
PWA production deploy after a production desktop release.

Without it, desktop releases still complete and publish on GitHub, but the PWA
production deploy step and website preview workflow are skipped.

Marketing preview routing:

- PRs targeting `www` build and deploy website previews
- merges to `dev` redeploy `dev-app.freed.wtf` through Vercel Git deploys
- Vercel preview deployments handle PWA branch and PR previews
- Desktop Playwright E2E runs for product PRs targeting `dev`
- `website/vercel.json` only allows Git-triggered Vercel deploys from `www`
- `packages/pwa/vercel.json` leaves Git deployments enabled so `dev-app.freed.wtf` can follow `dev`
- GitHub Actions owns website previews, while Vercel handles PWA Git previews

## Website GitHub release token

The website's download and desktop update routes can authenticate to the
GitHub Releases API with any of these environment variable names:

- `GITHUB_RELEASES_TOKEN`
- `GITHUB_TOKEN`
- `GH_TOKEN`
- `RELEASE_GITHUB_TOKEN`

On Vercel, the current project configuration uses `GITHUB_RELEASES_TOKEN`.

## Release tag authority

Release tags are an external trust boundary. GitHub loads a tag-push workflow
from the tagged commit, so a workflow cannot prove that its own source was
reviewed. Release tags remain intentionally locked until the owner completes
this runbook. Checked-in publisher code is not proof that the App or its live
rulesets are active.

### Apply the bootstrap lockdown

The checked-in `.github/rulesets/release-tag-lockdown.json` policy blocks
creation, update, and deletion for every `refs/tags/v*` tag with no bypass.
Select the repository Node version, then apply the lockdown before building or
provisioning the publisher. The App helper uses that exact Node executable when
it activates the binding:

```bash
nvm use --silent
node scripts/sync-github-rulesets.mjs --lock-release-tags --apply
```

Do not add a user, administrator role, team, deploy key, personal access token,
general automation actor, or the PR publisher App as a bypass.

### Prepare the native publisher

Run the owner helper from the reviewed source checkout:

```bash
node scripts/release-tag-publisher-install.mjs prepare
```

The helper runs `scripts/release-tag-publisher-build.sh` in a private temporary
directory, builds the native Swift host, installs it as a root-owned, read-only
executable at this fixed path, and removes the obsolete Keychain provisioner:

- `/Library/Application Support/Freed/release-tag-publisher`

The binding does not exist yet, so publication still fails closed.

### Create and install the release App

Use the manifest helper for normal provisioning:

```bash
node scripts/create-release-github-app.mjs
```

The helper opens a loopback GitHub manifest flow for the private organization
App `Freed Release Publisher`, with slug `freed-release-publisher`. The manifest
requests only repository Contents write permission. GitHub adds Metadata read
implicitly. The App subscribes to no events, has no OAuth flow, and keeps its
required webhook inactive.

The helper converts the manifest and atomically saves the returned private key
at
`~/.freed/credentials/github-apps/freed-release-publisher.private-key.pem`.
The file is current-user owned, mode `0600`, stored under mode `0700`
credential directories, and never stored in the repository or placed in
process arguments. Initial creation fails closed if a credential already exists
instead of replacing a working key. The helper then installs a root-owned
pending binding at
`/Library/Application Support/Freed/release-tag-publisher.json`, opens the App
installation page, and waits for an active selected-repository installation
whose only repository is `freed-project/freed`. The native host can attest and
verify an installation while the binding is pending, but it cannot publish a
tag. Only exact installation proof promotes the binding to `active`.

The binding pins the repository, App ID, App slug, publisher path, and publisher
SHA-256 digest. The nonsecret App identity is also recorded at
`~/.freed/automation/release-tag-publisher/github-app.json`. Neither file
contains the private key.

Routine readiness checks validate the root-owned binding and publisher digest
without accessing the credential. Explicit installation verification and tag
publication are the only normal operations that read the private key. Those
credential-bearing processes have hard deadlines. A legacy release publisher
Keychain item is ignored and cannot prompt or block release automation.

### Activate the split tag rulesets

Add the returned App ID to `.github/rulesets/release-tags.json` as the only
`Integration` bypass actor, then merge that change through an owner-reviewed
pull request. After the exact App ID is present on the protected branch, apply
the split policies:

```bash
node scripts/sync-github-rulesets.mjs \
  --release-tags \
  --release-app-id <github-app-id> \
  --release-app-slug freed-release-publisher \
  --apply
```

Activation verifies the live lockdown, private App metadata through the native
App JWT, an independent unsuspended organization installation, exact selected
repository, exact permissions, empty event list, root-owned binding, executable
digest, local-file App proof, and native publisher attestation. It applies
`Freed release tag creation` with the dedicated App as its only bypass and
`Freed release tag immutability` with no bypass. It reads both policies back
from GitHub before removing the bootstrap lockdown. A partial activation leaves
the lockdown in place.

GitHub returns tag update rules without the branch-only fetch and merge
parameter. The checked-in tag policies use that canonical parameter-free form.
The verifier accepts an older explicit `false` value but rejects `true` or any
unexpected update parameters.

### Verify, publish, and recover

Verify the installed publisher and its live App installation at any time:

```bash
node scripts/release-tag-publisher-install.mjs verify
node scripts/validate-release-tag-authority.mjs --repo=freed-project/freed
```

`./scripts/release-publish.sh <version>` remains the only release entry point.
It rejects a dirty or wrong branch, a commit that differs from the protected
remote tip, an unapproved or mismatched release receipt, an existing tag, a
missing live policy, a changed publisher digest, or a mismatched App
installation. The native host requests one short-lived installation token
scoped to `freed-project/freed`, rechecks the remote branch and committed
receipt, creates one annotated tag, verifies the result, and revokes the token.
It exposes no arbitrary ref, update, or deletion operation.

Read-only GitHub checks may use the current `gh` login. Tag creation never
falls back to `GITHUB_TOKEN`, `GH_TOKEN`, a personal access token, a user push,
or a general automation credential.

Automated key rotation is disabled until it can atomically preserve the current
key, verify the replacement, and restore the previous key after any failure.
Do not replace the fixed credential manually. A reviewed recovery procedure
must first keep the previous GitHub key active, stage the replacement without
overwriting the live file, verify it through the native host, atomically switch
the file, and only then remove the previous key from GitHub.

Automated credential revocation is also disabled until a reviewed archival
flow can remove both the fixed credential and root-owned binding without
leaving tag creation partially authorized. To retire the publisher, restore
the no-bypass lockdown first, confirm it is active, and then use that reviewed
archival procedure:

```bash
node scripts/sync-github-rulesets.mjs --lock-release-tags --apply
```

The installer fails closed if `rotate` or `revoke` is run.

The installer exposes `provision`, `activate`, and `finalize` only for
controlled recovery. `activate` leaves the binding pending. `finalize` repeats
the exact installation proof before it installs the active binding. The
manifest helper is the normal first-time setup path and saves the initial
private key directly to the fixed local credential file.

## Drafting release notes

Create a fresh `chore/release-<version>` worktree from current `origin/main` for
production, or from current `origin/dev` for dev. `./scripts/release.sh`
prepares a release in two stages:

```bash
./scripts/release.sh
./scripts/release.sh --channel=dev
```

With no arguments, the script auto-computes the next production version. The
dev channel is always explicit.

That command:

1. bumps app versions
2. generates draft files under `release-notes/`
3. commits the draft release prep
4. refuses long-lived or detached branches, non-release branch names, and any branch not at the exact current channel base

Optional local environment variable:

| Variable         | Description                                                                |
| ---------------- | -------------------------------------------------------------------------- |
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
# promote reviewed product state first when main does not match dev
node scripts/validate-release-promotion.mjs --from-ref=origin/dev --to-ref=origin/main
./scripts/promote-dev-to-main.sh ../freed-prod-promotion
# merge the promotion PR
git fetch origin main

# create production prep from the exact current main commit
./scripts/worktree-add.sh ../freed-release-v26.4.107 -b chore/release-v26.4.107 origin/main --target shared
cd ../freed-release-v26.4.107
./scripts/release.sh 26.4.107
# review the generated release-notes files
git add release-notes
git commit -m "docs: review release notes for v26.4.107"
# validate and publish a ready release-only PR targeting main
npm run validate:release
./scripts/worktree-publish.sh --base main --ready --title "chore: prepare v26.4.107"
# merge the release-prep PR, then update a clean local main branch
cd /path/to/clean-main-checkout
git fetch origin main
git merge --ff-only origin/main

./scripts/release-publish.sh 26.4.107
```

For a dev release, create the same `chore/release-<version>` branch from
`origin/dev`, run `./scripts/release.sh --channel=dev`, validate with
`npm run validate:feature`, and publish the reviewed PR with `--base dev`.
After it merges, tag the exact updated `origin/dev` commit with
`./scripts/release-publish.sh <version>-dev`.

Production release prep requires an exact current `origin/main` base after any
required product promotion. Dev release prep requires exact current
`origin/dev`. Both return through branch protection. `release-publish.sh`
refuses to tag unless local `HEAD` exactly equals the target remote branch, so
it cannot tag an unmerged local release commit. It also binds the requested tag,
channel, Desktop, PWA, Tauri, and Cargo versions to the reviewed release
artifact. The artifact records the product commit used to prepare its notes.
Production artifacts also record the exact promoted dev commit whose product
tree matched main at preparation time. Any later product change makes the
release identity stale and requires a new release-prep PR.

PRs targeting `main` have a scope guard. Product changes reach `main` only
through a branch named `chore/promote-dev-to-main-*`, and that promotion must
still match current `origin/dev`. A `chore/release-*` PR may carry only the
version files and release-note artifacts recognized as release-only metadata.
Website-owned files remain rejected there.

The `v*` tag triggers the release workflow which builds all platforms and
creates a **draft** GitHub Release using the approved checked-in release body.
After all platform builds succeed, the workflow publishes that release
automatically. Before any secret-bearing job, the workflow requires the tag
commit to remain in protected `origin/main` history for production or protected
`origin/dev` history for dev, then reruns the release identity validator. The
trusted release App proves exact branch-tip equality when it creates the tag.
Ancestry in the delayed workflow allows the branch to advance without breaking
an honest release.

If `VERCEL_TOKEN` is configured, production releases deploy `packages/pwa/` to
`app.freed.wtf` so the PWA version stays aligned with the shipped desktop
release. After any GitHub release is published, the release workflow also
redeploys the public website from current `www` so the static changelog
snapshot is rebuilt against the latest release list. Production website deploys
still require the reviewed website and changelog state to already be merged
into `www`. Production identity uses the fixed promoted dev receipt recorded
during preparation. A later dev commit cannot change or invalidate that release.
After the production release is stable, open the dedicated `main` back into
`dev` reverse-integration PR before more feature work piles onto `dev`.

Dev releases are published as GitHub prereleases with a `-dev` suffix and do
not deploy the PWA. `dev-app.freed.wtf` instead follows merges to `dev`
through Vercel Git deploys. Dev releases still trigger the public changelog
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

- the tag, channel, numeric bundle versions, and release artifact agree
- no product-owned file changed after the artifact's recorded product commit
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
