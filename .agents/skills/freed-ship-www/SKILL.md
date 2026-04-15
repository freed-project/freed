---
name: freed-ship-www
description: Publish freed.wtf from www, refresh the static changelog after releases, ship merged PRs targeting www, or sync approved main changes into www. Use for production marketing deploys and changelog refreshes. Never fast-forward www to dev.
disable-model-invocation: true
---

# Ship WWW

Publish the public marketing site from `www` or refresh its static changelog.

## Modes

### Ship Current WWW

1. Check out or update `www`.
2. Verify the working tree is clean.
3. Run `./scripts/vercel-deploy-production.sh website`.
4. Inspect the production deployment and report the URL.

### Ship Merged WWW PR

1. Verify the PR targeting `www` is merged.
2. Update local `www` from origin.
3. Run `./scripts/vercel-deploy-production.sh website`.
4. Inspect the production deployment and report the URL.

### Refresh Changelog

1. Use this after a dev or production desktop release is published.
2. Update local `www` from origin.
3. Rebuild and deploy the website from current `www`.
4. Never merge or fast-forward `www` to `dev`.

### Sync From Main

1. Fetch `main` and `www`.
2. If `www` can fast-forward to `main`, fast-forward it.
3. If `www` has marketing-only commits, merge `main` into `www`.
4. Reject the sync if divergence includes non-marketing files.
5. Build and deploy the website from `www`.

## Safety Rules

- Always preserve `--scope aubreyfs-projects` on Vercel CLI calls by using the repo deploy helpers.
- Never run raw `vercel` from the repo root.
- Never fast-forward `www` to `dev`.
- Reject production deploys when the changed path set includes product files unless the user explicitly changes the plan.
