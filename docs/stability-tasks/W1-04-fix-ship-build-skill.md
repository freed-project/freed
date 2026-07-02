# W1-04: Rewrite freed-ship-build skill against the actual release scripts

runner-safe: false (skill governs releases; owner should eyeball) | provider-visible: false | soak-gated: no

## Context

`.agents/skills/freed-ship-build/SKILL.md` (symlinked into `.claude/skills/`) drifts from the real release flow: it omits the approve step and the `release-publish.sh` tag-push sequence, and mischaracterizes what `release.sh` vs `release-publish.sh` do. An agent following the skill verbatim stalls mid-release. (Finding source: scaffolding map, verified against `scripts/release.sh` / `scripts/release-publish.sh` / `scripts/promote-dev-to-main.sh`.)

## Change

1. Read `scripts/release.sh`, `scripts/release-publish.sh`, `scripts/prepare-release-notes.mjs`, `scripts/validate-release-notes.mjs`, and the release workflow in `.github/workflows/release.yml`. Rewrite the skill's workflow steps to match reality exactly: version computation, release-notes prepare/approve, publish/tag-push, CI monitoring, per-platform failure handling, reverse-integration PR, changelog refresh handoff to freed-ship-www.
2. Every step names the exact command. No step may exist in the skill that has no corresponding script behavior.
3. Keep the existing soak/trigger/10-minute-timeout language intact.

## Verify

- Dry-read test: walk the skill steps against a mock release on a branch; every command exists and runs with `--help`/dry-run where supported.
- Owner review of the diff.
