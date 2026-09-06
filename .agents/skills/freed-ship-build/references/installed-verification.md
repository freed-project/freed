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
