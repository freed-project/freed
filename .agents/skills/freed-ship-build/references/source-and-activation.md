## Establish authority and identity

1. Confirm `dev` or `production` release mode. Production is the default for `./scripts/release.sh`. Dev release prep requires `--channel=dev`.
2. Record the release task ID and granted authority. If the release repays tracked debt, also record each canonical GitHub issue. Preparing notes, pushing a tag, publishing, and deploying are distinct external actions.
3. Fetch `origin/dev` and `origin/main`, require a clean tree, and select one exact 40-character source dev commit SHA. That immutable SHA is the production snapshot. Later `dev` commits do not invalidate or expand it.
4. For production, run `node scripts/validate-release-promotion.mjs --from-ref=<source-dev-sha> --to-ref=origin/main`. If it fails because main is behind the selected product snapshot, run `./scripts/promote-dev-to-main.sh <worktree-path> <branch-name> --snapshot-sha <source-dev-sha>`, merge that reviewed PR, and fetch the new `origin/main` before release prep. Never replace the selected SHA with a later live `origin/dev` tip unless the owner explicitly selects a new snapshot.
5. If the release contains provider-visible work, confirm its artifact names the
   provider set, observable behavior, and decision state. A
   `behavior_approved` artifact must carry the owner approval reference for that
   behavior. A `diff_authorized` artifact must state that the classified path
   change has no provider-observable effect and needs no behavior decision.
   Require renewed approval only when observable behavior exceeds the approved
   scope. A changed diff alone does not create a second gate.
6. Inspect the product range from the previous published release receipt's
   `productCommitSha` for this channel, exclusive, through the current source
   product SHA, inclusive. Do not inspect only the release-prep PR diff because
   that normally contains metadata after product work has already merged. If
   no previous release exists, inspect the complete reachable product history.
   Check that exact range for any Gate C through Gate H Library Core
   dormant-to-active transition. This includes claiming or executing a
   migration candidate, source admission fencing, SQL read cutover,
   legacy-worker or renderer-corpus eviction, a Library Core writer,
   replication protocol, storage epoch, migration cutover, rollback, restore,
   authority-key rotation, recovery activation, installed-soak activation at
   Gate G, or legacy-engine retirement.
   Dormant code and measurement need no activation handoff. An active
   transition requires an exact owner-reviewed Library Core activation decision
   and handoff bound to the current source product SHA.
   Release authority does not grant install or activation authority, and
   install authority does not grant the transition itself.
