# W1-01: Move automation loop state out of /tmp; auto-record outcomes on merge

runner-safe: true | provider-visible: false | soak-gated: no

## Context

The nightly self-improve planner learns from an outcome ledger and an active-soak pointer that both live under `/tmp` (`/tmp/freed-nightly-self-improve/outcomes.jsonl`, `/tmp/freed-perf-soak/current-soak-dir` — defaults near the top of `scripts/nightly-self-improve.mjs`). macOS clears /tmp; both files are currently missing on the dev machine, so the planner's learning loop is amnesiac and outcome recording depends on a manual `--record-outcome` invocation nobody runs.

## Change

1. Move default state locations to `~/.freed-automation/` (create on demand): `outcomes.jsonl`, `current-soak-dir`, and any other /tmp-resident planner state. Keep CLI flags as overrides. Migrate/read legacy /tmp paths as fallback for one release.
2. Auto-record outcomes: when a PR merges via the normal flow, append a ledger line automatically. Implement as a small `scripts/record-outcome.mjs` invoked from `scripts/worktree-publish.sh`'s merge-adjacent path or a post-merge helper the loops call; entry carries target id (e.g. this repo's stability task id or nightly target id), PR number, build, status.
3. Update `docs/NIGHTLY-SELF-IMPROVE.md` paths.

## Verify

- `node --test scripts/nightly-self-improve.test.mjs` passes with new defaults.
- `npm run nightly:self-improve -- --dry-run --json` finds the ledger at the new path.
- Ledger file survives reboot (i.e., is not under /tmp).
