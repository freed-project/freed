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
3. Run `./scripts/release.sh --channel=<dev|production>` to compute the next CalVer version and prepare the release tag.
4. Monitor the GitHub Actions build to ensure it succeeds for all platforms.
5. If the build fails:
   - Create a new branch and open a PR with the fix.
   - Iterate until CI passes on the PR.
   - Squash-merge the PR to `dev` for dev-release fixes, or to `main` for production-release fixes.
   - Initiate a follow-up build from the matching release branch.
6. Repeat until all platform builds are successful.
7. After a dev or production release ships successfully, use `freed-ship-www` in changelog refresh mode so the static public changelog can include the newly published release without merging `dev` into `www`.
