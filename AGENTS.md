# Agent Instructions

## Rules

- **After implementing ANY new features:** Update `docs/PHASE-*.md` immediately — do not wait to be asked. Check every phase whose success criteria or task table is affected and update checkboxes + status lines in the same commit as the feature work.
- **Roadmap sync:** When `docs/PHASE-*.md` changes, update the roadmap data in `website/src/app/roadmap/RoadmapContent.tsx` to match (`✓ Complete` → `"complete"`, `🚧 In Progress` → `"current"`, else `"upcoming"`). The roadmap is public marketing surface: route the website edit through the `www` lane (`freed-build-www`), not through `dev`.
- **Time estimates:** Machine time only ("one conversation", "~10 min"). Never quote human hours/days.
- **IDs:** Display tail — `...${id.slice(-8)}`.
- **Number formatting:** All user-facing numbers must use `Number.toLocaleString()` (or `Intl.NumberFormat`) — never raw `.toString()` or string interpolation. This ensures locale-appropriate grouping separators (e.g. commas in `en-US`) for counts, totals, and stats.
- **Node toolchain:** Use the repo-pinned Node toolchain from `.nvmrc`. Shell scripts must resolve `node`, `npm`, and `npx` from the same install, never by mixing a global `npm`/`npx` with a different `node` on `PATH`.
- **Before creating any new component or hook:** `SemanticSearch` or `Grep` the package for existing code that does the same thing. Duplication is never acceptable — if two surfaces need the same UI or logic, extract a shared primitive and have both import it.
- **Before shipping any feature:** Verify that every exported function/class you added or touched is actually _called_ from an appropriate entry point. Exported-but-never-called code is a bug. Grep for each new export name to confirm it appears in a consumer.
- **Platform copy:** Never write "for Mac", "for Windows", or "for desktop" in user-facing strings. The correct product name is "Freed Desktop". Use that.
- **Buttons and dialog controls:** Do not invent custom CTA styling when the repo already has an established button hierarchy. For dialogs, recovery surfaces, and other utility UI, use standard primary and secondary control treatment with the repo's usual sizing, radius, and typography. Never add hover lift, vertical motion, bounce, or "raise on hover" effects to buttons. Never introduce ad hoc glossy or gradient CTA buttons for utility UI.
- **UI design vocabulary:** Before adding or changing UI, inspect the nearest mature product surface and shared theme primitives first. Match the established vocabulary for tokens, radius, density, typography, borders, shadows, states, and responsive behavior. Introduce new styling only when the existing vocabulary cannot express the required behavior, and keep it compatible with all active themes.
- **Toolbar right-edge controls:** Any new control added to the right edge of a shared toolbar must also map into an existing overflow section or add a new named overflow section at the same time. The control must remain reachable at every supported desktop and mobile toolbar width. When controls collapse into a menu, form controls such as selects, radio groups, segmented controls, sliders, and toggles must fill the menu content width instead of keeping their inline toolbar width. If a control is wrapped by a tooltip or trigger element, that wrapper must also fill the menu content width. Add or update focused e2e coverage for both the inline state and the overflow state, including menu-section width assertions for collapsed form controls, before shipping.
- **Menu scroll bounds:** Any floating menu, command palette, context menu, overflow menu, or dropdown must scroll internally and stay inside the viewport. Use the shared `theme-menu-shell` class with a top or max-height CSS variable instead of raw `overflow-hidden`. Add or update focused e2e coverage when a menu can grow beyond the visible viewport.
- **Async-before-await is synchronous:** Code before the first `await` in an `async` function runs synchronously in the caller's microtask even if the caller doesn't await. Never put O(n) work (e.g. `Array.from(largeUint8Array)`, `A.save()`, serialization) before an `await` in a `subscribe()` callback or any other fire-and-forget async call on a hot path.
- **Fingerprinting risk requires a stop sign:** Before implementing or enabling any feature that could increase provider fingerprinting or detection risk, stop and warn the user in plain language. This includes new authenticated WebView loads, background provider navigation, extra provider API calls, automatic reply or comment hydration, scripted scrolling or clicking, altered timing patterns, new cookies or headers, media preloads, canvas or WebGL behavior, device fingerprint masking, and anything that changes how often Freed contacts X, Facebook, Instagram, LinkedIn, or another third-party provider. The warning must name the provider, describe the new observable behavior, explain why it could make Freed easier to fingerprint, and offer the lowest-profile alternative. Gate 1 requires the owner to explicitly approve that exact behavior and risk before code. Broad permission such as "proceed with everything" is not provider approval. The canonical machine-readable provider-visible path list lives in `scripts/lib/provider-visible-paths.mjs`; add new provider surfaces there, not in per-script copies. Provider-visible branches may publish as draft after implementation and validation. Draft publication does not authorize live provider traffic. The helper posts one GitHub review comment bound to the provider-visible path set and provider-only binary diff. Gate 2 is the CODEOWNER's GitHub thumbs-up reaction on that comment. A change to any provider-visible file produces a new fingerprint and requires a new reaction. Changes outside the provider-visible path set do not invalidate the reaction. The optional signed `control-task` path remains available for unattended publication. It binds the same provider-only fingerprint to a governed task and approved provider authority. Run `scripts/worktree-publish.sh --ready` only after the GitHub reaction exists or a valid signed control-task approval is available. Any material behavior change returns to Gate 1.
- **Vercel deployments -- always use `--scope aubreyfs-projects`:** The only permitted Vercel team for this project is `aubreyfs-projects` (personal account). Never run `vercel deploy`, `vercel link`, or any Vercel CLI command without the `--scope aubreyfs-projects` flag. Never use the `deploy_to_vercel` MCP tool -- it accepts no arguments and silently deploys to whatever team the CLI defaults to. Never run `vercel` from the repo root.
  - This monorepo uses local workspace packages. Raw subdirectory deploys like `vercel deploy website/` and `vercel deploy packages/pwa/` can upload an incomplete tree and fail at `npm install`.
  - Always use the preview helper instead:
    - Website: `./scripts/vercel-deploy-preview.sh website`
    - PWA: `./scripts/vercel-deploy-preview.sh pwa`

## Machine Preflight

`node scripts/doctor.mjs` checks the machine before loop or worktree work: the pinned Node toolchain from `.nvmrc`, PATH `node` consistency, `gh` (presence, that it runs, and binary architecture on macOS), git credential helpers that point at missing binaries, `git`, `curl`, `python3`, `~/.freed/automation/`, and optional publisher trust readiness. The publisher check uses the fixed root-owned schema v2 config at `/Library/Application Support/Freed/trusted-publisher-host.json`. It validates exact config shape, ownership and modes, pinned file digests, designated broker signature, exact clean control commit, private state and public-key record, and non-secret Keychain item presence without reading the signing key. Use `--require-publisher` only when deliberately selecting that optional host profile. The trusted host repeats all use-time checks before signing a capability. `worktree-add.sh`, `worktree-publish.sh`, and the nightly runner run the doctor automatically in warn-only mode; loops and CI gates should run `node scripts/doctor.mjs --strict` and stop on failures. A surprising `node`/`npm` path or a broken `gh` is a machine issue to fix before debugging the repo.

Before activating a saved Freed automation, run `npm run validate:host-automations`. It compares identity, prompt, schedule, authoritative callable model and supported reasoning effort, target, working directories, execution environment, credential record, root-owned launcher binding and digest, and non-secret Keychain item presence without editing host files. An ACTIVE actor fails closed unless its trusted launcher can exchange the persistent Keychain credential for only the actor's short-lived canonical lease. Missing actors remain PAUSED. Reconcile missing or drifted actors through the Codex host automation controls, and never repair drift by editing `automation.toml` directly.

When the owner explicitly approves one exact lifecycle operation in the current task, a private current-task owner confirmation file is the supported cooperative fallback for that operation. It may acquire only a short `freed-owner` lease bound to the named task and canonical operation intent. Store the file outside the repository. The file does not authenticate the owner, does not grant provider traffic, and does not replace either provider-risk gate or CODEOWNER review. Each different operation requires its own exact intent and confirmation record.

## Versioning

CalVer `YY.M.DDBUILD` — patch segment encodes the day and build number:

- `patch = (day_of_month × 100) + build_number`
- March 1, first build → `26.3.100`; fifth build → `26.3.104`
- March 15, first build → `26.3.1500`

Run `./scripts/release.sh` with no args from a fresh release-prep worktree based on `origin/main` to auto-compute the next production version. For a dev release, use `./scripts/release.sh --channel=dev` from a fresh release-prep worktree based on `origin/dev`.

## Package Boundaries

| Package      | Rule                                                                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/`    | Pure functions + types. Zero runtime deps. No React.                                                                                                                                         |
| `ui/`        | Platform-agnostic React UI layer. May import `@freed/shared`. No platform stores, no Tauri APIs, no service-worker logic, no `@freed/sync` imports. Ships raw `.tsx` source — no build step. |
| `sync/`      | Storage-agnostic. Works in browser (IndexedDB) and Node (filesystem).                                                                                                                        |
| `pwa/`       | PWA app shell only. Imports `@freed/ui` and `@freed/shared`. Never import Tauri APIs.                                                                                                        |
| `desktop/`   | Tauri shell. Imports `@freed/ui` and `@freed/shared`. Never import from `@freed/pwa`.                                                                                                        |
| `capture-*/` | Isolated. Never import between capture packages.                                                                                                                                             |

## URLs

| Property            | URL                     |
| ------------------- | ----------------------- |
| Marketing site      | `https://freed.wtf`     |
| PWA (mobile reader) | `https://app.freed.wtf` |
| Download page       | `https://freed.wtf/get` |

**Never write `freed.wtf/app`** — the PWA lives at the subdomain `app.freed.wtf`.

## Git Workflow

**Never work directly on `main`.** Always create a git worktree for feature work:

```bash
./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/dev --target shared
# work in ../freed-<slug>/
# remove when done: git worktree remove ../freed-<slug>
```

`worktree-add.sh` is a drop-in replacement for `git worktree add`. It defaults to a full isolated install so the new worktree is ready immediately, and it still supports `--install auto` or `--install none` when you intentionally want to defer bootstrap. Never use bare `git worktree add` directly.
Pass an explicit remote base like `origin/dev` or `origin/www` so feature work does not inherit a stale local branch by accident.
For multi-thread or speculative worktree swarms, prefer `--swarm`. That maps to deferred bootstrap until the thread actually needs verification or a preview.
Prefer the lightest useful local preview before opening a draft PR:

- product work usually uses `PORT=$(node scripts/lib/find-free-port.mjs 1421) && ./scripts/worktree-preview.sh pwa --port "$PORT"`
- website work uses `PORT=$(node scripts/lib/find-free-port.mjs 3000) && ./scripts/worktree-preview.sh website --port "$PORT"`
- use `./scripts/worktree-preview.sh desktop --native` only when real Tauri behavior matters, and report the preview label when you do
- for mocked Desktop preview, use `PORT=$(node scripts/lib/find-free-port.mjs 1422) && ./scripts/worktree-preview.sh desktop --port "$PORT"`
- product previews launched through `./scripts/worktree-preview.sh` mark the app as a feature preview, auto-accept local legal gates, and populate sample data so the first screen is ready to inspect
- never run `./scripts/dev-session-clean.sh` just to relaunch a preview. Launch on a fresh explicit port instead.
- never run `npm run <script> --workspace=...` from the repo root in this monorepo, run from the workspace directory instead
- root `npm run dev` now fails fast on purpose, use `./scripts/worktree-preview.sh <target>` or run `npm run dev` from the workspace directory you actually want
- the root fanout scripts now fail fast if you try the dangerous workspace-dispatch pattern, treat that error as a routing mistake and re-run from the workspace
- if a workspace command needs a hoisted binary, prefix `PATH` with the worktree root `node_modules/.bin`
- expect the worktree helpers to print the resolved `node` and `npm` pair before they do real work, and treat a surprising path there as a machine issue to fix before debugging the repo
- publish normal feature work with `./scripts/worktree-publish.sh` and the caller's existing GitHub authentication. A host may optionally configure the absolute signed broker path in `FREED_TRUSTED_PUBLISHER` for unattended publication. The broker lives outside the candidate worktree, validates its root-owned trust configuration and pinned tools, then invokes the same helper with a short-lived target-scoped lease. Missing broker provisioning does not block normal publication. Any partial broker handoff fails closed.
- rerunning the publication helper should update the existing draft PR body and title, and push a ready PR back to draft when the local branch changes underneath it. At closeout, publish finished work with `--ready`. For provider-visible work, publish the draft first, react with a GitHub thumbs-up on the generated provider review comment, then rerun with `--ready`. Draft means "still iterating, blocked, or needs discussion", not "authored by automation"
- browser tooling is opt-in only, do not launch Chrome DevTools MCP, Playwright MCP, or Computer Use unless the task explicitly needs browser automation or browser debugging
- after browser tooling work, do not run broad cleanup while the preview should remain open. If cleanup is needed, scope it with `./scripts/dev-session-clean.sh --worktree <worktree>`.
- when a PR is merged, the worktree is removed, or the thread is archived, close only that thread's preview with `./scripts/worktree-processes.sh stop --worktree <worktree> --target <pwa|desktop|website>`.
- the publication helper refuses stray untracked files unless you stage them yourself first or pass `--include-untracked`

### Installed Desktop Soaks

The canonical soak and trigger contract is [docs/SOAK-AND-TRIGGERS.md](docs/SOAK-AND-TRIGGERS.md). Installed soaks are terminal-driven through `open -g`, logs, `runtime-health.jsonl`, and the already authorized `node scripts/dev-sync-trigger.mjs <provider>` path. Background work does not stall overnight for a routine local click. Ask with a 10 minute response window, then continue only within authority already granted. A timeout never authorizes provider traffic, authentication, external posting, deployment, destructive state changes, or a new behavior. Ship a terminal trigger for anything recurring.

### Queued UI Polish

When a user queues several small UI fixes for the same product surface, keep the work in the active feature worktree and PR until the queue is done.

- For each small UI fix, implement the narrow change, then verify it in the active thread with the cheapest proof that actually answers the question: live preview, screenshot comparison, browser inspection, or a temporary geometry check.
- Do not add permanent e2e coverage for exact pixels, gaps, colors, shadows, padding, or one-off toolbar geometry unless the behavior is a shared layout contract, has already regressed, or cannot be checked reliably in-thread.
- Do not run `npm run validate:feature` after every small visual adjustment. Run it at the publish checkpoint, or earlier only when the user asks for a full validation checkpoint.
- Do not run desktop e2e between queued UI updates in the same thread unless the user asks for that checkpoint or the change is too risky to inspect with the live preview. Prefer keeping the preview running, applying the next queued visual fix, and doing one focused e2e pass after the queue settles.
- When the user is actively sending browser comments or screenshots, treat the queue as still open. Give a short status update, keep the preview current, and wait to spend machine time on heavier verification until the user signals that the batch is ready or asks for tests.
- If browser automation is needed for a visual fix, use it for that fix and keep the local preview current. Do not run broad cleanup before closeout unless the user no longer needs the preview. Prefer targeted cleanup for this worktree.
- Update the draft PR once after the queued batch is ready, unless the user asks for an interim publish.

**Branch naming:** `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `perf/` prefix followed by a short kebab-case description.

**Commit messages** follow Conventional Commits:

| Prefix      | When to use                                       |
| ----------- | ------------------------------------------------- |
| `feat:`     | New user-facing feature                           |
| `fix:`      | Bug fix                                           |
| `chore:`    | Tooling, deps, config — no production code change |
| `docs:`     | Documentation only                                |
| `refactor:` | Code restructure with no behavior change          |
| `perf:`     | Performance improvement                           |
| `style:`    | Formatting, whitespace, CSS-only                  |

**Merge policy:** Squash merge only. One PR = one commit on `main`.

```bash
# From the primary worktree (not the feature worktree):
gh pr merge <n> --squash --delete-branch

# Immediately after merging, tear down the feature worktree:
git worktree remove --force ../freed-<slug>
git branch -D <branch>   # must use -D, not -d (squash leaves commits unreachable)
```

Or run the cleanup helper to sweep all merged worktrees at once:

```bash
./scripts/worktree-cleanup.sh        # interactive
./scripts/worktree-cleanup.sh --yes  # non-interactive
```

Branches are deleted after merge. The squash commit message is derived from the PR title — write PR titles as if they are commit messages.

### Worktree Routing

Before creating a worktree, classify the requested work by destination branch.

- Product work targets `dev`: Desktop, PWA, shared packages, sync, capture packages, release tooling, app behavior, and product docs.
- Public marketing work targets `www`: `website/`, marketing copy, public roadmap presentation, changelog presentation, and marketing docs.
- Production release prep targets `main`.
- Dev release prep targets `dev`.
- Use `freed-build-feature` for product work targeting `dev`.
- Use `freed-build-www` for marketing-site changes targeting `www`.
- Use `freed-ship-build` for desktop release shipping.
- Use `freed-ship-www` for publishing `www`, refreshing changelog, or syncing `main` into `www`.
- Ask before creating a worktree if destination branch or path scope is unclear.
- Never base public marketing work from `dev`.
- Never fast-forward `www` to `dev`.

### Branch Promotion

Treat `dev`, `main`, and `www` as separate lanes with explicit promotion points.

- `dev` is the default branch for ongoing product work.
- `main` is the production release branch. Do not use it as a second development branch.
- Promote `dev` into `main` when shipping a reviewed production release.
- After every production release, open a dedicated reverse-integration PR that merges `main` back into `dev`.
- If a hotfix lands on `main`, include it in that reverse-integration PR immediately after the production release is stable. Do not let `main` drift sit around.
- `www` is the public marketing branch. Sync approved `main` changes into `www` when the website or checked-in changelog needs them. Never sync `www` from `dev`.
- Treat the `main` back into `dev` reverse merge as part of the production release closeout, not as an optional cleanup.
- When release tooling or deployment helpers exist on more than one long-lived branch, update the matching copies in the same sweep or document why they intentionally differ.

### Validation Tiers

- `npm run validate:feature` is the default feature-branch check. It always runs root typecheck, then scopes the rest of the checks from the changed path set.
- `npm run validate:dev` is the full integration suite for merges and pushes to `dev`.
- `npm run validate:release` is the heaviest lane for release-prep work on `main`.
- Do not default feature threads to the full integration suite when the touched surface is narrow.

**Never use `git log main..branch` to check whether a branch has been merged.** Squash merge creates a new commit hash on `main`, so the original branch commits are never reachable from `main`'s history. The branch always looks "ahead" even when its content is fully shipped. Use these instead:

```bash
gh pr list --state merged --head <branch>   # authoritative: did a PR for this branch land?
git branch -vv | grep '\[gone\]'            # remote branch deleted = PR merged + auto-deleted
```

---

## Writing Style (All User-Facing Copy)

Copy must read like a person wrote it. When in doubt, read it aloud. If it sounds like a press release, rewrite it.

- **No em dashes (—) or en dashes (–).** Standard hyphens and normal punctuation only. Em dashes are a near-universal AI tell.
- **No AI filler phrases:** "not just X but Y", "delve into", "it's worth noting", "leverage" (verb), "in today's world", "Furthermore,", "Moreover,", "Additionally,", "at the end of the day", "game-changer", "seamlessly".
- **No throat-clearing.** Cut the first sentence of any paragraph that just announces what the paragraph is about.
- **Short sentences.** If a sentence needs an em dash to hold together, split it in two.
- **Concrete over abstract.** "Stores posts on your hard drive" beats "enables local-first data persistence".
- **Contractions are fine.** "We don't" reads warmer than "We do not". Use them.

## Desktop E2E Testing

The Freed Desktop app has a Playwright test suite that runs in plain Chromium, with no Tauri binary or
native build required. Use this to reproduce UI bugs, verify fixes, and write regression tests
when the test protects durable behavior. For the detailed policy, see
`packages/desktop/tests/e2e/README.md`.

Permanent desktop e2e coverage should earn its cost. Add or keep it for complete workflows across
React state, Automerge state, and the Tauri mock boundary; provider auth, sync, reconnect, pause,
or diagnostics behavior; startup, legal gate, crash recovery, updater, and renderer health paths;
shared layout contracts with known regression risk; performance budgets; maintained visual
snapshots; and rare or stateful failures where the next occurrence needs better evidence.

Do not preserve temporary implementation probes as permanent tests. Exact pixel offsets, widths,
gaps, colors, shadows, padding, one-off toolbar geometry checks, duplicate "button exists" checks,
and fixture self-tests that are already exercised by real workflows should be deleted before
publishing unless they are converted into a durable user-flow assertion or an explicit visual test.

### How it works

`VITE_TEST_TAURI=1` swaps every `@tauri-apps/*` import for a thin mock module under
`packages/desktop/src/__mocks__/@tauri-apps/`. Each mock tracks calls in `window.__TAURI_MOCK_*`
globals. A self-contained init script (`tests/e2e/fixtures/tauri-init.ts`) is injected via
`page.addInitScript()` before any page JavaScript runs. It installs `window.__TAURI_INTERNALS__`
with default IPC handlers for every command the app calls on startup.

### Running the tests

```bash
# Standard run (headless Chromium)
cd packages/desktop
npm run test:e2e

# Playwright UI mode (visual test runner, great for writing new tests)
npm run test:e2e:ui

# Step-through debugger (pauses on each action, shows browser)
npm run test:e2e:debug
```

All three commands start a Vite dev server automatically on port 1422 with `VITE_TEST_TAURI=1` and
tear it down after the run. No separate server startup needed.

### Writing a new test

1. Add a spec file under `packages/desktop/tests/e2e/`.
2. Import from `./fixtures/app` instead of from `@playwright/test` directly:

```ts
import { test, expect } from "./fixtures/app";

test("my new behaviour", async ({ app }) => {
  // app.page is a Playwright Page. The Tauri mock is already injected.
  // app.waitForReady() blocks until <main> is visible (app fully init'd).
  await expect(app.page.locator("button")).toBeVisible();
});
```

3. Use the `ipc` fixture to override handlers or read mock state:

```ts
test("invoke a command", async ({ app, ipc }) => {
  await ipc.setHandler("my_command", (_args) => ({ ok: true }));

  const result = await app.page.evaluate(async () =>
    (window as any).__TAURI_MOCK_INVOKE__("my_command", {}),
  );
  expect(result).toEqual({ ok: true });
});
```

4. To assert on plugin-shell `open()` calls: `await ipc.openedUrls()`.
5. To assert on plugin-process calls: `await ipc.processCalls()`.
6. To pre-set the updater state before page load, inject a second `addInitScript`:

```ts
await page.addInitScript(tauriInitScript());  // always first
await page.addInitScript(() => {
  (window as any).__TAURI_MOCK_UPDATE__ = { version: "2.0.0", ... };
});
await page.goto("/");
```

### Adding a new IPC mock handler

If the app starts calling a new `invoke()` command and tests fail because the handler is missing,
add a default response in both places:

1. `packages/desktop/tests/e2e/fixtures/tauri-init.ts`: add an entry to `_defaults` inside the
   IIFE. This covers the init-script path (plain Chromium / CI).
2. `packages/desktop/src/__mocks__/@tauri-apps/api/core.ts`: add to the `handlers` map in the
   module-level mock (only hits when `VITE_TEST_TAURI=1` aliases are active, i.e. dev server runs
   the real Vite mock modules instead of the injected init script).

The two are complementary. `tauri-init.ts` is the reliable one for tests; the module mocks exist
for completeness and for any test that doesn't use `page.addInitScript`.

### Debugging a UI bug in the desktop app

1. Create a worktree as usual.
2. Reproduce the bug with the cheapest useful tool: live preview, Playwright UI mode, a temporary
   browser assertion, or a focused failing test when permanent coverage is justified.
3. Use `--debug` when stepping through browser state will materially speed up the fix.
4. Fix the code, confirm the relevant check goes green, and delete temporary probes before commit.

Do not ask the user to click through the app to verify a fix when the repo can verify it locally.
For simple visual polish, thread-level preview or browser verification is enough. Write a permanent
test only when it delivers future value under the e2e policy above.

### Debugging rare or stateful failures

When fixing a rare, intermittent, long-running, stateful, or hard-to-reproduce failure, do not ship
only a one-off patch. Treat the work as root-cause debugging plus mitigation. The same patch should
make the next occurrence easier to explain, prove whether the mitigation worked, and reduce the odds
that the same class of bug escapes again. If that is impossible, document exactly why in the PR.

This rule applies to freezes, hangs, blank screens, stale renderers, stuck background jobs, sync
stalls, data loss, data corruption, runaway memory, runaway CPU, repeated retries, update failures,
cache poisoning, crash loops, and any fix where the first explanation is "this should not happen."

Before changing code, preserve live evidence while the system is still in the bad state. Choose the
evidence that fits the failure:

- process state, stack samples, memory maps, open files, child processes, network sockets, and CPU or memory pressure
- app logs, OS logs, crash reports, failed job records, retry history, queue depth, and last-success timestamps
- local data footprint, cache size, snapshot size, database size, schema or version markers, and largest files
- current route, visible UI state, selected account or provider, pending operation, and recent user or system events
- remote service status, API response shape, deployment id, release channel, updater manifest, or sync peer state when relevant

For the fix itself, add lightweight telemetry that distinguishes plausible failure classes. Prefer
structured fields that can answer "what was the system doing, how long had it been doing it, what
resource was growing, and what dependency was waiting?" Examples include:

- heartbeat or progress payloads with event loop lag, visibility, route, app phase, pending operation, and oldest pending age
- worker state, queue state, retry counters, timeout counters, active provider, active task id, and last successful checkpoint
- persistence state, document size, cache size, snapshot activity, schema version, migration version, and save duration
- native process RSS, child process RSS, heap usage, DOM node count, open handles, and relevant cache sizes
- sleep, resume, hide, show, online, offline, update check, sync start, sync finish, and recovery timestamps
- a small rotating diagnostics file when the failure could prevent normal logs or heartbeats from being delivered

Mitigation and recovery behavior should be conservative and observable:

- recover quickly enough to avoid leaving the user stuck
- avoid churn when normal background throttling, offline state, or temporary provider errors explain the symptom
- log the recovery reason, stale age or failed duration, last known state, probe results, resource usage, and whether the system resumed normal work afterward
- recycle or reset related background resources when they may share the failing process, connection pool, cache, worker, or queue

Tests should cover the state machine, thresholds, retry limits, and telemetry fields that prove the
new behavior. If the root cause is still unknown after the patch, say that directly in the PR and
list exactly what the new telemetry will prove on the next occurrence.

## Automerge

**Schema** (`packages/shared/src/schema.ts`): backward-compatible only. Add optional fields; never delete (mark `@deprecated`).

**Mutations** must use `A.change()` — direct mutation silently fails to sync:

```ts
A.change(doc, (d) => {
  d.items.push(item);
}); // ✅
doc.items.push(item); // ❌ silent failure
```

**Proxy constraints inside `A.change()`:**

- Never assign `undefined` — use `delete` instead
- Never replace an existing nested object — assign fields individually or use a `deepMergeInto` helper
