# W1-03: scripts/doctor.mjs machine preflight for all loops

runner-safe: true | provider-visible: false | soak-gated: no

## Context

On the primary dev machine, `gh` was an x86_64 binary that failed to load arm64-only libxcrun (an arm64 gh has since been installed at /opt/homebrew/bin/gh, but the git credential helper still points at the removed /usr/local/bin/gh, so `git push` over https fails), the default PATH `node` is ancient, and `python3` resolves through a broken safe-chain shim. Loops and agents hit these as silent fallbacks and confusing mid-task failures. AGENTS.md already says surprising node/npm paths are "a machine issue to fix before debugging the repo" — make that a script instead of prose.

## Change

1. `scripts/doctor.mjs`: checks and reports (exit non-zero on hard failures):
   - `node`/`npm`/`npx` resolve from the repo-pinned toolchain (.nvmrc) and match each other.
   - `gh` exists, runs (`gh --version`), and its binary architecture matches the machine (`file $(which gh)` on darwin); if broken, print the exact remediation (reinstall arm64 gh) and the curl-based GitHub API fallback pattern.
   - `git`, `curl`, `/usr/bin/python3` are usable.
   - Sandbox-sensitive paths exist (`~/.freed-automation/` per W1-01).
2. Wire it as the first step of `scripts/nightly-self-improve.mjs`, `scripts/worktree-add.sh`, and `scripts/worktree-publish.sh` in warn-only mode (hard-fail only in loop/CI contexts via `--strict`).
3. Add a short "Machine preflight" section to AGENTS.md pointing at it.

## Verify

- `node scripts/doctor.mjs` on the dev machine reports the known machine failures (originally the gh arch mismatch; now the stale git credential helper) with remediation text.
- `node --test` fixture test for the report formatting; `npm run test:scripts` stays green.
