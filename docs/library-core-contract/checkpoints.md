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
until cloud coordination verifies a later control revision.

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
