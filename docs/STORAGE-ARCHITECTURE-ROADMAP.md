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
| Executable contract source     | In progress                               | `sqlite-contract-v1.json` now generates closed root and child row field sets, the checkpoint registry, 39 mutation IDs, eighteen canonical mutation SQL programs, four installation-local graph-position mutation programs, eighteen query SQL programs, capability profiles, 33 bounded query IDs, protocol limits, exact shared schema bytes, and matching Rust and TypeScript constants with a drift check. Local programs cannot gain actor, revision, receipt, checkpoint, invalidation, or replication effects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Extend the IDL across every remaining result payload codec, invalidation, source migration, and deletion obligation                            |
| Native core extraction         | In progress                               | `packages/library-core-native` owns the normalized SQLite schema, query and mutation execution, authority journal, actor verification, checkpoint staging, descriptor-bound database routing, and process leases. Freed Desktop and the headless sidecar open the same final normalized database in a private `library-sqlite` directory with shared connection configuration and exact schema, application, contract, and protocol verification. The sidecar acquires its data-root lease first and creates no historical checkpoint store or backup tree. Generated command protocol 1 carries length-prefixed frames over dedicated inherited descriptors, capped at 4 MiB. Its closed registry executes normalized checkpoint begin, append, finalize, pinned export, registered query, and storage-inspection functions. Startup verifies the exact generated storage identity through that channel before reporting running. Freed Desktop exposes one closed native query command. Its historical database remains a separate fenced migration source and receives no mirrored normalized writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Bind installed Drive coordination and authority-key mutation admission, then delete Library semantics from Tauri                               |
| Final normalized schema        | Implemented, not active                   | `normalized-schema-v1.sql` defines strict normalized authority, frontier, actor, capability, root, child, operation, causal-tip, replication, invalidation, signed-intent, result, optimistic-field, blob, chunk, trigger-maintained facet and Person timeline indexes, and installation-local graph layout tables with bounded indexes and no shell or whole-record JSON authority. FeedItem and Account triggers maintain the Person timeline relation transactionally. Device graph layout uses foreign-keyed Person and Account rows that are excluded from checkpoint and replication registries. Its separate local revision invalidates graph cursors without changing canonical source revision. Rust and TypeScript consume the exact same schema bytes, SHA-256 identity, and fixed application ID, and refuse foreign files before schema writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Wire all native mutations and named queries to this catalog, then activate it through the one-epoch migration                                  |
| Mutation registry              | Eighteen normalized commit paths          | FeedItem read, saved, archived, liked, capture, and removal mutations, RSS feed upsert and deterministic title assignment, Account upsert, person assignment, and removal, Person upsert, reach-out append, both Person removal policies, both RSS feed removal policies, and typed preference assignment use generated programs and the extracted native signature verifier. Person removal can delete linked Accounts or preserve them while SQLite clears their Person references. Each mutation atomically commits the transaction, actor tip, normalized value or tombstone, exact receipt, replication outbox, bounded invalidation, and revision. Reach-out events use accepted operation IDs as stable row identities, remain separate from Person profile writes, and retain the latest twenty through a deterministic SQLite order. Preference assignment deep-merges object patches, replaces scalar and array subtrees, and preserves explicit empty containers through typed markers. RSS title and Account person assignments use timestamp and operation-ID field clocks. Account person assignment preserves nullable links while SQLite refuses missing Person references. Account and Person upserts replace typed root columns and normalized set relations through generated statement lists. RSS, Account, and Person upsert cannot resurrect tombstoned entities. Generated dependent-delete SQL distinguishes retaining RSS items from deleting them. Tampering, lost writer admission, changed replay, stale clocks, invalid references, and incomplete targets fail without partial projection writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Route every durable product call site through the native or signed-intent boundary and register any retained missing behavior                  |
| Query registry                 | Forty normalized query paths              | Ranked feed browsing, feed pages, Person and Account timelines, Friends activity, background item pages, compact invalidations, facet summaries, Saved analytics, preference nodes, item details, Person details, Account details, RSS Feed details, compact Person and Account graph source pages, one reusable RSS feed page, a 12-row indexed Person picker, a 50-row indexed Account picker, ranged reader bodies, map markers, Story Wall candidates, and full-library search execute generated normalized SQL through equivalent closed browser and native dispatch. Freed Desktop's flat native command accepts only registered IDs and exact typed fields. Shared UI receives one generic typed query executor instead of view-specific transport shims. The ordinary feed, Friends feed, four-mode Saved feed, search, signal counts, item detail, Library facets, Saved analytics, Map, Story Wall, selected Person timelines, selected unlinked Account timelines, Friends activity, source-fenced Friends locations, Friends graph sources, graph Person picker, and Friend editor call that boundary directly on Desktop and PWA. Search retains at most 100 ranked SQLite cards and never creates a renderer MiniSearch index, refilters a renderer corpus, or scans a compatibility source. The shared Friends workspace retains only bounded SQLite results and fails closed for the current source generation instead of rebuilding a renderer corpus. The graph Person picker performs prefix search through the indexed SQLite Person model and returns only ID, name, avatar, and relationship status. The Friend editor calls `account_picker_page_v1`, which joins trigger-maintained visible author activity to unlinked social Accounts, uses indexed default ordering or FTS5 trigram substring search, and returns at most 50 compact rows. React never receives a complete Person or Account dictionary for linking. Selected Accounts are revalidated through `account_detail_v1` under one exact source fence before saving provenance. Partial Person, Account, and RSS Feed mutations resolve missing visible state through exact bounded detail queries, so sparse React windows cannot erase synchronized fields. `persons_graph_v1` accepts at most 128 combined social and RSS identities per call. One shared adapter batches larger workspaces, rejects source movement between batches, and returns bounded samples, locations, avatars, recent counts, and the closed signal vector without scanning FeedItems in Rust, TypeScript, React, or IndexedDB. They retain compact bounded rows and opaque keyset cursors without using the historical item query. Map and Story Wall share one compact-row view transform across operational environments. `feed_browse_page_v3` applies its complete filter in SQLite and pages forward or backward over `(archived, rounded priority DESC, published_at DESC, global_id)` without source-enumeration state or a temporary sort. Its closed Friends identity mode joins FeedItem provider and author identity to Account and Person, requires `relationship_status = 'friend'`, and binds the identity mode into every cursor digest. `saved_analytics_v2` returns one source-fenced row with exact total, latest time, fixed day and hour buckets, and bounded binary-ordered source and content counts instead of scanning FeedItems in application code. Person timelines walk a transactionally maintained `(person_id, published_at, global_id)` relation. Unlinked Account timelines join one stable Account ID to FeedItems through typed provider and external identity columns. Both are capped at 100 rows and 2 MiB, with cursors bound to the exact selected identity and source fence. Detail queries return one source-fenced normalized row with bounded ordered child values. Graph source queries page compact roots by binary primary key without sending contact fields, notes, tags, histories, polling policy, or a complete identity corpus to React. The shared graph client requests one 128-row page at a time, waits for worker admission, and commits compact scene state only after all three query families close under one canonical and local-layout fence. Account graph rows reuse the trigger-maintained author aggregate instead of running per-row FeedItem subqueries. RSS rows carry indexed visible activity counts and latest activity times. RSS images use the latest indexed visible item only when the feed has no image. The change feed pins an upper revision, returns no entity rows, and refuses gaps. Facets use maintained counters. Preferences return binary-ordered typed scalars and explicit container markers. Item detail returns compact metadata plus reader-body locators. Reader bodies return no more than 256 KiB from inline text or five content-addressed chunks. Arbitrary SQL is impossible | Replace remaining Friends maintenance and mutation paths with the typed boundary, then delete their legacy inputs                              |
| Normalized synchronization     | Closed native result protocol implemented | The v2 registry has stable registry-plus-primary-key identity, closed authority, actor, capability, root, and child payloads, exact actor chain continuation, exact binary64 fractions, bounded native export, shared generated import SQL, cross-runtime digest vectors, transactional native and browser activation, accepted-authority proof, foreign-key proof, and lossless chunk verification. Desktop publication, follower bootstrap, and writer transfer use typed normalized records directly under `library_core_normalized_checkpoint_v2`. Desktop and PWA bind the same storage-neutral staging state machine to native or browser SQLite. The portable checkpoint producer, importer, shared contracts, native whole-item import commands, offset payload page, and orphaned browser compatibility specifications are deleted. Browser SQLite commits complete signed intents with sparse optimistic fields and settles exact authority-signed results through actor-scoped contiguous result cursors in one transaction. The native Primary creates an accepted result inside the same immediate transaction as the verified operation, normalized materialization, actor tip, revision, receipt, replication outbox, and invalidation. Rejected and already-applied results use the same active-key proof, bounded canonical envelope, immutable outbox, and actor result chain without inventing an accepted transaction or changing product rows, operations, actor tips, or revisions. No shell or whole FeedItem record participates in checkpoint transport                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Replace the remaining historical sync descriptor and authority bootstrap with normalized SQLite identity                                       |
| PWA SQLite                     | In progress                               | Official SQLite WebAssembly installs the generated schema through one bounded worker over `opfs-sahpool`, verifies exact contract identity, executes the generated SQL registry, commits signed follower intents, applies exact signed results, and stages, verifies, and atomically activates normalized checkpoint pages without arbitrary SQL or IndexedDB Library rows. Feed, Saved, Friends, search, reader, Map, Story Wall, Header, Sidebar, command palette, settings catalogs, and maintenance scopes use bounded typed SQLite queries. Trigger-maintained facets supply exact navigation totals without scanning FeedItems. Desktop and PWA now consume one shared provider-neutral follower coordinator. It reads one closed SQLite transport frontier, publishes one bounded normalized intent page, repairs one response-lost head from its immutable segment, and imports verified result segments through atomic SQLite callbacks. One browser-safe shared Google Drive transport factory owns enrollment publication and verification, exact certificate selection, normalized intent-head access, and bounded result-reference paging. Desktop consumes it with a Follower-role fence before every provider operation. The PWA remains a thin OPFS SQLite runtime binding while its production Google Drive activation stays open. The portable checkpoint store, IndexedDB read model, intent overlay, shell bootstrap, generic IndexedDB Library helper, dormant browser specifications, and their compatibility tests are deleted. IndexedDB appears only inside the dedicated nonextractable actor key vault because browser CryptoKey structured cloning cannot use SQLite. Factory reset removes the OPFS SQLite pool and that key vault                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Activate the shared Google Drive transport from the PWA coordinator after provider behavior approval, then complete recovery UI, selective content, and physical iPhone durability proof |
| Selective content plane        | In progress                               | The executable SQLite schema separates six-state device policy from verified availability and range records. One generated local mutation program drives Rust and PWA policy writes. The headless native command boundary and PWA worker expose the same bounded policy mutation and point-state read. Canonical ranged descriptors commit to ordered typed range records through one cross-runtime digest domain. Native and PWA checkpoint activation stream and verify the exact range map, reject gaps and changed roots, and authenticate a five-gigabyte logical object without allocating media bytes. Both runtimes accept sequential 256 KiB frames, verify the canonical range digest, cross the physical durability barrier, and only then register SQLite proof. Freed Desktop publishes into a private descriptor-bound content-addressed vault. The PWA publishes into worker-owned OPFS. Both reconcile physical files against SQLite in bounded startup pages, serve proof-checked playback windows capped at 256 KiB, and promote complete or pinned availability only after streaming the full-content digest. Aggregate availability has no synthetic whole-object key. Exclusion cancels local staging and purges verified ranges in bounded pages. Eviction refuses pinned renditions until an explicit unpin. Device-local policy and availability remain excluded from normalized checkpoints and Library authority                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Prove transport scheduling, cache-pressure garbage collection, and physical device lifecycle behavior                                          |
| Direct migration and cutover   | In progress                               | The native bounded decomposer maps historical FeedItem rows and the RSS, Person, Account, reach-out, follow-role, and synchronized preference fields into final normalized tables. Large legal content becomes verified content-addressed chunks. The shared generated preference disposition policy excludes device-local and compatibility-only state before typed nodes are written. An inert candidate binds one old SQLite read snapshot, its active authority tuple and ordered causal-frontier digest, explicit live and excluded deleted-row counts, complete normalized root counts, foreign-key closure, and a normalized product digest streamed through bounded checkpoint pages. The accepted authority key signs the next normalized storage epoch over the complete candidate and final contract identities. Installation rechecks every source fence and candidate digest, then commits the signed epoch, carried causal baseline, Primary writer admission, metadata, and generation atomically inside the target. A fresh actor and authority-signed version 2 Primary enrollment observes that carried frontier and installs exactly the generated Primary mutation capability in one transaction. Desktop publishes one private descriptor-bound selector that permanently chooses normalized SQLite for the Library and immediately fences every historical database, journal, store, backup, restore, clear, and mutation opening path. SQLite alone owns later epoch, certificate, writer, and generation changes. Selector publication uses a flushed private pending file, atomic fixed-name rename, directory flush, exact readback, and idempotent same-byte replay. Derived Friend projections are excluded only when canonical Person and Account sources exist. No source shell, whole-item row, or source-shell digest is retained                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Invoke selector publication under the host writer barrier, publish the exact cutover receipt, and prove crash-safe SQLite-only selection       |
| Runtime deletion               | In progress                               | The PWA Automerge runtime, retired IndexedDB Library read model, renderer MiniSearch index, SearchJump rollback key, SearchJump corpus lease, SearchJump generic item scan, renderer-derived SearchJump facets, selected-item fallback, provider-settings rollback key, legacy renderer-item acquisition capability, native Library shell read command, native Library shell replacement command, historical status command, JSON-scanning historical facet command, historical count command, whole-item upsert command, whole-item point-read command, generic payload-JSON offset-query command, generic item mutation command, and copied SQLite backup subsystem are deleted from native and browser-harness boundaries. Primary scheduling reads its local revision from the selected normalized checkpoint identity, and generated bounded SQLite queries own product facets. Normalized snapshot archives are the sole local recovery format. Factory reset persists a crash-resume marker before fencing authority, clears normalized and historical SQLite files, content ranges, and snapshots through held descriptors, and permanently retires historical import before startup can reopen the Library. Like and seen provider delivery acknowledgements are Primary-only signed normalized operations. Search, Feed, Map, Story Wall, facets, signal counts, Saved analytics, Friends timelines, the Friend editor, provider settings, and the Desktop browser harness fail closed on bounded typed SQLite readers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Move Primary follower admission and result publication onto normalized v2 records, then remove the historical journal boundary |
| Acceptance and release handoff | Not started                               | Test and evidence requirements are documented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Exact-head native, browser, iPhone, installed Desktop, performance, crash, and response-loss evidence is complete                              |

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

The generated actor-capability policy is now independent of the historical
journal namespace. Normalized enrollment, checkpoint import, migration,
mutation admission, writer reassignment, and both native verifiers consume the
same crate-level policy directly. Normalized authority, causal-tip, actor,
enrollment, operation, and transaction identities are now versioned native
protocol types outside the historical journal as well. The historical source
runtime consumes these sealed types but no longer defines them. Shared native
authority and migration failures now use one `LibraryCoreError` model outside
the journal, and normalized SQLite reports them as protocol failures. The
native crate no longer exports the historical journal, follower outboxes,
overlays, anchors, results, or status to any host. Canonical operation
verification and its closed protocol limits now live in normalized crate-level
modules consumed directly by Primary mutation and follower admission. The
historical journal retains only private materialization and test fixtures.
Canonical enrollment verification now lives beside operation verification and
is consumed directly by actor enrollment, follower enrollment, and the private
commit path. Shared scalar admission predicates are normalized protocol
primitives too. The remaining private historical journal and materializer are
now the next deletion seam.

The native crate no longer exports the historical store, import status,
checkpoint reference, shell importer, whole-item staging, activation receipt,
or overlay replay API. That uncalled compatibility importer and its six
self-tests are deleted. The remaining 224-line private
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
Google Drive request behavior unchanged. The Desktop follower journal module,
its five native commands, renderer DTOs, openers, and mocks are deleted. The
next runtime-deletion proof is removal of the remaining historical journal
implementation and its Automerge-era materialization vocabulary.

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
