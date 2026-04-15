---
name: freed-build-feature
description: Scaffold product work in a dev-based worktree, implement it, verify it, and launch the relevant app preview. Use for Desktop, PWA, shared packages, sync, capture packages, release tooling, app behavior, and product docs targeting dev. Do not use for public marketing changes targeting www.
disable-model-invocation: true
---

# Build Feature

Create a product worktree branch from `dev`, implement the feature or fix, verify it, and launch the relevant preview.

## Workflow

1. Confirm the work is product work targeting `dev`.
2. Reject or reroute public marketing work targeting `www`; use `freed-build-www` instead.
3. Create a new worktree branch from `dev` using `./scripts/worktree-add.sh`.
4. Implement the requested change.
5. Verify with focused tests, then broader checks when shared behavior changed.
6. Launch the relevant preview:
   - For PWA work, deploy or run the PWA preview.
   - For desktop work, use the desktop E2E test harness or Tauri preview as appropriate.
7. Open a PR targeting `dev` when the work is ready.

## Scope

Default allowed paths include `packages/`, product docs under `docs/`, release tooling, shared app config, and product CI.

Do not use this skill for `website/` only marketing work, homepage copy, public roadmap presentation, or changelog presentation. Those changes target `www`.
