# W2-02: Triage loop: alarms + canary + red CI become ranked task files

runner-safe: true | provider-visible: false | soak-gated: no
Prereq: W2-01 alarms, W1-01 ledger location, W1-02 soak verdict.

## Context

Today, soak evidence, CI failures, and release regressions create no work items anywhere; the nightly planner rediscovers problems from scratch. Close the loop: evidence in, ranked tasks out.

## Change

1. `scripts/triage.mjs`: reads invariant-alarm aggregates (frequency × severity, deduped by root-cause bucket), the latest soak-verdict.json failures, canary regression entries (W2-03), and open CI-failure issues; emits ranked task files (same format as docs/stability-tasks/) into the nightly runner's candidate directory, each carrying evidence pointers (ledger lines, verdict entries).
2. CI hook: on `ci.yml` dev-push failure and `release.yml` failure, a workflow step opens/updates a labeled issue (`automation-triage`) with the failing job + log excerpt; triage.mjs reads these via the GitHub API.
3. Register the triage output as a first-class candidate source in `scripts/nightly-self-improve.mjs`, ranked above roadmap work when alarms are fresh.

## Verify

- Fixture-driven `node --test`: a synthetic alarm aggregate + failed verdict produces correctly ranked task files with evidence pointers.
- One live cycle: a seeded alarm (from W2-01 verification) appears as the nightly runner's top candidate the next night.
