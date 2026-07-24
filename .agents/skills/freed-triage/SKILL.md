---
name: freed-triage
description: Reconcile fresh Freed stability evidence into governed, deduplicated GitHub debt issues. Use after runtime alarms, soak verdicts, canary results, or CI failures, and when deciding what to fix next. Require healthy evidence sources, temporal and build matching, issue identity, atomic evidence generations, explicit authority, and instrumentation-first handling of contradictory metrics.
disable-model-invocation: true
---

# Triage

Convert attributable evidence into one deduplicated issue backlog. GitHub Issues labeled `debt` are the sole backlog. Local generations and control tasks are evidence and execution state, not additional queues.

## Reconcile evidence

1. Run `node scripts/triage.mjs`. Use offline mode only when intentionally excluding CI evidence.
2. Read only the canonical current-generation manifest emitted by the triage script. Do not scan arbitrary leftover rank files as current state.
3. Check source health before ranking: event parse failures, log gaps, soak coverage, canary cohort size, CI SHA, and installed build identity.
4. Match evidence by build, app session, event time, operation ID, and metric definition. A verdict may suppress an alarm only when it covers the same build and ends after that alarm.
5. If two consumers disagree about a metric, create or prioritize one instrumentation-contract debt issue. Do not use the contradiction as authorization to change product behavior.
6. Mark missing identity, low coverage, mixed builds, or unhealthy sources as `inconclusive`.

## Reconcile issues

1. Search open issues labeled `debt` by root cause, metric ID, and legacy reference before creating anything.
2. Update the matching issue when it exists. Otherwise use [the debt issue form](../../../.github/ISSUE_TEMPLATE/debt.yml) to create one issue for the independently closable root cause.
3. Do not turn adjacent observations into more issues without evidence that they are separate root causes.
4. Keep the atomic candidate generation as evidence only. It must reference the canonical issue.
5. Create a control task only when an issue is selected for execution. Store the issue as `details.githubIssue: { number, url }`.

Every issue-backed candidate must include:

- GitHub issue number, URL, and evidence fingerprint
- Root-cause bucket and metric-registry ID
- Exact evidence pointers and observation bounds
- Build identity and source-health status
- Current lifecycle state and last transition time
- Authority level, owner-review requirement, and provider-risk state
- Soak exclusivity key and required verification window

Write evidence candidates as one atomic generation with one current pointer. A new generation supersedes the prior rank set without creating or reopening backlog items.

## Decide the handoff

1. Rank CI truth and measurement defects before product hypotheses when they block trustworthy judgment.
2. Keep closed issues closed unless fresh evidence from a later installed build proves regression. Prior success must not increase a completed issue's execution score.
3. If the top issue is safe and authorized, hand it to `freed-build-feature` with its issue reference, metric contract, and verification plan.
4. Send provider-visible work to `freed-provider-risk-review` before implementation.
5. Admit only one behavioral product change globally. A different soak exclusivity key does not create another slot. Wait for the active change's installed-build soak outcome before handing off the next behavior.
6. An issue whose execution policy requires owner review may reach an owner-review PR but may not merge autonomously.
7. If no candidate has fresh, healthy, actionable evidence, append a deduplicated no-op control event and stop. Do not create motion to entertain the scheduler.

## Verify learning

After release and soak, reconcile the exact issue, operational task, and build into `verified_effective`, `verified_neutral`, `regressed`, or `inconclusive`. Reopen work only from new evidence that names the later build and window.
