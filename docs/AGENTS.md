# Documentation Instructions

Read the root `AGENTS.md` and the task's workflow skill first.

- Product documentation targets `dev`. Public marketing, public roadmap presentation, legal pages, and changelog presentation target `www`.
- A new feature must update every affected `docs/PHASE-*.md` file and `docs/roadmap-status.json` in the same product commit. Reconcile the structured roadmap even when its status is unchanged.
- Validate roadmap data with `node scripts/validate-roadmap-status.mjs`.
- Do not infer public roadmap state from phase prose. Hand the approved structured source commit to a separate `www` task.
- [TESTING-STANDARD.md](TESTING-STANDARD.md) is binding for permanent test admission, tiering, runtime, and pruning.
- [SOAK-AND-TRIGGERS.md](SOAK-AND-TRIGGERS.md) is binding for installed soaks and terminal triggers.
- Put operational tutorials, command catalogs, historical decisions, and rationale in the canonical document for that subject. Keep root and skill instructions as short routers.
- Update links and references when moving authoritative material. Do not leave two files claiming to own the same mutable rule.
- Apply the installed `no-ai-slop` skill to substantial prose.
