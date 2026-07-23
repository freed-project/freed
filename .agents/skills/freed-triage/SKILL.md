---
name: freed-triage
description: Reconcile fresh Freed stability evidence into governed, deduplicated work. Use after runtime alarms, soak verdicts, canary results, or CI failures, and when deciding what to fix next. Require healthy evidence sources, temporal and build matching, stable task IDs, atomic candidate generations, explicit authority, and instrumentation-first handling of contradictory metrics.
disable-model-invocation: true
---

# Triage

Convert attributable evidence into one current task queue. Converge on [docs/STABILITY-PROGRAM.md](../../../docs/STABILITY-PROGRAM.md), never a parallel roadmap.

## Reconcile evidence

1. Run `node scripts/triage.mjs`. Use offline mode only when intentionally excluding CI evidence.
2. Read only the canonical current-generation manifest emitted by the triage script. Do not scan arbitrary leftover rank files as current state.
3. Check source health before ranking: event parse failures, log gaps, soak coverage, canary cohort size, CI SHA, and installed build identity.
4. Match evidence by build, app session, event time, operation ID, and metric definition. A verdict may suppress an alarm only when it covers the same build and ends after that alarm.
5. If two consumers disagree about a metric, create or prioritize an instrumentation-contract task. Do not use the contradiction as authorization to change product behavior.
6. Mark missing identity, low coverage, mixed builds, or unhealthy sources as `inconclusive`.

## Create governed candidates

Every candidate must include:

- Stable task ID and evidence fingerprint
- Root-cause bucket and metric-registry ID
- Exact evidence pointers and observation bounds
- Build identity and source-health status
- Current lifecycle state and last transition time
- Authority level, owner-review requirement, and provider-risk state
- Soak exclusivity key and required verification window

Write candidates as one atomic generation with one current pointer. A new generation supersedes the prior rank set without leaving reused ranks active.

## Decide the handoff

1. Rank CI truth and measurement defects before product hypotheses when they block trustworthy judgment.
2. Keep completed task IDs closed unless fresh evidence from a later installed build proves regression. Prior success must not increase a completed task's execution score.
3. If the top candidate is safe and authorized, hand it to `freed-build-feature` with its identity, metric contract, and verification plan.
4. Send provider-visible work to `freed-provider-risk-review` before implementation.
5. Admit only one behavioral product change globally. A different soak exclusivity key does not create another slot. Wait for the active change's installed-build soak outcome before handing off the next behavior.
6. A `runner-safe: false` task may reach an owner-review PR but may not merge autonomously.
7. If no candidate has fresh, healthy, actionable evidence, append a deduplicated no-op control event and stop. Do not create motion to entertain the scheduler.

## Verify learning

After release and soak, reconcile the exact task and build into `verified_effective`, `verified_neutral`, `regressed`, or `inconclusive`. Reopen work only from new evidence that names the later build and window.
