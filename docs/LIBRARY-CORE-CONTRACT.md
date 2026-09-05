# Freed SQLite Library Core Contract

This document defines the durable and synchronized Library contract for Freed
Desktop, the headless Primary, and the PWA. The architectural overview lives
in [LIBRARY-CORE-ARCHITECTURE.md](LIBRARY-CORE-ARCHITECTURE.md). Delivery state
lives in [STORAGE-ARCHITECTURE-ROADMAP.md](STORAGE-ARCHITECTURE-ROADMAP.md).

## How to read this contract

Read this index before every Library Core change. Its source, invariant, failure, privacy, proof, and retirement rules apply universally. Read every chapter whose trigger matches the requested operation before design or edits. Follow all matching routes for changes spanning several operations. Chapters are authoritative maintained prose; the executable JSON contract generates code bindings, not these chapters.

Do not load every chapter by default. Record the selected chapter paths and total bytes in the task evidence. A bundle above 32 KiB requires a written reason describing which interacting authority boundaries make it necessary; never drop a required chapter to meet the threshold.

## 1. Source of truth

Freed uses SQLite everywhere.

The machine-readable contract begins at
`packages/shared/src/library-core/sqlite-contract-v1.json`. Generation writes
matching TypeScript and Rust bindings. The final physical catalog is
`packages/shared/src/library-core/normalized-schema-v1.sql`. Both bindings
consume those exact SQL bytes and the generator binds them to one SHA-256.
Generated files are never edited by hand.

The contract has independent monotonically increasing versions for:

- contract source
- physical SQLite schema
- logical wire protocol
- canonical codec
- mutation program catalog
- query program catalog
- checkpoint registry
- content descriptor and range-index formats

An unknown version fails before a client mutates or activates a database. A
version change never silently enables a fallback engine.

## 2. Core invariants

1. SQLite is the only Library row store on Freed Desktop, the headless Primary,
   and the PWA.
2. `shellJson`, `DocState`, Library shells, whole-document state, and whole
   FeedItem checkpoint payloads have no runtime, transport, fallback, rollback,
   or proof role.
3. There is no dual write and no compatibility authority.
4. Every durable product write is a registered typed mutation.
5. Every product read is a registered bounded SQLite query.
6. React retains visible windows and ephemeral interface state only.
7. One active Primary writer epoch admits canonical mutations.
8. Followers are fully queryable SQLite replicas. They propose edits through
   signed intent transactions and apply signed canonical results.
9. Synchronization exchanges typed logical records. It never exchanges a
   SQLite database, WAL, SHM, or rollback journal.
10. Large content is content addressed and hydrated independently from Library
    metadata.
11. Provider sessions, credentials, cookies, capture timing, device layout,
    local caches, and content hydration policy never enter synchronized Library
    records.
12. Every accepted write, import, checkpoint activation, authority transition,
    backup, restore, and destructive cleanup has a durable receipt.

## 3. Runtime ownership

For native hosts, headless service, actor transport, worker boundaries, credentials, or runtime ownership, read [Runtime ownership](library-core-contract/runtime-ownership.md).

## 4. SQLite database contract

For database opening, schema, catalogs, constraints, or normalized tables, read [SQLite database contract](library-core-contract/sqlite-database.md).

## 5. Authority and writer epochs

For writer admission, authority tuples, epoch transitions, or actor capabilities, read [Authority and writer epochs](library-core-contract/writer-authority.md).

## 6. Mutation contract

For canonical or device-local writes, mutation programs, materialization, actor enrollment, or retirement, read [Mutation contract](library-core-contract/mutations.md).

## 7. Follower intents and Primary results

For follower edits, optimistic state, result settlement, staging, replication, or Primary coordination, read [Follower intents and Primary results](library-core-contract/follower-intents.md).

## 8. Query contract

For queries, cursors, projections, visible windows, aggregates, or invalidation, read [Query contract](library-core-contract/queries.md).

## 9. Normalized checkpoint v2

For checkpoint export, import, snapshots, descriptors, or database selection, read [Normalized checkpoint v2](library-core-contract/checkpoints.md).

## 10. Operation synchronization

For operation synchronization, replication, removal materialization, or transport manifests, read [Operation synchronization](library-core-contract/operation-sync.md).

## 11. Selective content plane

For content descriptors, ranges, hydration, caches, eviction, or garbage collection, read [Selective content plane](library-core-contract/selective-content.md).

## 12. PWA and iPhone behavior

For PWA persistence, iPhone support, suspension, quotas, or cross-tab reset, read [PWA and iPhone behavior](library-core-contract/pwa-runtime.md).

## 13. Migration and cutover

For migration, fresh genesis, source readers, startup cutover, recovery, or retirement, read [Migration and cutover](library-core-contract/migration.md).

## 14. Failure semantics

The following failures preserve the last accepted database and return a typed
error:

- unknown schema, contract, registry, protocol, or query version
- catalog or application-identity mismatch
- stale writer epoch or actor capability
- actor sequence, chain, signature, or transaction failure
- oversized, malformed, duplicate, missing, or reordered wire record
- checkpoint or materialized-state digest mismatch
- missing, corrupt, or wrongly sized content
- stale query cursor
- quota, disk-full, permission, durability, or OPFS failure
- ambiguous cloud mutation response
- interrupted migration, import, backup, restore, or cleanup

Ambiguous immutable-object creation is resolved by exact readback. Ambiguous
compare-and-swap is resolved by reading the authoritative tuple. The system
never guesses success and never invents a new operation identity on retry.

## 15. Observability and privacy

Diagnostics expose bounded counts, durations, byte totals, queue depths,
database generation, schema and protocol versions, checkpoint identity, actor
tip summaries, content hydration totals, and typed error codes.

Diagnostics never include credentials, cookies, provider response bodies,
private keys, content bytes, complete item bodies, shell-shaped state, or an
unbounded list of identities.

## 16. Performance and memory budgets

Initial blocking budgets at 25,000 representative items are:

| Operation                                   |                          Budget |
| ------------------------------------------- | ------------------------------: |
| Warm bounded page query p95                 |                           50 ms |
| Cold bounded page query p95                 |                          150 ms |
| Navigation counts p95                       |                          100 ms |
| Search p95                                  |                          150 ms |
| Commit and materialize 1,000 captured items |                          500 ms |
| Logical checkpoint record                   |         131,072 canonical bytes |
| Decoded checkpoint page                     | 2,097,152 bytes and 128 records |
| Native export response                      |          1,048,576 source bytes |

Renderer retained Library DTOs have one shared 48 MiB settled pool and 64 MiB
burst pool. SQLite cache budgets are selected from 32 MiB, 64 MiB, and 128 MiB
by host memory class. A PWA worker and native exporter retain at most one
bounded query page, record, chunk, or response buffer per active operation.

Dedicated performance evidence also runs at 100,000 items. No performance
budget permits an unbounded result or corpus-sized JavaScript allocation.

## 17. Required proof

Activation requires deterministic evidence for:

- generated-source drift and registry exhaustiveness
- Rust and TypeScript canonical byte parity
- schema catalog and named SQL result parity
- all mutation crash boundaries and exact retry
- actor enrollment, capabilities, retirement, forks, and epoch fencing
- every bounded query on Desktop and supported PWA browsers
- checkpoint record, page, manifest, staging, activation, and corruption paths
- maximum legal value chunking and exact reassembly
- operation, intent, and result duplication, loss, reordering, and response loss
- selective content streaming, caching, pinning, exclusion, and garbage
  collection
- one-time migration closure and SQLite-only cutover
- backup, restore, authority recovery, and roll-forward recovery
- physical iPhone suspension, quota, OPFS, and offline playback behavior
- installed Freed Desktop memory, performance, sync, and recovery behavior
- absence of Automerge, shells, shadow stores, IndexedDB Library rows, generic
  patches, whole-document queries, and fallback flags from runtime bundles and
  callers

Tests that skip on their executing platform are not proof. The version 2
release activation manifest records one exact SQLite storage-epoch transition
and one retired-engine boundary. It binds the immutable digest of the
superseded version 1 audit history, but current declarations accept only
fail-closed, roll-forward recovery semantics. Release approval does not itself
execute a migration, contact a provider, install a build, or change live data.

## 18. Explicit deletion requirement

The implementation is incomplete while any runtime caller can reach:

- Automerge runtime, worker, persistence, merge, or cloud code
- `shellJson`, `shell_json`, `DesktopLibraryShell`, `DocState`, or an equivalent
  Library aggregate
- `00_library_shell` or ordinal logical identity
- whole FeedItem JSON checkpoint transport
- shadow schema, shadow store, shadow reader, or compatibility lease
- IndexedDB Library rows, indexes, checkpoints, cursors, intents, results,
  overlays, or search postings
- whole-corpus subscriptions or renderer collections
- generic JSON patch or toggle mutation authority
- SQLite database, WAL, SHM, or rollback-journal cloud transport
- a rollback flag capable of reviving a retired engine
- version 1 operation-segment records, preparation and import helpers, the
  dormant browser operation-segment bridge, or its retired canonical digest
  domain
- retired shadow-generation registries, version 1 Saved analytics or generic
  surface-item contracts, and descriptive merge-algebra exports without a
  final runtime caller
- retired full-corpus identity graph models, layout workers, renderers, repair
  passes, or performance gates that do not execute the shipping SQLite source
- renderer Saved re-ranking or tag-collection fallbacks that derive query
  results from FeedItem arrays
- Friend, map, or graph-activity helpers that derive identity state from
  complete Person, Account, or FeedItem dictionaries
- a direct Friends Galaxy whole-source worker request or caller-side source
  queue outside normalized SQLite page staging
- query registry names without one generated SQLite program and a final
  product caller
- unused migration, repair, export, test, or authority vocabulary with no final
  product requirement

The one-time source reader may remain only until the migration receipt and
activation evidence are complete. It is then removed from production bundles.
