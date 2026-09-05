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
