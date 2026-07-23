# W1-05: freed-build-feature skill: verification counters and governed outcomes

runner-safe: false (skill change; owner should eyeball) | provider-visible: false | soak-gated: no

## Context

The stability program's rule is "verification is counters, not vibes".
Stability and memory work must name the runtime-health counter or test that
proves it. The build skill also needs to bind merge, install, and verification
states to the canonical task instead of treating a free-form ledger line as the
source of truth.

## Change

1. Add a step after implementation: "If this change affects sync, capture, memory, or recovery behavior, name the counter or soak assertion that will prove it (see docs/STABILITY-PROGRAM.md scorecard) and state the expected direction in the PR body. If no counter exists, add one in the same PR or justify why a test suffices."
2. Add to the closeout step: record the canonical task transition through
   `record-outcome.mjs` with `--task-id`, the live actor lease, a valid
   predecessor state, and exact evidence.
3. Add a pointer to docs/STABILITY-PROGRAM.md program rules (watchdog freeze, one global behavior until its installed-build soak outcome completes, provider-visible lane) so feature threads inherit them.

## Verify

- Owner review. Then one real feature PR produced under the updated skill shows
  the counter statement and a canonical `validated` to `merged` outcome record.
