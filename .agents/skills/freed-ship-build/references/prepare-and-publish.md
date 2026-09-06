## Prepare and publish

1. Create a fresh `chore/release-<version>` worktree with `./scripts/worktree-add.sh <worktree-path> -b chore/release-<version> origin/main --target shared` for production, or use `origin/dev` for dev. Run `./scripts/release.sh --promoted-dev-sha=<source-dev-sha>` for production or `./scripts/release.sh --channel=dev` for dev. The script accepts only numeric CalVer with the one exact `-dev` tag suffix, updates package versions, records the source product commit and fixed promoted dev snapshot in the production release artifact, generates release-note artifacts, commits the draft, and refuses a stale or incorrect base. Production prep validates against the selected immutable SHA rather than the moving `origin/dev` branch.
   **Run the script. Do not bump versions by hand.** The tag carries `-dev`; the five version files carry plain CalVer with no suffix (v26.7.1501-dev shipped `26.7.1501` in `package.json`). Writing the tag string into the version files makes `validate-release-identity` reject the publish on all five, and hand-editing product files after the notes are generated makes it reject again for "product files changed after release notes were prepared". `release.sh` gets both right and leaves an already-approved release file untouched, so it is safe to re-run to repair a botched prep.
2. Review `source.libraryCoreActivation` in the generated release JSON before
   approving the release. The generator selects the exact immutable
   previous-release boundary, reads
   `docs/library-core-activation-manifest.json` from both boundary commits, and
   derives the exact append-only transition delta. An empty delta produces
   `no_activation_declared` automatically. A nonempty Gate C through Gate H
   delta produces `review_required`. Never infer or hand-enter the transition
   array, and never use `no_activation_declared` as an assertion. Rebuild
   decisions only through
   `scripts/lib/library-core-release-activation.mjs`; never hand-edit its
   inspection or manifest digests. Each manifest entry declares the exact gate,
   kind, rollback trigger, and receipt expectations in the product change that
   introduces the activation.
   When the delta is nonempty, finish the release copy and set
   `"approved": true`. Before the first push, run
   `node scripts/validate-release-identity.mjs --tag=<tag> --head-ref=HEAD --library-core-review-draft`.
   This draft-only preflight validates the complete release identity and
   requires exactly one nonempty `review_required` activation. It cannot admit
   a no-activation or already approved release.

   If the owner has approved the exact release and activation in the active
   task, run
   `node scripts/library-core-release-activation.mjs approval-intent --artifact=release-notes/releases/<tag>.json`.
   Create one private mode `0600` current-task owner confirmation outside the
   repository using that exact task ID, intent, and intent digest. Preserve the
   owner's plain-English decision in `ownerApprovalReference`, identify the
   active task in `approvalSource.reference`, and keep the confirmation valid
   for no more than seven days. Record it with
   `node scripts/library-core-release-activation.mjs record-owner-approval --artifact=release-notes/releases/<tag>.json --owner-confirmation-file=<absolute-path>`.
   The command validates the private confirmation and writes only the verified
   decision fields. Commit that change, run the normal release validation from
   step 3, and only then make the PR ready. No GitHub approval comment is
   required.

   The proposal digest covers the complete release JSON while normalizing only
   the decision field. The current-task confirmation binds that digest, the
   source product commit, manifest digest, inspection digest, transition set,
   tag, channel, and artifact path. This is cooperative evidence, not owner
   authentication, so it is valid only when the active task contains the
   owner's explicit English decision. Never invent that decision, reuse a
   confirmation for another operation, hand-edit the decision fields, or
   confuse release authority with runtime activation authority. The older
   authenticated GitHub comment route remains an optional compatibility path
   for existing release artifacts.

   Review every generated release-note artifact yourself, rewrite it if it is thin or misleading, then set `"approved": true` in the release JSON and commit that approval. **This review is yours, not the owner's.** Do not stop and ask them to flip the flag: `release-publish.sh` refuses to tag until it is true, so bouncing it back turns a one-command ship into a round trip. The generator produces a first draft from commit subjects, which is frequently a poor summary. It leads with whatever churned most rather than what the reader cares about. Rewriting it is part of this step, not an optional extra.
   Check the generated draft against `scripts/release-notes-shared.mjs`: features are capped at `MAX_FEATURES` (3), fixes and follow-ups at 15. Run `node scripts/validate-release-notes.mjs <release json>` before committing.

3. Run `npm run validate:release` for production or `npm run validate:feature` for dev on the exact release commit. Native changes require Rust formatting, linting, and tests through the repository validation lane.
4. If any `docs/PHASE-*.md` file changed, require a reconciled [docs/roadmap-status.json](../../../../docs/roadmap-status.json), run `node scripts/validate-roadmap-status.mjs`, and create a separate `www` handoff for status and public copy reconciliation. Do not edit the website from this lane.
5. Publish a no-transition release-prep branch with `./scripts/worktree-publish.sh --base main --ready --title "chore: prepare v<version>"` for production, or use `--base dev` for dev. For a `review_required` Library Core transition, complete the current-task owner-confirmation flow in step 2, commit only the command-generated decision fields, run exact-head validation, then publish the PR with `--ready`. A draft PR is optional and does not carry owner authority. A deliberately provisioned unattended host may wrap this helper with `FREED_TRUSTED_PUBLISHER`. Never push a release commit directly to `dev` or `main`.
6. Before App provisioning, apply the single active `Freed release tag lockdown` ruleset with `--lock-release-tags --apply`. It restricts creation, update, and deletion of every `refs/tags/v*` tag with no bypass. After an owner-reviewed change pins the dedicated release App ID, activation applies no-bypass immutability and App-only creation before it removes the bootstrap lockdown. Never substitute a user, administrator, repository role, team, deploy key, or the PR publisher App.
7. Merge the release-prep PR through branch protection. In a clean checkout already on `main` for production or `dev` for dev, run `git fetch origin <branch>` and `git merge --ff-only origin/<branch>`, then run `./scripts/release-publish.sh <version>`. The script proves `HEAD` equals the matching remote branch, validates the fixed release receipts, confirms both live tag rulesets against the checked-in App ID, rejects an existing local or remote tag, and delegates one exact annotated-tag creation through the fixed root-owned publisher binding.
8. Never expose a reusable release App token or push the tag with a user credential. The trusted broker must recheck the exact tag, commit, branch tip, receipt digest, and absence preconditions at push time, obtain a short-lived installation token, and permit no arbitrary ref, update, or deletion operation. The tag workflow independently proves the tag SHA belongs to protected `main` for production or protected `dev` for dev. It uses recorded release receipts rather than comparing against a moving live dev tip.
9. Monitor the tag workflow until every required job for the exact release SHA succeeds. A canceled, stale, different-SHA, or release-identity-invalid run is not evidence for this release.
10. Repair failures through a new PR in the correct lane, then cut a new version. Do not move or reuse a failed tag.
