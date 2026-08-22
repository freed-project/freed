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

On Freed Desktop, the normalized database is opened from a private
descriptor-bound `library-sqlite` directory under its own process lease. The
native query command accepts a flat registered `queryId` request, removes that
discriminator, deserializes the remaining fields into the exact generated
request type, and returns the exact response DTO. Unknown query IDs and extra
fields fail closed. Raw SQL never crosses the native boundary.

Native and browser responses pass through one shared TypeScript dispatcher
bound to the original typed request before reaching a client. The dispatcher
selects the registered response parser by `queryId`, checks source fences,
cursors, row and byte bounds, nested limits, and exact closed fields, and
returns the request-specific response type. A host cannot widen or reinterpret
the result shape.

The headless native boundary uses generated command protocol 1 over dedicated
inherited request and response descriptors. Each frame starts with one
four-byte unsigned big-endian payload length and cannot exceed 4 MiB. Requests
bind a 64-character lowercase hexadecimal request ID, one generated command
ID, and one exact command payload. The closed registry contains normalized
checkpoint begin, append, finalize, pinned export, registered query, and
storage-inspection commands. Startup must round-trip storage inspection and
match the generated SQLite application ID, contract version, schema version,
wire protocol version, and schema digest before the service reports running.
Unknown commands, extra fields, changed versions, malformed UTF-8, truncated
frames, oversized frames, response identity drift, and transport closure fail
closed. This command protocol never carries raw SQL, SQLite files, shell JSON,
whole-item JSON, Drive credentials, or authority private keys.

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
- synchronized preferences by registered typed node
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
fails if a profile names an undeclared mutation. The Primary writer profile
grows only as verified mutation implementations land. It currently admits 18
verified mutations through 18 generated normalized SQL programs. This now
includes `feed_item_capture_upsert`, which atomically materializes FeedItem
source fields, media, and topics into normalized tables while preserving
existing user state and refusing tombstone resurrection. Feed capture metadata
is capped at 98,304 canonical bytes. Person and Account root metadata are each
capped at 65,536 canonical bytes. These limits reserve deterministic space for
the closed operation and checkpoint wrappers below the 131,072-byte logical
record ceiling. The limits count UTF-8 bytes, not JavaScript code units. Larger
legal content uses descriptors and content-addressed chunks. The capture actor
remains limited to this one feed-capture mutation. Declaring a future mutation
does not grant it to any profile. Rust and TypeScript consume generated profile
constants, so no second capability-operation registry can drift from the
mutation catalog. All 18 generated mutation programs also share one closed TypeScript
assembly, signing-body, and final-envelope path before the native verifier and
materializer. No supported program can bypass canonical transaction bounds by
falling out of a handwritten transform union.

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

Every canonical operation transaction, whether created by a Primary or a
follower, uses the same generated ceiling of 1,000 members and 4,194,304 exact
canonical bytes. Follower page limits govern transport pagination only. They
do not define a second transaction format or a second mutation authority.

Saved and archived state form one coupled last-writer register. A winning save
sets saved and clears archived. A winning archive sets archived and clears
saved. Clearing either produces the neutral state. The register compares the
signed assignment time, then the operation ID as a deterministic tie breaker.
It stores one `saved_archive_state` clock, so concurrent operations converge
without ever materializing an item that is both saved and archived. Like state
uses the same bounded assignment rule with its own clock and clears its prior
provider receipt when a new local assignment wins. These mutations create no
provider traffic. A completed provider action records either a like or seen
delivery acknowledgement through a separate Primary-only signed operation.
Each acknowledgement carries one exact timestamp, uses its own deterministic
field clock, and materializes only the named receipt column. It cannot schedule,
retry, or otherwise initiate provider traffic.

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
- authority-signed follower result and immutable result outbox entry
- actor-scoped follower result cursor
- invalidation topics

A crash exposes either all of those effects or none. Exact retry returns the
stored receipt. Reusing an identity with changed bytes fails closed.

There is no generic patch, toggle, merge-object, execute-SQL, or shell mutation
route. Product conveniences such as toggles read an exact current value and
submit a named assignment mutation with an explicit precondition.

Freed Desktop assembles each Primary transaction from one native context read.
That context contains only the admitted Library and epoch identity, the active
Desktop actor public identity and exact chain tip, and the bounded accepted
authority frontier. The native key store signs each finalized operation body.
The native core then rechecks the complete canonical transaction, current
writer admission, actor capability, actor tip, causal frontier, and authority
key before one SQLite commit. The renderer cannot supply a key, sequence,
revision, SQL statement, or authority decision. It receives only the exact
transaction and revision receipt, its ordered compact invalidations, and the
canonical signed follower result. Exact response-loss replay returns the same
invalidation list from SQLite. React invalidates only affected visible query
windows and never reconstructs a state shell to discover what changed.

Installation-local SQLite writes use a separate generated registry. The four
v1 graph-position programs set or clear one Person or Account position. They
accept one closed bounded DTO, require the entity to exist inside the same
immediate transaction, affect at most one row, and make exact retries no-ops.
They do not require an actor capability because they cannot alter canonical
Library state. They do not advance source revision, append invalidations or
receipts, enter either outbox, or appear in checkpoints. This local registry is
not an escape hatch for product data. Any mutation that should synchronize
belongs in the signed canonical registry above.

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

The result wire record is `freed_follower_result_v1`. It binds the active
authority key, Library and epoch, follower actor, actor-scoped result sequence,
previous result digest, intent transaction ID and digest, canonical operation
and receipt identities, closed rejection reason, authoritative source
revision, exact sparse replacement projection, resolution time, body digest,
and Ed25519 signature. The canonical record is capped at 131,072 bytes. The
follower verifies the original bytes before SQLite admission. Result rows keep
those exact bytes, and an actor cursor keeps only the next result sequence and
previous digest. Reusing a transaction or result identity with changed bytes,
skipping a sequence, changing the authority, or omitting one optimistic field
fails before settlement.

The result authority epoch and intent epoch are separate mandatory fields. An
accepted, already-applied, or ordinary rejected result uses the same epoch for
both identities. An `epoch_stale` result names the older intent epoch and a
strictly newer active authority epoch. The current authority signs that closed
record. Native and PWA SQLite store both epoch IDs as typed foreign keys, and a
follower verifies the result against its current authority while matching the
intent epoch to the exact pending transaction. No overloaded epoch field or
implicit checkpoint context is allowed.

Accepted admission is produced inside the native authority transaction. The
Primary allocates the next actor-scoped result sequence, reads the exact
post-materialization replacement fields, derives the domain-separated body
digest, signs it with the active epoch authority key, stores the canonical
bytes in `library_follower_result_outbox`, and advances
`library_follower_result_cursors`. The authority key and epoch are rechecked
after `BEGIN IMMEDIATE`. A failure in any result write rolls back the operation
journal, normalized rows, actor tip, revision, receipts, replication entries,
invalidations, result bytes, and cursor together. Exact retry returns the
original canonical result without allocating a sequence or signing again.
Receipt identities are the accepted operation envelope digests, so they are
bounded, immutable, and already bound to the corresponding receipt row.

Rejection and `already_applied` production use the same closed result envelope
and outbox. The typed outbox stores the transaction digest, outcome, closed
rejection reason or original result reference, authoritative revision, exact
canonical bytes, and actor-scoped sequence. A rejected result does not require
an accepted transaction row and cannot fabricate one. Rejections allocate a
result without changing canonical product rows or revisions. `already_applied`
references the original immutable result digest. Their native admission
producer reads the original accepted transaction's typed operation and receipt
rows, derives current sparse replacement fields from normalized product rows,
and signs a new actor-sequenced result. Exact non-accepted retry returns the
stored bytes without allocating another sequence. Rejected and already-applied
production never writes a product row, operation row, actor operation tip, or
source revision.

Cryptographic verification and admission policy are separate native stages. A
well-formed transaction has its complete canonical bytes, digest chain, and
actor signatures verified even when the actor has since retired or its current
capability no longer permits the registered mutation. Under the immediate
admission transaction, the Primary reloads the actor and capability. A retired
actor produces `actor_retired`. A retired, bounded, or mutation-excluding
capability produces `capability_denied`. Both results bind the current source
revision and active authority signature, and neither creates an accepted
transaction, operation, receipt, invalidation, product write, actor operation
tip, or source revision. Exact retry returns the first signed rejection.
When a cryptographically valid intent names an older accepted epoch, the
Primary produces `epoch_stale` with the current authority epoch and key, the
original intent epoch, and the current source revision. Actor, capability, and
stale-epoch rejections carry the exact current replacement values for every
optimistic field. A missing or tombstoned target may omit replacements that no
longer have a canonical row. PWA SQLite verifies the dual epoch identity,
restores or confirms the authoritative fields, removes the optimistic overlay,
stores both epoch IDs with the exact canonical result, advances the actor result
cursor, and marks the intent rejected in one transaction.

Target admission runs after signature, transaction, writer, actor, capability,
and program verification, under the same immediate SQLite transaction used for
acceptance. A required root absent from both its typed table and the registered
tombstone namespace produces `target_missing`. A matching typed tombstone
produces `target_tombstoned`. The signed result binds the current source
revision. It commits only the immutable result row and actor result cursor.
A transaction with valid canonical bytes, chain construction, and actor
signatures that no longer extends the accepted actor tip produces
`precondition_failed` under that same transaction. It cannot become an
accepted operation or advance the product revision.

Browser intent export is one actor-bound keyset page over exact signed members
in `(actor_id, actor_counter)` order. The request carries the actor and, after
the first page, the exact prior counter, operation ID, and transaction ID. A
page returns at most 128 closed typed member records and at most 1,048,576
serialized response bytes. It measures the complete serialized page before
admitting each member, preserves the canonical envelope JSON byte for byte,
and never reconstructs or transports a whole transaction object. A legal
131,072-byte operation envelope always fits the default page. Cross-actor
cursor reuse, an identity alias, invalid UTF-8, and a response bound too small
for one member fail closed. Resolved transactions may leave counter gaps in a
pending page. The signed actor chain inside each canonical envelope remains the
admission proof. The query uses the actor-counter index with no offset, table
scan, or temporary sort.

The PWA cloud coordinator never resumes publication by scanning that history
from counter one. One closed SQLite transport context returns the enrolled
actor, Library, storage epoch, next intent counter, previous stored-segment
digest, next result sequence, and previous result-segment digest. A second
closed request reads direct from that next actor counter and returns at most 128
exact canonical envelopes and at most 1,048,576 canonical bytes. SQLite rejects
gaps, changed actors, noncanonical envelopes, and mismatched counters before the
coordinator sees a page. This keeps restart cost constant with Library age.

The coordinator is provider neutral. A transport supplies immutable enrollment
publication and certificate discovery, one normalized v2 intent-head adapter,
bounded result references, and immutable reads. The coordinator publishes at
most one intent segment per pass, records the exact header and immutable
reference in SQLite, and imports each verified result segment through one atomic
SQLite callback. If the mutable intent head committed but its response was
lost, the coordinator reads the head's immutable segment, verifies its exact
actor, epoch, counter, digest chain, and canonical bytes, then records the
missing local receipt. It refuses a remote head behind SQLite or more than one
unrecorded segment ahead. Google Drive endpoint selection, headers, retries,
paging, and cadence remain inside the Drive adapter.

The Primary admits browser intent pages through dedicated SQLite staging
tables that are excluded from checkpoints, materialized-state digests, and
replication. One page carries at most 128 records. One transaction carries at
most 1,000 members and 4,194,304 canonical member bytes. Each received member
is inserted or recognized as an exact retry under one immediate staging
transaction. Reusing a transaction, counter, operation, or member identity
with changed bytes fails closed. Incomplete transactions cannot call an
authoritative mutation program. Once every member is present, the Primary
rederives the transaction, actor, epoch, counter range, operation IDs, member
indexes, and digest from the signed canonical envelopes and compares them with
every typed transport field. Only an exact match enters the existing atomic
resolver. A crash or late authority fault leaves a complete resumable staging
transaction and no partial Library state. Acceptance or signed rejection
deletes staging after the authoritative transaction commits. Replayed records
then resolve against the immutable result outbox instead of recreating staging.

After immutable intent publication and control compare-and-swap succeed, the
follower records that fact through one closed SQLite mutation. The request
binds actor ID, transaction ID, transaction digest, and publication time. It
can move only the exact local transaction from `pending` to `published`, and
the publication time cannot predate transaction creation. An exact retry
returns the same receipt. Changed identity reuse, a missing row, or an already
resolved transaction fails without altering the intent, optimistic overlay,
actor tip, or canonical projection. The mutation does not perform cloud I/O or
interpret provider receipts.

An accepted result materializes the follower's exact stored signed members
through the generated mutation registry. The shared verifier selects each
closed member schema from the executable operation registry. A transaction
must contain one registered operation and entity family and remain within that
program's member bound. Browser SQLite then runs the same generated root,
dependent-row, field-clock, and tombstone SQL used by native Rust for FeedItem,
RSS, Person, Account, preference, reach-out, assignment, and removal programs.
Intent commit writes only sparse scalar optimistic fields. Upserts and removals
do not create shell-shaped optimistic copies or canonical rows before result
admission. Refresh preserves synchronized user state by contract. Tombstones,
oversized members, absent programs, mixed transactions, and changed signed
bytes fail closed.

An accepted result may advance canonical state only when its authoritative
source revision is exactly one greater than the browser's current revision.
That transaction materializes every member, emits one generated entity-scoped
invalidation per member, and advances materialized and change-feed revisions
together. A result that names the current revision verifies its scalar
replacement values against the existing projection. A result beyond the next
revision settles the signed result, intent state, and actor result cursor but
does not materialize rows or advance either source revision. Ordered operation
or checkpoint catchup must first supply every intervening authoritative
revision. A result therefore cannot make a sparse follower claim a revision it
has not actually applied.

Native result export is one actor-bound keyset page over
`(actor_id, result_sequence)`. The request carries the actor and, after the
first page, the exact prior sequence and digest. A page returns at most 128
closed typed rows and at most 1,048,576 serialized response bytes. It measures
the complete serialized page before admitting each row, preserves the stored
canonical result JSON byte for byte, and never splits a result record. A legal
131,072-byte result always fits the default page. Sequence gaps, digest-chain
splices, cross-actor cursor reuse, invalid UTF-8, and a response bound too small
for the next record fail closed. The query uses the actor and sequence index
with no offset, table scan, or temporary sort. A transport can convert these
records into immutable objects, but it cannot reinterpret their status,
signature, ordering, or identity.

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

Browser callers cross one closed `query` worker request. Its payload is a
discriminated union of registered request types and its return type is selected
from the same query ID. The worker validates the request before dispatch and
never accepts SQL, table names, projection fragments, or arbitrary bind lists.
Adding a named query extends this union and its generated program catalog. It
does not add another transport method. Native hosts expose the equivalent
typed dispatch through the Rust core. Browser and native cursor codecs share
exact golden byte vectors, so a registered query has one wire identity rather
than platform-specific pagination behavior.

Ordinary interactive queries return no more than 2 MiB. Reader content uses a
separate ranged API. Export, backup, and migration enumerate a pinned durable
checkpoint through bounded pages.

A cursor is opaque to the interface layer and binds the query version,
normalized filter digest, ordering keys, projection version, database
generation, and snapshot identity. A stale cursor returns `CURSOR_STALE`.

`feed_browse_page_v3` is the normalized ranked feed query. SQLite applies the
archived, hidden, platform, author, RSS feed, social-content, saved, tag, and
signal filters before paging. Its final order is rounded priority descending,
publication time descending, then binary global ID ascending. The global ID is
the stable primary-key tie-break. Historical renderer enumeration order is not
stored, checkpointed, or encoded in the V3 cursor. The reverse program mirrors
the keyset comparisons and order, then the adapter restores canonical row
order before returning the page. Both programs use the registered
`library_feed_items_browse_rank_all` expression index and may read at most 129
rows for a 128-row result. Next and previous cursors bind the database
generation and exact source revision. A filter change starts a new query
instead of reusing a cursor from another result set.

No query may scan or sort the full corpus in JavaScript. No query returns an
unbounded ID list. Corpus aggregates execute inside SQLite and return bounded
typed summaries. A view refreshes only invalidated pages and aggregates.

`saved_analytics_v2` is the normalized Saved overview aggregate. One deferred
SQLite snapshot materializes only each saved row's bounded platform, content
type, and effective saved time, then returns exact totals, latest time, seven
contiguous day buckets, 24 contiguous hour buckets, and binary-ordered label
counts. Native Rust and browser SQLite execute the same generated SQL. The
request accepts no SQL or arbitrary grouping, the result is one row under
2 MiB, and source generation or revision movement invalidates the response.
The historical Saved analytics reader and its document-head source vocabulary
are not part of this final query.

`saved_feed_page_v2` is the normalized Saved list query. Its closed sort enum
selects one of four generated SQL variants for date saved, date published,
recommendation priority, or shortest read. Each variant has matching forward
and reverse keyset programs and a dedicated expression index. The request
requires saved and visible rows, applies every remaining feed filter inside
SQLite, and reads at most 129 rows for a 128-row response. Each edge cursor
binds the normalized filter digest, sort mode, complete order key, database
generation, and source revision. Native Rust and browser SQLite share the same
program registry and exact cursor bytes. No caller can supply SQL or ask
application code to sort a Saved corpus.

Freed Desktop and the PWA invoke these queries through one shared bounded feed
adapter. Each host supplies a typed query executor. Freed Desktop calls the
native core and the PWA calls its dedicated SQLite WebAssembly worker. The
shared dispatcher validates each closed request and its exact response. The
ordinary feed, Saved feed, and signal counts retain only compact card pages and
opaque keyset cursors. They do not call a whole-Library query or reconstruct a
Library shell.

Friends uses `feed_browse_page_v3` with `identityMode = "friends"`. SQLite
resolves each row through the unique Account provider and external identity,
then requires its Person to have relationship status `friend`. The identity
mode and Friends predicate schema version are bound into every cursor digest,
so a cursor from all-content mode cannot cross into Friends mode.

One shared secondary-surface adapter executes `item_detail_v1`,
`library_facet_summary_v1`, `saved_analytics_v2`, `map_markers_v1`, and
`story_wall_candidates_v1` through the host executor. Map and Story Wall rows
use shared closed row-to-visible-card transforms. The transforms do not hydrate
reader bodies or invent a general FeedItem query.

Synchronized preferences are normalized typed SQLite nodes. The
`preferences_snapshot_v1` query returns at most 512 nodes and 2 MiB in SQLite
binary path order. Scalar rows use a `v:` path prefix. Object markers use `o:`
with a null value. Array markers use `a:` with their element count as an
integer. The remainder is SQLite's canonical JSON full-key path. Markers
preserve explicit empty objects and arrays without storing a settings object.
Object patches deep-merge. Scalar and array patches replace the named node and
all descendants in one transaction. Each stored row still contains exactly
one boolean, integer, real, text, or null value. Neither native nor browser code
reconstructs a monolithic settings object at the storage or transport boundary.

`item_detail_v1` is a metadata point query. It reuses the compact feed-card
projection and returns only typed locators that say whether each reader body is
absent, inline in SQLite, or stored as a content-addressed blob. The body bytes
are fetched through `item_reader_body_v1`. Item detail and background scans do
not return full bodies, arbitrary remainder objects, or an enlarged metadata
response.

`person_detail_v1` is the normalized point query for one visible Person
header. It returns one closed Person row, no Accounts and no FeedItems. Tags
are capped at 64 in SQLite binary order. Reach-out history is capped at the
latest 20 events in descending time order with accepted operation IDs as the
stable tie-break identity. The source-fenced response is capped at 512 KiB.
Accounts and timeline cards use their own bounded page queries, so opening one
Person never hydrates the Friends graph or a hidden Library shell.

`person_timeline_v1` pages compact feed cards for one Person directly from the
derived `library_person_feed_items` relation. FeedItem and Account mutations
maintain that relation inside the same SQLite transaction. Its primary key is
`(person_id, published_at DESC, global_id)`, so native SQLite and browser
SQLite read no more than 101 timeline rows for a 100-row response. The request
names one Person ID, not a renderer-built list of account keys. The opaque
cursor binds the Person identity digest, database generation, source revision,
publication time, and final item ID. It cannot be resumed for another Person
or another materialization. Hidden and archived items remain indexed but are
excluded by the query, which keeps visibility changes cheap and deterministic.
Freed Desktop and the PWA invoke this query through one shared adapter. The
selected view passes only the stable Person ID, limit, and opaque cursor. The
Desktop host supplies the native executor and the PWA supplies the OPFS SQLite
worker executor. Neither host enumerates account keys or consults its
historical item store.

`account_timeline_v1` provides the same bounded card and cursor contract for
one Account that is not linked to a Person. SQLite joins the Account's typed
provider and external identity to visible FeedItems. The request names only
the stable Account ID. Its opaque cursor binds that Account, the database
generation, the source revision, the publication time, and the final item ID.
Linked Accounts continue through `person_timeline_v1`, so a Person timeline
combines all linked sources while an unlinked Account never impersonates a
Person. Freed Desktop and the PWA choose between these two typed queries at the
selected-detail boundary. React never constructs provider keys or filters a
FeedItem corpus.

`account_detail_v1` is the matching normalized point query for one visible
Account. It reads one Account primary key, returns at most eight follow-roster
roles in SQLite binary order, and carries no Person, FeedItem, or graph corpus.
The source-fenced response is capped at 512 KiB. Missing Accounts return a
typed null result rather than causing a whole-library fallback.

`rss_feed_detail_v1` is the matching normalized point query for one RSS Feed.
It returns every synchronized feed field, including polling and unread policy,
folder, site and image URLs, last successful fetch time, and sample provenance,
from one primary-key lookup under a 64 KiB response ceiling. Device-local
scheduler state and HTTP cache validators are excluded. Missing feeds return a
typed null result without consulting a renderer collection or Library shell.

`person_graph_page_v1`, `account_graph_page_v1`, and
`rss_feed_page_v1` provide compact identity source pages. The RSS page is the
canonical subscription catalog for every view, including Friends graph
compilation, the sidebar, settings, command surfaces, and OPML workflows. Each
returns at most 128 rows and
2 MiB in binary primary-key order after reading at most 129 rows. The Person
projection includes the latest reach-out time but excludes tags, notes, bio,
and reach-out history. The Account projection excludes contact fields,
follow-role history, and profile metadata that graph compilation does not use.
It includes the visible activity count and latest activity time computed by
SQLite through the provider and author index. The RSS feed projection carries
every synchronized subscription field plus exact visible and unread activity
counts. Its activity and image fallback use the RSS feed item index. Friends
compilation consumes only the compact subset it needs, while catalog views
reuse the same closed row without a second query contract. These fields replace
the separate whole-graph activity aggregate. JavaScript never scans FeedItems
to assemble graph activity. When legal RSS rows approach 2 MiB, native and
browser executors shorten the page by exact serialized bytes and bind the
continuation cursor to its final row. A legal row never makes the complete
catalog unreadable.
Settings management and preview surfaces use the same page contract with a
50-row visible window. Exact duplicate checks use `rss_feed_detail_v1`.
Complete unsubscribe freezes its scope inside SQLite before mutation. OPML
export visits source-fenced pages outside React and retains only the output
artifact required for download.
The command palette performs no identity read while closed. Once opened with a
typed query, it walks source-fenced RSS Feed and Account pages and retains at
most 25 matching rows from each catalog. Account page rows include the linked
Person name through the normalized foreign-key join, so the palette never
hydrates Person, Account, or RSS Feed dictionaries to label search results.
Native and browser Account executors shorten a page by exact serialized bytes
when legal maximum-sized identity rows approach the 2 MiB response ceiling.
The constant-time facet row also owns exact RSS Feed, enabled RSS Feed, Friend
Person, and social Account counts. SQLite triggers maintain those counters in
the same transaction as each row insert, delete, or classification change.
Always-mounted navigation reads the counters only. It never subscribes to a
Person or Account dictionary to count identities in React.
Person and Account rows left-join their installation-local graph position from
`library_device_person_graph_layout` and
`library_device_account_graph_layout`. A missing local row is an explicit
unpinned position. These tables use entity foreign keys, disappear with the
local entity, and never enter checkpoint export, intent replication, or
authority digests. Graph placement therefore uses SQLite without turning
device layout into synchronized product state. Each changed local mutation
advances a separate safe-integer layout revision. Graph responses expose it,
and their opaque cursors bind it alongside canonical generation and source
revision. A position change therefore invalidates an in-progress graph scan
without pretending that canonical Library state changed.
All three use one shared opaque identity cursor bound to the final row, database
generation, and source revision. Graph workers stream these pages and release
each source page after compiling its bounded output. React never receives the
complete identity corpus. The Friends worker protocol uses an explicit begin,
one-page append, and commit sequence. The client requests the next 128-row page
only after the worker acknowledges the current page. The worker rejects mixed
source or layout fences, reordered query families, discontinuous cursors,
non-increasing identities, and a source above 100,000 semantic rows. A failed
or superseded build preserves the last admitted scene.
The shipping Friends view supplies this page executor directly from each host.
Freed Desktop invokes the native query command and the PWA invokes its OPFS
SQLite worker. The Friends product worker acknowledges one page before the
host requests the next page, compiles the resident scene off the React thread,
and returns only renderer buffers plus bounded presentation metadata.

`item_reader_body_v1` is the only interactive reader-body byte path. The
request names the item, selects content or preserved text, and supplies an
explicit byte offset and a range no larger than 256 KiB. The response is no
larger than 512 KiB and contains canonical base64 for exactly that range plus
the total content length and the inline-or-blob locator. SQLite reads one
metadata row and no more than five intersecting 65,536-byte content chunks.
Both native and browser runtimes reject an offset past the end. An offset at
the exact end returns an empty range. Views can therefore stream large bodies
without loading them into React or inventing a whole-item transport.

`background_item_page_v1` is the compact corpus traversal for maintenance and
background jobs. It orders every normalized FeedItem by binary `globalId`,
including hidden and archived records, and returns at most 64 metadata cards
after reading at most 65 rows. Its opaque cursor binds the final identity to
the exact Library generation and source revision. SQLite satisfies the order
from the FeedItem primary key. The query has no offset, no total count, and no
reader-body bytes. A job that needs content follows an explicit locator through
the ranged reader or selective content plane. Its closed row also carries the
exact hidden bit, optional RSS source identity, and optional sample-data
provenance needed by maintenance actions. Desktop and PWA call one shared
adapter for this traversal. PWA reads OPFS SQLite directly and never reconstructs
these pages from IndexedDB materializations.

`content_fetch_claim_v1` is the dedicated discovery query for article content
enrichment. SQLite selects only rows with a nonempty link URL and no preserved
body, either inline or content-addressed. It returns at most 64 closed rows
containing only `globalId`, `linkUrl`, `publishedAt`, and `capturedAt`, after
reading at most 65 rows. The source-fenced keyset cursor orders candidates by
publication time and binary identity. Freed Desktop feeds these compact rows
directly into its existing paced fetch queue. It does not reconstruct a
FeedItem, page the generic corpus, or change fetch cadence, retries, headers,
or provider behavior. A partial SQLite index contains only eligible rows and
satisfies the complete keyset order without a table scan or temporary sort.
Native Rust and browser OPFS SQLite execute the same generated SQL and shared
response contract.

`provider_media_page_v1` is the query-specific source for provider settings,
Facebook group-name repair, media backup, and saved YouTube discovery. The
request names Facebook, Instagram, or YouTube and may require saved rows.
Facebook and Instagram select their own source rows. Saved YouTube discovery
selects visible saved candidates across sources because a manually saved URL
is a `saved` item, then the shared URL parser accepts only YouTube identities.
SQLite applies those visibility and saved predicates before paging.
Each page returns at most 64 compact media cards after reading at most 65 rows.
Its cursor binds the provider, saved mode, Library generation, source revision,
and final binary `globalId`. Desktop and PWA execute the same generated SQL and
closed TypeScript contract. No generic corpus scan, rollback key, legacy lease,
reader body, or provider network behavior participates in this query.

`map_markers_v1` is the Map candidate query. It returns at most 1,000 visible,
nonarchived location rows ordered by publication time and binary item ID. Each
row contains only the author identity, compact popup text, explicit location,
time range, and item locator needed by Map. It contains no media arrays, tags,
signals, highlights, reader bodies, or unrelated user state. The generated SQL
uses the visible browse index and does not build a temporary sort. It reads one
overflow row to set `hasMore` instead of counting or scanning the candidate
corpus.

`story_wall_candidates_v1` is the Story Wall candidate query. It returns at
most 250 visible, nonarchived media rows in the same stable order. Each row
contains only its compact caption and author metadata plus at most eight media
URLs and media types. It contains no FeedItem remainder, tags, signals,
highlights, engagement state, or reader bodies. Native Rust and browser SQLite
execute the same generated program through their existing typed query
dispatches. Story Wall uses the same one-row `hasMore` rule.

`change_feed_v1` is the only view-refresh subscription payload. A request
names its last fully applied revision and receives at most 512 compact rows in
`revision, ordinal` primary-key order. Each row contains only a topic, an
optional changed identity, and `resetRequired`. The first page pins one upper
revision. Continuation cursors retain that upper bound even if later commits
arrive, so a reader completes one finite revision range before opening the
next. Every committed revision has at least one invalidation row. A missing
revision, a changed Library generation, or disagreement between materialized
and change-feed revisions fails closed unless an explicit reset row closes the
discarded range. Checkpoint activation emits one Library-wide reset
invalidation at its accepted source revision. No invalidation carries an
entity projection or reader content.

## 9. Normalized checkpoint v2

The checkpoint format is `freed_normalized_checkpoint_v2` and protocol version 2. The append-only registry begins with:

| Registry key                | Primary key                       | Purpose                                                          |
| --------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `00_checkpoint_header`      | singleton                         | Library, epoch, schema, registry, frontier, and state commitment |
| `10_feed_item`              | item ID                           | normalized feed-item row                                         |
| `11_feed_item_media`        | item ID and ordinal               | one media rendition reference                                    |
| `12_feed_item_topic`        | item ID and topic                 | one topic                                                        |
| `13_feed_item_tag`          | item ID and tag                   | one user tag                                                     |
| `14_feed_item_highlight`    | item ID and ordinal               | one bounded highlight                                            |
| `15_feed_item_signal`       | item ID                           | signal classifier metadata                                       |
| `16_feed_item_signal_score` | item ID and signal                | one signal score and tag decision                                |
| `17_feed_item_event`        | item ID                           | one event candidate                                              |
| `20_rss_feed`               | feed ID                           | normalized RSS row                                               |
| `30_person`                 | person ID                         | normalized person row                                            |
| `31_person_tag`             | person ID and tag                 | one person tag                                                   |
| `32_person_reach_out`       | person ID and stable reach-out ID | one bounded reach-out event                                      |
| `40_account`                | account ID                        | normalized account row                                           |
| `41_account_follow_role`    | account ID and role               | one provider roster role                                         |
| `50_preference`             | typed node path                   | one synchronized preference scalar or container marker           |
| `60_relationship`           | typed relationship tuple          | one normalized relationship                                      |
| `70_field_clock`            | entity and field tuple            | one accepted field clock                                         |
| `80_tombstone`              | entity tuple                      | one entity tombstone                                             |
| `90_actor_state`            | actor ID                          | enrolled actor and accepted tip                                  |
| `a0_receipt`                | receipt kind and ID               | retained authoritative receipt                                   |
| `b0_blob_descriptor`        | content digest                    | content metadata and inline-chunk or authenticated-range layout  |
| `b1_content_chunk`          | content digest and chunk index    | bounded content bytes when included                              |
| `b2_content_range`          | content digest and range index    | one authenticated byte offset, length, and range digest          |

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

Desktop begins one export by reading a closed
`freed_normalized_checkpoint_export_v2` descriptor. It binds the Library,
authority epoch, Primary writer actor, source revision, current causal frontier
digest, total registry record count, and feed-item count. Every native page
request carries that exact descriptor. Native SQLite opens a read transaction,
recomputes the descriptor, and refuses the page if any bound value changed.
The cloud publisher stores the typed records directly under dataset schema
`library_core_normalized_checkpoint_v2`. It does not wrap them in logical rows,
whole FeedItem values, or a Library shell.

Every legal value that cannot fit a logical record becomes a descriptor plus
content-addressed chunks. The initial raw chunk size is 65,536 bytes, which
leaves deterministic room for base64 and record metadata below the canonical
record ceiling.

Profile fields, contact fields, feed metadata, annotations, and preference
leaves are bounded metadata. Reader bodies, preserved article bodies, evidence,
media, and other potentially long-form values use the content plane. A metadata
mutation cannot consume the wrapper reserve or silently turn into an oversized
checkpoint row.

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

Desktop and PWA use one storage-neutral checkpoint staging state machine. Each
runtime supplies only its typed SQLite begin, append, selection, and activation
calls. Desktop follower bootstrap and writer transfer consume normalized v2
records directly. No portable checkpoint codec, Library shell extraction,
whole-item append command, or offset-based payload page exists in the runtime
surface.

The verified checkpoint digest becomes the local materialization generation
ID. Every bounded query cursor binds to that generation ID, never to the human
Library ID. The generation metadata is local and is not included in checkpoint
records, which keeps the checkpoint digest acyclic.

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

Removal mutations declare root and relationship deletes in the executable
contract. Account removal, both Person removal policies, and both RSS feed
removal policies execute those generated statements only after signature,
capability, writer admission, causal tip, target, and replay verification.
Person removal either deletes linked Accounts or preserves them and lets the
declared SQLite foreign key detach their Person reference. The winning root
and relationship effects, typed tombstone, operation rows, receipt,
replication outbox, invalidation, and source revision commit in one SQLite
transaction. A stale removal is journaled but cannot replace the winning
tombstone or repeat relationship effects.

RSS feed upsert verifies the closed signed payload, then writes only typed
normalized feed columns through its generated program. It validates the exact
sample-data fingerprint shape when present and uses the committed operation
time for the row revision. A feed tombstone is final within the storage epoch,
so a later upsert can be journaled without resurrecting the removed feed. No
feed shell or whole Library object participates.

Account upsert writes the complete synchronized Account root into typed scalar
columns, then replaces its normalized follow-role set from the same verified
payload and inside the same transaction. Foreign person references must resolve,
provider and external identity uniqueness remains enforced by SQLite, and an
Account tombstone blocks later resurrection. The contract owns both the root
statement and dependent role statements, so no runtime adapter can invent a
second materialization policy.

Person upsert writes the typed Person root and replaces its normalized tag set.
Reach-out history is not nested mutation state. Each event uses a closed
`person_reach_out_append` payload and the accepted operation ID as its stable
row identity. SQLite keeps the latest twenty events by logged time and binary
event ID, so concurrent delivery order cannot change the retained set. Person
upserts cannot replace or erase event history. A Person tombstone blocks later
root and event writes.

Authenticated manifests publish the latest checkpoint, operation heads, intent
heads, result heads, content roots, and authority tuple. Google Drive is a
transport adapter for these immutable objects. Provider endpoints, headers,
OAuth behavior, retries, and cadence are outside this contract.

## 11. Selective content plane

Canonical Library rows carry descriptors, never large inline media. A
descriptor binds content digest, rendition identity, media type, byte length,
chunk or range layout, and available sources.

An `authenticated_ranges` descriptor binds an ordered range map by its exact
range count and canonical root digest. Each `b2_content_range` record carries
one contiguous byte offset, byte length, and lowercase SHA-256 range digest.
The root digest covers the content identity, logical byte length, range count,
and every ordered range tuple. Checkpoint activation rejects gaps, overlaps,
count mismatches, changed roots, and mixed inline-chunk and range layouts before
canonical rows become visible. The verifier streams range metadata and does not
allocate the logical content length.

Each client independently selects one policy per rendition:

- metadata only
- stream on demand
- partial cache
- complete cache
- pinned offline
- excluded

Policy, transfer progress, cache location, and eviction time are device local.
Descriptor and checkpoint completeness do not require content hydration.

The executable schema stores policy, availability, and verified ranges in
separate `library_device_content_*` tables. Policy has its own monotonic local
revision and never advances Library authority, the canonical change feed, or
the replication outbox. An absent policy means `metadata_only`. An offline pin
request does not claim that bytes exist. Only the verified publication path may
create availability or range rows.

Content digest verification is incremental. Downloads write to a temporary
file or OPFS object, verify exact length and digest, cross a durability barrier,
and atomically publish the local availability row. Multi-gigabyte media never
becomes one JavaScript, Rust, renderer, or IPC allocation.

The generated contract limits one publication append to 262,144 bytes. The PWA
worker owns the OPFS access handle, accepts only sequential offsets, hashes each
bounded append, flushes and closes the object, then commits its storage key to
SQLite. The native core applies the same canonical lookup, append ceiling,
incremental digest, durability callback, and SQLite registration to a host
supplied content-vault object. Caller-supplied lengths and digests never become
authority. A failed or changed stream is discarded before availability can be
published. A crash before the SQLite commit can leave an unreachable object,
but never a false cached-range claim.

Physical range keys bind the content digest, range index, and canonical range
digest. Freed Desktop resolves the vault through one held private directory
descriptor, writes a 0600 staging file, syncs it, renames it to the canonical
key, syncs the directory, and only then registers SQLite proof. The PWA follows
the same proof order with its worker-owned OPFS handle.

Cached reads use the same proof boundary. A request names one content digest,
range index, in-range offset, and a byte ceiling no larger than 262,144 bytes.
SQLite must prove that the local row still matches the canonical range before
the vault opens its physical object. Freed Desktop opens that object relative
to its held directory descriptor and rechecks file ownership, mode, link count,
and exact length on the opened descriptor. The PWA worker reads the equivalent
bounded OPFS slice. Neither runtime returns an unbounded rendition or trusts a
renderer-supplied storage key.

Every successful cached read records device-local recency. SQLite coalesces
that write to at most once per content digest per 60,000 milliseconds. Read
recency never enters checkpoints, authority revisions, or replication.

Background hydration discovers work through
`hydration_candidates_page_v1`. The generated SQL runs unchanged in native
Rust and browser SQLite. It returns at most 128 missing authenticated ranges,
prioritizes pinned offline content before complete-cache content, and uses a
stable keyset cursor. The page binds the materialization generation, canonical
source revision, transition sequence, and device content revision. Any source
movement invalidates continuation instead of mixing generations.

Full-cache promotion streams every verified range in canonical index order
through the blob-content digest domain. The verifier retains one 262,144-byte
window, one page of at most 128 range proofs, and incremental hash state. It
requires exact range count, exact total byte length, and the canonical content
digest before one SQLite transaction records `fully_cached` or
`pinned_offline`. Exact replay does not advance the device content revision.
Changing policy after completion switches only between those two local states.
Aggregate availability stores no synthetic whole-object key. Physical
locations exist only on the verified range rows.

If full verification later observes changed bytes, the same operation revokes
any complete claim, records local `corrupt` availability, and advances the
device content revision. It never changes canonical Library authority.

Eviction is a closed device-local operation over one content digest. It pages
at most 128 physical range proofs at a time, removes each object before
removing its SQLite proof, and returns exact released byte and range counts.
`pinned_offline` fails closed. The caller must first commit an explicit policy
transition away from the pin. Setting `excluded` at the runtime storage
boundary cancels local staging for that digest and completes the same eviction
before returning. A crash between physical deletion and SQLite cleanup leaves
only a stale proof for startup reconciliation to remove.

Cache-pressure discovery uses `eviction_candidates_page_v1`, the same
generated SQL in native Rust and browser SQLite. It returns no more than 128
unpinned cached renditions in least-recently-used order. The request supplies a
recency ceiling and continuation uses the same four-part source fence as
hydration. Every cache-pressure eviction must repeat the candidate's exact
`lastAccessedAt`. A newer read makes the eviction stale before physical bytes
can be removed. Explicit exclusion and explicit user eviction remain separate
closed reasons and do not masquerade as cache pressure.

Every runtime reconciles physical objects before declaring the vault ready.
The scan keeps at most 128 SQLite proofs in memory. It deletes unfinished and
unreferenced objects, prunes proofs for missing or length-mismatched files,
recomputes aggregate availability through generated SQL, and advances exactly
one device-local content revision when state changed. Exact physical and SQLite
matches survive restart and canonical checkpoint replacement.

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

The native FeedItem decomposer uses the generated capture materializer for the
typed root, media, and topics. It separately preserves tags, highlights,
content-signal scores and tags, and event candidates. Reader bodies, highlight
text, and event evidence above 65,536 UTF-8 bytes become content-addressed blob
descriptors and chunks inside the same target transaction. Exact descriptor and
chunk replay is verified before the row can commit. No whole FeedItem JSON or
shell record enters the final database.

The shell decomposer writes RSS feeds, Persons, Accounts, Person tags,
reach-out events, Account follow roles, and typed preference leaves through the
same generated mutation programs used after activation. It inserts Persons
before Accounts and refuses a dangling Person reference. Reach-out rows use a
deterministic content-bound migration identity and retain the source order and
exact optional fields. Preference ownership lives in the executable SQLite
contract source consumed by both TypeScript and Rust. Device-local fields and
compatibility-only fields are excluded before `json_tree` creates canonical
preference nodes. The decomposer never stores or hashes the source shell.
Historical Friend objects are derived compatibility projections. They are
excluded when their canonical Person and Account sources are present, and they
block migration when those normalized sources are absent.

The native candidate builder holds one SQLite read transaction over the old
authority. Its inert receipt binds the old library ID, epoch, transition
certificate, source document digest, generation, source revision, SQLite
revision, and a bounded digest of the ordered causal frontier. It records live
FeedItem and normalized root counts plus the exact number of deleted historical
FeedItem rows excluded at the epoch boundary. The target is accepted only when
all root counts and foreign keys close. Its product digest streams canonical
normalized records across bounded export pages. It never uses the source shell
or a whole-corpus serialization as evidence, and it cannot activate or select
the target database.

The normalized storage transition certificate advances the old authority by
exactly one epoch. It must use the already accepted authority key and binds the
entire migration receipt, selected Primary writer, acceptance time, contract,
schema and protocol versions, schema SHA-256, and normalized checkpoint format.
The transition body digest names the new epoch. A separate digest identifies
the complete signed certificate. Both the epoch signature and authority-key
possession signature are verified before installation.

Candidate authority installation rechecks the old state revision, source
identity, active authority tuple, key lineage, causal-frontier digest, and live
plus excluded item counts. It rehashes the target product through bounded
checkpoint pages, then installs the signed epoch, carried causal frontier,
active Primary writer, writer admission, normalized metadata, and
materialization generation in one target transaction. Any changed source,
candidate byte, certificate byte, signature, count, or foreign key leaves the
target inert. Installation does not select the target file or retire the old
writer. Those actions belong to the later host compare-and-swap barrier.

The installed normalized epoch enrolls a fresh Primary actor from the host's
existing actor-key store. Its version 2 certificate is signed by both the actor
and accepted authority key, binds the complete carried causal frontier, and
grants exactly the generated Primary-writer mutation set under a library-wide
scope. The native verifier checks the certificate before one transaction
inserts the actor, capability, and closed mutation rows. No retired operation,
legacy editor policy, inferred mutation, or blank-frontier enrollment can enter
the normalized epoch.

Freed Desktop has one descriptor-bound local authority selector. The selector
is a private, bounded, canonical closed record under the already leased app-data
root. It permanently selects normalized SQLite for one Library. It does not
duplicate the live epoch, transition certificate, actor, or materialization
generation. Every read verifies the selected Library and one internally
consistent active authority plus generation inside SQLite. Writer transfer
advances SQLite authority without changing this one-way selector. Once valid,
all historical database, journal, store, backup, restore, clear, and mutation
opening paths fail closed for the rest of the process and after restart. A
missing selector preserves the pre-cutover state. A malformed selector or one
that does not match normalized SQLite activates neither side.

Production renderer startup accepts only a verified normalized SQLite
selection. If native startup cannot complete migration or fresh genesis, the
renderer stops before loading Library state or opening a historical mutation
path. Existing historical bytes remain untouched for diagnosis and retry. The
renderer never creates a portable shell, promotes historical storage, or
chooses a fallback authority. Browser-only test harnesses may supply an
isolated in-memory view fixture after reporting normalized authority, but that
fixture cannot create or select product storage.

The renderer asks native code for one mutation context. Native code returns a
Primary context only after this selector verifies. Before selection, the same
request can resolve only to an enrolled follower intent context or no Library
Core mutation authority. The shared TypeScript assembler is identical in both
cases. The final transport either commits the canonical envelopes through the
selected Primary or appends them to the follower intent outbox. It never writes
both and never treats a populated migration candidate as runtime authority.
After a Primary commit, Freed Desktop reads the new source revision and corpus
total through the normalized facet query. It resolves only the changed visible
item identities through exact normalized detail queries. The mutation tail
cannot reopen historical count, shell, or item storage after the selector has
retired those paths.

Selector publication writes canonical bytes to a private pending file, flushes
the file, atomically renames it to the one final selector name, and flushes the
bound directory. The final name is never overwritten with different bytes.
An exact response-loss retry succeeds only when the stored bytes match. The
selector is read back and reverified before cutover reports success.

Candidate construction commits one local transition plan in the same SQLite
transaction as the normalized product rows. The plan contains the canonical
migration receipt, a domain-separated receipt digest, and no shell or whole
item. It is excluded from checkpoint export because it is local cutover state,
not synchronized Library data. Restart resumes only from those exact bytes. A
changed, malformed, or noncanonical plan fails before authority installation.

Authority installation and local Primary actor enrollment are exact replay
operations. After response loss, authority recovery verifies the full signed
epoch tuple, active writer, admission row, Library metadata, materialization
generation, and complete frontier. Actor recovery reconstructs the expected
certificate from the stored keys and transition identity, then verifies the
complete actor row, capability certificate, and every generated mutation
grant. Merely finding existing rows never counts as success. Missing, extra,
or changed rows fail closed.

A fresh Freed Desktop installation starts directly in normalized SQLite. The
renderer first asks whether a normalized selector already exists. Only when it
does not exist does it inspect the retired IndexedDB metadata for historical
Library presence. Native startup then also proves that every historical
Library table except its schema metadata is empty. The reusable Rust core
derives one stable Library identity, creates or reads back the authority key,
signs `freed_normalized_fresh_genesis_certificate_v1`, installs the empty
normalized authority and Primary actor, and publishes the selector in the same
app launch. It never creates an empty shell, historical authority, or migration
candidate. Exact retry reconstructs and verifies the stored certificate and
actor. A different installation witness, changed key, changed product digest,
partial authority, or any historical row fails closed.

The native Desktop cutover preparation operation owns the stage sequence. It
creates the candidate only when none exists, binds the installation witness and
first acceptance time once, installs the signed authority, enrolls the local
Primary actor, and returns one selector-ready receipt. Its local plan advances
monotonically from `candidate` through `authority_installed` to
`actor_installed`. A restart with the same installation witness returns the
same receipt. A different witness, changed source fence, changed certificate,
or changed installed row fails before selector publication.

After selector publication, renderer bootstrap performs two bounded queries:
the maintained Library facet summary and the normalized preference snapshot.
It does not read a shell or hydrate FeedItem, Feed, Person, or Account maps.
Those collections enter React only through the bounded query window owned by
the view that requested them. Browser-only UI fixtures may retain a synthetic
projection, but that fixture is not a production storage or transport path.

An active Feed or provider-author filter resolves through
`filter_scope_summary_v1`. The request contains exactly one Feed URL or one
provider plus external author ID. SQLite returns one nullable display label and
one exact visible-item count under a 16 KiB response ceiling. Feed URL,
provider-author, and item predicates use their normalized indexes. Header does
not subscribe to Feed, Account, per-Feed count, per-platform count, or total
item dictionaries. Platform and Library totals come from the maintained facet
row. React retains only the one active scope result.

Exact item lookups use `item_detail_v1`. Background enumeration uses
`background_item_page_v1` with an opaque source-fenced cursor and a 64-row
window. Mutation target discovery applies its product predicate while each
page is visible and never invokes the historical offset reader. Workflows that
still collect a complete identity or URL set must move to durable scope staging
or a narrower aggregate before the final memory gate. The same page contract
serves capture maintenance, import identity checks, and saved-media discovery
until those narrower contracts take ownership.

Partial Person, Account, and RSS Feed edits never assume that React holds the
entity. They read one exact `person_detail_v1`, `account_detail_v1`, or
`rss_feed_detail_v1` row, merge the requested fields into that closed record,
and submit a complete typed mutation. The current visible renderer object may
avoid that query, but it is a cache of the same bounded detail contract, not
durable authority. Batched RSS refreshes resolve each missing feed through the
same exact query before applying refreshed fields, so a sparse renderer cannot
erase polling policy, unread behavior, folder, URLs, or sample provenance.

Complete RSS Feed maintenance never derives its target set from React. The
native boundary freezes the matching `library_rss_feeds` primary keys inside
one immediate SQLite transaction. Removal stages every feed. Title repair
stages only feeds whose title is `Untitled Feed` or still equals the feed URL.
The installation-local stage records typed `entity_id` values, pages at most
1,000 identities at a time, and is excluded from checkpoints and replication.
Each page becomes bounded canonical transactions, with no complete URL array
in renderer memory. Retrying an ambiguous freeze response must repeat the same
stage ID, action, request digest, and creation time. Any changed replay fails
closed.

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
