---
name: freed-provider-risk-review
description: Prepare and verify a scoped owner-approval packet for any Freed change that could alter behavior visible to X, Facebook, Instagram, LinkedIn, or another provider. Use before implementation that changes WebView loads, navigation, requests, retries, cadence, cookies, headers, scrolling, clicking, extraction scripts, media loading, login behavior, or provider timing. Preparing the packet never grants approval.
disable-model-invocation: true
---

# Provider Risk Review

Make the observable change and its fingerprinting risk explicit before implementation begins.

## Detect the boundary

1. Run the canonical provider-visible path classifier against the proposed or actual changed paths.
2. Apply behavioral judgment in addition to path classification. A path-list miss does not make observable provider behavior safe.
3. Treat the native social WebView monolith as provider-visible until provider-specific Rust modules make ownership precise.
4. Name each affected provider. Do not use a generic social-provider label when behavior differs.

## Gate 1: behavior approval before implementation

Include:

- Stable task ID
- Provider and current observable behavior
- Proposed observable behavior in plain language
- Base SHA, proposed files, and the smallest expected path scope
- Changes to navigation, request count, timing, retry cadence, cookies, headers, scrolling, clicks, media, login, or background activity
- Why the change could make Freed easier to identify or block
- Lowest-profile alternative, usually passive evidence, offline fixtures, local journaling, or no additional provider contact
- Offline evidence already collected
- Rollback trigger and rollback procedure
- One-change soak plan, metric ID, and exposure bound
- Approval scope, expiry condition, and owner approval reference
- Owner decision reference and expiry condition

Stop before code until the owner explicitly approves the named observable
behavior after seeing its provider, fingerprinting risk, and lower-profile
alternative. Store that owner decision on the canonical task as the preliminary
`providerApprovalReference`, then move provider authority to `approved`. This
first gate authorizes only implementation within the described behavior. It is
not publish approval.

## Gate 2: exact diff authorization before publish

After implementation and validation, commit the candidate diff. Then create the
schema version 1 approval JSON outside the repository with:

- Exact base SHA, head SHA, provider-visible path set, and full binary diff hash
- `approvedBy`, `control-task` approval source, top-level provider union, and
  one exact provider scope for every approved path
- Observable behavior, fingerprinting risk, lowest-profile alternative,
  approval time, and expiry no more than seven days later

Compute its authorization digest with
`node scripts/lib/provider-visible-paths.mjs --approval-digest <approval.json>`.
The owner uses the private one-time bootstrap flow to replace the task's
preliminary reference with that exact digest. This second gate authorizes only
publishing the reviewed commit. Any material behavior or path change returns to
Gate 1 before code changes continue. Any committed diff change returns to Gate
2 before publishing.

## Approval rules

- General permission to improve stability, build a feature, or proceed with a plan is not a substitute for this scoped approval.
- Behavior approval applies only to the described contact frequency, timing,
  provider, paths, and observable flow.
- Do not contact a provider while preparing the packet.
- A JSON file that merely says `approvedBy: AubreyF` is not authenticated
  publish approval.
- Publish only with `--provider-risk-approval-file <approval.json>`. The helper keeps provider-visible pull requests in draft. The repository CODEOWNER must review the exact diff before the pull request can become ready or merge.

## Result

Return the state of both gates: `behavior_approved`, `diff_authorized`,
`blocked_by_owner`, or `needs_revision`. Include the exact allowed behavior and,
when Gate 2 is complete, the packet digest. Hand behavior-approved
implementation to `freed-build-feature`. Keep every out-of-scope idea blocked.

Record that decision with kind `provider-risk-review` in the version 1
[stability artifact
schema](../../../automation/artifact-schemas/stability-artifact-v1.schema.json).
Validate and atomically store it with `node scripts/stability-artifact.mjs write
--input <manifest.json>`. The canonical result lives under
`~/.freed/automation/artifacts/provider-risk-review/<task-id>/`. This manifest
describes the gate state. It does not replace the authenticated owner approval
record required by either gate.
