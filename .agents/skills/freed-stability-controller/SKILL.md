---
name: freed-stability-controller
description: Reconcile Freed stability observations, tasks, approvals, releases, soaks, and outcomes into one governed lifecycle. Use when coordinating the continuous background agents, deduplicating repeated findings, selecting the next stability action, advancing task state, or deciding that no fresh actionable work exists. This skill coordinates authority and handoffs but does not implement product code.
disable-model-invocation: true
---

# Stability Controller

Maintain one open GitHub issue labeled `debt` for each unresolved root cause. GitHub Issues are the sole backlog. Sensors observe. This controller reconciles. The control plane records only selected execution state. Execution skills change code or external state.

## Reconcile state

1. Read the current metric registry, open debt issues, canonical triage generation, active verification sessions, release identities, provider approvals, and outcome ledger.
2. Identify every input by build, immutable time bounds, source health, and evidence fingerprint.
3. Match inputs to an open issue by root cause, metric ID, and legacy reference. Merge repeated observations instead of selecting a second issue.
4. Distinguish instrumentation-contract defects from product defects. Fix measurement truth first when evidence consumers disagree.
5. Accept these lifecycle states:

   `observed`, `triaged`, `approved_for_pr`, `implemented`, `validated`, `merged`, `installed`, `soaking`, `verified_effective`, `verified_neutral`, `regressed`, `inconclusive`, `governance_blocked`, `superseded`, `implementation_failed`, `closed`

6. Create a control task only when an issue is selected for execution. Store the issue as `details.githubIssue: { number, url }`, classify `details.behavioral`, and record a positive integer `details.estimatedMinutes` from the issue scope.
7. Record each transition with timestamp, actor, authority, evidence pointer, source and destination state, and idempotency key.
8. Keep append-only evidence separate from transactional current state. Update current state atomically.

## Apply authority

- Observation and reconciliation do not grant permission to write code, merge, release, deploy, or contact a provider. The controller may create or update a deduplicated debt issue when this checked-in policy requires it. That is its only permitted external post.
- Carry the checked-in actor policy as `observe-only`, `plan-only`, `pr-only`, or `merge-safe`. A trusted host launcher binds a selected general actor role to its root-owned launcher and pinned runtime through a one-use kernel-attested channel. It stores no general actor credential in Keychain. It does not authenticate which same-user saved automation invoked that role. Mutations receive only that role's short-lived canonical lease token in `FREED_AUTOMATION_LEASE_TOKEN`.
- Before a general actor mutates state, require `npm run --silent automation:actors -- acquire --actor <actor>` to return its canonical lease. Treat missing or failed host verification as `blocked_by_authority`. Never substitute a reusable secret, an owner lease, a publisher capability, or a signing-free task mutation path.
- General actor provisioning is an owner action from a reviewed clean `dev` checkout. It does not grant provider authority. Keep provider contact forbidden until the canonical task and provider approval gates allow it.
- Require the provider-specific approval packet for provider-visible implementation. General implementation authority does not replace it.
- Enforce one behavioral product change globally. Exclusivity keys label evidence and prevent duplicate work, but they do not create parallel behavior slots. The next behavior waits until the active change has an installed-build soak outcome.
- Keep `runner-safe: false` work at owner-review PR state.

## Select work

1. Prioritize unhealthy evidence sources and red CI when they block trustworthy judgment.
2. Rank fresh attributable evidence above generic roadmap work.
3. Do not reward a completed issue for having shipped. Reopen it only when attributable evidence from a later installed build proves regression.
4. Hand implementation to `freed-build-feature`, evidence gathering to `freed-evidence-capture`, offline reproduction to `freed-sync-replay`, memory measurement to `freed-memory-profile`, and provider review to `freed-provider-risk-review`.
5. If no state changed and no authorized action is ready, append a deduplicated no-op control event and stop. Do not manufacture a task for a heartbeat.

## Discover debt when the backlog is empty

When no open issue labeled `debt` exists, run one bounded discovery pass instead of idling:

1. Select the next repository package or subsystem from the persisted discovery cursor. Declare that dependency boundary before reading code.
2. Inspect current code, tests, CI, runtime evidence, and recent changes only inside that boundary.
3. Require a concrete failure mode, measurable risk, or repeated delivery cost. Do not file style preferences or unsupported hypotheses.
4. Search all issues before creating anything. Use the debt issue form for each independently closable root cause.
5. Persist the completed boundary and evidence cutoff so future runs rotate forward instead of rescanning the same surface.
6. Stop after issue creation. Do not create an execution task or implement newly discovered debt in the same run.

## Required decision

Return the selected issue number and URL, operational task ID and state when one exists, evidence quality, metric contract, authority, provider-risk status, exclusivity key, and next skill. If any required field is missing, return `inconclusive` or `blocked_by_authority` instead of guessing.

Read only validated manifests under `~/.freed/automation/artifacts/`. Record the
decision with kind `stability-controller` in the version 1 [stability artifact
schema](../../../automation/artifact-schemas/stability-artifact-v1.schema.json).
Validate and atomically store it with `node scripts/stability-artifact.mjs write
--input <manifest.json>`. The canonical result lives under
`~/.freed/automation/artifacts/stability-controller/<task-id>/` and supplies a
stable input to the next background actor.
