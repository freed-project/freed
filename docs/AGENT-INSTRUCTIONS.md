# Agent Instruction Architecture

Load each rule needed for the current task once, before the relevant decision. Keep universal governance, path invariants, workflows, explanations, and enforcement in separate layers.

## Layers

| Layer                        | Purpose                                                                              | Loading                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Global personal instructions | Identity, voice, external-post policy, general engineering defaults                  | Every task                                                                                       |
| Root `AGENTS.md`             | Freshness, authorization, dangerous-action stops, lane routing, universal invariants | Every repository task                                                                            |
| Scoped `AGENTS.md`           | Hard invariants for one path                                                         | Automatically when the task starts at or below that path; otherwise through the root path router |
| `SKILL.md`                   | A bounded task workflow and its decisions                                            | Selected from its description or invoked explicitly                                              |
| Skill `references/`          | Detailed modes, contracts, examples, and command catalogs                            | Only when a matching trigger in `SKILL.md` says to read one                                      |
| Canonical docs and scripts   | Tutorials, rationale, mutable technical contracts, and machine enforcement           | On demand                                                                                        |

Do not copy a mutable rule into several layers. Keep one authoritative version and route to it. Repeat only a short safety stop when an agent must see it before deciding which deeper file applies.

## Budgets

- Root `AGENTS.md`: 16 KiB maximum.
- Each scoped instruction file: 6 KiB maximum.
- Any repository root-to-scope instruction chain: 28 KiB maximum.
- Each `SKILL.md` entrypoint: 16 KiB maximum.
- Selected references for one task mode have a 32 KiB review threshold. Above it, split the triggers more narrowly or record why the complete bundle is necessary. Never omit a matching safety or authority rule to meet the threshold.

`npm run validate:agent-instructions` enforces instruction discovery, root routing, local links, punctuation, and byte budgets. `npm run validate:skills` enforces skill metadata, invocation policy, entrypoint size, direct reference links, and portable prose.

`CODEOWNERS` routes instruction changes to the owner. Branch rules decide whether that review is mandatory; the validator proves only that the routing entries exist.

The limits leave room below Codex's default project-instruction ceiling and make accidental growth fail in review instead of silently truncating policy.

## Invocation policy

Codex invocation policy belongs in `agents/openai.yaml`:

```yaml
policy:
  allow_implicit_invocation: true
```

Freed skills use implicit selection because their descriptions are narrow routers for repository work. Explicit `$skill-name` invocation remains available.

Do not use `disable-model-invocation`. It is not the Codex invocation control and created false confidence while implicit selection remained enabled.

Skill selection loads instructions. It never raises the numbered authorization level, approves provider behavior, grants live traffic, satisfies a release gate, or bypasses an owner checkpoint.

## Change checklist

1. Decide whether the rule is universal, path-specific, workflow-specific, explanatory, or mechanically enforceable.
2. Put it in the narrowest authoritative layer that still loads before the relevant decision.
3. Add or update the root router when a root-started task would otherwise miss it.
4. Remove the superseded copy instead of leaving compatibility prose behind.
5. Test local links, byte budgets, invocation metadata, changed-path validation, and representative task routing.
6. Preserve critical stop signs in the root or skill entrypoint even when the complete procedure moves deeper.

## Long-lived branches

`dev` owns current product instruction development. Normal production promotion carries reviewed policy into `main`. Port instruction-only changes to `www` deliberately through its lane when website tasks need them. Never merge `dev` into `www` to obtain instruction parity.

When a safety rule changes, inspect all three long-lived versions and record every intentional difference in the pull request.

## Measure the result

Review this architecture after a concrete routing error, missed safety stop, or repeated-context regression. Use that evidence to change the route or budget. Do not optimize for line count alone.
