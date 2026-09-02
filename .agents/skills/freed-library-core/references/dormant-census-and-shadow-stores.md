# Dormant census and shadow stores

## Keep the dormant census honest

The checked-in Gate A census is a compiler-enforced inventory, not activation
authority:

- synchronized schema work updates
  `packages/shared/src/library-core/field-registry.ts`;
- shared store contract work updates
  `packages/shared/src/library-core/store-surface-registry.ts`;
- Desktop and PWA worker message changes update the platform-owned
  `library-core-worker-surface-registry.ts` beside each worker type union;
- planned operation or query vocabulary changes update the corresponding
  shared registry;
- localStorage, IndexedDB, Cache API, Tauri store, native file, Keychain, or
  operating-system session ownership changes update
  `local-authority-registry.ts`.

Run the focused registry tests and the affected platform typechecks. A new
schema leaf, store method, or worker message must fail typecheck until
classified. Current authority and planned authority remain separate. An
unresolved codec, algebra, projection, retention limit, platform locator, or
migration rule stays typed as blocked instead of receiving a plausible
placeholder.

Never infer activation from registry presence. The combined census must keep
`activationAllowed: false` until every blocker is closed and the exact
transition is recorded through the activation manifest and its required
receipt.

## Keep dormant SQLite honest

The native and browser shadow stores share the versioned migrations under
`packages/shared/src/library-core/shadow-schema-v*.sql`. Rust consumes those
files with `include_str!`; the shared TypeScript contract must prove its
generated DDL is byte-equivalent after whitespace normalization. Do not add a
second handwritten native schema.

Do not trust `PRAGMA user_version` by itself. Before accepting an authoritative
database, compare its complete non-internal table, index, trigger, and view
catalog against a fresh reference generated from the checked-in schema for
that version. A missing or additional object fails closed before authority
state is read or written. Integrity checking and catalog identity are separate
contracts. Neither substitutes for the other.

Bind every authoritative physical schema to one fixed SQLite `application_id`
and verify it with `user_version` before accepting the live catalog. A blank
file may have identity zero before first initialization. Any other preexisting
identity, or any missing or changed identity on a versioned file, fails closed.
The header marker proves database kind only. It does not prove page integrity.

Enable defensive mode, disable trusted-schema behavior, and enable
`cell_size_check` on every authoritative SQLite connection. This blocks
dangerous database configuration changes, prevents schema text from invoking
privileged application functions, and checks B-tree cell structure when each
page is read. It adds bounded incremental corruption detection without a full
startup walk. It does not validate unread pages, cross-page relationships,
application invariants, or external blobs.

Open an authoritative SQLite database with URI interpretation disabled and
private-cache, extended-result-code, and `SQLITE_OPEN_NOFOLLOW` flags enabled.
A configured path names one ordinary database file. It cannot smuggle SQLite
URI parameters, join SQLite's discouraged process-global shared cache, or
redirect the final component through a symbolic link. Resolve the existing
parent directory before opening so a system-level path alias does not defeat
the final-file check. Parent-directory and root identity remain a separate
production-opener contract before activation.

Lower SQLite's per-connection run-time limits to the registered Library Core
contract before compiling schema or query SQL. Bound strings and rows above
the 4 MiB canonical payload ceiling, and cap SQL length, columns, expression
depth, compound terms, function arguments, attached databases, pattern bytes,
variable indexes, trigger depth, and auxiliary worker threads. These limits
contain parser and row allocations for malformed files or accidental future
queries. They do not replace payload validation, bounded result paging,
database-size policy, or an authenticated production file locator.

On macOS, pair `synchronous=FULL` with SQLite `fullfsync=ON` for the
authoritative journal. This makes SQLite request `F_FULLFSYNC` for commit and
checkpoint synchronization instead of relying on ordinary `fsync`, which may
leave data in a drive's volatile cache. The later activation gate must measure
the resulting commit latency on supported storage. Do not weaken this receipt
durability promise to hide a slow device.

Disable SQLite's legacy double-quoted string-literal fallback for both schema
and data statements. Checked-in SQL must use double quotes only for identifiers
and single quotes for string literals. A misspelled identifier must fail instead
of silently changing query meaning.

Before opening an existing authoritative file for writing, inspect its database
identity, physical version, and exact live catalog through a no-follow,
private-cache, read-only connection. A foreign, future, unversioned, or changed
file must be rejected without changing its database bytes or first receiving a
writable database handle. SQLite may still create ephemeral coordination
sidecars while reading a WAL-mode database. This preflight reduces accidental
mutation. Recheck the same identity and catalog on the exact read-write handle
before applying WAL or durability configuration, so a path replacement between
the two opens also fails without database mutation. This does not replace the
later authenticated storage-root handle and root-identity contract.

Apply projection upserts, deletions, and the monotone projection revision in
one database transaction. A bounded page or count binds one revision. A later
page using a cursor from an older revision fails closed instead of walking
across mixed projections. Prove the query plan uses the declared keyset index
without a temporary sort. Enforce the registered query limit at the adapter
boundary. Pin a physical schema version and set bounded busy handling, cache,
temporary storage, and mmap behavior explicitly even while the store is dark.

Bind every derived projection batch to one stable batch ID, canonical input
digest, and expected previous projection revision. Commit its rows, deletions,
revision advance, and durable receipt together. Bound each batch to at most
1,000 combined row upserts and deletion intents. Admit one 4 MiB canonical
source document plus no more than 64 KiB of bounded projection metadata so an
accepted source row always fits without weakening the source ceiling.
Exact retry after response loss returns the original receipt without
reapplying. Changed replay tuples, oversized batches, and incompatible
migration objects fail closed, and a receipt write failure rolls back the whole
batch. Keep this derived receipt explicitly separate from signed authoritative
operation receipts. It grants no mutation or activation authority.

A short-lived Automerge worker may populate and verify the derived shadow store
while Automerge remains authoritative. Bind that probe to one exact durable
frontier and storage revision, bound its retained index and every response, and
release the decoded document between requests. This is a compatibility bridge,
not the Gate C migration decoder. Any path that calls `Automerge.load`, retains
the complete change graph, or allocates source-sized memory cannot produce an
authoritative migration candidate, satisfy the external-memory migration
contract, or authorize cutover.

Build a derived shadow generation in a fresh staging database. Bind the durable
rebuild record to the exact source identity and declared row count. Commit each
sequential batch's rows, derived receipt, batch mapping, revision, cumulative
row count, and completion state in one transaction. Exact retry returns the
stored result. Partial generations are never readable. Close a rebuild only
when declared, projected, and actual row counts agree. Completion inside the
database is not file publication. A native adapter must close, verify, and
atomically publish the complete staging file before assigning it to a reader.
This remains derived shadow work and does not satisfy Gate C.

A browser shadow materializer may scan the already resident immutable
Automerge document only while the legacy worker remains authoritative. Derive
its source identity from the exact committed heads and storage revision, never
from renderer-supplied metadata. Count and project with bounded iteration.
Stage no more than one registered page at a time and let the row store's
compound key provide query order instead of allocating a corpus-sized sort
array. Each page needs an exact replay receipt and generation-plus-entity
uniqueness. A complete selected browser generation remains derived cache state,
does not prove the external-memory Gate C migration, and cannot receive a
product caller before the Gate D reader and renderer-eviction contract lands.

Publish a derived generation as a new immutable file. Checkpoint and remove
WAL mode, verify SQLite and the exact completed rebuild, close and sync the
staging bytes, perform one same-directory durable no-replace publication, then
verify the destination read-only. The publication primitive itself must reject
a racing destination. Exact readback is the response-loss path. Never overwrite
a prior generation or treat publication as reader assignment.
Production assignment still requires the trusted storage-root handle, a
generation transition, rollback state, and bounded cleanup.

A dormant engine has no production caller, opens no user database, emits no
authority receipt, and does not append an activation-manifest transition. It
may compile into Freed Desktop behind an explicit dark-module boundary. A
command registration, startup open, backfill, read route, or writer route is an
activation change and follows the corresponding gate.

When a closed field operation reaches the dark projection, update only its
registered columns. Do not rebuild or overwrite the full row. Validate current
projected state, apply the shared field algebra, advance the projection
revision, and commit the derived receipt in one transaction. Missing entities,
malformed current values, stale revisions, and receipt failures roll back
without repair. This derived path does not satisfy the authoritative operation
materializer blocker.
