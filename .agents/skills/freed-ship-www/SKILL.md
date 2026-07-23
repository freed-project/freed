---
name: freed-ship-www
description: Publish verified Freed marketing changes from www, refresh the public changelog after a release, or apply an approved structured roadmap update. Use for production freed.wtf deployments. Require explicit deployment authority, exact commit and deployment identity, and source-attributed roadmap data. Never fast-forward www to dev.
disable-model-invocation: true
---

# Ship WWW

Deploy only reviewed state from `www` and prove which commit produced the live site.

## Safety contract

1. Record the task ID, granted deployment authority, source branch, exact commit SHA, and expected public change.
2. Require a clean `www` checkout whose SHA matches the reviewed PR or approved deployment request.
3. Never merge or fast-forward `www` to `dev`. Sync approved product-owned files from `main` only when the requested mode requires it.
4. Use repository Vercel helpers so every command retains the required `aubreyfs-projects` scope. Never run raw Vercel commands from the repository root.

## Modes

### Ship current or merged WWW

1. Confirm the requested SHA is present on `origin/www` and required checks passed for that SHA.
2. Run the website build from `website/`.
3. Run `./scripts/vercel-deploy-production.sh website` only with explicit deployment authority.

### Refresh changelog

1. Require the published release ID, tag, channel, source SHA, and approved release-note artifact.
2. Update the static changelog from current `www` without merging `dev`.
3. Build, deploy, and verify the release appears on the production URL.

### Publish roadmap status

1. Require the approved source commit and digest for [docs/roadmap-status.json](../../../docs/roadmap-status.json).
2. Run `node scripts/validate-roadmap-status.mjs` against the source data.
3. Confirm `website/src/app/roadmap/RoadmapContent.tsx` matches the manifest exactly. Do not infer status from phase prose.
4. Build and deploy from `www`. Do not combine this with unrelated product promotion.

## Close out

Record the deployed `www` SHA, Vercel deployment ID, deployment time, production URL, build result, and source release or roadmap identity. Verify the production response belongs to the new deployment. An old healthy URL is not evidence that the requested commit shipped.
