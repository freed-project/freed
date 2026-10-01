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

- 4,096 records, from executable `limits.checkpointPageRecords`
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

The causal frontier digest carries accepted work, not actor enrollment. Actors
with accepted counter zero do not contribute a tip. Until an epoch accepts its
first operation, its exported frontier is exactly its carried checkpoint
frontier. Rust and PWA use the same rule. A writer transfer therefore preserves
the source frontier while enrolling the successor, and the publisher still
rejects a transfer across a different frontier.

Desktop cloud coordination reads that normalized descriptor together with one
installation-local actor ID derived by the native key store. The descriptor's
`writerId` is the actor currently admitted by SQLite. The local actor ID names
the current installation and may differ on a restored or follower client.
Cloud state stores only the normalized Library ID, authority epoch, admitted
writer ID, provider control locator, and publication receipts. It contains no
source-shell digest. Writer transfer uses the local actor ID as its proposed
writer and lets normalized SQLite verify and enroll it while signing the next
authority epoch. No renderer authority bootstrap or historical journal is part
of this path.

The last provider-confirmed writer lease is a device-local row in the selected
normalized SQLite catalog. Capture and provider-delivery workers read that row
before external work. It is never a source of Library authority and is excluded
from checkpoint export. A remote writer mismatch pauses local provider work
until cloud coordination verifies a later control revision. Follower checkpoint
activation deletes both canonical writer admission and the provider lease in
the activation transaction. A failed activation rolls back both deletions; a
successful consumer import cannot inherit prior local writer permission.

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

Native checkpoint installation may run inside a caller-owned transaction when a
local lifecycle transition must commit with it. Its receipt is provisional until
that transaction commits. The existing public activation calls still own and
commit their transactions. A later lifecycle failure must roll back installed
rows, writer-admission changes, consumer receipts and stage consumption together.
This composition does not bypass checkpoint verification or a handoff fence.

Desktop and PWA use one storage-neutral checkpoint staging state machine. Each
runtime supplies only its typed SQLite begin, append, selection, and activation
calls. Desktop follower bootstrap and writer transfer consume normalized v2
records directly. No portable checkpoint codec, Library shell extraction,
whole-item append command, or offset-based payload page exists in the runtime
surface.

The verified checkpoint digest becomes the local materialization generation
ID. Every bounded query cursor binds to that generation ID, never to the human
Library ID. The generation metadata is local and is not included in checkpoint
records, which keeps the checkpoint digest acyclic. Native Desktop selection
accepts this generation only through a receipt naming the same Library, epoch,
active writer actor, and checkpoint digest, at a revision covered by local
canonical state. Primary genesis and restore retain their epoch-digest proof.
Missing or mismatched consumer receipts do not become a new Primary proof.

Native follower refresh within the same Library and authority epoch retains
the exact enrollment request, signed intent members, pending and published
transactions, optimistic fields, result receipts, transport history, counters,
and local invalidations. Disk-backed scratch tables participate in the same
activation transaction and disappear on success or rollback. Refresh cannot
change the accepted authority certificate or writer, regress the source revision
or actor chain, or introduce an actor advance absent from retained signed work.
An incompatible Library or epoch requires explicit recovery. Unpublished Primary
work still blocks replacement. A checkpoint never settles a pending intent by
itself.

A verified accepted result ahead of the native replica's canonical revision
retains its optimistic fields. A later checkpoint removes those fields only
when the stored result belongs to that authority epoch and its revision is
covered. Result and transport receipts remain available for exact replay.

A source handoff can use the shared bounded checkpoint reader to download into
staging without activation. This result is explicitly `staged`, with its download
digest and byte/count summary nested separately from installation receipts. Native
stage counters must match the completed download. Its replay timestamp comes from
the immutable checkpoint header so retrying a manifest preserves exact begin
metadata. No stage result grants query selection, writer admission or authority.

An authorized old Primary may adopt its direct signed successor as a consumer.
Native preparation binds a complete staged checkpoint to the exact durable source
consent, predecessor checkpoint digest and successor certificate. Handoff staging
preserves the source revision; adoption rejects regression rather than requiring
an extra revision. The successor may have published later checkpoint generations.
Native verification must match the cloud control, manifest and every checkpoint
page before committing. The proposed control alone grants no role.

One FULL SQLite transaction rechecks the stage and consent, installs the follower
checkpoint, validates its materialized frontier, and records source demotion.
Any failure rolls back the selection, receipt, lifecycle and stage consumption.
The source remains closed to canonical writes and provider work. An exact retry
uses the durable demotion receipt, including after reopen; a changed stage or
control cannot impersonate that retry. Prior consumer history that cannot be
retained safely blocks adoption and must not be deleted to make it succeed.

Desktop source coordination downloads from the control locator in its durable
consent, then invokes independent native remote verification before adoption.
A committed demotion retry reconstructs the original stage and control from the
stored demotion receipt. It does not download a newer head or require an unexpired
token. Cancellation before native admission leaves the source fenced and retains
staged rows. Native work already admitted may finish and must be recovered through
its durable receipt.

The native handoff cancellation ledger is installation-local. Its rows survive
logical checkpoint replacement and are excluded from checkpoint export and digest
calculation. Importing another installation's checkpoint cannot erase local
cancellation history or make a retired readiness eligible again.

A canceled handoff target can install later checkpoints from the same authority
epoch using its ordinary follower receipt. The import rechecks its retained
cancellation proof and preserves the local ledger. Canonical actor retirement
still applies; a canceled target does not regain a retired actor's edit rights.
A canceled target can also accept a signed direct successor after verifying its
old cancellation before replacement. The post-install check binds the successor
certificate, canonical writer actor and follower receipt, and rejects readiness
identities already canceled locally. Old enrollment and intents remain preserved
but fenced until explicit archival and reenrollment complete. The cancellation
ledger survives replacement of the current lifecycle with consumer recovery.

Verified target activation archives its complete settled consumer history before
retiring the live consumer slots. Archive creation, slot retirement and local
writer admission share one native transaction. A late failure restores the live
rows and leaves the target fenced. Exact activation retry reuses the committed
result without creating another archive. Query invalidation sequences remain
monotonic. Original signed edits and their old enrollment certificate remain preserved.
When promotion moves the actor record to a new epoch, archive review verifies the
retained authority-signed enrollment certificate against the historical authority
before checking the original envelopes. The historical snapshot is read-only and
cannot grant current edit rights. This does not reapply edits as Primary. Full repeated promotion/demotion acceptance remains pending.

Browser checkpoint refresh may continue within an accepted successor epoch while
the old enrollment awaits explicit recovery. This is distinct from accepting a new
successor: checkpoint generation and source revision cannot regress, and the writer
must stay the same. The staged authority must match the locally accepted successor
certificate, digest, epoch and key. Verify that certificate against the retained
predecessor and current writer key, bind the exact local request and authority
rows, then recheck the proof inside activation's write transaction.

Keep the old request and signed intent epoch separate from the selected checkpoint
epoch. Preserve every local intent, transport, optimistic and invalidation row; a
refresh does not archive, resend or grant edit admission. Both the selected authority
and the old enrollment's historical authority must survive with unchanged Library,
epoch number, certificate digest, canonical bytes and key. Late failure rolls back
the checkpoint and local rows together. Existing archive bytes remain unchanged.

Native refresh also pins the Library ID, epoch number and transition certificate
digest for both retained authorities, in addition to their keys and canonical
certificate bytes. Historical metadata changes reject activation before local
consumer rows are restored; the surrounding transaction rolls back the replacement.
Headless promotion is a separate maintenance operation after import. Its private
retry record binds the complete source control pointer, expected remote revision,
control locator, installation witness, and fixed request time before native
preparation. Restart reuses the same signed successor certificate. The host
compares complete prepared and remote canonical checkpoint streams, including
authority records, then rereads exact control after verification. Matching writer
and epoch labels alone never resolve an ambiguous transfer. Publication receipts
use an explicitly writable, descriptor-bound private file; other service inputs
remain read-only. Ordinary startup cannot substitute for incomplete promotion.

A consumer that missed the successor target's enrollment must first obtain the
final predecessor checkpoint. Read authentication may verify the canonical
handoff certificate against the locally trusted predecessor using the target
key from predecessor-signed readiness. This authenticates the immutable source
control pointer, final revision and checkpoint digest for a bounded download;
it does not prove local target enrollment, select a checkpoint or grant writer
admission. After catch-up, ordinary successor verification must still require
the enrolled target and recheck the selected predecessor and staged certificate.
Never use an unverified pointer to start this catch-up. Desktop and PWA perform
one direct-predecessor download per attempt through the shared coordinator. They
do not recursively search older epochs. The import transaction must independently
reconstruct the proof and verify the signed digest before committing; a returned
read reference is not an activation token.

The native `library_active_authority.writer_id` may contain a local writer label
such as `primary:desktop`. Resolve the cloud writer identity from the unique
non-retired Desktop actor in the selected epoch and require the follower receipt
to name that actor. A local label is not an actor ID or a substitute for the
receipt and signature checks.
