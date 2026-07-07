# W1-02: Check in soak collector + soak-assert with machine-readable verdict

runner-safe: true | provider-visible: false | soak-gated: no

## Context

Installed-build soaks write `metrics.tsv` via a collector script that is not in source control, and there is no automated pass/fail judgment — soak evidence is read by eye. The stability program needs every soak to yield a verdict that loops can gate on.

## Change

1. `scripts/soak-collect.mjs`: samples the installed Freed Desktop app on an interval (process RSS/footprint via `ps`/`proc_pid_rusage` where available, WebKit process table, app-data `runtime-health.jsonl` tail offsets) into a versioned, documented TSV/JSONL schema under the soak dir. Must run detached, survive terminal close, and write a `current-soak-dir` pointer (per W1-01 location).
2. `scripts/soak-assert.mjs`: reads a soak dir + the app's runtime-health files and emits `soak-verdict.json` with named assertions, each citing the violating lines: idle main-window footprint slope < 25 MB/h over ≥4h; renderer recovery count == 0; stale-heartbeat count == 0; scraper windows return to zero between cycles. Add assertions for the P0-03 counters (uploads-with-unchanged-heads == 0, preflight_kill == 0, scrape_zero_persist == 0) guarded so they no-op until those counters exist.
3. Both scripts get `node --test` coverage with fixture files, wired into `npm run test:scripts`.

## Verify

- Run collector against a live installed build for 10 minutes; assert produces a verdict JSON with real numbers.
- Fixture-driven tests: a synthetic leaky trace fails the slope assertion; a flat trace passes.
