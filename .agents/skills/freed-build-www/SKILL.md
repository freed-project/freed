---
name: freed-build-www
description: Build marketing-site work in a www-based worktree, verify website changes, launch a local website preview, optionally deploy a shareable website preview, and prepare a draft PR targeting www. Use for homepage, public changelog presentation, public roadmap presentation, marketing copy, legal or marketing pages, and website-only changes intended for freed.wtf.
disable-model-invocation: true
---

# Build WWW

Create a marketing worktree branch from `www`, implement the website change, verify it, launch a local website preview, optionally deploy a shareable website preview, and open a draft PR targeting `www`.

## Workflow

1. Confirm the request is public marketing work targeting `www`.
2. Reject or reroute product work targeting `dev`; use `freed-build-feature` instead.
3. Create a new worktree branch from `www` using `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/www --install full --target website`.
   - When you are spinning up multiple speculative threads at once, prefer `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/www --swarm --target website` so bootstrap stays deferred until that thread actually needs verification or a preview.
4. If the worktree was created with deferred bootstrap on purpose, recover with `./scripts/worktree-bootstrap.sh <worktree> --target website`.
5. Keep changes scoped to marketing paths unless the user explicitly changes the destination.
6. Run website checks from the workspace directory, at minimum `cd website && PATH=../node_modules/.bin:$PATH npm run build`.
7. Browser tooling is opt-in only. Do not launch Chrome DevTools MCP, Playwright MCP, or Computer Use unless the task explicitly needs browser automation or browser debugging.
8. Before opening the draft PR, launch the local website preview on an explicit fresh port so parallel agent threads do not reuse or stomp each other's previews.
   - Compute a port first with `PORT=$(node scripts/lib/find-free-port.mjs 3000)`.
   - Launch with `./scripts/worktree-preview.sh website --port "$PORT"`.
   - Do not run `./scripts/dev-session-clean.sh` just to relaunch a preview. That kills tracked previews for other work unless scoped.
9. Deploy `./scripts/vercel-deploy-preview.sh website` only when a shareable remote preview is needed.
10. If browser tooling was needed, clean browser automation only after preserving any preview the user still needs. Do not run broad cleanup while the local preview should remain open.
   - If cleanup is needed before PR merge or thread archive, scope it to this worktree with `./scripts/dev-session-clean.sh --worktree <worktree>`.
   - Before reporting final status, list this thread's preview with `./scripts/worktree-processes.sh list --worktree <worktree>` so the URL and owner are clear.
   - When the PR is merged, the worktree is removed, or the thread is archived, stop only this thread's preview with `./scripts/worktree-processes.sh stop --worktree <worktree> --target website`.
   - Never stop previews from other worktrees unless the user explicitly asks for global cleanup.
11. Finish the branch with `./scripts/worktree-publish.sh --title "<conventional-commit title>" --base www --summary "<user-facing change>" --test "cd website && PATH=../node_modules/.bin:$PATH npm run build" --ready` (omit `--ready` for interim publishes so the PR stays draft while iterating).
   - If the branch intentionally adds new files, stage them yourself first or re-run `./scripts/worktree-publish.sh` with `--include-untracked`.
12. Confirm the branch is pushed to `origin`, the PR targets `www` and is marked ready for review (or intentionally left draft with the reason stated), and the closeout includes the local preview URL.

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
