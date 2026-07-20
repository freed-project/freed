# Automation Control Plane

Freed's continuous agents share one durable control plane. Evidence collectors,
planners, executors, release verifiers, and scaffolding maintainers have separate
authority. They coordinate through versioned state under
`~/.freed/automation/`, not through chat history, roadmap prose, or a temporary
directory.

This is coordination substrate. It does not grant an automation permission to
change product behavior, contact a provider, merge owner-review work, or ship a
release.

## Sources of truth

| Source                                                     | Purpose                                                                                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automation/specs/*.json`                                  | Checked-in automation identity, authority, provider policy, prompt path, soak limit, allowed local overlay fields, and required host handoff capabilities |
| `automation/prompts/*.md`                                  | Checked-in behavioral contract for each automation                                                                                                        |
| `.github/rulesets/*.json`                                  | Checked-in dev, main, and www PR governance, plus split release-tag creation and no-bypass immutability policies                                          |
| `~/.freed/automation/control/current-tasks.json`           | Atomic current task state                                                                                                                                 |
| `~/.freed/automation/control/task-transactions/`           | Recoverable write-ahead records that bind each task revision to its audit event                                                                           |
| `~/.freed/automation/control/outcome-ledger-transactions/` | Recoverable owner-governed outcome history repairs                                                                                                        |
| `~/.freed/automation/control/events.jsonl`                 | Append-only audit history for task, authority, lease, and observer events                                                                                 |
| `~/.freed/automation/control/kernel-guard-cutover.json`    | Durable activation receipt for the old-compatible permanent kernel guard set                                                                              |
| `~/.freed/automation/control/leases/`                      | Token-bound leases that prevent duplicate writers                                                                                                         |
| `~/.freed/automation/control/actor-credentials/`           | Legacy general actor migration records plus separate publisher public-key records; not current general actor authority                                    |
| `~/.freed/automation/control/owner-capabilities/`          | Broker-signed one-use owner governance capabilities, split into pending and consumed records                                                              |
| `~/.freed/automation/outcomes.jsonl`                       | Versioned merge, install, and observed-effect outcomes                                                                                                    |
| `~/.freed/automation/artifacts/outcome-ledger-repair/`     | Content-addressed raw history, per-line decisions, retained entries, rejected entries, and completion receipts                                            |
| `~/.freed/automation/artifacts/kernel-guard-cutover/`      | Immutable pre-cutover lock bytes, transaction material, and owner-approved cutover receipts                                                               |
| `~/.freed/automation/soaks/`                               | Installed-build evidence windows and verdicts                                                                                                             |
| `docs/roadmap-status.json`                                 | Structured phase status used to validate roadmap truth                                                                                                    |

The default state root can be replaced with `FREED_AUTOMATION_STATE_ROOT` or the
CLI `--state-root` option. Repository automation specifications intentionally do
not invent machine-local schedules, models, targets, or working directories for
actors that are not installed. They declare an exact kind-specific set of
`localOverlayFields` a host reconciler may supply, plus the canonical lease name
and its 30 minute maximum lifetime. Cron actors require status,
schedule, model, reasoning effort, execution environment, project target, and
working directories. Heartbeat actors require status, schedule, thread
destination, and thread target. `rrule` and `cadence` are aliases, but a contract
must choose one. The repository validator rejects unknown, duplicate, extra, or
incomplete overlay contracts.

Run `npm run validate:host-automations` for the read-only host comparison. It
validates each installed actor's ID, kind, name, prompt, RRULE or cadence, and
kind-specific target fields. Cron models must appear as visible models in the
current Codex model catalog at `$CODEX_HOME/models_cache.json`. The catalog may
be at most 24 hours old and no more than 5 minutes in the future. The saved
reasoning effort must be advertised by that model. The accepted host recurrence
forms are the forms currently emitted by Codex: hourly, daily, and weekly for
cron actors, and minutely for heartbeat actors. Cron targets must resolve to
the canonical Freed repository, and `cwds` may contain only that physical
project root. Codex may persist `target.project_id` as either an absolute root
or a `local-*` project reference. For a local project reference, the validator
reads only the current `$CODEX_HOME/.codex-global-state.json` `local-projects`
entry. It requires exact key and embedded ID equality, exactly one absolute
`rootPaths` entry, the deterministic local ID derived from the canonical root,
one project claimant for that root, and the same sole canonical `cwds` root
before applying the existing realpath, Git worktree, and canonical origin
checks. It reads a bounded, current-user-owned regular file that is not group
or world writable, without following symlinks. It does not use a backup
registry or a selected-project hint. A `pr-only` or `merge-safe` actor must use
worktree execution.
Guessed model names, alternate repositories, extra working directories,
self-expiring schedules, and unsupported execution modes are drift.

Every actor specification also requires `trusted-launcher` and
`short-lived-lease-handoff`. Readiness means all of these are present:

1. A schema 4 root-owned immutable launcher binding at
   `/Library/Application Support/Freed/automation-actor-launchers/<actor>.json`.
2. The root-owned launcher executable and exact SHA-256 digest named by that
   binding.
3. Root-owned pinned copies of Node, `automation-control.mjs`,
   `automation-actor-control.mjs`, `lib/automation-control.mjs`,
   `lib/automation-actor-readiness.mjs`, the kernel guard contract, the outcome
   repair contract, and the lease archive helper under one content-addressed
   runtime directory.
4. A binding handoff of `trusted-launcher-channel-to-canonical-lease`.
5. A successful nonmutating `freed-actor-launcher-readiness-v3` attestation
   through `freed-actor-launcher-channel-v1`.

The five general actors store no persistent credential in Keychain or in the
automation state directory. The launcher creates a fresh operation ID and 32
random bytes for each acquisition before it starts Node. The raw lease token is
sent only through the one-use file descriptor 3 channel. It never appears in a
process argument, environment variable, log, public binding, or readiness
result. The native verifier binds the action, actor, canonical state root,
lease, operation ID, token digest, lifetime, launcher and control process start
identities, launcher digest, runtime digest, and random challenge into one
session digest before the control process may acquire a lease.

`automation:actors verify` validates the complete public binding and every
runtime pin, then invokes the exact installed launcher for a live nonmutating
channel attestation. It reads no Keychain item and writes no host file. An
ACTIVE actor fails closed on overlay, binding, runtime, process identity,
challenge, or attestation drift. A missing actor remains safely PAUSED and is
reported as reconciliation drift. Reconcile saved actors through the Codex host
automation controls, never by editing `automation.toml` directly.

### Owner provisioning for general actors

Provision the five general actors only from a clean `dev` checkout whose HEAD
matches local `origin/dev`. The helper refuses `freed-owner` and
`freed-pr-publisher`. Run:

```bash
npm run automation:actors -- provision --all
npm run automation:actors -- verify --all
npm run automation:actors -- accept-host --all
npm run validate:host-automations
```

The build helper produces two native programs. The normal actor host links
CryptoKit and has no Security framework or Keychain API dependency. The second
program links Security only for one bounded migration from the installed schema
1 contract. Provisioning validates the real root-owned legacy binding, deletes
the fixed `freed-automation-actor` Keychain item with interaction disabled,
removes the matching owner digest record when present, and then installs schema
4. Migration tolerates all four item and digest-record presence combinations,
so an exact retry completes safely after response loss. Fresh installs and
schema 4 replacements never invoke the migration program. Provision and rotate
are rejected by the migration program.

Legacy Keychain deletion is irreversible. If a later replacement step fails,
rollback may restore the old public binding, but it never fabricates a digest
record or credential. That old binding then fails closed. Rerun the same
`provision` command to finish the idempotent migration and install schema 4.
Each migration invocation has a 120 second outer ceiling, ignored input, a
scrubbed environment, and a hard kill at the deadline.

`accept-host` is the owner-run real-host gate. It attests all five launchers,
acquires each canonical lease, heartbeats it, releases it, and attests the final
launcher identity before reporting success. It returns no lease token. The
command creates no task, grants no task or provider authority, activates no
saved actor, and contacts no provider.

Native acquisition has one 65 second budget and the caller has a 75 second
outer ceiling. The launcher generates and retains the operation ID and token
across response loss. Once acquisition may have committed, cleanup uses two
exact release attempts and two absence inspections. Cancellation kills and
reaps the child process group, performs the same exact cleanup, and emits no
handoff. The final signal-safe handoff has one commit point. A nonzero or
malformed result is bounded-parsed by the caller, and any plausible retained
lease is released and proven absent before failure is returned.

General actor leases have a 30 minute absolute lifetime. Heartbeats cannot
extend them past that limit. Public lease acquisition always rejects a general
actor, even if a retired persistent actor token is supplied. Legacy
`persistent-actor` leases remain readable only so an already-issued lease can
heartbeat or release during migration. They cannot authorize a new lease.

This is a cooperative same-user boundary. The channel proves the installed
launcher, pinned runtime, live process chain, one-use challenge, exact operation
ID, and token digest. It does not authenticate which same-user saved automation
invoked a launcher. Stored task authority, provider approval, the global
behavior slot, owner governance, publisher isolation, and GitHub review gates
still apply.

Current actor lifecycle commands are:

```bash
npm run automation:actors -- provision --actor freed-nightly-runner
npm run automation:actors -- revoke --actor freed-nightly-runner
npm run automation:actors -- verify --actor freed-nightly-runner
npm run automation:actors -- acquire --actor freed-nightly-runner
```

`rotate` is removed because there is no general actor credential to rotate.
Provision, verify, acquire, revoke, and `accept-host` are noninteractive. A
Keychain prompt from any of them is a migration failure, not an installation
step to approve. Keep every saved actor paused until `verify --all`,
`accept-host --all`, and `validate:host-automations` pass on the real host.
Provisioning grants no provider traffic and no task authority.

## Atomic current task manifest

`current-tasks.json` is the current-state authority. It has a schema version,
manifest revision, update timestamp, and a stable sorted array of tasks. Each
task has its own revision, stable task ID, state, timestamps, execution
authority, provider authority, and JSON details.

Task writes use this sequence:

1. Acquire the persistent kernel-backed guard for task state.
2. Recover any prepared transaction left by an interrupted writer.
3. Read and validate the current manifest.
4. Reject a stale `expectedRevision` when the caller supplied one.
5. Write and sync a transaction containing the complete target manifest and its stable event ID.
6. Atomically replace `current-tasks.json` and sync its containing directory.
7. Append and sync the matching task event.
8. Remove the completed transaction and sync the transaction directory.

The manifest is never updated in place. A reader sees either the prior complete
revision or the next complete revision. Every task read and mutation first
recovers prepared transactions. Recovery applies a missing manifest revision,
appends a missing event, and deduplicates an event that was already synced by
its stable event ID. A failed caller can therefore leave prepared work, but it
cannot leave an unexplained task revision permanently. Use
`scripts/automation-control.mjs` instead of editing the JSON manually.

### Generic authority file protocol

Generic automation authority files use the pinned helper's
`freed-authority-file-operation-v1` protocol. A publication admits the
canonical file and its parent through held descriptors, then creates or
recovers at most one mode `0600` staging generation for that canonical
basename. Targeted reads use `authority-entry-inventory` through the held
parent descriptor before and after the exact byte read. The path-opened file
must be the same device and inode, retain every admitted metadata field, and
match the descriptor-proved digest. Bulk retirement admission uses
`authority-retirement-inventory` through the held retirement-directory
descriptor and requires two stable sorted scans. A path listing or a
same-content path is never sufficient authority.

`authority-stage-create` creates a new provisional stage exclusively.
`authority-stage-rewrite` may complete an interrupted provisional stage only
through the same held inode. Its exact name is
`.<basename>.authority.<namespaceDigest>.staging`. Once complete, an exclusive
rename binds the proposed inode to
`.<basename>.authority.<namespaceDigest>.<successorStableDigest>.tmp`. A
replacement commits with `authority-exchange`, an atomic swap that leaves the
exact predecessor at that ready name while the proposed generation becomes
canonical. A create into a missing canonical name uses `authority-retire` as
an exclusive rename. Every operation syncs and verifies the affected
directories before reporting success.

The version 3 staging namespace binds the canonical path, caller-owned
operation ID, proposed content digest, full predecessor generation, and
admitted parent generation. The full predecessor identity contains device,
inode, mode, link count, user ID, group ID, size, modification time, change
time, and SHA-256 content digest. The parent identity contains device, inode,
mode, and user ID. The ready name adds a stable successor digest containing
device, inode, mode, link count, user ID, group ID, size, modification time,
and content digest. It intentionally excludes change time because a native
rename changes that timestamp without changing the file generation. Content
equality alone never authorizes recovery. A same-content file on a different
inode is a foreign generation and fails closed. A changed parent generation
also fails closed.

A replacement can recover after response loss because the ready name retains
the exact predecessor while the canonical entry retains the exact successor.
A create-only rename consumes its only ready-name inode witness. A new process
therefore never infers create-only success from canonical bytes alone. The
higher-level write-ahead transaction or deterministic event recovery must
reconcile that completed create. Same-process recovery may use the still-held
staged identity.

Canonical removal and the quarantine of partial or unproven stages use
`authority-retire`. It moves only the exact held source generation with an
exclusive native rename, never an unlink or an overwrite. Retired generations
remain under the source directory's private mode `0700`
`.authority-retirements/` directory. Before each retirement, the control plane
uses a held-directory bounded listing and an exact rescan. The hard limits are
100,000 entries and 4,294,967,296 total bytes. The local filesystem must retain
at least 1,073,741,824 free bytes after reserving the incoming generation.
Crossing any bound fails before mutation. Cleanup of this retained authority
history requires a separate owner-governed lifecycle. A retry first proves an
already completed exact retirement and returns it without requiring new
capacity or filesystem headroom. If the source is missing and no retirement
directory already exists, recovery fails closed without creating that
directory. The retained history is deliberately bounded, not infinitely
live. Reaching 100,000 entries or 4,294,967,296 bytes pauses new retirements
until that separate cleanup lifecycle runs.

Task transaction recovery recognizes one crash-stranded pre-WAL stage per
canonical transaction name. A complete, digest-matching, schema-valid stage is
promoted to the canonical write-ahead record and normal transaction recovery
continues. A partial, malformed, or otherwise unprovable stage is preserved by
exact-generation retirement, after which later task mutation can proceed. A
second stage, a mismatched namespace, or a canonical transaction beside its
stage fails closed.

The generic authority publication path may call only
`authority-stage-create`, `authority-stage-rewrite`, `authority-exchange`, and
`authority-retire`. It must not call the helper's legacy `replace-durable` or
`remove-durable` operations. Those operations cannot preserve a foreign
generation swapped into the final validation window.

When `writeJsonAtomic` receives an admitted expected snapshot, it performs no
directory creation or permission repair before proving that exact snapshot.
The filesystem protocol protects cooperative production writers and crash
recovery. It does not claim to defend against a separate, continuously hostile
process running as the same user, which can mutate the user's files outside
the protocol. Production writers rely on the kernel and filesystem guards to
exclude one another before entering this protocol.

### Kernel guard cutover

Task, event, and outcome writers use one durable, old-compatible kernel-lock
cutover. macOS uses `/usr/bin/lockf`. Linux uses `/usr/bin/flock`. Task, event,
and lease guards retain the historical mode `0700` directory shape. Each
directory contains an exact mode `0600` `owner.json` sentinel and a permanent
mode `0600` `kernel.lock`. The outcome writer keeps the historical
`outcomes.jsonl.writer-lock` pathname as a permanent mode `0600` sentinel and
kernel-lock inode. Every sentinel records PID 1 as live under the old protocol,
so an older Freed control process cannot age-take over, rename, or unlink it.
PID 1 is only a compatibility sentinel. It is not the current lock owner. The
new protocol locks only the permanent kernel inode and never renames or unlinks
any sentinel path.

Process exit, including `SIGKILL`, releases the kernel lock while leaving every
sentinel byte and inode intact. New writers refuse all control mutation until
`control/kernel-guard-cutover.json` verifies the complete sentinel set and the
exact `freed-kernel-guard-cutover-v1` receipt. Missing, empty, partial, legacy,
or malformed paths fail closed. Bridge-only and cutover-only writers cannot run
together because there is no bridge mode after that receipt becomes current.
The contract requires a local filesystem whose `/usr/bin/lockf` or
`/usr/bin/flock` semantics apply to every contender. Network or otherwise
distributed filesystems are unsupported and fail host admission. Runtime
revalidates the exact receipt, canonical directory ancestry, owner, mode, link
count, marker bytes, and locked inode for every operation. A prior doctor run
is never used as mutation authority.

The one-time rollout is an explicit quiescent owner operation. All five saved
actors must be `PAUSED`, every canonical lease must be absent, no older control
process may be alive, and every source byte named by the read-only plan must
remain unchanged. The migration uses one exact private current-task owner
confirmation directly because acquiring the owner-governance lease itself
depends on the guard protocol being installed. This bootstrap exception applies
only to `automation-guard.cutover`. Normal owner operations return to exact
short-lived leases after the cutover receipt is durable.

Plan the cutover without mutation:

```bash
npm run --silent automation:cutover-kernel-guards -- plan \
  --task-id "$TASK_ID" \
  --plan-file "$PLAN_FILE"
```

The complete plan has one 32 MiB aggregate byte limit. Planning, private plan
storage, plan loading, continuous receipt inspection, and strict doctor use the
same limit. Planning fails read-only if the source snapshot would produce a
plan that any later reader must reject.

Create one private mode `0600` current-task owner confirmation from the exact
reported intent and digest. Then apply the same immutable plan:

```bash
npm run --silent automation:cutover-kernel-guards -- apply \
  --plan-file "$PLAN_FILE" \
  --owner-confirmation-file "$CONFIRMATION_FILE"
```

The migration archives prior lock bytes, prepares complete sentinels before
publishing them, syncs every file and parent directory, writes a durable
transaction and artifact receipt, and publishes the global receipt last. The
permanent mode `0600` bootstrap lock is on the same admitted local filesystem,
contains the exact PID 1 compatibility marker, and is part of completed
receipt inspection. A partial run stays inactive and can resume idempotently
from the same plan.

Planning and every retry validate the full canonical task manifest with fatal
UTF-8 decoding and the same task schema used by completed receipt inspection.
A matching task ID inside a malformed manifest is not sufficient. Before the
first state mutation, the executor also checks the exact write-ahead path and
every deterministic cutover artifact, archive, authorization, quarantine, and
supersede evidence path against the local filesystem and same-device contract.
It repeats that exact admission before receipt activation or supersede
retirement.

Every in-place legacy claim, marker conversion, and pre-marker restoration is
preceded by one durable write-ahead record. That record binds the exact device,
inode, source bytes, target bytes, mode, operation, and phase before the first
canonical write. Recovery accepts only the exact source, exact target, or the
bounded target-prefix state produced by an interrupted write on that same
inode. Transaction and write-ahead publication use the pinned
`scripts/lib/lease-archive-move.py` helper's `rename-durable` and
`exchange-durable` operations. Exact files and directory generations retired by
cutover or supersede move with native exclusive rename into
`<stateRoot>/control/.kernel-guard-cutover-retired/<cutoverId>/...`. They remain
retained and are never deleted by successful execution or recovery. Recovery
validates the exact retired generations and journal state before advancing. Any
unbound occurrence fails closed.

The first validated owner confirmation is copied into an immutable private
authorization artifact before the prepared transaction is published. Each
later validated retry keeps its own exact raw confirmation evidence and appends
its identity to the bounded transaction history. The completed receipt names
the final authorization used to activate the cutover. Runtime and strict doctor
verify the raw confirmation digests, the first-authorization artifact, the
bounded history, and the final receipt attribution. Private plan, transaction,
authorization, receipt, and journal files are admitted through one descriptor
with exact mode `0600`, owner, link count, inode, canonical path, and post-read
identity checks.

Immediately before the transaction advances to `receipt-prepared`, the
executor revalidates the exact owner confirmation and records it as the last
transaction authorization. The transaction records `completedAt` at that
authorization commit, and the confirmation must still be live at that exact
time. The executor writes and syncs the `receipt-prepared` transaction before
it writes either the immutable receipt artifact or the global activation
receipt. A verified `receipt-prepared` transaction is terminal write-ahead
authority. Recovery branches on that phase before asking for another owner
confirmation, revalidates the plan, transaction, archives, permanent markers,
quiescence, and protected source, then finishes only the missing receipt writes.
It may therefore finish after the source confirmation file is absent or its
time window has expired. It cannot replace the committed authorization,
re-enter an earlier mutation phase, or accept inconsistent evidence.

Protected source or exact `dev` identity may legitimately change after a
transaction is prepared. Before any permanent writer, owner, or inner marker
exists, create a separate read-only supersede plan:

```bash
npm run --silent automation:cutover-kernel-guards -- plan-supersede \
  --plan-file "$PLAN_FILE" \
  --supersede-plan-file "$SUPERSEDE_PLAN_FILE"
```

Create a new private mode `0600` current-task owner confirmation from that
supersede intent. Then restore the exact planned legacy paths, preserve the old
plan, transaction, archives, and superseded receipt, and retire only the
canonical prepared transaction:

```bash
npm run --silent automation:cutover-kernel-guards -- supersede \
  --plan-file "$PLAN_FILE" \
  --supersede-plan-file "$SUPERSEDE_PLAN_FILE" \
  --owner-confirmation-file "$SUPERSEDE_CONFIRMATION_FILE"
```

Supersede requires the same quiescence proof as apply. It binds the exact old
plan, transaction, claim generations, archive identities, and current canonical
task. It is allowed only in `prepared` or `claims-installed`. Once any permanent
writer or canonical guard marker exists, supersede fails closed and only the
same cutover plan may resume. The bootstrap lock remains permanent. Run
`node scripts/doctor.mjs --strict` after apply. Never remove the permanent
writer marker, bootstrap lock, guard directories, owner sentinels, inner lock
files, completed cutover transaction, archive, or receipt.

The immutable supersede receipt preserves the exact raw owner confirmation,
its raw and canonical digests, canonical source path, and validation time. A
retry may use a fresh live confirmation, but it cannot rewrite the authority
evidence already bound to a durable supersede receipt. If the canonical
transaction was already retired and the caller lost the response, a read-only
retry may recover the completed receipt without another live confirmation or
an unchanged task. That terminal recovery requires the exact bootstrap marker,
no transaction or write-ahead residue, the preserved superseded transaction,
the durable receipt, and the complete restored source snapshot with every
relative path still intact. Any ambiguous temporary file, renamed source
entry, or incomplete retirement fails closed and must be reconciled through
the original operation. A supersede-scoped write-ahead temporary may recover
only under a live owner confirmation, the exact preserved supersede plan, and
the same journal generation. Completed response recovery never admits one.

The successful task path is:

```text
observed -> triaged -> approved_for_pr -> implemented -> validated -> merged
         -> installed -> soaking -> verified_effective | verified_neutral
                                      | regressed | inconclusive
```

`verified_neutral` and `regressed` may return to `triaged` when another bounded
attempt is justified. `inconclusive` may return to `soaking` for a valid new
evidence window or to `triaged` when the task itself needs revision. These are
explicit transitions. A task cannot skip from implementation to effectiveness.

Stored task authority is a lifecycle ceiling, separate from the authority of
the actor holding a lease:

| Task authority | Furthest mutable lifecycle stage                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observe-only` | Product and external state stay read-only; local evidence, observed tasks, control events, and later verification verdicts are allowed by the actor policy |
| `plan-only`    | Triage, PR approval planning, governance blocking, supersession, and closure                                                                               |
| `pr-only`      | Implementation and validation in a PR, but not merge                                                                                                       |
| `merge-safe`   | Merge, install, and soak handoff under existing governance                                                                                                 |

Both checks must pass. The actor policy must allow the requested destination,
and the stored task ceiling must be high enough for it. An `observe-only` task
created by the runtime observer must receive an explicit owner authority update
before the controller can triage it. A more powerful actor cannot silently
promote a lower-authority task by transitioning it.

Exceptional state is explicit too. Eligible active states may transition to
`governance_blocked` or `superseded`. An implementation can transition to
`implementation_failed`. A blocked or failed task may return to `triaged` only
when the authority, evidence, or implementation premise has changed.
`verified_effective`, `governance_blocked`, and `superseded` may be closed only
through their allowed `closed` transition. A closed stable task ID may return
to `triaged` only when the mutation carries an `evidenceWindowEnd` later than
the task's close timestamp.

## Event log

`events.jsonl` is append-only and schema-versioned. Every event has an event ID,
timestamp, actor, type, and JSON data. Task events also carry the task ID, task
revision, manifest revision, and authority snapshot. Lease events carry the
lease name and ownership change.

Built-in event types include task creation, task transition, authority update,
lease acquisition, heartbeat, takeover, and release. Observers may append other
stable event types with the CLI. The event log explains how state changed. It
does not replace the atomic current manifest. Task transactions make manifest
and event updates recoverable as one operation. They are internal recovery
records, not a second task queue. Generic event writers cannot claim a built-in
task, lease, outcome, or repair type, or an identity in one of their
deterministic namespaces.

Every task lifecycle event and every outcome audit event is authorized by the
lease that writes it. The event timestamp must be at or after the authorizing
lease's `acquiredAt` timestamp and strictly before that lease's `expiresAt`
timestamp. A timestamp before acquisition, at expiry, or after expiry fails
closed with `lease_event_time_invalid`; a current lease cannot authorize a
historical event.
Current mutation admission also rejects a not-yet-active lease when the current
time is before `acquiredAt`, and an expired lease when the current time is at or
after `expiresAt`.

Continuous outcome health reconstructs each task's authority and immutable
behavioral classification from its exact creation and owner authority-update
events in physical order. Manifest revisions must advance exactly once across
the global physical order. Each task also carries one state, authority,
behavioral classification, revision, pending-outcome, and last-transition
cursor. A transition or outcome reservation is trusted only when it advances
that exact task cursor and matches the authority already active at that line.
Finalization is the only lifecycle event allowed to keep the same task revision,
and it must consume the exact pending reservation. Later task state cannot
retroactively authorize older history. One byte-frozen pre-hardening transition
is the sole pre-acquisition actor-credential compatibility. It is accepted only
as a closed bundle containing that exact transition, its unique deterministic
outcome event, and exactly one matching authenticated ledger row. A missing,
duplicate, UUID-substituted, or byte-drifted bundle part fails closed. No generic
orphan-event or historical outcome-transition compatibility exists. The first
physical lifecycle revision must be 1 unless that exact pinned checkpoint is
the retained history prefix.

Current `task_created` events carry one explicit boolean `behavioral` field in
their canonical event data. Continuous health compares the event-derived value
to the current task manifest. It also requires the exact task ID set in history
to equal the exact task ID set in the manifest, and requires the final global
history revision, or zero for empty history, to equal the manifest revision.
Two retained pre-field task creations and one retained orphan transition are
admitted only by their complete pinned event digests and pinned behavioral
classifications. Adding the new field to those frozen events, removing a task,
inventing a task, or changing only the manifest classification fails closed.

Credential provenance resolves through one indexed, unique, preceding lease
acquisition. Continuous history then replays exact, unique, canonical heartbeat
events in physical order. Each heartbeat must occur before the current effective
expiry and may extend authority only up to the actor's absolute lease lifetime
and any owner-confirmation expiry. Publisher acquisition is exactly 30 minutes.
Ambiguous acquisition or heartbeat identities fail closed. The complete
pre-transaction lease-event prefix is admitted only through the exact event
digests pinned from the full retained host history. The complete history fixture
is the compatibility proof. A curated subsequence is not a valid history because
omitting release events changes lease lifetime sequencing. An invented or
drifted raw UUID lease event remains invalid.

Legacy outcome reservation and direct outcome finalization use that same exact
history replay before mutating the manifest. They reject extra fields,
noncanonical identities, duplicates, broken provenance, authority drift, stale
task revisions, and wrong physical order. Another task may advance the global
manifest without invalidating an unchanged target task cursor.

## Writer leases

A mutating automation must acquire a named writer lease before it creates a
worktree, edits files, opens a pull request, merges, installs, or starts a soak.
The lease record contains:

- a caller-retained high-entropy ownership token
- owner name
- acquisition and heartbeat timestamps
- expiry and TTL
- execution authority
- provider authority

Heartbeat and release require the exact token returned by acquisition. An
active lease cannot be stolen. A caller may take over an expired, readable
lease. Takeover is recorded as an event with the previous owner data. A
recordless canonical lease directory is neither a lease nor proof that an
earlier acquisition failed. Acquisition and inspection reject it with
`lease_repair_required` before reading an external credential. It requires a
separate explicit owner-governed repair. Do not delete a lease directory to
make a second runner fit.

Read-only observers do not need a lease merely to read or ingest evidence. The
runtime observer must acquire its canonical lease before it appends a control
event or creates an `observed` task. Every other task mutation also requires the
actor's live canonical lease and secret token.

Lease `acquire`, `heartbeat`, `bind-head`, and `release` operations use one
recoverable write-ahead transaction family under `leases/.transactions/`, with
completed replay receipts under `leases/.transaction-receipts/`. The caller
creates and retains an exact operation ID for every operation. For acquisition,
the caller also creates and retains the high-entropy lease token before the
control process starts. Transaction and receipt JSON contain only the token's
SHA-256 digest. Plaintext token bytes may exist only in the canonical lease or
private mode `0700` staging needed to recover the same caller handoff.
An operation ID is either one canonical lowercase UUID version 4 or exactly 64
lowercase hexadecimal characters. The control plane does not trim, lowercase,
or otherwise repair caller input. A spelling change is a different and invalid
recovery request.

Each transaction persists the complete canonical redacted request object and
its SHA-256 digest. The deterministic audit event carries that same request
digest. The transaction also binds the operation, stable event ID and
timestamp, exact event payload, exact redacted before and after lease records,
before and after record digests, operation-specific result receipt, capability
movement, and prior takeover summary when applicable. Its durable phases are
`prepared`, `state-committed`, `event-appended`, and `complete`.
Preparation happens before capability consumption, takeover removal, or lease
mutation. Under lock order lease guard then event guard, recovery classifies
canonical state and the exact event as before, after, or conflict. It finishes
only a deterministic missing step. An unknown-token live lease is never an
acceptable recovery result.
Before state commit, recovery still proves or restores the exact credential
movement. Once the exact after-state is durable, recovery is bound to the
transaction, request digest, retained token digest, lease bytes, and audit
event. Rotating or removing the original external credential cannot strand
that already committed lease.

Every lease inspection, authority check, and mutation recovers the exact
transaction under the lease guard or fails closed while one remains pending.
An exact completed retry returns its immutable receipt when the operation ID,
request digest, and token digest match, even after a later legitimate heartbeat
or binding changed the current lease. Before returning, recovery verifies the
receipt against the exact retained before and after lease bytes and the one
canonical audit event. Event ID reuse requires complete payload equivalence. A
collision or any state, event, staging, capability, takeover, or receipt
conflict fails closed.

Every retained phase for one operation must carry the identical canonical
request object, request digest, event, state identities, and operation-specific
semantics. A complete record cannot rewrite the meaning established by an
earlier phase. The completed receipt must have the exact canonical bytes
derived from that lineage, and the archived complete write-ahead record must
bind those same receipt bytes and digest.

Continuous outcome health independently scans every completed receipt still
retained under `leases/.transaction-receipts/`. The scan is bounded, admits one
held directory generation, pins each private receipt inode, parses every sibling
with an exact canonical name, and requires exactly one byte-equivalent control
event for the receipt's deterministic event ID. It also validates the exact
retained before and after staging generations and any release-state retirement
required by completed replay. Healthy status requires the exact completed WAL
copy in the transaction cleanup archive, which binds the retained request
digest. A receipt-only crash state remains recoverable by its exact caller, but
it is reported unhealthy until that recovery retires the WAL evidence. A
malformed sibling, missing staging generation, duplicate event, missing event,
or semantically plausible event drift makes control-event health unhealthy. Any
active file or staging artifact under
`leases/.transactions/` is reported as pending and unhealthy until its exact
caller recovers it. Receipt pruning remains bounded by the cleanup policy. Once
a receipt has been deliberately retired, event-only history continues to enforce
the structural lease lifetime rules.

Typical writer flow inside an automation process, after the trusted host
launcher acquires the actor's lease and retains its token. Generate a fresh
caller-owned operation ID for each lease mutation. Reuse that operation ID and
token only when retrying the same mutation:

```bash
HEARTBEAT_OPERATION_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
FREED_AUTOMATION_LEASE_OPERATION_ID="$HEARTBEAT_OPERATION_ID" \
FREED_AUTOMATION_LEASE_TOKEN="$ACTOR_LEASE_TOKEN" \
  node scripts/automation-control.mjs lease heartbeat \
  --name nightly-writer

RELEASE_OPERATION_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
FREED_AUTOMATION_LEASE_OPERATION_ID="$RELEASE_OPERATION_ID" \
FREED_AUTOMATION_LEASE_TOKEN="$ACTOR_LEASE_TOKEN" \
  node scripts/automation-control.mjs lease release \
  --name nightly-writer
```

Each completed lease mutation retires its staging files, active transaction
record, and pruned receipts into one of two private cleanup archive
directories. Cleanup admits the full sorted plan before its first move. It
holds every source inode and every source and destination directory generation
until a final exact archive-set rescan. The pinned
`scripts/lib/lease-archive-move.py` helper runs only through
`/usr/bin/python3` in isolated mode. It uses
`renameatx_np(RENAME_EXCL)` on Darwin and
`renameat2(RENAME_NOREPLACE)` on Linux. Destination readback, absence checks,
and archive listings are relative to held directory descriptors. The
destination directory is synced before the source directory. Missing native
syscalls, directory sync, local filesystem admission, or exact readback fail
closed. Its admitted operations are `rename-durable`, `exchange-durable`,
`retire-directory-durable`, and `list-bounded`. General actor runtime schema v3
copies and digests the helper, the kernel guard contract, and the outcome ledger
repair contract beside the pinned control library. The installed control entry
must load from that content-addressed runtime without access to the source
checkout.

Before writing any new lease staging file, the control plane accounts for all
cleanup archives and computes a conservative reservation for the next
operation. The reservation includes three maximum-size transaction artifacts
plus the largest stale receipt-pruning set that one canonical lease operation
could retire. Every retained receipt is validated before it contributes to the
reservation. The operational limits are 100,000 entries, 4,294,967,296 total
bytes, an oldest age of 366 days, and at least 1,073,741,824 free bytes after
the computed reservation. Every archive entry must be one mode `0600` regular
file with one link on the same local filesystem and device as automation state.
`scripts/doctor.mjs` reports the current and projected count, bytes, oldest age,
filesystem, and free space. Crossing any limit pauses new lease staging.
Archive compaction is deliberately absent from lease mutation and doctor. It
requires a separate, owner-authorized lifecycle that preserves audit
requirements.

Lease authority is derived from the checked-in actor policy. Callers cannot
supply authority or invent actor names. Canonical pairs are
`freed-runtime-observer` with `runtime-observer`,
`freed-stability-controller` with `stability-controller`,
`freed-scaffolding-maintainer` with `scaffolding-writer`,
`freed-pr-publisher` with `pr-publisher`,
`freed-nightly-runner` with `nightly-writer`,
`freed-release-verifier` with `release-verifier`, and explicit manual
governance through `freed-owner` with `owner-governance`.

### Automation actor launcher channel

Every general actor lease starts through the installed native launcher. The
launcher generates a UUID v4 operation ID and a fresh 32 byte token, retains
both across response loss, and sends the raw token only through file descriptor
3 to the pinned actor control entry. The control entry must obtain a matching
kernel-attested response from its parent launcher before it can call the
internal acquisition path. The stable audit event is `lease:<operationId>`.
An exact retry recovers the original receipt. Reusing the operation ID with a
different token or request fails with `lease_transaction_conflict`.

No persistent actor token, `FREED_AUTOMATION_ACTOR_TOKEN`, or current general
actor credential record exists. Files under `actor-credentials` for these five
actors are schema 1 migration residue only. Provisioning removes them after the
matching legacy Keychain item is deleted. The launcher channel proves the
selected actor role and installed runtime. It does not authenticate the calling
saved automation. Any same-user process can invoke another provisioned general
role, but the resulting lease cannot expand that role's checked-in authority,
provider policy, stored task authority, or lifecycle destinations.

Release tags have a separate external trust boundary. The checked-in
`release-tag-lockdown.json` is the bootstrap authority. Apply it with
`--lock-release-tags --apply` before App provisioning. It restricts creation,
update, and deletion with no bypass. `release-tag-publisher-install.mjs prepare`
builds the fixed root-owned native host and provisioner. It installs the
schema 2 `preparing` barrier before replacing either native executable,
installs and verifies the lockdown provisioner and host, then records the exact
pair as `prepared`. The binding pins both fixed paths, both file digests, and
one digest over the native pair. An interrupted run changes no executable if
the barrier cannot land and fails closed after the barrier. This checkpoint
does not create an App, add a credential,
activate a binding, rotate a key, discard staged material, or revoke an active
item. The manifest helper fails before it opens a browser or contacts GitHub.
The production native provisioner accepts only `inspect`, `matches`, and `verify`. It rejects
`provision`, `recover`, `rotate`, `discard-recovery`, and `revoke` during action
parsing, before it admits a caller-supplied host path or reads standard input.

Migrated-machine recovery remains fail-closed. The disk PEM admission code and
isolated fake-store tests preserve the intended bounded descriptor contract,
but no production native mutation verb is compiled into the action switch. The
stable control task is `release-publisher-key-recovery-2026-07-20`.

The future recovery transaction must begin with one kernel-attested,
current-task owner confirmation. Its exact intent must bind the action, App ID
`4,296,969`, App slug `freed-release-publisher`, repository
`freed-project/freed`, expected source commit and tree, admitted key
fingerprint, both native executable paths and digests, native pair digest,
transaction ID, and exact state transition. No environment flag, shell prompt, reusable lease, or caller
assertion substitutes for that one-use authorization.

An authorized key must first enter a distinct staged Keychain service and
account tied to that pending transaction. It is not the active publisher item.
The staged key must authenticate an authoritative GitHub check that proves the
exact private organization App identity, Contents write and Metadata read only,
an empty event list, and one unsuspended selected-repository installation whose
only repository is `freed-project/freed`. Only that proof may begin promotion.

Promotion must create and verify the replacement active reference before it
retires the prior active reference. A lost response must recover by the same
transaction ID without repeating the state transition. Rotation uses this same
stage, prove, and promote transaction. Discard requires the exact pending
transaction, staged item reference, and digest. It can delete only that staged
item and can never select or delete the active credential. None of these
mutation paths is available in this checkpoint.

Activation requires an owner-reviewed change that pins the App ID in the
creation policy. The release ruleset command verifies the exact App,
installation, repository, permission, native binding, and publisher proof. It
then applies the creation and immutability policies, verifies both live, and
only then removes the lockdown. The creation policy grants the release App one
bypass. The immutability policy grants none. The full owner runbook is in
`docs/RELEASE-SECRETS.md`.

`scripts/release-publish.sh` fails closed until the live release-tag policy is
active. It also requires the release commit to equal the current protected
channel branch, validates the fixed product and promoted dev receipts, rejects
an existing local or remote tag, and delegates one exact annotated-tag creation
through the same fixed root-owned publisher binding used during activation. The
binding, parent chains, host and provisioner digests, native pair digest, App identity, Keychain credential,
selected repository, and installation permissions are rechecked immediately
before use. The native host rechecks the branch tip and receipt at publication,
then obtains and revokes one short-lived installation token. It does not accept
a user token, personal access token, general actor launcher attestation, general
actor lease token, or the separate PR publisher as a tag-creation fallback. The delayed workflow checks that the
tag commit remains in protected channel history. It does not compare against a
moving branch tip or a later dev snapshot.

The optional broker-backed PR publisher uses a separate fail-closed identity contract. It does not
accept `FREED_AUTOMATION_ACTOR_TOKEN` or
`FREED_PR_PUBLISHER_ACTOR_TOKEN`. Its persistent credential is a raw 32 byte
Ed25519 private signing key in the macOS Keychain item with service
`freed-pr-publisher` and account `freed-pr-publisher-signing-key`. Only the
signed native broker reads that key. The broker clears inherited environment
state before Keychain access, uses the key only to sign one capability, wipes
its key buffer, and never places the key or a reusable derivative in a child
environment, argument, file, shell, Node process, or GitHub command.

When that optional host profile is installed, the agent environment receives one public broker binding:

- `FREED_TRUSTED_PUBLISHER`: absolute path to the signed owner-managed broker
  outside the candidate worktree

The broker reads its public pins only from the root-owned, non-writable schema
v2 file at
`/Library/Application Support/Freed/trusted-publisher-host.json`. The exact
configuration binds the broker path, broker digest, designated Team ID and
signing identifier, control root, exact control commit, state root, trusted
launcher digest, automation control entry and library digests, publisher helper
digest, GitHub CLI path and digest, Node path and digest, and the Ed25519 public
key. The same public key must appear in the private current-user record at
`<stateRoot>/control/actor-credentials/freed-pr-publisher.json`. Candidate
input cannot choose any trust path, executable, digest, signing identity, or
public key.
`scripts/trusted-publisher-host.swift` is the native broker source and
`scripts/trusted-publisher-host-build.sh` builds a non-adhoc hardened signed
binary. Building the source does not install the broker or provision its
Keychain credential. Those remain explicit owner operations.

Before reading Keychain, the broker verifies its own hardened signature and
designated identity, its physical path and digest, root ownership and
permissions, the exact clean control commit, each downstream publisher file and
digest, the pinned Node and GitHub CLI binaries, the private state directory,
and the matching public-key record. It then derives the only permitted target
from the caller's physical worktree. The scope binds
`freed-project/freed`, worktree, branch, base lane, and the current canonical
base commit. Scope schema v2 also binds one explicit publish mode. Normal dev
and www work uses `feature-pr`. A `chore/promote-dev-to-main-*` branch uses
`production-promotion`. A `chore/release-*` branch targeting `main` uses
`production-release-prep`. Both main modes bind the exact clean head and pass
the main validation gate before the key is read. The release-prep mode passes
only when the diff is release-only metadata.

The broker writes a mode `0600` signed capability into the state root. It is
valid for 60 seconds and requests one fixed 30 minute publisher lease. The
trusted launcher starts with a scrubbed environment containing the public pins,
the capability path, one caller-retained operation ID, and the matching
short-lived lease token. The wrapper copies those two retained values into
non-exported shell variables and immediately removes them from its environment.
It exposes the token only to the pinned acquire control child until that child
returns the bound short-lived lease. The wrapper then passes that lease to the
pinned publisher helper. Validation children never receive it. The wrapper
rechecks the immutable control checkout, pinned Node and GitHub CLI, canonical
base, target scope, explicit publish mode, and the exact main head when
applicable. Automation control verifies the Ed25519 signature against the
provisioned public key, compares the exact requested scope and lifetime, and
atomically moves the capability from `pending` to `consumed`. Replay fails
closed. A nightly runner launcher attestation or lease cannot authenticate this
publisher lease.

The native broker retains the same token while the wrapper runs. It takes
synchronous ownership of `SIGINT` and `SIGTERM` before starting the wrapper. On
cancellation it kills the wrapper process group, reaps the wrapper leader,
retries one caller-owned release identity, requires confirmed lease absence,
and exits with the original signal status. The same broker cleanup runs after
normal or signaled wrapper exit. The wrapper's exit trap remains a first cleanup
layer, but broker cleanup does not depend on that trap running. The broker removes
the pending capability, clears its retained secret state, blocks both signals,
performs a preliminary kqueue drain and one final terminal drain, then keeps both
signals blocked through process exit. It never restores a handler or mask after
the terminal decision. A cancellation at the child-exit, cleanup, capability
removal, or terminal-drain boundary therefore retains the signal exit status
without reopening a late mutation or capability cleanup window.

`scripts/doctor.mjs` checks the fixed broker config, ownership and modes,
all pinned file digests, broker signature and designated identity, control
commit and cleanliness, state root, public-key record, and non-secret Keychain
item presence. It never reads the signing key. Use `--require-publisher` only
when the caller deliberately selects the optional broker profile. The native
broker repeats the trust checks at use time. Missing broker provisioning does
not block normal GitHub-authenticated publication through
`scripts/worktree-publish.sh`.

The Release Publisher is not part of that default or PR publisher profile.
`scripts/doctor.mjs --require-release-publisher` explicitly adds the fixed
release host, provisioner, binding, both executable digests, and native nonsecret
Keychain ACL inspection. The schema 2 binding and readiness attestation must
agree on both executable digests and the native pair digest. It requires exact root and wheel ownership, one link,
mode `0555` for both executables, and mode `0444` for the binding. Ordinary
development checks do not require that release-only credential. Release
preparation must select the profile on purpose.

### Publisher credential provisioning and rotation

Publisher credential installation is an owner-controlled host bootstrap
operation, not an automation task. General automation actors have no installed
credential. The publisher uses an Ed25519 key pair. Its
installer must generate the private key in native owner-controlled code, store
it with the macOS Keychain API without putting key bytes in process arguments
or environment state, verify the public-key derivation, and atomically install
the matching root-owned config plus current-user public-key record. Rotation
must restore the prior Keychain item and both public bindings if any step
fails. The `security` command with `-p`, `-w <value>`, or `-X <value>` is not an
acceptable installer because it exposes secret material in the process list.

The optional broker scheduler handoff is a trusted host boundary outside candidate worktrees.
General actors receive only the short-lived lease created through their
immutable launcher channel. Publisher handoff never exports its signing key.
Candidate work receives only the
short-lived authority it needs. The trusted publisher launcher supplies only
`FREED_PR_PUBLISHER_LEASE_TOKEN` to the pinned `worktree-publish.sh`. The
helper clears persistent and lease credentials from every child-process
environment before running Git, hooks, validators, provider checks, or GitHub
commands. The checked-in automation specifications do not install this host
component. Without it, an authorized actor may still publish through the normal
helper and the caller's existing GitHub authentication. This fallback does not
claim credential isolation. Actor leases, provider approvals, branch policy,
validation, and exact PR rechecks still apply.

The publisher lease has a fixed 30 minute absolute lifetime. Heartbeats cannot
extend it beyond that boundary. The candidate helper revalidates the live
policy-bound lease before push and immediately before every GitHub write. Each
publisher lease is scoped to `freed-project/freed`, one physical worktree, one
branch, one base lane, and the exact canonical base commit. The helper binds the
lease once to the final head commit before push. A later head, branch, base, or
worktree mismatch fails closed. GitHub commands name the repository explicitly,
and the helper verifies the pull request head after each write. The
state directory, environment cleanup, and same-user process boundaries provide
cooperative governance and auditability. They are not an operating-system
sandbox against arbitrary code already running as the same user.

To rotate the publisher credential, stop the publisher and release its live
lease when the lease token is available. Rotate the Keychain key, root public-key
pin, and private public-key record as one owner transaction. A replacement
invalidates new capabilities signed by the old key. Deletion prevents all new
acquisitions. Neither action invalidates a lease that is already active. If its
lease token is unavailable, keep the actor stopped and wait for the lease to
expire. The publisher helper requests a 30 minute lease.

When the same actor still owns an expired live-format legacy lease without
credential metadata, a trusted-launcher acquisition upgrades only that lease,
issues a new token, invalidates the old token, and appends
`lease_credential_upgraded`. Cross-actor upgrades fail closed.

### Optional signed owner capability

`freed-owner` is not an unattended automation identity and does not reuse a
general actor launcher channel or a same-user bootstrap file. A mode `0600` file
created by the current user is never owner authentication. The signed native
broker reuses the Ed25519 key pinned by the root-owned schema v2 host config.
Its owner mode requires macOS LocalAuthentication with the
`deviceOwnerAuthentication` policy. This is OS-backed user presence through an
available biometric or device credential, not a terminal prompt, typed phrase,
same-user file, or caller signature. Authorization times out after 2 minutes
and a refusal, cancellation, unavailable policy, or timeout issues no
capability. A successful check then issues one capability valid for exactly 60
seconds.

The capability binds all of these claims:

- issuer `trusted-publisher-host`, purpose `owner-governance-capability`, actor
  `freed-owner`, and lease `owner-governance`
- the canonical physical automation state root
- one stable task ID and one canonical operation-intent SHA-256 digest
- the SHA-256 digest of the generated short-lived lease token
- the requested lease lifetime, capped at 15 minutes
- issuance, expiry, and a unique capability ID

Create the operation intent from the exact mutation before asking for approval.
For a task authority update, the canonical object is:

```json
{
  "schemaVersion": 1,
  "action": "task.authorize",
  "taskId": "P1-04",
  "parameters": {
    "observerAuthority": "merge-safe",
    "providerAuthority": "approved",
    "reason": "Owner approved the reviewed provider change.",
    "approvalReference": "<exact approval packet digest or reference>",
    "expectedRevision": 1
  }
}
```

Compute the digest with the read-only command below, then invoke the installed,
signed broker manually. The broker shows the task and digest prefix in the
macOS owner authentication prompt.

```bash
node scripts/automation-control.mjs owner intent-digest \
  --intent-json '<exact canonical operation JSON>'

"$FREED_TRUSTED_PUBLISHER" owner-capability \
  --task-id P1-04 \
  --intent-digest <sha256> \
  --ttl-seconds 600
```

The broker returns only the private capability path and its short-lived lease
token. The trusted host launcher passes the token in
`FREED_OWNER_LEASE_TOKEN` and the capability, task, and digest through the
owner lease-acquire command. Automation control verifies the signature against
the fixed root-owned public-key pin, verifies every claim, and atomically moves
the capability from `pending` to `consumed`. Replay fails closed. Every owner
mutation recomputes its operation digest and rejects a different task, reason,
authority, approval reference, revision, or action. A copied owner lease token
therefore cannot authorize another governance operation.

The repository does not install the broker, root config, Keychain key, or owner
capability. Missing host trust keeps broker-backed owner acquisition closed, but
does not block normal publication. Provider work can use the signing-free
GitHub reaction path described below. GitHub records the CODEOWNER account that
made the human Gate 2 decision.

### Current-task owner confirmation

An owner may explicitly approve one exact control-plane operation in the
current task without installing the optional broker. Record that decision in a
private mode `0600` JSON file outside the repository:

```json
{
  "schemaVersion": 1,
  "kind": "owner-confirmation",
  "confirmationId": "authenticated-essay-capture-create",
  "approvedBy": "AubreyF",
  "ownerApprovalReference": "Owner approved this exact lifecycle operation in the current task.",
  "approvalSource": {
    "kind": "current-task",
    "reference": "authenticated-essay-capture-pr-642"
  },
  "taskId": "authenticated-essay-capture-pr-642",
  "intent": {
    "schemaVersion": 1,
    "action": "task.create",
    "taskId": "authenticated-essay-capture-pr-642",
    "parameters": {
      "state": "observed",
      "observerAuthority": "merge-safe",
      "providerAuthority": "approved",
      "approvalReference": "<provider approval reference>",
      "details": {
        "behavioral": true,
        "metricId": "renderer-recovery-count"
      }
    }
  },
  "intentDigest": "<canonical operation intent digest>",
  "approvedAt": "<ISO-8601 timestamp>",
  "expiresAt": "<ISO-8601 timestamp no more than seven days later>"
}
```

Compute the intent with `owner intent-digest`, then acquire the short lease:

```bash
OWNER_ACQUIRE_OPERATION_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
OWNER_LEASE_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
FREED_AUTOMATION_LEASE_OPERATION_ID="$OWNER_ACQUIRE_OPERATION_ID" \
FREED_AUTOMATION_LEASE_TOKEN="$OWNER_LEASE_TOKEN" \
  node scripts/automation-control.mjs lease acquire \
  --name owner-governance \
  --owner freed-owner \
  --ttl-seconds 600 \
  --owner-confirmation-file /absolute/path/to/confirmation.json \
  --owner-task-id authenticated-essay-capture-pr-642 \
  --owner-intent-digest <digest>
```

The caller generates and retains the short lease token before acquisition. The
command installs that exact token and returns it only as confirmation for the
same caller-owned handoff and retry. The lease is bound to the exact task and
intent. A different action, parameter, revision, or task is rejected. The
confirmation must identify `AubreyF`, cannot be future dated, must still be
live, and cannot last more than seven days. Its canonical digest, task
reference, and owner identity are copied into the lease and mutation audit
events.

This route is cooperative evidence. The JSON does not prove who wrote it, so
the current task must contain the owner's explicit decision. It does not grant
provider contact and cannot replace Gate 1, Gate 2, or exact-diff CODEOWNER
review. The signed broker remains the stronger machine-verifiable option.

## Authority model

Checked-in automation authority is one of:

- `observe-only`: collect or judge evidence without product or external mutations; authenticated local evidence and control writes remain allowed by actor policy
- `plan-only`: reconcile evidence into task state without product edits or PRs
- `pr-only`: prepare a focused PR but do not merge it
- `merge-safe`: execute and merge only work that existing governance marks safe

Provider authority is separate. `forbidden` prohibits provider activity.
`approval-required` may prepare a draft, but it cannot implement or make
provider-visible work ready without the owner's scoped Gate 1 decision and the
Gate 2 CODEOWNER reaction. A task may move to provider authority
`approved` only with an approval reference. Only the `freed-owner` lease may
change task authority. That lease can be bound to either the optional signed
owner capability or one exact current-task owner confirmation. The
confirmation file does not authenticate the owner. It records the owner's
explicit current-task decision and the canonical operation intent. The direct
provider Gate 2 route remains the CODEOWNER's GitHub thumbs-up on the generated
provider review comment, and that reaction does not itself mutate task
authority. Task authority never substitutes for the publish gate or CODEOWNER
review. Creating a task
directly with provider authority `approved` also requires an approval reference.
The current manifest retains that reference, and every task event carries the
same approval snapshot.

## Checked-in automation specifications

| Automation                     | Authority      | Provider policy     | Behavioral changes per soak |
| ------------------------------ | -------------- | ------------------- | --------------------------- |
| `freed-runtime-observer`       | `observe-only` | `forbidden`         | 0                           |
| `freed-stability-controller`   | `plan-only`    | `forbidden`         | 0                           |
| `freed-nightly-runner`         | `merge-safe`   | `approval-required` | 1                           |
| `freed-release-verifier`       | `observe-only` | `forbidden`         | 0                           |
| `freed-scaffolding-maintainer` | `pr-only`      | `forbidden`         | 0                           |

Run `npm run validate:automations` after changing a specification or prompt. The
validator checks IDs, prompt paths, authority and provider-policy parity with
the runtime actor policy, independent soak limits, recognized local overlays,
required read-only language, external posting rules for every PR-capable actor,
and known stale paths. The specification remains the reviewed intent. Exact
parity prevents the runtime copy from drifting silently.

## Branch governance

Dev, main, and www ruleset payloads are checked in under `.github/rulesets/`.
They prohibit deletion and force pushes, require pull requests, allow squash
merge only, dismiss stale reviews, require resolved review threads, require
CODEOWNER review for owned paths, and name the exact status checks for each
branch. There are no bypass actors.

`npm run governance:rulesets` is a read-only branch dry run. It compares the
checked-in branch payloads with GitHub and reports the required release-tag
lockdown state. Once an owner-reviewed App ID is checked in, use
`--release-tags` with the exact App and publisher arguments to compare the two
tag policies. Apply one branch lane at a time with
`npm run governance:rulesets -- --branch <dev|main|www> --publisher-login <bot-login> --apply`. Apply fails
unless the target branch already contains the exact governed CODEOWNERS file,
a recent merged pull request was authored by that distinct publisher identity,
the exact merged head has an APPROVED review from `@AubreyF`, and that head has
a successful run for every required check context. This prevents the sole
CODEOWNER from locking the repository by authoring a PR they cannot
self-approve. The publisher identity may create branches and PRs, but it must
not have approval or merge authority. CODEOWNERS must land in `dev`, then ride the explicit
promotion into `main` and a separate handoff into `www` before either ruleset
is applied. The `www` handoff must also add the repository `.nvmrc`, which is
not present on the current `www` branch, before its workflows use
`node-version-file`. Installing a review or check rule before its base-branch
policy, pinned toolchain, and workflow exist can lock the branch with an
impossible condition.

The publisher login is a GitHub author identity, not merely the local trusted
publisher broker. A broker that still invokes `gh` as `@AubreyF` does not solve
self-approval and cannot satisfy ruleset readiness. Keep all three rulesets
unapplied until a distinct least-privilege App or bot has produced the required
review evidence.

Release preparation is also PR-only. Dev prep starts from current `origin/dev`
and returns through a reviewed PR to `dev`. Production prep starts from current
`origin/main` after any required product promotion and returns through a
release-only PR to `main`. `release-publish.sh` tags only an exact merged remote
commit and never instructs a protected branch push. Release artifacts bind the
tag, channel, numeric bundle versions, and product commit used to prepare the
notes. The root-owned release publisher rechecks exact branch-tip equality when
it creates the remote tag. The delayed tag workflow then requires that commit
to remain in protected `origin/main` or `origin/dev` history and reruns release
identity validation before signing or publication.

## One global behavior slot

The nightly executor may rank or plan several tasks. It may implement at most
one product behavior change globally for an installed-build soak cycle. Soak
exclusivity keys label evidence and deduplicate related work. They do not create
parallel behavior slots. A behavior slot does not reopen when a PR merges. It
reopens only after that change is installed, its bounded soak completes, and the
verifier records an effect outcome.

CI, documentation, skills, measurement, and other runtime-neutral scaffolding
may share a PR when they cannot affect the observed runtime metric. If a change
can affect sync cadence, provider traffic, memory retention, recovery, worker
lifecycle, or user-visible app behavior, treat it as behavioral and give it an
exclusive soak.

## Outcome schema

`outcomes.jsonl` uses schema version 3. Every entry names a canonical task and
is authenticated by the matching lifecycle transition. The allowed states are:

- `merged`
- `installed`
- `verified_effective`
- `verified_neutral`
- `regressed`
- `inconclusive`
- `governance_blocked`
- `superseded`
- `implementation_failed`

`merged` means only that code reached the target branch. It is not evidence that
the change worked. `installed` requires a build identity. Measured verification
states require `metric`, `before`, `after`, computed `delta`, `unit`, build
identity, and `evidenceWindowEnd`. A lifecycle `inconclusive` still requires a
nonempty evidence window attributable to the canonical installed build plus a
complete composite fingerprint. Raw soak or canary analysis may be
`inconclusive` because identity is missing or mixed, the window is empty, or
capture is broken. Preserve that raw result, but do not turn it into a task
transition. Keep the task in `soaking`, repair collection, and retry.

Every lifecycle verification state requires at least six credited app-alive
hours. Measured soak baselines have the same minimum. Comparison duration comes
from credited app-alive time, not wall span, and must stay within the inclusive
0.8 to 1.25 ratio. Wall bounds still enforce ordering and nonoverlap.

The planner suppresses an exact task ID only when its latest outcome is
`verified_effective` or `superseded` and no newer evidence exists.
`governance_blocked` makes that exact candidate nonmodifiable until newer
evidence or authority changes. A success for a similar task or task kind does
not suppress a new concrete finding.

Example effect record:

```bash
RAW_VERDICT=/absolute/path/to/soak-verdict.json
BASELINE=/absolute/path/to/baseline-soak-verdict.json
VERDICT=/absolute/path/to/outcome-verdict.json
node scripts/build-outcome-verdict.mjs \
  --soak-verdict "$RAW_VERDICT" \
  --task-id P1-01 \
  --outcome verified_effective \
  --metric unchanged-cloud-upload-rate \
  --baseline-reference "$BASELINE" \
  --out "$VERDICT"

node scripts/record-outcome.mjs \
  --id P1-01 \
  --task-id P1-01 \
  --kind task \
  --status verified_effective \
  --evidence-window-end 2026-07-10T12:00:00Z \
  --verdict-reference "$VERDICT" \
  --actor freed-release-verifier \
  --lease-name release-verifier
```

The raw soak verdict and the generated outcome verdict are separate artifacts.
The converter binds the release decision to the raw verdict digest and a hashed
baseline reference. Hand-written lifecycle verdicts are not an acceptable
closeout path.

Metric guardrails are registered, not caller selected. A worker-init outcome
automatically compares `app-memory-pressure-p95` from the same baseline and
measured artifacts. Effectiveness requires the worker-init rate to improve
beyond its tolerance without more than 128 MiB of p95 memory-pressure growth.
If only that memory guardrail regresses, the generated outcome records the
memory metric as the decisive effect.

The outcome writer appends a matching authenticated control event. Unsigned
historical ledger lines, replayed event IDs, mismatched actors, and evidence
that does not match the event are ignored by the planner. The ledger entry and
control event both bind the exact canonical task revision produced by the
transition.

Every new outcome transition enters through the authenticated outcome writer.
The writer first creates an `outcomeRequired` reservation for `merged`,
`installed`, and every terminal outcome. That reservation blocks later task
mutation until one matching `outcome_recorded` event, one authenticated ledger
row, and one finalization event are durable. A process loss can therefore leave
recoverable pending work, but it cannot silently advance the lifecycle without
the outcome. Historical ordinary outcomes that already have a complete
authenticated transition, control event, and ledger row remain trusted when
their older transition predates `outcomeRequired`. A new append may not attach
to that older transition. Same-state legacy backfill creates a new exact
reservation linked to the historical transition, then follows the normal
record and finalization path.

Normal automation actors use `record-outcome.mjs` with their canonical lease.
An owner operation uses one composite `outcome.record` intent. The read-only
`plan` command binds the normalized source task, source state and revision,
route, historical transition when applicable, complete normalized ledger row,
row timestamp, evidence, and digest. Save that output as a private mode `0600`
file before acquiring the owner lease. The `apply` command accepts only that
plan file and reads the short owner token only from
`FREED_AUTOMATION_LEASE_TOKEN`. Transition, same-state reservation, audit
event, ledger append, and finalization all reauthorize against the same exact
intent. Retries may use a fresh lease for the unchanged plan.

The task manifest alone cannot release the global behavior slot. If a process
stops after a terminal task transition but before its authenticated outcome is
durable, the planner reports `outcome-record-pending` and keeps all new
behavioral work blocked. Missing or contradictory behavioral classification
reports `classification-required` and also fails closed.

Verification records are accepted only while the canonical task is in
`soaking`, or already at that exact outcome during an idempotent retry. The
referenced JSON verdict must match the claimed build and a nonempty evidence
window, carry attributable installed-build identity and a complete composite
fingerprint, and report a healthy source for measured outcomes. These identity,
window, and fingerprint requirements also apply to lifecycle `inconclusive`.
They do not prevent raw analysis from reporting an unrecordable inconclusive
result when capture itself is insufficient.

## Owner-governed outcome history repair

Normal outcome recording only appends authenticated schema version 3 entries.
It never converts an unsigned historical line into a trusted outcome. When
legacy or otherwise rejected lines make the canonical ledger unhealthy, the
separate history repair path may retain already trusted entries and quarantine
the rejected raw bytes. It never reserializes, edits, or re-signs a legacy
entry.

A repair plan binds one existing canonical task to the fixed repair policy and
the exact physical inputs and expected outputs. The owner intent includes the
canonical state root and ledger path, source SHA-256 digest, source byte size,
physical line count, an exact append-only control-event history prefix digest
and byte size, expected trusted and rejected counts, replacement digest and
size, raw archive digest, per-line decision digest, and final receipt digest.
Any count, digest, path, policy, source, or bound prefix change invalidates the
plan. Later event suffixes are allowed because acquiring the required owner
lease appends its own event. Under the outcome writer lock, the current full
history must remain healthy and must produce the same per-line decisions and
the same retained and rejected raw byte streams. Live repair requires a current
`freed-owner` lease named `owner-governance` whose exact operation intent
matches those values. Task authority, actor authority, provider authority, and
general instructions do not substitute for that owner authorization.
The reserved repair audit must also match exactly one earlier canonical owner
lease acquisition in the physical control-event history. Its lease name,
credential kind, capability or confirmation identity, task, intent, and
authority fields must be identical. The audit timestamp must be at or after
that acquisition and strictly before the authorization expires. A later event,
duplicate acquisition identity, spliced credential, or event at the expiry
boundary fails closed.

The plan reports the canonical task's current state and revision for operator
context. Those fields are informational. The signed intent binds the stable
task ID and requires that exact task to exist at plan and apply time. It does
not bind task state or revision because lifecycle state does not grant outcome
history repair authority.

Planning classifies every physical line with its original line number, byte
offset, byte length, occurrence order, raw digest, disposition, and reason. The
content-addressed artifact set preserves the complete source bytes, the exact
raw bytes retained in the replacement, the exact raw bytes rejected from it,
the per-line decision manifest, and the completion receipt. Retained and
rejected lines keep their original bytes. A repair cannot manufacture trusted
history by reserializing old JSON or signing it after the fact.

The mutation reuses the same `outcomes.jsonl.writer-lock` as normal outcome
append. Owner authority is checked again after that lock is acquired, after
owned temp cleanup, immediately before the first archive write, immediately
before ledger replacement, and inside the audit-event guard. If the owner lease
expires while either guard is busy, no new archive or audit mutation occurs.
Recovery requires a fresh exact lease for the same intent. The reserved audit
event has no standalone append API. Its synchronous finalization guard
revalidates the exact prepared transaction, source, retained, rejected, and
decision artifacts, plus the canonical replacement before append. The callback
must leave the transaction in `audited`, and its helpers expire when the guard
returns. The immutable source archive is reclassified against the current full
event history immediately before audit, including recovery after replacement.

The durable transaction phases have literal meanings:

- `prepared` means the source, retained, rejected, and decision artifacts plus
  the transaction are durable. The receipt may not exist yet.
- `replaced` means the atomic canonical-ledger rename and directory sync are
  durable.
- `audited` means exactly one reserved, deterministic
  `outcome_history_repaired` event is durable.
- `complete` is written only after the receipt, current ledger, immutable
  archives, and exact audit event verify together.

Generic event writers cannot claim the reserved event type.

Recovery is idempotent at every phase. It verifies the transaction, immutable
artifacts, current ledger, and audit event before finishing only the missing
steps. A retry of a completed operation returns the same receipt and does not
rewrite history or duplicate the event. A conflicting transaction, artifact,
receipt, event, source snapshot, or post-repair ledger fails closed. Any
prepared, replaced, or audited transaction keeps outcome-ledger health false
until recovery reaches `complete`, so a crash cannot quietly reopen the global
behavior slot.

Use the dedicated CLI. Plan before acquiring the owner lease:

```bash
npm run --silent automation:repair-outcome-ledger -- plan \
  --task-id "$TASK_ID" \
  --source-digest "$SOURCE_DIGEST"
```

Create one private mode `0600` current-task owner confirmation from
`result.intent` and `result.intentDigest`, then acquire the exact short lease:

```bash
OWNER_ACQUIRE_OPERATION_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
OWNER_LEASE_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
FREED_AUTOMATION_LEASE_OPERATION_ID="$OWNER_ACQUIRE_OPERATION_ID" \
FREED_AUTOMATION_LEASE_TOKEN="$OWNER_LEASE_TOKEN" \
  node scripts/automation-control.mjs lease acquire \
  --name owner-governance \
  --owner freed-owner \
  --ttl-seconds 600 \
  --owner-confirmation-file "$CONFIRMATION" \
  --owner-task-id "$TASK_ID" \
  --owner-intent-digest "$INTENT_DIGEST"
```

Do not replan merely because lease acquisition appended its control event. Keep
the caller-retained token only in the standard environment variable while
applying:

```bash
FREED_AUTOMATION_LEASE_TOKEN="$OWNER_LEASE_TOKEN" \
npm run --silent automation:repair-outcome-ledger -- repair \
  --task-id "$TASK_ID" \
  --source-digest "$SOURCE_DIGEST"
```

Release the lease after either success or failure:

```bash
OWNER_RELEASE_OPERATION_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
FREED_AUTOMATION_LEASE_OPERATION_ID="$OWNER_RELEASE_OPERATION_ID" \
FREED_AUTOMATION_LEASE_TOKEN="$OWNER_LEASE_TOKEN" \
  node scripts/automation-control.mjs lease release \
  --name owner-governance
```

## Structured roadmap status

`docs/roadmap-status.json` is the machine-readable phase-status manifest. Each
entry names a phase ID, its `docs/PHASE-*.md` source, and one of `complete`,
`current`, or `upcoming`. `npm run validate:roadmap` derives status from each
phase document and fails when the manifest disagrees.

The manifest supplies status, not implementation authority. Agents must not
invent work from broad roadmap prose. Public roadmap presentation remains a
separate `www` branch change. Product and automation work remains in the `dev`
lane.

## Provider approval records

Provider approval JSON belongs outside the repository because the approved
provider branch must remain clean. The record cannot be future-dated, may last
at most seven days, must still be unexpired, and must name the exact
provider-visible path set. Its `diffSha` must equal the provider-only binary
diff hash. It records `approvedBy`, one provider scope for every approved path,
and a `control-task` approval source. Provider names inferred from
provider-specific paths must match that scope. Any provider-visible edit
invalidates the record.

Gate 1 happens before code. The owner must explicitly approve the named
provider, observable behavior, fingerprinting risk, and lowest-profile
alternative. General permission to proceed with a plan or program is not this
approval.

Gate 2 happens after the provider-visible diff is committed and published as a
draft. The helper posts a GitHub review comment containing the providers,
provider-visible paths, behavior, risk, alternative, and provider-only diff
fingerprint. The direct human authorization is a CODEOWNER thumbs-up reaction
on that comment. The helper verifies the actor and fingerprint before marking
the pull request ready. Unrelated branch edits preserve the reaction.

For machine-verifiable unattended authorization, set `approvalSource.kind` to
`control-task`. Use the optional signed broker to authorize the same packet
digest on the referenced task. The publish helper verifies the task manifest,
approved provider authority, and matching owner capability event. Broker
provisioning is optional and does not block the GitHub reaction path.

The signed source does not replace external review policy. The direct path uses
the CODEOWNER reaction itself as the structured GitHub authorization event.

See [W1-06](stability-tasks/W1-06-provider-visible-single-source.md) and the
fingerprinting stop sign in [AGENTS.md](../AGENTS.md) for the full publish
contract.

## Operator checks

```bash
npm run validate:automations
npm run validate:host-automations
npm run automation:actors -- verify --all
npm run automation:actors -- accept-host --all
npm run validate:roadmap
npm run governance:rulesets
node --test scripts/automation-control.test.mjs
node scripts/automation-control.mjs task list
node scripts/automation-control.mjs lease show --name nightly-writer
```

If another pass owns an active writer lease, do not start duplicate work. If a
lease expired, acquire it normally so takeover is recorded. When nothing safe
is actionable, append a compact no-op event, release the lease, and finish.
