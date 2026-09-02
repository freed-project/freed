---
name: freed-build-www
description: Build Freed marketing-site work from origin/www, verify it locally, and publish a pull request to www. Use for freed.wtf pages, public copy, legal pages, roadmap presentation, and changelog presentation. Do not use for product code or a production merge.
---

# Build WWW

Build one website change in the `www` lane and preserve its source identity through preview and review.

## Start from current policy

1. From the launcher checkout, run `git fetch --all --prune`.
2. Read `git show origin/www:AGENTS.md` before planning or authorization.
3. Confirm the task belongs on `www`. Product code and product documentation belong on `dev`.
4. For Level 2 or higher, create an isolated worktree with `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/www`.

## Establish the contract

1. Record the request, numbered authorization level, destination, and starting `origin/www` SHA.
2. Read [website instructions](../../../website/AGENTS.md) before changing `website/**`.
3. Keep work within website and marketing-owned paths. Stop if the task needs product-package changes.
4. For roadmap work, require canonical `docs/roadmap-status.json` from an approved product source checkout. Record its commit and digest, then run the source-checkout validation required by the website instructions before transfer. For changelog work, record the approved release artifact identity. Never infer product status from prose or merge a product branch into `www`.

Skill selection grants no authority. Building locally requires Level 2. Committing, pushing, and opening or updating a pull request require Level 3. Merging to `www` requires Level 6 or 7 because it triggers production deployment.

## Verify and publish

1. Run website commands from `website/`, with the worktree root `node_modules/.bin` on `PATH` when needed.
2. Run the focused checks for the changed behavior, then `npm run build` from `website/`.
3. Launch `npm run dev` from `website/` when rendered inspection is needed. Show visible previews only in the task's built-in Browser unless the owner explicitly requests an external surface.
4. Let Vercel Git integration create the normal pull request preview. If the owner requests a manual fallback, stop and route a separate helper-repair task. Do not invoke the current helper scripts.
5. Publish a conventional commit and pull request targeting `www` with the caller's existing GitHub authentication. Include source identity when applicable. Do not merge at Level 3.
6. Confirm the pull request base, exact head SHA, local validation, preview state, and granted authority.

Report the starting `www` SHA, website commit, checks, pull request, and preview identity when one exists.
