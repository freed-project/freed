---
name: freed-build-www
description: Build Freed marketing-site work in a worktree based on origin/www, verify the website, and publish a pull request to www. Use for freed.wtf pages, marketing copy, legal pages, public changelog presentation, and public roadmap presentation. Use roadmap mode only from an approved docs/roadmap-status.json source commit, never by inferring status from prose or by merging dev into www.
disable-model-invocation: true
---

# Build WWW

Build one website change in the `www` lane and preserve its source identity through preview and review.

## Establish the contract

1. Confirm the destination is `www`. Route product code and product documentation to `freed-build-feature`.
2. Record the source request, allowed authority, and source commit SHA. Preparing a PR does not grant deployment authority.
3. Fetch remote refs, then create the worktree with `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/www --install full --target website`.
4. Keep changes within website and marketing-owned paths unless the user explicitly changes scope.

## Roadmap mode

1. Require an approved product source commit containing [docs/roadmap-status.json](../../../docs/roadmap-status.json).
2. Record the source commit SHA and manifest digest in the task and PR body.
3. Run `node scripts/validate-roadmap-status.mjs` in the source checkout before editing the website.
4. Map the manifest status exactly into `website/src/app/roadmap/RoadmapContent.tsx`. Do not infer status from phase prose, commit messages, or checkboxes outside the canonical manifest.
5. Reconcile the public phase description whenever the approved source commit changed that phase document, even when its status stayed the same.
6. Never merge or fast-forward `www` to `dev`. Transfer only the approved roadmap presentation change through this lane.

## Verify and publish

1. Run website commands from `website/`, with the worktree root `node_modules/.bin` on `PATH` when a hoisted binary is needed.
2. Run `npm run build` from `website/`.
3. Launch `./scripts/worktree-preview.sh website` on a fresh port returned by `scripts/lib/find-free-port.mjs`.
4. Use browser automation only when the task requires browser inspection. Keep the preview alive while the user is reviewing it.
5. Deploy a shareable preview only when requested, using `./scripts/vercel-deploy-preview.sh website`.
6. Publish through the owner-configured absolute signed host broker:
   `"$FREED_TRUSTED_PUBLISHER" --title "<conventional title>" --base www --summary "<change>" --test "cd website && PATH=../node_modules/.bin:$PATH npm run build" --ready`.
   It must live outside the candidate worktree and resolve the approved clean
   control-plane checkout from its private host config. Omit `--ready` while
   work remains. Stop if the signed broker, inner launcher, or target-scoped
   publisher lease is unavailable.
7. Confirm the PR targets `www`, the exact head SHA passed validation, and the PR state matches the granted authority.
8. Report the source commit, website commit, local preview URL, and remote preview deployment ID when one exists.
