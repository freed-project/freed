---
name: freed-ship-build
description: Ship and verify a versioned Freed Desktop build through GitHub Actions. Use when asked to cut a dev or production release, publish a reviewed build, or repair a failed release pipeline. Preserve source and installed build identity, require exact-head validation including native tests, and create a governed post-install verification task.
disable-model-invocation: true
---

# Ship Build

Publish from the correct release lane and prove which artifact was installed afterward.

## Establish authority and identity

1. Confirm `dev` or `production` release mode. Production is the default for `./scripts/release.sh`. Dev release prep requires `--channel=dev`.
2. Record the release task ID and granted authority. If the release repays tracked debt, also record each canonical GitHub issue. Preparing notes, pushing a tag, publishing, and deploying are distinct external actions.
3. Fetch `origin/dev` and `origin/main`, require a clean tree, and record the source git SHA.
4. For production, run `node scripts/validate-release-promotion.mjs --from-ref=origin/dev --to-ref=origin/main`. If it fails because main is behind approved product state, run `./scripts/promote-dev-to-main.sh <worktree-path>`, merge that reviewed PR, and fetch the new `origin/main` before release prep.
5. If the release contains provider-visible work, confirm its approval packet names the provider, observable behavior, approved diff, and owner reference. A materially different release diff requires renewed approval.

## Prepare and publish

1. Create a fresh `chore/release-<version>` worktree with `./scripts/worktree-add.sh <worktree-path> -b chore/release-<version> origin/main --target shared` for production, or use `origin/dev` for dev. Run `./scripts/release.sh` for production or `./scripts/release.sh --channel=dev` for dev. The script accepts only numeric CalVer with the one exact `-dev` tag suffix, updates package versions, records the source product commit and fixed promoted dev snapshot in the production release artifact, generates release-note artifacts, commits the draft, and refuses a stale or incorrect base.
2. Review every generated release-note artifact, set the release JSON to approved, and commit that approval.
3. Run `npm run validate:release` for production or `npm run validate:feature` for dev on the exact release commit. Native changes require Rust formatting, linting, and tests through the repository validation lane.
4. If any `docs/PHASE-*.md` file changed, require a reconciled [docs/roadmap-status.json](../../../docs/roadmap-status.json), run `node scripts/validate-roadmap-status.mjs`, and create a separate `www` handoff for status and public copy reconciliation. Do not edit the website from this lane.
5. Publish the reviewed release-prep branch with `./scripts/worktree-publish.sh --base main --ready --title "chore: prepare v<version>"` for production, or use `--base dev` for dev. A deliberately provisioned unattended host may wrap this helper with `FREED_TRUSTED_PUBLISHER`. Never push a release commit directly to `dev` or `main`.
6. Before App provisioning, apply the single active `Freed release tag lockdown` ruleset with `--lock-release-tags --apply`. It restricts creation, update, and deletion of every `refs/tags/v*` tag with no bypass. After an owner-reviewed change pins the dedicated release App ID, activation applies no-bypass immutability and App-only creation before it removes the bootstrap lockdown. Never substitute a user, administrator, repository role, team, deploy key, or the PR publisher App.
7. Merge the release-prep PR through branch protection. In a clean checkout already on `main` for production or `dev` for dev, run `git fetch origin <branch>` and `git merge --ff-only origin/<branch>`, then run `./scripts/release-publish.sh <version>`. The script proves `HEAD` equals the matching remote branch, validates the fixed release receipts, confirms both live tag rulesets against the checked-in App ID, rejects an existing local or remote tag, and delegates one exact annotated-tag creation through the fixed root-owned publisher binding.
8. Never expose a reusable release App token or push the tag with a user credential. The trusted broker must recheck the exact tag, commit, branch tip, receipt digest, and absence preconditions at push time, obtain a short-lived installation token, and permit no arbitrary ref, update, or deletion operation. The tag workflow independently proves the tag SHA belongs to protected `main` for production or protected `dev` for dev. It uses recorded release receipts rather than comparing against a moving live dev tip.
9. Monitor the tag workflow until every required job for the exact release SHA succeeds. A canceled, stale, different-SHA, or release-identity-invalid run is not evidence for this release.
10. Repair failures through a new PR in the correct lane, then cut a new version. Do not move or reuse a failed tag.

## Verify the installed artifact

1. Record GitHub release ID, tag, source SHA, workflow run ID, channel, bundle version, and artifact checksums where available.
2. After installation, verify the app-reported version, channel, and git SHA match the published artifact. Do not infer identity from the latest tag or current checkout.
3. For every changed stability issue with an operational task, keep the
   issue-linked task ID. Record the `installed` transition with the exact
   release identity, then have an authorized lifecycle actor transition that
   task to `soaking`. Do not create one aggregate verification task for the
   release.
4. Hand each soaking issue, operational task, and installed build to `freed-soak`, then
   `freed-canary`. Include its metric IDs, scenario, immutable window, minimum
   coverage, and thresholds. Missing identity or coverage produces
   `inconclusive`, not a successful release verdict.
5. For production, open the required reverse-integration PR from `main` into `dev` after release stability is established.
6. Use `freed-ship-www` for changelog publication and any approved roadmap presentation update. Never merge `dev` into `www`.
