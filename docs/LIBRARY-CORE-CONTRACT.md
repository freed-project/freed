# Freed SQLite Library Core Contract

This document defines the durable and synchronized Library contract for Freed
Desktop, the headless Primary, and the PWA. The architectural overview lives
in [LIBRARY-CORE-ARCHITECTURE.md](LIBRARY-CORE-ARCHITECTURE.md). Delivery state
lives in [STORAGE-ARCHITECTURE-ROADMAP.md](STORAGE-ARCHITECTURE-ROADMAP.md).

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
- field registry
- mutation registry
- query registry
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

### 3.1 Native core

`packages/library-core-native` owns the native SQLite implementation. It owns:

- database identity, opening, catalog verification, and migrations
- writer epoch and process exclusion
- actor enrollment, capability verification, and journal admission
- registered mutations and materialization
- registered bounded queries
- checkpoint export, staging import, and activation
- operation, intent, and result segments
- content descriptors, local vault access, and garbage-collection reachability
- backup, restore, integrity checking, and recovery receipts

Freed Desktop and the headless Primary are hosts of this crate. Tauri does not
own Library SQL, schemas, query semantics, or mutation semantics.

### 3.2 Browser core

The PWA runs official SQLite WebAssembly in a dedicated worker and persists the
database in OPFS. It consumes the same contract source, SQL bytes, canonical
vectors, query DTOs, checkpoint records, intent codecs, and result codecs as
the native core.

IndexedDB is not a Library database or fallback. It may contain only a narrow
nonextractable-key record when WebKit provides no equivalent key facility.

### 3.3 Interface layer

`packages/ui` receives a platform-neutral generated client with named query and
mutation methods. It cannot import Tauri APIs, OPFS APIs, SQLite handles, cloud
transport clients, or storage implementations.

## 4. SQLite database contract

One database represents one Library identity and one accepted writer epoch.
Opening verifies the exact application ID, schema version, contract version,
catalog objects, index definitions, foreign keys, journal mode, durability
settings, and active authority record before granting write access.

The final logical model contains normalized tables for:

- Library identity and active authority
- actors, capabilities, actor tips, and retirements
- transactions, operation members, receipts, and replication outbox entries
- feed items and registered feed-item child values
- RSS feeds and registered feed metadata
- people, accounts, reach-out events, and relationships
- synchronized preferences by registered leaf
- field clocks, entity generations, tombstones, and aliases
- follower intent transactions, sparse optimistic effects, publications, and
  canonical result receipts
- content descriptors, renditions, chunks, authenticated ranges, and canonical
  reachability
- device-local hydration policy, transfer progress, caches, and invalidations

FTS and RTree tables are derived SQLite structures. They are rebuilt from
canonical rows and never become independent authority.

JSON is allowed only for a closed canonical protocol object whose schema is
registered and bounded. Generic state JSON, arbitrary patches, monolithic
entities, and shell-shaped JSON are forbidden.

## 5. Authority and writer epochs

One accepted authority tuple identifies:

- Library ID
- epoch number and epoch ID
- authority key ID and public key
- accepted manifest generation
- accepted operation frontier
- checkpoint frontier and materialized-state digest
- registry and protocol versions

Only the active Primary may allocate canonical actor sequences and accept
canonical transactions. Freed Desktop may host the Primary. The headless
service may host the Primary. A follower never promotes itself because the
Primary is unreachable.

An authority transition is a signed compare-and-swap from one exact accepted
tuple to one successor tuple. Competing transitions select one winner by the
registered deterministic rule. A stale, sibling, downgraded, unknown-version,
or wrong-key writer fails before mutation.

## 6. Mutation contract

The generated mutation registry is exhaustive. It begins with 39 named product
mutations and grows only through an explicit contract version change. The
registry covers account, person, feed-item, RSS, preference, provider-result,
sample-library, repair, bulk, restore, and tombstone behavior.

Actor capability profiles live in this same executable contract. Generation
fails if a profile names an undeclared mutation. The legacy editor profile is
frozen at its existing 14 mutations and the scraper profile remains limited to
`feed_item_capture_upsert`. Declaring a future mutation does not grant it to
either profile. Rust and TypeScript consume generated profile constants, so no
second capability-operation registry can drift from the mutation catalog.

Each mutation definition binds:

- stable mutation ID and payload version
- closed input codec and maximum canonical bytes
- actor capability and writer-epoch requirement
- entity and relationship keys
- touched fields and merge algebra
- SQL materializer and expected affected-row bounds
- tombstone, cascade, and blob-reference effects
- invalidation topics
- replication behavior
- idempotency key and receipt shape

Saved and archived state form one coupled last-writer register. A winning save
sets saved and clears archived. A winning archive sets archived and clears
saved. Clearing either produces the neutral state. The register compares the
signed assignment time, then the operation ID as a deterministic tie breaker.
It stores one `saved_archive_state` clock, so concurrent operations converge
without ever materializing an item that is both saved and archived. Like state
uses the same bounded assignment rule with its own clock and clears its prior
provider receipt when a new local assignment wins. These mutations create no
provider traffic. Provider execution remains a separate registered mutation.

FeedItem removal writes a typed tombstone and deletes the normalized root in
the same transaction. SQLite cascades every owned child row. Removal clocks
compare the signed removal time and then operation ID, so a stale removal is
journaled and receipted without replacing the winning tombstone. A later
restore must be an explicit registered mutation that defeats and removes the
tombstone. No nullable-row convention represents deletion.

A successful Primary transaction atomically commits:

- complete operation members
- transaction aggregate
- actor sequence and chain tip
- canonical rows and derived-index queue entries
- field clocks, tombstones, and relationship effects
- receipt
- replication outbox entry
- invalidation topics

A crash exposes either all of those effects or none. Exact retry returns the
stored receipt. Reusing an identity with changed bytes fails closed.

There is no generic patch, toggle, merge-object, execute-SQL, or shell mutation
route. Product conveniences such as toggles read an exact current value and
submit a named assignment mutation with an explicit precondition.

## 7. Follower intents and Primary results

A follower edit atomically writes a signed intent transaction and its sparse
optimistic effect to local SQLite. The intent envelope binds:

- Library, epoch, actor, capability, and transaction identity
- contiguous actor sequence and previous chain tip
- canonical mutation members
- causal frontier
- creation time and expiry policy where applicable
- complete signature

The Primary verifies actor enrollment, capability, epoch, sequence, chain,
transaction completeness, canonical bytes, payload schema, and preconditions
before admission. It emits a signed result for every intent transaction:

- accepted, naming canonical operation and receipt identities
- rejected, with a closed reason and authoritative replacement projection
- already applied, naming the original result

The follower applies a result, removes or rebases the optimistic effect, and
advances its result cursor in one transaction. Response loss and duplicate
delivery are idempotent. An unknown provider-side outcome cannot authorize a
second provider side effect.

## 8. Query contract

The generated query registry contains bounded SQLite queries only. Whole
document reads and IndexedDB adapters cannot appear in it.

Every query declares:

- stable query ID and version
- closed request and response DTOs
- maximum rows, response bytes, nested values, and execution time
- stable total order and keyset cursor schema
- exact snapshot or change-frontier binding
- required indexes and accepted query-plan shape
- cancellation behavior and cursor expiry
- renderer cache and invalidation topics

Ordinary interactive queries return no more than 2 MiB. Reader content uses a
separate ranged API. Export, backup, and migration enumerate a pinned durable
checkpoint through bounded pages.

A cursor is opaque to the interface layer and binds the query version,
normalized filter digest, ordering keys, projection version, database
generation, and snapshot identity. A stale cursor returns `CURSOR_STALE`.

No query may scan or sort the full corpus in JavaScript. No query returns an
unbounded ID list. A view refreshes only invalidated pages and aggregates.

## 9. Normalized checkpoint v2

The checkpoint format is `freed_normalized_checkpoint_v2` and protocol version
2. The append-only registry begins with:

| Registry key | Primary key | Purpose |
| --- | --- | --- |
| `00_checkpoint_header` | singleton | Library, epoch, schema, registry, frontier, and state commitment |
| `10_feed_item` | item ID | normalized feed-item row |
| `11_feed_item_media` | item ID and ordinal | one media rendition reference |
| `12_feed_item_topic` | item ID and topic | one topic |
| `13_feed_item_tag` | item ID and tag | one user tag |
| `14_feed_item_highlight` | item ID and ordinal | one bounded highlight |
| `15_feed_item_signal` | item ID | signal classifier metadata |
| `16_feed_item_signal_score` | item ID and signal | one signal score and tag decision |
| `17_feed_item_event` | item ID | one event candidate |
| `20_rss_feed` | feed ID | normalized RSS row |
| `30_person` | person ID | normalized person row |
| `31_person_tag` | person ID and tag | one person tag |
| `32_person_reach_out` | person ID and ordinal | one bounded reach-out entry |
| `40_account` | account ID | normalized account row |
| `41_account_follow_role` | account ID and role | one provider roster role |
| `50_preference` | field key | one synchronized preference leaf |
| `60_relationship` | typed relationship tuple | one normalized relationship |
| `70_field_clock` | entity and field tuple | one accepted field clock |
| `80_tombstone` | entity tuple | one entity tombstone |
| `90_actor_state` | actor ID | enrolled actor and accepted tip |
| `a0_receipt` | receipt kind and ID | retained authoritative receipt |
| `b0_blob_descriptor` | content digest | content metadata and chunk plan |
| `b1_content_chunk` | content digest and chunk index | bounded content bytes when included |

The executable registry is authoritative. This table is explanatory. No
registry key or payload kind may contain `shell`. Identity is registry key plus
canonical typed primary key. Page number and ordinal are transport metadata,
not record identity.

Each record is a closed canonical object with:

- format
- protocol version
- registry key
- typed primary key
- closed typed payload

Finite fractional SQLite values use the registered
`ieee754_binary64_hex_v1` wrapper on the canonical wire. Native and browser
importers restore ordinary REAL values only after record and checkpoint
verification. This preserves every binary64 bit across clients.

The exact canonical UTF-8 record ceiling is 131,072 bytes. The producer measures
canonical bytes before append and flushes before crossing either page ceiling:

- 128 records
- 2,097,152 decoded canonical bytes

One native export response contains at most 1,048,576 source bytes. This is an
IPC bound, not a field or content limit. A page may consume several native
responses.

Every legal value that cannot fit a logical record becomes a descriptor plus
content-addressed chunks. The initial raw chunk size is 65,536 bytes, which
leaves deterministic room for base64 and record metadata below the canonical
record ceiling.

The checkpoint manifest binds Library and epoch identity, protocol versions,
frontier, materialized-state digest, record counts by registry, contiguous page
identities, exact canonical and stored byte lengths, stored-byte digests,
transport object identities, and the reachable content-root commitment.

Import writes exact canonical records into a fresh staging database through
bounded page transactions. Exact replay is idempotent and changed replay
fails. Activation materializes every normalized table in one transaction,
verifies the complete checkpoint digest, content chunks, foreign references,
header identity, and record count, crosses a durability barrier, reads the
staged database back, and selects it by one atomic local pointer change.
Partial staging is never queryable.

## 10. Operation synchronization

After checkpoint bootstrap, clients synchronize append-only bounded operation
segments. A segment binds:

- Library, epoch, actor, first and last sequence
- previous and ending actor chain tips
- complete transaction boundaries
- canonical operation envelopes
- decoded byte length and digest

Incomplete transactions, missing sequence, duplicate changed bytes, chain
forks, unknown operations, missing blobs, or signature failure block segment
admission and frontier advancement.

Authenticated manifests publish the latest checkpoint, operation heads, intent
heads, result heads, content roots, and authority tuple. Google Drive is a
transport adapter for these immutable objects. Provider endpoints, headers,
OAuth behavior, retries, and cadence are outside this contract.

## 11. Selective content plane

Canonical Library rows carry descriptors, never large inline media. A
descriptor binds content digest, rendition identity, media type, byte length,
chunk or range layout, and available sources.

Each client independently selects one policy per rendition:

- metadata only
- stream on demand
- partial cache
- complete cache
- pinned offline
- excluded

Policy, transfer progress, cache location, and eviction time are device local.
Descriptor and checkpoint completeness do not require content hydration.

Content digest verification is incremental. Downloads write to a temporary
file or OPFS object, verify exact length and digest, cross a durability barrier,
and atomically publish the local availability row. Multi-gigabyte media never
becomes one JavaScript, Rust, renderer, or IPC allocation.

Garbage collection preserves canonical references, active checkpoint roots,
backups, pinned local renditions, in-flight transfers, and retained receipts.

## 12. PWA and iPhone behavior

The PWA SQLite worker serializes database access and owns one OPFS database
generation. Interface tabs communicate through bounded messages. Worker loss,
suspension, tab replacement, and process eviction reopen the accepted database
generation and replay only durable local intents.

The supported iPhone floor must prove:

- creation and reopening on the supported iOS and Safari versions
- suspension and termination recovery
- checkpoint staging and atomic activation
- intent durability and result reconciliation
- quota refusal without accepted-state loss
- content streaming, partial caching, complete pinning, and eviction
- offline playback of a verified pinned rendition
- factory reset fencing across open tabs

If OPFS or the required SQLite persistence primitive is unavailable, the PWA
reports an unsupported storage capability. It does not fall back to Library
rows in IndexedDB.

## 13. Migration and cutover

Migration is one bounded external-memory read of retained source data directly
into the final SQLite schema. It is not a product runtime and cannot be selected
after cutover.

The migration records one disposition for every source field and content
object:

- mapped to a registered final field
- retained as immutable provenance required by the product
- explicitly excluded because it is device local or obsolete
- blocking because lossless interpretation is unavailable

Any blocking disposition prevents cutover. The migration never creates a
shell, shadow database, dual write, alternate PWA row store, or compatibility
checkpoint.

Cutover requires source fencing, final SQLite catalog verification, field and
content closure, query parity beyond the former hydration cap, checkpoint and
backup proof, follower import proof, exact receipt publication, and owner
activation authority. One SQLite-only storage epoch is then selected.

Rollback is legal only before a later canonical SQLite write and only to the
same accepted frontier. After a later write, recovery rolls forward from typed
checkpoints, operation segments, content objects, and authenticated backups.

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

| Operation | Budget |
| --- | ---: |
| Warm bounded page query p95 | 50 ms |
| Cold bounded page query p95 | 150 ms |
| Navigation counts p95 | 100 ms |
| Search p95 | 150 ms |
| Commit and materialize 1,000 captured items | 500 ms |
| Logical checkpoint record | 131,072 canonical bytes |
| Decoded checkpoint page | 2,097,152 bytes and 128 records |
| Native export response | 1,048,576 source bytes |

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

Tests that skip on their executing platform are not proof. The release
activation manifest records the exact transition and evidence expectations for
the SQLite-only storage epoch. Release approval does not itself execute a
migration, contact a provider, install a build, or change live data.

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
- unused migration, repair, export, test, or authority vocabulary with no final
  product requirement

The one-time source reader may remain only until the migration receipt and
activation evidence are complete. It is then removed from production bundles.
