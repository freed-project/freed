---
name: freed-provider-risk-review
description: Prepare and verify both owner gates for any Freed change that could alter behavior visible to X, Facebook, Instagram, LinkedIn, or another provider. Use before implementation that changes WebView loads, navigation, requests, retries, cadence, cookies, headers, scrolling, clicking, extraction scripts, media loading, login behavior, or provider timing, and again before making the pull request ready. Preparing a review never grants approval.
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
alternative in the current task. Record a stable reference to that decision.
This first gate authorizes only implementation within the described behavior.
It is not publish approval. General permission to proceed with a plan, program,
or broad batch of work does not satisfy this gate.

## Gate 2: provider diff authorization before ready

After implementation and validation, write the approved Gate 1 decision as a
healthy `provider-risk-review` stability artifact. Publish the candidate as a
draft with `--provider-risk-review-artifact <path>`. Draft publication does not
authorize provider traffic. The publication helper posts one GitHub review
comment bound to both the artifact and the current provider subdiff. It records:

- Exact provider-visible path set and provider-only binary diff hash
- Inferred provider set
- Observable behavior, fingerprinting risk, and lowest-profile alternative

The human Gate 2 action is a CODEOWNER's GitHub thumbs-up reaction on that
exact, unedited comment. GitHub records the acting account. Rerun the helper
with the same artifact and `--ready` after the reaction exists. The helper
verifies that the reaction came from a CODEOWNER after the comment was created,
and that both the artifact and provider-visible diff still match.

Changes outside the provider-visible path set preserve the approval. A change
to any provider-visible file or to the Gate 1 artifact creates a new review
comment and a new reaction requirement. A material behavior change also
returns to Gate 1 before implementation continues.

For unattended publication, use a signed `control-task` approval record outside
the repository. Bind its digest to the same provider-only diff, set provider
authority to `approved`, and preserve the owner capability event. Broker
provisioning is optional and does not block the GitHub reaction path.

## Approval rules

- General permission to improve stability, build a feature, or "proceed with everything" is not a substitute for either scoped gate.
- Behavior approval applies only to the described contact frequency, timing,
  provider, paths, and observable flow.
- Do not contact a provider while preparing the draft or review comment.
- Treat the GitHub reaction as the direct human authorization record. Do not
  ask the owner to copy or type a digest into the task.
- Treat `control-task` as the optional machine-verifiable route. Require the
  matching task digest, approved provider authority, and owner capability event.
- Publish provider-visible work as a draft first. Use `--ready` only after the
  CODEOWNER reaction exists, or provide a valid signed control-task approval.

## Result

Return the state of both gates: `behavior_approved`, `diff_authorized`,
`blocked_by_owner`, or `needs_revision`. Include the exact allowed behavior and,
when Gate 2 is complete, the GitHub review comment reference. Hand behavior-approved
implementation to `freed-build-feature`. Keep every out-of-scope idea blocked.

Record that decision with kind `provider-risk-review` in the version 1
[stability artifact
schema](../../../automation/artifact-schemas/stability-artifact-v1.schema.json).
Validate and atomically store it with `node scripts/stability-artifact.mjs write
--input <manifest.json>`. The canonical result lives under
`~/.freed/automation/artifacts/provider-risk-review/<task-id>/`. This manifest
describes the gate state. It does not replace the explicit Gate 1 decision or
the CODEOWNER's GitHub reaction.
