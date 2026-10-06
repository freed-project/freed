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
6. For every published dev or production release, on any machine, use `freed-ship-www`. Carry the published tag, source SHA, approved artifact digest and `source.prNumbers` into a tracked `www` PR. Record its URL and deployment identity; verify the exact build and PR links on the deployed changelog, including paginated pages. The generator reads published tag artifacts; never merge `dev` into `www`. A green build or installed app does not complete this handoff. Without website authority or deployment, report it as pending with the prepared worktree or PR. Exclude unpublished release preparations.

7. For production, complete [showcase asset and website verification](../../../../docs/RELEASE-SHOWCASE.md). Record any missing integration or website handoff as pending release work.
