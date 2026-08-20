# Storage Architecture Roadmap

Status: **Approved direction. The SQLite cutover is active; live acceptance remains gated.**

The normative architecture lives in
[LIBRARY-CORE-CONTRACT.md](LIBRARY-CORE-CONTRACT.md). This roadmap records why
the work exists, what evidence is real, and the safest delivery order.

## Current implementation boundary

The current cutover candidate retires the active compatibility runtime instead
of preserving a bridge. Desktop and PWA production entry points no longer load
an Automerge worker, package, WASM asset, mutable cloud document, LAN relay, or
legacy snapshot. Freed Desktop reads and writes native SQLite directly, keeps
large media outside the row store, publishes immutable Library Core objects,
and retains 24 closed SQLite backups on their originating device. Drive never
receives SQLite, WAL, SHM, or rollback-journal files. The PWA uses IndexedDB
through bounded logical pages, intents, results, and search state. Exact-head
validation, the dev release, installation, and runtime evidence remain before
this candidate becomes the verified shipped boundary. Further corpus fault injection, media
transport, retired-writer review, restore coverage, source cleanup, cursor
optimization, and bundle splitting are recorded in issues #1446 through #1453
instead of delaying the first manually testable SQLite build.

The shared Google Drive adapter obtains mutable control, intent head, and
result head revisions from the bounded strong Drive v2 JSON `etag` field. It
samples that value around one Drive v3 media read and sends the exact token only
through a Drive v2 media `PUT` with `If-Match`. A stale token returns `412` and
triggers exact current readback. Immutable discovery, creation, media reads,
multipart upload, and resumable upload remain on Drive v3. Freed Desktop and
the PWA consume the same adapter without a new request or cadence change. The
native route admits only the exact v2 file paths, methods, query fields,
headers, strong token, and bounded body. An authenticated disposable
appDataFolder probe confirmed a strong v2 JSON ETag, one successful update,
stale same-token `412`, v3 byte readback, and cleanup. Installed Primary and PWA
acceptance remains gated.

Freed Desktop now has a direct local SQLite cutover candidate at schema v12.
It imports the retained legacy Automerge library once, verifies the complete
item count and database integrity, and then uses SQLite for ordinary startup,
queries, mutations, search, export, diagnostics, sample management, and daily
backup and restore. Normal Desktop execution does not start the Automerge
worker, the legacy LAN relay, or the Automerge cloud loops, and no ordinary UI
surface may request a full renderer item corpus. The old Automerge bytes remain
only as a pre-import rollback source. Immutable Library Core checkpoint sync,
the PWA IndexedDB reader and intent client, and the editable follower are now
implemented candidates. Installed production acceptance still determines when
the cutover and follower can be declared complete.

### Native SQLite authority establishment

A fresh SQLite Library signs
`freed_library_core_native_sqlite_genesis_v1`. The certificate commits one
opaque Library ID, the authority key, `library_core_v1`, schema v12,
`op_segments_v1`, `freed_logical_checkpoint_v1`, and an exact captured SQLite
source manifest. Fresh establishment never fabricates an Automerge document or
head.

An installation that already holds the retired legacy certificate keeps those
canonical signed bytes as historical evidence. It may install exactly one
`freed_library_core_native_sqlite_protocol_transition_v1` correction. The
correction references the prior certificate digest and keeps the Library ID,
epoch, authority key lineage, actor rows, cloud writer admission, follower
anchor, Drive namespace, intents, results, and checkpoints unchanged. Exact
replay returns the stored correction after response loss or restart. A changed
correction, unrelated SQLite source lineage, missing persisted authority,
multiple active local Libraries, or unavailable authority key fails closed.
An already signed native genesis or historical correction that committed
schema v11 remains valid after the journal migrates to schema v12. Its exact
canonical certificate is preserved. Only schema v11 and v12 native
certificates verify, and the active protocol receipt reports the migrated v12
journal.

Authority bootstrap reads the accepted journal state and any persisted cloud
identity before deriving a fresh Library ID. The first local Desktop actor may
be enrolled before a cloud control tuple exists, but that bootstrap exception
grants no operation admission and cannot enroll a second actor. Canonical
operations, ordinary enrollment, and provider outbox work require a present
matching writer-admission row. No authority path reads Automerge bytes or
synchronizes SQLite, WAL, or SHM files.

Schema v12 binds each admitted actor to one explicit native operation
capability. Existing v1 Desktop and PWA actors receive a separately frozen
14-operation `legacy_editor` policy for their exact epoch. The policy cannot
grow when the canonical registry gains another operation. New scraper and
agent actors require an authority-signed v2 certificate that binds the Library,
epoch, actor identity and key, class, sorted operation set, explicit scope,
issuance identity, and retirement identity. Scrapers receive capture only by
default. Missing scope denies authority. Library-wide scope must be named
explicitly. Bounded provider or source scope is recorded but denies all
operations until a future envelope version carries a canonical scope binding.
The native journal checks this capability before admitting remote operations.
It reverifies each v2 canonical enrollment and requires exact equality between
the signed immutable fields and the capability cache. The immediate commit
transaction reloads and rechecks the capability before writing.
This slice prebinds retirement identity and enforces an already verified
retired state. The authority-signed production retirement transition remains
future work, along with verified retirement propagation in checkpoint actor
rows. The TypeScript constructor and verifier are test-only executable
conformance machinery, with no production issuance caller. The PWA remains a
v1-only enrollment importer. Headless activation must implement or promote a
consumed production API and wire both consumers before any v2 actor is
published into production sync.

Gate A is a dormant census. A1 adds the package-internal closed legacy
bootstrap record, journal, control, receipt, bounded current and historical
reserved-root scan, and state classifier. Together they make the current
synchronized schema, shared store surface, Desktop and PWA worker messages,
planned operation and query vocabulary, device-local authorities, and
bootstrap transaction boundary reviewable by the compiler. They do not
activate Library Core, change a writer, migrate data, or claim that unresolved
codecs, field algebra, query projections, retention limits, authenticated
adopter pairing, or the executable bootstrap transaction are complete.

Every planned successor remains `planned_blocked`. The combined census reports
`activationAllowed: false` until the executable contracts and one durable
legacy bootstrap transaction exist. Registry presence is not an activation
receipt.

The pure bootstrap classifier remains package-internal during step 1a. Step 1b
adds the first production caller and may then expose the contract through the
shared Library Core entry point. Step 1a does not ship an unused public API.
The storage prerequisite for step 1b uses IndexedDB schema version 2. It
preserves version 1 bytes at save revision zero, fences every save and clear
with the loaded generation and revision, and advances in-memory committed
Automerge heads only after that storage compare-and-swap succeeds. The
primitive alone does not change the active worker. A failed Automerge decode
retains the exact loaded bytes and revision for recovery. It does not re-read
storage before a clear, and it never treats allocation exhaustion or an
unknown load failure as proof of corruption.

The first dormant step 2 slice now provides the native SQLite projection
kernel. Rust and the shared TypeScript adapter are checked against one
versioned canonical SQL file. Native projection batches atomically upsert and
delete rows while advancing one projection revision, and bounded keyset cursors
fail closed if that revision changes between pages. The registered 128-row
maximum and 2 MiB serialized response ceiling are enforced at the adapter.
Feed rows select only compact card fields inside SQLite, cap media and tag
collections independently, and never return full content, preserved reader
bodies, or the unmodelled-field escape object. The package-internal
`feed_page_v1` protocol now closes the exact request, response, compact
projection, source identity, nested bounds, and opaque source-bound keyset
cursor for that existing default nonhidden, nonarchived page. Its parsers
snapshot retained values and enforce both the row and serialized-byte ceilings.
The dark base tier pins its busy timeout, 32 MiB page cache, file-backed
temporary work, and disabled mmap. The module is compiled into Freed Desktop
but has no production caller and opens no user database. Dormant Desktop and
PWA runtimes now implement the narrow default page, and the PWA can
authenticate and materialize its row generation without activating a reader.
The current renderer and future bounded adapters also share one canonical
normalized product-filter predicate. Both current workers also share one exact
recommendation-order contract that preserves priority, published-time, and
source-enumeration tie semantics. The PWA can now materialize a separate
query-specific browse generation whose authenticated identity binds the
normalized filter, one ranking clock, and the order version. It streams at most
128 projected rows at a time and lets IndexedDB enforce the exact priority,
published-time, and source-sequence order. A closed dormant request and cursor
now read that physical order with the same filter, clock, and order-version
binding. Desktop now has the parallel crash-resumable SQLite generation store:
it stores the exact source document, sorted-head digest and count, storage
revisions, and query identity, admits only 128-row and 2 MiB pages with exact
replay receipts, finalizes only an exact physical row count, and performs the
full keyset order through its checked index with a private 4 MiB page cache.
Freed Desktop now exposes that store through a dormant session-bound writer
transport. Begin, append, finalize, and cancel return exact durable progress,
so a lost response can resume from the stored next batch without guessing.
Only one generation can write at a time, and factory reset first drops that
connection before deleting the derived files. A dormant Desktop worker
materializer now authenticates the exact Automerge frontier and storage
revision, binds the normalized filter and ranking clock, validates every
closed feed-card DTO, and streams replayable pages of at most 128 rows to that
writer. Its main-thread adapter recovers exact append and finalization response
loss without retaining a corpus-sized row or ID array. The
selected-generation registry, native browse reader, renderer-cache eviction,
and product caller proof remain explicit blockers. This is progress inside
Gate B and step 4, not a claim that either gate is complete.

The Desktop derived-shadow path now also has a dormant bounded projection
probe. It pins one exact durable Automerge frontier and storage revision, emits
deterministic batches capped at 1,000 rows and 4 MiB, retains only a
250,000-entry, 16 MiB entity-ID index plus one replayable batch, and releases
the decoded Automerge document between requests. It still calls
`Automerge.load`, so it is a temporary compatibility path for building and
testing the derived SQL reader while Automerge remains authoritative. It cannot
satisfy the external-memory Gate C migration contract or authorize cutover. No
production caller consumes the responses yet. Immutable external entity
materialization and the default opaque feed cursor are now closed. The exact
recommendation order is defined, but product filter and ordering execution,
cancellation across the main-to-native boundary, renderer-cache eviction, and
product read assignment remain blocked.

The bounded migration path now verifies the immutable Automerge source through
fixed-memory external runs and atomically stages its actor, head, change,
dependency, operation, element-key, successor, and payload graph in private
SQLite. Automerge document chunks omit delete rows by design, so the stage
reconstructs each missing successor as one target-bound delete identity instead
of requiring a fictional operation row. It rejects an explicit delete row,
one delete ID attached to unequal targets, a non-Lamport successor, or an
explicit successor attached to another target. The schema enforces every
remaining graph reference, and its receipts bind one exact source identity. A
final bounded seal verifies contiguous per-actor change sequences and operation
counters across stored operations and reconstructed deletes, then streams one
canonical digest over all staged metadata, relationships, and payload bytes.
The next immutable receipt selects every visible non-increment operation whose
successors are all explicit increments. Increment rows do not become separate
values or hide the counter they adjust. Explicit non-increment updates and
omitted deletes remove their predecessors. Every concurrent visible operation
remains instead of inventing one winner. This closes migration ingestion and
the current-operation frontier. Counter arithmetic, object and sequence
reconstruction, registered entity materialization, full-corpus parity,
authenticated authority admission, and activation remain blocked.

The dormant migration chain now continues through complete FeedItem topology,
bounded JSON reconstruction, and lossless native row projection. It keeps
temporary object values in scratch SQLite and holds only one bounded document
and row in native memory. The row stage shares the native shadow-store shape,
admits only faithful strings, booleans, and JavaScript-safe integers into typed
columns, and preserves every other value through explicit absence, raw,
nested-rest, and blob-tier escapes. Its receipt binds the complete projected
row sequence to the exact reconstructed-document receipt. Rust and TypeScript
use the same recursive UTF-8 object-key order for projected JSON, and replay
reprojects every document before accepting stored rows. A bounded population
bridge now pins one verified scratch snapshot and copies those rows into the
existing crash-resumable generation in deterministic receipt-bound pages. It
resumes from the destination's durable row count after response loss and never
retains the projected corpus in Rust memory. The package-internal default feed
protocol can validate a bounded page from an immutable generation, but no
product reader calls it. Full-corpus parity, production storage admission,
active query adapters, and activation remain blocked.

Physical shadow schema version 4 now closes the native staging transaction
inside one database and adds the archived-eligible Friends timeline index.
A fresh staging file records the exact source identity, sequential batch
receipts, projected row count, revision, and completion state. Rows and
receipts roll back together, an interrupted process resumes at the exact next
batch, and bounded reads reject the database until the declared and actual row
counts both close. Version 3 generations remain immutable and cause a fresh
schema-keyed generation instead of an in-place rewrite.

The dormant native publisher now seals a complete staging database into one
immutable generation file. It checkpoints and removes WAL mode, verifies
SQLite and the exact rebuild state, syncs the bytes, performs a same-directory
durable no-replace publication, and verifies the destination read-only. Unix
uses an exclusive hard-link publication point, so a racing destination cannot
be overwritten. Selecting that file for a reader remains separate. The
production storage-root handle, generation transition, stale-reader lifetime,
rollback pointer, and cleanup policy are still blocked.

Freed Desktop now has one production-located startup bridge through that
external decoder and publisher. Before the worker loads Automerge, it pins the
exact IndexedDB generation and save revision, transfers fixed 1 MiB chunks into
a crash-resumable native spool, reconstructs the source through disk-backed
SQLite stages, and selects or replays one verified immutable derived
generation. The durable spool identity survives renderer replacement, and
failure releases live handles while preserving retry evidence and falling back
to Automerge. After both sides confirm, the bridge deletes that revision's
spool and scratch graph and retains only the selected and exact rollback
projection generations.

Gate D now serves the bidirectional all-content feed, item detail, exact
Library facets,
bounded Map and Story Wall candidates, Saved overview analytics, the four-mode
Saved feed, the Friends-only feed, Friends
activity, selected-person timelines, and Friend editor author candidates, export,
background content discovery, provider
completion accounting, RSS duplicate lookup, Google Contacts discovery, and
account discovery from authenticated selected SQLite generations. Provider
settings scan exact source-fenced 64-row SQLite pages for Facebook group
repair, Facebook and Instagram media backup, and YouTube saved-video
synchronization without retaining the `FeedItem` corpus. Media candidates are
compact-staged locally and provider work begins only after the final source
fence closes. SearchJump reads exact Library tags, archive totals, and complex scope
counts from one bounded source-fenced scan, simple scope counts from compact
aggregates, and one selected item detail. On the healthy default native path,
palette focus and search do not lease the renderer corpus. Native failure or
rollback uses the compatibility fallback. Its existing Automerge bulk mutation
takes a short-lived compatibility lease only after the user runs it; native
frozen-predicate bulk execution remains the cleanup for that action path. Header and
sidebar counts share one source-versioned native aggregate. The default Desktop
shell retains no item objects. Incremental Automerge patches carry one prior
item occurrence so exact counts stay current without rebuilding the corpus.
The Saved feed reads all four user-facing sort modes through source-fenced
128-row SQLite pages, retains at most the current and adjacent page, and
traverses the complete result without returning to compatibility at the old
512-row limit. Its versioned native order uses one pinned recommendation clock
and binary global-ID ties without retaining a corpus-sized source-order index.
The Freed Desktop compatibility fallback uses that same clock and order. The
PWA keeps its existing Saved ordering. Registry cleanup holds its write
transaction while choosing retired generations and steadily retains current
plus exact rollback. If cleanup fails after selection commits, the selection
remains authoritative, the extra retired files remain non-authoritative, and a
later selection retries cleanup.
ReaderView may pin exactly one selected compact card after its feed page is
evicted, and keeps the existing local-content and hydration path.
The non-Saved Friends-only feed, when no search is active, uses the versioned
`feed_browse_page_v2` request with `identityMode: "friends"` and Friends
predicate schema version 1. It preserves
the current Person-first Account resolution and legacy Friend-source fallback,
then pages the filtered immutable generation through the ordinary browse order
and bounds. Its materializer retains source positions for no more than the
current 64-row native scan page. Ranking-weight or identity movement replaces
the exact source-bound generation. React retains two pages plus one selected
compact card so eviction cannot dismiss ReaderView. Version 1 and its
all-content callers remain unchanged. A stale source, predicate mismatch,
unavailable reader, or explicit rollback returns to the exact Automerge
compatibility feed. The PWA remains unchanged.
Friends search, Friends plus Saved, and other unfinished consumers share one
reference-counted compatibility projection only while mounted, then evict it.
Source mismatch or reader failure returns to Automerge.
The ordinary all-content feed now traverses the complete result in both
directions through the bidirectional `feed_browse_page_v3` request. It carries
an explicit `next` or `previous` direction and returns both exclusive edge
cursors bound to the exact generation and the exact first and last rows of the
page. Backward reads mirror the forward keyset predicate through the same
unique index, so both directions share one canonical order. React keeps two
whole pages plus at most one pinned selected card, restores an evicted leading
page when the user scrolls back, and holds the visible list anchored across the
shift. The old 512-card compatibility escape hatch is retired: deep scrolling no
longer reacquires the full renderer projection. Version 1 and version 2 wire
shapes and their PWA, Friends, and Saved callers are unchanged. The device-local
`freed.libraryCore.feedBrowseReaderV1.disabled=1` switch disables the feed
reader, `freed.libraryCore.savedAnalyticsReaderV1.disabled=1` disables the
Saved aggregate, `freed.libraryCore.savedFeedReaderV1.disabled=1` disables the
Saved feed reader, `freed.libraryCore.friendsReaderV1.disabled=1` disables the
Friends workspace readers,
`freed.libraryCore.friendsFeedReaderV1.disabled=1` disables the Friends-only
feed reader,
`freed.libraryCore.feedBrowseBidirectionalReaderV1.disabled=1` returns the
ordinary all-content feed to the Automerge compatibility projection,
`freed.libraryCore.providerSettingsReaderV1.disabled=1`
restores provider settings to the compatibility projection,
`freed.libraryCore.friendEditorReaderV1.disabled=1` restores the Friend editor
compatibility lease, `freed.libraryCore.searchJumpReaderV1.disabled=1`
restores SearchJump compatibility, and
`freed.libraryCore.rendererItemEvictionV1.disabled=1`
restores the full renderer projection at startup. This does not satisfy Gate C or complete
Gate D. IndexedDB v3 now stores the legacy Automerge source as exact 1 MiB
chunks. External migration admits only the exact revision and byte length, then
reads one revision-fenced chunk per transaction. Existing v1 and v2 stores
perform one atomic versionchange split, after which migration no longer creates
a source-sized structured clone. Before native decode, the finalized source is
bound to the Desktop installation and signed with a device-held Ed25519 key.
The exact immutable local receipt is read back and verified, while macOS vault
access disables user interaction and fails closed instead of prompting. This
legacy source-admission receipt is domain-separated from the future elected
migration-candidate claim and grants no writer or cloud authority. The worker
still owns the decoded Automerge document. Windows uses its native credential
vault. Linux remains on the Automerge rollback path until it has a proven
noninteractive platform vault. The next active milestone is
conversion of the remaining compatibility surfaces and worker-corpus eviction,
followed by complete elected migration authority admission.

### Process lifetime data-root exclusion

Every native Library Core runtime now takes one operating-system-backed
exclusive lease on its canonical data root before SQLite can open. Freed
Desktop holds the lease in process-managed state until exit. A future headless
service must use the same primitive for the same root. A contender fails
closed with both process IDs when the holder PID is readable, plus the exact
data root, lock path, executable, package, version, and refusal time. Each
failure overwrites one bounded `process-last-refusal.json` file, so diagnostics
remain available when a release Windows app has no console without accumulating
one file per launch. Clean exit releases the kernel lock and truncates its
diagnostic PID. A killed process can leave stale PID text, but the kernel
releases the actual lock and the next process replaces that text after it
acquires the handle. The persistent `process.lock` file is local control state,
not cloud authority or a database transport object.

## What the evidence establishes

On the owner's 15,846-item production document, the current Automerge and
WebKit design amplifies a small serialized corpus into hundreds of MiB of
resident memory. Larger synthetic documents scale roughly linearly. Full
document hydration, full-array derivations, binary copies, search indexes, and
provider WebViews then compete inside one memory-constrained application.

The evidence supports these conclusions:

- A paged row store can answer bounded library queries without materializing
  the corpus in the renderer.
- `WebAssembly.Memory` does not shrink, so terminating an idle legacy worker is
  more reliable than hoping its peak allocation returns to the operating
  system.
- Desktop search is built from truncated text today.
- The PWA's 2,500-item hydration cap limits the final message, not the
  full-corpus work performed before it.
- Facebook and Instagram captures have been blocked by memory pressure. Lower
  library memory can allow existing scheduled attempts to complete.

The evidence does not yet establish a universal 200 MiB renderer floor,
15 millisecond cold start, multi-million-item ceiling, or a precise amount of
memory attributable to Automerge alone. Those are hypotheses until the
process-safe attribution harness and matched fixtures measure them.

## Corrections to the earlier roadmap

The previous version contained five unsafe premises:

1. **Cloud convergence already exists.** Desktop and PWA cloud paths merge
   Automerge documents. The ETag compare-and-swap prevents one manifest or blob
   replacement from blindly overwriting another. It is not the semantic merge.
2. **Automerge cannot be deleted before replacement sync exists.** Doing so
   would turn two writable clients into divergent databases.
3. **A SQL writer flip is not independently reversible.** Rollback is safe only
   from a compatibility state proven at the same frontier.
4. **A filtered UI projection is not migration input.** Hidden records,
   truncated text, absent values, relationships, and source-head identity must
   come from an immutable raw source.
5. **A Web Worker is still a WebKit process.** The corpus leaves renderer
   memory only when the worker no longer retains it.

The implementation order below is built around those corrections.

## Engine decision

Desktop uses stock SQLite through Rust.

The PWA MVP uses IndexedDB through the same strict logical Library Core adapter
and conformance suite as every future browser engine. It stores bounded record
pages, tombstones, search postings, cursors, intents, and result receipts. It
does not retain the full corpus in JavaScript memory. SQLite WASM with OPFS is a
future measured adapter, not an MVP dependency. A later engine can rebuild from
immutable cloud objects and activate only after verification. Product logic
does not fork by storage engine.

Private-corpus Automerge decoding runs only on an elected installation that
holds the current authenticated migration claim. It is resumable, uses the
external-memory decoder, stays under the fixed 384, 512, or 768 MiB tier
ceiling, and proves enough private staging capacity for source-sized runs.
Other installations bootstrap by streaming and verifying the accepted logical
checkpoint, blob roots, and operation segments. Every adapter proves public
migration vectors and its own installation-qualified, fenced device-local
source contribution. A low-memory browser does not decode the owner's full
legacy corpus merely to prove that it can run Library Core.

Turso remains rejected for this role. The measured evaluation in
[TURSO-EVALUATION.md](TURSO-EVALUATION.md) found unacceptable incremental FTS
behavior, resident memory, and silent index-maintenance failure. Adoption
depends on those probes changing, not on a version number.

## Delivery order

Each step is separately reviewable. "Dark" means code may ship but cannot own
user data yet.

| step | delivery | activation condition |
| --- | --- | --- |
| 0 | Process-safe memory attribution and matched tier fixtures | Exact build and process-generation evidence, no startup stall |
| 1a | Close the Library Core registries and legacy epoch bootstrap contract | The dormant census is complete; every synchronized field then gains executable algebra, locality, deletion, storage, operation, and query contracts; the exact digest-addressed in-document bootstrap record, bounded complete current and historical reserved-root scan, source-descended prepared journal, local control, receipt, identity codecs, digest equations, creator and TOFU read-only adopter states, conflict rules, and value-only history-rebuild fence are closed and runtime-neutral |
| 1b | Implement the dormant legacy epoch bootstrap transaction | IndexedDB v2 first preserves legacy bytes at revision zero and fences every save or clear with the exact loaded generation and save revision; repeatable Automerge persistence derives deltas from durable heads and publishes candidate bytes and heads only after compare-and-swap; one explicit local owner action prepares an exact journal; the adapter loads staged candidate bytes by digest, proves their bound heads and record occurrence, then one compare-and-swap commits the record-bearing Automerge document, creator control, receipt, retained journal, and next revision atomically; another installation pins only TOFU read-only control until authenticated authority-holder pairing exists; ordinary saves update the current control frontier atomically with their own operation provenance; exact retry does not re-prompt; startup absence requires empty current and historical reserved-root scans and never prepares authority; deleted roots and unequal records block without winner selection; any compatibility rebuild preserves recorded history or is fenced after bootstrap |
| 2 | Dormant Rust SQLite core and shared operation fixtures | Crash-safe complete transaction receipts, signature and fork rejection, and identical cross-platform materialization |
| 3 | Authenticated elected Automerge migration authority plus bounded device-local source contributions | Candidate registration is the first claim-bound mutation, and registration races state-correct candidate-absent abandonment and cleanup in one serialization domain; cloud claims use authenticated store time and expiry; local claims use null timestamps and never self-expire; every claim-bound source, candidate-registry, and cutover mutation uses a closed noncircular payload-bound grant; cloud source commits require the original runtime-owned process generation and live monotonic attempt handle; migration and rollback split corpus-sized prepared proofs from a maximum 65-fence, 2 MiB activation sidecar committed in one atomic authority bundle; rollback uses its own signed reservation and activation schema; full-field private-corpus diff, composite source identity, resumable receipts, changed-head rejection, and adapter fixture parity pass |
| 4 | Bounded Desktop query API | Stable cursors, explicit limits, cancellation, count and search parity |
| 5 | Desktop surfaces read verified SQL projection | No visible surface requires the full item array |
| 6 | Short-lived legacy compatibility engine | Automerge worker terminates after bounded work; provider WebViews do not overlap it |
| 7 | Dormant PWA Library Core adapter | Browser durability matrix, operation fixture parity, and bounded accepted-checkpoint bootstrap without private-corpus Automerge decode |
| 8 | Immutable operation-segment cloud sync | Two-device offline and CAS-conflict convergence through signed actors and one global authority pointer |
| 9 | Coordinated storage-epoch cutover | Desktop and PWA switch writer and protocol through one signed transition certificate; legacy clients are fenced into their retired namespace |
| 10 | Installed-build soak and rollback window | Tier memory, sync, provider extraction, recovery, export, and import gates pass |
| 11 | Automerge retirement | No supported writer needs it and roll-forward recovery is proven |

The first large memory win arrives at steps 5 and 6. SQL can serve bounded
reads while the authoritative legacy worker becomes short-lived. The final
architectural simplification arrives only after step 9.

Before step 5 completes, every full-corpus product and UI consumer must move
behind the bounded core: classification, content fetch, provider-action
derivation, product-facing cloud and LAN sync, search, Friends, map, counts,
startup maintenance, duplicate analysis, snapshot, backup, and export. The
registered short-lived legacy migration and replication bridges may remain
through Gate D until Gate E replaces them. Moving only React while another
WebKit product worker keeps scanning the corpus is not renderer eviction.

## Provider boundary

This program does not add provider requests, navigation, scrolling, clicking,
cookies, headers, or a faster schedule.

The first slice capable of turning a memory-rejected Facebook or Instagram
attempt into real provider contact is provider-observable. The owner approved
this exact effect for the existing Facebook and Instagram schedule in
`codex-task:019f4ce3-2ee3-76b2-bc0c-eb7f4958a7de`: "You are fully authorized to
continue this optimization in ways which will increase provider pull frequency
by fixing cases where we were previously unable to pull." The provider can see
successful contact where memory rejection previously produced none. The
lowest-profile alternative is to keep rejecting those attempts and leave that
data unsynced. The decision remains in scope only while cadence, retry policy,
requests, navigation, cookies, headers, and extraction behavior remain
unchanged. The first active slice must cite that exact decision and write and
validate its healthy Gate 1 artifact before publication. It does not need
another approval for the same behavior. Dormant storage, migration, and query
work remains provider-free. Any later change to provider cadence, retry policy,
request shape, WebView behavior, cookies, headers, or extraction code requires
its own provider-risk decision before implementation.

Provider extraction follows a two-phase memory boundary during migration:

1. capture results enter a durable local capture journal;
2. the provider WebView closes;
3. the library engine wakes and materializes the journal;
4. the library engine returns to its settled budget or terminates.

No in-memory handoff may require both the full legacy corpus and the provider
WebView to stay resident.

## Integrity work that cannot be skipped

The storage cutover must also repair these existing boundaries:

- Markdown export is a sharing format, not a complete backup.
- Import reports parsed items before all durable phases finish and is not one
  resumable transaction.
- Current snapshots write Automerge and contact state as separate files.
- Current destructive deduplication is heuristic and order-sensitive.
- Deletion lacks a durable row-level tombstone contract.
- Several current field policies still describe PWA convergence as absent,
  which is no longer factually correct.

These are part of Library Core correctness. They are not reasons to preserve
the current full-document architecture.

## Test and evidence routing

The following blocking-proof groups are illustrative. The closed universal
gate registry and proof requirements in
[LIBRARY-CORE-CONTRACT.md](LIBRARY-CORE-CONTRACT.md) are binding:

- transaction crash recovery;
- actor signature, retirement, fork detection, and deterministic repair;
- complete transaction-member delivery without partial materialization;
- future-clock quarantine and certified repair;
- migration claim races, response loss, interruption, and source change;
- exact payload-bound operation grants, grant-bound live source attempts,
  candidate registration versus absent-state abandonment, reservation and
  activation races, dead-claimant abandonment, state-correct absent cleanup,
  persistent registered-candidate cleanup, and deleted-payload closure;
- prepared migration and rollback proofs, signed rollback fences, exact
  prepared-proof binding, 65-fence and 2 MiB finalization boundaries, one
  atomic sidecar bundle, deadline release, and no corpus or genesis-closure
  work while fences are active;
- global epoch and same-epoch manifest races, compound authority-state
  compare-and-swap, prepared-transition recovery, and legacy fencing;
- cutover, rollback, authority recovery, and concurrent-restore receipts;
- recovery supersession for a consumed active or abandoned migration lifecycle;
- duplicate and response-loss replay;
- reusable native materializer ownership and a thin Freed Desktop crate
  adapter, pinned by
  [`native-materializer-binding.test.ts`](../packages/shared/src/library-core/native-materializer-binding.test.ts);
- two-device offline convergence through authenticated branch-qualified
  manifests;
- schema and database-plus-blob snapshot atomicity, including missing and
  corrupt replicated blobs;
- bidirectional Desktop and PWA encrypted backup and restore, including
  paged-inventory bootstrap, recursive media-exclusion lineage, and busy
  same-transition descendant registration;
- complete reader lookup plans and authenticated hit, missing, or error probe
  outcomes without Cache enumeration or network fallback;
- import idempotency;
- bounded query, full semantics beyond the legacy 2,500-item cap, and activated
  4 GiB startup admission.

The private corpus, 100,000-item performance, large randomized convergence
matrix, browser compatibility sweep, and six-hour memory slope remain
mandatory evidence in dedicated or nightly lanes. They do not belong in every
ordinary feature or release workflow.

## Completion

The roadmap is complete only when:

- Desktop and PWA use one replicated operation contract;
- every visible library read is bounded;
- one atomic epoch owns writes;
- delete, offline conflict, replay, response loss, migration, rollback, import,
  snapshot, and recovery have deterministic proof;
- the installed application meets the tier budgets in the Library Core
  contract;
- Facebook and Instagram can run their existing schedule without library
  memory starvation;
- Automerge and its full-document containment machinery are removed from every
  supported writer.
