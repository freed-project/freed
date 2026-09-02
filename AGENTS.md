# Agent Instructions

## Task startup freshness

The checkout supplied as a new task's working directory is a launcher, not proof that the task has a fresh branch or an isolated worktree.

Before asking for authorization, planning implementation, or changing files:

1. Run the read-only `git fetch --all --prune` from the launcher checkout.
2. Confirm that the request belongs on `origin/www`. Public marketing pages, public copy, legal pages, public roadmap presentation, and public changelog presentation use this lane. Product code and product documentation use `origin/dev`. Production desktop release preparation uses `origin/main`.
3. Read the current root instructions directly from the fetched destination ref with `git show <remote-ref>:AGENTS.md`. The loaded local copy may be stale. Follow the fetched instructions for the rest of the task.
4. If the lane or path scope is unclear, ask before creating a worktree. If fetch or the remote instruction read fails, stop and report the exact blocker.

Level 1 stays read-only in the launcher checkout. For Level 2 or higher, use `./scripts/worktree-add.sh` to create an isolated worktree from the explicit fetched ref. The starting directory is usable only when it is already a clean dedicated worktree at that ref.

Never discard launcher changes to make it fresh. Preserve and report unexpected work. After a task merges into `www`, fast-forward a clean launcher checkout to the verified remote head so the next task starts with the newest bootstrap policy.

## Authorization levels

When authorization is required and the owner has not set a level, ask exactly:

> What authorization level should this task proceed at?
>
> 1. Inspect
> 2. Build
> 3. Publish
> 4. Ship dev
> 5. Change provider behavior
> 6. Ship production
> 7. Full task authority
>
> Reply with a number.

Do not request authorization for one isolated action or append exclusions and safety boilerplate.

1. **Inspect:** Read-only diagnosis, evidence capture, and planning.
2. **Build:** Level 1 plus local edits, tests, previews, synthetic fixtures, and reversible local files.
3. **Publish:** Level 2 plus commits, pushes, pull requests, CI repair, and non-production merges.
4. **Ship dev:** Level 3 plus dev releases, installation, deployment, real local-data testing, and exercising existing provider behavior at its current cadence. No production release or provider-observable behavior change.
5. **Change provider behavior:** Level 4 plus new or changed provider requests, navigation, refresh frequency, timing, retries, cookies, headers, scraping behavior, and necessary live provider mutations.
6. **Ship production:** Level 5 plus production releases, production deployments, installation, rollback, and post-release verification.
7. **Full task authority:** Level 6 plus every reasonably necessary task-scoped action until completion or a hard external blocker.

Each level includes lower levels. The newest explicit level controls for the stated task. Do not ask again for included actions. Clarification about ambiguous scope is not an authorization challenge.

Use these numbers in owner-facing authorization requests and status. Internal labels such as `observe-only`, `plan-only`, `pr-only`, and `merge-safe` never replace them.

## Load only the applicable instructions

Root instructions are the always-loaded governance kernel. Skills contain task workflows. Scoped `AGENTS.md` files contain path-specific invariants.

When a task starts at repository root, descendant instructions are not discovered later merely because you enter or edit that directory. Before changing a scoped path, read its linked instructions manually. Scoped files add to this file and do not weaken it.

The maintenance model and enforced budgets live in [docs/AGENT-INSTRUCTIONS.md](docs/AGENT-INSTRUCTIONS.md).

- Website changes: [website/AGENTS.md](website/AGENTS.md)
- Skill changes: [.agents/skills/AGENTS.md](.agents/skills/AGENTS.md)
- Website build and review workflow: [freed-build-www](.agents/skills/freed-build-www/SKILL.md)
- Production website publication: [freed-ship-www](.agents/skills/freed-ship-www/SKILL.md)

## Repository safety

- Never edit or commit task changes directly on `www`, `dev`, or `main`. Use a task branch in an isolated worktree. A shipping workflow may use a clean lane checkout for read-only proof and post-merge operations.
- Preserve user changes. Do not clean, reset, overwrite, or incorporate unrelated work.
- Use the Node toolchain pinned by `.nvmrc`. `node`, `npm`, and `npx` must come from the same installation.
- Gather available evidence yourself. Ask the owner to run a diagnostic only when the required account, hardware, or live state is outside your access.
- Keep the active delivery bounded. Fix blockers. Record adjacent deferrable debt once, then resume. Drop speculative findings.
- Give machine-time estimates only, such as "one conversation" or "~10 min". Never quote human hours or days.

## WWW lane and deployment authority

`www` is the production marketing branch for `https://freed.wtf`. Never base website work on `dev`, merge `dev` into `www`, or use `main` as a second website branch.

Opening or updating a pull request against `www` is Level 3 publication. Merging to `www` is a production action because Vercel Git integration deploys that branch. It requires Level 6 or 7. Do not merge merely because checks pass or a preview exists.

Vercel Git integration is the primary preview and production path:

- A pull request targeting `www` receives the normal Vercel preview.
- A merge to `www` triggers the production deployment.
- Repository deployment helpers are explicit manual fallbacks, not the ordinary path.

The only permitted Vercel scope is `aubreyfs-projects`. Never run a raw Vercel command without `--scope aubreyfs-projects`, never run Vercel from the repository root, and never use an argument-free deployment tool.

Vercel Git integration is the supported website path. The current manual helper scripts are not verified for a fresh `www` worktree. If the owner explicitly requests a manual fallback, stop and route a separate helper-repair task. Do not invoke a helper or improvise with a raw Vercel command until that repair is reviewed and verified.

## Source identity

Public roadmap and changelog updates must remain attributable to an approved source:

- For roadmap presentation, use canonical `docs/roadmap-status.json` from an approved product source checkout. Record the source commit and file digest. Run `node scripts/validate-roadmap-status.mjs` inside that exact approved product checkout before transferring the validated data. Map it exactly. Do not infer status from phase prose, commit messages, or unchecked assumptions.
- For changelog presentation, record the published release, tag, channel, source commit, and approved release-note artifact.
- Put the relevant source identity in the task and pull request. Do not merge a product branch into `www` to transfer one presentation change.

## Delivery kernel

- Create website worktrees with `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/www`. Never use bare `git worktree add`.
- Build and test locally before publication. Run website commands from `website/`, with the worktree root `node_modules/.bin` on `PATH` when a hoisted binary is needed.
- Branch names use `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `perf/`, or `style/` plus a short kebab-case description. Commit messages and pull request titles use the matching Conventional Commit prefix.
- Do not put an agent product name or other authorship giveaway in a branch name, commit subject, pull request title, issue title, or external title.
- Publish using the caller's existing GitHub authentication. A pull request must target `www`, carry the required external-post marker, identify its source when applicable, and represent a locally verified candidate.
- Squash merge only. One pull request becomes one commit on `www`, and the pull request title becomes the squash subject.
- Verify that required checks passed for the exact head SHA. After an authorized merge, verify `origin/www`, the Vercel deployment identity, and the production response before claiming the site shipped.
- Stop only the current task's preview or browser session at closeout. Remove the merged worktree and task branch. Query pull request or remote branch state instead of using branch ancestry to judge a squash merge.

## Writing

Apply the installed `no-ai-slop` skill to substantial prose. Preserve the owner's meaning, cadence, humor, uncertainty, and edge. Public copy must remain appropriate to its audience.

- Lead with the point. Use concrete nouns and active verbs.
- Never use em dashes, en dashes, or double hyphens as prose punctuation.
- Cut filler, throat-clearing, puffery, vague attribution, canned contrasts, and decorative conclusions.
