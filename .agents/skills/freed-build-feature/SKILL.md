---
name: freed-build-feature
description: Scaffold product work in a dev-based worktree, implement a runnable slice, launch the lightest useful local preview early, validate it with the shared feature-tier runner before publish, and finish by committing, pushing, and opening a draft PR targeting dev. Use for Desktop, PWA, shared packages, sync, capture packages, release tooling, app behavior, and product docs targeting dev. Do not use for public marketing changes targeting www.
disable-model-invocation: true
---

# Build Feature

Create a product worktree branch from the latest remote `dev`, implement enough of the feature or fix to run, launch the lightest useful local preview early, iterate against that preview, then validate with the shared feature-tier runner before committing the work, pushing the branch, and opening a draft PR to `dev`.

## Workflow

1. Confirm the work is product work targeting `dev`.
2. Reject or reroute public marketing work targeting `www`; use `freed-build-www` instead.
3. Fetch the latest remote refs first with `git fetch --all --prune`.
4. Check both `origin/dev` and `origin/main` before branching.
   - Confirm whether local `dev` or `main` are behind their remote counterparts.
   - Run `node scripts/validate-main-backflow.mjs --dev-ref=origin/dev --main-ref=origin/main`.
   - If the backflow guard fails, call that out before continuing so the user can decide whether `dev` needs to be refreshed first.
   - Do not block on raw commit graph differences alone. Squash-merged promotion and reverse-integration PRs can leave `main` commits absent from `dev` even when the content is already represented on `dev`.
5. Create a new worktree branch from `origin/dev` using `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/dev --install full --target <desktop|pwa|shared>`.
   - When you are spinning up multiple speculative threads at once, prefer `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/dev --swarm --target <desktop|pwa|shared>` so bootstrap stays deferred until that thread actually needs verification or a preview.
6. If the worktree was created with deferred bootstrap on purpose, recover with `./scripts/worktree-bootstrap.sh <worktree> --target <desktop|pwa|shared>`.
7. Implement a runnable slice of the requested change.
8. Launch the lightest useful local preview for the changed surface as soon as the branch can run. Always start previews on an explicit fresh port so parallel agent threads do not reuse or stomp each other's previews.
   - Compute a port first with `PORT=$(node scripts/lib/find-free-port.mjs <default-port>)`, then pass `--port "$PORT"` to `./scripts/worktree-preview.sh`.
   - Use default port seed `1421` for PWA, `1422` for mocked Desktop, and `3000` for website only when this skill is intentionally routing a product-adjacent website check.
   - Default to `PORT=$(node scripts/lib/find-free-port.mjs 1421) && ./scripts/worktree-preview.sh pwa --port "$PORT"` for normal product work, shared behavior, sync flows, reader UI, and most Desktop feature work.
   - Use `PORT=$(node scripts/lib/find-free-port.mjs 1422) && ./scripts/worktree-preview.sh desktop --port "$PORT"` only when you need the Desktop shell running in the mocked browser preview.
   - Use `./scripts/worktree-preview.sh desktop --native` only when the change depends on real Tauri behavior such as native windowing, tray behavior, updater wiring, filesystem or process plugins, native OAuth windows, or Rust-side integrations.
   - Do not run `./scripts/dev-session-clean.sh` just to relaunch a preview. That kills tracked previews for other work unless scoped, which is how parallel threads end up doing slapstick with ports.
   - When native Desktop preview is running, report the preview label so parallel native windows can be matched to the worktree and thread that launched them.
9. Iterate against the preview. Use focused checks during iteration only when they answer an immediate implementation question, such as a targeted unit test, Desktop e2e test, browser check, or preview compile failure.
   - For queued UI polish, keep stacking the user's small visual fixes in the same worktree and PR.
   - For each small UI fix, run only the focused test or browser check that proves that behavior.
   - Do not run `npm run validate:feature` after every small visual adjustment.
   - If more queued tasks arrive while you are working, finish the current focused loop, then continue to the next queued task before publishing.
10. Run `npm run validate:feature` from the worktree before publishing the draft PR, or earlier only when the user asks for a full validation checkpoint.
   - Let the validator derive changed files from git by default.
   - Use `npm run validate:feature -- --changed-files <file>...` only when you need to pin an explicit file list for debugging or tests.
   - This is a pre publish gate, not an after-every-command inner loop.
11. Escalate to broader checks only when the change crosses package boundaries or affects shared behavior.
   - Shared schema, release tooling, shared UI primitives, and cross-app flows should earn broader validation before publish.
   - Reserve the heaviest validation and release-shape smoke tests for `dev` integration and release prep, not every branch.
   - Do not simplify test suites blindly. Profile specific slow commands first, then trim redundant coverage with evidence.
12. Never run `npm run <script> --workspace=...` from the repo root in this monorepo. Run commands from the workspace directory itself, and when a hoisted binary is needed, prefix `PATH` with `<worktree>/node_modules/.bin`.
13. Browser tooling is opt-in only. Do not launch Chrome DevTools MCP, Playwright MCP, or Computer Use unless the task explicitly needs browser automation or browser debugging.
14. When browser tooling was needed, clean browser automation only after preserving any preview the user still needs. Do not run broad cleanup while the local preview should remain open.
   - If cleanup is needed before PR merge or thread archive, scope it to this worktree with `./scripts/dev-session-clean.sh --worktree <worktree>`.
   - Before reporting final status, list this thread's preview with `./scripts/worktree-processes.sh list --worktree <worktree>` so the URL and owner are clear.
   - When the PR is merged, the worktree is removed, or the thread is archived, stop only this thread's preview with `./scripts/worktree-processes.sh stop --worktree <worktree> --target <pwa|desktop>`.
   - Never stop previews from other worktrees unless the user explicitly asks for global cleanup.
15. Finish the branch with `./scripts/worktree-publish.sh --title "<conventional-commit title>" --summary "<user-facing change>" --test "<focused check>"`.
   - If the branch intentionally adds new files, stage them yourself first or re-run with `--include-untracked`.
16. Confirm the branch is pushed to `origin` and the PR targeting `dev` stays in draft state. Include the local preview URL or native preview label in the closeout.
   - When a changed surface includes buttons, dialogs, or native fallback HTML, follow the repo's established primary and secondary control styling. Do not add hover lift, vertical motion, bounce, or ad hoc glossy or gradient CTA treatments.

## Scope

Default allowed paths include `packages/`, product docs under `docs/`, release tooling, shared app config, and product CI.

Do not use this skill for `website/` only marketing work, homepage copy, public roadmap presentation, or changelog presentation. Those changes target `www`.
