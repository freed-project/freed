# Nightly Self Improvement Runner

The nightly runner turns existing evidence into a queue of safe work for an overnight agent run. It combines the installed-build soak, daily bug scan memory, crash-watch state, and roadmap context into ranked targets.

The first rule is simple: evidence first, code second. If a target has weak evidence, the runner can still write a task prompt, but it should not ship a fix.

## What It Reads

- Active soak pointer at `/tmp/freed-perf-soak/current-soak-dir`
- Soak files such as `metrics.tsv` and `runtime-health.jsonl`
- The newest readable soak under `/tmp/freed-perf-soak` when the active pointer has no samples
- Daily bug scan memory at `/Users/aubreyfalconer/.codex/automations/daily-bug-scan/memory.md`
- Crash-watch automation state
- Hourly dev bot memory as a roadmap fallback
- Git state for the current checkout
- Local git worktrees with unmerged or uncommitted changes
- Duplicate peer work indicators such as shared changed files, shared package surfaces, and shared provider-visible risk
- Provider-visible peer worktrees, even when they are not runner branches
- Prior outcome ledger at `/tmp/freed-nightly-self-improve/outcomes.jsonl`
- Preflight risks such as dirty worktrees, generated artifacts, stale or thin soak samples, missing dependencies, missing evidence files, and paused automations
- Preflight actions that separate safe local commands from manual or agent-tool-only remediation

## Target Types

- Peer worktree: active local branch work that may contain useful fixes or measurement
- Performance: WebKit memory, event loop lag, DOM growth, stale heartbeat cycles
- Bug fix: recent commit scans using the existing daily bug scan rules
- Stability: crash-watch and blank-window evidence
- Release: dev build readiness after real fixes land
- Roadmap: small autonomous product work after evidence-backed targets are exhausted
- Blocked: provider-visible ideas that need explicit approval before execution

The runner can select more than one target when the night has enough budget. It now aims to queue at least three machine hours of safe work when the evidence supports it. If no single large target fills the night, it should keep stacking smaller, validation-friendly targets instead of stopping after the first easy win. A typical run should first compare peer worktrees, then pick WebKit memory when it is over budget and backed by enough fresh soak samples, then a bug scan, then crash-watch triage or release readiness.

## Usage

```bash
npm run nightly:self-improve
```

Useful direct form:

```bash
node scripts/nightly-self-improve.mjs --max-targets 6 --duration-minutes 480 --minimum-night-minutes 180
```

Compare a known peer branch directly:

```bash
node scripts/nightly-self-improve.mjs --peer-worktree /Users/aubreyfalconer/dev/freed-scraper-recycle-verification
```

Dry run:

```bash
node scripts/nightly-self-improve.mjs --dry-run --json
```

Plan from a specific dev checkout:

```bash
node scripts/nightly-self-improve.mjs --repo /Users/aubreyfalconer/dev/freed-dev-worktree
```

Repair an unreadable active soak pointer when a newer readable soak exists:

```bash
node scripts/nightly-self-improve.mjs --repair-soak-pointer
```

Use a custom outcome ledger:

```bash
node scripts/nightly-self-improve.mjs --outcome-ledger /tmp/freed-nightly-self-improve/outcomes.jsonl
```

Record a finished target directly into the ledger:

```bash
node scripts/nightly-self-improve.mjs --outcome-ledger /tmp/freed-nightly-self-improve/outcomes.jsonl --record-outcome webkit-memory-pressure --record-kind performance --record-status shipped --record-pr 617 --record-build v26.5.2900-dev --record-notes "Merged, installed, and soaked."
```

The generated run directory contains:

- `report.md`: morning-readable summary
- `targets.json`: full machine-readable candidate list
- `risk-snapshot.md` and `risk-snapshot.json`: preflight blockers, warnings, evidence, and remediation steps
- `preflight-actions.md` and `preflight-actions.json`: machine-readable local, manual, and automation-tool risk actions
- `duplicate-work.md` and `duplicate-work.json`: peer worktree overlap by file and surface
- `tasks/*.md`: one implementation prompt per selected target
- `execution-plan.md` and `execution-plan.json`: ordered phases, command hints, and stop gates
- `outcome-closeout.md`: one ready-to-run ledger command per selected target
- `outcome-template.jsonl`: lines to append back into the outcome ledger after the run

Reports include an execution phase list so the night can move from evidence, to peer comparison, to implementation, validation, dev build shipping, installed-build soak, ledger closeout, and the morning digest.

The queue is no longer allowed to stop after one short task. The default selector keeps adding safe targets until it reaches the three-hour floor, the budget runs out, or the candidate list is exhausted.

Stale dirty peer worktrees still stay in the evidence queue, but they no longer jump ahead of a fresh bug scan just because they touch nightly runner files. If a peer is read-only, behind current `dev`, and has no commits ahead of `origin/dev`, treat it as comparison material, not as the first thing to ship. Daily bug scan summaries now also recognize explicit "no new repo commits" outcomes and avoid treating an unmerged regression note as if a fix already landed.

Peer worktrees whose branch name and exact head SHA already match a merged `dev` PR are now dropped from the automatic candidate list. If the same path still matters, pass it explicitly so the runner treats it as deliberate evidence instead of reheating already-shipped work.

## Safety Gates

The runner excludes provider-visible tasks by default. Provider-visible peer worktrees are still pulled into the evidence queue so they cannot hide in the local swarm. Do not allow autonomous changes that alter authenticated WebView loads, provider navigation, provider API call frequency, scripted scrolling, cookies, headers, or scraping timing without explicit approval.

Release work is also gated. A dev build should ship only after actual fixes merge into `dev`, not after planning artifacts alone.

Installed-build soaks should be terminal driven when possible. Prefer logs, runtime-health samples, process samples, and the native sync trigger helper over System Events clicks or foreground UI automation on the user's primary machine. Use a GitHub dev-channel prerelease, or launch a local build with `FREED_ENABLE_DEV_SYNC_TRIGGERS=1`, then run `node scripts/dev-sync-trigger.mjs facebook`, `instagram`, or `linkedin` to call the normal in-app provider refresh path. The helper must not bypass auth, pause state, cooldowns, or rate limits. It is picked up from the native process so it still works when WebKit has suspended a backgrounded renderer. Keep the raw file trigger gated to dev-channel installs, debug builds, or explicit `FREED_ENABLE_DEV_SYNC_TRIGGERS=1` launches until it has a user-facing permission model, because local file writes that initiate authenticated provider traffic are a real control boundary.

When an installed build must be launched during a soak, use `open -g /Applications/Freed.app` first. Freed Desktop should not force itself to the foreground during cold startup, so this keeps diagnostics and terminal-triggered sync checks moving without interrupting the primary workstation. Foreground actions are still appropriate when the user explicitly asks to open the app or when the 10 minute timeout path has elapsed.

The trigger file is a live request, not a durable queue. Requests expire after the helper timeout so old provider syncs do not replay on the next launch. If a run sees an expired trigger result, it should re-run `node scripts/dev-sync-trigger.mjs <provider>` and keep going.

An overnight run must keep making progress when the user is away. It is inappropriate to stop partway through the night and wait until morning solely because a button click would continue validation or let the agent test the work properly. If foreground app interaction is genuinely necessary, ask for permission with a 10 minute response window, then proceed if the user is unavailable. If the same action will matter again, add and ship a terminal trigger so future runs can execute it from the terminal. Sitting idle until morning is not acceptable when a trigger can be built or the user has given a timeout path.

This requirement also applies to the files the runner generates. Task prompts, execution plans, outcome closeout notes, and morning reports must not hand the next agent a dead end like "wait for the user to click Sync Now" when a trigger can be written or an approved timeout path exists. Each generated plan should name the terminal command it expects, identify the missing trigger that must be built before the soak continues, or state that foreground interaction may proceed after the 10 minute response window. The machine can wait on evidence, CI, network, or a provider-risk approval. It should not wait on performative button etiquette.

Every execution phase has a stop gate. The runner should stop rather than freestyle when evidence is missing, a peer branch is still changing, a provider-visible change needs approval, focused validation fails, or no real fix landed. The preflight risk snapshot is now also a selectable target, so blocker risks like a dirty current worktree, a non-dev checkout, or missing dependencies can win the queue before the runner starts editing. By default the planner expects to run from `dev`; use `--repo` for the intended dev worktree or `--no-expected-branch` only for deliberate diagnostics. If the active soak pointer is empty, the runner falls back to the newest readable soak and records that fallback in the risk snapshot. When the fix is purely local, `--repair-soak-pointer` can update the active pointer to that readable soak so later runs no longer start from a dead evidence path. Performance targets need at least three fresh soak samples, so a single stale heartbeat can inform the report without pretending to be a real budget miss. Preflight actions label each remediation as a safe local command, manual review, or automation-tool action before an overnight agent touches it.

## Next Improvements

- Compare each recorded outcome to the prior target score so repeated misses automatically lower future priority.
- Compare every morning report against the previous installed build, especially WebKit RSS and frame budget deltas.
- Let a run split itself into phases: plan, fix, validate, publish PR, merge when green, ship dev build, install, then soak.
- Let duplicate-work findings assign an owner automatically when one branch already has passing validation.
- Promote more preflight risk fixes into automatic cleanup steps when the remediation is unambiguous and local only.
- Turn recurring failure signatures into reusable focused test recipes.
