---
name: freed-ship-build
description: Ship a new versioned desktop build via GitHub Actions. Use when asked to cut a release, ship a build, or fix a failing CI build pipeline.
disable-model-invocation: true
---

# Ship Build

Ship a new versioned build from the correct release branch. The flow is: prepare version + draft notes (`release.sh`), review and approve the notes, tag locally (`release-publish.sh`), push the tag to trigger the `Release Desktop App` workflow, monitor it, then run the post-release follow-ups.

## Workflow

1. Ask whether this should be a `dev` release or a `production` release before doing anything else.
2. Check out the correct branch with a clean working tree and fetch first with `git fetch origin dev main`:
   - `dev` releases are prepared and published from the `dev` branch
   - `production` releases are prepared and published from the `main` branch
   - Both `./scripts/release.sh` and `./scripts/release-publish.sh` refuse a dirty tree and refuse the wrong branch, so fix branch state before running them.
3. For `production` releases, verify promotion state before anything else:
   - `release.sh`, `release-publish.sh`, and the release workflow all run `node scripts/validate-release-promotion.mjs --from-ref=origin/dev --to-ref=HEAD` and fail fast when `main` does not match `dev` on product-owned paths.
   - If validation fails, run `./scripts/promote-dev-to-main.sh <worktree-path>`. It creates a promotion worktree, squash-merges `origin/dev` into a branch off `origin/main`, and opens a PR titled `chore: promote dev into main for production release`. Merge that PR, then re-fetch and start over from a fresh `main`.
   - Do not prepare a production release from a stale `main`.
4. Prepare the release with `./scripts/release.sh --channel=<dev|production>`:
   - Computes the next CalVer version (`YY.M.DDBUILD`, e.g. July 2 build 4 → `26.7.204`; dev channel appends `-dev` to the version and tag, while the app bundle version stays numeric for Windows MSI). Pass an explicit version as a positional argument only for manual overrides.
   - Writes the version into `packages/desktop/src-tauri/tauri.conf.json`, `packages/desktop/src-tauri/Cargo.toml`, `packages/desktop/package.json`, and `packages/pwa/package.json`.
   - Runs `node scripts/prepare-release-notes.mjs <version>` to generate draft artifacts: `release-notes/releases/v<version>.json`, `release-notes/releases/v<version>.md`, and `release-notes/daily/<channel>/<day-key>.json`.
   - Commits everything as `release: v<version>`. It does NOT create a tag and does NOT push.
5. Review and approve the release notes. This step is mandatory; publishing and CI both refuse unapproved notes:
   - Review and edit `release-notes/releases/v<version>.json`, the matching `.md`, and the daily file.
   - Set `"approved": true` in `release-notes/releases/v<version>.json`.
   - Commit the edit (convention: `release: approve v<version>`).
6. Tag with `./scripts/release-publish.sh <version>`:
   - Re-checks clean tree, branch, and (for production) promotion state; verifies `"approved": true`; runs `node scripts/validate-release-notes.mjs` over the release file plus any same-day prior release files it references.
   - Creates the annotated tag `v<version>` locally. It does NOT push; it prints the push command.
7. For `production` releases only, before pushing the tag: confirm the reviewed website and changelog state is already merged to `www`. The workflow's `Deploy Website` job checks out `www` and fails if `release-notes/releases/v<version>.json` is missing there.
8. Push branch and tag together: `git push origin <dev|main> --follow-tags`. The tag push triggers the `Release Desktop App` workflow (`.github/workflows/release.yml`).
9. Monitor the workflow run for the tag until every job succeeds. The job graph is: `promotion` (production promotion validation) → `notes` (loads the reviewed, approved notes; refuses to freestyle) → `validation` (`npm run validate:dev` or `npm run validate:production`) → `create-release` (draft GitHub release) → `release` matrix builds (macOS arm64, macOS x64, Windows x64, Linux x64; `fail-fast: false`, so one platform failing does not cancel the others) → `updater-manifest` (builds and uploads `latest.json`) → `publish` (flips the draft release to published) → `Deploy Website` and, for production, `Deploy PWA`.
10. If any job fails:
    - Create a new branch and open a PR with the fix. Iterate until CI passes on the PR.
    - Squash-merge the PR to `dev` for dev-release fixes, or to `main` for production-release fixes.
    - Start a follow-up release from step 4 on the matching release branch. Tags are immutable, so a follow-up build means a new version (the same-day build number increments automatically); the failed tag's draft release simply stays in draft.
11. Repeat until all platform builds are successful and the release is published (no longer draft).
12. Installed-build soaks and provider sync triggers follow the canonical contract in [docs/SOAK-AND-TRIGGERS.md](../../../docs/SOAK-AND-TRIGGERS.md). One-line summary: terminal-driven evidence only (`open -g`, logs, `runtime-health.jsonl`, `node scripts/dev-sync-trigger.mjs <provider>`; dev-channel prereleases enable the trigger automatically), and a release or soak run never stalls overnight for a click — ask with a 10 minute response window, then proceed, and ship a terminal trigger for anything recurring. Carry the same contract into generated release notes, soak instructions, and handoff prompts.
13. After every successful production release, create a dedicated reverse-integration branch from `origin/dev`, merge `origin/main` into it with a merge commit, run `npm run validate:dev`, and open a draft PR targeting `dev`.
14. After a dev or production release ships successfully, use `freed-ship-www` in changelog refresh mode so the static public changelog can include the newly published release without merging `dev` into `www`.
