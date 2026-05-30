# Nightly Self Improvement Runner

The nightly runner turns existing evidence into a queue of safe work for an overnight agent run. It combines the installed-build soak, daily bug scan memory, crash-watch state, and roadmap context into ranked targets.

The first rule is simple: evidence first, code second. If a target has weak evidence, the runner can still write a task prompt, but it should not ship a fix.

## What It Reads

- Active soak pointer at `/tmp/freed-perf-soak/current-soak-dir`
- Soak files such as `metrics.tsv` and `runtime-health.jsonl`
- Daily bug scan memory at `/Users/aubreyfalconer/.codex/automations/daily-bug-scan/memory.md`
- Crash-watch automation state
- Hourly dev bot memory as a roadmap fallback
- Git state for the current checkout
- Local git worktrees with unmerged or uncommitted changes
- Prior outcome ledger at `/tmp/freed-nightly-self-improve/outcomes.jsonl`

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

The generated run directory contains:

- `report.md`: morning-readable summary
- `targets.json`: full machine-readable candidate list
- `tasks/*.md`: one implementation prompt per selected target
- `outcome-template.jsonl`: lines to append back into the outcome ledger after the run

Reports include an execution phase list so the night can move from evidence, to peer comparison, to implementation, validation, dev build shipping, installed-build soak, and the morning digest.

## Safety Gates

The runner excludes provider-visible tasks by default. Do not allow autonomous changes that alter authenticated WebView loads, provider navigation, provider API call frequency, scripted scrolling, cookies, headers, or scraping timing without explicit approval.

Release work is also gated. A dev build should ship only after actual fixes merge into `dev`, not after planning artifacts alone.

## Next Improvements

- Wire the generated outcome template into the actual overnight closeout so target scoring learns without manual copying.
- Compare every morning report against the previous installed build, especially WebKit RSS and frame budget deltas.
- Let a run split itself into phases: plan, fix, validate, publish PR, merge when green, ship dev build, install, then soak.
- Add a duplicate-work detector that notices when two night agents are chasing the same bottleneck.
- Add a stale-risk detector for generated artifacts, dirty worktrees, missing dependencies, and paused automations.
- Turn recurring failure signatures into reusable focused test recipes.
