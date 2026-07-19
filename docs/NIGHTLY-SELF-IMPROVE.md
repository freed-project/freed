# Nightly Self Improvement Runner

The nightly system has two layers. `scripts/nightly-self-improve.mjs` turns existing evidence into ranked candidates and run artifacts. The checked-in `freed-nightly-runner` automation executes only the tasks and authority recorded in the durable [automation control plane](AUTOMATION-CONTROL-PLANE.md).

Evidence comes first. A planner candidate is not execution authority. Weak evidence may produce a review prompt, but it cannot authorize a fix.

## What It Reads

- Active soak pointer at `~/.freed/automation/current-soak-dir` (legacy `/tmp/freed-perf-soak/current-soak-dir` is still read and migrated for one release)
- Soak files such as `metrics.tsv` and `runtime-health.jsonl`
- The newest readable soak under `~/.freed/automation/soaks` (or the legacy `/tmp/freed-perf-soak`) when the active pointer has no samples
- Daily bug scan memory at `/Users/aubreyfalconer/.codex/automations/daily-bug-scan/memory.md`
- Crash-watch automation state
- Hourly dev bot memory as a legacy ranking fallback, never as execution authority
- Structured phase status in `docs/roadmap-status.json`; broad roadmap prose cannot authorize work
- Git state for the current checkout
- Local git worktrees with unmerged or uncommitted changes
- Duplicate peer work indicators such as shared changed files, shared package surfaces, and shared provider-visible risk
- Provider-visible peer worktrees, even when they are not runner branches
- Prior outcome ledger at `~/.freed/automation/outcomes.jsonl` (legacy `/tmp/freed-nightly-self-improve/outcomes.jsonl` is still read and migrated for one release)
- Atomic task state at `~/.freed/automation/control/current-tasks.json`
- Append-only control history at `~/.freed/automation/control/events.jsonl`
- Active writer lease state under `~/.freed/automation/control/leases/`
- Checked-in automation specifications and prompts under `automation/`
- Preflight risks such as dirty worktrees, generated artifacts, stale or thin soak samples, missing dependencies, missing evidence files, and paused automations
- Preflight actions that separate safe local commands from manual or agent-tool-only remediation

## Target Types

- Peer worktree: active local branch work that may contain useful fixes or measurement
- Performance: WebKit memory, event loop lag, DOM growth, stale heartbeat cycles
- Bug fix: recent commit scans using the existing daily bug scan rules
- Stability: crash-watch and blank-window evidence
- Release: dev build readiness after real fixes land
- Roadmap: small autonomous product work after evidence-backed targets are exhausted
- Blocked: provider-visible ideas that need explicit approval before execution

The planner can rank more than one target when the night has enough budget. It aims to queue at least three machine hours of safe work when evidence supports it. The executor must still acquire one writer lease and obey each task's authority. It may group runtime-neutral scaffolding, but it may execute at most one product behavior change globally until that change has an installed-build soak outcome.

## Usage

```bash
npm run nightly:self-improve
```

Useful direct form:

```bash
node scripts/nightly-self-improve.mjs --max-targets 6 --duration-minutes 480 --minimum-night-minutes 180
```

Compare a known peer branch directly:

```bash
node scripts/nightly-self-improve.mjs --peer-worktree /Users/aubreyfalconer/dev/freed-scraper-recycle-verification
```

Dry run:

```bash
node scripts/nightly-self-improve.mjs --dry-run --json
```

Plan from a specific dev checkout:

```bash
node scripts/nightly-self-improve.mjs --repo /Users/aubreyfalconer/dev/freed-dev-worktree
```

Repair an unreadable active soak pointer when a newer readable soak exists:

```bash
node scripts/nightly-self-improve.mjs --repair-soak-pointer
```

Use a custom outcome ledger:

```bash
node scripts/nightly-self-improve.mjs --outcome-ledger ~/.freed/automation/outcomes.jsonl
```

Record a lifecycle outcome through the authenticated control plane:

```bash
node scripts/record-outcome.mjs \
  --id webkit-memory-pressure \
  --task-id webkit-memory-pressure \
  --kind performance \
  --status merged \
  --pr 617 \
  --actor freed-nightly-runner \
  --lease-name nightly-writer \
  --evidence-digest "$(git rev-parse HEAD)" \
  --notes "Merged. Effect not yet judged."
```

Outcome writes require the actor's live canonical lease, a canonical task ID,
and evidence bound to the transition. Cleanup does not infer or record an
outcome. The actor that owns the lifecycle transition must call the helper while
its canonical lease is live. An unsigned ledger line is retained for inspection
but ignored by planner scoring and task suppression. Verification outcomes must
reference a readable JSON verdict file. The helper hashes that exact file,
revalidates its source and baseline provenance, and requires its version,
commit, channel, evidence window, source health, and composite evidence
fingerprint to match the canonical task.

```bash
node scripts/record-outcome.mjs \
  --id <task-id> \
  --task-id <task-id> \
  --status merged \
  --pr <pull-request-number> \
  --actor freed-nightly-runner \
  --lease-name nightly-writer \
  --evidence-digest "$(git rev-parse HEAD)"
```

This merge form is valid only when the canonical task is in `validated`, or is
already `merged` during an idempotent retry.

Record installation with the complete immutable build identity:

```bash
node scripts/record-outcome.mjs \
  --id <task-id> \
  --task-id <task-id> \
  --status installed \
  --build <version> \
  --build-commit-sha <full-40-character-sha> \
  --build-channel dev \
  --artifact-digest <optional-sha256> \
  --actor freed-nightly-runner \
  --lease-name nightly-writer \
  --evidence-digest <install-evidence-sha256>
```

Build identity flags are valid only for `installed`. Later verification derives
its identity from the generated verdict and must match the canonical installed
identity exactly.

State files live under `~/.freed/automation/` so they survive reboots. This includes `outcomes.jsonl`, `current-soak-dir`, generated run directories under `runs/`, and control state under `control/`. macOS clears `/tmp`, which used to erase the planner's memory.

The generated run directory contains:

- `report.md`: morning-readable summary
- `targets.json`: full machine-readable candidate list
- `risk-snapshot.md` and `risk-snapshot.json`: preflight blockers, warnings, evidence, and remediation steps
- `preflight-actions.md` and `preflight-actions.json`: machine-readable local, manual, and automation-tool risk actions
- `duplicate-work.md` and `duplicate-work.json`: peer worktree overlap by file and surface
- `tasks/*.md`: one implementation prompt per selected target
- `execution-plan.md` and `execution-plan.json`: ordered phases, command hints, and stop gates
- `outcome-closeout.md`: one authenticated lifecycle command template per registered selected target
- `outcome-template.jsonl`: authenticated command stubs to run after a merge; never append the raw template as ledger truth

Reports include an execution phase list so the night can move from evidence, to peer comparison, to implementation, validation, dev build shipping, installed-build soak, ledger closeout, and the morning digest.

The queue is no longer allowed to stop after one short task. The default selector
keeps adding safe targets until it reaches the three-hour floor, the budget runs
out, or the candidate list is exhausted. Runtime-neutral work may batch freely.
Behavioral candidates carry a soak exclusivity key for deduplication and audit,
but the selector admits at most one behavioral candidate in the entire run. A
second product behavior waits for the first change's isolated installed-build
soak verdict.

Stale dirty peer worktrees still stay in the evidence queue, but they no longer jump ahead of a fresh bug scan just because they touch nightly runner files. If a peer is read-only, behind current `dev`, and has no commits ahead of `origin/dev`, treat it as comparison material, not as the first thing to ship. Daily bug scan summaries now also recognize explicit "no new repo commits" outcomes and avoid treating an unmerged regression note as if a fix already landed.

Peer worktrees whose branch name and exact head SHA already match a merged `dev` PR are now dropped from the automatic candidate list. If the same path still matters, pass it explicitly so the runner treats it as deliberate evidence instead of reheating already-shipped work.

## Control plane and authority

The saved nightly automation is governed by
`automation/specs/freed-nightly-runner.json` and
`automation/prompts/freed-nightly-runner.md`. The repository owns its reviewed
authority, provider policy, checked-in prompt, and one-global-behavior limit.
Validation requires the authority and provider policy to match the runtime actor
policy exactly. The specification declares the recognized schedule, status,
model, reasoning effort, target, and working-directory fields that a host
reconciler may overlay. The repository does not install or mutate the saved
automation. `npm run validate:host-automations` performs a read-only comparison
against the host definitions and rejects an active actor whose owner-provisioned
credential is unavailable. Keep actors paused until their credentials and
trusted launchers exist, then reconcile through the Codex host automation
controls instead of editing TOML directly.

After the owner-reviewed bootstrap helper is merged, provision and verify the
five general actors from a clean `dev` checkout at exact `origin/dev`:

```bash
npm run automation:actors -- provision --all
npm run automation:actors -- verify --all
npm run automation:actors -- accept-host --all
npm run validate:host-automations
```

If the batch fails, credentials completed earlier in that invocation are
revoked in reverse order. The failing actor is left untouched in case it had
state from an earlier owner action. Revoke the actor named by the error, then
retry. A `provision_rollback_failed` result names any earlier actors that also
need explicit owner recovery.

The helper uses deterministic linker output names, so identical native builds
receive the same linker-generated ad hoc signature. It does not select or need a
developer signing identity. It installs a root-owned, content-addressed copy of
the pinned Node and control runtime, plus one actor-specific launcher binding.
The native provisioner stores the persistent credential in the owner's Keychain
with access limited to that launcher. Verification checks the digest record and
binding, then asks the exact installed launcher for a nonmutating readiness
attestation. It never uses a freshly compiled provisioner to read the secret.
Keep the saved actors paused until real-host verification and host acceptance
prove unattended Keychain access. Provisioning does not grant task authority or
provider approval, and it does not contact a provider.

The ad hoc signed handoff is cooperative among processes running as the same
macOS user. It pins the selected role and protects the persistent credential,
but it cannot prove which saved automation invoked a provisioned general actor
launcher. Do not provision the five launchers if those roles require hard
caller isolation. Stored task ceilings, provider approvals, the global behavior
slot, owner governance, publisher isolation, and GitHub review remain enforced.

Verify, acquire, and host acceptance disable Keychain user interaction and fail
closed instead of opening a password dialog. Their child processes, output, and
lifecycle steps are bounded. `accept-host` proves one acquire, heartbeat, and
release lifecycle for every actor, attempts release after any successful
acquisition even when a later step fails, and returns no credential or lease
token. `rotate` is different because it must read
the prior secret for rollback. It is an explicit owner-interactive action. If
macOS asks during rotation, choose one-time **Allow**, never **Always Allow**. A
prompt from provision, verify, acquire, revoke, or host acceptance is a failure.

After the repaired helper reaches `dev`, replace credentials touched by the old
prompting flow before any actor is activated:

```bash
npm run automation:actors -- revoke --all
npm run automation:actors -- provision --all
npm run automation:actors -- verify --all
npm run automation:actors -- accept-host --all
npm run validate:host-automations
```

Before mutation, the executor must:

1. Read the atomic current task manifest.
2. Confirm the task authority permits the intended action.
3. Run `npm run --silent automation:actors -- acquire --actor freed-nightly-runner` so the trusted host launcher acquires `nightly-writer` outside the candidate process, then supply only its short-lived token in `FREED_AUTOMATION_LEASE_TOKEN`.
4. Recheck provider authority and soak exclusivity.
5. Heartbeat the lease while it owns mutable work.
6. Release the lease on success, no-op, or controlled failure.

Only canonical tasks in a runnable state with `merge-safe`, provider-forbidden
authority can enter the nightly selected queue. The scaffolding lane owns
`pr-only` tasks. Missing or contradictory behavioral classification blocks the
global behavior slot. A verification transition cannot release that slot until
the authenticated outcome ledger contains the matching task ID, state, and
transition revision. Generated outcome commands are omitted for unregistered
findings.

An active lease means another pass owns the writer. Wait or finish read-only
work. Do not create a duplicate worktree. Expired lease takeover must use the
control CLI so the previous ownership is preserved in `events.jsonl`.
The actor credential file and token are machine-local secrets. The runner must
never create, log, commit, or include them in generated run artifacts.

Validate the checked-in automation contract with:

```bash
npm run validate:automations
npm run validate:host-automations
npm run automation:actors -- verify --all
npm run automation:actors -- accept-host --all
node --test scripts/automation-control.test.mjs
```

## Outcome contract

Every outcome, task, lease, and control-event mutation first requires the
completed `freed-kernel-guard-cutover-v1` receipt and its exact old-compatible
sentinels. The one-time owner-confirmed cutover keeps the historical guard
paths permanently occupied for old binaries, then uses `/usr/bin/lockf` on
macOS or `/usr/bin/flock` on Linux for new mutual exclusion. Missing, partial,
or pre-cutover state fails closed. Process loss releases only the kernel lock,
not any sentinel path. Run the documented
`automation:cutover-kernel-guards` plan and apply operation before the first
new writer or outcome-history repair.

The immutable cutover plan has one 32 MiB aggregate limit across planning,
storage, apply, continuous inspection, and strict doctor. A prepared or
claims-installed transaction whose protected source later drifts may use the
documented read-only `plan-supersede` command followed by one separately
owner-confirmed `supersede`. That path restores only the exact planned legacy
lock bytes, preserves immutable superseded evidence, and retires the canonical
prepared transaction. It is unavailable after any permanent writer or guard
marker exists. The permanent PID 1 bootstrap lock is included in filesystem,
marker, and completed-evidence admission.

In-place claim, marker, and restoration writes are protected by an
occurrence-bound write-ahead record that preserves the exact inode, source,
target, mode, and phase. Planned removals use a deterministic private
quarantine and the same recovery record. Completed inspection also verifies
the immutable first owner confirmation, every bounded retry confirmation, and
the final receipt attribution.

Planning and every retry use the same fatal canonical task-manifest validator
as completed inspection. Before any cutover mutation, local filesystem and
same-device admission covers the exact write-ahead file and every deterministic
artifact, archive, authorization, quarantine, and supersede evidence path, not
only their roots. The supersede receipt also preserves the exact raw owner
confirmation plus its raw and canonical digests and validation time.

The outcome ledger uses schema version 3. Every entry is bound to a canonical
control task and an authenticated task transition. Accepted states are `merged`,
`installed`, `verified_effective`, `verified_neutral`, `regressed`,
`inconclusive`, `governance_blocked`, `superseded`, and
`implementation_failed`.

`merged` does not mean the fix worked. A verifier records the observed effect
after installation and a valid evidence window. `verified_effective`,
`verified_neutral`, and `regressed` require the metric name, before value, after
value, and unit. Every verification state requires the installed build and
evidence window end.

Raw soak and canary analysis may still report `inconclusive` when identity is
missing or mixed, the window is empty, or capture is broken. Those results stay
as preserved analytical evidence. A lifecycle `inconclusive` is recordable only
for a nonempty window attributable to the task's canonical installed build with
a complete composite fingerprint. Otherwise the task stays in `soaking` while
collection is repaired and retried.

Every lifecycle outcome and every measured soak baseline requires at least six
credited app-alive hours. Baseline matching compares credited app-alive
duration within the inclusive 0.8 to 1.25 ratio. It does not use wall duration
as a proxy for exposure.

```bash
RAW_VERDICT=/absolute/path/to/soak-verdict.json
BASELINE=/absolute/path/to/prior-raw-soak-verdict.json
VERDICT=/absolute/path/to/outcome-verdict.json
node scripts/build-outcome-verdict.mjs \
  --soak-verdict "$RAW_VERDICT" \
  --task-id <task-id> \
  --outcome verified_effective \
  --metric <metric-id> \
  --baseline-reference "$BASELINE" \
  --out "$VERDICT"

node scripts/record-outcome.mjs \
  --id <task-id> \
  --task-id <task-id> \
  --kind stability \
  --status verified_effective \
  --evidence-window-end <iso-timestamp> \
  --actor freed-release-verifier \
  --lease-name release-verifier \
  --evidence-digest "$(shasum -a 256 "$VERDICT" | awk '{print $1}')" \
  --verdict-reference "$VERDICT"
```

`soak-assert.mjs` produces the raw evidence verdict. It is not itself a
lifecycle outcome. `build-outcome-verdict.mjs` checks the raw verdict status,
source health, attributable build, evidence window, and fingerprint. It
rebuilds both raw soak verdicts from their stored collector artifacts, selects
the metric's checked-in registry contract, and derives before, after, unit,
direction, and tolerance. `record-outcome.mjs` rejects caller-supplied effect
values and accepts only that generated contract.

Guardrails declared by the selected registry metric are automatic. The
worker-init metric always carries `app-memory-pressure-p95` as a 128 MiB
non-regression guardrail. The caller cannot omit or replace it with another
flag.

The same converter accepts `--canary-verdict <canary-record.json>`. For a
measured canary outcome, it derives before and after values from the selected
registered comparison metric and validates the comparison limit against the
metric registry. A canary pass can record `verified_neutral`, not
`verified_effective`. A raw canary schema version 3 record is never passed
directly to the outcome writer.

The canonical task must already be in `soaking`, or already at the exact outcome
during an idempotent retry, before a verifier records a verification state. A
missing task or invalid lifecycle transition is rejected before the ledger
changes.

The `installed` transition records one immutable identity object containing
version, full commit SHA, channel, and an optional artifact digest. Verification
must match the first three fields exactly, plus the artifact digest whenever it
was recorded. A matching version string alone is not enough.

The planner suppresses only the exact task ID whose latest result is
`verified_effective` or `superseded`, and only while no newer evidence exists.
A `governance_blocked` result makes the exact candidate nonmodifiable until
authority or evidence changes. Similar tasks are not treated as completed by
association. Freshness compares evidence-window end timestamps, not the later
time at which someone recorded the outcome. Successful outcomes do not raise
the score of unrelated tasks in the same category.

Each trusted ledger entry is paired with an `outcome_recorded` control event.
The event binds the actor, canonical lease, ledger path, evidence reference, and
digest of the complete outcome entry. Replayed, unsigned, or mismatched lines
remain visible in `rejectedEntries` and cannot suppress work.

Every newly recorded lifecycle outcome uses a durable reservation, including
`merged` and `installed`. The reservation carries `outcomeRequired: true` and
blocks later task mutation until the matching control event, ledger row, and
finalization event are durable. A retry reuses the same reservation and cannot
duplicate any of those records. Historical ordinary outcomes with an already
complete authenticated transition, event, and ledger row remain trusted when
their transition predates this flag. New recording never attaches to that old
transition. Same-state legacy backfill creates a new reservation that names the
one historical transition and keeps the lifecycle state unchanged.

`freed-owner` recording uses one composite `outcome.record` plan. The read-only
plan binds the complete normalized source task, exact transition or legacy
backfill route, frozen ledger-row timestamp, complete evidence-backed row, and
row digest. Preserve the plan as a private mode `0600` file before acquiring
the exact owner lease. Apply derives every mutation field from that file,
accepts the token only through `FREED_AUTOMATION_LEASE_TOKEN`, and reauthorizes
each guarded step against the same intent. A crash retry uses the unchanged
plan and may use a newly acquired lease for that exact digest.

### Repairing rejected outcome history

Normal outcome recording never promotes an unsigned historical line. If
rejected legacy lines make `outcomes.jsonl` unhealthy, the owner-governed
history repair contract can preserve already trusted raw lines and quarantine
rejected raw lines without editing, reserializing, or re-signing either set.
The immutable, content-addressed artifacts contain the complete source bytes,
the exact retained and rejected bytes, a decision for every physical line in
occurrence order, and the final receipt.

The repair intent binds the existing canonical task ID, fixed policy version,
canonical ledger path, source digest, source size, physical line count, exact
append-only control-event history prefix digest and byte size, expected trusted
and rejected counts, replacement digest and size, and the archive, decision,
and receipt digests. Task state and revision in the plan are informational.
They are not signed because lifecycle state does not grant this mutation. Live
mutation requires an exact `freed-owner` `owner-governance` lease for that
intent. A broad instruction, an automation lease, or a valid repair plan alone
does not authorize the replacement.

Planning occurs before owner lease acquisition. The acquisition event is an
expected suffix after the immutable planned prefix. Do not replan for that
suffix. Under the outcome writer lock, the current full event history must
remain healthy and must reproduce the same per-line decisions and exact trusted
and rejected raw byte streams.

Repair and ordinary append share `outcomes.jsonl.writer-lock`. Owner authority
is rechecked after acquiring that lock, after owned temp cleanup, immediately
before archive and ledger mutation, and inside the audit-event guard. Expiry
while waiting leaves new archives and the audit event untouched. A retry needs
a fresh lease for the same intent. There is no standalone audit-event append.
The synchronous finalization guard revalidates the exact transaction, every
prepared archive, and the canonical replacement before it can append, then
requires the transaction to be durably `audited` before releasing the event
guard. The immutable source archive is reclassified against the current full
event history even when recovery starts after canonical replacement.
`prepared` means source, retained, rejected, and decision artifacts plus the
transaction are durable, while the receipt may still be absent. `replaced`
means the canonical-ledger rename and directory sync are durable. `audited`
means exactly one deterministic reserved
`outcome_history_repaired` control event is durable. `complete` is written only
after the receipt, current ledger, immutable archives, and audit event verify.

Recovery performs only missing phases and returns the same receipt for an exact
retry. It refuses source drift, bound event-prefix drift, unhealthy current
history, a busy writer, malformed or unsafe input, conflicting artifacts, a
conflicting audit event, or a changed post-repair ledger. Every completed
transaction is reverified during normal ledger health checks. Any missing or
corrupt archive, receipt, or audit event makes the source unhealthy again. Any
transaction that has not reached `complete` also keeps the outcome source
unhealthy. The nightly planner therefore keeps the behavior slot closed until
recovery proves the replacement, audit event, and receipt as one idempotent
operation.

The supported owner-run sequence is:

1. Run `npm run --silent automation:repair-outcome-ledger -- plan` with the
   exact task ID and source digest.
2. Create one private mode `0600` current-task confirmation from
   `result.intent` and `result.intentDigest`.
3. Acquire `freed-owner` lease `owner-governance` for that exact digest.
4. Set only `FREED_AUTOMATION_LEASE_TOKEN` and run the dedicated `repair`
   command with the same task and source digest.
5. Release the owner lease after success or failure.

## Safety Gates

The runner excludes provider-visible tasks by default. Provider-visible peer worktrees are still pulled into the evidence queue so they cannot hide in the local swarm. Do not allow autonomous changes that alter authenticated WebView loads, provider navigation, provider API call frequency, scripted scrolling, cookies, headers, or scraping timing without explicit approval.

Provider approval is scoped evidence, not a general instruction to "proceed
with everything." Human work records Gate 1 in a healthy provider risk review
artifact and publishes as a draft with that artifact. The helper posts a GitHub
review comment bound to the artifact, provider-visible path set, and
provider-only binary diff. A CODEOWNER thumbs-up reaction on that exact,
unedited comment authorizes the ready transition. Provider-visible edits or a
changed Gate 1 artifact require a new reaction. Unrelated branch edits do not.
A signed control-task approval remains available for unattended publication
and must bind the same provider-only fingerprint.

Release work is also gated. A dev build should ship only after actual fixes merge into `dev`, not after planning artifacts alone.

Installed-build soaks and provider sync triggers follow the canonical contract in [SOAK-AND-TRIGGERS.md](SOAK-AND-TRIGGERS.md). Use terminal-driven evidence only: `open -g`, logs, `runtime-health.jsonl`, and `node scripts/dev-sync-trigger.mjs <provider>` with its existing gate, expiry, and locked-machine spacing. An overnight run does not stall for a routine local click. Ask with a 10 minute response window, then continue only within authority already granted. A timeout never authorizes provider traffic, authentication, external posting, deployment, destructive state changes, or a new behavior. Generated task prompts, execution plans, closeout notes, and morning reports must name the terminal command they expect, identify the missing trigger to build, or state the bounded timeout path without treating it as new authority.

Every execution phase has a stop gate. The runner should stop rather than freestyle when evidence is missing, a peer branch is still changing, a provider-visible change needs approval, focused validation fails, or no real fix landed. The preflight risk snapshot is now also a selectable target, so blocker risks like a dirty current worktree or a non-dev checkout can win the queue before the runner starts editing. Missing root dependencies stay visible in preflight, but they are a bootstrap warning instead of a queue-jumping blocker, because bug scanning comes first and dependency install is only required once a chosen fix reaches validation. By default the planner expects to run from `dev`; use `--repo` for the intended dev worktree or `--no-expected-branch` only for deliberate diagnostics. If the active soak pointer is empty, the runner falls back to the newest readable soak and records that fallback in the risk snapshot. When the fix is purely local, `--repair-soak-pointer` can update the active pointer to that readable soak so later runs no longer start from a dead evidence path. Performance targets need at least three fresh soak samples, so a single stale heartbeat can inform the report without pretending to be a real budget miss. Preflight actions label each remediation as a safe local command, manual review, or automation-tool action before an overnight agent touches it.

## Next improvements

- Reconcile the saved local automation overlays against checked-in specs and report drift without rewriting model choices blindly.
- Let duplicate-work findings assign an owner automatically when one branch already has passing validation.
- Promote more preflight risk fixes into automatic cleanup steps when the remediation is unambiguous and local only.
- Turn recurring failure signatures into reusable focused test recipes.
- Add a safe build, install, identity, cold-launch, soak, and restore harness before enabling runtime bisect execution.
