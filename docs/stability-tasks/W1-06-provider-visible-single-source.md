# W1-06: Single-source the provider-visible path list; enforce at publish time

runner-safe: false (touches publish gating) | provider-visible: false | soak-gated: no

## Context

The repository previously had divergent definitions of "provider-visible surface." `scripts/validate-worktree.mjs` used an explicit path classification while `scripts/nightly-self-improve.mjs` used a substring heuristic that missed files the validator treated as provider surfaces. The old publish gate accepted a free-form approval note. It did not prove which provider, behavior, paths, or committed diff the owner had reviewed.

## Implemented contract

1. `scripts/lib/provider-visible-paths.mjs` owns the canonical predicate. It covers provider extractors, auth and capture code, user-agent and WebKit masking, provider-contact files in capture packages, and the orchestration files that own provider cadence or WebView lifecycle. `scripts/validate-worktree.mjs`, `scripts/nightly-self-improve.mjs`, and `scripts/worktree-publish.sh` consume that source.
2. A provider-visible change must be committed before approval. The branch must be clean during publish so the reviewed diff cannot change between validation and push. Store the approval JSON outside the repository so the record itself does not dirty the approved branch.
3. `scripts/worktree-publish.sh` accepts only `--provider-risk-approval-file <approval.json>`. The old `--approved-provider-risk` flag fails closed.
4. The approval record is schema version 1 and contains `approvalId`, `approvedBy`, `ownerApprovalReference`, `approvalSource`, `providers`, `pathScopes`, `observableBehavior`, `fingerprintingRisk`, `lowestProfileAlternative`, `approvedAt`, `expiresAt`, `diffSha`, and `paths`. An `owner-confirmation` record also contains the exact `authorizationDigest`. `approvalSource.kind` must be `owner-confirmation` or `control-task`. Its reference must name the stable task or thread that holds the decision.
5. `providers` accepts `facebook`, `instagram`, `linkedin`, `x`, `youtube`, or `other`. The path set must exactly match the provider-visible files in the committed branch diff. Every path has one `pathScopes` entry. Its provider union must equal `providers`, and provider-specific paths must match the provider inferred by the canonical classifier. Shared provider consent paths require the full affected provider set.
6. `diffSha` binds the approval to the full committed binary diff from `origin/<base>...HEAD`. `approvedAt` cannot be future-dated. Approval lasts at most seven days and must still be unexpired at publish time. Any branch diff change requires a new diff hash and a new owner approval record.
7. Gate 1 requires the owner to explicitly approve the named observable behavior, fingerprinting risk, and lowest-profile alternative before implementation. General permission such as "proceed with everything" does not count.
8. Gate 2 requires the owner to explicitly confirm the packet's canonical SHA-256 digest after the exact diff is committed. The signing-free `owner-confirmation` path stores that exact digest as `authorizationDigest` and cites the stable current task or thread. It is cooperative evidence, not cryptographic proof that the file came from the owner. The stronger `control-task` path uses the optional signed broker. Publish then verifies the same digest against the active task manifest, approved provider authority, and owner capability event.
9. The validated approval is rendered into the PR body with the provider, observable behavior, fingerprinting risk, lowest-profile alternative, owner identity and source, authorization digest, diff hash, timestamps, path set, and per-path scopes. The helper always keeps a provider-visible PR draft until exact-diff CODEOWNER review.

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
    "kind": "owner-confirmation",
    "reference": "<stable-current-task-or-thread-reference>"
  },
  "authorizationDigest": "<exact-confirmed-packet-digest>",
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

Create the packet without `authorizationDigest`, then calculate its canonical
digest:

```bash
node scripts/lib/provider-visible-paths.mjs \
  --approval-digest /path/to/approval.json
```

Show the owner the exact digest, provider behavior, risk, alternative, committed
diff hash, and path set in the current task. Ask for an explicit decision on
that digest. A broad approval of the plan or program does not satisfy Gate 2.
After the owner confirms, add the same digest as `authorizationDigest` without
changing any other packet field. The canonical digest excludes that field, so
the helper can recompute and compare it during publish. The stable
`approvalSource.reference` must point back to the current task or thread.

This signing-free path is deliberately cooperative. The JSON file cannot prove
who wrote it. Its safety comes from the explicit owner confirmation in the
current task, exact-diff binding, draft-only publication, and independent
CODEOWNER review.

For the stronger machine-verifiable path, set `approvalSource.kind` to
`control-task` and set its reference to the governed task ID. Use the optional
signed owner capability documented in `docs/AUTOMATION-CONTROL-PLANE.md` to
store the exact packet digest as the task's `providerApprovalReference` and move
provider authority to `approved`. An unattended actor must not manufacture this
control-task authorization.

Then publish the unchanged branch through the governed helper. A provisioned
unattended host may invoke the same helper through its optional broker:

```bash
./scripts/worktree-publish.sh \
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
- An `owner-confirmation` record with a missing or changed `authorizationDigest` is refused.
- A `control-task` record without a matching owner capability event, active task digest, and approved provider authority is refused.
- A clean committed branch with the exact valid approval record is accepted as a draft and the record appears in the PR body.
- The helper always refuses `--ready` for provider-visible branches. After the exact PR head receives CODEOWNER review, the owner performs a separate authorized ready transition through GitHub.
