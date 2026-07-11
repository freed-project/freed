# W2-03: canary-summarize, watchdog-replay, and bisect scripts

runner-safe: true | provider-visible: false | soak-gated: no
Prereq: P0-04 rotation (multi-day history), W1-02 collector.

## Context

Releases are near-daily with no remote telemetry; the owner machine is the de-facto canary fleet, but "which release regressed it" is a manual investigation, and watchdog constants could historically only be validated by shipping (the #847/#850 3-hour flip-flop).

## Change

1. `scripts/canary-context.mjs` and `scripts/canary-summarize.mjs`: bind a healthy soak to its event-derived full commit SHA, version, channel, app session, collector session, app PID, install boundary, exact window, workload scenario, provider cohort, document-size bucket, platform, architecture, RAM tier, and measured denominators. Caller-supplied build and app-session labels are not accepted. Summarization has no current-installed-version or trailing-hours fallback. It computes recoveries/24 app-alive hours, window kills by reason, invariant alarms, provider outcomes, cloud upload rates only with verified cloud-eligible time, worker INITs/app-alive hour, peak memory, and idle growth slope. Write the record and both raw sidecars with full content digests in their filenames, atomic exclusive publication, and byte-identical reuse only. Changed evidence creates a new bundle and never overwrites an existing artifact. Compare only records with the same metric-registry version and complete cohort context. A baseline duration must be between 0.8 and 1.25 times the current duration, inclusive. Require at least three distinct, earlier, comparable prior windows for each metric. Empty, thin, old-schema, unattributed, duplicated, future, duration-mismatched, and unmatched-context history stays `inconclusive` instead of becoming a false pass.
2. `scripts/replay-watchdog.mjs`: re-run the recovery decision functions against recorded RuntimeMemoryStats traces, old vs new constants, reporting what each variant would have done. Requires the decision logic to be a pure function of the stats snapshot. If lib.rs needs a small extraction to enable this, keep it mechanical and behavior-preserving (a natural first slice of the Wave-6 lib.rs split). This makes threshold changes a pre-merge check instead of a shipped experiment.
3. `scripts/bisect-regression.mjs`: resolve a metric and good/bad release range into a bisect plan. Runtime execution is intentionally disabled. The former executor checked out candidate commits but measured the already-installed app, so every candidate was judged against the same binary. Execution remains blocked until the harness can build each checked-out commit with the pinned toolchain, install it in isolation, verify the installed commit SHA, cold launch it, collect a build-bounded soak with minimum coverage, and restore the prior app even after failure.

## Verify

- `node --test scripts/stability-ops.test.mjs`
- Canary regression detection flags a synthetic worsened trace only after three matching-context baselines.
- Multiple windows for one release produce distinct content-addressed filenames, and a window with no runtime-health entries is `inconclusive`.
- Exact reruns reuse immutable artifacts, changed evidence cannot overwrite an existing path, and duration ratios outside 0.8 through 1.25 are excluded.
- Missing build identity, session identity, exact bounds, app-alive coverage, or a required cloud denominator fails closed.
- Replay reproduces at least one historical decision from a recorded trace in the repo's test fixtures.
- Bisect plans report `executionSupported: false`; `--execute` and `--predicate` fail closed until the build and install harness exists.
