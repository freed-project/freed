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

After the required fetch, run `npm run validate:instruction-lanes`. It reports
the immutable commits inspected and compares the complete numbered authority
section plus named universal freshness, scope, toolchain, preservation, and
Vercel-scope stops. This is an explicit policy contract, not a semantic proof
of every sentence. It never fetches or changes remote refs itself.

Intentional differences: `dev` and `main` route provider and durable-storage
work to their pre-action gates. `www` excludes product work and instead
requires Level 6 or 7 for a merge that deploys production. Its task and
deployment routes stay website-specific. Main receives instruction changes
through normal reviewed promotion, not an out-of-band product merge.

## Routing fixtures

`docs/instruction-routing-fixtures.json` records representative prompts,
reviewer-selected workflow bundles, required stops, exclusions, and byte
ceilings. `validate:agent-instructions` checks their links and budgets and
checks that every extracted Library contract chapter remains routed. Changes
to skills, fixtures, chapters, and validators select this focused gate.

These fixtures catch structural regressions. They do not invoke a model or
prove selection accuracy. Review the prompt against skill descriptions and
reference triggers when changing a fixture. Record a real misroute before
adding a new case. Measurements count the listed workflow files once, not
personal instructions, root instructions, source code, or total model tokens.
Over-budget cases must retain an explicit explanation of interacting rules;
never omit a matching authority reference to improve the number.

## Local decision review

Complex, autonomous task sequences require `TASK-DECISIONS.local.md` at the task worktree root. The repository ignores this filename. Confirm it is ignored and absent from the index before publication; never force-add, commit, or copy its contents into a public issue or pull request. Keep secrets and personal data out of it.

Create the log when the first judgment decision or unanswered question arises. Keep a short review-first summary of open questions, provisional decisions, and known gaps. For each entry record:

- A stable entry number, date, affected surface, and status: open question, investigation, provisional decision, implemented, superseded, or owner-confirmed.
- The request or observed problem, separating evidence from assumptions.
- The chosen behavior, alternatives considered, and concrete reason for the choice.
- Consequences, affected files, validation performed or still missing, and what the owner should inspect.
- Any owner answer or later correction, retaining the earlier decision as superseded rather than silently rewriting history.

Record decisions when made and update entries after validation or new owner feedback. Do not turn the log into a tool transcript or routine progress diary. Backfilled entries must say they are retrospective and must not invent earlier rationale or proof.

Pause and ask about ambiguities that materially change scope, authority, safety, architecture, or user experience. A logged guess is not approval. Continue independent, authorized work while a separable question is pending.

Before handoff or release, reconcile the log with the implementation, clearly identify unresolved items, and give the owner a clickable local link. Do not claim a clean review while a material question remains. Before deleting a worktree, preserve its log at an owner-accessible local path outside the worktree and provide that path, or retain the worktree until review. Never delete the only copy during cleanup. Only promote an approved durable decision into tracked product documentation; the review log itself remains local.

## Measure the result

Review this architecture after a concrete routing error, missed safety stop, or repeated-context regression. Use that evidence to change the route or budget. Do not optimize for line count alone.
