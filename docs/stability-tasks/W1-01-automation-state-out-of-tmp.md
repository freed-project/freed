# W1-01: Move automation state out of /tmp and authenticate task outcomes

runner-safe: true | provider-visible: false | soak-gated: no

## Context

The nightly self-improve planner used to keep its outcome ledger and active soak
pointer under `/tmp`. macOS clears that directory, so the planner could forget
completed work and active evidence after a reboot. A free-form ledger append
also could not prove which canonical task changed state or which actor owned the
transition.

## Change

1. Keep durable planner state under `~/.freed/automation/`: `outcomes.jsonl`,
   `current-soak-dir`, generated runs, and canonical control state.
2. Record each outcome through `scripts/record-outcome.mjs` with a live actor
   lease, canonical task ID, allowed lifecycle transition, and exact evidence.
3. Require verification outcomes to resolve a JSON verdict whose build, window,
   source health, and composite fingerprint match the claim.
4. Update `docs/NIGHTLY-SELF-IMPROVE.md` paths.

## Verify

- `node --test scripts/nightly-self-improve.test.mjs` passes with new defaults.
- `npm run nightly:self-improve -- --dry-run --json` finds the ledger at the new path.
- Ledger file survives reboot because it is not under `/tmp`.
- Missing tasks, invalid transitions, unsigned lines, and mismatched verdicts
  fail closed.
