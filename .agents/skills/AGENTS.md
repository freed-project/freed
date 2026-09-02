# Freed Skill Instructions

Read the root `AGENTS.md` first. Skills route task-specific workflows and never grant authorization.
Read [docs/AGENT-INSTRUCTIONS.md](../../docs/AGENT-INSTRUCTIONS.md) before changing the instruction architecture or its budgets.

## Authoring contract

- Keep `SKILL.md` focused on activation, decisions, safety stops, and the shortest complete workflow.
- Keep each `SKILL.md` at or below 16 KiB. Move detailed modes, examples, command catalogs, and background into clearly named files under `references/`.
- Link references directly from `SKILL.md` and state exactly when to read each one. Do not require an agent to scan a directory.
- Put only `name` and `description` in skill frontmatter unless the current Agent Skills standard requires another field.
- Make the description precise enough for reliable selection. Name both positive triggers and important exclusions.
- Every skill must include `agents/openai.yaml` with interface metadata and an explicit `policy.allow_implicit_invocation` value. Freed skills currently allow implicit selection, so that value is `true`.
- Do not use the legacy `disable-model-invocation` field. Codex does not use it as the invocation control.
- Preserve the numbered repository authorization model. A selected skill cannot raise authority, approve provider traffic, satisfy Gate 1, or bypass a stop condition.
- Link canonical repository documents instead of copying mutable policy into a skill.
- Use imperative instructions. Explain rationale only where it changes judgment.

Run `npm run validate:skills` after changing a skill.
