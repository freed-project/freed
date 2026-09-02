# Freed WWW Skill Instructions

Read the root `AGENTS.md` first. Skills route task-specific workflows and never grant authorization.
Read [docs/AGENT-INSTRUCTIONS.md](../../docs/AGENT-INSTRUCTIONS.md) before changing the instruction architecture or its budgets.

## Authoring contract

- Keep `SKILL.md` focused on activation, decisions, safety stops, and the shortest complete workflow.
- Keep each `SKILL.md` at or below 16 KiB. Move substantial conditional modes, examples, and command catalogs into clearly named files under `references/`.
- Link each reference directly from `SKILL.md` and state when to read it. Do not require directory scanning.
- Put only `name` and `description` in skill frontmatter.
- Make the description precise enough for reliable selection, including important exclusions.
- Every skill must include `agents/openai.yaml` with interface metadata and explicit `policy.allow_implicit_invocation: true`.
- Do not use `disable-model-invocation`. Codex does not use it as the invocation control.
- Preserve the numbered repository authorization model. A selected skill cannot raise authority, authorize production, or bypass an owner checkpoint.
- Link canonical repository documents instead of copying mutable policy into a skill.

Run `npm run validate:skills` after changing a skill.
