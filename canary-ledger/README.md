# Canary ledger

One committed record per observation window, produced by
`node scripts/canary-summarize.mjs` from rotated runtime-health history. The
owner machine is the local canary fleet. Releases are frequent and Freed does
not send remote telemetry, so these records make regressions attributable to a
specific installed build and time window.

## Record contract

- Files use
  `canary-<version>-<window-start>-<window-end>-<sha256>.json`. Runtime-health
  and collector sidecars also use their full content digest in the filename.
  Publication is atomic and exclusive. An exact rerun reuses byte-identical
  files, while changed evidence creates a new bundle and never overwrites an
  existing artifact.
- Each schema version 2 record includes the metric-registry version, full build
  and commit identity, install boundary, collector session, app PID, app session,
  workload, observation ID, comparison context, UTC window bounds, source
  coverage, evidence fingerprint, folded metrics, and comparison result.
- Each record references two ledger-relative, SHA-256 sidecars: the exact
  runtime-health JSONL used for the window and the exact collector-metrics TSV
  used to rebuild app-alive and cloud-eligible denominators. The record and
  both sidecars are one portable bundle. Commit or move them together.
- The evidence fingerprint is schema version 1. It binds the ordered runtime
  records, raw collector metrics, credited coverage and denominators, build and
  app-session attribution, collector session, and app PID. Its runtime-health
  and collector-metrics components remain visible so consumers can recompute
  the parts for which they hold the raw source files. Changing a denominator or
  duplicating a counted event changes the composite digest.
- The comparison context contains platform, architecture, memory tier, channel,
  scenario, provider cohort, and document-size bucket. A baseline is comparable
  only when this context and the metric-registry version match the current
  record. Its duration must also be between 0.8 and 1.25 times the current
  observation duration, inclusive.
- Each metric needs at least three comparable prior windows. The comparison uses
  up to the trailing seven comparable records and the per-metric tolerances in
  `scripts/lib/stability-metrics.mjs`.
- Windows from the installed version being judged remain in the ledger but are
  excluded from that version's baseline. A release cannot validate itself.
- A missing metric is `unavailable`. A metric with too little matching history
  is `inconclusive`. A window with no runtime-health entries is also
  analytically `inconclusive`. None of these cases is a pass. Only a nonempty,
  attributable, build-bound window with a complete composite fingerprint can
  become a task lifecycle `inconclusive` outcome.
- Older records remain valid evidence, but old schema or metric-registry
  versions intentionally start a new cold baseline.
- Metric-registry version 3 enforces the worker INIT target below 10 events per
  app-alive hour after at least one attributable app-alive hour. Version 2 named
  every rate denominator but did not enforce that soak target. Runtime rates use
  app-alive time, cloud rates use connected and eligible cloud time, and memory
  slopes use the elapsed span of attributable samples. Records from earlier
  metric-registry versions are not comparable.

The folded metrics include recoveries/day, window kills by reason, invariant
alarms by name, cloud upload and damper-skip rates, worker INITs/hour, scrape
outcomes by provider, peak app and WebKit memory, and idle app-resident growth.
Runtime rates use app-alive time. Cloud rates require measured connected and
eligible cloud time. Memory slopes use attributable sample elapsed time.
Without the required denominator, the corresponding metric is unavailable.
The bounded `cloud_sync_coverage` event still requires scoped provider approval
before its runtime emitter can land. Until that happens, cloud-eligible time is
unavailable and cloud-rate comparisons remain `inconclusive`.
Native heartbeat, memory, recovery, and alarm records do not yet carry the same
build and app-session identity as renderer records. A window containing those
untagged metric records now fails attribution and remains `inconclusive`. The
native identity stamping change must land through its scoped provider review
because the conservative classifier protects the shared native orchestration
file.
The nightly runner and triage loop read the newest records. Reviewers use the
same files to connect a regression to an installed build and exact evidence
window.

Create an exact observation context from a healthy soak verdict:

```bash
node scripts/canary-context.mjs \
  --verdict <soak-dir>/soak-verdict.json \
  --install-id <install-id> \
  --installed-at <iso>
```

Then summarize only that build-bounded window:

```bash
node scripts/canary-summarize.mjs \
  --context <soak-dir>/canary-context.json \
  --collector-metrics <soak-dir>/metrics.tsv \
  --strict
```

There is no `--version`, commit, channel, app-session, or trailing-hours
fallback. The soak verdict must contain one event-derived app version, full
commit SHA, channel, app session, collector session, and app PID. The helper
copies that identity and never accepts replacement labels from the caller.
Cloud-eligible time is also copied from the soak verdict and has no manual
override.

`--strict` exits nonzero for a proven regression. It does not turn an
inconclusive window into a failure or a pass. Commit the generated JSON record,
runtime-health JSONL sidecar, and collector-metrics TSV sidecar even when the
result is inconclusive so the ledger preserves the evidence and makes the
cold-start reason visible. Committing the canary bundle does not authorize a
task transition when the lifecycle outcome contract is unavailable.
