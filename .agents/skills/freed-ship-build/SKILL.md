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
   - `production` desktop releases ship from the `main` branch
   - `production` website deploys ship from the `www` branch
3. Before any production website deploy, ensure the website and changelog changes have already been merged to `www`.
   - Never assume a production website deploy can safely build from `main`
   - If a production release updates website changelog content, merge those reviewed website changes to `www` before the deploy runs
4. Run `./scripts/release.sh --channel=<dev|production>` to compute the next CalVer version and prepare the release tag.
5. Monitor the GitHub Actions build to ensure it succeeds for all platforms and that any production website deploy is pulled from `www`.
6. If the build fails:
   - Create a new branch and open a PR with the fix.
   - Iterate until CI passes on the PR.
   - Squash-merge the PR to `dev` for dev-release fixes.
   - Squash-merge production desktop release fixes to `main`.
   - Squash-merge production website fixes to `www`.
   - Initiate a follow-up build from the matching release branch.
7. Repeat until all platform builds are successful.
8. For production releases, ensure the reviewed website and changelog state is already merged to `www` before the workflow deploys `freed.wtf` from that branch.
9. After a dev release ships successfully, use `freed-ship-www` in changelog refresh mode so the static public changelog can include the newly published release without merging `dev` into `www`.
