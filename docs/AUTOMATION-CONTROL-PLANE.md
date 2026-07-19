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
| `~/.freed/automation/control/actor-credentials/`           | Private local credential records used by pinned general actor launchers to acquire canonical role leases                                                  |
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
`short-lived-credential-handoff`. Readiness means all of these are present:

1. A private mode `0600` actor credential digest record under
   `<stateRoot>/control/actor-credentials/`.
2. A root-owned immutable launcher binding at
   `/Library/Application Support/Freed/automation-actor-launchers/<actor>.json`.
3. The root-owned executable and exact SHA-256 digest named by that binding.
4. Root-owned pinned copies of the repo Node binary, control entry, and control
   library under
   `/Library/Application Support/Freed/automation-actor-runtimes/<runtime-digest>/`.
5. The matching non-secret Keychain item metadata for service
   `freed-automation-actor` and account `<actor>`.
6. A binding handoff of `keychain-to-canonical-lease`, which gives the actor only
   its short-lived canonical lease and never its persistent secret.
7. A successful nonmutating `freed-actor-launcher-readiness-v2` attestation from
   the pinned launcher. It must bind the actor, canonical state root, canonical
   lease name, 30 minute maximum lifetime, credential digest, Keychain service
   and account, and confirm both digest verification and canonical lease
   readiness.

Readiness protocol v2 is the current native launcher generation. Validation
rejects a v1 binding before invoking its launcher or touching Keychain, even
when the recorded launcher digest still matches. The current provisioner
accepts protocol v1 only for an explicit revoke. Provision and rotate require
v2. Legacy recovery is therefore revoke, inspect the result, then provision
fresh public material and a credential.

The nonmutating readiness attestation has a 15 second outer ceiling so a cold
macOS Keychain decrypt can complete. The caller supplies no input, hard-kills
the launcher at the deadline, and fails closed on timeout or any late,
oversized, malformed, or mismatched result.

Each native provisioner invocation for provision, rotate, and revoke has a 120
second outer ceiling, supplies no input, and is hard-killed at the deadline.
Repository checks, native builds, public file installation, and multi-actor
orchestration sit outside that per-invocation bound. A timeout means the actor's
lifecycle result is indeterminate. It is not proof that no state changed. Stop,
inspect the actor's public binding, private digest, and non-secret Keychain
metadata, then revoke and provision through the supported lifecycle when the
state cannot be proven complete.

The validator does not read a Keychain secret and does not write host files.
`automation:actors verify` validates the private digest record and root-owned
public binding, then invokes the exact installed launcher for the same
nonmutating attestation. It does not compile or invoke a disposable provisioner
to read the secret. The installed launcher reads the Keychain secret inside its
attestation boundary, compares it to the credential digest, and returns only the
non-secret result. An ACTIVE actor fails closed if any overlay or readiness
check fails. A missing actor remains safely PAUSED and is reported as
reconciliation drift. A saved PAUSED actor may await owner provisioning, but
its installed overlay still must be valid. Reconcile through the Codex host
automation controls, never by editing `automation.toml` directly.

### Owner provisioning for general actors

Provision the five general actors only from a clean `dev` checkout whose HEAD is
the exact local `origin/dev`. The helper refuses `freed-owner` and
`freed-pr-publisher`. After the reviewed bootstrap PR is merged and the local
checkout is current, run:

```bash
npm run automation:actors -- provision --all
npm run automation:actors -- verify --all
npm run automation:actors -- accept-host --all
npm run validate:host-automations
```

`accept-host` is the owner-run real-host acceptance gate. For each actor it
acquires the canonical lease through the installed launcher, heartbeats that
lease, and releases it before reporting success. Each child process, output,
and lifecycle step is bounded. After a successful acquisition, cleanup still
attempts release if the heartbeat or a later check fails. The command does not
create or mutate a task, grant task or
provider authority, activate an actor, or expose a persistent credential or
short-lived lease token in its result.

If `provision --all` fails after creating earlier credentials, it revokes only
the actors completed by that invocation, in reverse order. It never revokes the
actor whose provision step failed, because that actor may have owner-managed
state from an earlier attempt. Run `revoke --actor <actor named in the error>`,
then retry provisioning. A `provision_rollback_failed` result names every actor
that still requires explicit owner recovery.

The helper compiles two native Swift programs with deterministic linker output
names. The macOS linker gives identical builds the same ad hoc signature. This
is a linker-generated identity, not a developer signing identity, and the build
does not select or require one. The helper installs only public,
content-addressed runtime files and actor-specific launcher bindings through
`sudo`. The native provisioner then generates each persistent credential with
the system random source, stores it in the current owner's Keychain, restricts
the item to the exact installed launcher, and writes only its digest to the
private automation state directory. The orchestration script, shell, and agent
never receive the credential. It never appears in arguments, standard output,
logs, task state, or agent state.

The launcher-only decrypt ACL uses an empty prompt selector. The trusted
application list already limits access to the exact root-owned launcher.
Setting the unsigned or invalid application prompt flags would require a
passphrase for the deterministic ad hoc signature and would turn unattended
acquisition into a password dialog. A missing or mismatched launcher trust
entry must fail closed while Keychain interaction is disabled.

The installed launcher clears inherited environment state, verifies its own
root-owned binding and every pinned runtime digest, disables Keychain user
interaction for the credential read, restores the prior interaction policy,
and invokes only the pinned control entry. A failure to disable interaction,
read the credential, or restore the prior policy fails closed. Verify, acquire,
and host acceptance must never display a Keychain password dialog. The launcher
and orchestration layer bound child runtime and output, terminate the complete
timed-out child process group, and reject late, oversized, or malformed results.
Native acquisition has one 65 second end-to-end budget split into a 20 second
acquisition window and a final 45 second cleanup reserve. Validation, binding
checks, and the Keychain read consume the acquisition window. If they exhaust
it, the launcher fails before starting lease mutation. Once an acquire child may
have committed, the reserve is available only to two exact-identity release
attempts and two absence inspections. The caller's 75 second outer ceiling adds
10 seconds beyond the native boundary, so its hard kill cannot interrupt an
active bounded child. The pinned acquire child is the only JavaScript process
that receives the persistent credential. Release receives only its retained
short-lived operation ID and lease token. Show receives neither secret. After
malformed or lost acquisition responses, the launcher retries one idempotent
release identity, then retries inspection and requires confirmed absence before
returning failure. Before preflight begins, the native host takes synchronous
`SIGINT` and `SIGTERM` ownership through a Darwin kqueue. Every control child
starts in its own process group with an empty signal mask and default interrupt
and termination dispositions. Cancellation before an acquire child starts exits
with the matching signal status and performs no lease mutation. Once acquire may
have started, cancellation kills and reaps the complete child group, uses the
retained exact release identity, confirms absence inside the cleanup deadline,
and emits no lease handoff. Cleanup children do not consume host cancellation,
so a signal cannot spend a release or inspection retry. The first signal remains
retained until cleanup finishes and the host exits with status 130 or 143.

The lease handoff has one native commit point. The host blocks both cancellation
signals, drains the kqueue, and cleans the lease without output if cancellation
was already present. Otherwise that drain commits the transfer. The host writes
the complete handoff while both signals remain blocked and exits successfully
without restoring a signal window. A signal arriving after that commit belongs
to the completed transfer and cannot turn valid handoff bytes into a failed
launcher result. As a second cleanup layer, the orchestration caller bounded-parses
launcher output even on a nonzero result. If it finds a plausible retained lease
token, it performs exact-token release and confirms absence before reporting the
launcher failure. Terminal error and cancellation paths perform a preliminary
drain and one final drain, then keep both signals blocked through process exit.

The launcher returns only the short-lived lease result. General actor leases
have a 30 minute absolute lifetime. Heartbeats cannot extend them past the
original limit.

This handoff follows the control plane's cooperative same-user threat model. It
protects the persistent credential and pins the selected role to one immutable
launcher and runtime. It does not authenticate which saved automation invoked
that launcher. Any process running as the same macOS user can invoke any of the
five provisioned general actor launchers. Stored task authority, provider
approval, the global behavior slot, owner governance, publisher isolation, and
GitHub review gates still apply. Do not provision these launchers if the five
general roles require hard isolation from one another.

The owner can rotate, revoke, or verify one actor without exposing its secret:

```bash
npm run automation:actors -- rotate --actor freed-nightly-runner
npm run automation:actors -- revoke --actor freed-nightly-runner
npm run automation:actors -- verify --actor freed-nightly-runner
npm run automation:actors -- acquire --actor freed-nightly-runner
```

`rotate` is the only actor command allowed to request owner interaction with an
existing Keychain item. Rotation reads the prior credential so it can restore
that credential if installing the new digest fails. Run it only as an explicit
owner action. If macOS asks for Keychain access, choose one-time **Allow**. Never
choose **Always Allow**. Provision, verify, acquire, revoke, and `accept-host`
are not interactive commands. A prompt from any of them is a failure, not an
installation step to click through.

Keep every saved actor paused until `verify --all`, `accept-host --all`, and
`validate:host-automations` pass on the real host. The first installation must
prove that the root-owned launcher with its deterministic linker ad hoc
signature can use its Keychain ACL unattended on the current macOS version. A
source-level test cannot prove that host policy. Provisioning enables the five
general policy roles inside the cooperative same-user boundary. It does not
create task authority, bypass owner governance, authorize provider-visible
behavior, contact a provider, or consume the one behavioral soak slot.

Any credentials exposed to repeated Keychain approval dialogs before this
contract was installed must be replaced after the repair reaches `dev`. Keep
all actors paused, update a clean `dev` checkout to exact `origin/dev`, then run:

```bash
npm run automation:actors -- revoke --all
npm run automation:actors -- provision --all
npm run automation:actors -- verify --all
npm run automation:actors -- accept-host --all
npm run validate:host-automations
```

Do not activate an actor until that complete sequence succeeds without a
Keychain dialog and the acquire, heartbeat, and release acceptance result is
clean for all five actors.

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
inode. Planned removals first move the exact occurrence into a deterministic
private quarantine, sync both parents, remove it, and advance the same journal
before cleanup. An empty quarantine left after journal unlink is recovered
idempotently. Any unbound occurrence fails closed.

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
evidence already bound to a durable supersede receipt.

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
records, not a second task queue.

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
active lease cannot be stolen. A caller may take over an expired lease, or an
unreadable initialization directory after the orphan grace period. Takeover is
recorded as an event with the previous owner data. Do not delete a lease to make
a second runner fit.

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

Each transaction binds the operation, canonical request digest, stable event ID
and timestamp, exact event payload, exact redacted before and after lease
records, before and after record digests, operation-specific result receipt,
capability movement, and prior takeover summary when applicable. Its durable
phases are `prepared`, `state-committed`, `event-appended`, and `complete`.
Preparation happens before capability consumption, takeover removal, or lease
mutation. Under lock order lease guard then event guard, recovery classifies
canonical state and the exact event as before, after, or conflict. It finishes
only a deterministic missing step. An unknown-token live lease is never an
acceptable recovery result.

Every lease inspection, authority check, and mutation recovers the exact
transaction under the lease guard or fails closed while one remains pending.
An exact completed retry returns its immutable receipt when the operation ID,
request digest, and token digest match, even after a later legitimate heartbeat
or binding changed the current lease. Event ID reuse requires complete payload
equivalence. A collision or any state, event, staging, capability, takeover, or
receipt conflict fails closed.

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
closed. General actor runtime schema v3 copies and digests the helper, the
kernel guard contract, and the outcome ledger repair contract beside the
pinned control library. The installed control entry must load from that
content-addressed runtime without access to the source checkout.

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

### Automation actor credentials

Every general automation actor's trusted host launcher must bind canonical role
lease acquisition to both a private local credential record and the matching
token in `FREED_AUTOMATION_ACTOR_TOKEN`. That persistent token must not enter
the agent process. The credential lives at
`<stateRoot>/control/actor-credentials/<actor>.json` and has this shape:

```json
{
  "schemaVersion": 1,
  "actor": "freed-nightly-runner",
  "purpose": "automation-actor-lease",
  "tokenSha256": "<sha256 of the private actor token>"
}
```

The credential must be a private regular file with no group or world
permissions. The private token must contain at least 32 characters. The
credential is machine-local and must never be checked in, generated by an
automation prompt, copied into task details, printed in logs, or posted to an
external service. The native launcher supplies the matching secret only to the
pinned lease-acquire child process. The scheduled automation receives only the
resulting short-lived lease token. A missing, permissive,
malformed, wrong-actor, wrong-purpose, or token-mismatched credential fails
closed. The credential proves that the pinned launcher and runtime selected the
canonical actor role. It does not authenticate the calling saved automation.
Any process running as the same macOS user can invoke another provisioned
general role. The resulting lease does not expand that role's checked-in
authority, provider policy, stored task authority, or lifecycle destinations.

Release tags have a separate external trust boundary. The checked-in
`release-tag-lockdown.json` is the bootstrap authority. Apply it with
`--lock-release-tags --apply` before App provisioning. It restricts creation,
update, and deletion with no bypass. `release-tag-publisher-install.mjs prepare`
builds and installs the fixed root-owned native host and provisioner. The
manifest helper then creates the private `Freed Release Publisher` organization
App, pipes its private key into the native provisioner, activates the digest
pinned binding, and requires a selected-repository installation for only
`freed-project/freed`. The Keychain item uses service
`freed-release-tag-publisher` and account `github-app-private-key`.

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
binding, parent chain, executable digest, App identity, Keychain credential,
selected repository, and installation permissions are rechecked immediately
before use. The native host rechecks the branch tip and receipt at publication,
then obtains and revokes one short-lived installation token. It does not accept
a user token, personal access token, general actor credential, or the separate
PR publisher as a tag-creation fallback. The delayed workflow checks that the
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
closed. A nightly runner credential cannot authenticate this lease.

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

### Credential provisioning and rotation

Credential installation is an owner-controlled host bootstrap operation, not
an automation task. General automation actors use random token bytes and
private digest records. The publisher instead uses an Ed25519 key pair. Its
installer must generate the private key in native owner-controlled code, store
it with the macOS Keychain API without putting key bytes in process arguments
or environment state, verify the public-key derivation, and atomically install
the matching root-owned config plus current-user public-key record. Rotation
must restore the prior Keychain item and both public bindings if any step
fails. The `security` command with `-p`, `-w <value>`, or `-X <value>` is not an
acceptable installer because it exposes secret material in the process list.

The optional broker scheduler handoff is a trusted host boundary outside candidate worktrees.
General actors retrieve only their own credential and expose it to an approved
immutable launcher long enough to acquire their canonical lease. Publisher
handoff never exports its signing key. Candidate work receives only the
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

To rotate a credential, stop the actor and release its live lease when the lease
token is available. For the publisher, rotate the Keychain key, root public-key
pin, and private public-key record as one owner transaction. A replacement
invalidates new capabilities signed by the old key. Deletion prevents all new
acquisitions. Neither action invalidates a lease that is already active. If its
lease token is unavailable, keep the actor stopped and wait for the lease to
expire. The publisher helper requests a 30 minute lease.

When the same actor still owns a live legacy lease without credential metadata,
an authenticated acquisition upgrades only that lease, issues a new lease
token, invalidates the old token, and appends `lease_credential_upgraded`.
Cross-actor upgrades fail closed.

### Optional signed owner capability

`freed-owner` is not an unattended automation identity and does not use a
persistent actor credential or a same-user bootstrap file. A mode `0600` file
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
