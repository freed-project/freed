# Freed Technical Architecture

Freed uses SQLite everywhere. Freed Desktop, the headless Primary, and the PWA
all query a local SQLite Library through the same generated contract. React
holds visible result windows and ephemeral interface state only.

The complete Library model lives in
[LIBRARY-CORE-ARCHITECTURE.md](LIBRARY-CORE-ARCHITECTURE.md). Exact durable
contracts live in [LIBRARY-CORE-CONTRACT.md](LIBRARY-CORE-CONTRACT.md). Current
delivery checkpoints live in
[STORAGE-ARCHITECTURE-ROADMAP.md](STORAGE-ARCHITECTURE-ROADMAP.md) and the
affected `PHASE` documents. Durable stability policy lives in
[STABILITY-PROGRAM.md](STABILITY-PROGRAM.md).

## System shape

```text
Provider capture and user actions
                |
                v
       registered mutations
                |
                v
     active Primary Library Core
      Rust plus bundled SQLite
                |
        signed logical objects
                |
       user-owned Google Drive
                |
         +------+------+
         |             |
         v             v
  Freed Desktop       PWA
  local SQLite     SQLite WASM
                    plus OPFS
```

One active Primary admits canonical mutations for a Library and writer epoch.
The Primary can run inside Freed Desktop or the provider-neutral headless
service. Editable follower clients keep complete queryable local replicas and
submit signed mutation intents. The Primary validates each intent, commits it
atomically, and publishes a signed result.

SQLite files are private local implementation artifacts. Synchronization never
copies a database, WAL, SHM, or rollback journal. It transfers typed normalized
records, operation segments, signed intents and results, authenticated
manifests, content descriptors, and content-addressed blobs.

## Runtime ownership

### Native Library Core

`packages/library-core-native` owns the native data plane. It contains the
schema, migrations, mutation executor, named query executor, authority journal,
checkpoint import and export, content-vault interface, process exclusion, and
recovery logic. It has no Tauri, React, provider, or network dependency.

Freed Desktop and the headless Primary call this same Rust library. Their host
layers provide windows, lifecycle, credentials, scheduling, network adapters,
and platform capabilities. They do not contain alternate Library semantics.

### Browser Library Core

The PWA runs official SQLite WebAssembly in a dedicated worker and persists the
Library in OPFS. It consumes the same schema catalog, named SQL, result DTOs,
mutation definitions, protocol registry, and conformance vectors as native
hosts. A narrow browser key store may hold nonextractable cryptographic keys.
IndexedDB is not a Library database, transport, fallback, or rollback path.

iOS 17 is the supported browser durability floor. Physical iPhone acceptance
covers storage persistence, quota pressure, suspension, worker replacement,
checkpoint activation, intent recovery, and selective offline media.

### React applications

`packages/ui` owns platform-neutral product views. A view asks its platform
adapter for a bounded named query and receives a closed typed DTO. The adapter
may stream subsequent pages, but it never returns the Library corpus.

React may retain:

- visible and adjacent result windows
- current navigation and selection
- draft form state
- transient request and error state
- device-local presentation settings

React may not retain an authoritative Library, full search index, full result
set, mutation shadow, or synchronization document.

## Data model

The Library is normalized around stable identities and explicit relationships.
The schema includes:

- items, item state, sources, feeds, authors, people, accounts, and identities
- tags, item-tag edges, relationships, follows, blocks, and graph state
- ranking policy, capture policy, synchronized preferences, and user-created
  organization
- registered mutation occurrences, actor chains, tombstones, receipts, and
  authority epochs
- checkpoint state, imported frontiers, operation segments, and follower
  intent and result state
- content descriptors, renditions, chunk indexes, cache policy, and local
  hydration state

Device-local state such as window geometry, graph pin coordinates, temporary
filters, provider session cookies, retry timers, machine endpoints, and cache
residency remains outside synchronized Library state.

No `shellJson`, `DocState`, monolithic FeedItem record, generic JSON patch, or
equivalent catch-all object is part of the runtime model.

## Query and mutation contracts

One executable contract source generates Rust and TypeScript bindings. It
registers every durable field, table, mutation, query, checkpoint record,
protocol object, content descriptor, locality rule, and deletion obligation.

Named queries define:

- closed input and output types
- stable keyset ordering
- maximum page size and byte budget
- required indexes
- authorization and locality
- invalidation topics
- failure variants

Registered mutations define:

- closed typed input
- actor capability
- canonical validation
- transaction scope
- merge algebra or conflict rule
- tombstone and cascade behavior
- materialized tables and indexes
- emitted operation and invalidation records
- idempotency and receipt behavior

All product reads and writes use these contracts. There is no unbounded query,
whole-corpus subscription, generic patch route, or hidden JavaScript cascade.

## Synchronization

The active Primary publishes immutable normalized checkpoints and append-only
operation segments through the user's Google Drive `appDataFolder`. One small
authenticated control tuple identifies the current writer epoch, checkpoint,
frontier, schema, and protocol version.

Checkpoint identity is the stable registry entry plus the record's typed
primary key. Page position is transport metadata only. A page contains no more
than 128 records and no more than 2,097,152 decoded canonical bytes. Each
logical record is capped at the protocol's measurement-gated 131,072-byte
ceiling. Legal values that exceed the ceiling use content descriptors and
bounded content-addressed chunks.

Follower edits use closed signed intent envelopes. An intent binds the Library,
writer epoch, actor, capability, transaction, ordered operations, predecessor,
and idempotency key. The Primary either commits the complete transaction and
publishes its canonical result, or rejects it with a signed typed reason.
Clients retain a sparse durable optimistic overlay until canonical checkpoint
or result evidence resolves the intent.

Protocol and physical schema versions are independent. Unsupported protocol,
registry, schema, or capability versions fail closed before activation. A new
protocol version never revives a shell or dual-write bridge.

## Content plane

Large content lives outside logical row records. Metadata checkpoints carry
descriptors with content identity, media type, byte length, digest, rendition,
chunk or range index, and availability policy.

Each device independently chooses one policy per asset or rendition:

- metadata only
- stream on demand
- partial cache
- full cache
- pinned offline
- excluded

Freed Desktop can pre-download long-form video and place it in a local content
vault. Another client can stream the same rendition from Google Drive, hydrate
only a range, or exclude it. Descriptor convergence does not imply byte
hydration. Garbage collection preserves bytes reachable from canonical
descriptors, pinned policies, retained checkpoints, backups, or active
transfers.

## Capture and providers

Provider packages extract and normalize bounded records. They never own the
Library. Capture results enter the registered mutation boundary and commit in
the active Primary.

Authenticated sessions remain isolated by provider. Provider-visible behavior,
including navigation, requests, headers, cookies, extraction scripts, timing,
and media loading, follows the separate provider-risk rules in `AGENTS.md` and
[STABILITY-PROGRAM.md](STABILITY-PROGRAM.md). Library architecture changes do
not alter provider traffic by implication.

## Package boundaries

| Package | Responsibility |
| --- | --- |
| `packages/shared` | Pure generated types, codecs, SQL catalog metadata, validation, and cross-runtime vectors. No React or platform APIs. |
| `packages/library-core-native` | Runtime-neutral Rust Library Core for native hosts. |
| `packages/ui` | Platform-neutral React views over typed query and mutation adapters. |
| `packages/sync` | Storage-neutral protocol orchestration and cloud transport ports. No Library authority. |
| `packages/desktop` | Tauri host, native adapter, scheduling, credentials, windows, and provider integration. |
| `packages/pwa` | Browser host, SQLite worker adapter, OPFS lifecycle, service worker, and mobile shell. |
| `packages/capture-*` | Isolated provider extraction and normalization. Capture packages never import each other. |
| `website` | Marketing site in the separate `www` lane. |

## Failure semantics

Durable state changes are atomic SQLite transactions. Crashes before commit
leave no accepted mutation. Crashes after commit recover from journal and
receipt state without replaying a non-idempotent effect. Checkpoint imports use
a staging database and activate only after complete manifest, registry,
frontier, row, content-root, and integrity verification.

Unknown versions, missing fields, invalid signatures, broken actor chains,
split writer epochs, oversized records, stale cursors, source movement, and
content digest mismatches return closed typed failures. A client never repairs
these conditions by loading a compatibility engine.

## Observability and performance

Every query, mutation, checkpoint page, intent, result, import, export, and
content transfer records bounded structured telemetry. Events include build,
schema, protocol, registry, query or mutation name, duration, row count, byte
count, cursor outcome, transaction identity, and typed failure code. Telemetry
never includes provider credentials or private content bodies.

Performance gates cover 25,000-item and 100,000-item Libraries. They enforce
bounded renderer memory, bounded worker memory, indexed query plans, fixed page
and response budgets, bounded startup work, and recovery without corpus
materialization.

## Release and operations

Product work flows through `dev`, production promotion through `main`, and the
public website through `www`. Release, installation, deployment, live-data
migration, writer-epoch cutover, destructive cleanup, and provider-visible
changes retain their own explicit operational authority.

Validation uses path-scoped feature checks during implementation, complete
integration checks at the `dev` boundary, release checks for promotion, native
and browser conformance vectors, crash and response-loss fault injection,
physical iPhone storage evidence, and installed Freed Desktop evidence.

GitHub Issues labeled `debt` remain the sole engineering debt backlog.
