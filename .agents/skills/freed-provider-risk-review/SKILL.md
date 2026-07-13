---
name: freed-provider-risk-review
description: Prepare and verify both owner gates for any Freed change that could alter behavior visible to X, Facebook, Instagram, LinkedIn, or another provider. Use before implementation that changes WebView loads, navigation, requests, retries, cadence, cookies, headers, scrolling, clicking, extraction scripts, media loading, login behavior, or provider timing, and again before publishing the exact committed diff. Preparing a packet never grants approval.
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

## Gate 2: exact diff authorization before publish

After implementation and validation, commit the candidate diff. Then create the
schema version 1 approval JSON outside the repository with:

- Exact provider-visible path set and full committed binary diff hash
- `approvedBy`, top-level provider union, and one exact provider scope for every
  approved path
- Observable behavior, fingerprinting risk, lowest-profile alternative,
  approval time, and expiry no more than seven days later
- Either an `owner-confirmation` source with a stable current task or thread
  reference, or a `control-task` source with the governed task ID

For the signing-free path, create the packet with `approvalSource.kind` set to
`owner-confirmation` and leave out `authorizationDigest`. Compute the digest with
`node scripts/lib/provider-visible-paths.mjs --approval-digest <approval.json>`.
Show the owner that exact digest with the provider behavior, risk, alternative,
diff hash, and path set. Stop until the owner explicitly confirms that exact
digest in the current task. Then add the unchanged digest as
`authorizationDigest`. Do not change any other packet field.

For stronger machine-verifiable authorization, use `control-task` and the
optional signed broker. Bind the same digest to the governed task, set provider
authority to `approved`, and preserve the owner capability event. Broker
provisioning is hardening, not a prerequisite for the signing-free path.

This second gate authorizes only publishing the reviewed commit. Any material
behavior or path change returns to Gate 1 before code changes continue. Any
committed diff change returns to Gate 2 before publishing.

## Approval rules

- General permission to improve stability, build a feature, or "proceed with everything" is not a substitute for either scoped gate.
- Behavior approval applies only to the described contact frequency, timing,
  provider, paths, and observable flow.
- Do not contact a provider while preparing the packet.
- Treat `owner-confirmation` as cooperative evidence. The JSON file does not
  authenticate the owner. Require the explicit current-task confirmation and
  preserve its stable reference.
- Treat `control-task` as the optional machine-verifiable route. Require the
  matching task digest, approved provider authority, and owner capability event.
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
describes the gate state. It does not replace the explicit Gate 1 decision, the
exact Gate 2 confirmation, or CODEOWNER review.
