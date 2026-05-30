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
- Prior outcome ledger at `/tmp/freed-nightly-self-improve/outcomes.jsonl`
- Preflight risks such as dirty worktrees, generated artifacts, stale soak samples, missing dependencies, missing evidence files, and paused automations

## Target Types

- Peer worktree: active local branch work that may contain useful fixes or measurement
- Performance: WebKit memory, event loop lag, DOM growth, stale heartbeat cycles
- Bug fix: recent commit scans using the existing daily bug scan rules
- Stability: crash-watch and blank-window evidence
- Release: dev build readiness after real fixes land
- Roadmap: small autonomous product work after evidence-backed targets are exhausted
- Blocked: provider-visible ideas that need explicit approval before execution

The runner can select more than one target when the night has enough budget. A typical run should first compare peer worktrees, then pick WebKit memory when it is over budget, then a bug scan, then crash-watch triage or release readiness.

## Usage

```bash
npm run nightly:self-improve
```

Useful direct form:

```bash
node scripts/nightly-self-improve.mjs --max-targets 3 --duration-minutes 480
```

Compare a known peer branch directly:

```bash
node scripts/nightly-self-improve.mjs --peer-worktree /Users/aubreyfalconer/dev/freed-scraper-recycle-verification
```

Dry run:

```bash
node scripts/nightly-self-improve.mjs --dry-run --json
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
- `duplicate-work.md` and `duplicate-work.json`: peer worktree overlap by file and surface
- `tasks/*.md`: one implementation prompt per selected target
- `execution-plan.md` and `execution-plan.json`: ordered phases, command hints, and stop gates
- `outcome-closeout.md`: one ready-to-run ledger command per selected target
- `outcome-template.jsonl`: lines to append back into the outcome ledger after the run

Reports include an execution phase list so the night can move from evidence, to peer comparison, to implementation, validation, dev build shipping, installed-build soak, ledger closeout, and the morning digest.

## Safety Gates

The runner excludes provider-visible tasks by default. Do not allow autonomous changes that alter authenticated WebView loads, provider navigation, provider API call frequency, scripted scrolling, cookies, headers, or scraping timing without explicit approval.

Release work is also gated. A dev build should ship only after actual fixes merge into `dev`, not after planning artifacts alone.

Every execution phase has a stop gate. The runner should stop rather than freestyle when evidence is missing, a peer branch is still changing, a provider-visible change needs approval, focused validation fails, or no real fix landed. The preflight risk snapshot is now also a selectable target, so blocker risks like a dirty current worktree or missing dependencies can win the queue before the runner starts editing. If the active soak pointer is empty, the runner falls back to the newest readable soak and records that fallback in the risk snapshot.

## Next Improvements

- Compare each recorded outcome to the prior target score so repeated misses automatically lower future priority.
- Compare every morning report against the previous installed build, especially WebKit RSS and frame budget deltas.
- Let a run split itself into phases: plan, fix, validate, publish PR, merge when green, ship dev build, install, then soak.
- Let duplicate-work findings assign an owner automatically when one branch already has passing validation.
- Promote more preflight risk fixes into automatic cleanup steps when the remediation is unambiguous and local only.
- Turn recurring failure signatures into reusable focused test recipes.
