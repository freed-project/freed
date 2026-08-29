# SQLite Library Core Delivery Roadmap

This document is the current engineering checkpoint ledger for Freed's SQLite
Library Core. It records what exists, what is being built next, and what proof
closes each stage. It does not redefine the architecture.

The architecture lives in
[ARCHITECTURE.md](ARCHITECTURE.md) and
[LIBRARY-CORE-ARCHITECTURE.md](LIBRARY-CORE-ARCHITECTURE.md). Exact durable
behavior lives in [LIBRARY-CORE-CONTRACT.md](LIBRARY-CORE-CONTRACT.md).

## Current checkpoint

Last updated: 2026-08-28

| Workstream                     | State                                     | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Next closing proof                                                                                                                             |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture and documentation | Complete                                  | SQLite-everywhere architecture, detailed contract, phase changes, and deletion target are documented in PR #1603                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Keep these documents synchronized with every implementation checkpoint                                                                         |
| Executable contract source     | Complete in code                          | One JSON contract generates the exact SQLite schema, 31 checkpoint record kinds, 23 canonical mutations, 5 device-local mutations, 33 bounded queries, native command protocols, actor capabilities, protocol ceilings, SQL programs, Rust constants, TypeScript codecs, and drift checks. No host maintains a parallel semantic registry. | Preserve generated-source parity in every exact-head build |
| Native core extraction         | Complete in code                          | `packages/library-core-native` owns SQLite authority, schema verification, typed queries, typed mutations, actor and writer verification, normalized checkpoint and follower protocols, snapshots, selective content, process leases, and bounded native commands. Freed Desktop and the headless Primary call this same core. | Complete installed Desktop and headless Primary acceptance |
| Final normalized schema        | Active in code                            | The generated strict SQLite catalog is the only writable Library schema for fresh Desktop, headless Primary, and PWA installations. It contains normalized authority, actors, roots, children, operations, replication, invalidation, follower, search, facet, timeline, and selective-content tables with no shell or whole-record JSON authority. | Prove installed migration and physical PWA durability |
| Mutation registry              | Complete in code                          | Twenty-one canonical mutation names map one-to-one to generated SQL programs and production callers. Five separate device-local programs cover graph layout and content policy without entering synchronized authority. Bulk scope staging, contact generations, content publication, actor administration, writer transition, checkpoint import, and recovery keep their own closed typed protocols instead of pretending to be canonical product mutations. Primary writes verify signed operations and commit rows, clocks, actor tips, receipts, replication records, and invalidations atomically. Followers store signed intents and sparse optimistic fields without changing canonical authority. | Preserve complete host routing and exact retry evidence in the final audit |
| Query registry                 | Complete in code                          | Thirty-three generated bounded query programs execute the same named SQLite contracts in native Rust and browser WebAssembly. Every product surface uses typed windows, exact source fences, bounded byte and row limits, and opaque keyset cursors. React retains only visible rows and ephemeral state. | Complete installed Desktop and physical iPhone performance evidence |
| Normalized synchronization     | Complete in code                          | Version 2 checkpoints, accepted transactions, signed follower intents, signed results, authenticated manifests, and selective content descriptors use stable typed identity and bounded canonical records. Desktop, headless Primary, and PWA import and export the same normalized protocol. | Complete installed multi-client convergence and response-loss evidence |
| PWA SQLite                     | Complete in code                          | Official SQLite WebAssembly runs in one worker over OPFS. The PWA uses the generated schema, queries, mutations, checkpoints, follower protocols, invalidation feeds, and selective content contract. IndexedDB remains only for the nonextractable actor key vault. | Complete physical iPhone durability, quota, suspension, recovery, and offline playback proof |
| Selective content plane        | Complete in code                          | Device-local SQLite policy selects stream, partial cache, complete cache, pinned offline, or excluded behavior. Native and PWA vaults verify bounded content-addressed ranges before availability, serve bounded playback windows, and keep media bytes outside normalized checkpoints. | Complete installed Desktop and physical iPhone content lifecycle proof |
| Direct migration and cutover   | Complete in code                          | One read-only historical source reader builds and verifies the final normalized candidate. One signed authority transition selects SQLite without dual write. The version 2 release manifest permits abort only before the first new-epoch mutation and requires roll-forward recovery afterwards. | Complete installed source migration and crash-boundary evidence |
| Runtime deletion               | Complete in code                          | Shell authority, whole-document transport, document workers, shadow stores, IndexedDB Library rows, renderer corpora, generic JSON mutations, fallback flags, and copied SQLite backups are absent from shipping paths. Negative artifact guards and the fenced read-only migration source remain. | Complete the final exact-head source and production-artifact audit |
| Acceptance and release handoff | In progress                               | Deterministic contract, native, browser, corruption, crash, replay, response-loss, byte-bound, and production-build validation is green on the feature branch. | Produce an exact-head dev build, then complete installed Desktop and physical iPhone acceptance |

The provider-neutral headless host now admits both signed agent queries and
signed intent pages through generated local actor protocol 2. Native SQLite
proves the active Library, epoch, actor, capability certificate, query grant,
canonical digest, and Ed25519 signature before a read. The service package also
emits deterministic digest-bound macOS LaunchAgent and Linux systemd user-unit
definitions from one verified config. Linux readiness now rejects every named,
masked, default, malformed, or mode-inconsistent ACL through one pinned bounded
helper. Windows remains fail closed pending its service-account named-pipe ACL
and inherited-handle implementation. Installed Drive coordination and live
service installation remain separate gated work.

The source tree no longer retains the 18 unreferenced authoritative-migration,
shadow-schema, shadow-generation registry, and shadow-generation schema SQL
artifacts. They had no caller, package export, build consumer, migration role,
or test role. The generated normalized schema and the fenced read-only schema
12 source verifier are now the only Library schema boundaries.

The extracted native core owns current actor capabilities, authority,
enrollment, operation verification, mutation admission, checkpoints,
followers, snapshots, queries, content, and storage errors in normalized
modules. No historical journal type, outbox, overlay, anchor, result, status,
materializer, or test fixture remains in its public or private runtime tree.
The read-only historical schema verifier imports only the final product data
needed for one normalized migration.

The native crate exposes no historical store, import status, checkpoint
reference, shell importer, whole-item staging, activation receipt, or overlay
replay API. The private
`HistoricalMigrationSource` can only open the fenced migration database,
provide its connection to the one-time normalized migration, or erase its held
files during normalized factory reset. Shared native storage failures now use
`LibraryCoreStorageError`; the obsolete `LibraryCoreStore` type, module, error,
result, field, and filename vocabulary is absent.

Primary follower transport now uses normalized SQLite and protocol version 2
end to end. Enrollment countersigning, actor-frontier reads, bounded intent
staging, and bounded signed-result export cross typed native commands only. The
coordinator validates the exact committed intent and result segment prefixes,
recovers response-lost result publication from immutable records, and leaves
Google Drive request behavior unchanged. No Desktop follower journal module,
historical native command, renderer DTO, opener, or mock remains.

The final normalized actor boundary accepts authority-signed version 2
capabilities only. The executable contract generates Primary writer and
capture-only scraper profiles. It no longer carries the historical version 1
editor profile. Normalized SQLite constraints, checkpoint activation, and
native mutation admission reject historical actor rows. The frozen source
operation list remains confined to the one-time migration verifier.

The PWA development and feature-preview path now creates an isolated normalized
SQLite Library from typed checkpoint records, installs the exact signed
follower enrollment, submits final signed mutation envelopes, and applies
authority-signed accepted results. Transactions may span bounded 128-record
transport pages and remain capped by the generated 1,000-member and 4,194,304
byte limits. Accepted `friend_replace` results now materialize the Person,
Person tags, complete desired Account set, Account follow roles, detached
social Accounts, contact replacement, and both Person and Account
invalidations with native Rust parity. Canonical binary64 wrappers are decoded
after signature verification before strict SQLite numeric writes.

Sample Library generation now emits normalized Person and Account records at
its source. Freed Desktop and the PWA consume those records directly. The
deprecated Friend-to-Person and Friend-to-Account converters, test-only
renderer graph implementation, global FeedItem scans, and corpus-backed Friend
author fallbacks are deleted.

The executable contract now declares closed query row models as well as query
SQL. Its generator emits TypeScript row types, wire validators, browser SQLite
coercers, Rust row descriptors, and drift-checked outputs from the same field
definitions. The Friends directory is the first end-to-end consumer. Native
Rust and browser OPFS SQLite now enforce the same field set, nullability,
boolean representation, integer ranges, UTF-8 byte ranges, and enum values.
Neither runtime maintains a hand-written row transform for that query.

The Friends Galaxy runtime now requires the bounded SQLite graph executor. It
cannot rebuild a fallback scene from React Person or Account dictionaries.
Worker-owned scene metadata returns stable selection IDs, labels, and admitted
counts, while React retains only the scene buffers and visible metadata needed
for interaction. Installation-local graph positions remain joined by the
SQLite graph pages and never require a renderer layout catalog.

SearchJump bulk read and archive now cross one closed platform action boundary.
React sends only the normalized feed or search scope and receives one compact
receipt. Desktop and PWA freeze the complete eligible set in installation-local
SQLite before the first write. They stage at most 256 stable IDs per append,
then page the frozen set through explicit assignment transactions of at most
1,000 members. Staging rows never enter checkpoints or replication. React never
receives the complete selected set.

Selective content scheduling now crosses one closed local SQLite boundary.
Native Rust and browser SQLite execute the same generated hydration and
least-recently-used eviction programs. Each page returns at most 128 rows and
binds the canonical generation plus device content revision. Cached reads
coalesce recency writes, and cache pressure cannot remove bytes after a newer
read. Download execution and user-owned storage transport binding remain open.

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
execution, checkpoint staging, content-vault access, normalized local
snapshots, recovery, and process exclusion behind runtime-neutral Rust APIs.

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

Complete maintenance actions first freeze their target identities in a durable
installation-local SQLite stage. RSS Feed removal and untitled-title repair
already use this path in Freed Desktop. The freeze and its exact response-loss
replay happen in one immediate transaction. React receives only bounded pages,
and each page is converted into canonical mutation batches. Scope stages never
enter checkpoints or replication.

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

Map and Story Wall use separate result models. `map_markers_v1` returns at most
1,000 compact location cards. `story_wall_candidates_v1` returns at most 250
compact media candidates with eight media references each. Both programs run
unchanged in native Rust and browser SQLite, use the visible publication index,
read one overflow row instead of counting the corpus, and never route through
the historical general FeedItem surface reader.

Map, Story Wall, Library facets, feed signal counts, and Saved analytics use
only their closed typed SQLite readers. A missing or rejected query fails closed
to an empty or unavailable view state. It never leases, scans, or reconstructs
the renderer corpus.

The primary Feed surface follows the same rule. Ordinary, Friends, and Saved
views retain only bounded SQLite page windows. Search retains only bounded
SQLite search results. Missing or failed readers never switch back to the app
store item corpus or repeat Saved ordering in JavaScript.

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

The official SQLite WebAssembly worker persists the complete Library in OPFS.
The engine, exact schema identity, typed worker dispatch, normalized checkpoint
activation, signed follower protocols, and bounded query adapters are
implemented. Every PWA product view reads bounded SQLite windows through the
same generated contracts as Freed Desktop. IndexedDB Library state and
renderer corpus fallbacks are deleted. Recovery UI and physical iPhone
lifecycle proof remain in progress.
Use the generated schema, SQL, result DTOs, mutations, codecs, and vectors.

Store canonical replica rows, indexes, search, intent outbox, result receipts,
and the sparse optimistic overlay in SQLite. A narrow IndexedDB keystore may
remain only for nonextractable keys when WebKit provides no suitable
alternative.

`search_page_v1` is implemented in both SQLite runtimes. It applies normalized
feed and Friends predicates in SQL, resolves Account aliases from Account rows,
scans a maximum of 256 primary-key-ordered candidates, and returns at most 32
closed scored cards. Desktop and PWA use the same TypeScript contract, generated
SQL, source-bound cursor, digest vector, and deterministic Rust and TypeScript
scoring rules. The historical PWA IndexedDB search database and Desktop JSON-row
search command are removed.

`preferences_snapshot_v1` now has one shared reconstruction transform for
native and browser query executors. It rejects oversized arrays, conflicting
logical paths, missing containers, malformed JSON paths, and prototype-bearing
object creation. The PWA hydrates synchronized preferences from these bounded
SQLite nodes. Explicit archive and toggle commands also resolve their current
item state through normalized SQLite detail before creating signed follower
intents. Startup reads only the facet summary and preference snapshot. Views
open their own bounded typed queries and retain only visible windows, selected
detail rows, and ephemeral interface state. No shell read or identity catalog
hydration participates.

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
after parity, authority, checkpoint, normalized snapshot, and follower import
proof.

Rollback is allowed only before a later canonical write and only to the same
frontier. After a later write, recovery rolls forward from immutable logical
objects and normalized snapshots.

Fresh Freed Desktop installations do not manufacture an empty historical
Library to enter this sequence. After bounded retired-storage absence checks,
the native core signs a fresh SQLite genesis, installs its normalized authority
and Primary actor, and publishes the final selector during the first launch.
Existing installations with any historical row remain on the migration path
and cannot be mistaken for a fresh Library.

Production renderer startup proceeds only after native code verifies that
normalized SQLite is selected. A failed migration or genesis stops startup
without creating a portable shell or reopening historical authority. Historical
bytes remain untouched for diagnosis and an exact retry. The isolated browser
test harness reports normalized authority before supplying its in-memory view
fixture. It cannot create or select product storage.

Delete:

- Automerge runtime, worker, persistence, merge, and cloud paths
- current-state `shellJson`, `shell_json`, `DesktopLibraryShell`, and equivalent
  shells, while the fenced one-time migration reader may still name and read
  the immutable historical source column long enough to decompose required
  product fields
- monolithic `DocState` and whole FeedItem checkpoint records
- shadow stores, shadow readers, compatibility leases, and dual-engine flags
- IndexedDB Library generations, rows, indexes, overlays, and cursors
- ordinal checkpoint identity
- whole-corpus subscriptions and renderer state
- retired identity graph models, layout workers, and tests that build a
  renderer-owned corpus instead of consuming bounded SQLite graph pages
- direct Friends Galaxy whole-source worker requests and caller-side source
  queues outside normalized SQLite page staging
- generic patch and toggle mutation routes
- database, WAL, SHM, and rollback-journal cloud transport
- rollback flags that revive retired engines
- dead migrations, repair routes, exports, tests, and vocabulary with no final
  product requirement

Freed Desktop has no native or browser-harness generic item query, whole-item
upsert, point-read, shell replacement, or generic item mutation command.
Follower aggregate refreshes use the normalized SQLite facet query. Browser
tests simulate ordinary mutations through an explicit test-only normalized
bridge that cannot exist in a product build. Like and seen provider delivery
acknowledgements use the same signed normalized transaction boundary as every
other Primary mutation.

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
