---
name: freed-canary
description: Judge an installed Freed Desktop build against comparable historical runtime windows. Use after a release has run long enough, when a soak looks worse than usual, or when deciding whether a metric regressed. Require event-derived build identity, immutable time bounds, healthy evidence sources, matching workload cohorts, and at least three comparable baselines before declaring a regression.
disable-model-invocation: true
---

# Canary

Judge a build from attributable evidence. The installed version observed at report time is not proof of which build produced an earlier sample.

## Workflow

1. Record the task ID and allowed authority. Observation may be automatic. Committing a ledger record, opening a PR, or starting a bisect requires the corresponding authority.
2. Select an immutable window whose events identify one app version, channel, git SHA, app session, collector session, and app PID. Split windows at releases, relaunches, sleep transitions, and process-generation changes where the metric requires it.
3. Check source health, parse failures, sample gaps, app-alive coverage, network state, scenario, and document-size bucket. Return an analytical `inconclusive` result when required identity or coverage is missing, and preserve it even when it cannot become a task lifecycle outcome.
4. Build `canary-context.json` from the finished soak with `node
scripts/canary-context.mjs --verdict <soak-dir>/soak-verdict.json
--install-id <id> --installed-at <iso>`. The helper rebuilds the stored soak
   before copying build, runtime, workload, host, source coverage, cloud
   duration, and optional artifact digest. Caller workload or host values may
   only assert an exact match. They cannot relabel the window.
5. Run `node scripts/canary-summarize.mjs --context
<canary-context.json> --collector-metrics <soak-dir>/metrics.tsv`. The
   context owns the exact start and end bounds. The summarizer hashes and
   copies runtime-health JSONL, collector-metrics TSV, and the ordered bounded
   collector-events JSONL into the ledger. By default it reads the rotated
   collector-events archive before the live file. Do not attribute an
   arbitrary trailing window to the currently installed version or a manually
   supplied version label.
6. Compare only cohorts with compatible operating system, RAM tier, document-size bucket, provider state, workload, and process-generation semantics. A baseline window must be between 0.8 and 1.25 times the current window duration, inclusive.
7. Require at least three comparable historical windows before an automatic regression verdict. With fewer, record the current observation as a provisional baseline and return `inconclusive`.
8. Judge each metric through the versioned metric registry. Use app-alive time for runtime rates and verified cloud-eligible time for cloud rates. A missing denominator makes that metric unavailable.
9. Preserve every observation window. Records and raw sidecars are content addressed and published atomically. Reuse an existing path only when its bytes are identical. Changed evidence must create a new bundle and must never overwrite history.
10. If authorized, publish the ledger record and all three evidence sidecars
    through a small PR to `dev`. Include the exact build identity, time bounds,
    cohort definition, coverage, and verdict. The JSON and sidecars are one
    portable provenance bundle.
11. If a metric regressed, create a plan-only bisect with `scripts/bisect-regression.mjs`. Do not execute bisection until a harness can build each commit, install it, verify the installed SHA, collect an isolated window, and restore the prior app.
12. Map a confirmed regression to one stable task ID. A provisional or inconclusive signal does not authorize product changes.
13. Record a task verification outcome only when its canonical task is in
    `soaking`. Convert the exact JSON canary record with
    `build-outcome-verdict.mjs --canary-verdict`. For a measured outcome, name
    one registered canary metric. The converter derives the before and after
    values, unit, direction, limit, and tolerance from the canary comparison and
    checked-in registry, then hashes the source record. A canary pass can prove
    `verified_neutral`, not `verified_effective`. Pass only that generated outcome verdict to
    `record-outcome.mjs`. Its build, evidence window, source health, and
    composite fingerprint must match the canonical installed task. Record a
    lifecycle `inconclusive` only for a nonempty, attributable, build-bound
    canary window with a complete fingerprint. Missing or mixed identity and
    empty evidence remain analytical results. Keep the task in `soaking` and
    repair the evidence path instead of inventing attribution.

## Required output

Report the metric table, evidence quality, comparable baseline count, build identity, immutable window, and the canary comparison status: `pass`, `regression`, or `inconclusive`. Every conclusion must cite the raw evidence or ledger record that supports it. A canary pass proves only that the window did not regress against its matched baselines. It does not prove a task was effective. Record task outcomes separately as `verified_effective`, `verified_neutral`, `regressed`, or recordable `inconclusive` only when task-specific, build-bound evidence satisfies the lifecycle contract.
