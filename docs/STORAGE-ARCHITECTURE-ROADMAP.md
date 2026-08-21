# SQLite Library Core Delivery Roadmap

This document is the current engineering checkpoint ledger for Freed's SQLite
Library Core. It records what exists, what is being built next, and what proof
closes each stage. It does not redefine the architecture.

The architecture lives in
[ARCHITECTURE.md](ARCHITECTURE.md) and
[LIBRARY-CORE-ARCHITECTURE.md](LIBRARY-CORE-ARCHITECTURE.md). Exact durable
behavior lives in [LIBRARY-CORE-CONTRACT.md](LIBRARY-CORE-CONTRACT.md).

## Current checkpoint

Last updated: 2026-08-21

| Workstream | State | Current evidence | Next closing proof |
| --- | --- | --- | --- |
| Architecture and documentation | Complete | SQLite-everywhere architecture, detailed contract, phase changes, and deletion target are documented in PR #1603 | Keep these documents synchronized with every implementation checkpoint |
| Executable contract source | In progress | `sqlite-contract-v1.json` now generates closed root and child row field sets, the checkpoint registry, 39 mutation IDs, 28 bounded query IDs, protocol limits, exact shared schema bytes, and matching Rust and TypeScript constants with a drift check | Extend the IDL across mutation SQL, query SQL, result payload codecs, invalidations, and deletion obligations |
| Native core extraction | Foundation exists | `packages/library-core-native` contains SQLite authority, journal, actor, lease, and checkpoint foundations | Freed Desktop and headless entry points call the same final native core, with no Library semantics in Tauri |
| Final normalized schema | Implemented, not active | `normalized-schema-v1.sql` defines strict normalized root, child, coordination, blob, and chunk tables with bounded indexes and no shell or whole-record JSON authority. Rust and TypeScript consume the exact same schema bytes and SHA-256 identity | Wire all native mutations and named queries to this catalog, then activate it through the one-epoch migration |
| Mutation registry | Partial foundation | Existing native and shared operation contracts cover several product writes | Every durable product write is registered, typed, atomic, capability-scoped, and consumed by a real entry point |
| Query registry | Partial foundation | Several Freed Desktop surfaces already have bounded SQLite readers | Every Freed Desktop and PWA surface uses generated named SQL with stable keyset cursors and fixed budgets |
| Normalized synchronization | Native export implemented | The v2 registry has stable registry-plus-primary-key identity, closed payload fields for normalized root and child rows, exact native response bounding, and lossless 4 MiB chunk export and reassembly. Native export reads final SQLite tables directly and emits no shell record | Add transactional staging import and the equivalent browser worker exporter, followed by operation, intent, result, and manifest integration |
| PWA SQLite | Not started | Browser checkpoint, query, and intent behavior provides semantic source material | Official SQLite WebAssembly over OPFS passes iPhone durability, recovery, query, mutation, and synchronization tests |
| Selective content plane | Design complete | Descriptor, chunk, range, hydration, and cache policies are specified | Desktop and PWA prove metadata-only, stream, partial-cache, full-cache, pinned-offline, and excluded modes |
| Direct migration and cutover | Not started | Source census and migration contracts exist | One external-memory migration writes the final schema and activates one SQLite-only storage epoch |
| Runtime deletion | Not started | Deletion registry is documented | Automerge, shells, shadow stores, IndexedDB Library rows, dual paths, and fallback flags are absent from runtime bundles and callers |
| Acceptance and release handoff | Not started | Test and evidence requirements are documented | Exact-head native, browser, iPhone, installed Desktop, performance, crash, and response-loss evidence is complete |

## Destination

Freed uses SQLite everywhere:

- Freed Desktop and the headless Primary use one extracted Rust core and
  bundled SQLite.
- The PWA uses official SQLite WebAssembly in a worker and stores the Library
  in OPFS.
- Every product view uses a bounded typed SQLite query.
- Every durable edit uses a registered mutation.
- React stores only visible windows and ephemeral interface state.
- Google Drive carries typed normalized protocol objects and optional content
  blobs, never database files.
- One active Primary admits canonical writes. Followers submit signed intents
  and apply signed canonical results.
- Each client chooses which large content to stream, cache, pin, or exclude.

## Delivery sequence

Each stage lands final-model code. No stage introduces a compatibility shell,
dual write, alternate row store, or temporary product architecture.

### 1. Executable contract and generation

Build one source of truth for:

- logical fields and locality
- normalized tables and indexes
- mutation names, inputs, capabilities, algebra, and effects
- query names, inputs, outputs, ordering, indexes, and budgets
- checkpoint record kinds and typed primary keys
- operation, intent, result, manifest, and control objects
- content descriptors, chunk records, and range indexes
- physical schema and protocol compatibility
- source migration mappings and final deletion obligations

Generate Rust and TypeScript types, codecs, validators, registry constants, SQL
bindings, and conformance vectors. CI fails on generated drift, unregistered
durable state, or registered exports without real callers.

Exit proof:

- native and browser vectors are byte-identical
- schema and SQL catalogs match the generated manifest
- every registered query and mutation has a consumer
- the deletion registry identifies every retired runtime path

Estimated machine time: 2 to 4 focused conversations, approximately 1 to 2
hours.

### 2. Final native database foundation

Complete `packages/library-core-native` as the only native Library engine.
Move schema opening, migrations, authority, mutation execution, query
execution, checkpoint staging, content-vault access, backup, recovery, and
process exclusion behind runtime-neutral Rust APIs.

Freed Desktop becomes a Tauri host adapter. The headless Primary becomes a
second host of the same core. Neither host forks Library behavior.

Exit proof:

- a headless fixture and Freed Desktop open the same database format
- two processes cannot write one data root
- unknown schema, registry, or protocol versions fail before write authority
- Tauri contains no Library schema, SQL, or mutation semantics

Estimated machine time: 3 to 5 focused conversations, approximately 2 to 3
hours.

### 3. Complete mutations and normalized materialization

Route every retained product write through the generated mutation registry.
This includes item state, highlights, notes, feeds, subscriptions, people,
accounts, relationships, tags, graph state, ranking policy, capture policy,
preferences, saved-link capture, provider capture, imports, maintenance,
tombstones, and content metadata.

Each mutation commits canonical rows, journal occurrence, materialized effects,
actor tip, tombstone or cascade effects, receipt, replication outbox, and
invalidation topics in one SQLite transaction.

Exit proof:

- every product write maps to one registered mutation
- retry is idempotent
- capability and writer-epoch checks fail closed
- legal large fields become content descriptors and bounded chunks
- no generic JSON patch, shell mutation, or JavaScript cascade remains

Estimated machine time: 5 to 8 focused conversations, approximately 3 to 5
hours.

### 4. Complete bounded queries

Route feed, Saved, search, item detail, Friends, map, Story Wall, analytics,
facets, counts, settings, exports, diagnostics, and selected content through
named SQL. Use stable keyset cursors and explicit byte and row budgets.

Add a compact invalidation stream keyed by registered topics. Views refresh
only the pages or aggregates affected by a committed mutation.

Exit proof:

- every view queries SQLite directly through its platform adapter
- no query returns or scans the corpus in JavaScript
- query plans use registered indexes at 25,000 and 100,000 items
- renderer and worker memory stay bounded while traversing the full Library

Estimated machine time: 5 to 8 focused conversations, approximately 3 to 5
hours.

### 5. Normalized wire protocol

Implement `freed_normalized_checkpoint_v2` as a stream of closed typed records.
Record identity is the stable registry key plus canonical typed primary key.
Page order is never logical identity.

The transport profile uses:

- at most 131,072 canonical bytes per logical record, frozen after the required
  physical measurements
- at most 128 records per page
- at most 2,097,152 decoded canonical bytes per page
- at most 1,048,576 source bytes per native export response
- content descriptors and content-addressed chunks for larger legal values

Add append-only operation segments, signed follower intents, signed Primary
results, authenticated manifests, content descriptors, and range indexes. Keep
Google Drive endpoints, headers, retries, OAuth behavior, and cadence unchanged.

Exit proof:

- a legal maximum-sized item round-trips losslessly through native and browser
  SQLite as bounded records
- every record validates before import
- incomplete, duplicated, reordered, oversized, or mismatched data fails before
  activation
- no `00_library_shell`, `shellJson`, whole FeedItem JSON, or SQLite file enters
  the transport

Estimated machine time: 4 to 7 focused conversations, approximately 3 to 5
hours.

### 6. PWA SQLite and editable follower behavior

Run official SQLite WebAssembly in one worker and persist the Library in OPFS.
Use the generated schema, SQL, result DTOs, mutations, codecs, and vectors.

Store canonical replica rows, indexes, search, intent outbox, result receipts,
and the sparse optimistic overlay in SQLite. A narrow IndexedDB keystore may
remain only for nonextractable keys when WebKit provides no suitable
alternative.

Exit proof:

- iOS 17 physical-device tests cover persistence, suspension, worker loss,
  quota pressure, recovery, and offline playback
- every PWA view uses bounded SQLite queries
- intent and result reconciliation survives restart and response loss
- IndexedDB contains no Library rows, cursors, checkpoints, search state,
  intents, results, or compatibility state

Estimated machine time: 4 to 7 focused conversations, approximately 3 to 5
hours.

### 7. Selective content plane

Separate logical metadata replication from large byte hydration. A descriptor
identifies the content, rendition, length, digest, chunk or range structure,
and available sources. Each client stores its own hydration and retention
policy.

Exit proof:

- Freed Desktop can pre-download and verify multi-gigabyte video without
  loading it into application memory
- PWA can stream selected ranges, cache a subset, pin a complete rendition, or
  exclude the asset
- metadata checkpoints remain complete when no content bytes are local
- garbage collection preserves every canonical, pinned, checkpointed, backed
  up, or actively transferred object

Estimated machine time: included across stages 3, 5, and 6.

### 8. Direct migration, cutover, and deletion

Read the source Library through a bounded external-memory migration process and
write directly into the final SQLite schema. Record an explicit result for
every source field and content object. Activate one SQLite-only storage epoch
after parity, authority, checkpoint, backup, and follower import proof.

Rollback is allowed only before a later canonical write and only to the same
frontier. After a later write, recovery rolls forward from immutable logical
objects and backups.

Delete:

- Automerge runtime, worker, persistence, merge, and cloud paths
- `shellJson`, `shell_json`, `DesktopLibraryShell`, and equivalent shells
- monolithic `DocState` and whole FeedItem checkpoint records
- shadow stores, shadow readers, compatibility leases, and dual-engine flags
- IndexedDB Library generations, rows, indexes, overlays, and cursors
- ordinal checkpoint identity
- whole-corpus subscriptions and renderer state
- generic patch and toggle mutation routes
- database, WAL, SHM, and rollback-journal cloud transport
- rollback flags that revive retired engines
- dead migrations, repair routes, exports, tests, and vocabulary with no final
  product requirement

Exit proof:

- production bundles contain no retired runtime engine or payload
- source parity and exclusion closure cover every retained field and byte
- the Primary publishes a normalized checkpoint for the new storage epoch
- Freed Desktop and a physical iPhone import and query the exact checkpoint
- deletion scans, caller scans, release inspection, and migration receipts pass

Estimated machine time: 6 to 10 focused conversations, approximately 4 to 7
hours.

### 9. Acceptance and release handoff

Run native and browser conformance, fault injection, performance fixtures,
physical iPhone storage and media tests, installed Freed Desktop verification,
and exact-head integration validation. Reconcile every affected PHASE document
and `roadmap-status.json` with the measured result.

Exit proof:

- exact commit and tree are recorded
- all required local and CI checks pass
- installed build identity matches the candidate
- the acceptance receipt names schema, protocol, registry, migration,
  checkpoint, content, browser, and performance evidence
- remaining work is either zero or recorded as a deduplicated `debt` issue

Estimated machine time: 4 to 7 focused conversations, approximately 3 to 5
hours. Physical-device access, soak windows, CI queues, release, installation,
and activation are external elapsed time.

## Total estimate

The initial estimate from executable contract through release-ready candidate
is 33 to 56 focused implementation conversations and approximately 22 to 37
hours of machine execution. The estimate is updated from measured stage
receipts after each checkpoint.

## Operational boundaries

The implementation program does not imply authority for provider traffic,
provider-observable behavior changes, Google Drive behavior changes, release,
installation, deployment, live-data migration, writer-epoch cutover, or
destructive cleanup. Those operations retain their separate controls and
evidence requirements.

Product implementation updates affected PHASE documents and
`roadmap-status.json` in the same commit as each checkpoint. The public website
roadmap remains in its separate `www` lane.

## Completion

The program is complete only when every supported client queries SQLite,
every durable write uses a registered mutation, synchronization uses only
normalized typed protocol objects, selective content behavior works on real
devices, the SQLite-only epoch is active, and every retired runtime path in the
deletion list is absent.
