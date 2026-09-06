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

Canonical operation replication uses protocol v2. A native export descriptor
binds one exact Library, active authority epoch, Primary writer, source
revision, transaction count, and operation count. At each committed source
revision the stream emits the authority-signed Accepted result first, then the
actor-signed operation members named by that result in exact member order. A
keyset cursor binds source revision, record kind, member index, and the stored
semantic result or envelope digest. Every read recomputes the snapshot and
rejects an unsigned transaction gap, changed authority, changed cursor, changed
canonical bytes, or a record above 131,072 bytes. One page contains at most 128
records and 1,048,576 canonical bytes, and the complete serialized native
response is independently capped at 1,048,576 bytes. Pages may split a
transaction. A follower stages them durably and applies nothing until the
authority result, exact operation identity set, complete transaction, actor
chain, signatures, and exact next source revision all verify.

Browser staging is device-local SQLite state. One accepted-result row fixes the
source revision, transaction digest, active authority epoch, Primary writer,
snapshot frontier, member count, canonical result bytes, and first receive
time. Member rows are keyed by source revision and contiguous member index.
Exact replay returns the existing proof. Reused identities with changed bytes,
digests, authority, snapshot, or membership fail closed. A future revision may
be staged, but it cannot skip the current revision.

Once the exact next revision is complete, browser SQLite independently verifies
the Primary signature, actor signature on every member, transaction digest,
actor chain predecessor, causal tips, operation and receipt identity arrays,
and registered mutation program. It then writes the immutable transaction,
operations, causal tips, typed projections, receipts, invalidations, actor tip,
source revision, and applied-result proof in one immediate transaction. A
follower never writes a Primary replication outbox. A fault at the final proof
write rolls back every product row and revision while retaining the complete
staged transaction for exact retry. Checkpoint replacement deletes these
device-local staging and applied proofs before installing the new normalized
frontier.

An accepted result for this follower first settles only the immutable result
chain, intent state, and result transport receipt. It does not materialize a
projection or advance the source revision. Browser SQLite then supplies the
locally stored actor-signed members to the same version 2 operation importer.
That importer is the sole canonical browser materializer for both this
follower's accepted edits and operations created by other actors. If result
settlement commits but operation application fails, the optimistic overlay
remains visible and an exact result-segment retry resumes the staged operation.
The overlay is removed only inside the successful operation transaction, or
when an exact already-applied operation proof is present.

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

The recurring Primary scheduler is transport and credential neutral as well.
It accepts only an authority assertion, one durable revision view, a clock, a
scheduler, bounded diagnostics, and a publication callback. The callback
receives the closed reason `initial`, `local_revision`, or `inbound_refresh`
plus an abort signal. Freed Desktop and the headless service resolve their own
transport credentials inside that host callback. The shared scheduler never
receives an access token, a Google Drive fetch function, or a provider adapter.
Both hosts use the same 15-second local revision poll and 60-second inbound
actor refresh contract.

The headless host binds this scheduler to the generated native command client.
Before its first publication it reads the retained Primary actor identity and
the pinned normalized checkpoint descriptor from the native sidecar. The
Library ID and current checkpoint writer must match exactly. Every scheduled
pass rereads the checkpoint descriptor for the current source revision and
stops when native SQLite reports another writer. The distributable Node
service bundles this provider-neutral coordinator into its compiled artifact,
so an installed service does not depend on an unpublished workspace package.
Binding Drive OAuth and the immutable Drive transport to the publication
callback is a separate installed-host operation and does not change this core
contract.

Desktop uses the same normalized follower boundary for local coordination.
Runtime status, stable actor request creation, and certificate installation are
native calls against the selected normalized SQLite catalog. Their typed
responses carry the authority epoch and source revision directly. No renderer
translation layer or historical follower journal participates in enrollment.

Normalized intent commit stores its sparse optimistic fields in the same
transaction as the signed intent members and actor tip. The executable mutation
registry selects one closed optimistic effect transform for read, saved,
archived, and liked assignments. Generated TypeScript and Rust registries carry
the same transform identity. PWA OPFS SQLite and native SQLite derive identical
field paths, value types, values, and member timestamps from the verified signed
envelopes. Other mutation programs produce no optimistic fields. Startup
therefore does not replay an overlay or regenerate projected rows. The first
bounded query reads the already durable projection. Historical follower
context, signer, enqueue, and overlay recovery commands are not part of the
native boundary.

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

The Primary cloud coordinator accepts only normalized actor certificates and
protocol version 2 intent records. It countersigns each discovered enrollment
request through the selected normalized authority, publishes the resulting
immutable certificate, and derives the actor set from typed certificate
identities for the active Library and storage epoch. For each actor, one native
query returns the next unprocessed counter as the greater of the accepted
authority tip plus one and the greatest durable staged member plus one. This
frontier never reads a follower device's local intent outbox cursor.

Before staging any remote intent record, the coordinator locates the exact
immutable segment committed by the normalized v2 intent head. It validates the
complete committed prefix for counter continuity, overlap, active epoch, and
head agreement. Immutable objects beyond the committed head are ignored. Each
verified segment enters the bounded native staging command, where exact replay
is harmless and changed identity reuse fails closed.

Primary results leave SQLite only through the bounded native result page. The
coordinator publishes those canonical signed rows through the normalized v2
result head. On restart or response loss, it verifies the latest committed
immutable result segment and recovers the logical result digest before asking
SQLite for the next page. The mutable head stores the immutable segment digest,
while the native cursor stores the last logical result digest. Neither value is
substituted for the other. The superseded Desktop follower journal, its outbox,
and its version 1 intent and result adapters are not part of this path.

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
