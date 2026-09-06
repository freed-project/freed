## 6. Mutation contract

The generated canonical mutation registry is exhaustive. Its 23 mutation names
must exactly match its 23 generated SQL programs. A declared name without an
executable program fails generation. The registry covers FeedItem capture and
state, provider delivery receipts, Person and Account identity, Friend
replacement, RSS subscriptions, preferences, relationship effects, and typed
tombstones. Bulk scope staging, device contact generations, content
publication, actor administration, writer transition, checkpoint import, and
recovery use their own closed protocols because they are not canonical product
mutation members.

Actor capability profiles live in this same executable contract. Generation
fails if a profile names an undeclared mutation. The Primary writer profile
admits all 23 canonical mutations through the same 23 generated normalized SQL
programs. This
includes `feed_item_capture_upsert`, which atomically materializes FeedItem
source fields, media, and topics into normalized tables while preserving
existing user state and refusing tombstone resurrection. Feed capture metadata
is capped at 98,304 canonical bytes. Person and Account root metadata are each
capped at 65,536 canonical bytes. These limits reserve deterministic space for
the closed operation and checkpoint wrappers below the 131,072-byte logical
record ceiling. The limits count UTF-8 bytes, not JavaScript code units. Larger
legal content uses descriptors and content-addressed chunks. The capture actor
remains limited to this one feed-capture mutation. Adding a future mutation
requires its executable program in the same contract change and does not grant
it to any profile. Rust and TypeScript consume generated profile
constants, so no second capability-operation registry can drift from the
mutation catalog. All 23 generated mutation programs also share one closed TypeScript
assembly, signing-body, and final-envelope path before the native verifier and
materializer. No supported program can bypass canonical transaction bounds by
falling out of a handwritten transform union.

`feed_item_annotations_replace` owns the complete sorted tag and highlight sets
under the `annotations` field clock. `feed_item_analysis_replace` owns content
signal scores and the event candidate under the independent `analysis` field
clock. Both payloads are closed and bounded. Oversized legal highlight or event
evidence is represented by a content-addressed blob digest whose descriptor
must already exist. `feed_item_capture_upsert` strips these child fields and
therefore cannot overwrite either owner.

Desktop and PWA construct that capture payload through one shared pure
projector. It sanitizes synchronized root fields, removes Primary-owned
analysis plus device-authored highlights, and replaces capture tags with the
required empty set before either host assembles a signed transaction. The two
hosts cannot drift into separate capture side channels.

The same executable contract defines the initial agent read profile. It grants
only `friends_directory_page_v1`, `item_detail_v1`,
`item_reader_body_v1`, `saved_feed_page_v2`, and `search_page_v1`. A version 2
capability carries separate sorted `allowed_operation_types` and
`allowed_query_ids` arrays. An agent may be read-only, but every capability
must grant at least one mutation or query. Editor and scraper certificates
must carry an empty query array. Unknown, duplicate, unsorted, or
class-incompatible grants fail before either signature is accepted. The signed
grant set is stored in normalized child tables and checkpointed as stable
`92_actor_capability_mutation` and `92_actor_capability_query` records. Socket
access does not grant read access.

The normalized schema accepts version 2 capabilities only. Editor, scraper,
and agent rows must carry an explicit scope plus mandatory issuance and
retirement identities. SQLite constraints, checkpoint activation, and native
mutation admission all reject version 1 legacy editor rows. The frozen
historical operation list lives only in the one-time source verifier and is
not part of the executable normalized contract.

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

Friend editing uses the closed `friend_replace` mutation instead of exposing a
renderer transaction builder. Its payload contains one desired Person and the
complete desired linked Account set, sorted by Account ID. The set contains at
most 64 unique Accounts, every Account names the payload Person, and at most
one Account may use the contact provider. The complete canonical payload is
capped at 98,304 bytes. Freed Desktop and the PWA may read only the exact
current Person and desired Account rows needed to preserve synchronized fields
before signing this one mutation.

The Primary resolves `friend_replace` in one immediate SQLite transaction. It
upserts the Person, Person tags, desired Accounts, and Account roles. A social
Account omitted from the desired set is detached from the Person. An omitted
contact Account is deleted. The same commit appends one journal operation,
advances the actor tip, records one receipt and replication result, and emits a
Person invalidation plus an Account reset invalidation. No intermediate Person
or Account state is visible, durable, or transportable. The mutation is
admitted only to the current Primary-writer capability and creates no provider
request.

All other Friends controls call their exact registered mutation directly.
Relationship-tier changes use `person_upsert` with the complete Person root.
The shared Person-root transform always removes `reachOutLog`, because child
history may enter authority only through `person_reach_out_append`. Deletion
uses `person_remove_and_accounts`, and linking uses
`account_person_assignment`. Freed Desktop signs these through the native
Primary boundary. The PWA signs the equivalent follower intent. The Friends
view never calls a durable Zustand action or reconstructs a Person or Account
catalog for these writes.

Command-palette identity promotion follows the same boundary. It resolves one
exact Account and, when necessary, derives one connection Person through the
shared deterministic identity transform. Creating that relationship uses one
`friend_replace`. Promoting an existing Person reads that exact Person row and
uses one root-only `person_upsert`. The palette never reads a renderer Account
map or calls the historical connection-person store action.

Google Contacts suggestion linking reads the exact matched Person, its complete
bounded linked Account ID window, and each exact Account detail. It combines
those rows with the one contact Account and submits one `friend_replace`.
Creating a Friend from a contact uses the same mutation with one Person and one
Account. Feed author navigation creates a missing normalized Account through
one direct `account_upsert`. No shared UI component calls Person or Account
Zustand mutations.

The shared Zustand contract exposes no Person or Account authority methods.
Freed Desktop and the PWA do not provide add, batch-add, partial-update,
remove, relink, reach-out, connection-builder, or deprecated Friend aliases
through renderer state. Those methods and their store-surface registry entries
are deleted. Identity writes exist only as closed registered SQLite operations
through the platform boundary. Development fixtures call the same PWA SQLite
runtime directly instead of reviving a store mutation path.

The renderer store also exposes no complete FeedItem, RSS Feed, Person,
Account, or Friend collection and no per-feed count dictionary. Typed SQLite
mutations return invalidations that reopen only affected bounded query windows.
Maintenance work traverses source-fenced SQLite pages outside React and retains
only the mutation targets required by its registered operation. There is no
whole-corpus optimistic projector or shell-shaped mutation preview.

PWA empty-feed status reads one selected RSS Feed through
`rss_feed_detail_v1`. PWA sync status reads the latest successful RSS refresh
from `library_facet_summary_v1`. Neither surface reads or retains the complete
RSS subscription map.

Google Contacts provider data is device-local SQLite state. One singleton
selects an active contact generation. A new sync builds normalized contact
roots, email rows, phone rows, photo rows, organization rows, suggestions, and
suggestion Account links under a separate generation identifier. Activation
switches the singleton and deletes the superseded generation in one
transaction, so readers observe either complete generation and never a partial
import. These tables are excluded from checkpoint export and replication.
Every interactive contact surface pages the active generation through a closed
bounded query. React retains only the visible review window and ephemeral
interaction state.

Device contact generation mutation is a closed schema-versioned protocol.
Its schema identity, digest domain, row bounds, child bounds, and canonical
byte ceilings live in the executable SQLite contract source and generate the
TypeScript and Rust constants. Freed Desktop executes the protocol inside the
runtime-neutral native core. The PWA executes the same protocol inside its
OPFS SQLite worker. Both implementations share a canonical digest vector and
the same changed-replay rejection semantics.
Delta batches contain at most 64 unique contact or deletion identities, carry a
contiguous ordinal, and receive a canonical digest receipt. A changed replay is
rejected. Match batches contain at most 64 exact results, including explicit
unmatched results, and each contact receives its own canonical digest receipt.
Activation requires staged and matched counts to equal the caller's exact
expected contact count. Every normalized contact is canonically bounded to
131,072 bytes before it crosses the SQLite boundary.

Contact synchronization reads use separate closed contracts. Status is one
singleton response. Matching reads one building generation in binary
`resourceName` keyset order and excludes contacts that already have a digest
receipt. A page admits at most 64 contacts and at most 1,048,576 response
bytes. The byte ceiling can shorten a page before its row ceiling without
dropping the cursor for any admitted contact.

Active review uses two independent keysets. Suggestions order high confidence
before medium confidence, then newest creation time and stable suggestion
identity. Unmatched contacts order by binary display name and resource name.
Both responses reassemble only their admitted contact rows, cap visible rows at
50, stop before the same 1,048,576-byte ceiling, and expose no full-generation
array.

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

Actor capability policy is a crate-level native protocol primitive. The
generated canonical, Primary, and scraper operation sets, normalized stored
capability parser, scope model, and admission predicates do not live beneath
the historical journal module. Normalized import, migration, mutation, writer
reassignment, enrollment, and verification all consume this one policy
directly. The frozen version 1 editor policy remains available only to the
historical source reader and cannot be parsed into normalized SQLite.

Actor retirement is an authority-signed normalized protocol action. The
certificate binds the Library, authority epoch and key, actor, version 2
capability certificate, stable retirement identity, closed reason, and exact
retirement time. The admitted Primary writes the certificate, retires the actor
and capability, advances the canonical revision, and emits one reset
invalidation inside the same SQLite transaction. Exact replay returns the
original certificate and original committed revision. A changed reason, time,
identity, capability, authority, or signature fails without a write.
`93_actor_retirement` carries the typed row in every normalized checkpoint.
Native and PWA activation verify the original canonical certificate against the
checkpoint authority key before accepting the retired actor and capability
state. Checkpoints contain no unsigned retirement hint and no client may infer
retirement from a missing actor or local cache edit.

Normalized authority and operation identities are also native protocol
primitives. `NormalizedAuthorityStateV2` owns the exact Library, epoch,
authority key, and ordered causal frontier. `NormalizedCausalTipV1` owns each
actor sequence, operation, and chain digest. Sealed actor enrollment,
operation, and transaction values live beside those normalized identities.
The historical source journal consumes these types but does not define them,
and the former unversioned authority and causal-tip type names are absent.

Native authority and migration failures use one `LibraryCoreError` and
`LibraryCoreResult` model outside the historical journal. Normalized SQLite
wraps those failures as protocol failures, never as journal failures. The
former `JournalError`, `JournalResult`, and `NormalizedSqliteError::Journal`
vocabulary is absent from the native core.

The native crate exports no historical journal, follower outbox, follower
overlay, follower anchor, or journal-status API. Those types are private to the
fenced one-time migration source while it remains installed. Freed Desktop,
the headless Primary, and every normalized caller can reach only the current
SQLite authority, typed protocol, bounded query, mutation, checkpoint,
snapshot, and selective-content surfaces.

The native crate exports no historical store, shell importer, import status,
whole-item staging DTO, checkpoint reference, activation receipt, or overlay
replay surface. The dead shell-based importer and its self-tests are deleted.
The remaining private `HistoricalMigrationSource` can only open the fenced
historical database for one-time migration, provide its connection to that
migration, or erase the held files during normalized factory reset. It cannot
stage or activate another Library authority. Native storage failures use the
general `LibraryCoreStorageError`; no runtime type suggests that a second
Library Core store exists.

Canonical operation verification is owned by the normalized protocol layer,
not by the historical journal. One crate-level verifier parses the original
canonical bytes, closes every payload, reconstructs transaction and actor-chain
digests, checks capability admission, verifies Ed25519 signatures, and returns
sealed normalized operations. Its transaction, envelope, causal-frontier,
entity-ID, operation-ID, and safe-integer limits live in one normalized
protocol-limits module shared with storage admission. Normalized follower and
Primary mutation paths call that verifier directly. Historical atomic
materialization fixtures remain inside the private journal test subtree only
until the historical materializer is deleted.

Canonical enrollment verification is owned by the normalized protocol layer
as well. It parses the original canonical certificate bytes, validates the
accepted authority and observed frontier, derives actor and capability
identities, verifies actor possession and authority signatures, and returns one
sealed normalized enrollment. Actor enrollment, follower enrollment, and the
private historical commit path call this verifier directly. Shared hexadecimal
and operation-ID predicates live with the normalized protocol limits instead
of under the historical journal namespace. Historical enrollment materializer
tests remain private test fixtures only.

Installation-local SQLite writes use a separate generated registry. The four
v1 graph-position programs set or clear one Person or Account position. They
accept one closed bounded DTO, require the entity to exist inside the same
immediate transaction, affect at most one row, and make exact retries no-ops.
They do not require an actor capability because they cannot alter canonical
Library state. They do not advance source revision, append invalidations or
receipts, enter either outbox, or appear in checkpoints. This local registry is
not an escape hatch for product data. Any mutation that should synchronize
belongs in the signed canonical registry above.
