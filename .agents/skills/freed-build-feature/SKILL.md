---
name: freed-build-feature
description: Scaffold product work in a dev-based worktree, implement it, verify it, and launch a preview only when the work actually needs one. Use for Desktop, PWA, shared packages, sync, capture packages, release tooling, app behavior, and product docs targeting dev. Do not use for public marketing changes targeting www.
disable-model-invocation: true
---

# Build Feature

Create a product worktree branch from the latest remote `dev`, implement the feature or fix, verify it, and launch the relevant preview only when the work reaches final verification or the user explicitly asks for one.

## Workflow

1. Confirm the work is product work targeting `dev`.
2. Reject or reroute public marketing work targeting `www`; use `freed-build-www` instead.
3. Fetch the latest remote refs first with `git fetch --all --prune`.
4. Check both `origin/dev` and `origin/main` before branching.
   - Confirm whether local `dev` or `main` are behind their remote counterparts.
   - If `origin/main` contains commits that are not in `origin/dev`, call that out before continuing so the user can decide whether `dev` needs to be refreshed first.
5. Create a new worktree branch from `origin/dev` using `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/dev --install full --target <desktop|pwa|shared>`.
6. If the worktree was created with deferred bootstrap on purpose, recover with `./scripts/worktree-bootstrap.sh <worktree> --target <desktop|pwa|shared>`.
7. Implement the requested change.
8. Verify with focused tests, then broader checks when shared behavior changed.
9. Launch a preview only when final verification needs one or the user explicitly asks:
   - For PWA work, use `./scripts/worktree-preview.sh pwa`.
   - For desktop work, default to `./scripts/worktree-preview.sh desktop`.
   - Use `./scripts/worktree-preview.sh desktop --native` only when Tauri-native behavior itself matters.
10. Open a PR targeting `dev` when the work is ready.

## Scope

Default allowed paths include `packages/`, product docs under `docs/`, release tooling, shared app config, and product CI.

Do not use this skill for `website/` only marketing work, homepage copy, public roadmap presentation, or changelog presentation. Those changes target `www`.
