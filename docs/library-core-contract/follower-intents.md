## 7. Follower intents and Primary results

The PWA may recover a pending local enrollment from an unused actor already
admitted in its verified checkpoint. Exact request replay triggers this bounded
SQLite recovery. It verifies the stored canonical certificate against the current
Library, epoch and authority key using the certificate's signed historical
frontier, then rechecks its exact bytes against the active actor and capability
rows inside the write transaction. The actor must have the retained request's
key, a zero accepted counter, an unchanged genesis, a full editor capability,
and no retirement or local intent history. Recovery stores the admitted
certificate and local intent genesis atomically without changing any canonical
actor row. The original pending request bytes and digest remain preserved even
when they differ from the recovered certificate. Unknown history, conflicting
grants, changed authority and invalid signatures fail before any recovery write.

The local follower commit request also accepts the optional source admission
metadata defined in [the mutation contract](mutations.md). It survives worker
transport and an exact response-loss retry unchanged. It is checked after
retry recognition in the same write transaction as intent admission, and is
not serialized into canonical members or provider transport. Canonical source
revision currently does not distinguish pending local annotation versions;
the guard alone does not establish safe repeated offline editing.

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

Replacement identities come from the registered operations in the durable intent,
not from the sparse optimistic preview. Saved and archive assignments return the
complete coupled saved/archive register, including when clearing either state.
The follower requires the exact deduplicated operation projection and rejects
missing, duplicate, or unrelated replacement identities before settlement.

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
The overlay is removed inside the successful operation transaction, when an
exact already-applied operation proof is present, or during same-epoch checkpoint
activation when a previously verified result is covered by the canonical revision.
The PWA's local intent `resolved_at` records settlement on the consumer clock,
using the greater of its first receive time and local enqueue time. The latter
preserves the local lifecycle constraint after a clock adjustment. The Primary's
`resolved_at_ms` remains unchanged in the verified canonical result. It is not
compared with the consumer's unsigned local enqueue time to admit settlement.
This does not change the signed operation/result timeline checked by canonical
replication, authority verification, or exact result-sequence admission.

Resuming a locally settled result uses its stored first receive time, not the
retry's wall clock. Direct and transport-based retries therefore retain the
same staging identity after an interrupted materialization.

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

Enrollment verification uses the request's exact known causal snapshot, not
an equality check against the Primary's latest actor tips. Every requested tip
must match an accepted operation, actor tip, or immutable authority frontier in
the active epoch. The snapshot must include or advance every immutable authority
frontier anchor. New local writes therefore do not invalidate a retained signed
request. Unknown tips, missing authority anchors, changed epochs, and invalid
signatures still fail closed. Native verification and enrollment persistence
share one immediate SQLite transaction.

The Primary cloud coordinator accepts only normalized actor certificates and
protocol version 2 intent records. It countersigns each discovered enrollment
request through the selected normalized authority, publishes the resulting
immutable certificate, and derives the actor set from typed certificate
identities for the active Library and storage epoch. For each actor, one native
query returns the earliest member of a complete unresolved staged transaction
when one exists. Otherwise it returns the greater of the accepted authority tip
plus one and the greatest durable staged member plus one. This distinction keeps
late authority failures retryable without starving incomplete transactions of
their remaining pages. Resolved staging cleanup remnants do not rewind the
cursor. This frontier never reads a follower device's local intent outbox cursor.

A retry counter may fall inside a committed immutable segment. Transport returns
that complete segment and its exact first counter and predecessor. The coordinator
verifies its bytes, digest and chain, requires the segment to contain the pending
counter, then replays its members through native exact-retry admission. A segment
entirely behind the pending counter cannot authorize progress.

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

### Consumer checkpoint continuity

Native and browser consumers retain device-local enrollment, signed intent
members and counters, result cursors, transport receipts, optimistic fields and
local invalidation history during same-Library, same-epoch checkpoint activation.
Disk-backed scratch tables share the activation transaction and bounded SQLite
pager. No renderer-sized snapshot of pending work is created.

Retention requires an existing verified consumer receipt, a nonregressing source
revision and checkpoint generation, and the same writer. The authority key and
canonical transition certificate must remain identical. The retained actor tip
cannot regress or change at the same counter. An advanced canonical actor tip
must match a retained signed intent, and the next local counter must stay ahead
of that accepted tip. Other actors' unresolved work prevents replacement.

Cross-Library or cross-epoch replacement of an enrolled consumer requires explicit
recovery and preserves its existing work. A failed import, foreign-key check,
authority check, actor-chain check or final receipt write rolls back both canonical
and local changes. Checkpoint activation settles only overlays whose already
verified accepted result is covered by the new canonical revision. It does not
invent results, reset request identities, or re-sign unresolved edits.

### Explicit recovery assignments

Freed Desktop can reapply a verified archived read, saved, archive or liked
assignment transaction after explicit review. Every original member remains
preserved. Unsupported members require their original editors; the transaction
is never split or silently filtered. Confirmed canonical acceptance refuses
reapplication. Historical rejection and unresolved outcomes do not prove that
an old edit failed.

The closed native request pins the recovery, archive digest, original
transaction digest, member count, reviewed generation, canonical revision and
local optimistic sequence. Before creating a replacement, native SQLite
rechecks those identities, current successor enrollment, target presence and
key possession under one immediate transaction. A changed review source
requires another review. Fresh assignments carry new identities and the native
clock time, using the existing canonical operation protocol. Shared vectors
compare complete signed envelope bytes between Rust and TypeScript.

One installation-local link per archived transaction commits atomically with
the replacement intent, members, optimistic fields and actor tip. This table is
part of unreleased native physical schema 2 and excluded from checkpoints.
A retry returns that durable replacement identity before accessing signing keys
or allocating counters, even after the canonical revision changes. It never
re-signs an old envelope. A local receipt confirms storage for sync, not Primary
acceptance. Browser persistence remains unfinished.

### Repeated native consumer recovery

After selecting a later verified direct-successor checkpoint, a completed
consumer lifecycle may advance to another recovery archive. Its committed
reenrollment receipt must match the retained actor request exactly. Native
archival verifies the predecessor-signed successor certificate, original key
possession and previous archive contents before replacing the lifecycle record.
The new archive and lifecycle record commit atomically. Source, target and
unfinished consumer lifecycles cannot use this transition.

Earlier archive bytes and replacement links remain installation-local and
survive the transition. A failed archive write restores the previous lifecycle
and pending edits. Reenrollment remains explicit and restartable. Bounded archive discovery makes retained transactions available for review.

Explicit assignment recovery may select an older archive after multiple
transfers. Native admission uses the current completed consumer recovery and
its enrolled actor, while verification remains pinned to the selected original
archive and signed transaction. The original receipt need not belong to the
current epoch. A demoted source may instead use its completed demotion and
selected successor checkpoint, with closed writer admission and an active actor
enrolled in that successor epoch. An active Primary or unfinished transfer cannot
use this path. Both lifecycles keep the same archive verification, source checks
and atomic intent/link commit; an existing link returns before admission checks.

An existing replacement link remains final for its original transaction.
Retries return that exact receipt even if the replacement was later archived.
The owner may review that archived replacement and explicitly apply it again;
that action creates a separate atomic link for the replacement transaction.
Neither review nor retry automatically follows or re-signs a replacement chain.
The Desktop receipt displays the replacement epoch to locate its later archive.

### Explicit recovery on the active Primary

Desktop may explicitly reapply a verified archived transaction after promotion.
The Primary route rechecks native writer admission, the current epoch and actor,
and established authority-key custody inside one immediate SQLite transaction.
It uses canonical operation resolution and commits the replacement with the
installation-local archive link. A failed link write rolls back materialization,
receipts, outboxes and actor counters. Rejected resolution does not leave an
unlinked replacement behind.

Promotion may retain the actor ID; the replacement must belong to a different
epoch from the original. The existing Consumer route still requires successor
enrollment. Selecting Primary never falls back to Consumer after an admission
failure. Both routes verify the original signed transaction, refuse confirmed
acceptance, pin the reviewed state, and preserve every ordered member. Existing
links return before key loading or fresh admission, including after restart.
The link receipt identifies a durable replacement; it is not portable proof of
Primary acceptance. Ordinary builds retain the transfer capability hold.

### Edited recovery transactions

The native editor recovery submission path accepts at most 1,000 canonical
signed envelopes, each at most 131,072 bytes and together at most 4 MiB. It uses
the same explicitly selected Primary or Consumer admission, review-source check
and atomic replacement link as assignment recovery. The existing operation verifier validates the
editor's signed output. The complete ordered operation types, entity types and
target IDs must match the verified original transaction. An editor may change
payload values after explicit review; it cannot drop or redirect members.

A transaction already stored without this recovery link cannot be retroactively
attached. A prior link returns its original receipt without preparing or signing
anything. Consumer intent rows, optimistic fields, counters and the recovery link
commit together or roll back together. Primary canonical acceptance and its link
use the same atomic boundary. This native path does not sign replacement
operation envelopes, open editors or enable automatic replay. Editor callers must retain finalized
bytes through retries and check the stored receipt on reopen before signing.

Saved notes occupy a reserved highlight inside a complete annotation replacement, so recovery must not silently
discard other highlights or tags. The existing Saved Content dialog also starts
URL previews; the recovery editor path must remain offline until an explicitly
authorized action requires network access.

Freed Desktop's RSS feed-name recovery editor loads the complete original
transaction through bounded verified pages. It accepts only RSS title assignment
members with no blob references, preserves member order and target URLs, and
refuses a missing feed or a changed review source. It shows canonical names as
"Last synced" because this query does not include queued title overlays. The
owner is warned that a replacement may override newer or queued names.

The editor uses the ordinary RSS member factory and canonical signer without
ordinary enqueue. All fields must be viewed before explicit submission. Once
signed, fields remain locked and retries retain the same finalized envelopes.
Native atomic linkage remains the duplicate-prevention boundary, including a
reopened editor or a lost response. Opening the editor performs no URL fetches.
Other original-editor families remain unfinished.

The annotation recovery editor preserves normalized highlights, including the
reserved item-note highlight and blob-backed text locators. It does not pass
these values through the selected-item adapter that requires hydrated text.
Stored quote text remains a visible, unhydrated reference; editing its note or
preserving it does not fabricate text. Removing an annotation requires an
explicit editor action. The complete ordered replacement uses the existing
annotation member factory and canonical signer.

Only the selected item's last-synced annotations are loaded through
`item_annotations_v1`, with the review generation and canonical revision checked.
At most one comparison response and one bounded transaction draft remain live.
The draft has a 4 MiB byte ceiling, and the canonical transaction builder still
enforces each member and whole-envelope budget before signing. Current comparison
failures prevent submission. Every member must be visited before storing the
replacement. Whole mixed-operation transactions still require a matching editor;
unsupported members are never dropped.

After verified source demotion, ordinary consumer enrollment retains the existing
installation key and uses the handoff ID as a new actor incarnation. It cannot
reuse the old writer actor identity. A prepared request alone grants no edit
admission; the successor must countersign it and the source must durably install
that enrollment. Canonical writer and provider admission remain closed.

Completed native recovery follows the exact retained reenrollment request across
later target preparation and cancellation. An indexed lookup returns at most two
matching archive records and rejects ambiguity or changed receipt bytes. This
lookup reports recovery metadata; ordinary follower admission and current actor
checks still guard every new replacement. Preparing a target neither resends nor
deletes archived edits.

Historical archive review first uses the canonical actor for the original epoch.
If that actor record no longer covers the epoch, it reads at most two archived
enrollment rows and requires one exact identity. The existing enrollment verifier
checks canonical bytes, actor possession and authority signature against the
retained historical authority. Stored actor key, certificate digest and chain
genesis must match. Every original operation signature and transaction digest
still verifies. This read-only snapshot grants no present enrollment or write
admission, and historical acceptance still requires complete canonical receipts.

Browser preparation for a later consumer recovery verifies the completed prior
cycle before replacing its local handoff record. Exactly one committed archive
must match the following record and the old active enrollment. Its canonical
reenrollment receipt must match every retained request field, and its historical
archive bytes must verify without comparison to subsequently changed live rows.
The current signed successor proof remains independently required. Deletion of
the completed handoff record, creation of the next archive and its prepared
request commit together. Failures preserve the previous lifecycle and all archives.

Browser fresh-intent persistence requires the installation's current completed
follower enrollment. Its actor ID, public key, certificate digest and chain genesis
must match the active actor record, and any local recovery fence must describe the
completed following lifecycle. These checks run inside the same write transaction as
actor-tip revalidation, capability checks, intent members and optimistic state.
Existing pending or published exact retries may return before fresh-write admission;
resolved intents retain their explicit refusal. Signature preparation and private
transaction-owned persistence are separate so a recovery replacement and its durable
link can share one future commit. That linkage is not implied by ordinary enqueue.

### Browser recovery replacement transaction

`reapply_consumer_intent` accepts a closed reviewed-original identity and a bounded
complete signed replacement transaction. Review pins include archive and transaction
digests, member count, generation, canonical revision and local optimistic sequence.
The worker snapshots input bytes and serializes the command with other database work.
It requires its own IMMEDIATE transaction, FULL durability and foreign keys.

The command shares original-signature, historical-enrollment, receipt and rejection
verification with review. A matching durable replacement link returns before checking
current enrollment, source pins or the supplied replacement envelopes. This retry also
works after ordinary intent settlement; it does not recommit a resolved intent.
Without a link, confirmed acceptance and stale review fail. The current consumer must
have completed recovery into a different epoch and actor incarnation. Fresh signed
members must preserve the entire ordered operation and entity target set, satisfy
normal enrollment/capability/tip/target checks and use a new unlinked transaction ID.

The intent, members, optimistic fields, actor counter and replacement link commit
together. Link-insertion failure rolls back the whole transaction. The original
archive remains unchanged. No command signs, chooses replacement payloads or drops
unsupported members. The client checks the closed receipt against the original
request and never automatically retries after worker loss.

The browser assignment action requires explicit activation after a complete review.
It reloads bounded verified pages against the same archive, transaction, generation,
canonical revision and local optimistic sequence before signing. Only small assignment
inputs survive between those pages. A stored replacement returns before key access.
Read, saved, archived and liked assignments use the existing shared builder and retained
key with fresh timestamps and identities; unsupported members or missing items refuse
the entire action. Finalized bytes remain in the action closure across an ambiguous
response, and an explicit retry submits those same bytes. Reopening review checks the
durable link first. The Library may still change after signing; the worker's atomic
preconditions remain authoritative. Local sequence covers optimistic fields, not every
pending nonoptimistic edit. Other families require their original editors and their
own current-state checks. Assignment recovery does not close that requirement.


For RSS name transactions, the browser editor loads canonical original envelopes in
bounded verified pages, preserving their full ordered feed set. It compares Library
generation and canonical revision for every local feed detail read and checks the
original review's optimistic sequence on every archive page. Missing feeds and other
operation families refuse the whole draft. Current names are explicitly last-synced
values; the editor does not claim to include pending nonoptimistic names. It warns
that revised names may override newer or queued values. No feed URL is fetched.
Explicit submission snapshots the revised names, reloads the verified original and
current targets, and uses the existing shared RSS title schema with fresh timestamps.
The same private action boundary as assignment recovery retains finalized bytes and
uses atomic reissue linkage. All fields must be visited, and names remain locked
after the first submission attempt until review is restarted. This editor covers
name assignment, not subscription creation, removal or unrelated transaction members.


Browser annotation recovery preserves complete verified annotation payloads within
one bounded transaction draft. It retains unloaded quote digests without fetching text
and refuses unsupported outer blob members, mixed operation families and missing items.
The editor loads one last-synced annotation comparison at a time, checking its generation
and canonical revision. Every item must be visited before submission. Pending annotation
sets are not included in that comparison and are named in the override warning.
The action snapshots revised highlights and canonicalized tags, rechecks the entire
original ordered item set, and uses the registered shared annotation transaction schema
with fresh action timestamps. Its finalized bytes and atomic replacement linkage have
the same retry semantics as assignment and RSS name recovery. Desktop and PWA share
only the pure annotation fields; platform-specific verification and persistence remain
at their existing boundaries.


Earlier recovery archives remain available for read-only review while a later
successor enrollment is required or prepared. The archive view resets when that
lifecycle changes, and reapplication controls remain hidden until the browser reaches
its following state. Actual writes still require accepted current actor enrollment.
Archive-reader unavailability is reported separately and does not block enrollment;
the UI does not infer that no archives exist from a failed read.


Browser unsubscribe recovery preserves the complete archived feed set and its original
keep-articles or delete-articles operation. It reads current subscriptions locally,
refuses absent subscriptions without inferring acceptance, and requires every feed to
be visited. The destructive form additionally requires explicit confirmation that all
articles and reading history will be removed, including content added since the original
edit or before acceptance. It does not silently change deletion scope. A fresh signed
transaction uses the existing unsubscribe schema; ambiguous retry retains its exact
bytes and durable archive link. Mixed unsubscribe scopes refuse the whole action.
No URL is fetched during review or signing. Once accepted, ordinary Primary polling
stops for those subscriptions under the reviewed Level 5 behavior scope.

Freed Desktop unsubscribe recovery uses its existing RSS removal member builder
and native editor replacement command. It preserves the full ordered feed set and
original deletion scope, refuses mixed scopes, and never splits an archived
transaction to fit a batch. The registered mutation program bounds the replacement.
Deleting articles requires explicit confirmation before signing. That confirmation
covers later arrivals through Primary acceptance. Retries retain finalized bytes;
the native transaction owns intent, actor-counter and recovery-link atomicity.

Browser enrollment installation snapshots the selected authority and pending
request before asynchronous signature verification. It rechecks that complete
context inside the immediate write transaction before inserting actor or
capability rows. A change rejects the installation without a partial receipt
or actor counter. An unchanged exact installation retry remains read-only.

Enrollment responses can arrive after a checkpoint containing the same signed
grant. The browser must reuse the stored capability ID only when the unused
active actor, certificate bytes and digest, issuance identity, scope and complete
permissions match the verified response. Physical capability IDs may differ
between native and browser creation. A conflict aborts without changing the
pending request or local actor counter. Cross-runtime tests compare the complete
logical checkpoint digest after incremental replication and accepted results.

Archived item deletion recovery retains the complete ordered target set, including
currently absent items. Review and explicit deletion confirmation precede signing.
The replacement uses a fresh deletion timestamp; it must not reevaluate an old
bulk filter, silently omit targets, deduplicate members or split the transaction.

Normal RSS renames use `rss_feed_title_assignment` on Desktop and PWA. Desktop
checks target presence before submitting a title-only update and does not copy
other feed fields into that transaction. Existing full-record archived upserts
retain their original signed operation and require explicit editor recovery;
clients must not automatically translate them into title assignments.


Desktop full-record RSS recovery is a separate editor from title assignment.
It verifies all original members and the current canonical feed details against
one reviewed generation and revision. Original inputs and current feed records
each have a 4 MiB aggregate bound; at most one subscription is rendered at a time.
An existing subscription starts from last-synced values. Its URL, last-fetched
timestamp and sample provenance stay fixed; owner fields may be revised with archived values visible.
Every subscription must be visited and explicit confirmation covers polling changes.

The complete ordered upsert transaction uses the ordinary registered member builder,
without deduplication, batching or automatic translation to a title assignment.
Submission preserves exact signed frames across response loss and delegates intent,
actor counter and linkage atomicity to the existing native recovery command. A full
record can override queued or later Primary changes, which the editor warns about.
Unknown target state and deleted subscriptions refuse the whole draft. Upsert does
not resurrect tombstones; explicit restoration remains a separate operation.


The browser uses the same subscription fields and confirmation flow. Its action
snapshots closed selected records before asynchronous work, reloads the complete
verified original and same-revision current subscriptions, and checks every ordered
URL before signing. Current fetch history and sample provenance replace any supplied
historical values. Source and selected-record bytes are bounded independently at
4 MiB. A stored link returns before key access. The existing private action retains
finalized envelopes after an ambiguous response; the worker's recovery command owns
atomic intent, actor-counter and link persistence. No ordinary enqueue path runs.


The unreleased recovery review row also carries nullable `rssFeedState`: `present`,
`absent` or `deleted` for RSS members, null for other entities. One registered SQL
variant uses indexed identity probes, checking tombstones before live subscriptions.
The result shares the review transaction's generation, revision and optimistic sequence.
A missing feed-detail row alone cannot authorize recreation. These states describe
the reviewed replica frontier and do not prove the original edit failed. Native and browser query
models change together; this does not extend the released feed-detail query.

An explicitly reviewed absent subscription may be recreated under its exact archived
URL. Its initial draft uses the archived name and unread preference, disables polling,
and omits old fetch history and automatic image loading. Sample provenance remains
attached. The owner reviews all members and confirms any chosen polling changes.
Deleted or unknown states refuse the complete draft. Native and browser recovery write
owners independently reject RSS upserts whose targets are tombstoned, inside the same
transaction as enqueue and linkage. This check follows exact durable-link lookup so
later deletions cannot turn an acknowledged replacement's retry into a new write.

### Account-link recovery

Account-link recovery on Desktop and PWA verifies every original `account_person_assignment`
member, preserves ordered Account targets including duplicates, and reads current
Account and Person detail at the reviewed canonical generation and revision.
It retains only bounded labels and IDs, renders one account and one bounded
person-search page, and never loads profile images or contacts a provider.
Missing Accounts refuse the complete transaction. A missing archived Person is
shown as unavailable; the owner must choose a current Person or unlink the
Account. Every selection change clears confirmation, and every account must be
visited before submission. Other operation families are never dropped.

Normal assignments and recovery use the same registered member builder.
Recovery freezes selected IDs before asynchronous preparation, signs the whole
transaction without ordinary enqueue, and submits through the native atomic
reissue link. Finalized bytes survive response-loss retries in the open editor;
reopening checks the durable link. Native or worker source and enrollment checks still
own admission. PWA preparation additionally reads each selected Person at the
reviewed source before key access. Its action retains the finalized transaction
across retries without rerunning queries or signing after an ambiguous commit.
Complete Friend recovery uses the separate two-step Person and account editor. Preference recovery uses its own complete-transaction editor.

### Person deletion recovery

Desktop and PWA recover `person_remove_and_accounts` only as a complete ordered
transaction. Every original Person ID remains present, including duplicates and
currently absent people. Current labels come from exact Person detail queries
at the reviewed canonical generation and revision. Mixed operation families,
changed identity, stale detail or interrupted review refuse the whole draft.

The owner visits every target and confirms deletion of the people, their notes
and reach-out history, and accounts linked when the Primary accepts the edit.
Later links are included by the registered operation semantics. Absence does not
establish original acceptance. Recovery uses the normal registered Person removal
member builder without ordinary enqueue; one native or worker transaction stores
the new intent and recovery link. Exact retries retain finalized envelopes and
return the durable receipt. No original archive bytes are rewritten.

Recovery review distinguishes present, absent and deleted Person targets through
indexed lookups at the reviewed source. Tombstones take precedence over live rows.
Native and PWA recovery refuse fresh Person upserts and Friend replacements that
target a deleted Person before storing intents or recovery links. An existing
durable replacement remains retrievable after a later deletion. This supplies the
state and write guard used by the Person/Friend recovery editors;
it does not offer restoration of deleted people.

Native follower enqueue now enforces the same registered transaction member limit,
operation family and entity type as the Primary and PWA before storing a new
intent. In particular, an atomic Friend replacement contains one member. Rejected
transactions do not advance the local actor counter or create optimistic state.
Existing durable recovery links remain readable on retry.

### Historical PWA Friend ordering

Older PWA clients could store Friend intents in locale-based Account ID order,
which native admission rejected. PWA archive inspection now authenticates those
original single-member transactions without changing their bytes. It shares
normal digest, transaction, chain and signature calculations, retaining all
payload bounds, unique IDs, Person linkage and contact-count checks. Only the
historical ordering requirement differs. Historical constructions have separate
provenance: normal assembly and finalization reject them, and archive verification
does not return an accepted actor state or normal verification provenance.

This path applies only after archive identity and historical enrollment checks.
It does not admit the old intent into the current journal. The owner must review
and explicitly submit a fresh replacement, whose signing and enqueue use the
ordinary current validator and binary Account order. Native enqueue remains
strict; it did not permit these old out-of-order intents to become durable
Desktop edits. Signature tampering still refuses review. A browser WASM SQLite integration test
verifies the historical enrollment and original signature, preserves the original
account order and archive bytes, and commits a correctly ordered fresh replacement.
Deleted selections refuse without writes; retry after a revision change returns
the original durable link. Successor admission remains synthetic in this test,
so it does not prove cloud handoff, OPFS durability or installed behavior.


### Account deletion recovery

Desktop and PWA preserve the complete ordered `account_remove` target set,
including duplicates and absent Accounts. Source-pinned Account detail queries
supply bounded labels only. Mixed operation families or stale detail refuse the
whole draft. Every target must be visited and deletion explicitly confirmed.
Confirmation covers Account details and links through Primary acceptance; it
does not delete linked people or provider accounts.

Recovery shares the ordinary registered removal member builder but does not use
ordinary enqueue, deduplication or batching. One explicit action retains its
finalized signatures across response loss and uses the existing atomic intent,
actor-counter and archive-link transaction. Original archive bytes stay intact.


Recovery `account_upsert` admission rejects a selected Account tombstone inside
the native or browser immediate write transaction. The check follows original
archive verification and durable replacement lookup, but precedes intent writes.
An existing replacement receipt therefore survives a later Account deletion.
Absence alone does not establish that an Account may be recreated; the database
owner enforces the tombstone rule independently of the recovery editor.


### Full Account recovery

Desktop and PWA review complete `account_upsert` records through `account_root_v1`,
with one record rendered at a time. Ordered target identity and duplicates remain
fixed. Current details are the initial draft when available. The owner may copy
archived details, revise contact fields, clear avatar URLs or unlink the Account.
Every change clears confirmation. The warning covers full-record replacement and
person-link changes through Primary acceptance, including newer or queued edits.
Absent drafts omit the avatar until explicitly selected; review loads no images.

Current and archived roots retain their complete registered metadata. Root count
is bounded by the mutation member limit and each root by 64 KiB; oversized field
edits refuse before replacing the retained draft. Selected records are snapshotted
before asynchronous signing. PWA preparation reverifies every original member;
Desktop native admission independently checks the exact ordered original scope.
Selected person links must still exist at the reviewed generation and revision.
No ordinary enqueue, deduplication or batching occurs during recovery. Finalized
bytes persist in the action across response loss, and the native or worker
transaction owns the durable intent, actor counter and archive link.


### Retained reach-out events

Native and PWA recovery check each original `person_reach_out_append` operation
ID against the current Person history inside the replacement write transaction.
A retained original event refuses the complete replacement, even if its time or
text differs. A checkpoint may retain this event without the original acceptance
receipt, so unresolved review alone does not authorize a duplicate event.
The check follows durable replacement lookup: an exact retry still returns the
first replacement receipt after later history changes.

History retains only the latest 20 events. Absence is not proof of nonacceptance
and must not be presented that way. The explicit history editor warns about this
limit before asking the owner to add the entries again.


Desktop and PWA reach-out editors preserve every ordered Person target and
original event payload, refusing mixed operations, missing people, stale history
and known retained original event IDs. Only the visible Person's recent history
is retained for comparison. Every event must be visited with a successful history
read before confirmation; navigation and field changes clear confirmation.
The owner may revise the historical date, channel and notes. Fresh signing time
and operation identity remain separate from the selected historical event time.

Both paths reuse their normal reach-out member builder, without ordinary enqueue,
deduplication or transaction splitting. Submission snapshots the selected values.
PWA preparation reloads verified originals and current history before signing;
native admission independently verifies ordered scope and retained event IDs.
An ambiguous response retains exact signed bytes and durable recovery linkage.
History reads use the bounded `person_detail_v1` projection and discard linked
Account context; maximum legal detail coverage remains part of final validation.


### Preference recovery scope

Native and PWA recovery compare every original and replacement preference patch
inside the write transaction. Object assignments must preserve their exact key
sets recursively. A replacement cannot add or drop an object path or replace an
object branch with a scalar or array. Arrays and scalar values replace their
whole assigned value under the normal mutation semantics; array elements do not
become independent recovery targets. This check follows durable replacement
lookup and precedes intent storage. Exact retry therefore retains the original
receipt even when new replacement bytes would fail admission.

The preference recovery editor requires explicit review and confirmation. Matching assignment paths
does not replace payload validation, current-value review or provider behavior
review for settings that affect capture. Historical canonical import coverage
remains part of this work.


Native fresh preference admission consumes the generated preference write policies
and preserves the same nested object, array and map values as the shared sanitizer.
Unknown or device-local fields and invalid nested container shapes refuse before
local intent persistence. Primary resolution signs `precondition_failed` for a
fresh unsupported patch without materializing preferences or advancing the actor.

Historical signature authentication retains its earlier policy. It remains
possible to inspect authentic previously stored native patches that fresh writes
now refuse. Stored canonical receipts and durable recovery links are checked
before fresh policy admission. This separation does not make an unsupported
historical patch valid for new PWA writes or prove that every old canonical
segment can be imported by the PWA. Such bytes remain preserved and must not be
silently stripped or re-signed.

PWA historical preference authentication uses the same bounded top-level and
device-local exclusions as native history verification, without applying the
current fresh-write sanitizer. Archive and canonical-history results carry no
fresh-write verification provenance or accepted actor state. Their member
constructions cannot be finalized for signing. Canonical import independently
verifies and binds the authority-signed acceptance receipt, then rechecks its
frozen actor snapshot and source revision inside the write transaction. The
original envelope bytes remain unchanged. Historical Friend ordering remains
archive-only because native authority never accepted that former PWA ordering.

Shared cryptographic tests and PWA SQLite fixtures cover this historical
preference path, including tampering, incomplete mixed transactions, device-local
exclusions, a mismatched signed receipt, duplicate import and retained bytes.
The native historical validator and shared verifier additionally consume the
same 32 policy cases, covering the historical top-level sections and device-local
exclusions. These fixtures do not establish compatibility for every historical
native segment or prove installed Mac behavior.

The historical native preference fixture is exported by published source
`v26.9.1700-dev` through its existing signing, acceptance and bounded export
functions. Current native and PWA readers preserve the original envelope and
acceptance receipt, replay duplicate pages, and reach the same final revision,
actor frontier and checkpoint digest. The PWA also reopens its engine between
pages. The old zero-operation export descriptor is retained unchanged. At that
baseline, tests explicitly require the current carried-frontier rule described
in [checkpoints](checkpoints.md), since enrollment alone no longer contributes a
tip. Checkpoint admission in this fixture is synthetic; live cloud joining and
installed Mac acceptance remain separate requirements.

Finite numbers in the registered binary64 wrapper are scalar preference values.
Fresh policy validation decodes them for type checks but retains their original
authenticated representation. Normal PWA preference writes use the same encoder
as Freed Desktop, and snapshot readers decode wrappers after reconstructing the
normalized nodes. Materialized rows and checkpoint digests do not change. Recovery
may replace a wrapped number with an integer at the same assignment path without
adding or dropping a setting. Nonfinite wrappers refuse fresh admission.

Preference recovery preserves the complete original drafts, then reads only the
selected setting through `preference_value_v1`. Each comparison must match the
archive review's generation and canonical revision. Archive pagination separately
fences installation-local changes. Exact stored replacement links return before
comparison reads; a locked response-loss retry retains the same prepared action.

Paths retain literal segments, so dotted map keys cannot select another setting.
The form retains one current value and distinguishes stored values, defaults,
absence, object-group summaries, loading and errors. It does not offer a group
summary as a replacement value. Empty object patches remain non-replacement
merges. Confirmation requires every field's comparison to load, and any edit or
navigation clears confirmation. Closing or replacing a review aborts its UI read
and discards late results. Desktop forwards cancellation to the native query
registry; the PWA checks cancellation around its bounded worker response.

This removes the whole-tree snapshot dependency from preference recovery.
Ordinary startup still uses `preferences_snapshot_v1`, whose total row and byte
bounds can be exceeded by accumulated accepted patches. Startup and dynamic
preference collection repair remain incomplete.

Preference signing adapters accept the complete reviewed wire patches, validate
every member and the aggregate byte bound, and snapshot values before context or
key access. They reuse the ordinary preference member builders with new operation
identities and signing times. The PWA reloads the verified originals, requires the
same ordered assignment paths before signing, and retains its finalized request
for response-loss retry. Native and worker write transactions remain responsible
for original signature checks and atomic intent, counter and replacement linkage.
These adapters do not use ordinary intent enqueue. Fractional-number conversion
preserves literal map keys such as `__proto__` as own data properties.

Desktop and PWA Settings expose the same preference form. It visits each original
assignment in order, compares archived and current values, and validates revised
wire patches without changing their assignment paths. Arrays remain whole values;
empty object groups preserve their non-replacement semantics. Every change clears
confirmation. Once signing starts, inputs lock and response-loss retry retains the
same prepared action. Closing a pending review cancels its reads. The form never
loads URLs from preference values or sends provider requests.

### Saved URL capture recovery

Desktop and PWA recover a complete transaction of saved-URL capture members
through the existing edited recovery protocol. The generated review row reports
FeedItem state as present, absent or deleted from the same read snapshot. Missing
rows do not establish whether an old operation was accepted. A tombstone refuses
this editor and is rechecked inside both persistence transactions before any
intent, link or actor-counter writes. Capture does not grant restore authority.

The verified draft preserves every original target and URL. Only title and
description are editable; the remaining capture payload stays archived input.
The complete draft and editable snapshot each have a 4 MiB ceiling. Every member
must be viewed before explicit confirmation. Unsupported capture types, mixed
transactions, inconsistent URL identities and blob-bearing envelopes are refused
without dropping members. This editor does not reapply separate annotations.

Preparation reloads the verified archive at the reviewed source and uses the
ordinary capture member factory without ordinary enqueue. The atomic recovery
submission owns durable intent/link persistence. Lost-response retries retain
exact finalized bytes. Opening the editor performs no URL requests. After Primary
acceptance, the restored item may enter the existing content-fetch policy; the
confirmation describes that possibility. No fetch policy or cadence changes.
