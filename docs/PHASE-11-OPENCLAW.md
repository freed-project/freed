# Phase 11: Headless Library Authority and Agent Integrations

> **Status:** 🚧 In Progress (the shared Primary coordinator, normalized native SQLite authority, local process lease, native and PWA actor capability enforcement, fail-closed service supervisor, descriptor-bound normalized sidecar startup, bounded checkpoint and query ingress, and native authority-key mutation admission have landed; installed Drive coordination, production v2 issuance and retirement, and capture workers remain open)

> **Architecture:** The headless Primary and Freed Desktop consume the
> same extracted native Rust Library Core and the same stock SQLite contract.
> PWA and Desktop followers query local SQLite replicas and submit signed
> intents. No role opens another device's database, transfers SQLite files, or
> reconstructs a Library shell.

> **Dependencies:** Phase 2 (Capture layers), Phase 4 (Sync)

---

## Objective

Freed must support one authoritative Library Core on an always-on machine while
Freed Desktop and the PWA remain fully editable clients. The authority may run
inside Freed Desktop or in a future headless service. Both hosts must use the
same SQLite journal, immutable Google Drive protocol, actor admission rules,
and exact checkpoint receipts.

This phase also creates a safe boundary for OpenClaw, OpenClaude-style agents,
self-hosted automation, RSS capture, and future social capture workers. Workers
submit signed operations. They never open the authority database, hold the
Library authority key, or receive the Google Drive refresh token.

The complete product has four roles:

1. The Primary is the only process allowed to advance the cloud control head.
2. Editable followers apply local edits immediately, publish signed intents,
   and import canonical results from the Primary.
3. Reader clients import verified immutable checkpoints into bounded local
   SQLite. The production PWA uses official SQLite WebAssembly over OPFS.
4. Capability-bounded workers submit only the operation types and source scope
   granted by the Primary.

---

## Non-negotiable boundaries

- Google Drive carries immutable logical checkpoints, signed operation
  segments, signed result segments, enrollment records, and control receipts.
- SQLite files, WAL files, SHM files, and rollback journals never enter cloud
  transport.
- Automerge is not an authority, transport, fallback, or bridge.
- One operating system lock is held before any process opens the authority data
  root. A second process exits with an attributable refusal.
- The cloud writer decision remains the exact Google Drive control compare and
  swap. A local process lock and the cloud writer decision solve different
  races, and both are required.
- Missing writer admission, unreadable control state, a stale epoch, a retired
  actor, or a changed signed envelope fails closed.
- A worker never receives a SQLite path, authority private key, Drive token, or
  another actor's signing key.
- Social provider behavior remains off until the owner approves the exact
  provider, request pattern, cadence, browser behavior, and fingerprinting
  risk. Headless authority work does not grant social provider traffic.
- No migration copies a live SQLite database, WAL file, or SHM file between
  machines.

---

## Shipped foundation

The current product already provides the protocol foundation:

- Freed Desktop stores the active Library in bounded SQLite.
- The PWA stores its Library in official SQLite WebAssembly over OPFS. It
  imports authenticated immutable normalized checkpoints without an IndexedDB
  Library store.
- Editable Freed Desktop followers exchange signed intents and canonical
  results without becoming the writer.
- The Primary publishes immutable checkpoints and a durable exact revision
  receipt.
- One operating system backed Library data-root lease prevents two local Freed
  processes from opening the same authority root.
- `@freed/sync` owns a provider-neutral Primary coordinator with injected
  authority, durable state, credential, clock, scheduler, fetch, publication,
  and diagnostic ports.
- Freed Desktop is the production consumer of that shared coordinator.
- Freed Desktop performs one immediate publication attempt, checks local
  revisions every 15 seconds, and refreshes inbound actor work every 60
  seconds.
- `freed-library-core` now owns the normalized SQLite schema, signed journal,
  actor enrollment, authority epochs, exact product projection, bounded typed
  queries and mutations, normalized checkpoint activation, process lease, and
  fixed-fd authority sidecar without importing Tauri or contacting a provider.
- Normalized SQLite binds every actor to an authority-signed version 2
  capability. Editor, scraper, and agent certificates bind an exact operation
  subset, explicit scope, issuance identity, and retirement identity. The
  final schema rejects version 1 actors. Historical actor policy is readable
  only inside the fenced one-time source verifier.
- Freed Desktop invokes the reusable native package through thin data-root,
  snapshot-directory, and platform-vault adapters. Its active commands expose
  only normalized SQLite queries, mutations, checkpoints, and snapshots.
- `@freed/library-service` validates one explicit Primary role, private roots,
  admission and credential descriptors, an exact sidecar digest, descriptor
  bound authority inputs, a private lifetime watchdog, and whole process group
  settlement before it starts one sidecar. Its local status and doctor
  commands never open SQLite or start social provider work.

These pieces do not yet create a complete installed headless authority. Drive credentials
remain owned by the Freed Desktop renderer. The native sidecar acquires the
data-root lease before opening only the final normalized SQLite catalog in the
private `library-sqlite` directory. It verifies the exact schema, application,
contract, and protocol identity before it reports ready. It creates no
historical checkpoint store or snapshot tree. Its closed command channel
exposes bounded normalized checkpoint, query, Primary mutation context,
operation signing, canonical commit, follower-intent admission, actor
transport state, and result-export commands. The mounted credential is one
closed version 1 record bound to one Library ID, one authority Ed25519 key, and
one Primary actor Ed25519 key. It is read from an owner-only regular file under
the held state-root descriptor. Decoded keys remain only in zeroizing native
memory. Node, command frames, logs, SQLite, and cloud adapters never receive
them. Growth beyond the bound, partial read failure, invalid keys, a foreign
Library identity, or post-read identity or metadata drift fails closed. This
record proves local Primary key custody only. It does not contain a Drive
token, claim Drive authentication, or make the service cloud-ready.

Freed Desktop retains the historical checkpoint store only as fenced migration
input while the one-epoch normalized cutover is completed. The headless
sidecar never opens that store. The sidecar command channel calls normalized
checkpoint staging, pinned export, and registered query functions directly. It
does not translate the old import, status, database-copy, or whole-item DTOs.
Canonical mutation admission now loads the established authority and Primary
actor keys only inside the native sidecar. Installed headless Drive
coordination and its separate OAuth custody remain unshipped.

The macOS and Linux native authorities never reopen a verified root through a
discovered pathname and never change the process working directory. A shared
SQLite VFS router maps one opaque, closed logical database name to an already
open physical directory. Every database, WAL, SHM, rollback-journal, status,
import, and later connection open then uses `openat` with `O_NOFOLLOW` beneath
that descriptor. The sidecar holds fd4 through this route. Freed Desktop binds
its app-data and `library-core` directories before it acquires the process
lease. Normalized snapshot creation, listing, restore staging, retention, and
clearing stay relative to a held private directory descriptor. Deterministic
root replacement and final-leaf swap tests prove that the original lease,
SQLite files, and snapshots remain bound while replacement roots and symbolic
link targets stay untouched.
Startup also proves EOF and exact post-read metadata for fd3, fd6, and fd7.
Snapshot retention derives every file name from a canonical digest identity
and deletes only validated archives relative to the already-open snapshot
directory. Corrupt path-shaped metadata cannot escape that directory or delete
the live database.

---

## Target architecture

```text
Agent or capture worker
        |
        | signed, capability-bounded operation intent
        v
Private local socket
        |
        v
Headless Library service
  |     |     |
  |     |     + local status, receipts, and diagnostics
  |     + shared Primary coordinator
  + native SQLite authority sidecar
        |
        | immutable logical protocol only
        v
Google Drive
        |
        + Freed Desktop editable followers
        + authenticated PWA SQLite readers
```

### Native Library package

`packages/library-core-native` will be a reusable Rust library extracted from
the existing Tauri modules. It owns:

- SQLite schema and migrations
- signed operation journal and materializer
- actor enrollment and capability verification
- authority epochs and writer admission
- normalized local snapshots and forward-only restore
- local data-root process lease
- injected key store, clock, and durable-state traits

It accepts an explicit data root. It does not accept a Tauri application
handle. Freed Desktop exposes the native contract through a thin adapter.

### Shared Primary runtime

`@freed/sync` remains the only Primary cloud coordinator. Freed Desktop and the
headless service inject different host ports into the same state machine. The
coordinator is responsible for:

- immediate checkpoint publication
- local revision polling
- actor enrollment discovery
- intent import and canonical result publication
- checkpoint refresh and exact receipt persistence
- writer ownership loss and role loss fencing
- bounded, secret-free diagnostics

### Headless service

`packages/library-service` will provide a Node supervisor and a single native
authority sidecar. Only the sidecar opens SQLite and holds the local process
lease. The first production service exposes no public network listener.

The sidecar uses stdin and stdout once for the closed startup control protocol.
Control protocol 2 binds fixed inherited descriptors 3 through 10. Descriptor
8 is the lifetime watchdog. Descriptor 9 carries command requests and
descriptor 10 carries command responses. Every command frame has a four-byte
unsigned big-endian length and a generated 4 MiB maximum. The independent data
command protocol is version 1. It accepts only the generated command registry,
one 64-character request ID, and exact payload fields. The registry contains
normalized checkpoint begin, append, finalize, pinned export, registered
query, storage-inspection, Primary context, signing, canonical transaction,
follower-intent admission, actor-state, and bounded result-export commands. Startup performs one storage inspection
and verifies the exact generated application, contract, schema, wire protocol,
and schema digest before the supervisor reports running. A malformed,
truncated, oversized, unknown-version, or broken transport frame fails closed.

One strict v1 admission record binds the exact start envelope, executable
digest, data and state root identities, and credential descriptor digest. Only
one private bounded `freed_library_primary_credentials_v1` mounted record is
accepted today. It binds exact Library identity plus authority and Primary
actor Ed25519 keys. Parsing, identity checks, and signing happen only in the
native sidecar, with decoded keys held in zeroizing memory. `os-vault`, Drive
OAuth, cloud writer readiness, and every provider request fail closed or
remain absent until task 11.5. A true ready receipt proves local native signing
custody, not cloud authentication or writer promotion.

Planned commands:

```text
freed-library init
freed-library drive-auth
freed-library promote
freed-library serve
freed-library sync-now
freed-library checkpoint-now
freed-library backup-now
freed-library status
freed-library doctor
```

`promote` requires the exact expected cloud control revision, manifest digest,
source receipt, and owner confirmation. It creates a new writer epoch. It
never adopts an old local database as the cloud head.

### Secrets

The headless Primary authority and writer actor keys share one atomic native
signing bundle bound to one Library. Google refresh tokens and future provider
credentials remain separate secret records. They never appear in SQLite,
backups, cloud objects, command arguments, environment values, logs, or bug
reports.

macOS and Windows use their platform credential vaults. Linux uses an injected
secret store. The first Linux implementation should use a versioned sealed
file whose wrapping key is supplied as a mounted credential file. An
environment variable is not an acceptable wrapping-key source.

Headless Drive authorization uses PKCE through the existing Freed OAuth proxy.
It requests only the Drive scopes needed by Library Core. Google Contacts
remains a separate permission and a separate runtime.

---

## Actor capabilities

An enrolled identity proves who signed an operation. A capability certificate
also proves what that actor may do.

The capability certificate binds:

- Library ID and writer epoch
- actor ID and actor class
- exact allowed operation types
- optional source or provider scope
- issuance identity and retirement identity
- size bounds and canonical signature domain

New actors use explicit classes:

- `editor` may perform the exact user-edit operations listed in its
  certificate.
- `scraper` may submit only capture upserts for its approved source scope.
- `agent` may read through bounded APIs and submit only its approved edits.
- `service` may perform authority maintenance only when the active writer
  epoch grants it that role.

Source-scoped ingestion remains disabled until the signed operation envelope
contains one canonical source field. The verifier must not infer scope from
inconsistent entity payloads.

Retirement requires a signed authority action, durable propagation through a
checkpoint, and denial on every replay path. Editing a local cache is not a
retirement mechanism.

The reusable native core enforces v2 certificates before ingestion and
rechecks the exact signed capability under the immediate commit transaction.
Scraper certificates can name only FeedItem capture. A bounded
provider or source scope fails closed because the current operation envelope
has no canonical scope field, and the verifier never infers scope from entity
payloads. Same-actor causal tips, stale epochs, retired actors, missing
capabilities, changed or conflicting replays, and operations outside the
signed set all fail without an authoritative write. An exact response-loss
retry may retrieve its old receipt only while the local writer remains
admitted, the epoch is active, the actor is not retired, and its exact signed
capability remains unchanged and authorizes every operation. Those conditions
are rechecked under the immediate commit transaction before the receipt is
returned, and retrieval creates no new outbox result.

The PWA consumes the shared production v2 verifier and stores exact
certificate bytes and signed capability fields in OPFS SQLite. It reverifies
them before local intent admission and imported operation admission. Changed
persistence, a stale epoch, a retired actor, bounded scope without an envelope
binding, version 1 capability rows, and operations outside the signed set all
fail before a SQLite write. Checkpoint activation cannot import a historical
actor capability into the selected generation.

Production v2 issuance remains dormant. No production entry point exports the
certificate constructor, and neither Freed Desktop nor the headless service
publishes v2 certificates. Authority-signed retirement application and
checkpoint propagation remain task 11.9. The PWA importer must ship before a
later reviewed slice enables issuance, because an older PWA cannot import a v2
certificate that has entered production sync.

Schema v12 also has an installed release prerequisite. Once the authoritative
Primary migrates a Library, the v26.8.1900 schema v11 binary cannot reopen it.
Every participating Freed Desktop installation must first run a schema v12
capable release. Rollback after migration is forward-only through another
schema v12 capable release. Task 11.8 completion records the dormant source and
validation slice. It does not claim that the upgrade, migration, or installed
activation has happened.

---

## Agent and capture boundary

The first ingress API uses a private Unix socket or Windows named pipe that is
restricted to the service account. Requests are bounded, signed, replay
protected, and mapped to Library Core operations. Signature verification does
not replace transport limits or rate limits.

The first useful agent surface provides:

- bounded search
- bounded item detail reads
- bounded Saved and Friends reads
- signed user-state edits
- signed link saves
- signed feed item capture for capability-approved actors
- exact operation and result receipts

RSS and explicit link saves are the lowest-profile capture workers. Social
capture workers come later. Each social provider receives its own review and
acceptance pass. Moving a provider from the current Freed Desktop WebView to a
cloud browser changes its observable browser identity and requires fresh owner
approval even if the extraction code is similar.

Workers do not use fixed example cron schedules. They preserve the approved
provider cadence, quiet hours, randomized timing, login behavior, and request
graph. A scheduler may run only when the service reports both cloud-ready and
provider-ready.

---

## Migration from a Freed Desktop Primary

1. The current Primary publishes one exact checkpoint and creates one closed
   local backup.
2. Record the local revision, item count, control revision, writer epoch,
   writer ID, manifest digest, Drive object ID, and backup digest.
3. Start the headless service as a read-only importer against a fresh data
   root.
4. Import the exact checkpoint and verify item count, materialized digest,
   actor frontier, and source receipt.
5. Promote only with the recorded expected control revision and manifest
   digest. The service creates a fresh writer epoch and wins one exact control
   compare and swap.
6. Confirm that the former Primary refreshes control, loses writer admission,
   and continues as an editable follower.
7. Confirm that the authenticated PWA imports the same manifest into SQLite
   WebAssembly over OPFS.

The former Primary is never restored by copying its database into the service.
The service is never seeded from an older follower database.

---

## Recovery and rollback

Before the promotion compare and swap, the headless importer can be stopped and
discarded without changing authority.

After promotion, rollback means another forward writer transfer:

1. Stop capture workers.
2. Preserve the current service data root and receipts.
3. Import the latest verified checkpoint into the recovery host.
4. Create a new writer epoch through an exact control compare and swap.
5. Confirm that the former service observes the newer control and fences
   itself.

Code can roll back to a previous signed binary. Library data does not roll back
to an older live database. A verified normalized snapshot is restored only
into a new authority epoch with an attributable replay-safe restore receipt.

---

## Omi integration

Omi remains a future actor integration. It does not write Automerge state and
does not receive direct database access.

The intended flows are deliberate:

1. A user-triggered voice capture submits a signed Saved note intent through a
   capability-bounded Omi actor.
2. A separately approved reading-context worker sends a bounded digest to Omi.

Ambient Omi memories are not bulk imported. Omi API keys and webhook secrets
use the service secret store. Webhook exposure, request authentication,
retention, and outbound digest cadence require their own security and provider
review before implementation.

---

## Task ledger

| Task | State | Description |
| --- | --- | --- |
| 11.1 | Complete | Share the provider-neutral Primary coordinator from `@freed/sync` and consume it from Freed Desktop |
| 11.2 | Complete | Enforce one operating system backed Library data-root lease before SQLite opens |
| 11.3 | Complete | Extract the reusable native SQLite authority package without changing Tauri behavior |
| 11.4 | Complete | Add the headless service supervisor, explicit role config, and fail-closed startup |
| 11.5 | Open | Add Drive PKCE setup and platform-safe secret stores |
| 11.6 | In Progress | Open final normalized SQLite behind the descriptor-bound sidecar and provide generated bounded checkpoint, pinned export, registered query, Primary signing, canonical commit, follower-intent admission, actor state, and result export commands; bind installed Drive coordination next |
| 11.7 | Open | Add exact writer promotion and 60-second Primary actor processing |
| 11.8 | Complete | Prove actor capability certificates and the frozen transition policy in native SQLite. Phase 6 carries the same proof into PWA SQLite before activation. |
| 11.9 | Open | Add signed retirement application and checkpoint propagation |
| 11.10 | Open | Add a private local actor socket with bounded request and replay controls |
| 11.11 | Open | Add bounded agent search, read, and signed edit APIs |
| 11.12 | Open | Add provider-neutral RSS and explicit-save workers |
| 11.13 | Blocked | Add social capture workers after provider-specific owner approval |
| 11.14 | Open | Package Linux services, macOS launch agents, and Windows services |
| 11.15 | Open | Complete installed Primary migration and editable follower acceptance |
| 11.16 | Open | Complete forward recovery, competing-Primary, and fault-injection acceptance |
| 11.20 | Open | Define the signed Omi actor and user-triggered voice capture contract |
| 11.21 | Open | Implement authenticated Omi ingress with bounded retention |
| 11.22 | Open | Implement the separately approved bounded reading-context export |

---

## Acceptance criteria

- [ ] A headless service imports a verified checkpoint into a fresh SQLite
  generation without copying a SQLite file from another host.
- [ ] One exact writer promotion succeeds and a competing Primary loses the
  same control compare and swap.
- [ ] The losing process durably fences itself before any further cloud or
  provider work.
- [ ] A Primary checkpoint receipt and an authenticated production PWA receipt
  name the same Library, epoch, generation, manifest digest, Drive object ID,
  item count, and exact revision.
- [ ] A Freed Desktop follower makes a local edit, publishes one signed intent,
  receives the canonical result, and retains the edit after checkpoint refresh.
- [ ] A real-size Library with at least 19,000 items preserves exact item count,
  materialized digest, actor frontier, and bounded memory through migration.
- [ ] Two processes against one data root produce exactly one lease holder.
- [ ] Missing admission, stale epochs, retired actors, changed or conflicting
  replays, oversized batches, and operations outside a capability all fail
  with zero writes. An exact response-loss retry returns the old receipt only
  for a currently admitted writer, active epoch, active actor, and unchanged
  capability, with zero new writes or results.
- [ ] Crash and response-loss injection covers SQLite commit, object upload,
  manifest upload, control compare and swap, result publication, and backup.
- [ ] Secret scans find no key or token in arguments, environment values, logs,
  state JSON, SQLite, backups, manifests, or bug reports.
- [ ] A Drive call ledger proves that SQLite, WAL, SHM, and rollback journal
  files were never uploaded.
- [ ] Social workers remain unable to start until their exact provider gates
  and installed acceptance are complete.
- [ ] Linux x86_64 and arm64, macOS, and Windows service lifecycle tests pass.

---

## Deliverable

One Library can run continuously on an owner-controlled machine or cloud host.
Freed Desktop and the PWA remain ordinary editable clients. Agents and capture
workers use narrow signed capabilities, while the authority database, cloud
credentials, and provider sessions stay isolated. The system can move Primary
authority forward without creating split heads or copying live database files.
