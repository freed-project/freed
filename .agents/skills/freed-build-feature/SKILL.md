---
name: freed-build-feature
description: Scaffold product work in a dev-based worktree, implement it, validate it with the shared feature-tier runner, and finish by committing, pushing, and opening a draft PR. Use for Desktop, PWA, shared packages, sync, capture packages, release tooling, app behavior, and product docs targeting dev. Do not use for public marketing changes targeting www.
disable-model-invocation: true
---

# Build Feature

Create a product worktree branch from the latest remote `dev`, implement the feature or fix, validate it with the shared feature-tier runner, and finish by committing the work, pushing the branch, and opening a draft PR to `dev`.

## Workflow

1. Confirm the work is product work targeting `dev`.
2. Reject or reroute public marketing work targeting `www`; use `freed-build-www` instead.
3. Fetch the latest remote refs first with `git fetch --all --prune`.
4. Check both `origin/dev` and `origin/main` before branching.
   - Confirm whether local `dev` or `main` are behind their remote counterparts.
   - If `origin/main` contains commits that are not in `origin/dev`, call that out before continuing so the user can decide whether `dev` needs to be refreshed first.
5. Create a new worktree branch from `origin/dev` using `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/dev --install auto --target <desktop|pwa|shared>`.
6. Bootstrap dependencies only when the work actually needs them with `./scripts/worktree-bootstrap.sh <worktree> --target <desktop|pwa|shared>`.
7. Implement the requested change.
8. Run `npm run validate:feature` from the worktree.
   - Let the validator derive changed files from git by default.
   - Use `npm run validate:feature -- --changed-files <file>...` only when you need to pin an explicit file list for debugging or tests.
9. Escalate to broader checks only when the change crosses package boundaries or affects shared behavior.
   - Shared schema, release tooling, shared UI primitives, and cross-app flows should earn broader validation before publish.
   - Reserve the heaviest validation and release-shape smoke tests for `dev` integration and release prep, not every branch.
10. Launch a preview only when final verification needs one or the user explicitly asks:
   - For PWA work, use `./scripts/worktree-preview.sh pwa`.
   - For desktop work, default to `./scripts/worktree-preview.sh desktop`.
   - Use `./scripts/worktree-preview.sh desktop --native` only when Tauri-native behavior itself matters.
11. Finish the branch with `./scripts/worktree-publish.sh --title "<conventional-commit title>" --base dev --summary "<user-facing change>" --test "<focused check>"`.
12. Confirm the branch is pushed to `origin` and the new PR targeting `dev` is in draft state.

## Scope

Default allowed paths include `packages/`, product docs under `docs/`, release tooling, shared app config, and product CI.

Do not use this skill for `website/` only marketing work, homepage copy, public roadmap presentation, or changelog presentation. Those changes target `www`.
