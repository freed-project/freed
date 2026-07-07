# W1-05: freed-build-feature skill: verification-counters step + outcome recording

runner-safe: false (skill change; owner should eyeball) | provider-visible: false | soak-gated: no

## Context

The stability program's rule is "verification is counters, not vibes": stability/memory work must name the runtime-health counter or test that proves it. The freed-build-feature skill (`.agents/skills/freed-build-feature/SKILL.md`) has no such step, and merged work never records outcomes into the planner ledger.

## Change

1. Add a step after implementation: "If this change affects sync, capture, memory, or recovery behavior, name the counter or soak assertion that will prove it (see docs/STABILITY-PROGRAM.md scorecard) and state the expected direction in the PR body. If no counter exists, add one in the same PR or justify why a test suffices."
2. Add to the closeout step: append the outcome ledger entry via the W1-01 helper.
3. Add a pointer to docs/STABILITY-PROGRAM.md program rules (watchdog freeze, one-product-PR-per-soak, provider-visible lane) so feature threads inherit them.

## Verify

- Owner review. Then one real feature PR produced under the updated skill shows the counter statement in its body and a ledger entry after merge.
