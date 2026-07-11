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

| Source | Purpose |
| --- | --- |
| `automation/specs/*.json` | Checked-in automation identity, authority, provider policy, prompt path, soak limit, allowed local overlay fields, and required host handoff capabilities |
| `automation/prompts/*.md` | Checked-in behavioral contract for each automation |
| `.github/rulesets/*.json` | Checked-in dev, main, and www PR, review, merge, and required-check governance |
| `~/.freed/automation/control/current-tasks.json` | Atomic current task state |
| `~/.freed/automation/control/task-transactions/` | Recoverable write-ahead records that bind each task revision to its audit event |
| `~/.freed/automation/control/events.jsonl` | Append-only audit history for task, authority, lease, and observer events |
| `~/.freed/automation/control/leases/` | Token-bound leases that prevent duplicate writers |
| `~/.freed/automation/control/actor-credentials/` | Private local credential records that authenticate non-owner actor lease acquisition |
| `~/.freed/automation/control/owner-capabilities/` | Broker-signed one-use owner governance capabilities, split into pending and consumed records |
| `~/.freed/automation/outcomes.jsonl` | Versioned merge, install, and observed-effect outcomes |
| `~/.freed/automation/soaks/` | Installed-build evidence windows and verdicts |
| `docs/roadmap-status.json` | Structured phase status used to validate roadmap truth |

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
project root. A `pr-only` or `merge-safe` actor must use worktree execution.
Guessed model names, alternate repositories, extra working directories,
self-expiring schedules, and unsupported execution modes are drift.

Every actor specification also requires `trusted-launcher` and
`short-lived-credential-handoff`. Readiness means all of these are present:

1. A private mode `0600` actor credential digest record under
   `<stateRoot>/control/actor-credentials/`.
2. A root-owned immutable launcher binding at
   `/Library/Application Support/Freed/automation-actor-launchers/<actor>.json`.
3. The root-owned executable and exact SHA-256 digest named by that binding.
4. The matching non-secret Keychain item metadata for service
   `freed-automation-actor` and account `<actor>`.
5. A binding handoff of `keychain-to-canonical-lease`, which gives the actor only
   its short-lived canonical lease and never its persistent secret.
6. A successful nonmutating `freed-actor-launcher-readiness-v1` attestation from
   the pinned launcher. It must bind the actor, canonical state root, canonical
   lease name, 30 minute maximum lifetime, credential digest, Keychain service
   and account, and confirm both digest verification and canonical lease
   readiness.

The validator does not read a Keychain secret and does not write host files. The
root-owned launcher reads the Keychain secret inside its attestation boundary,
compares it to the credential digest, and returns only the non-secret result.
An ACTIVE actor fails closed if any
overlay or readiness check fails. A missing
actor remains safely PAUSED and is reported as reconciliation drift. A saved
PAUSED actor may await owner provisioning, but its installed overlay still must
be valid. Reconcile through the Codex host automation controls, never by editing
`automation.toml` directly.

## Atomic current task manifest

`current-tasks.json` is the current-state authority. It has a schema version,
manifest revision, update timestamp, and a stable sorted array of tasks. Each
task has its own revision, stable task ID, state, timestamps, execution
authority, provider authority, and JSON details.

Task writes use this sequence:

1. Acquire the short filesystem guard for task state.
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

Each filesystem guard records its PID and process start identity. Age alone
never permits takeover while that exact process is alive. A stale guard is
recoverable only when the process is gone, the PID was reused with a different
start identity, or the owner record is irrecoverably absent.

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

| Task authority | Furthest mutable lifecycle stage |
| --- | --- |
| `observe-only` | Product and external state stay read-only; local evidence, observed tasks, control events, and later verification verdicts are allowed by the actor policy |
| `plan-only` | Triage, PR approval planning, governance blocking, supersession, and closure |
| `pr-only` | Implementation and validation in a PR, but not merge |
| `merge-safe` | Merge, install, and soak handoff under existing governance |

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

- a random ownership token
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

Typical writer flow inside an automation process, after the trusted host
launcher acquires the actor's lease:

```bash
node scripts/automation-control.mjs lease heartbeat \
  --name nightly-writer

node scripts/automation-control.mjs lease release \
  --name nightly-writer
```

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

Every non-owner actor's trusted host launcher must authenticate lease
acquisition with both a private local credential record and the matching token
in `FREED_AUTOMATION_ACTOR_TOKEN`. That persistent token must not enter the
agent process. The credential lives at
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
external service. Scheduled automation supplies the matching secret only in
the environment of the lease-acquire invocation. A missing, permissive,
malformed, wrong-actor, wrong-purpose, or token-mismatched credential fails
closed. The credential authenticates actor identity only. It does not expand
the actor's checked-in authority, provider policy, task authority, or lifecycle
destinations.

The PR publisher uses a separate fail-closed identity contract. It does not
accept `FREED_AUTOMATION_ACTOR_TOKEN` or
`FREED_PR_PUBLISHER_ACTOR_TOKEN`. Its persistent credential is a raw 32 byte
Ed25519 private signing key in the macOS Keychain item with service
`freed-pr-publisher` and account `freed-pr-publisher-signing-key`. Only the
signed native broker reads that key. The broker clears inherited environment
state before Keychain access, uses the key only to sign one capability, wipes
its key buffer, and never places the key or a reusable derivative in a child
environment, argument, file, shell, Node process, or GitHub command.

The agent environment receives one public broker binding:

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
trusted launcher starts with an empty environment containing only public pins
and the capability path. It rechecks the immutable control checkout, pinned
Node and GitHub CLI, canonical base, target scope, explicit publish mode, and
the exact main head when applicable. Automation control verifies the Ed25519 signature against the
provisioned public key, compares the exact requested scope and lifetime, and
atomically moves the capability from `pending` to `consumed`. Replay fails
closed. Only then does it issue the short-lived publisher lease token to the
pinned publisher helper. A nightly runner credential cannot authenticate this
lease.

`scripts/doctor.mjs` checks the fixed production config, ownership and modes,
all pinned file digests, broker signature and designated identity, control
commit and cleanliness, state root, public-key record, and non-secret Keychain
item presence. It never reads the signing key. Use `--require-publisher` for a
release or promotion gate. The native broker repeats the trust checks at use
time. Until the owner installs and provisions this chain, authenticated
publishing is intentionally unavailable.

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

The scheduler handoff is a trusted host boundary outside candidate worktrees.
General actors retrieve only their own credential and expose it to an approved
immutable launcher long enough to acquire their canonical lease. Publisher
handoff never exports its signing key. Candidate work receives only the
short-lived authority it needs. The trusted publisher launcher supplies only
`FREED_PR_PUBLISHER_LEASE_TOKEN` to the pinned `worktree-publish.sh`. The
helper clears persistent and lease credentials from every child-process
environment before running Git, hooks, validators, provider checks, or GitHub
commands. The checked-in automation specifications do not install this host
component. Until the owner provisions it, unattended actors may observe and
plan, but authenticated mutation and publishing remain closed.

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

### Signed owner capability

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
capability. Missing host trust keeps owner acquisition closed. Provider approval
still requires its scoped approval reference and the independent publish gate.

## Authority model

Checked-in automation authority is one of:

- `observe-only`: collect or judge evidence without product or external mutations; authenticated local evidence and control writes remain allowed by actor policy
- `plan-only`: reconcile evidence into task state without product edits or PRs
- `pr-only`: prepare a focused PR but do not merge it
- `merge-safe`: execute and merge only work that existing governance marks safe

Provider authority is separate. `forbidden` prohibits provider activity.
`approval-required` may prepare an approval packet, but it cannot implement or
publish provider-visible behavior without the owner's scoped record. A task may
move to provider authority `approved` only with an approval reference. The
publish gate still validates the approval JSON, exact path set, expiry, and full
committed branch diff hash. Only the `freed-owner` lease may change task
authority. Task authority never substitutes for the publish gate or CODEOWNER
review. Creating a task directly with provider authority `approved` also
requires an approval reference. The current manifest retains that reference,
and every task event carries the same approval snapshot.

## Checked-in automation specifications

| Automation | Authority | Provider policy | Behavioral changes per soak |
| --- | --- | --- | --- |
| `freed-runtime-observer` | `observe-only` | `forbidden` | 0 |
| `freed-stability-controller` | `plan-only` | `forbidden` | 0 |
| `freed-nightly-runner` | `merge-safe` | `approval-required` | 1 |
| `freed-release-verifier` | `observe-only` | `forbidden` | 0 |
| `freed-scaffolding-maintainer` | `pr-only` | `forbidden` | 0 |

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

`npm run governance:rulesets` is a read-only dry run. It compares the checked-in
payloads with GitHub. Apply one lane at a time with
`npm run governance:rulesets -- --branch <dev|main|www> --apply`. Apply fails
unless the target branch already contains the exact governed CODEOWNERS file
and a recent merged pull request to that branch has a successful run for every
required check context. CODEOWNERS must land in `dev`, then ride the explicit
promotion into `main` and a separate handoff into `www` before either ruleset
is applied. The `www` handoff must also add the repository `.nvmrc`, which is
not present on the current `www` branch, before its workflows use
`node-version-file`. Installing a review or check rule before its base-branch
policy, pinned toolchain, and workflow exist can lock the branch with an
impossible condition.

Release preparation is also PR-only. Dev prep starts from current `origin/dev`
and returns through a reviewed PR to `dev`. Production prep starts from current
`origin/main` after any required product promotion and returns through a
release-only PR to `main`. `release-publish.sh` tags only an exact merged remote
commit and never instructs a protected branch push.

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

The outcome writer appends a matching authenticated control event. Unsigned
historical ledger lines, replayed event IDs, mismatched actors, and evidence
that does not match the event are ignored by the planner. The ledger entry and
control event both bind the exact canonical task revision produced by the
transition.

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
provider-visible path set. Its `diffSha` must equal the hash of the full
committed binary diff from `origin/<base>...HEAD`. It records `approvedBy`, an
`control-task` approval source, and one provider scope for every approved path.
Provider names inferred from provider-specific paths must match that scope. The
owner grants the packet's canonical SHA-256 digest to the referenced task using
the private one-time owner bootstrap. The publish helper verifies that digest
against the canonical task manifest. Any branch edit invalidates the record.
The authenticated local record does not replace external CODEOWNER review. The
publish helper always keeps the PR in draft. After exact-head CODEOWNER review,
the owner performs a separate authorized ready transition through GitHub.

See [W1-06](stability-tasks/W1-06-provider-visible-single-source.md) and the
fingerprinting stop sign in [AGENTS.md](../AGENTS.md) for the full publish
contract.

## Operator checks

```bash
npm run validate:automations
npm run validate:host-automations
npm run validate:roadmap
npm run governance:rulesets
node --test scripts/automation-control.test.mjs
node scripts/automation-control.mjs task list
node scripts/automation-control.mjs lease show --name nightly-writer
```

If another pass owns an active writer lease, do not start duplicate work. If a
lease expired, acquire it normally so takeover is recorded. When nothing safe
is actionable, append a compact no-op event, release the lease, and finish.
