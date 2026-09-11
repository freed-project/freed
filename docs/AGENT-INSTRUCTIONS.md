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
through normal reviewed promotion, not an out-of-band product merge. The preview
and delivery policy starts on dev; main retains its existing default Build
policy until promotion, and www requires a separate instruction-only port.
Report this authority-section drift explicitly until those lanes converge; do
not weaken the parity validator or merge lanes merely to silence it.

## Preview and delivery

For a user-facing fix or feature, separate local review from permission to publish or deploy. Start at the root policy's default Level 2 unless the owner has already set another scope or level.

1. Fetch current instructions, preserve existing work, and create the isolated worktree. Build the smallest useful version of the requested change. Run focused checks needed to make it safe and runnable.
2. Show the local preview in the task's built-in Browser as soon as that version works. Give the URL, what changed, what to inspect, and any known limitation. Do not wait for a production build, broad regression suite, CI, or deployment authority unless it is necessary to make this preview work safely. Agent-only inspection is not an owner preview.
3. Ask for feedback on the result, keep the preview alive, and incorporate corrections until the owner accepts it. "Looks good" accepts the preview; it does not authorize publication, merge, or deployment. Silence is neither acceptance nor authorization. Continue independent validation while awaiting feedback when useful, without delaying the preview or disrupting review. Use the UI polish workflow for an open visual batch.
4. Finish applicable validation and prepare the exact change, destination, and deployment plan for review. Preparation at Level 2 stays local. Do not push, open a PR, or create a hosted preview without authority covering that external action. Resolve failures before requesting deployment permission. If the reviewed behavior materially changes, refresh the preview and obtain acceptance of that change.
5. After preview acceptance and validation, ask one concise deployment question if authority is still missing, for example: "Deploy this sidebar fix to demo.freed.wtf?" An explicit "deploy it" in that clear context authorizes that deployment and the necessary publication steps. "Merge this into dev" authorizes that merge and its necessary PR steps, not a production deployment. Record the applicable numbered level and exact scope without granting unrelated capabilities. Clarify an ambiguous destination before dependent external actions.
6. Use existing authority instead of asking again. Prior deployment authority does not remove an explicit owner review hold. An explicit request to deliver autonomously through deployment, or an explicit preview waiver, can replace the default review checkpoint; preserve any narrower stop. Deploy through the governed workflow, verify the live identity and behavior, report the outcome, and clean up only the task's resources after verification and review are complete.

For documentation, tooling, or backend work without a meaningful visual surface, show the reviewable artifact, diff, or focused execution evidence instead of inventing a UI preview. An explicit request to implement and merge a described policy change authorizes that delivery without another acceptance round. Build the reviewable result before asking for any still-missing authority.

These rules change interaction order, not safety controls. Provider-visible behavior still requires the numbered approval and warning in the root provider gate. Durable Library authority, release identity, runtime checks, CODEOWNER review, and branch protections remain binding. Deployment permission never grants unrelated provider traffic or data migration.

## Authorized merge completion

An explicit owner request to merge a task includes the repository setting and PR actions needed to complete that merge. Record the level for that destination and scope under the root authorization policy; do not ask for a numbered restatement. A request to merge into dev grants no production deployment or provider behavior authority.

1. Finish implementation, owner-requested review, and required local validation before arranging the merge. Resolve failing checks, conflicts, missing approvals, and explicit owner holds first.
2. If the PR is eligible to merge now, squash merge it using its title as the commit subject and verify the resulting remote commit.
3. If required checks are queued or running, inspect the repository's `allow_auto_merge` setting. Enable it when disabled and the current account has permission. The owner's merge request authorizes this setting change without a second confirmation. Read it back to verify success.
4. Arm squash auto-merge for the reviewed PR, binding the request to its current head. Verify that GitHub recorded the auto-merge request. If a new commit or base update cancels it, revalidate the affected work and re-arm it within the existing task authority.
5. Preserve all required checks, review requirements, branch rules, and owner holds. Enabling auto-merge never authorizes an administrative bypass, weakened protections, fabricated checks, or merging a failing candidate.
6. Continue monitoring when possible. If an external wait outlasts the current run, leave auto-merge armed and report the PR as pending, with its link and remaining conditions. A queued auto-merge request is not a completed merge.
7. Verify the actual merge before reporting success, updating the launcher, or performing post-merge worktree cleanup. If GitHub policy or account permissions prevent enabling or arming auto-merge, report the exact blocker and preserve the prepared PR.

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

All workflows inherit the root initiative contract, including builds, reviews, repairs, releases, website work, and background actors within their granted capabilities. Preserve the current objective when the owner asks a side question. Answer it and resume unless the owner pauses, cancels, or replaces the task. Requests to implement are instructions to act within existing authority, not invitations to offer another plan.

### Decision paths

- **Decide and report:** Use repository conventions for routine, reversible implementation choices. Record meaningful alternatives, consequences, and uncertainty. Do not ask merely because a choice affects architecture or user experience.
- **Ask and continue:** Ask a focused question when a preference materially improves the result. Continue independent authorized work. For optional unanswered preferences, use a stated, reversible default after a reasonable response opportunity; silence never supplies approval.
- **Pause the affected action:** Stop dependent work for missing authority, an explicit owner review checkpoint, or uncertainty about scope, privacy, durable data, substantial cost, or a difficult-to-reverse choice that cannot be resolved from available evidence. Explain the concrete blocker and cite the exact instruction if one causes the stop. Complete independent preparation first. Do not fabricate an approval or weaken runtime authority.

### Decision updates and closeout

For authorized file-writing work, create `TASK-DECISIONS.local.md` at the first meaningful choice or unanswered question. Read-only tasks report decisions in the response; do not create a log when writes are prohibited. Worktree creation initializes the private log. For simple tasks, a short statement that no material trade-offs arose is sufficient. Ready publication requires a nonempty, ignored, untracked log; drafts still enforce privacy. These checks do not prove reasoning quality or owner acknowledgement.

For each meaningful entry record a stable number, date, affected surface, status, observed facts, choice and alternatives, consequence, validation, and what the owner should inspect. Mark corrections as superseded instead of erasing them. Keep a short review summary of current decisions and open items. Record choices when made; label retrospective entries. Never include secrets, raw private data, or a tool transcript.

Tell the owner about consequential choices before or as they are implemented, while course correction is cheap. Use concise updates explaining the choice, reason, consequence, and whether an answer is needed. Batch routine details. Report discoveries, changed direction, and blockers instead of narrating commands or repeating unchanged test counts. A decision update is not an approval request.

Before handoff or release, reconcile the log and state in the response:

- Which requested delivery steps completed, with source and validation evidence. Distinguish built, published, merged, and released.
- The significant trade-offs and consequences, including provisional defaults the owner may want to revisit.
- Unresolved choices or blockers, the next concrete action, and a clickable log link.

Never claim that logging a choice means the owner approved it. Never copy the private log into a PR, issue, or release. Public descriptions include only the technical rationale needed to review the change.

### Local lifecycle checks

Use `node scripts/task-decisions.mjs init --worktree <path>` for older worktrees. Publication checks the index and outgoing history before staging or pushing, so force-adding and then deleting the log does not hide a privacy leak. It never prints log contents.

Use `scripts/worktree-cleanup.sh --yes --worktree <path>` for task-scoped cleanup. Before removal it checks a clean working tree and the exact merged PR head, preserves the log outside the worktree with private permissions and a content digest, verifies the copy, and prints its path. A preservation failure retains the worktree. Include the preserved link in closeout. Do not delete the only copy manually.

### Behavioral evaluation

Use [initiative scenarios](initiative-scenarios.json) when initiative, authority, or completion rules change. Give an independent evaluator the scenario input and current instructions without the scoring rubric, permit only synthetic actions, and inspect its response and action trace against the rubric afterward. Include optional questions, side questions, exact authority reuse, explicit stops, validation reuse, and closeout. Record model, instruction digest, observed behavior, failures, and remaining limits in the private log. Structural validators do not establish model compliance. Do not add live API calls or a universal expensive model-eval gate.

## Measure the result

Review this architecture after a concrete routing error, missed safety stop, or repeated-context regression. Use that evidence to change the route or budget. Do not optimize for line count alone.
