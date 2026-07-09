---
name: freed-canary
description: Judge an installed Freed Desktop release against the trailing canary ledger — run canary-summarize over the release's runtime-health window, commit the ledger record, and if a metric regressed, plan a bisect with bisect-regression. Use when asked whether a release regressed the machine, after a release has run for a day, or when a soak verdict looks worse than usual.
disable-model-invocation: true
---

# Canary

The owner machine is the de-facto canary fleet: releases are near-daily and there is no remote telemetry. This skill turns "did this release regress it" into a ledger lookup, and "which commit" into a planned bisect. Program rules bind: **regressions become tasks or bisects, never watchdog threshold edits** ([docs/STABILITY-PROGRAM.md](../../../docs/STABILITY-PROGRAM.md)).

## Workflow

1. Confirm the installed version and how long it has been running: `defaults read /Applications/Freed.app/Contents/Info.plist CFBundleShortVersionString`; prefer ≥24h of runtime-health history for a fair record (rotated files cover 14 days).
2. Summarize the window: `node scripts/canary-summarize.mjs --hours 24` (pass `--version` to override attribution, `--since-ms/--until-ms` for an exact window). This writes `canary-ledger/canary-<version>.json` with recoveries/day, window kills by reason, invariant alarms by name, uploads + damper skips, worker INITs/hour, scrape success by provider, peak memory, and the idle growth slope — and flags regressions vs the trailing-7-record median.
3. Read the record, not the vibes: report the metrics table and the `regressions` array. An empty trailing ledger means "first record, nothing to compare" — say so.
4. Commit the ledger record on a small branch → PR to dev (`canary: record <version>`), so the ledger is durable history the triage loop and nightly runner can read.
5. If a metric regressed, plan the bisect: `node scripts/bisect-regression.mjs --metric <name> --good <last-good-version> --bad <this-version> --threshold <n>`. The default is a DRY RUN printing the commit range, step count, and exact `git bisect run` commands — a 90-min-per-step soak bisect is an operator commitment, so present the plan and get an explicit go (10-minute-timeout contract applies) before `--execute`.
6. When the culprit range is found, hand off: cite the range and the regressed counter in a task file or PR comment; the fix flows through the normal owner-review lanes (`runner-safe: false` for product code).

## Success criteria (counters, not vibes)

- `canary-ledger/canary-<version>.json` exists, is committed, and its `regressions` array is either empty or each entry names metric, current value, trailing median, and limit.
- A flagged regression produces either a bisect plan (with commit range and step estimate) or a written reason why bisecting is not worth it — never silence.
