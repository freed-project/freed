## 10. Operation synchronization

After checkpoint bootstrap, clients synchronize append-only bounded operation
segments. A segment binds:

- Library, epoch, actor, first and last sequence
- previous and ending actor chain tips
- transaction identity, member index, and member count
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

Authenticated checkpoint manifests and authority-bound transport heads locate
checkpoint, operation, intent, result, and content objects. Google Drive is a
transport adapter for these objects. Provider endpoints, headers,
OAuth behavior, retries, and cadence are outside this contract.

Checkpoint and operation descriptors bind the same enrolled Primary actor. Native
export and PWA import resolve exactly one nonretired Desktop actor in the active
SQLite authority epoch. The installation-local writer role is not a transport
identity. Missing or ambiguous actors block admission, and PWA materialization
rechecks this identity inside its write transaction after signature verification.

### Normalized operation transport v2

The normalized transport uses a Library and epoch scoped Drive operation head.
Its closed anchor includes the writer, checkpoint manifest digest, and checkpoint
source revision. An immutable segment binds that anchor, its index, the previous
segment reference, the pinned native export descriptor, and one bounded export
page. The object digest covers the exact stored wire bytes. Each accepted result
and operation still requires independent canonical and signature verification.
The operation head is discovered beside the checkpoint control; it is not an
extra field in the existing control pointer. Only the current Primary publishes
it, using strong ETag compare-and-swap and exact readback after response loss.

A page contains at most 128 records and 1 MiB of canonical record bytes. The wire
header carries record metadata separately from canonical signed records to avoid
double encoding. Transactions may cross pages. Native and browser importers
retain partial records, reject changed replays, and materialize only complete
consecutive transactions. Native materialization shares the Primary mutation
program but creates no canonical publication outbox or authority signature.

Consumers traverse at most 64 segment references backward, retaining bounded
reference metadata, then reread and import one page at a time in forward order.
Their canonical revision advances only after durable materialization. The
checkpoint receipt remains a separate bootstrap anchor. Ordinary publication
advances a device-local operation cursor and does not rewrite that receipt.

A new checkpoint is required before extending a full chain, crossing a source
revision absent from the operation journal, or publishing operations that depend
on content descriptors. Descriptor-dependent highlights and event evidence stay
on the checkpoint path until descriptor delivery is implemented. The 64-segment
limit is a bounded initial policy, not an installed performance claim. No schema,
storage epoch, or signing domain changes are introduced by this transport.
