# W1-06: Single-source the provider-visible path list; enforce at publish time

runner-safe: false (touches publish gating) | provider-visible: false | soak-gated: no

## Context

The repository previously had divergent definitions of "provider-visible surface." `scripts/validate-worktree.mjs` used an explicit path classification while `scripts/nightly-self-improve.mjs` used a substring heuristic that missed files the validator treated as provider surfaces. The old publish gate accepted a free-form approval note. It did not prove which provider, behavior, paths, or committed diff the owner had reviewed.

## Implemented contract

1. `scripts/lib/provider-visible-paths.mjs` owns the canonical predicate. It covers provider extractors, auth and capture code, user-agent and WebKit masking, provider-contact files in capture packages, and the orchestration files that own provider cadence or WebView lifecycle. `scripts/validate-worktree.mjs`, `scripts/nightly-self-improve.mjs`, and `scripts/worktree-publish.sh` consume that source.
2. A provider-visible change must be committed before approval. The branch must be clean during publish so the reviewed diff cannot change between validation and push. Store the approval JSON outside the repository so the record itself does not dirty the approved branch.
3. `scripts/worktree-publish.sh` accepts only `--provider-risk-approval-file <approval.json>`. The old `--approved-provider-risk` flag fails closed.
4. The approval record is schema version 1 and contains `approvalId`, `approvedBy`, `ownerApprovalReference`, `approvalSource`, `providers`, `pathScopes`, `observableBehavior`, `fingerprintingRisk`, `lowestProfileAlternative`, `approvedAt`, `expiresAt`, `diffSha`, and `paths`. `approvalSource.kind` must be `control-task`, and its reference must name the governed task.
5. `providers` accepts `facebook`, `instagram`, `linkedin`, `x`, `youtube`, or `other`. The path set must exactly match the provider-visible files in the committed branch diff. Every path has one `pathScopes` entry. Its provider union must equal `providers`, and provider-specific paths must match the provider inferred by the canonical classifier. Shared provider consent paths require the full affected provider set.
6. `diffSha` binds the approval to the full committed binary diff from `origin/<base>...HEAD`. `approvedAt` cannot be future-dated. Approval lasts at most seven days and must still be unexpired at publish time. Any branch diff change requires a new diff hash and a new owner approval record.
7. The owner authorizes the packet's canonical SHA-256 digest on that control task through the one-time owner bootstrap flow. Publish fails unless the canonical task manifest contains the same digest in `providerApprovalReference`, the task has approved provider authority, and the task is active. A self-authored JSON claim is not approval.
8. The validated approval is rendered into the PR body with the provider, observable behavior, fingerprinting risk, lowest-profile alternative, owner identity and source, authorization digest, diff hash, timestamps, path set, and per-path scopes. The helper always keeps a provider-visible PR draft until CODEOWNER review.

Calculate the diff hash after committing the reviewed provider change:

```bash
git diff --binary origin/dev...HEAD | git hash-object --stdin
```

Store a record with this shape outside the repository, for example under
`~/.freed/provider-approvals/`:

```json
{
  "schemaVersion": 1,
  "approvalId": "<stable-approval-id>",
  "approvedBy": "AubreyF",
  "ownerApprovalReference": "<owner-message-or-ticket>",
  "approvalSource": {
    "kind": "control-task",
    "reference": "<task-id>"
  },
  "approvedAt": "<iso-timestamp>",
  "expiresAt": "<iso-timestamp-within-seven-days>",
  "providers": ["instagram"],
  "observableBehavior": "<what-the-provider-will-observe>",
  "fingerprintingRisk": "<why-this-could-increase-detection-risk>",
  "lowestProfileAlternative": "<safer-alternative>",
  "diffSha": "<full-committed-diff-hash>",
  "paths": ["<exact-provider-visible-path>"],
  "pathScopes": [
    {
      "path": "<exact-provider-visible-path>",
      "providers": ["instagram"]
    }
  ]
}
```

Calculate the packet digest, then record that exact digest as the task's
`providerApprovalReference` through the authenticated `freed-owner` control
flow:

```bash
node scripts/lib/provider-visible-paths.mjs \
  --approval-digest /path/to/approval.json
```

The owner flow requires the private one-time bootstrap grant documented in
`docs/AUTOMATION-CONTROL-PLANE.md`. Do not copy the digest into the task using
an unattended actor.

Then publish the unchanged branch through the owner-managed host broker:

```bash
"$FREED_TRUSTED_PUBLISHER" \
  --title "fix: <provider change>" \
  --provider-risk-approval-file /path/to/approval.json
```

## Verify

- `node --test scripts/lib/provider-visible-paths.test.mjs`
- `node --test scripts/worktree-publish.test.mjs`
- A committed provider-visible branch is refused without an approval file.
- An uncommitted provider-visible change is refused before approval validation.
- A record with a stale expiry, wrong diff hash, missing path, or extra path is refused.
- A provider name that contradicts a provider-specific path is refused.
- A self-attested owner name or approval file without a matching authenticated control-task digest is refused.
- A clean committed branch with the exact valid approval record is accepted as a draft and the record appears in the PR body.
- The helper always refuses `--ready` for provider-visible branches. After the exact PR head receives CODEOWNER review, the owner performs a separate authorized ready transition through GitHub.
