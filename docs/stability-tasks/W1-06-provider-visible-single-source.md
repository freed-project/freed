# W1-06: Single-source the provider-visible path list; enforce at publish time

runner-safe: false (touches publish gating) | provider-visible: false | soak-gated: no

## Context

Two divergent definitions of "provider-visible surface" exist: `scripts/validate-worktree.mjs` has an explicit path classification, while `scripts/nightly-self-improve.mjs` uses a substring heuristic (~line 855) that misses files the validator treats as provider surfaces. The AGENTS.md fingerprinting stop-sign relies on agents remembering prose. Divergence means an autonomous loop can ship provider-visible changes it believes are safe.

## Change

1. Extract one canonical exported list/predicate (e.g. `scripts/lib/provider-visible-paths.mjs`): extractor JS (`packages/desktop/src-tauri/src/*-extract.js`, `webkit-mask.js`), capture packages' browser/selectors/rate-limit files, `*-capture.ts`/`*-auth.ts` navigation/timing regions, user-agent, and any path validate-worktree already classifies as provider surface.
2. Consume it from both `validate-worktree.mjs` and `nightly-self-improve.mjs` (delete the substring heuristic).
3. Enforcement: `scripts/worktree-publish.sh` refuses to publish a branch whose diff touches the list unless `--approved-provider-risk "<one-line owner approval reference>"` is passed; the flag value is recorded in the PR body. This converts the stop-sign from prose to a gate.
4. Unit tests for the predicate; update AGENTS.md to reference the canonical list.

## Verify

- `node --test` on the new module; both consumers import it (grep shows no residual heuristic).
- A test branch touching `fb-extract.js` is refused by worktree-publish without the flag and accepted with it.
