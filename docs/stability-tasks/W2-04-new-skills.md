# W2-04: New skills: freed-soak, freed-triage, freed-canary

runner-safe: true (skills are docs; owner may spot-check) | provider-visible: false | soak-gated: no
Prereq: W1-02, W2-02, W2-03 (the scripts these skills drive).

## Context

The program's operational moves (run a soak, triage evidence, judge a release) should each be a one-command skill so any thread or loop can execute them consistently, instead of re-reading prose in AGENTS.md.

## Change

Create three skills under `.agents/skills/` (symlinked into `.claude/skills/` like the existing four), each following the house SKILL.md format with `disable-model-invocation: true`:

1. **freed-soak**: launch an installed-build soak terminal-first (`open -g`, dev-sync-trigger usage, locked-machine rules by reference to the canonical soak doc from W1-07), start `soak-collect.mjs`, and on completion run `soak-assert.mjs` and report the verdict path. Includes the 10-minute-timeout contract language.
2. **freed-triage**: run `triage.mjs`, present the ranked candidates with evidence, and either hand off to freed-build-feature for the top item or file the queue for the nightly runner.
3. **freed-canary**: run `canary-summarize.mjs` for the latest release, compare to the trailing median, and if regressed, kick off `bisect-regression.mjs` and report the culprit range.

Each skill states its counter-based success criteria and cites docs/STABILITY-PROGRAM.md rules (watchdog freeze, provider-visible lane).

## Verify

- Each skill executed once end-to-end in a live thread produces the expected artifact (verdict, ranked queue, canary JSON).
- Skills reference only commands that exist (dry-read check like W1-04).
