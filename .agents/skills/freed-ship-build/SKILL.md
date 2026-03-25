---
name: freed-ship-build
description: Ship a new versioned desktop build via GitHub Actions. Use when asked to cut a release, ship a build, or fix a failing CI build pipeline.
disable-model-invocation: true
---

# Ship Build

Ship a new versioned build from the main branch using GitHub Actions.

## Workflow

1. Ensure you are on the `main` branch with a clean working tree.
2. Run `./scripts/release.sh` to compute the next CalVer version and tag the release.
3. Monitor the GitHub Actions build to ensure it succeeds for all platforms.
4. If the build fails:
   - Create a new branch and open a PR with the fix.
   - Iterate until CI passes on the PR.
   - Squash-merge the PR to `main`.
   - Initiate a follow-up build from `main`.
5. Repeat until all platform builds are successful.
