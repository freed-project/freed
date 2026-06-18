---
name: freed-ship-build
description: Ship a new versioned desktop build via GitHub Actions. Use when asked to cut a release, ship a build, or fix a failing CI build pipeline.
disable-model-invocation: true
---

# Ship Build

Ship a new versioned build from the correct release branch using GitHub Actions.

## Workflow

1. Ask whether this should be a `dev` release or a `production` release before doing anything else.
2. Ensure you are on the correct branch with a clean working tree:
   - `dev` releases ship from the `dev` branch
   - `production` releases ship from the `main` branch
3. For `production` releases, fetch `origin/dev` and `origin/main` first.
   - If `main` does not match `dev` on product-owned paths, run `./scripts/promote-dev-to-main.sh <worktree-path>` and merge that promotion PR before tagging anything.
   - Do not prepare a production release from a stale `main`. The release scripts and release workflow now fail fast when `dev` is ahead.
4. Run `./scripts/release.sh --channel=<dev|production>` to compute the next CalVer version and prepare the release tag.
5. For `production` releases, ensure the reviewed website and changelog state is already merged to `www` before `./scripts/release-publish.sh` pushes the tag.
6. Monitor the GitHub Actions build to ensure it succeeds for all platforms.
7. If the build fails:
   - Create a new branch and open a PR with the fix.
   - Iterate until CI passes on the PR.
   - Squash-merge the PR to `dev` for dev-release fixes, or to `main` for production-release fixes.
   - Initiate a follow-up build from the matching release branch.
8. Repeat until all platform builds are successful.
9. For installed-build soaks on the user's primary machine, keep validation terminal driven whenever possible. Use logs, runtime-health samples, process samples, and native triggers instead of System Events clicks or foreground UI automation.
   - Dev-channel prereleases enable the native trigger automatically, and local soak builds can be launched with `FREED_ENABLE_DEV_SYNC_TRIGGERS=1`. Drive them with `node scripts/dev-sync-trigger.mjs facebook`, `instagram`, or `linkedin`.
   - The trigger must call the normal in-app provider refresh path and preserve auth, pause state, cooldowns, and rate limits.
   - Production builds keep reliability and memory recovery behavior, but the raw file trigger stays gated to dev-channel installs, debug builds, or explicit `FREED_ENABLE_DEV_SYNC_TRIGGERS=1` launches until it has a user-facing permission model.
10. A long-running release or soak run must not pause until morning solely because a button click would continue validation. If a foreground click is genuinely necessary, ask with a 10 minute response window, then proceed if the user is unavailable. If the action will recur, add and ship a terminal trigger. Sitting idle until morning is not acceptable when a trigger can be built or the user has given a timeout path.
11. Carry the same rule into generated release notes, soak instructions, and handoff prompts. A release plan must not leave the next operator with "click this in the app" as the only path forward. Use an existing terminal trigger, add the missing trigger, or state the 10 minute timeout path.
12. After every successful production release, create a dedicated reverse-integration branch from `origin/dev`, merge `origin/main` into it with a merge commit, run `npm run validate:dev`, and open a draft PR targeting `dev`.
13. After a dev or production release ships successfully, use `freed-ship-www` in changelog refresh mode so the static public changelog can include the newly published release without merging `dev` into `www`.
