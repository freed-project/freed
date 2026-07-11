# W2-04: Stability operations skills and artifact contracts

runner-safe: true (skills are docs; owner may spot-check) | provider-visible: false | soak-gated: no
Prereq: W1-02, W2-02, W2-03 (the scripts these skills drive).

## Context

The program's operational moves (run a soak, triage evidence, judge a release) should each be a one-command skill so any thread or loop can execute them consistently, instead of re-reading prose in AGENTS.md.

## Change

Create eight stability skills under `.agents/skills/`, each following the house
SKILL.md format with `disable-model-invocation: true`:

1. **freed-soak**: launch an installed-build soak terminal-first (`open -g`, dev-sync-trigger usage, locked-machine rules by reference to the canonical soak doc from W1-07), start `soak-collect.mjs`, and on completion run `soak-assert.mjs` and report the verdict path. Includes the 10-minute-timeout contract language.
2. **freed-triage**: run `triage.mjs`, present the ranked candidates with evidence, and either hand off to freed-build-feature for the top item or file the queue for the nightly runner.
3. **freed-canary**: run `canary-summarize.mjs` for the latest release, compare to the trailing median, and if regressed, kick off `bisect-regression.mjs` and report the culprit range.
4. **freed-evidence-capture**: preserve attributable read-only incident evidence
   before restarting or repairing the system.
5. **freed-memory-profile**: measure matched memory cohorts without crossing
   process generations or workload states.
6. **freed-sync-replay**: reproduce sync and provider lifecycle failures through
   deterministic offline fixtures and fault injection.
7. **freed-provider-risk-review**: prepare the two scoped provider approval
   gates without treating a generated packet as owner approval.
8. **freed-stability-controller**: reconcile observations, task state, authority,
   approvals, soaks, and outcomes into one canonical next decision.

Each skill states its counter-based success criteria and cites docs/STABILITY-PROGRAM.md rules (watchdog freeze, provider-visible lane).

The five artifact-producing skills use
`automation/artifact-schemas/stability-artifact-v1.schema.json` and write
immutable manifests through `scripts/stability-artifact.mjs`. Skill
frontmatter, local links, command references, and agent metadata are checked by
`scripts/validate-skills.mjs`.

## Verify

- Each skill executed once end-to-end in a live thread produces the expected
  artifact or governed handoff.
- `node scripts/validate-skills.mjs` passes and rejects missing commands or
  automatic invocation.
- `node scripts/stability-artifact.mjs validate --input <manifest.json>
  --kind <kind>` accepts each version 1 example and rejects missing
  kind-specific fields.
