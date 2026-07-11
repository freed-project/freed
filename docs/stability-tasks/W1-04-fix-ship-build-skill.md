# W1-04: Rewrite freed-ship-build skill against the actual release scripts

runner-safe: false (skill governs releases; owner should eyeball) | provider-visible: false | soak-gated: no

## Context

`.agents/skills/freed-ship-build/SKILL.md` previously drifted from the real release flow. The branch-governance pass also found that direct release commits and protected-branch pushes would fail as soon as the checked-in rulesets became active. The release contract now needs one PR-compatible sequence shared by scripts, docs, and the skill.

## Change

1. Keep `release.sh`, `release-publish.sh`, `prepare-release-notes.mjs`, `validate-release-notes.mjs`, and the release workflow aligned with the skill. Dev release prep starts on current `origin/dev` and lands through a reviewed PR to `dev`. Production release prep starts on current `origin/main` after any required product promotion and lands through a release-only PR to `main`.
2. Tag only the exact merged remote commit. Push the tag ref alone. Never commit or push directly to `dev` or `main`.
3. Every step names the exact command. No step may exist in the skill that has no corresponding script behavior.
4. Keep the existing soak, trigger, and 10 minute timeout language intact.

## Verify

- `node --test scripts/release-governance.test.mjs`
- Dry-read test: walk the skill steps against a mock release branch and verify the protected branches receive changes only through pull requests.
- Owner review of the diff.
