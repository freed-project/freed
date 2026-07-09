# Canary ledger

One committed record per installed release, produced by
`node scripts/canary-summarize.mjs` (stability W2-03) from the machine's
rotated runtime-health history. The owner machine is the de-facto canary
fleet — releases are near-daily and there is no remote telemetry — so this
ledger is what makes "which release regressed it" a lookup instead of an
investigation.

- `canary-<version>.json` — window metadata + metrics (recoveries/day, window
  kills by reason, invariant alarms by name, uploads and damper skips,
  worker INITs/hour, scrape success by provider, peak memory, idle growth
  slope) + `regressions` flagged against the trailing-7-record median with
  per-metric tolerances (see `REGRESSION_TOLERANCES` in the script).
- Records are append-per-release; re-running for the same version overwrites
  that version's record with the newer window.
- The nightly runner and triage loop (W2-02) read the newest records; humans
  read them in review when a soak or canary looks off.

Typical use, the morning after a release has run overnight:

```bash
node scripts/canary-summarize.mjs --hours 24
git add canary-ledger/ && git commit -m "canary: record <version>"
```
