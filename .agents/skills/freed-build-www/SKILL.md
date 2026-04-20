---
name: freed-build-www
description: Build marketing-site work in a www-based worktree, verify website changes, launch a local website preview, and prepare a draft PR targeting www. Use for homepage, public changelog presentation, public roadmap presentation, marketing copy, legal or marketing pages, and website-only changes intended for freed.wtf.
disable-model-invocation: true
---

# Build WWW

Create a marketing worktree branch from `www`, implement the website change, verify it, launch a local website preview, and open a draft PR targeting `www`.

## Workflow

1. Confirm the request is public marketing work targeting `www`.
2. Reject or reroute product work targeting `dev`; use `freed-build-feature` instead.
3. Create a new worktree branch from `www` using `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/www --install full --target website`.
4. If the worktree was created with deferred bootstrap on purpose, recover with `./scripts/worktree-bootstrap.sh <worktree> --target website`.
5. Keep changes scoped to marketing paths unless the user explicitly changes the destination.
6. Run website checks from the workspace directory, at minimum `cd website && PATH=../node_modules/.bin:$PATH npm run build`.
7. Before opening the draft PR, launch the local website preview with `./scripts/worktree-preview.sh website`.
8. Deploy `./scripts/vercel-deploy-preview.sh website` only when a shareable remote preview is needed.
9. Open a draft PR targeting `www`, and include the local preview URL in the closeout.

Never run `npm run <script> --workspace=...` from the repo root in this monorepo. Run website commands from `website/`, and prefix `PATH` with the worktree root `node_modules/.bin` when a hoisted binary like `next` or `tsx` is required.

## Scope

Default allowed paths:

- `website/**`
- marketing docs such as `docs/MARKETING.md`
- legal docs rendered by the marketing site
- `.agents/skills/freed-build-www/SKILL.md` when updating this skill

Require rerouting or explicit confirmation before touching:

- `packages/**`
- `scripts/release*`
- `.github/workflows/release.yml`
- `release-notes/**`
- `packages/desktop/**`
- `packages/pwa/**`
- root package files, unless the website build tooling requires it
