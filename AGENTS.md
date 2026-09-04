# Agent Instructions

## Task startup freshness

The checkout supplied as a new task's working directory is a launcher, not proof that the task has a fresh branch or an isolated worktree.

Before asking for authorization, planning implementation, or changing files:

1. Run the read-only `git fetch --all --prune` from the launcher checkout.
2. Classify the destination lane: `origin/dev` for product work, `origin/www` for the public website, or `origin/main` for production release preparation. If the lane or path scope is unclear, ask before creating a worktree.
3. Read the current root instructions directly from that fetched ref with `git show <remote-ref>:AGENTS.md`. The loaded local copy may be stale. Follow the fetched instructions for the rest of the task.
4. If fetch or the remote instruction read fails, stop and report the exact blocker.

Level 1 stays read-only in the launcher checkout. For Level 2 or higher, use `./scripts/worktree-add.sh` to create an isolated worktree from the explicit fetched remote ref. The starting directory is usable only when it is already a clean dedicated worktree at that ref.

Never discard launcher changes to make it fresh. Preserve and report unexpected work. After a task merges into its lane, fast-forward a clean launcher checkout to the verified remote head so the next task starts with the newest bootstrap policy.

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

### Sequencing-critical router

Task skills are discovered from their descriptions. These routes must happen before a risky action:

- Provider-visible behavior or path classification: [freed-provider-risk-review](.agents/skills/freed-provider-risk-review/SKILL.md) before code.
- Durable library authority, migration, storage, or Automerge: [freed-library-core](.agents/skills/freed-library-core/SKILL.md) before design or code.
- Live rare or stateful failures: [freed-evidence-capture](.agents/skills/freed-evidence-capture/SKILL.md) before mutation.
- Skill creation or changes: [.agents/skills/AGENTS.md](.agents/skills/AGENTS.md) before editing a skill.

### Path router

- `docs/**`: [docs/AGENTS.md](docs/AGENTS.md)
- `packages/shared/**`: [packages/shared/AGENTS.md](packages/shared/AGENTS.md)
- `packages/ui/**`: [packages/ui/AGENTS.md](packages/ui/AGENTS.md)
- `packages/pwa/**`: [packages/pwa/AGENTS.md](packages/pwa/AGENTS.md)
- `packages/desktop/**`: [packages/desktop/AGENTS.md](packages/desktop/AGENTS.md)
- `scripts/**`: [scripts/AGENTS.md](scripts/AGENTS.md)

## Always-on governance

### Repository and tool safety

- Never edit or commit task changes directly on `dev`, `main`, or `www`. Use a task branch in an isolated worktree. A shipping skill may use a clean lane checkout for read-only proof and post-merge operations.
- Preserve user changes. Do not clean, reset, overwrite, or incorporate unrelated work.
- Use the Node toolchain pinned by `.nvmrc`. `node`, `npm`, and `npx` must come from the same installation.
- Gather available evidence yourself. Ask the owner to run a diagnostic only when the required account, hardware, or live state is outside your access.
- Keep the active delivery bounded. Fix blockers. For adjacent deferrable debt, deduplicate or create one GitHub issue with `.github/ISSUE_TEMPLATE/debt.yml`, then resume. Drop speculative findings.
- Code before the first `await` in an async function is synchronous. Keep O(n) work such as serialization, `A.save()`, or large typed-array conversion out of fire-and-forget hot paths before the first yield.

### Provider fingerprinting stop sign

Before writing code or enabling a feature that could alter behavior visible to X, Facebook, Instagram, LinkedIn, or another provider, stop. This includes authenticated WebView loads, navigation, requests, retries, cadence, cookies, headers, scripted scrolling or clicking, extraction scripts, media loading, login behavior, canvas or WebGL behavior, and fingerprint masking.

Warn the owner in plain language. Name the provider, describe the observable change, explain how it could increase fingerprinting or detection risk, and offer the lowest-profile alternative. Level 5 or higher covers necessary provider-observable behavior only after that warning. At a lower level, ask for an authorization level. Ordinary permission without a numbered level is not provider approval.

Read and follow [freed-provider-risk-review](.agents/skills/freed-provider-risk-review/SKILL.md). A publishable provider-visible branch requires a healthy `provider-risk-review` artifact recording `behavior_approved` or `diff_authorized`, and its provider set must match the current provider-visible diff. Approval covers the described behavior, not arbitrary later changes. Any material deviation in requests, navigation, cookies, headers, timing, extraction, or provider API use requires a new Gate 1 decision before code, even when no mechanical check would catch it.

`scripts/lib/provider-visible-paths.mjs` is the canonical path classifier. Use `./scripts/worktree-publish.sh --print-provider-subdiff` to inspect the classified surface. Editing a listed path without observable behavior change can be classified `diff_authorized`; changing behavior from an unlisted path still requires Gate 1. Draft publication never grants live provider traffic.

### Deployment, automation, and release safety

- The only permitted Vercel scope is `aubreyfs-projects`. Never use a raw Vercel command without `--scope aubreyfs-projects`, never run Vercel from repository root, and never use the argument-free `deploy_to_vercel` tool. Use the repository preview and deployment helpers.
- Keep browser tests headless. Show visible local previews in the task's built-in Browser. Do not open Chrome, headed Playwright, Playwright UI or debug mode, Computer Use, or another external browser unless the owner explicitly requests that external surface. If the built-in Browser is unavailable, report the preview URL. Keep an approved external window in the background where possible and close only that task's window at closeout.
- Run `node scripts/doctor.mjs --strict` before loops and CI gates. Treat a surprising Node, npm, npx, GitHub CLI, or credential path as a machine problem.
- Before activating a saved Freed automation, run `npm run validate:host-automations`. An ACTIVE actor with drift fails closed. Reconcile it through supported host automation controls and never edit `automation.toml` directly.
- A private current-task owner confirmation outside the repository may authorize only the exact lifecycle operation it names. It does not authenticate the owner, grant provider traffic, replace provider review, or replace CODEOWNER requirements.
- Releases require exact source, artifact, branch, installed build, and remote-head evidence. Use the shipping skills and release scripts. Never hand-edit version files or push release commits or tags around those controls.

### Incidents and durable data

- For a rare, intermittent, long-running, stateful, or data-loss failure, preserve attributable evidence before restarting, repairing, or changing code. Use [freed-evidence-capture](.agents/skills/freed-evidence-capture/SKILL.md).
- After capture, fix the root cause and add the smallest safe mitigation. Add bounded telemetry plus tests for the relevant state machine, thresholds, retry limits, and recovery transitions. If the root cause remains unknown, say so and state what the next telemetry will distinguish.
- Changes to durable library authority, migrations, rollback, storage epochs, snapshots, sync journals, tombstones, or Automerge must use [freed-library-core](.agents/skills/freed-library-core/SKILL.md). Identity is not storage authority. A UI or TypeScript guard is not enough where the database or native runtime owns enforcement.

## Product invariants

- After implementing a new feature, update every affected `docs/PHASE-*.md` file and `docs/roadmap-status.json` in the product commit, even when the phase status is unchanged. Validate the structured roadmap. Route public roadmap presentation through a separate `www` task from the approved source commit. Never edit the website from the `dev` worktree for this sync.
- Give machine-time estimates only, such as "one conversation" or "~10 min". Never quote human hours or days.
- Display opaque IDs by their last eight characters, prefixed with `...`.
- Format user-facing counts and totals with `Number.toLocaleString()` or `Intl.NumberFormat`, never raw interpolation or `.toString()`.
- In user-facing strings, use "Freed Desktop". Never write "for Mac", "for Windows", or "for desktop".
- Before creating a component or hook, search the package for an existing equivalent. Share logic or primitives instead of duplicating them.
- Before shipping, confirm every exported function or class you added or touched has an appropriate caller.

## Package boundaries

- `shared`: pure functions and types, zero runtime dependencies, no React.
- `ui`: platform-agnostic React. It may import `@freed/shared`, but no platform stores, Tauri, service-worker logic, or `@freed/sync`. It ships raw TSX.
- `sync`: storage-agnostic across browser IndexedDB and Node filesystems.
- `pwa`: imports `@freed/ui` and `@freed/shared`, never Tauri.
- `desktop`: imports `@freed/ui` and `@freed/shared`, never `@freed/pwa`.
- `capture-*`: isolated. Capture packages never import one another.

## Canonical URLs

Marketing is `https://freed.wtf`, the PWA is `https://app.freed.wtf`, and downloads are at `https://freed.wtf/get`. Never write `freed.wtf/app`.

## Delivery kernel

### Lanes and local proof

- Product work targets `dev`. Public website work targets `www`. Production release preparation targets `main`. Dev release preparation targets `dev`.
- Never base public website work on `dev`, merge `dev` into `www`, or use `main` as a second development branch.
- Use `./scripts/worktree-add.sh` with an explicit remote base. Do not use bare `git worktree add`.
- Build and test locally first. Publish only when the intended slice is locally runnable. GitHub CI is exact-head verification, not the development loop.
- Use `./scripts/worktree-preview.sh <target>` for local previews. Do not run root `npm run dev`. Run workspace commands from the workspace directory, not with root workspace dispatch. If a workspace needs a hoisted binary, prefix `PATH` with the worktree root `node_modules/.bin`.
- Keep each task's previews and cleanup scoped to its worktree. Do not run broad cleanup while the owner is reviewing a preview.

### Validation and publication

- `npm run validate:feature` is the normal feature-branch gate.
- `npm run validate:dev` is the full integration gate for merges and pushes to `dev`.
- `npm run validate:release` is the release-preparation gate on `main`.
- Read [docs/TESTING-STANDARD.md](docs/TESTING-STANDARD.md) before adding, moving, or deleting permanent tests. Use the cheapest deterministic layer that protects a distinct contract. Delete temporary probes before publication.
- Publish ordinary work through `./scripts/worktree-publish.sh` with existing GitHub authentication. Use `--ready` only for finished work. Missing optional broker configuration does not block the normal authenticated path.
- Branch names use `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `perf/`, or `style/` plus a short kebab-case description. Commit messages and PR titles use the matching Conventional Commit prefix.
- Squash merge into the PR's destination lane. One PR becomes one commit on that lane. Use the PR title as the squash commit subject.
- After a merge, stop only that worktree's processes, remove its worktree, and delete the local task branch. Never use branch ancestry to infer whether a squash PR merged; query the PR or remote branch state.

### Promotion

`dev`, `main`, and `www` are separate lanes. Promote a reviewed immutable `dev` snapshot into `main` only through the release workflow. After a stable production release, reverse-integrate `main` into `dev`. Sync approved `main` changes into `www` only when the website or checked-in changelog needs them.

Use [freed-ship-build](.agents/skills/freed-ship-build/SKILL.md) for release economy, CalVer, signing, installation, rollback, and reverse integration. Use [freed-ship-www](.agents/skills/freed-ship-www/SKILL.md) for website deployment. Use [docs/SOAK-AND-TRIGGERS.md](docs/SOAK-AND-TRIGGERS.md) and [freed-soak](.agents/skills/freed-soak/SKILL.md) for installed observation.

## Writing

Apply the installed `no-ai-slop` skill to substantial prose. Preserve the owner's meaning, cadence, humor, uncertainty, and edge.

- Lead with the point. Use concrete nouns and active verbs.
- Never use em dashes, en dashes, or double hyphens as prose punctuation.
- Cut filler, throat-clearing, puffery, vague attribution, canned contrasts, and decorative conclusions.
- Keep public copy appropriate to its audience. Do not put agent-product authorship giveaways in external titles.
