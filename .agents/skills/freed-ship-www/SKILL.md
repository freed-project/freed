---
name: freed-ship-www
description: Ship reviewed Freed marketing changes from www, refresh the public changelog, or publish an approved roadmap update. Use for a production merge or deployment of freed.wtf. Require Level 6 or 7, exact commit and deployment identity, and source-attributed data.
---

# Ship WWW

Deploy reviewed `www` state and prove which commit produced the live site.

## Safety contract

1. Require Level 6 or 7. Record the task, source branch, reviewed head SHA, expected public change, and source artifact identity when applicable.
2. Refresh remote refs and read `git show origin/www:AGENTS.md` before acting.
3. Require passed checks for the exact reviewed head. Do not substitute an older green run.
4. Never merge or fast-forward `www` to `dev`. Transfer only reviewed marketing changes through this lane.
5. Vercel Git integration is the primary production path. A merge to `www` deploys production.
6. If the owner requests a manual Vercel fallback, stop and route a separate helper-repair task. The current helper scripts are not supported until that repair is reviewed and verified. Never substitute a raw Vercel command from repository root.

Skill selection does not grant production authority.

## Modes

### Ship a reviewed WWW pull request

1. Confirm the pull request targets `www`, its exact head passed required checks, and it contains only the approved website slice.
2. Squash merge with the pull request title as the commit subject.
3. Verify the resulting `origin/www` SHA and the Vercel production deployment created from that SHA.

### Refresh the changelog

1. Require the published release ID, tag, channel, source SHA, and approved release-note artifact.
2. Generate the checked-in presentation from current `www` without merging `dev`.
3. Build, review, merge, and verify that the intended release appears at the production URL.

### Publish roadmap status

1. Require canonical `docs/roadmap-status.json` from the approved product source commit and record its digest.
2. Run the source-checkout validation required by [website instructions](../../../website/AGENTS.md) before transfer.
3. Map statuses and descriptions into `website/src/app/roadmap/RoadmapContent.tsx` exactly. Do not infer status from phase prose.
4. Build, review, merge, and verify from `www`. Do not combine this with unrelated product promotion.

## Close out

Record the reviewed head, deployed `www` SHA, Vercel deployment ID, deployment time, production URL, build result, and source release or roadmap identity. Verify that the production response belongs to the new deployment. An old healthy URL does not prove the requested commit shipped.
