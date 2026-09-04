# Tooling Instructions

Read the root `AGENTS.md` and the task-specific build or ship skill first.

- Use the Node version pinned by `.nvmrc`. Resolve `node`, `npm`, and `npx` from the same installation.
- Keep shell tooling non-interactive unless interaction is the feature. Fail closed on ambiguous refs, identities, paths, authority, or publication state.
- Use repository helpers for worktrees, previews, publication, promotion, releases, and Vercel. Do not add bypass commands to documentation or error output.
- Changes that can alter provider-visible behavior require `freed-provider-risk-review` before code. Add provider-visible paths only to `scripts/lib/provider-visible-paths.mjs`.
- Do not edit saved `automation.toml` files to repair drift. Validation and supported host controls own reconciliation.
- Release scripts own CalVer, release files, tags, immutable source identity, and remote-head checks. Do not duplicate that logic in prose or a second script.
- When release or deployment helpers exist on more than one long-lived lane, update every applicable copy in the same sweep or document why the implementations intentionally differ.
- Add focused contract tests for tooling behavior. Route changed paths through `validate:feature` without silently dropping them or forcing unrelated suites.
- Preserve user data and existing worktrees. Validate exact destructive targets and prefer recoverable cleanup.
