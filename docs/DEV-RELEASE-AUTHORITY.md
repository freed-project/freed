# Standing dev release authority


Retain the actual dated English grant and stable transcript reference in a private
mode `0600` file outside the repo, inside a mode `0700` directory. Use the
`standing-dev-release-authority` schema in
`scripts/prepare-dev-release-owner-confirmation.mjs`: active grant ID, owner,
original grant time, optional explicit expiry/revocation, transcript provenance,
and dev-only scope with the previously reviewed manifest and transition digests.
Never invent, expire without cause or broaden the owner's grant.

Run `node scripts/prepare-dev-release-owner-confirmation.mjs` with
`--artifact=release-notes/releases/<dev-tag>.json`,
`--authority-file=<absolute-private-grant>`, `--output=<new-private-receipt>` and
`--task-reference=<active-task>`. It binds the current proposal, preserves grant
provenance, and refuses changed activation scope or enabled ordinary transfer
acceptance. Record its one-day receipt through the shipping reference's existing
`record-owner-approval` flow. Receipt expiry does not expire a standing grant.
Production, new provider behavior, runtime activation, primary migration and
expanded access retain separate gates. Empty deltas need no activation receipt.
Main receives this workflow through normal promotion; www remains lane-specific.
