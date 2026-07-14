# W1-06: Single-source the provider-visible path list and enforce review

runner-safe: false (touches publish gating) | provider-visible: false | soak-gated: no

## Context

The repository previously had divergent definitions of the provider-visible
surface. It later replaced a free-form approval note with an exact packet
digest that the owner had to copy into every work task. That bound approval to
the diff, but it also made the human repeat opaque hashes and invalidated
approval when unrelated files changed.

## Implemented contract

1. `scripts/lib/provider-visible-paths.mjs` owns the canonical predicate.
   Validation, nightly work selection, and publication consume that source.
2. Gate 1 remains a plain-language owner decision before implementation. It
   names the provider behavior, fingerprinting risk, and lowest-profile
   alternative. Broad permission does not satisfy Gate 1.
3. Provider-visible branches may publish as draft after implementation and
   validation. Draft publication does not authorize live provider traffic.
4. The publication helper posts a GitHub review comment that is bound to the
   exact provider-visible path set and provider-only binary diff hash. A rename
   also binds its source and destination so provider code cannot escape the
   fingerprint by moving outside a classified directory.
5. Gate 2 is a GitHub thumbs-up reaction on that comment from a repository
   CODEOWNER. GitHub supplies the actor identity. The owner does not copy or
   type a digest into a task.
6. Any provider-visible edit changes the fingerprint. The helper creates a new
   review comment, and the old reaction grants no authority. Changes outside
   the provider-visible path set preserve the existing Gate 2 decision.
7. The helper verifies the matching reaction before moving a provider-visible
   pull request from draft to ready.
8. The optional signed `control-task` approval remains available for unattended
   ready publication. Its structured record binds the provider-only diff hash,
   exact paths, provider scopes, approved behavior, risk, alternative, and
   owner capability event.
9. The old free-form `--approved-provider-risk` option remains rejected. A
   structured approval file is accepted only for the signed control-task path.
10. A narrow `fix/main-governance-*` lane may backport these exact governance
    files to `main`. Every changed file must be on the control-plane allowlist
    and byte-for-byte equal to `origin/dev`. Product changes remain confined to
    the normal release promotion lane. The allowlist includes the publisher's
    release-control dependencies and their focused tests so the backported
    publisher is runnable rather than a decorative shell script.

## Human workflow

Publish the completed provider-visible branch as a draft:

```bash
./scripts/worktree-publish.sh \
  --title "fix: <provider change>"
```

The helper creates or updates the pull request and posts the generated provider
review comment. A CODEOWNER reviews that comment and adds a thumbs-up reaction.
Then rerun:

```bash
./scripts/worktree-publish.sh \
  --title "fix: <provider change>" \
  --ready
```

No task message or approval JSON is required for this human path.

## Signed control-task workflow

For a provisioned unattended host, create the schema version 1 approval JSON
outside the repository. Use `approvalSource.kind: "control-task"`. Its
`diffSha` is the provider-only binary diff hash, not the full branch diff. The
record still expires after at most seven days and must exactly match the
provider-visible path set and provider scopes. Publish with:

```bash
./scripts/worktree-publish.sh \
  --title "fix: <provider change>" \
  --provider-risk-approval-file /path/to/approval.json \
  --ready
```

The helper verifies the task manifest, approved provider authority, matching
owner capability event, approval expiry, provider scopes, path set, and
provider-only diff hash.

## Verify

- `node --test scripts/lib/provider-visible-paths.test.mjs`
- `node --test scripts/worktree-publish.test.mjs`
- A provider-visible branch publishes as a draft without a Gate 2 packet.
- Draft publication posts a review comment for the current provider fingerprint.
- A provider-visible pull request cannot become ready without a CODEOWNER reaction.
- A CODEOWNER thumbs-up permits the matching pull request to become ready.
- An unrelated branch edit does not invalidate the reaction.
- A provider-visible edit creates a new fingerprint and requires a new reaction.
- A valid signed control-task record may authorize ready publication.
