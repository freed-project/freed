# W2-03: canary-summarize, watchdog-replay, and bisect scripts

runner-safe: true | provider-visible: false | soak-gated: no
Prereq: P0-04 rotation (multi-day history), W1-02 collector.

## Context

Releases are near-daily with no remote telemetry; the owner machine is the de-facto canary fleet, but "which release regressed it" is a manual investigation, and watchdog constants could historically only be validated by shipping (the #847/#850 3-hour flip-flop).

## Change

1. `scripts/canary-summarize.mjs`: per installed release, compute from rotated runtime-health: recoveries/24h, peak per-window RSS (after Wave-6 attribution; aggregate until then), idle growth slope, alarm counts by type, provider success rate by outcome, uploads/day. Write `canary-<version>.json` to a committed ledger dir; flag regression when worse than trailing-7-release median by per-metric tolerance.
2. `scripts/replay-watchdog.mjs`: re-run the recovery decision functions against recorded RuntimeMemoryStats traces, old vs new constants, reporting what each variant would have done. Requires the decision logic to be a pure function of the stats snapshot — if lib.rs needs a small extraction to enable this, keep it mechanical and behavior-preserving (a natural first slice of the Wave-6 lib.rs split). This makes threshold changes a pre-merge check instead of a shipped experiment.
3. `scripts/bisect-regression.mjs`: metric name + version range → commit range (version bumps are commits) → `git bisect run` with the 90-min soak verdict (W1-02) as predicate.

## Verify

- Fixture tests for all three; canary regression detection on a synthetic worsened trace.
- Replay reproduces at least one historical decision from a recorded trace in the repo's test fixtures.
