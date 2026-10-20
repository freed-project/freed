# Canonical invalidations, follower optimistic overlays, and device-local change feeds

`change_feed_v1` is the canonical view-refresh subscription payload. A request
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

Freed Desktop drains this query after each accepted local transaction and
after each imported follower revision. It resolves only the FeedItem
identities present in one page through bounded point queries, then publishes
those compact results to interested views. Preferences and RSS identities
rerun their named readers. Broad identity, authority, or reset topics reopen
the affected bounded readers. A pending follower intent does not enter this
canonical feed. Its device-local optimistic state remains separate until the
Primary accepts or rejects it.

`optimistic_fields_v1` is the only visible-row overlay query. A request carries
at most 64 unique FeedItem IDs already present in the caller's visible SQLite
window. SQLite selects only the current follower actor's newest pending value
for each requested identity and one of the seven closed fields: `read_at`,
`saved`, `saved_at`, `archived`, `archived_at`, `liked`, and `liked_at`. A
response contains at most 448 sparse rows and 2 MiB. It carries both the
canonical projection revision and the device-local transition sequence.
Desktop and PWA reject foreign identities, duplicate fields, mixed source
fences, unknown value shapes, and sequence movement across a multi-batch
visible window. The shared transform merges these fields into the bounded
cards already returned by SQLite. It never returns or reconstructs a complete
FeedItem, Library shell, or renderer corpus.

`local_change_feed_v1` is the separate device-local refresh payload. Sparse
optimistic-field insertions and removals advance its monotonic sequence through
schema-owned SQLite triggers in native and browser runtimes. Each row carries
one topic and entity identity. It never advances `library_change_state`, enters
a checkpoint or operation segment, or crosses Drive. One page contains at most
512 identities and pins one local upper sequence with the same cursor codec as
the canonical feed. SQLite retains the newest 4,096 local invalidations. When a
reader starts behind that retained window, the first returned identity carries
`resetRequired` so the reader discards its device-local overlay window and
reopens bounded overlay queries. Full checkpoint replacement clears the local
sequence only after proving that no unresolved intent or optimistic field
exists.

Freed Desktop and the PWA initialize one local sequence from
`optimistic_fields_v1`, drain `local_change_feed_v1` after local intent writes
and follower result imports, and reopen only affected bounded readers. A local
intent may advance visible-window counters, but it cannot change the canonical
projection revision used for checkpoint, query, or sync identity.

`recovery_intent_page_v1` enumerates a selected device-local recovery archive.
Its closed request names the recovery ID, reader and cancellation IDs, optional
cursor, schema version 1 and a limit from 1 to 64. The generated row model
contains only the transaction ID and archive row ordinal. It carries no signed
envelopes, optimistic fields or inferred outcomes. The response is bounded to
128 KiB, including JSON escaping of legal identities.

SQLite seeks the archive row primary key by recovery ID, fixed transaction
table key and ordinal, fetching at most 65 rows without a temporary sort. The
shared feed cursor codec binds the query version, recovery ID, archive digest,
selected generation, canonical revision and last ordinal. A changed binding
returns `CURSOR_STALE`. No cross-page read transaction remains open; callers
restart after a generation or canonical revision change. The native host executes each page off the main thread with one bounded
indexed read. Reader and cancellation IDs are validated. The native query
dispatcher enforces the reader budget and cancellation mechanism described below.
The immutable archive
identities need no per-edit invalidation;
checkpoint or Library replacement invalidates the reader.

Native recovery readers admit physical catalogs 2, 5 and 6. Catalog 6 viewers
retain the same bounded queries and proof checks; archive discovery and intent
paging recheck the viewer policy in their read snapshot. Browsing an archive
does not grant permission to reapply an edit. Browser physical schema 2 recovery
query behavior is described below. An archive row is an inspection locator, not
proof that an edit was accepted or rejected.

`recovery_intent_review_v1` inspects one archived transaction. Its closed request
adds a transaction ID and limits the result to 16 consecutive members. Native
verification hydrates at most 1,000 original envelopes and 4 MiB, verifies every
signature and the archived identity, then checks canonical acceptance receipts
and any retained authority-signed result in the same SQLite read snapshot.
Every page re-verifies this bounded transaction. The response never includes
private keys or original envelopes and stays below 512 KiB.

Its cursor also binds the signed transaction digest and member index. The
response distinguishes canonical acceptance, an original authority's historical
rejection and an unresolved outcome. None of these read operations submits an
intent. A stale-epoch rejection from a successor does not establish the old
outcome. Missing or contradictory proof cannot become an accepted result.

The generated row descriptor covers both SQLite rows and verified member
projections through one native scalar validator. Only the SQLite adapter may
coerce integer booleans, and it checks text bounds before allocating a copy.
Review rows contain operation identity, assignment fields and timestamps, plus
bounded current FeedItem context when present. A registered point query reads
at most 128 author characters and 256 content or link-title characters for each
visible member. That context is current Library content, not an assertion about
what the item contained when the archived edit was created.

Freed Desktop keeps one identity page and one review page in the renderer.
Closing or replacing the review discards late results. Source changes invalidate
continuation and clear the old outcome display. Browser archive persistence and query execution are specified below.

Desktop registered queries have a 30-second monotonic budget beginning at
native registration, including queue time. At most 64 queued or running readers
hold tickets. The existing worker semaphore still limits active work. Capacity,
cancellation and deadline failures return `QUERY_CAPACITY`, `QUERY_CANCELLED`
and `QUERY_DEADLINE`; no late successful response survives a stopped reader.

A Tauri channel acknowledges the native cancellation ticket before the renderer
can send its cancellation command. An AbortSignal retains an earlier close
until acknowledgment arrives. Native tickets disappear when their owner ends;
unknown tickets cannot pre-cancel future reads. Closing, replacing or unmounting
archive review aborts its active reader. Late results are still discarded.

Each registered read owns its SQLite connection and enables SQLite query-only
mode. A progress callback checks the budget every 1,000 VM instructions;
archive operation parsing and signature verification also check between members.
SQLite busy waits are limited to 250 ms on this dedicated reader. Cancellation
is cooperative: an operating-system database open cannot be forcibly stopped,
and its completion is checked before query dispatch. The connection and its
snapshot are dropped on success, error or panic. The blocking worker retains
its concurrency permit even if the IPC future disappears. Transfer and mutation
jobs do not install this reader scope and cannot inherit its cancellation.

Recovery review uses the local optimistic sequence as `transitionSequence`.
Its cursor binds that sequence as well as the canonical revision and generation,
so a new offline edit invalidates continued review. The explicit reapplication
request pins all three values. The Desktop view retains only a member count and
eligibility summary across pages, and offers the action after every member has
been reviewed. Closing a reader cannot cancel a replacement already submitted
to the durable mutation boundary.

Each verified review response also returns the existing durable replacement
receipt, or null. The indexed lookup binds the receipt to the exact archive,
original transaction digest and member count. It neither signs nor submits an
edit. Native conflicts fail closed, and the shared closed receipt parser serves
both review and mutation acknowledgments. Reopening review shows the stored
replacement immediately; the receipt does not establish Primary acceptance.

### Recovery archive discovery

`recovery_archive_page_v1` discovers retained native and browser recovery archives. It uses
ascending binary `recovery_id` primary-key keyset pagination, at most 64 rows
plus one lookahead, and a 131,072-byte response bound. Its closed rows contain
archive identity, predecessor and successor epoch IDs, pending and published
intent counts, and creation time. These are discovery metadata, not acceptance
proof or reapplication permission. Transaction review still verifies original
signatures and outcome evidence.

The shared cursor codec binds the query, current handoff ID, last recovery ID,
Library generation and canonical revision. Every new archive atomically changes
the lifecycle handoff identity; a continuation from the previous handoff returns
`CURSOR_STALE`. Receipt updates do not change the immutable discovery fields.
Native readers inherit the bounded queue, cancellation and deadline contract.
The Desktop view holds one archive page and discards it when selecting an
archive. Closing, changing recovery or replacing a read aborts pending work.
Browser physical schema 2 executes the same generated query inside one read
transaction. It validates the lookahead row, lifecycle/source cursor binding and
closed response limits. Settings holds one eight-row page and discards late results
on close or unmount. Browser worker deadlines bound pending reads; closing the list
does not interrupt an already executing SQLite statement. Physical schema 1 refuses
archive discovery. This metadata query does not itself verify a transaction or permit reapplication.

Recovery review request validation treats the canonical revision and local
optimistic sequence as independent counters. A valid continuation may carry
different values. Both must still match the response snapshot exactly; a local
edit invalidates an older continuation even when the canonical revision stays
unchanged. Shared contract and headless workflow coverage exercise this case.

### Original editor payloads

Recovery review accepts optional `includeOriginal: true`. After verifying the
archived transaction, native returns each member's exact canonical signed
envelope in `originalEnvelopeJson`, preserving its payload and blob references.
Summary mode returns null. The cursor binds this mode as well as the archive,
transaction and canonical/local source; modes cannot share continuations.

Editor pages contain at most the requested 16 members and at most 512 KiB of
serialized response. Native accounts for JSON escaping before adding each whole
row, reserves 16 KiB for bounded response metadata and checks the final response.
A page stops before the next member would exceed the budget. The continuation
identifies the last emitted member. The shared parser accepts contiguous partial
editor pages, checks canonical original bytes and member/transaction identity,
and retains exact source checks. Native supplies signature verification; each
editor must still decode its payload through the existing operation schema.

Ordinary review does not opt into this data. Original-editor UI integration
remains unfinished. Reading these bytes does not submit, sign or replay edits.

Archive discovery and verified transaction review remain available from the native
transfer panel during a transfer and after promotion. The view loads one bounded
archive page only after an explicit action. Read-only mode hides assignment and
original-editor submission controls, cancels replaced reads, and preserves outcome
uncertainty. It does not infer current edit authority from a historical receipt.

Browser physical schema 2 also executes `recovery_intent_page_v1` within one read
transaction. It returns at most 64 identity rows plus one internal lookahead and
uses the shared 131,072-byte response bound. Its cursor binds the archive digest,
Library generation and canonical revision. Duplicate identities and invalid
lookahead rows fail the whole read. Settings retains eight rows, releases the
archive page on selection and discards late responses on return. This path lists
identities only; browser verified review uses the separate reader below.

### Browser verified recovery review

The serialized worker routes `recovery_intent_review_v1` through an asynchronous
reader. It owns an explicit deferred SQLite transaction across enrollment,
operation and result signature verification, then commits the read snapshot or
rolls it back on failure. It refuses a borrowed transaction. No asynchronous
callback is passed to the synchronous SQLite transaction helper.

The reader checks archive row digests and exact column layouts, limits retained
archived row encodings to 8 MiB and operation envelopes to 4 MiB and 1,000 members,
and reuses shared canonical and Ed25519 verifiers. Historical actor fallback
requires the archived completed enrollment certificate, its original authority,
public key, certificate digest and chain genesis. The original transaction's tip
is used for signature resolution only; it does not grant current write admission.

Acceptance requires every canonical receipt to match its envelope digest and one
atomic revision and timestamp. A partial receipt set or conflicting signed
rejection fails. Only a verified rejection signed by the original authority can
report historical rejection. Later-authority refusal cannot settle the old outcome.
An existing replacement receipt is read with exact archive and transaction binding;
it does not establish Primary acceptance.

Pages use the same cursor, local sequence, original-envelope mode and response
limits as native. The reader checks a monotonic 30-second budget before and after
each signature verification and before returning. This is a cooperative execution
budget, not forced interruption of Web Crypto or an already executing SQLite call.
Worker command ordering prevents another command from entering the reader's
transaction. Closing Settings discards late results; it does not cancel a durable
mutation or immediately interrupt verification. Settings holds one eight-member
page and displays current item context and explicit outcome uncertainty.
