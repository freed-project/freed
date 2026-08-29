# Freed Library Core Architecture

This document defines Freed's durable Library architecture across Freed
Desktop, the provider-neutral headless Primary, and the PWA.

## Documentation map

This overview is the navigation and decision record. It is not the only place
where the architecture is specified. The repo documentation divides authority
as follows:

- This file defines the whole-system model, ownership boundaries, performance
  budgets, deletion target, delivery sequence, and estimates.
- [LIBRARY-CORE-CONTRACT.md](LIBRARY-CORE-CONTRACT.md) defines exact durable
  authority, mutation, query, checkpoint, intent, result, content, migration,
  failure, and recovery contracts.
- [STORAGE-ARCHITECTURE-ROADMAP.md](STORAGE-ARCHITECTURE-ROADMAP.md) defines the
  current implementation sequence and delivery checkpoints.
- [PHASE-4-SYNC.md](PHASE-4-SYNC.md),
  [PHASE-5-DESKTOP.md](PHASE-5-DESKTOP.md),
  [PHASE-6-PWA.md](PHASE-6-PWA.md),
  [PHASE-11-OPENCLAW.md](PHASE-11-OPENCLAW.md), and
  [PHASE-12-ADDITIONAL-PLATFORMS.md](PHASE-12-ADDITIONAL-PLATFORMS.md) define
  delivery state by product surface.
- [YOUTUBE-INTEGRATION.md](YOUTUBE-INTEGRATION.md) defines provider-specific
  media acquisition boundaries and consumes the shared selective-content
  contract.
- [TURSO-EVALUATION.md](TURSO-EVALUATION.md) records the measured database
  engine decision.
- `library-core-activation-manifest.json` records the one SQLite storage-epoch
  release gate and retired-engine proof. Its version 2 declaration binds the
  immutable digest of the superseded incremental-cutover history without
  carrying those fallback instructions into the current architecture.
- `roadmap-status.json` is the machine-readable status mirror for product
  phases. The public website roadmap remains in its separate `www` lane.

The contract and phase documents must be updated in the same change as the
behavior they govern.

The target is one logical Library Core implemented with stock SQLite in every
operational environment. Freed Desktop and the headless Primary run SQLite
through the extracted native Rust core. The PWA runs official SQLite
WebAssembly in a worker and persists the database in the Origin Private File
System, or OPFS.

SQLite database files remain local implementation artifacts. Synchronization
exchanges signed mutations, normalized checkpoints, authenticated manifests,
and content-addressed blobs. It never copies, uploads, merges, or restores a
live SQLite database file, WAL, SHM, or rollback journal.

## 1. Governing decisions

The architecture has these non-negotiable properties:

1. `shellJson`, `DocState`, and every equivalent Library shell cease to exist
   as runtime authority, transport, fallback, rollback evidence, or
   compatibility state.
2. There is no dual write between another Library engine and SQLite.
3. Every Freed Desktop view reads through bounded typed SQLite queries.
4. The PWA uses SQLite WebAssembly and OPFS for Library rows. IndexedDB is not
   a Library database fallback.
5. React retains visible result windows and ephemeral interface state only.
6. Google Drive carries immutable protocol objects and one small authenticated
   control tuple. It never carries SQLite filesystem state.
7. One active writer epoch admits canonical mutations. Followers submit
   signed mutation intents to the designated Primary.
8. Every checkpoint record has a stable registry identity and typed primary
   key. Page ordinals never become logical identity.
9. Every canonical logical wire record is bounded. Large content uses the
   separate content plane.
10. Content synchronization is selective per device. Descriptor replication
    does not require byte hydration.
11. Desktop, headless, and PWA behavior derives from one executable contract
    source and the same checked-in SQL.
12. Source migration logic is short lived and isolated. It is not a
    permanent runtime compatibility engine.

## 2. Outcome

The completed system has this shape:

```text
                            Google Drive appDataFolder
                     immutable protocol objects and blobs
                                      |
                    authenticated manifest and control tuple
                                      |
              +-----------------------+-----------------------+
              |                                               |
     Designated Primary                              Editable follower
     Freed Desktop or headless                       Desktop or PWA
              |                                               |
     native Library Core                               Library client
              |                                               |
       bundled SQLite                        native SQLite or SQLite WASM
              |                                               |
      accepted authority                      accepted replica plus local
      journal and rows                         signed-intent overlay
```

Every device queries its own SQLite database. No view reconstructs a complete
Library object. No synchronization pass reconstructs a complete Library
object. No browser worker retains the corpus merely to answer a page query.

## 3. Package ownership

- `packages/library-core-native` owns native schema, migrations, mutations,
  queries, journaling, authority, checkpoint staging, backup, process
  exclusion, and content-vault access.
- `packages/shared/src/library-core` owns generated TypeScript contracts,
  canonical codecs, registry constants, SQL metadata, and cross-runtime
  vectors.
- `packages/sync` owns protocol orchestration and cloud transport ports. It
  does not own Library rows or canonical mutation authority.
- `packages/desktop` owns the Tauri host adapter, windows, platform lifecycle,
  credentials, scheduling, and native capability wiring.
- `packages/pwa` owns the browser host adapter, SQLite worker lifecycle, OPFS,
  service worker, browser credentials, and mobile application shell.
- `packages/ui` owns product views over typed query and mutation adapters. It
  has no storage engine or synchronization authority.
- `packages/capture-*` own isolated extraction and normalization. Captured
  values enter the Library through registered mutations.

Freed Desktop stores the final normalized database below its private
`library-sqlite` directory. The native binding holds the directory descriptor
and process lease for the process lifetime. During the one-time migration,
the historical `library-core` database remains a separate source. The two
files never participate in a dual write. Activation selects the normalized
database once, after which the historical source is removed on the documented
receipt boundary.

The explicit runtime deletion list is in section 21. Current delivery state is
tracked in [STORAGE-ARCHITECTURE-ROADMAP.md](STORAGE-ARCHITECTURE-ROADMAP.md),
not in this architecture.

## 4. One executable contract source

The final Library is defined by one machine-readable contract IDL. The IDL is
data, not handwritten Rust or TypeScript code.

The IDL defines:

- Logical entity and child-table schemas
- Stable registry IDs and registry keys
- Primary-key shapes and byte codecs
- Field locality, authority, validation, and merge algebra
- Mutation types, payloads, capabilities, and effects
- Query IDs, parameters, result DTOs, limits, and invalidations
- Checkpoint record types and inclusion rules
- Wire formats, protocol versions, and canonical digest domains
- Content descriptors and authenticated range-index types
- Backup, export, redaction, and deletion rules
- Memory, byte, count, and nesting limits
- Protocol compatibility and cutover rules

Generation produces:

- Rust structs, enums, codecs, validators, and dispatch tables
- TypeScript types, codecs, validators, and client bindings
- Registry constants and fingerprints
- Canonical cross-runtime vectors
- Documentation tables
- Compile-time exhaustive switches for mutations, queries, and records

SQL remains executable source. Each schema migration, named query, and SQL
materializer exists once as a checked-in SQL file. Rust consumes it with
`include_str!`. The PWA build imports the same bytes. The IDL binds each SQL
file to its typed parameters, expected columns, cardinality, and result DTO.

CI must fail when:

- Generated Rust or TypeScript is stale
- A registry key is duplicated, removed, or reused
- A public query or mutation lacks a contract entry
- Rust and TypeScript produce different canonical bytes
- A SQL result shape differs from its DTO
- Desktop and browser schema catalogs differ
- A named query lacks its registered index plan

No generated API becomes public before a production entry point consumes it.

## 5. Runtime ownership

### 5.1 Native Rust core

The extracted native crate owns:

- Database location, opening, identity, and catalog verification
- Schema migration and migration receipts
- Active epoch and writer admission
- Actor enrollment, retirement, and capability verification
- Mutation verification and materialization
- Operation journal and exact retry receipts
- Bounded query execution
- Checkpoint export and import
- Replication, intent, and result outboxes
- Content descriptor and blob-vault coordination
- Backup, restore, repair, and integrity verification
- Query change feed and durable background work queues
- Metrics and typed failures

Tauri owns only command registration, serialization, cancellation, and host
capability wiring. The headless Primary calls the same crate without Tauri.

The headless supervisor never receives a SQLite path and never interprets SQL.
It passes descriptor-bound roots to the native sidecar, then uses a generated,
versioned command registry over dedicated inherited pipes. Four-byte
big-endian frame lengths cap each request and response at 4 MiB. The native
side accepts normalized checkpoint staging and pinned export, registered
bounded queries, and exact storage inspection. Mutation commands require the
established authority key and remain unavailable until the headless secret
contract supplies that key without exposing it to workers or Drive adapters.

Rust uses a bundled, pinned SQLite release with the required features. Runtime
behavior must not depend on whichever SQLite happens to ship with an operating
system.

### 5.2 PWA core

The PWA uses the official SQLite WebAssembly distribution with:

- OPFS `opfs-sahpool`
- One SharedWorker owning the SQLite connection
- A dedicated-worker recovery route if SharedWorker startup is unavailable
- One connection generation that fences stale tabs and old application code
- One browser-level writer lock for the exact Library root
- Durable transaction completion before acknowledgment
- Reopen and recovery after worker suspension or termination
- Persistent-storage request, quota inspection, and storage-pressure handling

The supported floor is iOS 17 because it supplies the complete
Storage API and persistent-storage behavior required by the product contract.
The underlying SQLite path works on Safari 16.4 and later, but that does not
make every earlier storage policy acceptable for Freed.

Private Browsing does not receive an IndexedDB fallback. Freed reports that a
durable local Library is unavailable in that context.

IndexedDB may remain only as a narrow browser keystore for nonextractable
WebCrypto key objects when WebKit supplies no appropriate alternative. It may
not contain Library rows, checkpoints, cursors, operations, content metadata,
or compatibility state.

For follower mutations, OPFS SQLite returns one closed context containing the
active Library and epoch, the enrolled nonretired actor, its public key, the
next actor sequence, the previous actor tip, and the bounded accepted frontier.
The browser keystore may only verify that exact identity and sign the exact
operation digest. Transaction assembly then commits the canonical envelopes,
sparse optimistic fields, actor tip, and durable receipt to SQLite atomically.
There is no IndexedDB mutation journal or dual write. Response loss retries the
same canonical bytes and accepts only the receipt for that exact transaction.
This boundary covers every PWA product write. FeedItem, RSS, preferences,
Person, Account, and user-state mutations all use their registered generated
member schema and generated transaction ceiling. Browser product code has no
IndexedDB mutation API.

### 5.3 React

React owns:

- Active filters and navigation
- Visible bounded row windows
- Current reader content window
- Pending interaction feedback
- Dialog, focus, selection, and presentation state
- Small bounded query summaries

React does not own:

- The Library corpus
- Durable entities
- Mutation history
- Search indexes
- Synchronization state
- Checkpoint staging
- Blob inventories
- Long-lived worker projections

## 6. SQLite storage model

One Library has one SQLite database and one content-addressed local blob vault.

### 6.1 Control and authority tables

- Library metadata and database identity
- Schema migration history
- Accepted authority epochs
- Active epoch pointer
- Writer admission
- Actor enrollments and retirements
- Actor capabilities
- Actor accepted and quarantined tips
- Transition, recovery, migration, and cutover receipts

### 6.2 Immutable journal tables

- Transaction headers
- Canonical operation members
- Operation causal tips
- Actor-chain state
- Exact operation and transaction receipts
- Replication outbox
- Intent-result outbox
- Quarantine evidence

Canonical operation bytes are stored once. Outboxes reference immutable
journal rows by primary key rather than copying canonical payloads.

### 6.3 Normalized product tables

The final table set covers every retained product field under:

- Feed items
- RSS feeds
- People
- Accounts
- Preferences
- Tags and other keyed collections
- Relationships
- Highlights, notes, logs, and other stable child entities that remain part of
  the final product

Frequently filtered, sorted, joined, or rendered values receive typed
columns. Repeated collections receive child tables. Large content receives a
descriptor and content-plane reference. Unknown historical fields do not
become permanent `rest` JSON. Migration either classifies them into the final
model or records an explicit exclusion that the owner can review.

### 6.4 Merge metadata

- Per-field causal assignments
- Keyed collection membership assignments
- Entity generations
- Tombstones
- Relationship effects
- Preserved conflicts
- Repair provenance

SQL statement order is never merge policy. Each synchronized field uses its
registered algebra:

- Causal register
- Element map
- Keyed collection
- Immutable content
- Delete-wins entity tombstone
- Explicit causal restore
- Device-local register
- Derived value

### 6.5 Derived query structures

- FTS5 search indexes
- RTree indexes where spatial queries justify them
- Feed ordering keys
- Facet summaries
- Navigation summaries
- Query invalidation feed
- Durable bounded work queues

These structures are rebuildable and normally excluded from checkpoints.

### 6.6 Database safety

Every authoritative connection must:

- Verify `application_id`, schema version, and the complete catalog
- Open with URI interpretation disabled
- Use private cache and no-follow behavior
- Enable foreign keys, defensive mode, cell checks, and untrusted-schema
  protection
- Disable double-quoted string-literal compatibility
- Apply explicit runtime limits
- Use bounded busy handling
- Use durability settings appropriate to acknowledged authority
- Recheck database identity on the exact writable handle

One operating-system lease protects one Library data root per process. Cloud
writer authority remains separate from local process exclusion.

## 7. Query architecture

Views call generated named query methods through a platform-neutral
`LibraryClient`. They do not receive arbitrary SQL and they do not receive a
shell assembled from many queries.

Every query contract declares:

- Query ID and version
- Typed request DTO
- Typed result DTO
- Maximum rows
- Maximum serialized bytes
- Keyset cursor codec
- Required indexes
- Projection revision semantics
- Cancellation behavior
- Query and facet invalidation keys
- Expected query-plan properties

A cursor binds query version, normalized filters, ordering keys, projection
revision, and storage generation. A stale cursor returns a typed stale result.
It never walks across mixed revisions.

One view may request a query bundle when several small related results must
come from one read transaction. This avoids client waterfalls while retaining
a bounded response.

Representative query families are:

- Feed pages
- Saved and archived pages
- Search pages
- Reader content
- Person timelines
- Friends surfaces
- Map marker rows containing only location, time range, author, popup snippet,
  and item locator fields
- Story Wall candidate rows containing only compact caption metadata and at
  most eight typed media references
- Navigation counts
- Facet summaries
- Account and feed management
- Preference sections
- Export and repair enumeration

Ordinary pages admit at most the registered row and byte ceilings. Full reader
content is ID-addressed and streamed when it exceeds the ordinary DTO budget.

The Saved list uses `saved_feed_page_v2`. One closed sort enum selects the
generated date-saved, date-published, recommended, or shortest-read SQLite
variant. Each variant owns matching forward and reverse keyset SQL plus its
expression index. Filters, counts, ordering, and pagination stay inside
SQLite. Edge cursors bind the filter digest, sort, complete order key,
generation, and source revision. Desktop native SQLite and browser SQLite use
the same generated programs and byte-identical cursor codec.

Stores subscribe only to a compact change feed containing revision, bounded
changed IDs, invalidation keys, and `resetRequired`. The feed contains no
hydrated entity rows.

Actor capabilities bind mutation and query authority separately. The query
grant is a sorted subset of the generated agent read profile and is stored in
normalized SQLite beside the mutation grant. Read-only agents need no
synthetic mutation. A local socket, service account, or successful process
connection is transport identity only and never substitutes for a signed
query grant checked inside the native authority boundary.

## 8. Exhaustive mutation architecture

The mutation registry is exhaustive. The existing set of canonical operations
is a starting inventory, not the final product surface.

Every durable user action, capture action, import action, synchronization
transition, deletion, restore, and repair receives a named typed mutation.

Each mutation declares:

- Mutation type and version
- Actor capability
- Entity type and typed primary key
- Closed payload schema
- Preconditions
- Closed operation field manifest
- Merge algebra
- Relationship and cascade effects
- Blob dependencies
- SQL materializer
- Idempotency identity
- Receipt shape
- Query invalidations
- Replication disposition
- Provider-side-effect classification

The canonical registry contains exactly the mutation programs the product can
execute:

| family | mutation programs |
| ------ | ----------------- |
| FeedItem capture and state | `feed_item_capture_upsert`, `feed_item_read_assignment`, `feed_item_saved_assignment`, `feed_item_archive_assignment`, `feed_item_like_assignment`, `feed_item_like_sync_receipt`, `feed_item_seen_sync_receipt`, `feed_item_remove` |
| FeedItem annotations and analysis | `feed_item_annotations_replace`, `feed_item_analysis_replace` |
| People, Accounts, and Friends | `person_upsert`, `person_reach_out_append`, `person_remove_and_accounts`, `person_remove_detach_accounts`, `account_upsert`, `account_person_assignment`, `account_remove`, `friend_replace` |
| RSS and preferences | `rss_feed_upsert`, `rss_feed_title_assignment`, `rss_feed_remove_keep_items`, `rss_feed_remove_with_items`, `preferences_leaf_assignment` |

Every name maps one-to-one to a generated SQL program and at least one product
caller. Contract generation rejects a name without a program. Tests inventory
the final callers. Device-local layout and content policy use five separate
typed local SQLite programs. Bulk scope staging, contact generations, content
publication, actor administration, writer transition, checkpoint import, and
recovery use separate closed protocols and cannot masquerade as canonical
mutation members.

Provider capture owns FeedItem source fields, media, and topics. It does not
own user tags, highlights, content signals, or event candidates. Annotation and
analysis replacements use independent deterministic field clocks, so a new
capture cannot erase user or enrichment records and a stale follower result
cannot replace a newer child set.

Local semantic enrichment uses the same authority boundary. SQLite selects
only missing or stale analysis rows through the version-filtered
`background_item_page_v1` contract in 64-row source-fenced pages. Shared code
retains one bounded candidate batch. Freed Desktop infers signals and event
candidates locally, rechecks the source revision, and submits the batch through
the signed `feed_item_analysis_replace` program. OPFS SQLite implements the
same selector and response contract. No document command, renderer scan, or
fake zero-result maintenance path exists.

The authority boundary forbids:

- Generic JSON patch
- Toggle operations
- Unkeyed increments
- Arbitrary SQL writes from views
- Boolean parameters that hide cascade behavior
- Mutation types absent from the registry

Bulk actions freeze one exact selected set through a durable bulk-intent
identity and process it in bounded stable-key batches. The renderer never
receives the complete selected ID set.

## 9. Canonical operation journal

One canonical mutation transaction contains:

- Stable transaction and operation IDs
- Library and active epoch identity
- Actor identity, sequence, and predecessor
- Branch-qualified causal frontier
- Transaction member count and indexes
- Mutation type, entity key, and typed payload
- Blob references
- Canonical payload, member, transaction, and chain digests
- Actor signature

The receiver verifies the complete transaction before applying any member.
Partial transactions may be retained as incomplete evidence but cannot
materialize, advance tips, produce acknowledgments, or enter an outbound
manifest.

One SQLite write transaction commits:

1. Immutable journal rows
2. Actor-tip compare-and-swap
3. Materialized normalized rows
4. Field clocks, relationships, conflicts, and tombstones
5. Monotone ingest sequence
6. Materializer frontier
7. Exact retry receipt
8. Replication outbox
9. Query invalidations
10. Materialized-state commitment updates

A response-loss retry uses the same identity and returns the stored receipt.
Changed bytes under the same identity are quarantined.

## 10. Editable follower protocol

Followers hold an accepted local replica but do not admit canonical writes for
the active writer epoch. An edit creates a signed mutation-intent transaction.

### 10.1 Intent records

An intent transaction is represented by bounded canonical records:

```text
intent_transaction_header
intent_transaction_member[0..n]
intent_blob_reference[0..n]
```

The header binds:

- Protocol version
- Library and target epoch
- Actor identity
- Stable intent and transaction IDs
- Previous intent-chain identity
- Observed accepted frontier
- Base projection revision
- Member count and aggregate digest
- Signature

Each member uses the same generated semantic mutation payload as a Primary
local mutation. The wrapper records that the member is proposed rather than
accepted authority.

### 10.2 Primary admission

The Primary:

1. Parses duplicate-preserving canonical bytes within limits.
2. Verifies library, epoch, actor enrollment, capability, signature, sequence,
   predecessor, and transaction completeness.
3. Verifies referenced content exists and is remotely durable.
4. Rechecks active writer admission inside the SQLite write transaction.
5. Constructs canonical accepted operations from the semantic members.
6. Applies the registered merge algebra.
7. Commits journal, normalized rows, frontier, receipts, and outbox together.
8. Publishes a signed intent result.

### 10.3 Intent results

A result is:

- Accepted
- Permanently rejected with a typed reason
- Deferred for a missing dependency
- Quarantined for identity or chain conflict
- Unknown pending response resolution

An accepted result binds the exact intent digest to accepted operation IDs,
transaction digest, projection revision, and frontier.

### 10.4 Durable follower overlay

Editable followers keep accepted state separate from pending local intent.
Their SQLite database contains:

- Accepted replicated rows
- Pending signed-intent journal
- Sparse provisional field or row overlay
- Intent-result inbox

Generated query SQL composes accepted rows with only the sparse local overlay.
It does not clone the accepted database.

When an accepted operation arrives, the follower applies it to accepted rows,
matches its source-intent digest, removes the provisional overlay, advances the
revision, and emits bounded invalidations. A rejection leaves accepted rows
untouched and preserves a user-visible correction path.

## 11. Synchronization protocol

SQLite is synchronized logically, never physically.

The cloud protocol contains:

1. Normalized checkpoints for bootstrap and compaction
2. Canonical operation segments after the checkpoint frontier
3. Follower intent segments
4. Signed intent-result segments
5. Content descriptors, authenticated range indexes, and content bytes
6. Authority, actor, repair, compaction, backup, and transition evidence

Immutable objects are content addressed. One small authenticated manifest
names persistent roots. One small compare-and-swap control tuple selects the
current manifest and writer epoch.

A follower refresh:

1. Fetches and authenticates the current control tuple.
2. Verifies the transition and manifest predecessor chain.
3. Chooses checkpoint bootstrap or incremental operation replay.
4. Downloads required descriptor and operation objects.
5. Optionally hydrates content according to local policy.
6. Verifies complete operations.
7. Applies accepted transactions idempotently to local SQLite.
8. Publishes pending signed intents.
9. Downloads signed intent results.
10. Reconciles the sparse local overlay.
11. Reruns only invalidated bounded queries.

The Primary additionally reads actor-scoped intent heads, admits or rejects
complete intent transactions, publishes result segments, and advances the
authenticated manifest.

Normalized result segments use protocol v2. Each immutable object contains one
closed header followed by the canonical authority-signed follower result
envelopes themselves. The segment does not project those results into receipt
summaries and does not wrap canonical JSON in another JSON string. Every result
record remains at or below 131,072 canonical bytes. One segment contains at
most 128 results and at most 1,048,576 canonical result bytes. Its header binds
the Library, storage epoch, actor, exact result sequence range, previous
transport segment digest, total canonical result bytes, and a domain-separated
semantic digest. The immutable descriptor independently binds the stored bytes
and exact object key. Followers verify both layers plus the logical
`previous_result_digest` chain before passing canonical result bytes to SQLite
for authority-signature verification and atomic reconciliation.

Normalized operation segments use protocol v2. The Primary pins one native
export descriptor to the active Library, authority epoch, writer, and source
revision. At each committed revision it emits the exact authority-signed
Accepted result first, followed by the actor-signed operation envelopes named
by that result in member order. Pages may split a transaction, but followers
stage the records in SQLite and expose no partial effect. Application begins
only after the authority signature, complete operation identity set,
transaction digest, actor enrollment, actor chain, member signatures, and
exact next source revision all verify. Every logical record is at most 131,072
canonical bytes. A native page contains at most 128 records and 1,048,576
canonical record bytes, and its serialized response is independently capped at
1,048,576 bytes. Long-form content remains outside operation metadata as
content-addressed chunks or authenticated range objects.

Normalized intent segments also use protocol v2. Each immutable object contains
one closed header followed by the canonical actor-signed operation envelopes
themselves. A page contains at most 128 envelopes and at most 1,048,576
canonical envelope bytes. It may begin or end inside a larger transaction. The
actor counter, previous operation ID, and previous actor-chain digest remain
contiguous inside every page, while the immutable head chains page ranges and
stored-byte digests. The Primary stages each bounded page in SQLite. It does not
verify, materialize, reject, or publish a result until all declared transaction
members are present and the complete transaction passes actor, capability,
epoch, signature, digest, precondition, and materialization checks in one
SQLite transaction. A legal 1,000-member or 4,194,304-byte transaction never
becomes one renderer response or one JavaScript authority object.

Intent and result heads use the same exact publication algorithm. It verifies
canonical starting head bytes, uploads and reads back the immutable object,
advances the precise actor range through compare-and-swap, and treats response
loss as success only when the complete canonical head bytes read back exactly.
The two protocols retain distinct closed head types and sequence meanings.

Followers persist the same intent publication fact inside normalized SQLite.
One actor-scoped transport head records the next actor counter and latest stored
segment digest. Each immutable page receipt separately records its counter
range, previous stored digest, semantic body digest, stored-object digest,
object key, transport object ID, publication time, and count of transactions
that became fully visible at that boundary. Recording a page, advancing the
head, and changing only fully covered transactions from pending to published
happens in one immediate SQLite transaction. A page that ends inside a
transaction advances transport progress but leaves that transaction pending.
Exact response-loss replay returns the stored receipt. Any changed range,
digest, object identity, or time fails closed.

The PWA OPFS SQLite engine executes the same intent publication transaction
from the shared closed v2 header and immutable-object reference. It verifies
the active Library, storage epoch, actor, durable member range, semantic
digest, stored-byte digest, object key, transport object ID, and publication
time before advancing the actor transport head. A segment that ends inside a
transaction advances transport progress without marking that transaction
published. Exact retry returns the original receipt. The browser engine does
not persist this fact in IndexedDB.

Followers persist result transport progress by the same rule. Before SQLite
changes product state, the native boundary reconstructs the closed v2 segment
body from the canonical signed result records and verifies its semantic digest.
One immediate transaction then verifies every authority signature and logical
result-chain link, records accepted or rejected intent state, removes the
matching sparse optimistic overlay, advances the logical result cursor, stores
the immutable object's semantic digest, stored-byte digest, object key, and
transport object ID, and advances the actor-scoped transport head. Exact retry
returns that stored segment receipt. A changed record, digest, range, object
identity, or receipt time fails closed. No Drive listing and no React state is
used to infer whether a result was already applied.

The PWA OPFS SQLite engine performs the same v2 result import. It reconstructs
the closed semantic body from direct canonical signed result records, verifies
the body digest and every authority signature before writing, then commits
result materialization, optimistic overlay cleanup, logical cursor progress,
the immutable-object receipt, and transport-head progress in one immediate
transaction. A late receipt failure rolls back the product rows and both
cursors. IndexedDB is not part of this result authority path.

One coordinator in the shared sync package owns enrollment publication,
normalized intent-head reconciliation, bounded intent publication,
response-loss recovery, and verified result import ordering. Freed Desktop and
the PWA supply only typed SQLite runtime callbacks and a provider transport.
Freed Desktop obtains its transport frontier and actor-counter pages directly
from the native core. The PWA obtains the identical contract from its OPFS
SQLite worker. Neither host implements a second protocol state machine.

The shared sync package also owns the one Google Drive normalized follower
transport factory. It publishes and verifies enrollment objects, selects the
certificate bound to the exact actor and request digest, opens the normalized
intent head, and pages result references under closed bounds. A host may supply
an authority fence that runs before every provider operation. Desktop uses that
fence to recheck its Follower role. The factory does not refresh credentials,
schedule work, retry a sync cycle, or own local SQLite authority.

Google Drive remains an injected transport. This architecture does not change
Drive endpoints, headers, OAuth, retries, range behavior, or polling cadence.

## 12. Normalized checkpoints

The checkpoint format is `freed_normalized_checkpoint_v2`.

### 12.1 Registry identity

One append-only registry defines each record family:

- Stable numeric registry ID
- Stable registry key
- Typed primary-key schema
- Primary-key byte codec
- Typed value schema
- Checkpoint ordering index
- Inclusion and exclusion rules
- Materialized-commitment contribution
- Import destination
- Large-content policy

The initial final registry covers:

- Accepted frontiers
- Quarantined frontiers
- Feed items
- RSS feeds
- People
- Accounts
- Preferences
- Registered child entities and keyed collections
- Field clocks
- Relationships
- Tombstones
- Actor states
- Receipt records
- Content descriptors
- Registry exclusions

FTS, RTree, SQLite internals, local intent overlays, provider sessions, local
work queues, caches, and hydration state are excluded.

Record identity is derived from the registry ID and canonical typed primary
key. It is stable across page composition, export attempts, devices, and
transports. Page ordinal is transport metadata only.

### 12.2 Logical record ceiling

One canonical logical record is at most 131,072 bytes, exactly 128 KiB.

This ceiling contains parser allocation, hashing, schema validation, native
boundary amplification, and corruption blast radius. It is not a product
content limit. Typical records should be much smaller.

The exact count is provisional until physical iPhone and Desktop measurements
compare 64 KiB, 128 KiB, and 256 KiB. The architecture recommends 128 KiB
unless measurement finds a concrete problem.

The byte count is exact canonical UTF-8 before compression. Character count,
source-object size, and compressed size do not determine admission.

### 12.3 Page boundaries

One decoded checkpoint page contains at most:

- 128 logical records
- 2,097,152 canonical decoded bytes

The producer flushes before either next boundary would be crossed. The record
limit contains object-count overhead. The byte limit contains large-record
overhead. Compression occurs only after both checks.

One native response contains at most 1,048,576 source bytes. A checkpoint page
may therefore use several native responses. The native response limit protects
IPC and never becomes a row or content limit.

The producer records exact canonical bytes before append. It never estimates
from JavaScript strings or compressed output.

### 12.4 Manifest

The checkpoint manifest binds:

- Library, epoch, schema, registry, and canonical-codec versions
- Exact source frontier and materialized-state commitment
- Total and per-registry record counts
- Contiguous page indexes
- First and last record identities
- Decoded and stored byte lengths
- Stored-byte digests
- Verified transport object IDs
- Referenced content-root commitment

The manifest contains no product rows or media bytes.

### 12.5 Import

Import writes a fresh staging generation. It verifies every manifest field,
page, record identity, registry entry, primary key, canonical payload,
relationship, count, frontier, content descriptor, and final materialized
commitment before selecting that generation.

The importer retains one compressed page, one decoded page, one prior identity,
and one bounded staging transaction. Partial generations are never queryable.

## 13. Selective content synchronization

Content has a separate plane because checkpoint completion and local byte
hydration are different facts.

Every follower synchronizes small content descriptors and authoritative
references. Each device independently decides which bytes to hydrate.

FeedItem capture follows the same separation. The signed capture mutation
materializes bounded inline metadata, media references, and topics into
normalized SQLite tables. Re-capture refreshes source-owned fields without
overwriting saved, archived, liked, read, tag, or highlight state. A tombstone
blocks re-capture. The complete signed operation envelope cannot exceed one
131,072-byte canonical record. Longer bodies and media bytes enter through
content descriptors and content-addressed chunks, never a larger FeedItem
object.

### 13.1 Descriptor

A content descriptor includes:

- Content digest
- Exact byte length
- Media type and encoding
- Rendition or variant identity
- Authenticated range-index root
- Range granularity
- Playback metadata needed before hydration
- Cloud availability commitment

The normalized entity row references the descriptor. It does not embed large
content or a complete chunk list.

### 13.2 Local hydration states

The final device-local enum will distinguish at least:

- Metadata only
- Streamable
- Partially cached
- Fully cached
- Pinned offline
- Excluded by local policy
- Unavailable
- Corrupt

Hydration state never enters normalized checkpoints or canonical Library
mutations.

SQLite keeps local intent and physical proof separate. The generated contract
defines the six policy values. Rust, the headless native command boundary, and
the PWA SQLite worker execute the same bounded policy mutation and point read.
The state response can describe a multi-gigabyte object without reading or
allocating its bytes. Local policy, availability, and verified range tables are
absent from normalized checkpoint export.

Range publication uses the same 256 KiB maximum append in native Rust and the
PWA worker. Each writer first resolves the canonical range identity from
SQLite, accepts sequential bytes only, hashes incrementally, crosses the host
durability barrier, and then registers only the storage key and verification
time. Local range rows are keyed by the canonical content digest and range
index. They retain the verified length and digest as local proof, then reconcile
against every activated canonical generation. Exact matches survive checkpoint
replacement. Removed or changed ranges lose their local availability proof.
Physical object keys bind the content digest, range index, and verified range
digest. Desktop resolves its private vault through a held directory descriptor
and crosses file and directory durability barriers before SQLite registration.
The PWA owns the equivalent OPFS lifecycle in the SQLite worker. Startup scans
physical entries and SQLite proofs in bounded pages. Exact length-bound matches
survive. Orphans, partial files, missing objects, and mismatched proofs are
removed before the vault becomes ready.

### 13.3 Device policy

A device may choose:

- Stream on demand
- Cache ranges after playback
- Prefetch on unmetered connections
- Prefetch saved items
- Prefetch selected feeds or creators
- Maintain a device-local byte budget
- Pin selected media offline
- Exclude a media class from local queries and presentation
- Place the Desktop media vault on a selected local volume

A synchronized preference may express a general intent such as making saved
videos available offline where space permits. Actual byte presence and
eviction remain device local.

### 13.4 Long-form video

A video hundreds of megabytes or several gigabytes is one logical immutable
content object. Google Drive may store it as one immutable file supporting
authenticated range reads.

The client does not need to download the complete video before playback. A
paged authenticated range map contains byte offsets, lengths, and range
digests. Optional container and time metadata can improve seeking.

The canonical descriptor commits to the ordered typed range records with one
SHA-256 root. The digest domain, content identity, total byte length, range
count, and every ordered index, offset, length, and range digest enter that
root. Each range record independently obeys the logical-record ceiling.
Checkpoint activation streams the metadata, rejects gaps or overlaps, and does
not allocate the logical media length. Media bytes do not enter these records.
Their physical range size is selected by measurement across Drive overhead,
seeking, Desktop disk, OPFS, iPhone memory, and resumable recovery.

The initial benchmark compares 1 MiB, 4 MiB, 8 MiB, and 16 MiB media ranges.
No range size becomes protocol law before that measurement.

Streaming verifies each fetched range against the authenticated range map.
Complete-file digest verification closes full offline hydration.

Completion never invents a monolithic local object. It streams the ordered
verified range set into the canonical content digest with a 262,144-byte
working window. SQLite records the complete or pinned state only after exact
range count, byte length, and digest close. Range rows remain the only physical
locators.

Playback reads one verified local range window at a time. Each read is capped
at 262,144 bytes and resolves the physical object only after SQLite proves the
canonical range identity. Views never receive a reconstructed media shell or
an unbounded file allocation.

### 13.5 Reachability and garbage collection

Cloud retention follows authoritative references, checkpoints, backups,
quarantine, and compaction receipts. Local retention follows device policy.

- Local eviction never mutates Library authority.
- Local pinning never changes another device's cache.
- An existing verified cloud object is not reuploaded by another client.
- Cloud deletion is never inferred from connected-client cache state.
- Pinned offline bytes are not automatically evicted without an explicit
  local policy transition.
- Excluding a rendition cancels its local staging and purges its verified
  ranges. Cache-pressure eviction refuses a pinned rendition until the device
  explicitly changes its policy.
- Physical deletion precedes SQLite proof deletion. A crash can therefore
  leave a stale proof, but cannot leave SQLite claiming a successful purge
  while the runtime knowingly retained the object.

A follower can fully authenticate a checkpoint while holding zero media bytes.
It must know that every required authoritative content object exists remotely,
but local hydration is optional.

## 14. Snapshots and restore

A local snapshot is an immutable `freed_normalized_local_snapshot_v1` archive.
Its first line is one canonical closed manifest. Every later line is one
canonical normalized checkpoint record whose encoded size is at most 131,072
bytes. The archive binds its snapshot ID, Library identity, authority epoch,
source revision, causal frontier, record count, canonical record bytes,
checkpoint digest, creation time, and reason. It never copies the live SQLite
database, WAL, or SHM file.

Snapshot creation pins one checkpoint export, streams bounded typed pages into
a private pending file, flushes the file, atomically installs the digest-named
archive, flushes the directory, and retains the newest 24 valid archives.
Listing and deletion stay relative to the already-open private snapshot
directory. Path replacement, symbolic links, nonprivate files, changed
manifests, changed records, trailing bytes, and digest disagreement fail
closed.

Device-local provider sessions, OAuth tokens, actor private keys, authority
private keys, caches, Google Contacts matching generations, free pages, and
provisional local overlays do not enter snapshot archives.

Restore verifies the complete archive before any Library mutation, stages the
bounded records through the normalized checkpoint importer, and commits them
inside a new signed authority epoch. It carries the live causal frontier
forward, advances the source revision, installs a fresh Primary capability,
and records a canonical `freed_normalized_restore_receipt_v1` receipt. One
caller-supplied operation ID and restore time are signed into the transition.
An exact response-loss retry returns the committed snapshot summary without
creating another epoch. Reusing that operation ID with changed inputs fails
before mutation.

Portable recovery uses the same normalized checkpoint and selective-content
objects. Restoring into a new installation creates a new installation identity
and actor enrollment. It never clones actor private authority.

## 15. Protocol version boundaries

These versions remain independent:

- Contract IDL version
- Physical SQLite schema version
- Field and mutation registry version
- Query version
- Checkpoint registry and format version
- Operation segment version
- Intent segment version
- Intent-result version
- Manifest version
- Content-plane version
- Storage epoch
- Transport adapter version

The cutover creates one new storage epoch that accepts only the final
SQLite protocol family. Runtime code does not parse the historical shell or
checkpoint format as a fallback.

An unsupported newer protocol fails closed. An older client may preserve its
local work as orphan recovery input, but it cannot write into current
authority.

## 16. Migration and cutover

The shortest safe path is one direct migration into the final model. It does
not create a new temporary shadow authority, IndexedDB intermediary, shell
checkpoint, or dual-write bridge.

### 16.1 Migration executable

One short-lived native migration executable:

1. Pins the exact immutable historical source and frontier.
2. Streams it through bounded external-memory staging.
3. Classifies every retained field through the final registry.
4. Writes the final normalized SQLite schema and content descriptors.
5. Builds the final journal, clocks, relationships, tombstones, and
   commitments.
6. Verifies full-field parity and explicit exclusions.
7. Produces the normalized checkpoint and accepted transition candidate.
8. Produces an exact migration receipt.

It never calls a source-sized Automerge load and never turns its source decoder
into a permanent application service.

The bounded native decomposer now maps historical FeedItem rows plus the RSS,
Person, Account, reach-out, follow-role, and preference portions of the old
shell into final tables. The generated contract is the shared authority for
preference field disposition in Rust and TypeScript. Local display state,
local model endpoints, local graph placement, old cloud scheduler fields, and
other obsolete values do not enter canonical SQLite. Invalid foreign
keys, oversized metadata, malformed preference shapes, and unregistered nested
policies abort the caller's one migration transaction.

Current domain types contain only current fields. Person and Account never
carry graph placement. RssFeed never carries retry or failure state. Synced AI,
display, Facebook, and Story Wall preferences never carry installation-local
provider, layout, discovery, or progress values. The synchronized preference
mutation boundary rejects an unsupported key instead of stripping it or
routing it to another store. Fenced one-time import readers accept opaque
historical input and copy retained device values into their explicit local
models before the historical source is retired.

The inert migration candidate receipt binds the active old authority tuple,
source document identity, source generation and revisions, and an ordered
bounded digest of its causal frontier. Deleted historical FeedItem rows are
counted and excluded explicitly at the new epoch boundary. Live rows and every
normalized root family must close exactly, all foreign keys must pass, and the
candidate product digest is computed by streaming canonical normalized records
through the ordinary bounded checkpoint exporter. Historical Friend objects
are discarded only when their canonical Person and Account sources exist.
Neither the old shell nor a hash of it is migration, rollback, or activation
evidence. Building this candidate does not select either database.

The next-epoch certificate is signed only by the already accepted authority
key. It binds the full candidate receipt, final contract and schema identities,
checkpoint format, selected Primary writer, and acceptance time. The body
digest names the epoch while the complete certificate has its own digest. The
installer rechecks the old source tuple, key lineage, frontier, and counts, then
rehashes the normalized target through bounded pages. It installs the signed
epoch, carried causal baseline, writer admission, metadata, and generation in
one target transaction. This makes the candidate internally complete. It does
not switch the host's selected database or retire the old writer. The host does
that only inside the final writer barrier and compare-and-swap.

The new epoch receives a fresh installation actor, not an actor copied from the
old epoch. Its version 2 enrollment proves the host actor key, is countersigned
by the accepted authority key, observes the complete carried source frontier,
and names exactly the generated Primary-writer mutation set with library-wide
scope. Actor, capability, and mutation rows commit together after native
certificate verification. Followers enroll separately under the same epoch.

One restartable native preparation operation composes candidate construction,
transition identity binding, authority installation, and Primary actor
enrollment. The first invocation pins the installation witness and acceptance
time in local normalized SQLite. Later invocations reuse those exact values,
even when the wall clock has advanced. Its state moves only from candidate to
authority installed to actor installed. The returned receipt proves the
selected Library and admitted Primary actor.

Desktop selection uses one bounded canonical record under the descriptor-bound
app-data root. It is a one-way choice of normalized SQLite for one Library. The
record binds the normalized Library ID, while SQLite owns the changing active
epoch, certificate chain, actor, and materialization generation. The host
verifies one internally consistent active authority and generation on every
opening. A legitimate writer transition therefore never rewrites the selector.
A valid selector permanently fences every old database, journal, store,
backup, restore, clear, and mutation route. A missing selector means cutover
has not occurred. A malformed selector or foreign Library fails both sides closed.
Publication flushes one private pending file, atomically renames it to the
fixed selector name, flushes the bound directory, and reads the exact record
back through the same verifier. A different existing selector is never
overwritten. Exact response-loss replay is idempotent.

Freed Desktop runs this preparation before opening its product window while it
holds the historical and normalized process leases. A fresh or inactive
historical store is not a migration source. A complete active source is
prepared and selected before renderer code can observe either authority.

Freed Desktop and PWA product adapters call one shared query orchestration
layer. The host supplies only a typed executor. Freed Desktop's executor calls
the native core. The PWA executor calls its dedicated SQLite WebAssembly
worker. The ordinary feed uses `feed_browse_page_v3`, Saved uses
`saved_feed_page_v2`, and signal counts issue one-row bounded browse queries.
Every response is parsed against the exact request before compact cards enter
React. Cursor strings remain opaque. No adapter invents offsets, duplicates
platform-specific pagination logic, or calls a whole-Library query. Friends
uses the same query with a closed identity mode. SQLite resolves membership by
joining FeedItem provider and author identity to Account, then Account to a
Person whose relationship status is `friend`. The identity mode and predicate
schema are part of the request, response, and opaque cursor digest.

Item detail, maintained Library facets, Saved analytics, Map, and Story Wall
use one shared secondary-surface adapter. Each host supplies the same executor
used by its feed adapter. Map and Story Wall receive specialized compact rows
instead of general FeedItems. Shared transforms create the visible-card fields
used by product UI, so Desktop and PWA do not define separate request or
projection semantics.

### 16.2 Cutover

Cutover:

1. Prepares all corpus-sized work outside the authority barrier.
2. Drains accepted old-epoch work to one exact source frontier.
3. Durably journals any new user intent in epoch-neutral form.
4. Rechecks source, local control, transition candidate, and cloud tuple.
5. Performs one compound compare-and-swap to the new writer epoch and
   authenticated genesis manifest.
6. Selects the verified local SQLite generation.
7. Replays epoch-neutral intents exactly once into the winner.
8. Publishes a normalized checkpoint and exact receipt.

There is no period in which both stores acknowledge authoritative writes.

### 16.3 Failure and recovery

Before the first accepted new-epoch mutation, a failed cutover aborts and
leaves the historical source immutable. After the first accepted new-epoch
mutation, SQLite remains authoritative. Recovery uses verified roll-forward
repair or a normalized snapshot restore into a successor authority epoch.

No release flag, receipt, historical shell, or retained source can reactivate
a retired Library engine.

## 17. Failure semantics

The system fails closed for:

- Missing, foreign, future, or altered SQLite identity
- Catalog drift
- Integrity failure
- Unknown protocol or schema version
- Stale writer epoch
- Actor gap, fork, retirement, or invalid capability
- Partial transaction
- Changed bytes under an existing identity
- Missing or corrupt content dependency
- Oversized logical record
- Checkpoint identity, count, order, or digest drift
- Stale query cursor
- Storage exhaustion
- OPFS or worker recovery failure
- Incomplete migration or restore generation
- Ambiguous response loss

An unreadable database never becomes an empty Library.

Response-loss recovery reads back the exact durable identity. It does not
create a replacement operation, transaction, intent, checkpoint, or transition
identity.

## 18. Observability

The implementation records bounded metadata for:

- Database, schema, epoch, build, and process identity
- Query ID, version, duration, row count, response bytes, and revision
- Query-plan identity and temporary-sort rejection
- Mutation type, duration, member count, canonical bytes, and receipt status
- SQLite busy, WAL, cache, checkpoint, and integrity behavior
- Native boundary row and byte counts
- PWA worker starts, restarts, and connection generations
- OPFS persistence, quota, and storage pressure
- Checkpoint record, page, and manifest sizes
- Segment, intent, result, and actor verification failures
- Pending intent age and overlay cardinality
- Blob range fetch, verification, cache hit, miss, eviction, and pin state
- Migration progress, memory, staging bytes, and receipts

Logs and telemetry exclude user content, canonical payloads, provider tokens,
cookies, actor private keys, authority private keys, and secrets.

## 19. Performance budgets

Initial gates are:

| Operation                                   |                                                                        Budget |
| ------------------------------------------- | ----------------------------------------------------------------------------: |
| Warm bounded page query p95                 |                                                                         50 ms |
| Cold bounded page query p95                 |                                                                        150 ms |
| Navigation counts p95                       |                                                                        100 ms |
| Search p95                                  |                                                                        150 ms |
| Commit and materialize 1,000 captured items |                                                                        500 ms |
| Settled renderer Library DTO state          |                                                                        48 MiB |
| Burst renderer Library DTO state            |                                                                        64 MiB |
| Native checkpoint response                  |                                                            1 MiB source bytes |
| Decoded checkpoint page                     |                                                         2 MiB and 128 records |
| Logical checkpoint record                   | Initial 128 KiB protocol ceiling, frozen after required physical measurements |

Every page query must return its first bounded result without decoding or
scanning the complete corpus. Larger corpus validation runs at 100,000 items.

PWA admission includes physical iPhone testing of reopen, worker termination,
quota pressure, large search, range playback, cache eviction, and offline pin
behavior.

Changed-path and dev validation also run one persistent iPhone-class WebKit
profile against the real OPFS SAH pool. It commits a typed device-local SQLite
transaction, closes the document and dedicated worker twice, reopens the same
database, verifies exact values and revisions, and proves idempotent replay.
This deterministic browser proof catches OPFS VFS, worker lifecycle, schema,
and persistence regressions. It does not substitute for physical iPhone
suspension, quota pressure, storage eviction, or media playback evidence.
The validation planner declares WebKit separately from Chromium and every CI
lane that schedules this proof installs the matching browser executable before
the test begins.

## 20. Test architecture

One conformance suite runs the same fixture against native SQLite and browser
SQLite.

It proves:

- Exact schema catalog parity
- Generated contract parity
- Canonical codec and digest parity
- Mutation result and receipt parity
- Query result, ordering, cursor, and revision parity
- Merge convergence under duplicate, reordered, concurrent, and offline work
- Complete transaction rejection
- Actor enrollment, retirement, gap, and fork behavior
- Normalized checkpoint identity and cross-import parity
- Selective content hydration without authority drift
- Verified range streaming and complete offline hydration
- Exact retry after response loss
- Native crash atomicity
- Browser worker termination recovery
- Persistent WebKit OPFS SQLite write, reopen, and replay durability
- Migration full-field parity and explicit exclusion closure
- No whole-corpus renderer, worker, or native response
- Query-plan use of registered indexes

Fault injection covers every authoritative commit boundary. Performance tests
record exact fixture, build, runtime, process generation, and storage identity.

## 21. Explicit deletion list

The final change deletes:

- Every `shellJson` and `shell_json` field
- `DesktopLibraryShell` and shell read or replacement commands
- Monolithic `DocState` runtime authority
- Library shell synchronization and checkpoint records
- Whole FeedItem JSON as ordinary checkpoint transport
- Whole-corpus renderer and long-lived worker state
- Whole-corpus subscriptions and mutation refreshes
- PWA IndexedDB Library databases
- IndexedDB checkpoint-generation and overlay implementations replaced by
  SQLite
- Shadow-store schemas, naming, feature flags, and compatibility leases
- Ordinal checkpoint identities
- Automerge runtime load, save, merge, head, and worker protocols
- Automerge authority vocabulary that no longer describes retained evidence
- Dual-write and fallback bridges
- Generic JSON patch and toggle mutation routes
- SQLite, WAL, SHM, and rollback-journal cloud transport
- Unregistered localStorage, Cache API, Tauri store, and native JSON
  authorities
- Historical imports, rebuilds, repair paths, flags, and exports with no final
  caller
- Emergency rollback flags that revive the retired architecture
- Full-corpus identity graph models, layout workers, renderers, and provisional
  corpus repair passes superseded by the bounded SQLite Friends Galaxy source
- Renderer Saved re-ranking and FeedItem tag-collection fallbacks superseded by
  registered SQLite ordering and facet queries
- Shared Friend, map, and graph-activity helpers that scan complete Person,
  Account, or FeedItem dictionaries
- Direct Friends Galaxy whole-source worker messages and caller-side source
  queues superseded by source-fenced SQLite page staging
- Tests that protect only deleted compatibility behavior

Immutable migration receipts, source evidence, and backup provenance remain.
Historical runtime code does not.

## 22. Shortest path to total victory

The program uses multiple reviewable commits because authority and data
integrity require exact evidence. It does not build temporary product
architectures between them. Every implementation stage lands final-model
artifacts that the completed system retains.

### Stage 1: Executable contract and generation

Deliverable:

- Final field, mutation, query, locality, checkpoint, content, and deletion
  registries
- Contract IDL
- Rust and TypeScript generation
- Shared SQL binding
- Cross-runtime vectors and drift checks

No temporary storage engine or protocol is introduced.

Estimated machine time: 2 to 4 focused conversations, approximately 1 to 2
hours.

### Stage 2: Complete native-core extraction and final database foundation

Deliverable:

- Tauri reduced to a host adapter
- Headless entry point using the same native crate
- Final SQLite schema, opener, catalog verification, and migrations
- Final content-vault interface
- Process and writer authority boundaries

Estimated machine time: 3 to 5 focused conversations, approximately 2 to 3
hours.

### Stage 3: Exhaustive mutations and normalized materialization

Deliverable:

- Every retained product write routed through the generated mutation registry
- Complete merge algebra, tombstones, relationships, and receipts
- Large content externalized
- Generic patches, shell updates, and hidden cascades removed

Estimated machine time: 5 to 8 focused conversations, approximately 3 to 5
hours.

### Stage 4: Bounded queries and complete view cutover

Deliverable:

- Every Freed Desktop and shared product view uses named SQLite queries
- Paged search, feed, map, Friends, reader, counts, facets, and settings
- Compact invalidation feed
- Renderer corpus removed

Estimated machine time: 5 to 8 focused conversations, approximately 3 to 5
hours.

### Stage 5: Normalized checkpoint, operation, intent, result, and content wire

Deliverable:

- Stable normalized checkpoint registry and primary-key identities
- Typed native export and browser import
- Operation segments
- Transaction-complete browser staging and exact next-revision application
- Signed follower intents and results
- Selective content descriptors and authenticated range indexes
- Google Drive adapter integration without behavior changes

Estimated machine time: 4 to 7 focused conversations, approximately 3 to 5
hours.

### Stage 6: PWA SQLite and editable follower behavior

Deliverable:

- Official SQLite WebAssembly worker
- OPFS durability and recovery
- Generated query and mutation-intent client
- Sparse durable overlay
- Selective media streaming, caching, and offline pinning
- IndexedDB Library state removed

Estimated machine time: 4 to 7 focused conversations, approximately 3 to 5
hours.

### Stage 7: Direct migration, one epoch cutover, and historical deletion

Deliverable:

- External-memory migration directly into the final schema
- Full-field and content closure
- One coordinated storage-epoch cutover
- Normalized Primary checkpoint and follower import receipt
- Shell, Automerge runtime, shadow store, IndexedDB rows, fallbacks, and unused
  compatibility paths deleted

Estimated machine time: 6 to 10 focused conversations, approximately 4 to 7
hours.

### Stage 8: Acceptance and release handoff

Deliverable:

- Native and PWA conformance
- Crash and response-loss fault injection
- 25,000-item and 100,000-item performance evidence
- Physical iPhone storage and media evidence
- Installed Desktop proof
- PHASE documents and `roadmap-status.json` reconciled
- Exact release and activation handoff, without performing those actions unless
  separately authorized

Estimated machine time: 4 to 7 focused conversations, approximately 3 to 5
hours of execution. Physical-device access, soak windows, CI queue time, owner
review, release, and activation waits are external elapsed time and are not
included.

### Total initial estimate

From the executable contract through an exact release-ready candidate:

- 33 to 56 focused implementation conversations
- Approximately 22 to 37 hours of machine execution
- External review, physical-device access, soak duration, CI queues, release,
  installation, and activation are excluded

This estimate is intentionally front-loaded toward total removal rather than
temporary adapters. It will be revised from measured stage receipts, not from
calendar intuition.

## 23. Operational authority boundaries

The architecture does not itself authorize:

- Provider traffic or provider-observable behavior changes
- Google Drive endpoint, header, retry, OAuth, or cadence changes
- Publication of a pull request
- Merge
- Release
- Installation
- Deployment
- Live-data migration
- Writer-epoch cutover
- Destructive cleanup

Each authority transition retains its operational review and receipt
requirements. Product implementation updates affected PHASE documents and
`docs/roadmap-status.json`. It does not edit the website roadmap lane.

## 24. Architectural decisions

The Library Core follows these decisions:

1. Stock SQLite is the only Library row engine in Desktop, headless, and PWA.
2. iOS 17 is the supported PWA durability floor.
3. Followers submit signed intents. Only the active Primary admits canonical
   operations.
4. Checkpoints carry normalized records and content descriptors, never content
   bytes that a follower may choose not to hydrate.
5. The logical-record ceiling begins at 128 KiB and remains subject to physical
   measurement before protocol freeze.
6. Media range size remains a measured content-plane parameter rather than the
   logical-record size.
7. Migration moves directly into the final schema with no dual write or
   compatibility authority.
8. A cutover may abort only before the first accepted new-epoch mutation.
   Later recovery always rolls forward with SQLite authoritative.
9. Historical runtime paths and emergency fallbacks are deleted after verified
   cutover.
10. The program prioritizes the shortest path to complete replacement, even
    when that makes individual implementation stages larger.
