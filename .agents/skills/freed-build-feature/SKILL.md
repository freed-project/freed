---
name: freed-build-feature
description: Scaffold product work in a dev-based worktree, implement it, verify it, launch the lightest useful local preview, and finish by committing, pushing, and opening a draft PR targeting dev. Use for Desktop, PWA, shared packages, sync, capture packages, release tooling, app behavior, and product docs targeting dev. Do not use for public marketing changes targeting www.
disable-model-invocation: true
---

# Build Feature

Create a product worktree branch from the latest remote `dev`, implement the feature or fix, verify it, launch the lightest useful local preview, and finish by committing the work, pushing the branch, and opening a draft PR to `dev`.

## Workflow

1. Confirm the work is product work targeting `dev`.
2. Reject or reroute public marketing work targeting `www`; use `freed-build-www` instead.
3. Fetch the latest remote refs first with `git fetch --all --prune`.
4. Check both `origin/dev` and `origin/main` before branching.
   - Confirm whether local `dev` or `main` are behind their remote counterparts.
   - If `origin/main` contains commits that are not in `origin/dev`, call that out before continuing so the user can decide whether `dev` needs to be refreshed first.
5. Create a new worktree branch from `origin/dev` using `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/dev --install full --target <desktop|pwa|shared>`.
   - When you are spinning up multiple speculative threads at once, prefer `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/dev --swarm --target <desktop|pwa|shared>` so bootstrap stays deferred until that thread actually needs verification or a preview.
6. If the worktree was created with deferred bootstrap on purpose, recover with `./scripts/worktree-bootstrap.sh <worktree> --target <desktop|pwa|shared>`.
7. Implement the requested change.
   - When a changed surface includes buttons, dialogs, or native fallback HTML, follow the repo's established primary and secondary control styling. Do not add hover lift, vertical motion, bounce, or ad hoc glossy or gradient CTA treatments.
8. Verify with focused tests, then broader checks when shared behavior changed.
9. Before opening the draft PR, launch the lightest useful local preview for the changed surface:
   - Default to `./scripts/worktree-preview.sh pwa` for normal product work, shared behavior, sync flows, reader UI, and most Desktop feature work.
   - Use `./scripts/worktree-preview.sh desktop` only when you need the Desktop shell running in the mocked browser preview.
   - Use `./scripts/worktree-preview.sh desktop --native` only when the change depends on real Tauri behavior such as native windowing, tray behavior, updater wiring, filesystem or process plugins, native OAuth windows, or Rust-side integrations.
   - When native Desktop preview is running, report the preview label so parallel native windows can be matched to the worktree and thread that launched them.
10. Never run `npm run <script> --workspace=...` from the repo root in this monorepo. Run commands from the workspace directory itself, and when a hoisted binary is needed, prefix `PATH` with `<worktree>/node_modules/.bin`.
11. Browser tooling is opt-in only. Do not launch Chrome DevTools MCP, Playwright MCP, or Computer Use unless the task explicitly needs browser automation or browser debugging.
12. When browser tooling was needed, clean the session before closeout with `./scripts/dev-session-clean.sh`.
13. Finish the branch with `./scripts/worktree-publish.sh --title "<conventional-commit title>" --summary "<user-facing change>" --test "<focused check>"`.
   - If the branch intentionally adds new files, stage them yourself first or re-run with `--include-untracked`.
14. Confirm the branch is pushed to `origin` and the PR targeting `dev` stays in draft state. Include the local preview URL or native preview label in the closeout.

## Scope

Default allowed paths include `packages/`, product docs under `docs/`, release tooling, shared app config, and product CI.

Do not use this skill for `website/` only marketing work, homepage copy, public roadmap presentation, or changelog presentation. Those changes target `www`.
