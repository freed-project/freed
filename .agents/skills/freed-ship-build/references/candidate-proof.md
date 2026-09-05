## Run this end to end without stopping

Once invoked, carry the release all the way to a tagged, verified build. Do not
return to the owner between steps for confirmation they have already given by
asking for the release. Specifically:

- **Prove the candidate locally before release preparation.** Do not create a
  PR, tag, or GitHub release to discover whether a native Desktop change works.
  Use the pinned Node toolchain to run `npm run tauri:build -- --bundles app`
  from `packages/desktop`, then exercise the relevant real fixture or local
  Library. Iterate locally until that path works end to end. Use GitHub only
  for final exact-head checks, signing, notarization, updater metadata, and
  distributable artifacts. Final installed proof still requires the signed
  artifact because local bytes are not release bytes.

- **Set `"approved": true` yourself.** That review is the agent's, not the
  owner's. See "Prepare and publish" step 2.
- **Merge your own release PRs** once their checks are green. A release-prep PR
  and a release-fix PR are yours to land; the branch protection and the tag
  rulesets are the controls, not a second human read.
- **Use the repository release scripts.** `release.sh` knows that package versions are plain
  CalVer while only the tag carries `-dev`; hand-editing five version files does
  not. `release-publish.sh` knows the tag can only be created through the
  root-owned publisher binding; `git tag && git push` is rejected by the
  `Freed release tag creation` ruleset, which permits exactly one App as bypass.

Stop and ask only for a genuine decision: waiving a failing gate, shipping a
known defect, or anything that changes provider-observable behavior. A dirty
tree, a red check, or a validation error is a problem to fix and then continue
through, not a reason to hand the release back.
