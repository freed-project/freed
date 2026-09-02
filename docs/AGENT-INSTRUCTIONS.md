# Agent Instruction Architecture

Load each rule needed for the current website task once, before the relevant decision. Keep universal governance, website invariants, workflows, explanations, and enforcement in separate layers.

## Layers

| Layer                        | Purpose                                                                         | Loading                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Global personal instructions | Identity, voice, external-post policy, and general engineering defaults         | Every task                                                                                |
| Root `AGENTS.md`             | Freshness, authorization, production stops, lane routing, and repository safety | Every repository task                                                                     |
| Scoped `AGENTS.md`           | Hard invariants for one path                                                    | Automatically when a task starts at or below that path, otherwise through the root router |
| `SKILL.md`                   | A bounded website workflow and its decisions                                    | Selected from its description or invoked explicitly                                       |
| Skill `references/`          | Conditional details, examples, and command catalogs                             | Only when a matching trigger in `SKILL.md` requires one                                   |
| Canonical docs and scripts   | Tutorials, rationale, mutable contracts, and machine enforcement                | On demand                                                                                 |

Do not copy a mutable rule into several layers. Keep one authoritative version and route to it. Repeat only a short safety stop when it must be seen before a deeper file can be selected.

## Budgets

- Root `AGENTS.md`: 16 KiB maximum.
- Each scoped instruction file: 6 KiB maximum.
- Any root-to-scope instruction chain: 28 KiB maximum.
- Each `SKILL.md` entrypoint: 16 KiB maximum.
- Selected references for one task mode have a 32 KiB review threshold. Split triggers more narrowly or record why a larger complete bundle is necessary. Never omit an authority or safety rule merely to meet a budget.

`npm run validate:agent-instructions` enforces discovery, root routing, local links, punctuation, and byte budgets. `npm run validate:skills` enforces skill metadata, invocation policy, entrypoint size, direct reference links, and portable prose.

`CODEOWNERS` routes instruction changes to the owner. Branch rules decide whether that review is mandatory. The validator proves only that the routing entries exist.

## Invocation policy

Codex invocation policy belongs in `agents/openai.yaml`:

```yaml
policy:
  allow_implicit_invocation: true
```

Freed website skills use implicit selection because their descriptions are narrow routers. Explicit `$skill-name` invocation remains available.

Do not use `disable-model-invocation`. It is not the Codex invocation control and created false confidence while implicit selection remained enabled.

Skill selection loads instructions. It never raises the numbered authorization level, authorizes a production merge or deployment, or bypasses an owner checkpoint.

## Change checklist

1. Classify a rule as universal, website-specific, workflow-specific, explanatory, or mechanically enforceable.
2. Put it in the narrowest authoritative layer that loads before the relevant decision.
3. Add or update the root router when a root-started task would otherwise miss it.
4. Remove the superseded copy instead of leaving compatibility prose behind.
5. Test local links, byte budgets, invocation metadata, and representative routing.
6. Preserve production and authority stop signs in the root or skill entrypoint even when the complete procedure lives deeper.

## Long-lived branches

`www` owns production marketing instructions. Port website policy here deliberately. Never merge `dev` into `www` for instruction parity. Product instruction development remains on `dev`, and reviewed production promotion carries it to `main`.

When a shared safety rule changes, inspect all three long-lived versions and record every intentional difference in the pull request.

## Measure the result

Review this architecture after a concrete routing error, missed production stop, or repeated-context regression. Use that evidence to adjust the route or budget. Do not optimize for line count alone.
