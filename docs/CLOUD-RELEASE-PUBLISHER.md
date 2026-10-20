# Portable release publication

The build, Apple signing, notarization and updater signing already run in GitHub Actions. The former machine dependency was the dedicated App tag publisher on the M5. The cloud controller reuses that same bounded Swift broker on an ephemeral GitHub macOS runner. It never runs candidate scripts or installs candidate dependencies while the App key is mounted.

## Request from another machine or cloud

After normal release preparation, canonical activation review, exact validation and protected merge, set the four explicit request fields:

```sh
export RELEASE_CHANNEL=dev
export RELEASE_TAG=v26.10.200-dev
export RELEASE_SOURCE_SHA=<exact-merged-dev-sha>
export RELEASE_RECEIPT_SHA256=<reviewed-release-json-sha256>
node scripts/cloud-release-request.mjs dispatch
```

Use the existing authenticated GitHub CLI. This command submits `cloud-release-request.yml` on `release-controller`; it does not create a tag using the caller's token. GitHub's workflow dispatch API supports the same four inputs for cloud callers with existing authorized Actions access. Production requests require `production`, a tag without `-dev`, and the exact protected `main` release-preparation SHA. Production infrastructure support does not grant production publication authority.

For the connected cloud GitHub tools, create a fresh `release-requests/<unique-id>` branch from the reviewed controller commit, then create `release-requests/request.json` with the four fields above. The connected branch/file APIs use the existing owner connection; no token is copied into the cloud agent. The inbox has read-only contents and short-lived Actions dispatch permission, has no App credential, and does not check out or execute request code. It forwards the immutable push run ID. The controller independently fetches that run's GitHub-reported actor, repository, branch and commit, reads the JSON from the immutable commit, and requires every release field to match. Arbitrary collaborator runs, edited dispatch fields and non-request branches are refused. Direct workflow dispatch is restricted to AubreyF; inbox dispatch must come from the Actions bot with that verified owner request. Both controller and inbox reruns are refused. Bot admission also requires the active named inbox workflow, its exact workflow ID/path, the original owner triggering actor, and an original run created within 24 hours that is still queued/running or completed successfully. Failed, cancelled, stale and unrelated workflow runs are refused. Identical first-attempt owner requests within that window may be submitted again; the broker refuses an existing tag. Cancellation after admission is not revocation and cannot retract an immutable tag.

The controller validates clean candidate data, exact protected tip, reviewed source-bound release JSON and activation evidence, live App-only immutable tag rules, and dev integration receipts. The native broker then independently rechecks App installation identity, selected repository scope, receipt bytes, tag absence and branch tip before creating one annotated tag. It verifies the result and revokes the installation token. The App-created tag triggers the existing four-platform `release.yml`, including its independent source, integration, packaging, signing and notarization gates.

## Verified dev activation

The cloud route has completed DEV publication. Controller runs
[37247128125](https://github.com/freed-project/freed/actions/runs/37247128125)
and [37349575394](https://github.com/freed-project/freed/actions/runs/37349575394)
succeeded using reviewed controller commit
[`...1efebd6f`](https://github.com/freed-project/freed/commit/4fddf2404f94af1b4495cab6ed273e141efebd6f).
The latter published `v26.10.403-dev` from candidate
[`...f852787d`](https://github.com/freed-project/freed/commit/a8791d8681f4cc714f5d0689f45ca556f852787d).
Its [release build](https://github.com/freed-project/freed/actions/runs/37350297388)
succeeded, and the public release includes macOS ARM and Intel bundles,
updater signatures and `latest.json`. Evidence was checked on October 5, 2026.

This establishes the cloud tag-to-release path, not installed native acceptance,
a completed soak, production publication or retirement of the laptop credential.
Those claims require their own evidence. No production release is needed merely
to repeat this DEV proof. The earlier architecture proposal is superseded by this
implemented route; optional additional enforcement remains in the
[deferred release-hardening backlog](RELEASE-SECRETS.md#deferred-release-hardening-to-dos).

### Configuration contract

The successful runs replace the earlier October 3 activation-pending status.
Keep the following configuration requirements when maintaining or reprovisioning
the controller; they are not a request to provision a second controller:

1. Establish `release-controller` from the reviewed implementation. Protect it with an active branch ruleset that has no bypass, requires at least one approval and CODEOWNER review, dismisses stale reviews, requires last-push approval, and prohibits deletion and non-fast-forward updates. Its CODEOWNERS must retain AubreyF ownership of workflow and publisher code.
2. Create environment `release-publisher`, with custom deployment policies admitting only branch `release-controller`, no tags or wildcard/product branches. Repository metadata confirms that the default branch is `dev`; the merged workflow definitions there make dispatch discoverable. No main backport or main-guard exception is needed. Keep the controller helpers on the protected controller; do not execute candidate helpers.
3. Set environment variable `RELEASE_CONTROLLER_SHA` to the exact reviewed controller commit. The workflow refuses another commit, including a later controller change, until this pin is reviewed and updated.
4. Review the inbox workflow's scoped `actions: write` permission, which only forwards requests to the protected controller. The connected cloud caller keeps its existing branch/file permissions; no new OAuth token or installation grant is requested.
5. Provision the existing dedicated App's private key as environment secret `RELEASE_APP_PRIVATE_KEY` using an explicitly approved secure channel. Do not place it in a general repository secret, copy it into source/artifacts/logs, or replace the App with a PAT, user tag push or `GITHUB_TOKEN` tag creation.
6. Exercise a reviewed DEV request and retain request, tag, workflow and signed-artifact identity receipts. Do not describe the cloud route as operational before that proof.

The actual read-only Actions probe `37088793980` omitted `bypass_actors` for all five active rulesets and reported `fullPolicyEvidence=false`, despite a successful diagnostic job. [GitHub documents](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset) that these fields require ruleset write authority. The revised protocol therefore uses the existing authenticated owner connection to attest fresh complete policies. It adds no Administration scope to Actions or the publisher App. The successful controller runs above now provide DEV publication evidence for the configured route. Connector-specific provenance tests remain distinct from direct dispatch acceptance.

The job fails closed on missing controller pin or policy. The App key exists only in the final trusted publisher step, is stored at the broker's fixed mode-0600 path on an ephemeral runner, is removed on exit, and is never returned to the caller. Job cancellation does not cancel an earlier request; native immutable-tag checks resolve duplicate attempts. A cloud dispatch is not proof that signing succeeded.

The existing M5 broker is a recovery option; these cloud results do not establish that its credential has been retired. The M2 factory can submit cloud requests through its already authorized GitHub connection; it does not need Apple credentials or a second local release App key. No account merge or logout is needed.


## Fresh owner policy challenge

The controller first checks request provenance, its exact pin, the live branch-only environment, and the candidate as data. It builds the native broker before generating a cryptographic nonce on the running publisher job. The uploaded `release-policy-challenge-<run>-<attempt>` artifact contains only public identity and the expected-policy digest, never private policy replies.

An already authenticated owner collector downloads that exact run artifact and checks its run/attempt, approved controller SHA, repository ID, channel, tag, candidate SHA, release receipt digest and nonce. It then performs new complete applicable ruleset reads after the challenge, validates no-bypass controller owner review and App-only creation plus no-bypass immutable release tags, and commits only the compact allowlisted attestation to a fresh `release-policy-responses/<nonce>` branch. The collector must not reuse snapshots or commit hidden bypass actors. Environment topology remains a separate live check under the runner's read-only token.

On an M2 or another already authenticated client, use the reviewed helper after downloading the exact artifact:

```bash
node scripts/cloud-release-policy.mjs collect policy-challenge.json <approved-controller-sha>
```

The cloud owner connection can perform the same GETs and branch/file calls. Its supported GitHub tools expose run-artifact listing/download, immutable run metadata, ruleset GETs and branch/file creation; no local M5 keyring or new credential is needed. Compare the challenge against the actual running `cloud-release-request.yml` run before collecting. Use the protocol's expected policy definitions and digest from the same reviewed controller, not an unrelated checkout. The response copies every challenge field and adds `observedAtMs` and `verified:true`, encoded as canonical compact JSON. Only attest true after validating the fresh complete private reads.

The controller authenticates the response through GitHub's original push-run actor and triggering actor numeric account ID `2789037`, repository ID `1143010014`, named workflow ID/path, first attempt, nonce branch and immutable head SHA. It reads the JSON from that immutable commit. Commit author/committer fields are not authentication. The branch-creation push is ignored until an actual response commit exists; the response workflow need not acquire a runner before its immutable owner push metadata can be checked. Bot, collaborator, substituted, oversized, duplicate-field, unknown-field, rerun, failed and cancelled responses are refused.

The challenge expires 180 seconds after issuance. The final trusted step reauthenticates the immutable response, repeats candidate checks and consumes the nonce once before mounting the key on disk. The native broker checks the same deadline before annotation and immediately before immutable ref creation. A stale response or late queue produces a failed request and requires a new challenge. The native deadline check refuses a tag request that is already expired. GitHub does not enforce this private deadline atomically; an HTTP mutation already sent cannot be retracted, and the existing request timeout bounds that additional race. Existing local-broker publication retains its direct owner-authenticated live policy checks.

This is owner-attested live policy evidence, not direct runner visibility into hidden fields. GitHub authenticates the submitter, not the truth or origin of the assertion. The trusted owner or its authorized collector vouches for complete fresh reads. The read-to-attest-to-tag race is bounded by the challenge deadline, not atomic. The collector must remain available while the running publisher waits. The DEV runs above establish publication through this protocol; they do not prove containment of a compromised owner or authorized collector.

For an isolated connector-provenance test, submit a clearly marked QA-only JSON on a unique nonce branch and inspect its actual push run with `cloud-release-policy.mjs inspect-owner-push <nonce> <run-id>`. That command reports `publicationAuthorized:false`; QA payloads cannot pass production envelope validation. It does not create tags or touch credentials.

## Validation boundaries

Focused built-in Node tests cover explicit channel/tag/SHA/digest admission, controller pin, owner-review rules, branch-only environment isolation, owner policy challenges, immutable push provenance, freshness, consumed nonces and credential-step ordering. These run in changed-path tooling coverage. They do not prove GitHub environment authorization, native broker behavior or signed artifacts; existing native broker tests and an actual cloud DEV run provide those separate proofs. Controller policy, workflow, validator, broker or GitHub permission changes invalidate this evidence.

This implementation intentionally proves dev first. Workflow discovery uses the default `dev` branch; production source still requires the protected `main` release-preparation identity and separate publication authority. No production version is prepared or published here.

## Controller repair proposal identity

`controller-repair-proposal.yml` prepares the activation-history repair as a draft
PR authored and pushed by `github-actions[bot]`, allowing AubreyF to review it
under the existing CODEOWNER and last-push rules. Only an original AubreyF
workflow dispatch from `dev` is admitted. The helper copies two fixed Git blobs
from selected product source `809b0670b8d62b68a44258b9beb493b7542d5fb4`
onto controller base `4fddf2404f94af1b4495cab6ed273e141efebd6f`.
It requires the full resulting tree to equal the tested repair tree
`631fcc881fd4aa9dee6b0bf33da8fcc59c955f05`. It executes no candidate code,
uses only the job's short-lived token, and never reads the release App key.
This is a bounded repair proposal, not a general controller publisher.

Before first use, the owner must approve enabling the repository's **Allow GitHub
Actions to create and approve pull requests** setting. GitHub bundles those two
capabilities. Keep default workflow permissions read-only; this job requests
contents and pull-request write permissions. The helper never submits a review,
merges, updates a controller pin, publishes a tag, or changes a policy. Existing
controller protection remains the merge authority.

After the tooling has merged into `dev` and the setting is enabled, dispatch
**Controller Repair Proposal** from `dev`. Inspect the returned PR URL and exact
head. Approve pending workflow runs if GitHub requests it, and verify required
checks on that head before marking the proposal ready and reviewing it. A separate
read-only job checks out the returned exact commit, verifies its parent and full
tree, and runs the activation suite. Local tree-equivalent test evidence does not replace required exact-head CI. A successful
proposal is not release or Library activation approval.

The fixed proposal branch is never overwritten. If publication fails after branch
creation, preserve the run and inspect the branch, its parent, tree, and any PR
before preparing recovery. A rerun or another dispatch cannot silently replace
that branch. If the controller base advances, review and validate a new proposal.
Disabling the repository setting prevents future token-created PRs; it does not
remove a proposal already created. Controller merge and pin adoption remain
separate governed operations.

This proposal workflow lives only on `dev`, the default dispatch lane. The
controller and production lanes intentionally do not receive the publisher;
they receive only the independently reviewed repair and normal release changes.
