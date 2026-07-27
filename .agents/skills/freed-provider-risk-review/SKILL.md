---
name: freed-provider-risk-review
description: Prepare and verify the owner behavior gate for any Freed change that could alter behavior visible to X, Facebook, Instagram, LinkedIn, or another provider. Use before implementation that changes WebView loads, navigation, requests, retries, cadence, cookies, headers, scrolling, clicking, extraction scripts, media loading, login behavior, or provider timing. Also use to classify a provider-visible path change that has no provider-observable behavior change. Preparing a review never grants live provider traffic.
disable-model-invocation: true
---

# Provider Risk Review

Make the observable change and its fingerprinting risk explicit before implementation begins.

## Detect the boundary

1. Run the canonical provider-visible path classifier against the proposed or actual changed paths.
2. Apply behavioral judgment in addition to path classification. A path-list miss does not make observable provider behavior safe.
3. Treat the native social WebView monolith as provider-visible until provider-specific Rust modules make ownership precise.
4. Name each affected provider. Do not use a generic social-provider label when behavior differs.

## Behavior approval before implementation

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
alternative. Record a stable task and decision reference. A later implementing
task may reuse that decision only when it loads and cites the exact reference,
the decision has no expiry or has not expired, and the provider, contact
frequency, timing, and observable flow remain inside its stated scope. Never
infer reusable authority from roadmap prose or general permission to proceed
with a plan, program, or broad batch. This Gate 1 decision authorizes
implementation only within the described behavior. It is not live provider
traffic, merge, release, or install authority.

## Record the reviewed behavior

After implementation and validation, write the approved Gate 1 decision as a
healthy `provider-risk-review` stability artifact and publish with
`--provider-risk-review-artifact <path>`. The publication helper posts one
GitHub review comment that records:

- Exact provider-visible path set and provider-only binary diff hash
- Inferred provider set
- Observable behavior, fingerprinting risk, and lowest-profile alternative

The comment is an audit record, not a second approval. A healthy artifact with
`behavior_approved` may publish directly as ready when its provider set matches
the current classified diff. The artifact approves the described behavior, not
one exact byte diff. A materially different observable behavior returns to
Gate 1 before implementation continues.

For unattended publication, use a signed `control-task` approval record outside
the repository. Bind its digest to the provider-only diff, set provider
authority to `approved`, and preserve the owner capability event. Broker
provisioning is optional and does not change the behavior-approval rule.

## Classified path with no behavior change

Path classification is deliberately broader than provider behavior. A native
storage, type, test, telemetry, or refactor change may touch a classified file
without changing requests, navigation, timing, cookies, headers, extraction,
or provider activity.

For that case:

1. state why the observable behavior is byte-for-byte or semantically
   unchanged;
2. name the classified providers and exact paths;
3. record a healthy `diff_authorized` artifact;
4. publish with the artifact so the helper posts the audit comment.

Do not fabricate fingerprinting risk for a behavior-neutral diff. If behavioral
judgment is uncertain, return to Gate 1 before code.

## Approval rules

- General permission to improve stability, build a feature, or "proceed with everything" is not a substitute for scoped behavior approval.
- Behavior approval applies only to the described contact frequency, timing,
  provider, paths, and observable flow.
- Do not contact a provider while preparing the artifact or review comment.
- Treat `control-task` as the optional machine-verifiable route. Require the
  matching task digest, approved provider authority, and owner capability event.
- Publication readiness does not authorize provider traffic.

## Result

Return `behavior_approved`, `diff_authorized`, `blocked_by_owner`, or
`needs_revision`. Include the exact allowed behavior and the audit comment
reference after publication. Hand approved implementation to
`freed-build-feature`. Keep every out-of-scope idea blocked.

Record that decision with kind `provider-risk-review` in the version 1
[stability artifact
schema](../../../automation/artifact-schemas/stability-artifact-v1.schema.json).
Validate and atomically store it with `node scripts/stability-artifact.mjs write
--input <manifest.json>`. The canonical result lives under
`~/.freed/automation/artifacts/provider-risk-review/<task-id>/`. This manifest
describes the gate state. It does not replace the explicit Gate 1 decision.
