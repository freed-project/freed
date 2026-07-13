---
name: freed-stability-controller
description: Reconcile Freed stability observations, tasks, approvals, releases, soaks, and outcomes into one governed lifecycle. Use when coordinating the continuous background agents, deduplicating repeated findings, selecting the next stability action, advancing task state, or deciding that no fresh actionable work exists. This skill coordinates authority and handoffs but does not implement product code.
disable-model-invocation: true
---

# Stability Controller

Maintain one durable control-plane truth for each root cause. Sensors observe. This controller reconciles. Execution skills change code or external state.

## Reconcile state

1. Read the current metric registry, stability program, canonical triage generation, active verification sessions, release identities, provider approvals, and outcome ledger.
2. Identify every input by build, immutable time bounds, source health, and evidence fingerprint.
3. Match inputs to a stable task ID. Merge repeated observations of the same root cause instead of creating a second task.
4. Distinguish instrumentation-contract defects from product defects. Fix measurement truth first when evidence consumers disagree.
5. Accept these lifecycle states:

   `observed`, `triaged`, `approved_for_pr`, `implemented`, `validated`, `merged`, `installed`, `soaking`, `verified_effective`, `verified_neutral`, `regressed`, `inconclusive`, `governance_blocked`, `superseded`, `implementation_failed`, `closed`

6. Record each transition with timestamp, actor, authority, evidence pointer, source and destination state, and idempotency key.
7. Keep append-only evidence separate from transactional current state. Update current state atomically.

## Apply authority

- Observation and reconciliation do not grant permission to write code, post externally, merge, release, deploy, or contact a provider.
- Carry the checked-in actor policy as `observe-only`, `plan-only`, `pr-only`, or `merge-safe`. A trusted host launcher binds a selected general actor role to its pinned credential and runtime outside the agent process. It does not authenticate which same-user saved automation invoked that role. Mutations receive only that role's short-lived canonical lease token in `FREED_AUTOMATION_LEASE_TOKEN`.
- Before a general actor mutates state, require `npm run --silent automation:actors -- acquire --actor <actor>` to return its canonical lease. Treat missing or failed host verification as `blocked_by_authority`. Never substitute a reusable secret, an owner lease, a publisher capability, or a signing-free task mutation path.
- General actor provisioning is an owner action from a reviewed clean `dev` checkout. It does not grant provider authority. Keep provider contact forbidden until the canonical task and provider approval gates allow it.
- Require the provider-specific approval packet for provider-visible implementation. General implementation authority does not replace it.
- Enforce one behavioral product change globally. Exclusivity keys label evidence and prevent duplicate work, but they do not create parallel behavior slots. The next behavior waits until the active change has an installed-build soak outcome.
- Keep `runner-safe: false` work at owner-review PR state.

## Select work

1. Prioritize unhealthy evidence sources and red CI when they block trustworthy judgment.
2. Rank fresh attributable evidence above generic roadmap work.
3. Do not reward a completed task for having shipped. Reopen a closed stable ID only through `closed` to `triaged` with an evidence-window end later than the close timestamp.
4. Hand implementation to `freed-build-feature`, evidence gathering to `freed-evidence-capture`, offline reproduction to `freed-sync-replay`, memory measurement to `freed-memory-profile`, and provider review to `freed-provider-risk-review`.
5. If no state changed and no authorized action is ready, append a deduplicated no-op control event and stop. Do not manufacture a task for a heartbeat.

## Required decision

Return the selected stable task ID, current state, evidence quality, metric contract, authority, provider-risk status, exclusivity key, and next skill. If any required field is missing, return `inconclusive` or `blocked_by_authority` instead of guessing.

Read only validated manifests under `~/.freed/automation/artifacts/`. Record the
decision with kind `stability-controller` in the version 1 [stability artifact
schema](../../../automation/artifact-schemas/stability-artifact-v1.schema.json).
Validate and atomically store it with `node scripts/stability-artifact.mjs write
--input <manifest.json>`. The canonical result lives under
`~/.freed/automation/artifacts/stability-controller/<task-id>/` and supplies a
stable input to the next background actor.
