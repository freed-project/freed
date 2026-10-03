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

The controller validates clean candidate data, exact protected tip, reviewed source-bound release JSON and activation evidence, live App-only immutable tag rules, and dev integration receipts. The native broker then independently rechecks App installation identity, selected repository scope, receipt bytes, tag absence and branch tip before creating one annotated tag. It verifies the result and revokes the installation token. The App-created tag triggers the existing four-platform `release.yml`, including its independent source, integration, packaging, signing and notarization gates.

## Activation is not complete

Repository metadata inspected on 2026-10-03 showed Apple and Tauri signing secrets, but no release App secret and no restricted publisher environment. Ordinary dev/main rulesets do not enforce owner review. Therefore an ordinary repository secret would weaken the existing boundary. No key has been copied, no new App created and no security settings changed by this implementation.

Before activation, the owner must approve the exact credential provisioning and persistent settings below:

1. Establish `release-controller` from the reviewed implementation. Protect it with an active branch ruleset that has no bypass, requires at least one approval and CODEOWNER review, dismisses stale reviews, requires last-push approval, and prohibits deletion and non-fast-forward updates. Its CODEOWNERS must retain AubreyF ownership of workflow and publisher code.
2. Create environment `release-publisher`, with custom deployment policies admitting only branch `release-controller`, no tags or wildcard/product branches. Make the workflow discoverable on the repository default branch through the normal protected promotion process.
3. Set environment variable `RELEASE_CONTROLLER_SHA` to the exact reviewed controller commit. The workflow refuses another commit, including a later controller change, until this pin is reviewed and updated.
4. Provision the existing dedicated App's private key as environment secret `RELEASE_APP_PRIVATE_KEY` using an explicitly approved secure channel. Do not place it in a general repository secret, copy it into source/artifacts/logs, or replace the App with a PAT, user tag push or `GITHUB_TOKEN` tag creation.
5. Exercise a reviewed DEV request and retain request, tag, workflow and signed-artifact identity receipts. Do not describe the cloud route as operational before that proof.

The job fails closed on missing controller pin or policy. The App key exists only in the final trusted publisher step, is stored at the broker's fixed mode-0600 path on an ephemeral runner, is removed on exit, and is never returned to the caller. Job cancellation does not cancel an earlier request; native immutable-tag checks resolve duplicate attempts. A cloud dispatch is not proof that signing succeeded.

The existing M5 broker remains usable until the cloud route is proven. The M2 factory can submit cloud requests through its already authorized GitHub connection; it does not need Apple credentials or a second local release App key. No account merge or logout is needed.

## Validation boundaries

Focused built-in Node tests cover explicit channel/tag/SHA/digest admission, controller pin, owner-review rules, branch-only environment isolation and credential-step ordering. These run in changed-path tooling coverage. They do not prove GitHub environment authorization, native broker behavior or signed artifacts; existing native broker tests and an actual cloud DEV run provide those separate proofs. Controller policy, workflow, validator, broker or GitHub permission changes invalidate this evidence.

This implementation intentionally targets dev first. Production's `main` copy and default-branch workflow discovery require normal reviewed promotion; no production version is prepared or published here.
