# Library Core Contract

Status: **Approved architecture. Implementation remains dark until each activation gate passes.**

This contract defines Freed's durable library, mutation, query, migration, and
replication behavior. It replaces the assumption that one in-memory Automerge
document can remain the database, search index, sync payload, backup format,
and UI state for an arbitrarily large library.

The objective is a bounded-memory library that preserves every supported
field, converges across devices, survives interruption at every boundary, and
can prove which storage epoch owns a write.

## Non-negotiable outcomes

1. A library larger than available RAM remains usable because reads are paged
   and bounded.
2. One mutation has one durable operation identity. Retrying it never creates a
   second logical mutation.
3. A mutation is not acknowledged until its operation, materialized rows,
   tombstones, local cursor, and outbound replication record commit together.
4. Desktop and PWA converge after offline concurrent edits, duplicate delivery,
   response loss, reordering, and cloud manifest conflicts.
5. A delete cannot resurrect merely because an old or offline device returns.
6. Migration either proves a complete source snapshot at one exact frontier or
   does not cut over.
7. Exactly one active storage epoch accepts authoritative writes. A stale
   process fails closed. An old binary is cryptographically and physically
   fenced into the retired legacy namespace, so any later legacy write is
   orphaned recovery input rather than an active-library mutation.
8. Rollback never invents a state that neither storage engine actually held.
9. Export, snapshot, restore, and import preserve the complete library contract,
   not the currently visible UI projection.
10. Provider extraction and library materialization can be scheduled
    independently. An authenticated provider WebView never needs to coexist
    with a resident full-library renderer document.

## Replacement replication authority

The replacement protocol has one non-expiring designated Freed Desktop writer
epoch per library. The writer may commit canonical local work while offline.
Restarting the same enrolled installation resumes that epoch. There is no
heartbeat, expiring lease, lock file, automatic failover, or last-writer-wins
takeover. At startup, an installation that is not the current writer keeps
Library writes and provider actions disabled and offers one explicit **Make
This Freed Desktop the Writer** action. Confirmation creates a new epoch for
that installation and compare-and-swaps the exact current cloud control tuple.
It does not require the old computer, a pairing ceremony, a readiness receipt,
or a simultaneous two-machine session. A lost-machine restore uses the same
owner-confirmed transition. The previous installation becomes read-only when
it next refreshes authority.

An offline installation may resume local work only when its last durably
verified control tuple names it as writer, and it must show that cloud authority
has not been refreshed. Before cloud publication or provider execution resumes,
it reloads the current tuple. Work created under a retired epoch is preserved
for explicit review or reissue under the current epoch. It is never uploaded,
discarded, or silently merged into active authority.

SQLite is local client storage. No transport may synchronize a live SQLite
database, WAL, SHM, rollback journal, or mutable database replacement. Cloud
transport consists of immutable, content-addressed protocol objects plus the
small flat `freed-v2-control~{library}.json` compare-and-swap pointer. The `~`
separator cannot occur inside any protocol ID, so distinct library, epoch, and
actor tuples cannot collapse to the same locator. One
library has one active authority transport. Google Drive `appDataFolder` is
the current transport. A future Dropbox App Folder adapter uses the same
protocol, but it cannot maintain an independent active pointer. Drive file IDs
are locators. Names and app properties describe objects, but never establish
authority.

PWA installations are intent producers in v1, not canonical writers. Their
required MVP store is a bounded row-oriented IndexedDB adapter. SQLite WASM and
OPFS are not on the MVP critical path. They may be added later behind the same
adapter and conformance suite. The designated Desktop verifies and accepts an
intent into canonical SQLite before publishing an acceptance receipt. Provider
acceptance is separate from provider completion. A PWA cannot display provider
success until the Desktop records the actual provider result.

The package-internal immutable transport contract closes one flat namespace for
epoch and enrollment JSON, checkpoint manifests and pages, canonical operation
segments, PWA intent and result segments, search artifacts, blobs, and backup
manifests. Mutable control, intent-head, and result-head names cannot pass
immutable-object validation. Active sync has no SQLite checkpoint object.
Scrubbed closed SQLite checkpoints belong only to retained backups. The
contract performs no cloud I/O, authority activation, or provider behavior.

Control records, manifests, certificates, and individual signed envelopes use
canonical UTF-8 JSON. Checkpoint, operation, intent, result, and search objects
use a versioned frame of length-prefixed canonical JSON records followed by
gzip. The frame caps one record at 1 MiB, one object at 4,096 records and 32
MiB decoded, and one stored object below 5 MB. Incremental receipt rejects
future versions, wrong families, truncation, trailing bytes, count drift,
oversize records, noncanonical JSON, and duplicate identities. SHA-256 names
the exact stored gzip bytes.

The dormant publication coordinator performs that ordering against an injected
transport adapter. It streams a bounded dependency sequence, requires exact
remote digest and size verification for each object, gives the verified
provider object IDs to the manifest builder, verifies the manifest, and then
builds the control pointer from that verified manifest upload receipt. The
pointer binds the exact manifest descriptor and provider object ID before the
compare-and-swap. It cannot be constructed before the manifest receives its
transport locator, and a substituted locator fails closed. A stale starting
tuple returns before upload. A final CAS race returns the exact current tuple.
Response loss recovers only when readback equals the intended pointer,
including that exact manifest locator. Ordinary publication cannot change the
writer epoch or active cloud transport. Writer reassignment uses a separate
explicit control transition. This coordinator has no Google or Dropbox
dependency, token, polling loop, or production caller.

The dormant Google Drive adapter implements that injected boundary for an
already-provisioned exact control file ID. It discovers controls only through
private protocol, library-digest, and object-kind properties, rejects duplicate
controls, and never treats a filename as authority. Ordinary immutable objects
use a single multipart upload below 5 MB. Each upload is indexed by private
properties for its actual protocol kind, library digest, logical-key digest,
and content digest, then read back through the exact Drive file ID and verified
for byte length and SHA-256. Exact duplicate retries collapse only after every
matching object verifies. Control updates send the exact previously read ETag
as `If-Match`, classify `412` as a race, and read back exact bytes and the new
ETag before reporting commit. All response bodies are bounded while reading.
The same exact-file path can return verified immutable bytes to a dormant
checkpoint consumer. Control bootstrap and large resumable blobs remain
separate. The adapter has no timer, caller, OAuth acquisition, product
registration, or activation path, and the existing Automerge Drive
implementation remains untouched.

The adapter-neutral logical-checkpoint importer starts from one exact immutable
manifest receipt. It verifies the manifest provider object ID, locator, stored
byte length, SHA-256, canonical bytes, closed schema, library, epoch,
generation, dataset schema, causal frontier, total record count, contiguous
page indexes, per-page record counts, binary identity ranges, and exact page
provider object IDs. The canonical manifest is capped at 1 MiB. It then reads
only those page receipts, reconstructs the only valid checkpoint-page locator
for each entry, and decodes at most 128 canonical records, 128 KiB per record,
and 2 MiB total decoded bytes. Page identities must remain strictly increasing
across the complete import and must equal the manifest's first and last
identity for each page. The importer retains only the current bounded page and
the prior identity. Corruption, truncation, duplicate or reordered identities,
locator drift, missing pages, extra pages, count drift, and identity-range
drift fail before finalization. Loose caller-provided page lists or counts
cannot substitute for the authenticated manifest.

The dormant checkpoint producer closes the reverse path. It accepts a bounded
sync or async stream of prepared page objects and uploads only one page at a
time. Before each upload it verifies the contiguous page index, bounded record
count, strict binary identity range, and the exact library, epoch, generation,
page, stored-byte digest, bounded wire frame, record count, and first and last
record identities. It retains only the small manifest declaration for each
uploaded page. Canonical manifest bytes are constructed only after every page
has an exact remotely verified provider receipt, and those exact provider
object IDs are part of the manifest. The coordinator then verifies the
manifest upload and compare-and-swaps the exact manifest receipt into control.
A stale starting control tuple uploads nothing. A later failure can leave
immutable unreachable objects, but it cannot publish a partial checkpoint or
infer authority from their presence.

The registered `library_core_logical_checkpoint_v1` dataset is the complete
portable row-store stream. Record zero is one closed
`logical_checkpoint_header` carrying the library, epoch, schema and codec
versions, authority anchor, promoted receipt digests, materializer frontier
and state digests, and exact count of every logical collection. The remaining
records are closed `logical_checkpoint_entry` values for accepted and
quarantined frontiers, materialized rows, field clocks, relationships,
tombstones, actor states, receipt records, blob roots, and explicit registry
exclusions. Entries carry a contiguous collection-local ordinal. Their wire
identity is the fixed collection order plus that ordinal, while the verifier
also enforces each collection's semantic sort order from the logical
checkpoint contract.

The portable producer validates that stream while retaining at most 128
records, encodes each page through the existing canonical frame and gzip
object, and sends the prepared pages through the exact manifest and control
publication path. The portable importer verifies the authenticated manifest
and every page, stages only bounded pages through an injected row-store
writer, and refuses selection until the writer returns a staging receipt
matching the exact library, epoch, frontier digest, materialized-state digest,
and complete record count. A malformed collection, missing record, reordered
row, header or manifest mismatch, or false staging receipt aborts the staged
import. The writer remains responsible for recomputing semantic commitments
from its staged SQLite or IndexedDB rows before issuing that receipt. This is
the shared interchange path for Desktop SQLite and PWA IndexedDB. It has no
product caller and does not activate replacement replication.

For the MVP, PWA IndexedDB is the primary Library Core row store. SQLite WASM
and OPFS are not release dependencies. A future adapter must pass the same
checkpoint, operation, search, intent, and result conformance suite and rebuild
from immutable objects into a verified fresh generation.

Active Google Drive synchronization remains confined to `appDataFolder`.
Complete off-device daily backups are separate. When Drive backup is enabled,
Freed stores 24 immutable daily generations in a private user-visible
`Freed Backups` folder using the narrow `drive.file` scope, alongside the local
backup directory. Backup generations share content-addressed immutable objects
and include one fresh scrubbed, closed, integrity-checked SQLite checkpoint.
They never copy a live SQLite database or include WAL, SHM, rollback journals,
free pages, stale deleted content, provider sessions, OAuth tokens, or private
actor keys. The plaintext MVP backup contract supersedes the older encrypted
backup-format design below. Application-layer backup encryption remains a
versioned future extension, not an activation requirement.

The first PWA consumer feeds the manifest's verified compact feed-card
projection into the existing resumable IndexedDB generation writer. Exact page
retry reuses that writer's batch receipts. A completed generation still
authenticates the exact manifest, but downloads no checkpoint pages. Selection
occurs only after every manifest page commits. The registered
`library_core_feed_card_projection_v1` dataset is disposable reader state. It
derives its IndexedDB source identity from the exact manifest stored-byte
digest, manifest generation, and manifest schema version. Callers cannot
reattribute verified rows to a different generation. It does not claim to be
the complete portable authoritative Library checkpoint, and it adds no product
caller, cloud polling, provider behavior, writer authority, or Automerge
retirement.

The dormant writer-reassignment coordinator accepts only an exact existing
control revision and pointer, a new bounded writer identity, a new storage
epoch, and an immutable epoch certificate whose locator binds the exact library
and target epoch. It verifies the certificate and every staged dependency
before constructing the target manifest. The target pointer must preserve the
library, active transport, and exact causal frontier while naming generation
zero of the new writer epoch. One exact compare-and-swap is the authority commit
point. A stale tuple uploads nothing, a final race leaves staged objects
unreachable, and response loss recovers only from exact control readback. This
is the transaction beneath **Make This Freed Desktop the Writer**. It has no
product caller and cannot activate itself.

## Canonical bytes, digests, and signatures

Library Core v1 uses UTF-8 JSON Canonicalization Scheme bytes as defined by
RFC 8785. `C(value)` means the exact RFC 8785 byte sequence for `value`.
Library Core accepts only null, booleans, Unicode scalar strings, arrays,
objects, and integers in the inclusive JavaScript safe-integer range.
Fractions, exponent-form inputs, negative zero, unsafe integers, nonfinite
values, `undefined`, sparse arrays, byte arrays, duplicate object names,
invalid Unicode, and unknown fields in a known v1 closed schema are invalid
protocol input. Binary values, digests, public keys, nonces, and signatures use
fixed-length lowercase hexadecimal strings. SHA-256 digests, Ed25519 public
keys, and 32-byte nonces are exactly 64 characters. Ed25519 signatures are
exactly 128 characters. Private keys never enter a canonical value.
Direct canonical values and domain-separated digest or signature inputs have a
maximum nesting depth of 128. The 4 MiB direct-input ceiling includes the
domain prefix, and one value may contain at most 65,536 nodes. A construction
encoder rejects accessors, symbol keys,
non-enumerable properties, non-plain objects, decorated arrays, and cycles
rather than interpreting JavaScript object behavior as protocol data.

Registered fields that contain fractional values do not use JSON numbers in
canonical protocol objects. Their field contract stores a closed
`{ codec: "ieee754_binary64_hex_v1", bits }` value, where `bits` is the exact
16-character lowercase hexadecimal big-endian IEEE 754 binary64
representation. The registry applies field-specific finite ranges for
coordinates, unit-interval scores and confidence, weight multipliers, Story
Wall scale and density, and compatibility graph coordinates. This preserves
every finite legacy value exactly across migration. A nonfinite legacy value is
retained as source evidence and quarantined for a registered repair; it cannot
enter materialized state. A later fixed-point codec is a schema migration, not
an implicit rounding rule.

Canonicalization does not normalize Unicode. A field registry may require
normalization before the value enters the protocol, but a decoder never changes
received text before verification. Optional fields are omitted only when their
schema says they are optional. A required nullable field is present with JSON
null. Omission and null are never interchangeable. Object schemas are closed.
Arrays retain semantic order unless their field definition names an exact sort
order.

An inbound canonical artifact is accepted only when its received bytes equal
`C(parsed_value)` byte for byte. A decoder rejects duplicate names and invalid
Unicode before constructing the parsed value. It does not drop unknown fields
and then verify a reconstructed object. This prevents alternate JSON spellings
from producing a second signed representation of the same apparent value.
The construction encoder is not an inbound verifier. In particular, passing
received bytes through `JSON.parse` before canonicalization is invalid because
that parser has already erased duplicate object names.

The dormant shared and native construction modules include matching bounded
inbound canonical-value parsers. They preserve object-name occurrences until
duplicate rejection, accept only valid UTF-8 and Unicode scalar strings,
enforce the same 4 MiB, 128-level, 65,536-node, and safe-integer ceilings, and
require an exact re-encoding match before returning an immutable value. These
parsers deliberately stop before operation-schema, digest, signature, actor,
and causal validation. They are a prerequisite for an authoritative verifier,
not an activation path or an authority receipt.

An otherwise valid v1 outer operation envelope with an unknown operation type
or payload schema preserves the received canonical payload as opaque evidence,
verifies the outer digests and signature, stops the apply cursor, and does not
interpret or drop payload fields. Unknown outer-envelope fields require a new
protocol version and are rejected by v1.

Library Core v1 fixes canonical encoding to `rfc8785_jcs`, digest algorithm to
`sha256`, and signature algorithm to `ed25519`. Any field named
`signature_algorithm` must contain the literal `ed25519`. Algorithm or encoding
changes require a new protocol version and cannot be negotiated inside v1.
`ed25519` means pure Ed25519 from RFC 8032 with no prehash or context. Verifiers
require canonical compressed public-key and `R` encodings, reject small-order
and noncanonical points, require scalar `S` to be strictly less than the group
order, and reject trailing or alternate encodings. Desktop and PWA use the same
strict acceptance vectors rather than inheriting library-specific permissive
behavior.

For a lowercase ASCII domain label `name`, define:

```text
P(kind, name) = UTF8("freed.library-core.v1/" || kind || "/" || name) || 0x00
D(name, value) = lowercase_hex(SHA256(P("digest", name) || C(value)))
DB(name, bytes) = lowercase_hex(SHA256(P("digest-bytes", name) || bytes))
S(name, private_key, value) = lowercase_hex(
  Ed25519.Sign(private_key, P("signature", name) || C(value))
)
V(name, public_key, value, signature) = Ed25519.Verify(
  hex_decode(public_key),
  P("signature", name) || C(value),
  hex_decode(signature)
)
```

`||` means byte concatenation. Every multi-field digest or signature input is
a closed canonical object, never an ambiguous concatenation of field bytes.
Digest and signature fields are omitted from the body that derives them unless
an equation below explicitly includes a previously derived digest. A derived
value never includes itself.

Canonical digest encoders and decoders process potentially unbounded bodies
incrementally in bounded memory. They do not first allocate the complete JCS
byte string. A direct v1 signature input, including its domain prefix, is
limited to 4 MiB. Any body that can grow with library contents, actor history,
backup history, or an import plan is first committed by its registered digest.
The signature covers only the closed fixed-size digest commitment named by its
equation below. Verification streams the received canonical body to recompute
that digest, requires the received bytes to be canonical, then verifies the
fixed-size commitment. A nonextractable PWA Ed25519 key therefore never
receives an unbounded `SubtleCrypto.sign` input. A body that exceeds a
field-specific body limit is invalid even when its digest and signature are
otherwise valid.

The v1 domain-label registry is closed:

```text
actor-public-key
actor-id
actor-enrollment-body
actor-enrollment-proof
actor-enrollment-certificate
actor-enrollment-authority
actor-retirement-body
actor-retirement-certificate
actor-retirement-authority
operation-payload
operation-signing-body
transaction-member
transaction
actor-chain-genesis
actor-chain
operation-envelope
causal-frontier
blob-content
materialized-key
materialized-row
materialized-leaf
materialized-branch
materialized-state
segment-body
segment-encoded
manifest
manifest-auth
manifest-genesis-authority
authenticated-object-set-node
compaction-proof
compaction-receipt
repair-plan
repair-receipt
epoch-transition-certificate
genesis-closure
genesis-verified-object-entry
genesis-verified-object-set
backup-recovery-delegation
backup-registration-descendant-proof
backup-recovery-envelope
backup-recovery-possession
backup-bundle
active-recovery-capabilities
spent-recovery-redemptions
recovery-capability-change
recovery-capability-change-authority
authority-key
authority-key-possession
legacy-epoch-bootstrap-record
automerge-source
automerge-heads
migration-source-set
migration-candidate-claim
migration-candidate-claim-authority
legacy-source-admission-claim
legacy-source-admission-claim-key
legacy-source-admission-key
migration-claim-history-entry
migration-claim-operation-grant
migration-claim-operation-grant-consumption
migration-claim-source-attempt
migration-claim-source-commit-admission
migration-claim-source-commit-admission-authority
migration-claim-abandonment
migration-claim-abandonment-authority
migration-claim-cleanup
migration-claim-cleanup-authority
migration-candidate
migration-candidate-registration
migration-candidate-registration-authority
migration-source-contributor-body
migration-source-contributor-certificate
migration-source-contributor-proof
migration-source-contributor-authority
migration-local-source-contribution
migration-local-source-contribution-signature
migration-claim-source-revocation
migration-claim-cleanup-proof
migration-recovery-supersession
migration-recovery-supersession-target
migration-candidate-object-registry
migration-candidate-object-registry-entry
migration-candidate-staging-census-entry
migration-candidate-staging-census
migration-staging-disposition-receipt
migration-staging-disposition-receipt-authority
migration-staging-disposition-set
migration-recovery-gc
migration-recovery-gc-authority
migration-source-fence-reservation
migration-source-fence-activation
admission-fence-token
source-admission-fence-entry
source-admission-fence-set
transition-finalization-sidecar-entry
transition-finalization-sidecar
rollback-source-fence-reservation
rollback-source-fence-reservation-authority
rollback-source-fence-activation
rollback-source-fence-activation-authority
reader-content-lookup-plan
reader-content-lookup-plan-entry
reader-content-probe-outcome
reader-content-probe-outcome-set
reader-content-source-root-binding
reader-content-source-manifest
reader-content-source-entry
backup-registration-descendant-entry
migration-batch
migration-prepared-proof
migration-proof
migration-receipt
rollback-candidate
rollback-prepared-proof
rollback-proof
rollback-receipt
legacy-occurrence
checkpoint
live-root-set
backup-file-plaintext
backup-file-ciphertext
backup-file-ciphertext-chunk
backup-container
chunked-object-root
backup-operation-segment-set
backup-inventory-page
backup-inventory-root
backup-manifest
backup-manifest-ciphertext
media-vault-source-manifest
media-vault-source-entry
media-vault-exclusion
media-vault-exclusion-authority
media-vault-inherited-exclusion
media-vault-inherited-exclusion-authority
media-vault-backup-snapshot
media-vault-target-manifest
media-vault-restore-intent
media-vault-restore-plan
media-vault-fence-abort
restore-preparation
restore-staging
import-source
import-plan
import-disposition
import-source-disposition-evidence
import-provenance-object-set
import-source-semantic-atom
import-target-semantic-atom
import-semantic-atom-set
import-emission-set
import-emitted-transaction-set
import-generated-provenance-set
import-execution-receipt
import-execution-receipt-authority
import-receipt
import-receipt-authority
import-abandon
import-abandon-authority
```

The registry is append-only. A later gate may add a label only through a
contract amendment and independent cross-runtime public vector before any
artifact uses it. Changing or reusing an existing label for a different shape
requires a protocol-version change.

Large canonical protocol objects use one storage contract:

```text
chunked_object_root_body = {
  artifact_kind:
    "reader_content_source_manifest" |
    "media_vault_source_manifest" |
    "media_vault_snapshot" |
    "media_vault_restore_plan" |
    "checkpoint" |
    "compaction_proof" |
    "genesis_closure" |
    "repair_plan" |
    "import_plan" |
    "migration_prepared_proof" |
    "migration_proof" |
    "migration_claim_cleanup_proof" |
    "rollback_prepared_proof" |
    "rollback_proof" |
    "migration_opaque_evidence" |
    "import_provenance_evidence" |
    "content_blob" |
    "media_vault_file",
  artifact_digest,
  canonical_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

chunked_object_root_digest = D(
  "chunked-object-root",
  chunked_object_root_body
)
```

`chunks` contains closed
`{ index, plaintext_offset, plaintext_byte_length, content_digest }` entries in
contiguous index order. Every non-final chunk is exactly 67,108,864 bytes, the
final chunk is the exact positive remainder, and an empty artifact has one
zero-byte chunk. There are at most 1,000,000 chunks. Offsets and lengths
partition `canonical_byte_length` without overlap or gap. Their exact
concatenation is the canonical artifact bytes, and each `content_digest`
recomputes as `DB("blob-content", chunk_bytes)`. The concatenation is exact
artifact bytes. For `reader_content_source_manifest`, `artifact_digest` is
`D("reader-content-source-manifest", reader_content_source_manifest_body)`.
For `media_vault_source_manifest`, `artifact_digest` is
`DB("media-vault-source-manifest", concatenated_bytes)`. For `content_blob`,
`media_vault_file`, `migration_opaque_evidence`, and
`import_provenance_evidence`, `artifact_digest` is
`DB("blob-content", concatenated_bytes)`. For the other twelve kinds, the bytes
are the canonical `C(media_vault_snapshot_body)`,
`C(media_vault_restore_plan_body)`, `C(logical_checkpoint_body)`,
`C(compaction_proof_body)`,
`C(genesis_closure_body)`, `C(repair_plan_body)`, `C(import_plan_body)`,
`C(migration_prepared_proof_body)`, `C(migration_proof_body)`,
`C(migration_claim_cleanup_proof_body)`,
`C(rollback_prepared_proof_body)`, or `C(rollback_proof_body)` bytes and
`artifact_digest` recomputes through that body's registered domain. The
artifact-specific `*_storage_root_digest` is exactly
`D("chunked-object-root", chunked_object_root_body)`, and its
`*_byte_length` is exactly `canonical_byte_length`. A mismatched kind, logical
digest, storage root, length, chunk entry, or reconstructed byte stream is
invalid.

The root object and every chunk are immutable reachable roots. A resolver
verifies the root, every chunk length and digest, the concatenated bytes, and
the artifact digest before parsing. Portable storage contains one
`chunked_object_root` protocol object for each named storage-root digest and
one `chunked_object_chunk` payload for every distinct chunk entry required by
those roots. A root entry's canonical plaintext is
`C(chunked_object_root_body)` and its protocol-object digest is the root
digest. A chunk entry's plaintext is the exact chunk bytes and its
content digest is the root entry's exact `content_digest`. Within one role,
one digest has exactly one encrypted file. Equal bytes used by an ordinary
library blob and by a chunk may occupy one entry in each role; neither role can
substitute for the other during verification.

The portable root path is
`proof/chunked-roots/<chunked_object_root_digest>.jcs`. A distinct chunk path
is
`proof/chunked-payloads/<content_digest>-<plaintext_byte_length>.bin`.
Decoded digests and canonical decimal lengths select the path. A root or chunk
at any other path, two different objects at one path, or one digest paired with
different lengths is invalid.

The canonical root body is capped at 256 MiB and each chunk at 64 MiB, so every
piece fits the 16 GiB backup-file limit. A larger artifact is rejected before
mutation unless a later protocol version raises the root or chunk-count bound.
No receipt or checkpoint embeds the root body or chunk list. It commits only
the fixed-size artifact digest, storage-root digest, and canonical byte length.

Collections that must remain writable when their total membership exceeds one
manifest page use one persistent authenticated radix-set contract. The
protocol never serializes the complete collection into a signed control
record:

```text
authenticated_object_set_root_body = {
  format: "freed_authenticated_object_set_v1",
  set_kind,
  entry_count,
  root_node_digest
}

authenticated_object_set_node_body = {
  format: "freed_authenticated_object_set_node_v1",
  set_kind,
  depth,
  entry_count,
  node_kind: "branch" | "leaf",
  children,
  entries
}

authenticated_object_set_node_digest = D(
  "authenticated-object-set-node",
  authenticated_object_set_node_body
)
```

`set_kind` comes from the closed field-specific registry where the set is
defined. Each entry schema defines one closed `sort_key` and one canonical
`entry_body`. The 256-bit routing key is
`D("authenticated-object-set-node", { set_kind, sort_key })`. Branch depth is
between zero and 63. A branch has an empty `entries` array and between one and
16 unique children, each closed
`{ nibble, child_digest, entry_count }`, sorted by numeric nibble. A leaf has
an empty `children` array and one or more entries whose routing keys share all
64 nibbles. Its entries are sorted by bytewise `C(sort_key)`, and each stores
the full sort key, entry body, and field-specific entry digest. Verifiers
recompute routing keys, entry digests, counts, and every child digest. A
duplicate sort key with unequal bytes is a conflict. Exact duplicate entries
collapse to one set member.

Every node is at most 4 MiB and 4,096 entries or child descriptors. A
cryptographic full-routing-key collision that cannot fit one leaf is invalid
input and does not permit silent omission. The root has a null node digest
exactly when the count is zero. Insertion, replacement, and removal rewrite at
most one 64-node path. They never materialize the full set. Iteration uses
bounded traversal or external merge and applies the field-specific canonical
sort independently of routing order.

The initial registered `set_kind` values are
`manifest_live_segments`, `manifest_retained_history`,
`manifest_accepted_actor_tips`, `manifest_quarantined_branch_tips`,
`manifest_snapshot_checkpoints`, `manifest_checkpoint_promotions`,
`manifest_compaction_receipts`, `manifest_actor_enrollments`,
`manifest_actor_retirements`, `migration_claim_history`,
`reader_content_lookup_plan`, `reader_content_probe_outcomes`,
`migration_candidate_objects`,
`migration_candidate_staging_census`,
`migration_candidate_dispositions`,
`migration_source_fence_dispositions`, and
`backup_registration_descendants`. A later set kind requires a contract
amendment and public cross-runtime vectors. Portable backup, genesis, restore,
and import retain every reachable set node by its digest. An offline actor or
large corpus may delay physical garbage collection, but collection size alone
never blocks a new manifest, claim abandonment, cleanup, or ordinary write.

The v1 operation-ID codec is a nonempty ASCII string of at most 128 bytes
matching `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. A newly generated operation ID
contains at least 128 bits of cryptographic randomness; an imported legacy ID
must still match the same syntax. Canonical comparison is bytewise ASCII.
An operation ID is null only where a closed schema explicitly permits null.
Every retry of one logical operation reuses the exact ID, while a different
logical operation always uses a new ID. `transaction_id`,
`fence_acquire_operation_id`, `export_operation_id`, and every field named
`*_operation_id` use this codec unless a closed schema explicitly fixes that
field to another already registered opaque identifier.

The dormant shared protocol-scalar module is the executable source for the
64-character lowercase hexadecimal, operation-instance-ID, entity-ID, and
nonnegative-safe-integer syntax checks. A v1 entity ID is a nonempty Unicode
scalar string whose UTF-8 encoding is at most 4,096 bytes. It is not normalized.
The validator counts bytes without allocating an encoded copy and rejects lone
UTF-16 surrogates. The legacy epoch bootstrap validator consumes the shared
fixed-width and numeric predicates instead of carrying a second regex or
numeric interpretation. Passing a scalar predicate proves only the encoded
shape. Randomness, digest derivation, signature validity, authority, and
field-specific semantics remain separate checks.

The v1 `feed_item_read_assignment` payload schema is the exact closed object
`{ read_at_ms }`. `read_at_ms` is a nonnegative safe integer, including zero
and excluding negative zero. Unknown, missing, accessor, symbol, inherited, or
non-data fields are invalid. Validation returns an immutable snapshot rather
than retaining the caller's object. The operation registry also binds this
operation to the shared v1 entity-ID codec. Every other dormant operation
retains a typed `entity_id_schema_unresolved` blocker until its exact key syntax
is bound. The read assignment also binds its sole touched field to
`library-core-v1:feedItems.{globalId}.userState.readAt`. These contracts close
payload syntax, entity-key syntax, and the touched-field set only. Entity
existence, SQLite materializer, provider-intent separation, and runtime
authority remain blocked. `readAt` uses the executable
`minimum_present_nonnegative_safe_integer_v1` algebra: absence means unread,
the first assignment establishes the value, and duplicate, reordered, or
concurrent assignments retain the earliest valid timestamp. Invalid current or
incoming values fail closed. The payload does not itself schedule or authorize
a provider-visible seen action.

The dark native projection may apply a validated read assignment through one
column-local SQLite update. It reads and validates the current projected
`readAt`, applies the same minimum-present algebra, updates only `readAt`,
advances the projection revision, and writes the existing derived projection
batch receipt in one immediate transaction. A missing entity, malformed current
value, stale revision, changed replay tuple, or receipt failure rolls back
without widening the update to a full row. Exact response-loss retry returns
the original projection receipt. This is still derived projection maintenance.
It stores no authoritative operation, grants no write authority, and has no
production caller.

The first closed transaction-member construction schema is limited to
`feed_item_read_assignment`. It snapshots a closed input, binds exact v1
library, epoch, actor, transaction, entity, payload, HLC, and causal-frontier
fields, derives the payload and member digests through the registered domains,
requires empty blob references, and emits the exact member body that omits
`previous_actor_chain_digest`, `actor_chain_digest`, `transaction_digest`, and
`signature`. Its causal frontier contains at most 4,096 strictly sorted unique
tips. This closes only construction of one transaction member. Transaction
aggregation, actor-chain derivation, signature encoding and verification,
inbound envelope verification, authoritative journaling, materialization,
outbox insertion, and runtime authority remain blocked.

The next construction phase accepts only a dense array of closed member
constructions. It requires 1 through 1,000 members, at most 4 MiB of canonical
member bytes, one exact library, epoch, actor, and transaction identity,
contiguous indexes, contiguous actor sequences, unique operation IDs, and
exact previous-operation links. It derives the aggregate transaction digest,
then each actor-chain digest in member order, then each signing-body digest.
The result remains unsigned and unpersisted. It is not an inbound verifier and
does not advance any actor, transaction, materializer, receipt, or outbox.

Canonical sets use their field-specific sort before `C`. `causal_frontier`
sorts ascending by `(actor_id, sequence, operation_id, chain_digest)`,
comparing numeric sequence numerically and the remaining ASCII identifiers
bytewise. It rejects duplicate exact tips and more than one accepted
incompatible tip for one actor. `blob_references` sorts ascending by
`(content_digest, byte_length, encoding, media_type)`, compares byte length
numerically and the remaining ASCII fields bytewise, and rejects duplicate
exact references. Transaction members sort only by contiguous
`transaction_member_index`; no implementation may reorder them by operation ID
or digest.

Every field described as a set, union, census, roots, references, receipts,
mappings, or acknowledgments is invalid unless its field registry specifies an
exact tuple sort. `observed_frontier` and accepted or quarantined tips use the
`causal_frontier` order. Digest-only sets sort by decoded digest bytes. Actor
censuses sort by actor ID, enrollment-certificate digest, then retirement
digest, with null sorting before a digest. Checkpoints sort by frontier digest,
then checkpoint digest. Receipt sets sort by receipt type, then receipt digest.
Acknowledgments sort by actor ID, then the exact causal-tip tuple.

Before a later gate implements a signed `certificate_body`, `segment_body`,
`manifest_body`, `compaction_receipt_body`, `delegation_body`, or other named
artifact, this contract must define its exact closed snake-case object schema,
field types, nullability, bounds, and canonical sort rules. An implementation
cannot infer signed field names or nesting from an English list.

Gate B publishes hand-reviewed public vectors containing the exact canonical
bytes, digests, public keys, and signatures for every v1 purpose used by that
gate. Desktop and PWA verify the same checked-in expected bytes independently.
One implementation must not generate expected values at test runtime for the
other implementation to bless.

## Authority and epochs

Every installation stores one `library_control` record:

| field                     | meaning                                                                           |
| ------------------------- | --------------------------------------------------------------------------------- |
| `format`                  | Exact literal `freed_library_control_v1`                                          |
| `library_id`              | Stable opaque library identity                                                    |
| `installation_id`         | Stable identity for this installation                                             |
| `active_epoch`            | Monotone storage epoch number                                                     |
| `active_epoch_id`         | Globally unique opaque incarnation for that epoch                                 |
| `active_engine`           | `automerge_legacy` or `library_core_v1`                                           |
| `schema_version`          | Materialized schema version                                                       |
| `replication_protocol`    | `automerge_blob_v1` or `op_segments_v1`                                           |
| `frontier_digest`         | Digest of the accepted causal frontier                                            |
| `bootstrap_record_digest` | Required only by the legacy bootstrap form; names its synchronized TOFU record    |
| `authority_key_id`        | Required only after authenticated Library Core authority exists                   |
| `transition_digest`       | Required only after an authenticated epoch transition exists                      |
| `updated_by_operation_id` | Operation that changed this local control                                         |
| `migration_claim_pointer` | Null or the current typed local migration lifecycle pointer                       |
| `storage_generation`      | Nonnegative local storage-incarnation generation interpreted by the active engine |
| `local_access`            | Installation-local creator, read-only adopter, or later authenticated actor mode  |

The exact control body is an engine-specific closed union. The legacy bootstrap
form contains `bootstrap_record_digest` and `local_access`, but omits
`authority_key_id` and `transition_digest`. The authenticated Library Core form
contains authority and transition fields under its later closed contract. An
implementation never fills an inapplicable authority field with a synchronized
self-assertion.

Every read, write, migration receipt, snapshot, outbox entry, and replication
manifest carries `library_id`, `active_epoch`, and `active_epoch_id`. A process
that loaded an older epoch cannot produce an accepted current-epoch operation
or authenticated manifest. It may retain local orphan edits. Epoch advancement
is an atomic local transaction following one globally committed protocol
transition. It is never inferred from the presence of files.

The legacy installation receives one bootstrapped epoch through an explicit,
durable initialization transaction. The value is chosen once and read back.
Migration code must not guess an epoch, infer one from a database file, or
silently replace an existing control record.

The bootstrap is a separate dormant protocol before Library Core activation.
One explicit local owner action chooses the creator installation and durably
prepares one exact operation journal. Startup absence never chooses a creator.
A synchronized Automerge value cannot prove that the owner approved it because
every current legacy writer can create synchronized values. The protocol
therefore stores a bootstrap record, not an authority certificate.

The closed synchronized record is:

```text
legacy_epoch_bootstrap_record_body = {
  format: "freed_legacy_epoch_bootstrap_record_v1",
  library_id,
  creator_installation_id,
  active_epoch: 1,
  active_epoch_id,
  active_engine: "automerge_legacy",
  schema_version,
  replication_protocol: "automerge_blob_v1",
  source_heads_body: {
    heads
  },
  source_heads_digest,
  bootstrap_operation_id,
  trust_model: "tofu_read_only_until_authenticated_pairing",
  migration_claim_pointer: null
}

legacy_epoch_bootstrap_record_digest = D(
  "legacy-epoch-bootstrap-record",
  legacy_epoch_bootstrap_record_body
)

legacy_epoch_bootstrap_record = {
  record_body: legacy_epoch_bootstrap_record_body,
  record_digest: legacy_epoch_bootstrap_record_digest
}
```

`library_id`, `creator_installation_id`, and `active_epoch_id` are independent
32-byte random values encoded as 64 lowercase hexadecimal characters.
`bootstrap_operation_id` uses the bounded v1 operation-ID codec.
`schema_version` is zero or one. `heads` contains 1 through 65 unique
pre-bootstrap Automerge heads, encoded as 64 lowercase hexadecimal characters
and sorted by decoded bytes. Every supported Freed document has at least one
head because document creation uses `Automerge.from` with the required root
shape. A raw zero-head `Automerge.init` value is not a supported Freed document.
`source_heads_digest` recomputes as
`D("automerge-heads", { heads })`.

The record deliberately has no authority key, signature, or proof of owner
consent. A key created and signed by the same app process would prove only that
the app possesses the key it just created. It would not authenticate the owner
or another installation. The future Library Core authority key remains
unprovisioned until a real user-present or authenticated authority-holder
protocol exists.

The record synchronizes inside the existing Automerge document under exactly
`libraryCoreLegacyBootstrapRecord:<record_digest>`. It adds no cloud sidecar,
provider object, request, or cadence. Readers must complete one closed scan of
the entire current reserved root namespace and every Automerge conflict value,
plus the complete historical set of reserved root keys:

```text
legacy_epoch_bootstrap_scan = {
  format: "freed_legacy_epoch_bootstrap_scan_v1",
  scan_complete,
  history_scan_complete,
  overflow,
  reserved_root_key_count,
  occurrence_count,
  occurrences: [{
    root_key,
    conflict_value
  }],
  historical_root_key_count,
  historical_root_keys
}
```

The scan accepts at most 65 current reserved root keys, 65 current
occurrences, and 65 unique historical reserved root keys. It checks those
counts before allocation. `historical_root_keys` is the unique byte-sorted set
of every reserved root key ever written in the accepted Automerge change
graph, including keys that are currently deleted. The future scanner must
derive that set with bounded streaming change inspection. It must not
materialize every historical document snapshot.

An incomplete current or historical scan is not absence. Overflow is a
distinct resource-limit failure. Every current root suffix must equal the
recomputed record digest. Every historical root must still have a current
valid occurrence, and every current root must appear in history. A deleted or
tombstoned record therefore blocks as `record_history_violation` instead of
becoming a fresh library. Exact duplicates collapse to one logical record.
Two unequal valid records remain preserved and block as
`multiple_record_conflict`.

The installation-local control body is:

```text
library_control = {
  format: "freed_library_control_v1",
  library_id,
  installation_id,
  active_epoch: 1,
  active_epoch_id,
  active_engine: "automerge_legacy",
  schema_version,
  replication_protocol: "automerge_blob_v1",
  frontier_digest,
  bootstrap_record_digest,
  updated_by_operation_id,
  migration_claim_pointer: null,
  storage_generation,
  local_access:
    "creator_local_owner_confirmed" |
    "adopter_tofu_read_only"
}
```

The creator mode is valid only with the matching prepared journal and complete
transaction receipt. A synchronized record cannot recreate either local
object. An adopter may pin the record into local control only with
`adopter_tofu_read_only`. That mode cannot produce accepted writes. Writable
adoption remains blocked until a separate authenticated pairing binds the
record digest, both installation identities, a fresh actor key, a challenge,
and a real authority-holder or user-present proof. Ordinary sync bytes,
self-signatures, copied credentials, and an in-document key cannot satisfy
that pairing.

The explicit owner action creates this local prepared journal once:

```text
legacy_epoch_bootstrap_prepared_body = {
  format: "freed_legacy_epoch_bootstrap_prepared_v1",
  phase: "prepared",
  bootstrap_operation_id,
  creator_installation_id,
  source_storage_generation,
  target_storage_generation,
  source_save_revision,
  candidate_save_revision,
  source_binary_digest,
  candidate_binary_digest,
  source_heads_digest,
  candidate_heads_body,
  candidate_heads_digest,
  record,
  record_digest,
  record_root_key,
  candidate_control,
  candidate_control_digest
}

legacy_epoch_bootstrap_prepared_digest = D(
  "legacy-epoch-bootstrap-prepared",
  legacy_epoch_bootstrap_prepared_body
)
```

The source and target storage generations are equal because bootstrap does not
replace the storage incarnation. `candidate_save_revision` is exactly
`source_save_revision + 1`. The candidate binary and head digests differ from
the source digests. The candidate control is the exact creator control at the
candidate frontier. Candidate bytes live in bounded local staging addressed by
the operation ID and binary digest. The pure classifier receives digests and
closed control values, not a second unbounded document copy.

The transaction receipt is:

```text
legacy_epoch_bootstrap_receipt_body = {
  format: "freed_legacy_epoch_bootstrap_receipt_v1",
  bootstrap_operation_id,
  prepared_digest,
  record_digest,
  creator_installation_id,
  source_storage_generation,
  committed_storage_generation,
  source_save_revision,
  committed_save_revision,
  source_binary_digest,
  committed_binary_digest,
  source_heads_digest,
  committed_heads_digest,
  control_digest
}

legacy_epoch_bootstrap_receipt_digest = D(
  "legacy-epoch-bootstrap-receipt",
  legacy_epoch_bootstrap_receipt_body
)
```

The digest graph is acyclic. The record is digested first, then the candidate
control, then the prepared operation, then the receipt. No earlier object
contains the receipt digest.

Prepared validation proves that the candidate frontier descends from the exact
source frontier. The future executable adapter must also load the staged bytes
named by `candidate_binary_digest`, verify that they yield the bound candidate
heads, and verify the record occurrence before compare-and-swap. The dormant
classifier receives digests and heads rather than candidate bytes, so it does
not pretend to prove bytes it never reads.

The future executable transaction compare-and-swaps the exact storage
generation, save revision, source binary digest, and source heads. It then
writes the candidate document, creator control, completion receipt, retained
prepared journal, and next save revision in one local transaction. The receipt
completes that exact journal. A live owner action is required only to create
the prepared journal. Exact retry after process loss or response loss reads the
same prepared or committed objects by operation ID and never asks again,
regenerates identities, or rebases an old approval onto changed source bytes.
A changed source requires explicit abandonment and a fresh owner action.

The pure classifier states are:

| state                      | required interpretation                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `absent`                   | Complete current and historical scans found no record root, and no local journal, receipt, or control exists. Do nothing.                                                          |
| `creator_prepared`         | One exact local prepared operation matches the current generation, revision, binary, heads, and schema. The later transaction may attempt its one compare-and-swap.                |
| `creator_committed`        | The prepared operation, synchronized record, creator control, and receipt describe one complete transaction. Later saves preserve the committed candidate frontier as an ancestor. |
| `adopter_record_unpinned`  | One valid synchronized record exists without local control. It grants no write authority.                                                                                          |
| `adopter_tofu_read_only`   | One valid record and matching local TOFU control exist. Reads may continue. Writes remain blocked pending authenticated pairing.                                                   |
| `prepared_source_changed`  | The source generation, revision, binary, heads, or schema changed after preparation. Do not rebase the old action.                                                                 |
| `record_history_violation` | A historical reserved root is no longer current, or a current root is missing from complete history. Preserve evidence and block rebootstrap.                                      |
| `mismatched_or_corrupt`    | A shape, digest, identity, frontier, transaction member, generation, or partial local tuple is inconsistent. Block without repair.                                                 |
| `multiple_record_conflict` | More than one unequal record exists. Preserve every occurrence and block without selecting a winner.                                                                               |
| `incomplete_scan`          | Reserved-namespace enumeration did not complete. Do not interpret omitted values as absence.                                                                                       |
| `resource_limit_exceeded`  | A bounded heads or occurrence limit was exceeded. Stop before allocation or mutation.                                                                                              |
| `unsupported_newer`        | A later record, journal, receipt, control, epoch, schema, engine, or protocol is present. Preserve it and block.                                                                   |

Only the wholly prepared tuple or wholly committed tuple is recoverable.
Document-only, control-only, receipt-only, and every other partial combination
are corruption. No isolated local control row is recovery authority.

The prepared candidate and exact first commit use the bootstrap operation ID
as `updated_by_operation_id`. A later ordinary save or a local TOFU pin uses
its own bounded local operation ID. The bootstrap operation is immutable in
the synchronized record, but current local-control provenance is not falsified
to look like the bootstrap action forever.

Trusted history compaction and compatibility rebuilds must preserve the record
roots and their Automerge ancestry exactly. The current Desktop `A.toJS()` then
`A.from()` compatibility rebuild discards that ancestry. A2 must fence the
value-only path after a record exists or replace it with a proven
history-preserving transition before bootstrap activation. Lost ancestry is
corruption, not permission to prepare another record.

Every decoder snapshots each closed input field and bounded nested array once
into new immutable plain values before digest, ancestry, or state evaluation.
It never return-casts an untrusted object, retains an input array by reference,
or rereads a getter or proxy after validation.

The local journal and receipt provide exact operation recovery on one
installation. They do not claim rollback resistance if an attacker can restore
the entire device state. Strong rollback resistance requires a hardware,
server, passkey, or other external monotonic anchor and remains outside A1.

For a library with no cloud authority record, `library_control` is also the
single durable local claim compare-and-swap record. Its
`migration_claim_pointer` uses the same typed pointer schema and immutable
lifecycle objects defined below. Claim publication, abandonment, transition,
and response-loss resolution each commit or compare that field in the same
local authority transaction as every other affected control field. A local
claim never expires by wall clock. It remains authoritative only while its
exact pointer is current and must be explicitly abandoned or consumed by the
winning local transition. Reopening `library_control` is the response-loss
readback. A local process generation, lock, temporary file, or elapsed time
cannot replace this durable state.

The cloud authority for one library is one compare-and-swap state record:

```text
{
  library_id,
  transition_certificate_digest,
  manifest_digest,
  manifest_auth_digest,
  manifest_generation,
  active_recovery_capabilities_digest,
  recovery_capability_change_pointer,
  spent_recovery_redemptions_digest,
  migration_claim_pointer
}
```

`recovery_capability_change_pointer` is either null or the closed object
`{ kind, digest }`, where `kind` is exactly
`capability_change_certificate` or `recovery_transition_certificate`. Null is
valid only while the active and spent sets are empty and no capability change
has occurred; ordinary manifests and transitions may preserve that null
genesis chain.
`migration_claim_pointer` is null or the closed
`{ kind: "candidate_claim" | "claim_abandonment", digest,
claim_history_root }` object. `claim_history_root` is the exact
`authenticated_object_set_root_body` with set kind
`migration_claim_history`. Null is valid only before the first claim or after a
completed Automerge migration transition. A claim-lifecycle compare-and-swap
may replace only this field while preserving every other cloud authority field
byte for byte. The immutable claim or abandonment object is fetched and
verified by that digest, and the history root contains its exact lifecycle
entry plus every predecessor.

The history entry is root-free and immutable:

```text
migration_claim_history_entry_body = {
  format: "freed_migration_claim_history_entry_v1",
  library_id,
  claim_revision,
  lifecycle_selector: {
    kind: "candidate_claim" | "claim_abandonment",
    digest
  },
  predecessor_lifecycle_selector,
  lifecycle_object_digest
}

migration_claim_history_entry_digest = D(
  "migration-claim-history-entry",
  migration_claim_history_entry_body
)
```

`lifecycle_object_digest` equals the selector digest. The selector resolves one
immutable signed claim or abandonment object. The predecessor selector is null
only for revision one and otherwise equals that object's root-free predecessor
selector. The authenticated set entry sort key is
`(claim_revision, lifecycle_selector.kind, lifecycle_selector.digest)`.
Neither the entry nor lifecycle object embeds the resulting history root, the
full typed pointer, or cleanup that may be registered later. The compound
pointer wraps the completed root outside the set. Cleanup is resolved only
through its immutable abandonment registry and a successor claim's exact
`predecessor_claim_cleanup_digest`.

Ordinary manifest publication preserves the field. An Automerge migration
transition requires the final candidate-claim pointer and clears the field in
the same winning authority transaction. Other ordinary transitions reject an
active `candidate_claim` and preserve null or the exact abandonment pointer.
A one-use same-library recovery transition may instead consume any exact
non-null migration lifecycle pointer and clear it while advancing the epoch and
authority key under the recovery-delegation protocol below. The transition
certificate binds that exact previous pointer and the canonical
`migration_recovery_supersession` proof defined under recovery. The new epoch
makes every candidate write, source fence, and staging commit under the old
lifecycle ineligible.
An ordinary transition that preserves an abandonment pointer requires its
registered cleanup object to be complete and verified first. Key-loss recovery
may consume a candidate or abandonment pointer without distributed cleanup
because its new epoch supplies the authority fence. Its distinct supersession
proof, not a nonexistent abandonment cleanup, becomes the portable historical
closure for that consumed pointer.

The immutable transition certificate and manifest are addressed by the
content and authentication digests in that record. A normal manifest
publication may replace only `manifest_digest`, `manifest_auth_digest`, and
`manifest_generation`, and only while the transition, active-recovery,
recovery-capability-change pointer, spent-redemption digest, and
migration-claim pointer remain exact. A transition publication atomically
replaces the transition digest, installs its target genesis manifest content
and authentication object, and preserves or advances the authenticated active
recovery and spent-redemption roots. It succeeds only while the previous
transition digest, source manifest digest, source manifest-auth digest, source
manifest generation, active-recovery digest, recovery-capability-change pointer,
spent-redemption digest, and applicable migration-claim pointer all remain
exact. There is no
independent authority-pointer or redemption write that can race a manifest or
transition write.

Library genesis uploads and reads back the immutable
`active_recovery_capabilities_body` and
`spent_recovery_redemptions_body` for empty sets before it installs the initial
cloud authority record. Its initial `recovery_capability_change_pointer` is
null and its initial `migration_claim_pointer` is null. Every later
authority tuple therefore names fetchable canonical bodies, including when no
recovery or migration claim exists.

The immutable `epoch_transition_certificate` includes:

- library ID;
- previous epoch number, epoch ID, transition-certificate digest, manifest
  digest, manifest-auth digest, manifest generation, active-recovery digest,
  recovery-capability-change pointer, spent-redemption digest, and
  migration-claim pointer, plus the branch-qualified causal frontier;
- target epoch number and a globally unique epoch ID;
- target engine, schema, and replication protocol;
- target epoch genesis anchored to the previous accepted frontier;
- exact target genesis manifest digest;
- target genesis-closure digest, chunked storage-root digest, and byte length
  covering every required remote blob, segment, checkpoint, canonical manifest
  body, target active-recovery body, and target spent-redemption body, plus the
  complete proof closure of every target active recovery capability and, when
  present, the target media-vault restore-plan logical digest, chunked storage
  root, every root chunk, and target media-vault manifest, while excluding the
  transition-dependent manifest authentication object and transition
  certificate. For migration and rollback, the closure additionally excludes
  the current activation sidecar, final proof, receipt, and applicable cutover
  grant and consumption. The transition certificate binds those
  dependency-later objects directly;
- exact source and target enrolled-actor censuses;
- the applicable registered migration, rollback, or repair receipt digest,
  with every inapplicable receipt field null;
- for Automerge migration only, the exact cutover operation ID, cutover payload
  body and digest, operation-grant body, digest and authority signature, and
  grant-consumption body and digest, with every cutover-admission field null for
  every other transition reason. These bodies are embedded in the certificate,
  which the genesis closure deliberately excludes, so the payload may bind the
  genesis-closure digest without a cycle;
- final source admission-fence token digests and captured generations when
  migration, rollback, or restore has source authorities to fence. Bearer
  tokens remain only in source-private crash-recovery state;
- for Automerge migration and rollback, the exact finalization-sidecar digest,
  canonical byte length, and object count repeated by the applicable receipt
  and certificate, and by the migration cutover payload when applicable. The
  sidecar, receipt, and transition are persisted by the same winning authority
  compare-and-swap;
- transition reason and recovery delegation digest when applicable;
- required nullable migration-recovery-supersession digest;
- required nullable import execution-receipt digest;
- required nullable restore operation ID and restore staging digest;
- target active-recovery digest;
- target spent-redemption digest;
- target migration-claim pointer;
- signing authority key ID;
- target authority public key; and
- recomputed target authority key ID.

`transition_reason` is exactly `library_genesis`, `automerge_migration`,
`schema_upgrade`, `authority_rotation`, `rollback`, `actor_fork_repair`,
`clock_quarantine_repair`, or `same_library_recovery`. For
`same_library_recovery`,
`restore_operation_id` and `restore_staging_digest` are non-null and equal the
exact verified staging object promoted by this transition. For every other
reason both fields are null. Partial presence or a staging object whose library,
epoch, frontier, checkpoint, or backup identity differs from the certificate
is invalid.

For `automerge_migration`, `migration_receipt_digest` is required and
`rollback_receipt_digest` and `repair_receipt_digest` are null. For `rollback`,
`rollback_receipt_digest` is required and the other two are null. For
`actor_fork_repair` or `clock_quarantine_repair`,
`repair_receipt_digest` is required and the other two are null. The receipt's
`repair_kind` equals the transition reason byte for byte. Every other
transition has all three fields null. Compatibility output is bound only
inside a rollback receipt and never has an independent transition field.
The finalization-sidecar fields are non-null only for `automerge_migration` and
`rollback`, match the applicable receipt byte for byte, and satisfy the v1
sidecar caps. They are null for every other transition.
For `automerge_migration`, the previous migration-claim pointer is exactly
`{ kind: "candidate_claim", digest: final_migration_claim_digest }` and the
target pointer is null. Every other transition rejects a previous
`candidate_claim` and preserves a null or byte-identical `claim_abandonment`
pointer, except `same_library_recovery`. A valid one-use recovery transition
may name the exact non-null candidate-claim or abandonment pointer as its
previous pointer, requires the exact canonical
`migration_recovery_supersession_digest`, and sets the target pointer to null.
When the previous pointer is null, that digest is null. Every non-recovery
transition sets it null. Recovery authorization, epoch advancement, target
authority replacement, and pointer consumption occur in one compound
compare-and-swap. No signature by the lost source authority key is required.
`import_execution_receipt_digest` is non-null only for a new-library import
genesis and equals that exact signed precursor. It is null for empty-library
genesis and every non-genesis transition.

The canonical `certificate_body` includes
`authorization_kind: "genesis_self_authorization" |
"authority_signature" | "recovery_delegation"` and a required nullable
`recovery_delegation_digest`. It omits the certificate digest and all proof
signatures:

```text
certificate_digest = D(
  "epoch-transition-certificate",
  certificate_body
)

authority_signature = S(
  "epoch-transition-certificate",
  signing_authority_private_key,
  { certificate_digest }
)

target_authority_proof = S("authority-key-possession", target_authority_private_key, {
  certificate_digest,
  target_authority_key_id
})
```

The digest, required target-key proof, and discriminated authorization proof
travel in an outer certificate header and never hash themselves. For
`genesis_self_authorization`, `recovery_delegation_digest` is null,
`signing_authority_key_id` equals `target_authority_key_id`, the authority
signature is produced by that target key, and recovery authorization is null.
For `authority_signature`, `recovery_delegation_digest` is null, the authority
signature is present, and recovery authorization is null. For
`recovery_delegation`, the authority signature is null, the exact delegation
digest and recovery authorization are present, and the verifier applies the
one-use recovery contract below. Its `signing_authority_key_id` must equal the
delegation's `signing_authority_key_id`. That value names the source authority
key that signed the delegation. It is not represented as the direct signer of
the recovery transition certificate. Supplying both or neither authorization
form is invalid.

Library genesis is the sole self-root. Its previous epoch, epoch ID,
transition digest, manifest digest, manifest-auth digest, manifest generation,
active-recovery digest, recovery-capability-change pointer,
spent-redemption digest, migration-claim pointer, and authority key ID
are null. Its previous accepted
and quarantined frontiers, source actor census, and source admission fences are
canonical empty values. The target actor census and target frontiers are
independent closed fields. For an empty-library genesis they are empty. For a
new-library import they equal the exact staged import actor census, planned
ending tip, and imported target frontier whose complete certificate and
operation closure has already been verified under the import-exclusive
barrier. No source actor gains target authority. Target epoch is one, target
epoch ID is fresh, target manifest generation is zero, and the target
manifest's three predecessor fields are null. That generation-zero manifest
may contain the exact staged import segments, actor certificate, checkpoint,
and frontier named by the target census and closure. Its target active and
spent digests recompute the canonical empty bodies and its target change
pointer is null. `transition_reason` is `library_genesis`.
For new-library import, the checkpoint in this manifest has
`anchor_kind: "transition_candidate"` and the exact import anchor defined under
`Snapshot and restore`. It has no accepted transition or manifest anchor.

For new-library import, the genesis closure contains exactly one `receipt`
verified object whose digest is `import_execution_receipt_digest` and whose
canonical bytes are
`{ import_execution_receipt_body, import_execution_receipt_digest,
import_execution_authority_signature }`. Its target manifest, checkpoint,
frontier, blob roots, actor ending tip, and media plan equal the transition and
closure byte for byte. Empty-library genesis contains no such receipt.

The target key self-signs the certificate through
`genesis_self_authorization` and separately proves possession through
`target_authority_proof`. A cloud-backed genesis uses one create-if-absent
operation for a previously absent `library_id`; it installs the exact
certificate, authority-signed genesis manifest, authentication object, and
empty recovery bodies together. Response loss is resolved by reading that
library ID. An existing record is a collision and cannot be overwritten.
Local-only genesis commits the same verified objects and library-control record
in one local authority transaction and records that no cloud tuple exists. For
an import, that record remains `genesis_pending_post_checkpoint` and
unexposed until the accepted post-genesis checkpoint and next manifest
generation complete. It is not an active library-control record.
Every later transition requires the ordinary prior-authority or recovery path.

For an ordinary transition, the signing key ID must equal the authority key
accepted by the previous transition. The verifier obtains that public key from
the already accepted certificate chain, never from an untrusted field in the
candidate. The target public key and key ID normally equal the current
authority. For rotation, the old key signs a body containing the new public key
and its recomputed key ID. Every transition verifies
`target_authority_proof` against that exact new public key. The new key has no
authority before that exact transition wins. An ordinary transition preserves
the active-recovery root, recovery-capability-change pointer, and
spent-redemption root exactly. It also preserves a null or abandonment
migration pointer and rejects an active candidate claim. Automerge migration
and eligible same-library recovery are the only transitions that consume an
active candidate claim; eligible recovery may also consume an abandonment
pointer. A recovery transition removes exactly its
registered delegation from the active set, adds exactly its one
`redemption_id` to the spent set, and installs
`{ kind: "recovery_transition_certificate", digest: certificate_digest }` as
the new recovery-capability-change pointer. Any other change is invalid
except the authority-signed same-epoch capability-change operation defined
under restore. Because the recovery transition certificate cannot include its
own digest as an input, its body binds the exact previous
recovery-capability-change pointer and the exact target active-recovery and
spent-redemption digests. After deriving the certificate, the protocol sets
the target tuple's recovery-capability-change pointer to that exact typed
object. Ordinary transitions copy the previous change pointer byte for byte.

Transition is prepare, briefly fence, publish, and commit:

1. Each participating installation provisionally prepares the target store
   while local write authority remains active. Corpus-sized decode, checkpoint
   construction, closure enumeration, upload, remote fetch, and digest
   verification happen in this phase.
2. The initiator first drains the ordinary old-epoch outbox to a published
   source tuple, reads that tuple back, and fixes it as the prepared source
   anchor. It constructs the target state and immutable
   `genesis_closure_body` against that exact anchor. Every target blob, segment,
   checkpoint, canonical genesis manifest, recovery body, authority object,
   receipt, and chunk required by the closure is uploaded, fetched through the
   remote read path, and digest-verified before any exclusive barrier is held.
   A durable prepared-transition record binds the source tuple, target tuple,
   closure root and chunks, remote verification receipts, and exact target
   local staging generation. Migration and rollback are the narrow exception:
   their prebuilt closure contains the prepared proof, reservations, and every
   corpus-sized dependency, but excludes the current final proof, receipt,
   cutover records, activation sidecar, certificate, and manifest
   authentication object. Those do not exist until source activations complete
   and are direct certificate-bound members of the atomic authority bundle.
3. The transition certificate and target manifest authentication object may be
   derived, signed, uploaded, fetched back, and verified provisionally from
   that prepared record for every transition except migration and rollback.
   Migration and rollback derive them only after the bounded activation
   sidecar and final receipt exist. In every case they have no authority unless
   the compare-and-swap below wins against the exact prepared source tuple.
4. Finalization enters one durable local authority barrier. Entering the
   barrier is allowed only when the old-epoch outbox is empty and every local
   operation acknowledged before entry is already in the prepared source
   anchor. New user and background writes are admitted only to an
   epoch-neutral intent journal whose idempotency keys and payload digests are
   durable before acknowledgment. Provider ingestion that cannot produce an
   exact replayable intent pauses before contacting the provider. The barrier
   performs no first decode, source census, external sort, closure traversal,
   arbitrary object upload, or corpus-sized remote readback. Migration and
   rollback may publish only their predeclared bounded finalization sidecar.
5. Under the barrier, the initiator rereads the compound cloud authority tuple,
   local control record, prepared-transition record, and fixed-size closure
   roots. Every source field must still equal the prepared anchor byte for byte.
   Migration and rollback additionally activate their prepared reservations
   and verify only the bounded sidecar entries declared by preflight. A mismatch
   or cap breach releases every activated fence and the barrier, replays the
   epoch-neutral intents to the still-current epoch, and reprepares outside the
   barrier. Immutable objects verified before entry remain reusable by digest.
6. Exactly one compound compare-and-swap may replace the cloud authority state
   from that exact source tuple to the prepared transition, target genesis
   manifest and authentication object, protocol-determined recovery roots, and
   protocol-determined migration pointer. Automerge migration requires the
   final candidate-claim pointer and clears it. Same-library recovery may
   consume the exact non-null candidate or abandonment pointer only with its
   recovery-supersession proof. Every other transition rejects an active claim
   and preserves null or the exact abandonment pointer after verifying its
   registered cleanup. For migration and rollback it atomically persists the
   bounded finalization sidecar, final proof, exact receipt, cutover grant and
   consumption when applicable, transition certificate, manifest
   authentication object, and target tuple. The store verifies the fixed roots
   and existence of the already verified immutable objects. It does not
   re-fetch the complete closure while holding the barrier. Any intervening
   manifest publication, capability change, or competing transition makes the
   compare-and-swap fail.
7. The winner commits the prepared local state, releases the barrier, and
   applies the epoch-neutral intent journal to the new epoch exactly once. A
   proven loser releases the barrier and applies those intents to the winning
   current epoch. No acknowledged intent becomes manual orphan-recovery input
   merely because transition preparation took a long time.
8. The bounded finalization path reads only fixed-size control records and
   roots, one bounded intent-journal page, and the migration or rollback
   sidecar within its declared cap. If it cannot reach a decisive
   compare-and-swap result within 30 seconds, it stops issuing new remote
   mutations and enters response-resolution mode. Local intent admission may
   continue to the durable epoch-neutral journal without claiming an active
   epoch.
9. A lost compare-and-swap response keeps the epoch decision unresolved. The
   installation reads the cloud authority tuple and resolves the exact
   transition as winner or loser before applying any queued intent.
10. Crash recovery restores the durable barrier and intent journal, fetches the
    authority state and certificate, then idempotently commits or rolls back
    the prepared local transition. File presence and a locally incremented
    epoch never decide authority. Local activation waits for the exact remote
    genesis closure to reverify, but that corpus-sized verification runs
    outside the exclusive barrier.

The closure census can grow with the target library, so it is a persistent
authenticated set rather than an array that finalization must rewrite:

```text
genesis_verified_object_entry_body = {
  object_kind,
  object_digest,
  byte_length
}

genesis_verified_object_entry_digest = D(
  "genesis-verified-object-entry",
  genesis_verified_object_entry_body
)

genesis_verified_object_set_body = {
  format: "freed_genesis_verified_object_set_v1",
  library_id,
  target_epoch_id,
  set_kind: "genesis_verified_objects",
  entry_count,
  root_node_digest
}

genesis_verified_object_set_digest = D(
  "genesis-verified-object-set",
  genesis_verified_object_set_body
)

genesis_closure_body = {
  library_id,
  target_epoch_id,
  remote_namespace,
  target_manifest_digest,
  genesis_verified_object_set_body,
  genesis_verified_object_set_digest,
  verified_object_count,
  verified_at_ms
}

genesis_closure_digest = D("genesis-closure", genesis_closure_body)

genesis_closure_byte_length = byte_length(C(genesis_closure_body))

genesis_closure_storage_root_body = {
  artifact_kind: "genesis_closure",
  artifact_digest: genesis_closure_digest,
  canonical_byte_length: genesis_closure_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

genesis_closure_storage_root_digest = D(
  "chunked-object-root",
  genesis_closure_storage_root_body
)
```

Every portable closure, backup proof, genesis proof, restore proof, and import
provenance set uses one shared closed `portable_protocol_object_kind_v1`
registry and one digest-dispatch table. The registry is exactly:
`backup_bundle`, `backup_manifest`, `genesis_manifest`,
`active_recovery_capabilities`, `spent_recovery_redemptions`,
`recovery_delegation`, `source_manifest`, `source_manifest_auth`,
`authority_transition_certificate`,
`recovery_capability_change_certificate`,
`backup_registration_descendant_proof`, `actor_enrollment_certificate`,
`actor_retirement_certificate`, `migration_candidate_claim`,
`migration_claim_abandonment`, `migration_claim_cleanup`,
`migration_claim_cleanup_proof`, `migration_claim_source_revocation`,
`migration_claim_operation_grant`,
`migration_claim_operation_grant_consumption`,
`migration_claim_source_attempt`,
`migration_claim_source_commit_admission`,
`migration_source_fence_reservation`,
`migration_source_fence_activation`,
`rollback_source_fence_reservation`,
`rollback_source_fence_activation`,
`source_admission_fence_entry`,
`source_admission_fence_set`,
`transition_finalization_sidecar`,
`migration_staging_disposition_receipt`,
`migration_recovery_supersession`,
`migration_recovery_gc`,
`migration_source_contributor_certificate`,
`migration_local_source_contribution`, `migration_candidate`,
`migration_candidate_registration`, `migration_candidate_object_registry`,
`migration_candidate_staging_census`, `migration_batch`,
`migration_prepared_proof`, `migration_proof`, `migration_receipt`,
`rollback_candidate`, `rollback_prepared_proof`, `rollback_proof`,
`rollback_receipt`,
`operation_segment`, `checkpoint`, `compaction_receipt`, `repair_receipt`,
`authenticated_object_set_node`, `chunked_object_root`,
`chunked_object_chunk`, `media_vault_target_manifest`,
`restore_preparation`, `restore_staging`, `import_execution_receipt`,
`import_receipt`, and `content_blob`.

The set uses the authenticated-object-set contract with set kind
`genesis_verified_objects`. Its sort key is the closed
`{ object_kind, object_digest, byte_length }` body, and each entry stores that
body plus its `genesis_verified_object_entry_digest`. Entries sort by object
kind, decoded digest bytes, then byte length. `verified_object_count` equals
both set entry counts. Every kind is one exact member of the shared registry.
Context-specific closure rules determine which reachable members are required;
no context defines a second spelling or digest equation. `object_digest` is the
exact registered protocol digest for the complete canonical object. For
`chunked_object_chunk` and `content_blob`, it is the exact
`DB("blob-content", bytes)` value. For `chunked_object_root`, it is
`D("chunked-object-root", chunked_object_root_body)`. For
`media_vault_target_manifest`, it is
`D("media-vault-target-manifest", target_manifest_body)`. For
`restore_staging`, it is `D("restore-staging", restore_staging_body)`. For
`migration_candidate_claim`, `migration_claim_abandonment`, and
`migration_claim_cleanup`, it is the registered lifecycle digest and the
canonical bytes contain the complete body, digest, and authority signature.
For `migration_claim_cleanup_proof`, it is
`D("migration-claim-cleanup-proof", migration_claim_cleanup_proof_body)`. For
`migration_prepared_proof`, `migration_proof`, `rollback_prepared_proof`, and
`rollback_proof`, it is the corresponding registered body digest and the
canonical bytes reconstruct from the exact registered chunked root. For
`source_admission_fence_set`, it is
`D("source-admission-fence-set", source_admission_fence_set_body)`. For
`source_admission_fence_entry`, it is
`D("source-admission-fence-entry", source_admission_fence_entry_body)`. For
`transition_finalization_sidecar`, it is
`D("transition-finalization-sidecar",
transition_finalization_sidecar_body)`. For
`migration_staging_disposition_receipt`, it is the receipt digest and the
canonical bytes contain the complete body, digest, and authority signature.
For `migration_recovery_gc`, it is the registered recovery-GC digest and the
canonical bytes contain the complete body, digest, and authority signature.
`byte_length` is the exact fetched canonical or blob byte length. The verifier
fetches each object from its kind-specific immutable location, checks exact
length and canonical bytes, and recomputes the named digest. The plan storage
root and target manifest remain reachable through the transition receipt and
activated library-control record. A new kind requires a contract version.

The transition certificate carries the exact closure digest, storage-root
digest, and positive byte length. Its target namespace contains the immutable
closure root and every chunk, the verified-object set body and every reachable
set node, before certificate signing. Verification streams the closure chunks,
recomputes all commitments, traverses the set, and then verifies every listed
object. The certificate never embeds the potentially unbounded set.

For migration and rollback, this prebuilt closure contains the complete
prepared-proof root and chunks, every reservation and its authority evidence,
and every corpus-sized dependency. It excludes the current activation sidecar,
final proof, receipt, cutover grant and consumption, transition certificate,
and manifest authentication object to keep the dependency graph acyclic. The
certificate binds each excluded object directly in the one atomic authority
bundle.

The list includes the canonical genesis manifest body, the canonical target
active-recovery and spent-redemption bodies, the complete target
active-capability proof closure, every applicable media-vault plan, target
manifest, source-snapshot storage root and chunks, plan storage root and
chunks, and restore-staging object, and every object the manifest reaches. It
excludes the transition-dependent manifest authentication object. Every named
object is fetched through the remote read path and independently recomputed
before the receipt is accepted. Duplicate identities or a missing reachable
object are invalid. Every non-null source or target migration-claim pointer in
the current transition, any historical transition, or any retained
capability-change certificate requires the complete typed claim lifecycle,
registered candidate, cleanup proof and dependencies when applicable, and
exact predecessor chain in that transition's verified closure. A null pointer
adds no migration object. Separately, a nonempty recovery set dispatches on
its capability-change pointer kind, includes the exact capability-change or
recovery-transition certificate it names, and verifies that predecessor chain.
For a recovery transition, the target capability-change pointer names
the new transition certificate itself, so the closure includes the predecessor
chain and every dependency of the remaining active entries; the compound
compare-and-swap separately verifies and installs the new certificate after it
has been derived.

Restore must first reconcile the current cloud authority. A backup cannot
independently advance an existing library from an old frontier. The owner may
instead restore it as a new `library_id`, preserving provenance without
competing for the old library's authority.

The target epoch number must equal the previous epoch plus one. Every client
validates an unbroken authority-signed certificate chain extending the exact
transition digest it already accepted. A certificate with a lower epoch, a
sibling predecessor, a reused epoch ID, or a genesis frontier that does not
anchor the previous accepted frontier is rejected even when its signature is
otherwise valid.

Every epoch uses a distinct logical cloud namespace and cryptographic write
acceptance bound to its epoch ID and transition certificate. This fences future
stale Library Core clients as well as Automerge clients. A provider credential
may still let an old binary upload arbitrary bytes, but those bytes cannot form
an accepted current-epoch operation or authenticated manifest. An offline
old-epoch client may preserve its local edits. Those edits remain orphan
recovery input until an authority-certified import maps them to new operations
in the active epoch. Failing closed means denying current authority, not
silently deleting offline work.

There is no normal dual-writer mode. A compatibility adapter may derive bytes
for an older reader, but it is not a second authority.

## Replica and actor lifecycle

`library_id` belongs to synchronized library history. `installation_id` is a
device-local incarnation and is never imported as authority from a portable
backup. A new install, clone recovery, or restore into a different installation
creates a new cryptographically random installation identity.

Each library has a versioned authority signing key. Its public key and key ID
are part of the library genesis and every epoch transition. New actors,
retirements, fork repairs, clock repairs, and epoch transitions require a
certificate signed by the active library authority. Authority-key rotation is
itself a transition signed by the old key. It carries neither a migration nor
rollback receipt. Recovery-authorized key replacement instead uses the
registered one-use recovery delegation and transition proof defined below.
Every transition distinguishes `signing_authority_key_id` from
`target_authority_key_id`; a verifier recomputes the latter from
`target_authority_public_key`.

```text
authority_key_id = D("authority-key", {
  signature_algorithm: "ed25519",
  authority_public_key
})
```

The installation that creates a library generates its authority private key in
platform-protected, nonexportable storage and becomes the initial authority
holder. Desktop uses the operating-system secure store. A PWA uses a
nonextractable WebCrypto key in origin-private persistent storage and surfaces
the browser's durability status. The authority private key never enters
Library Core rows, operation payloads, replication, ordinary cloud storage, or
portable backup.

A new installation generates its own actor key and canonical enrollment body,
then pairs interactively with an existing authority holder. The holder verifies
proof of possession and signs the exact final enrollment certificate. Library
Core v1 has no delegated actor-enrollment credential. An unattended background
actor cannot approve a new device. If no authority holder is available, the
new installation remains read-only until one returns or the owner uses the
encrypted, one-use library recovery delegation defined under restore. It
cannot infer authority from synchronized data, copy an actor credential, or
silently create a competing library authority.

Each writable installation creates a device-local Ed25519 actor key and a
cryptographically random 32-byte `actor_incarnation_nonce`. The nonce is public
identity material and remains in the historical enrollment certificate and
portable backup. It is never imported as the restored installation's active
credential. Only the actor private key is excluded. In this section
`installation_incarnation` is the current installation's
`library_control.installation_id`. A same-device restore creates a new actor
key and nonce.

```text
actor_public_key_fingerprint = D("actor-public-key", {
  signature_algorithm: "ed25519",
  actor_public_key
})

actor_id = D("actor-id", {
  library_id,
  installation_incarnation,
  signature_algorithm: "ed25519",
  actor_public_key,
  actor_incarnation_nonce
})
```

Before its first data mutation, the installation commits one authority-control
operation whose canonical `actor_enrollment_body` is the closed object:

```text
{
  operation_id,
  operation_type: "actor_enrolled",
  library_id,
  epoch,
  epoch_id,
  schema_version,
  authority_key_id,
  installation_incarnation,
  actor_incarnation_nonce,
  actor_id,
  actor_public_key,
  actor_public_key_fingerprint,
  observed_frontier,
  created_at_ms,
  signature_algorithm: "ed25519"
}
```

The body carries the full actor public key and nonce so every replica can
recompute both the fingerprint and actor ID. A fingerprint without the public
key is not an enrollment.

Enrollment derivation is self-reference free:

```text
enrollment_body_digest = D("actor-enrollment-body", actor_enrollment_body)

actor_proof = S("actor-enrollment-proof", actor_private_key, {
  enrollment_body_digest
})

enrollment_certificate_body = {
  actor_enrollment_body,
  enrollment_body_digest,
  actor_proof
}

enrollment_certificate_digest = D(
  "actor-enrollment-certificate",
  enrollment_certificate_body
)

authority_signature = S(
  "actor-enrollment-authority",
  authority_private_key,
  { certificate_digest: enrollment_certificate_digest }
)

enrollment_certificate = {
  certificate_body: enrollment_certificate_body,
  certificate_digest: enrollment_certificate_digest,
  authority_signature
}
```

A verifier first checks canonical bytes and v1 algorithms, then recomputes the
public-key fingerprint, actor ID, enrollment body digest, actor proof,
certificate digest, and active-authority signature in that order. It also
checks the exact library, epoch, epoch ID, authority key ID, schema version, and
observed frontier against accepted authority state. No later operation from
the actor is accepted until this certificate commits. An exact certificate
retry is idempotent. Reusing `operation_id` or `actor_id` with different
canonical bytes is an authority conflict and is rejected or quarantined, never
overwritten.

Every `transition_candidate` has one candidate-only verification mode before
its target transition. The immutable import plan, migration or rollback
candidate, or repair plan contains the target authority public key and
recomputed key ID, the complete actor enrollment certificate and digest, and
the exact target actor starting tip. A repair plan also carries the complete
retirement certificate for that same bounded repair actor. The verifier checks
the actor proof, certificate digests, and target-authority signatures against
that candidate key and requires exact target library, epoch, epoch ID, schema,
actor ID, starting-tip, and, for repair, ending-tip equality. This proves only
the staged cryptographic plan. It grants no ordinary enrollment, writer,
manifest, or sync authority.

The same target key, certificate digest, actor starting and ending tips, and
actor census appear in the applicable plan or candidate record, final
transition receipt, closure, and transition certificate. The actor's staged
envelopes remain unreachable behind that transition's exclusive writer
barrier. The certificate, staged operations, and target epoch gain global
authority atomically when that exact transition wins. The later accepted
checkpoint and next manifest control local user activation and backup
eligibility, not the authority time. A losing, abandoned, or mismatched
candidate never promotes the certificate and cannot submit an ordinary
operation.

`actor_enrolled` is an authority-control operation. It is not sequence zero in
the actor's data-mutation chain. Its certificate digest seeds that chain only
after the certificate verifies and commits:

```text
actor_chain_genesis = D("actor-chain-genesis", {
  enrollment_certificate_digest,
  actor_id,
  epoch_id
})
```

Sequence one uses null `previous_actor_operation_id` and this exact digest as
`previous_actor_chain_digest`. Sequence allocation, the previous-operation
link, the chain digest, and the operation commit in the same local authority
transaction. A process cannot reserve actor sequence outside that transaction.
The only v1 exception is the immutable new-library import plan below. It
durably fences one otherwise unreachable import actor, persists every complete
signed envelope before the first target mutation, and never exposes that actor
to ordinary allocation.

Portable backup preserves historical actor enrollments and operations, but not
the active actor credential. Restore creates a new installation and actor,
enrolls them against the restored frontier, and never resumes the backed-up
actor sequence. A same-device restore also rotates the actor before accepting
new writes.

`actor_retired` records the accepted final sequence, operation ID, chain digest,
and frontier. An operation above that point from a retired actor is
quarantined. An owner may explicitly recover it into a new actor, but an old
installation cannot silently rejoin as its retired identity. The
enrolled-device census is derived from certified actor enrollment, retirement,
and manifest acknowledgment records. Compaction waits for every active
enrolled actor or an explicit retirement.

The canonical retirement certificate is also self-contained and
content-addressed:

```text
actor_retirement_body = {
  operation_id,
  operation_type: "actor_retired",
  library_id,
  epoch,
  epoch_id,
  authority_key_id,
  actor_id,
  enrollment_certificate_digest,
  final_sequence,
  final_operation_id,
  final_chain_digest,
  observed_frontier,
  created_at_ms,
  signature_algorithm: "ed25519"
}

retirement_body_digest = D("actor-retirement-body", actor_retirement_body)

retirement_certificate_body = {
  actor_retirement_body,
  retirement_body_digest
}

retirement_certificate_digest = D(
  "actor-retirement-certificate",
  retirement_certificate_body
)

authority_signature = S(
  "actor-retirement-authority",
  authority_private_key,
  { certificate_digest: retirement_certificate_digest }
)

retirement_certificate = {
  certificate_body: retirement_certificate_body,
  certificate_digest: retirement_certificate_digest,
  authority_signature
}
```

`final_sequence` is a nonnegative safe integer. `final_operation_id` and
`final_chain_digest` are both null exactly when it is zero and both required
when it is positive.

Enrollment and retirement certificate objects are immutable remote protocol
objects stored and fetched by their certificate digest. A verifier recomputes
the digest and verifies the embedded actor proof and active-authority signature
before using any public key or retirement state. A digest without the canonical
certificate bytes is not sufficient authority.

If one actor ID presents two operation IDs at the same sequence, or breaks its
previous-operation chain, both divergent suffixes are quarantined after their
common prefix. Recovery is an authority-certified higher-epoch
`actor_fork_repair`. The certificate contains the exact common prefix, every
branch digest, and a complete canonical mapping from each quarantined source
operation, chain digest, causal reference, and transaction member to a new
repair operation.

Quarantined source envelopes remain immutable evidence and never replay through
the normal materializer. The repair transaction emits newly signed canonical
operations through one freshly generated, epoch-scoped repair actor. The
authority certificate enrolls that actor, embeds its proof-of-possession and
public key, limits it to the exact repair transaction, and retires it at the
transaction's final chain digest. Only the authority executor holding that
actor's private key creates and signs the exact member bytes. Other replicas
never derive a private key or re-sign a repair.

Repair operations carry new operation IDs, target epoch, actor-chain links,
branch-qualified frontiers, and safe HLC values. Each records its
`source_operation_id`, source branch digest, and repair transition ID.
The repair transition ID is the preselected globally unique target epoch ID,
not the transition-certificate digest.
Operation IDs, member order, source mappings, and rewritten frontiers derive
deterministically from the transition ID, source branch digest, and source
operation identity. The chunked repair plan contains every canonical signed
member byte and complete mapping. Its fixed receipt commits the plan digest,
storage root, byte length, transaction aggregate, expected final frontier, and
expected materialized digest, and the transition commits that receipt.
Replicas verify and apply those exact bytes. No replica resumes writes until
that repair transaction and receipt converge. Fork detection therefore fails closed without rewriting
history, silently discarding either branch, inventing public-data signing keys,
or making the library permanently unrecoverable.

Both fork and clock repair use one closed, bounded-memory authority contract.
The potentially large exact mapping and signed-member set is a chunked
artifact:

```text
repair_plan_body = {
  repair_id,
  repair_kind: "actor_fork_repair" | "clock_quarantine_repair",
  library_id,
  source_epoch,
  source_epoch_id,
  source_transition_digest,
  rollback_sources,
  source_frontier_digest,
  source_checkpoint_digest,
  source_checkpoint_storage_root_digest,
  source_checkpoint_byte_length,
  source_reachable_blob_set_digest,
  target_epoch,
  target_epoch_id,
  target_authority_public_key,
  target_authority_key_id,
  repair_actor_enrollment_certificate,
  repair_actor_enrollment_certificate_digest,
  repair_actor_starting_tip,
  source_branch_digests,
  source_operation_mappings,
  repair_transaction_members,
  repair_transaction_digest,
  expected_final_frontier_digest,
  expected_materialized_digest,
  expected_reachable_blob_set_digest,
  repair_actor_retirement_certificate,
  repair_actor_retirement_certificate_digest
}

repair_plan_digest = D("repair-plan", repair_plan_body)

repair_plan_byte_length = byte_length(C(repair_plan_body))

repair_plan_storage_root_body = {
  artifact_kind: "repair_plan",
  artifact_digest: repair_plan_digest,
  canonical_byte_length: repair_plan_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

repair_plan_storage_root_digest = D(
  "chunked-object-root",
  repair_plan_storage_root_body
)

repair_receipt_body = {
  repair_id,
  repair_kind,
  library_id,
  source_epoch,
  source_epoch_id,
  source_transition_digest,
  source_frontier_digest,
  source_checkpoint_digest,
  source_checkpoint_storage_root_digest,
  source_checkpoint_byte_length,
  source_reachable_blob_set_digest,
  target_epoch,
  target_epoch_id,
  target_authority_key_id,
  repair_plan_digest,
  repair_plan_storage_root_digest,
  repair_plan_byte_length,
  repair_actor_enrollment_certificate_digest,
  repair_actor_ending_tip,
  repair_transaction_digest,
  final_frontier_digest,
  final_materialized_digest,
  target_checkpoint_digest,
  target_checkpoint_storage_root_digest,
  target_checkpoint_byte_length,
  target_reachable_blob_set_digest,
  repair_actor_retirement_certificate_digest,
  signing_authority_key_id
}

repair_receipt_digest = D("repair-receipt", repair_receipt_body)

repair_receipt_authority_signature = S(
  "repair-receipt",
  target_authority_private_key,
  { repair_receipt_digest }
)
```

Source branch digests are unique and sorted by decoded digest.
`source_operation_mappings` is the complete canonical mapping described above,
sorted by source branch digest, source actor, source sequence, source operation
ID, transaction-member index, and target operation ID. The member array is in
exact repair-transaction order and independently recomputes its aggregate
digest. Receipt target epoch is exactly source epoch plus one. Its authority
key ID, actor enrollment, actor retirement, plan, target epoch, and target
epoch ID equal the transition candidate and the key installed by the accepted
target transition. `signing_authority_key_id` equals
`target_authority_key_id`. Every ending tip, frontier, materialized,
reachable-blob-set, transaction, enrollment, and retirement digest equals the
verified plan. The receipt additionally cross-binds the independently
constructed candidate checkpoint. Its canonical body contains the exact plan
digest and storage root in its transition-candidate anchor, while
`target_checkpoint_digest` in the receipt recomputes from those plan outputs,
the target actor state, frontier, materialized rows, and reachable blob set.
The repair plan deliberately does not contain the checkpoint digest, so this
cross-binding has one construction order rather than a digest fixed point.

Before target authority exists, the source authority signs one transition
containing the verified repair receipt, target key, candidate checkpoint,
exact target actor census and frontier, and target genesis-manifest digest. The
target genesis manifest names the repair receipt, and its closure contains the
receipt, repair-plan storage root and chunks, repair actor enrollment and
retirement certificates, exact staged operation closure, candidate checkpoint,
and all referenced blobs. The receipt does not name that manifest. The
compound transition promotes the target key, repair actor, staged operations,
repaired frontier, and target epoch atomically. A losing or mismatched repair
remains quarantined staging. The plan root and every chunk remain reachable
whenever the receipt remains in authority history. Verification streams the
plan and does not allocate the complete mapping or member set.

## Operation envelope

Every synchronized mutation has a canonical envelope:

```text
operation_id
library_id
epoch
epoch_id
schema_version
actor_id
actor_sequence
previous_actor_operation_id
previous_actor_chain_digest
actor_chain_digest
causal_frontier
hlc_wall_ms
hlc_counter
transaction_id
transaction_member_index
transaction_member_count
transaction_digest
operation_type
entity_type
entity_id
payload
payload_digest
blob_references
created_at_ms
signature_algorithm
signature
```

Requirements:

- `operation_id` is globally unique and stable across every retry.
- `transaction_id` is globally unique and stable across every retry. It binds
  exactly one actor ID, member count, ordered member-digest list, and aggregate
  transaction digest. Replaying the exact canonical transaction is idempotent.
  Reusing the ID with different canonical bytes quarantines the conflicting
  transaction and never overwrites, rolls back, or taints an already committed
  transaction.
- `actor_sequence` is contiguous for one actor. Gaps are detected, not guessed.
- `previous_actor_operation_id` prevents a fork from masquerading as one
  actor's linear history.
- Actor-chain genesis is the exact `actor_chain_genesis` defined under
  `Replica and actor lifecycle`. Every later member names the exact prior
  operation ID and chain digest. No implementation chooses its own null, zero,
  or empty-chain convention.
- `causal_frontier` records `{ actor_id, sequence, operation_id, chain_digest }`
  for every actor branch relevant to this operation. It is a canonical sorted
  set of unique exact tips with causally dominated tips removed. Duplicate
  actor-branch entries are invalid. A sequence number without its exact chain
  identity is not a causal frontier.
- The HLC is used for human ordering and deterministic concurrent tie-breaking.
  It is not the sole causality mechanism.
- The authority validates its own clock before creating a local HLC. A local
  HLC beyond the registered skew bound is rejected before operation insertion,
  materialization, acknowledgment, or outbox insertion.
- An inbound operation beyond that bound is stored byte-for-byte in quarantine
  but does not advance the actor chain, materializer, acknowledgment frontier,
  or outbound manifest. It may apply once wall time reaches the bound without
  changing its bytes. Earlier recovery requires an authority-certified,
  replicated `clock_quarantine_repair` bound to the exact operation and chain
  digest. That repair uses the same epoch-scoped repair-actor envelope,
  exact-member-byte, source-reference, and retirement contract as
  `actor_fork_repair`. It maps the quarantined suffix to canonical replacement
  envelopes with safe HLC values, branch-qualified causal references, and an
  expected materialized digest. One replica cannot locally waive quarantine.
- `blob_references` is a canonically sorted list of content digest, byte length,
  encoding, and media type. Referenced blob bytes are part of transaction
  completeness even though they are stored outside the envelope.

Payload and envelope derivation are exact:

```text
payload_digest = D("operation-payload", {
  schema_version,
  operation_type,
  payload
})
```

For transaction member `i`, `transaction_member_body_i` is the closed
operation-envelope object with `previous_actor_chain_digest`,
`actor_chain_digest`, `transaction_digest`, and `signature` omitted, not set to
null. It includes `operation_id`, `previous_actor_operation_id`, payload,
verified `payload_digest`, branch-qualified frontier, transaction identity and
indexes, and `signature_algorithm`.

```text
member_digest_i = D("transaction-member", transaction_member_body_i)

transaction_digest = D("transaction", {
  transaction_id,
  transaction_member_count,
  actor_id,
  initial_previous_actor_operation_id,
  initial_previous_actor_chain_digest,
  transaction_member_digests: [
    member_digest_0,
    ...,
    member_digest_(transaction_member_count - 1)
  ]
})
```

The member-digest array is in contiguous member-index order:

```text
initial_previous_actor_operation_id =
  transaction_member_body_0.previous_actor_operation_id
initial_previous_actor_chain_digest = previous_chain_digest_0
```

For the actor's first transaction these values are null and
`actor_chain_genesis`. Otherwise both equal the exact currently accepted actor
tip. For every member `i` greater than zero, `actor_sequence` increments by
one, `previous_actor_operation_id` equals member `i - 1`'s `operation_id`, and
`previous_chain_digest_i` equals `actor_chain_digest_(i - 1)`. A verifier
rejects rather than searches for or infers a missing prior value.

```text
actor_chain_digest_i = D("actor-chain", {
  previous_actor_chain_digest: previous_chain_digest_i,
  transaction_member_digest: member_digest_i,
  transaction_digest
})

operation_signing_body_i = operation_envelope_i with only signature omitted

operation_signing_body_digest_i = D(
  "operation-signing-body",
  operation_signing_body_i
)

signature_i = S(
  "operation-envelope",
  actor_private_key,
  { operation_signing_body_digest: operation_signing_body_digest_i }
)

final_operation_envelope_i = {
  ...operation_signing_body_i,
  signature: signature_i
}

operation_envelope_digest_i = D(
  "operation-envelope",
  final_operation_envelope_i
)
```

A receiver verifies the payload digest, all member digests, each operation
signing-body digest, the one transaction digest, the complete sequential chain,
and every actor signature before
materializing any member or advancing any cursor, tip, acknowledgment, or
outbox. It streams the received canonical signing-body bytes into the registered
digest and verifies the fixed-size signature commitment. It never silently
rebuilds a differently ordered object and treats that as the signed artifact.

- Unknown operation and schema versions are retained but never applied by an
  older materializer. The apply cursor stops before the unknown operation and
  write authority fails closed.
- Every transaction declares member count, member index, and the aggregate
  transaction digest. An ordinary or repair transaction has exactly one
  enrolled actor and one prior chain tip. Every member must share library ID,
  epoch number, epoch ID, actor ID, transaction ID, member count, and aggregate
  digest. Member indexes are unique and contiguous from zero. Actor sequences
  are contiguous from the prior chain tip in that same member order. A receiver
  may store incomplete members, but cannot materialize, acknowledge, advance
  an actor chain, or advance its frontier until the declared count, indexes,
  member signatures, individual transaction-member-body digests, actor-chain
  links, and
  aggregate digest all verify. Any mismatch or tamper quarantines the entire
  group. Multi-entity
  intent commits in one local authority transaction even when its members
  arrived in different cloud segments. A future cross-actor atomic group
  requires a separate authority-certified transaction type.

One transaction contains at most 1,000 members or 4 MiB of canonical member
bytes, whichever comes first. A larger bulk action creates one durable,
replay-idempotent `bulk_intent_id` whose normalized predicate, expected
revision, exact selected-set digest, selected count, and stable storage-side
cursor commit before work begins. That same transaction freezes the exact
selected primary keys in a durable membership table, or pins an immutable
storage checkpoint that can reproduce those exact keys. Batches consume only
that frozen membership in stable primary-key order. They never re-evaluate the
predicate, include a newly matching entity, or skip an entity whose current
values no longer match. The authority applies the intent through ordered
bounded transactions with progress receipts and deterministic resume. The
renderer never receives the full selected ID set. The whole intent is not
called atomic unless a separately registered bounded materializer proves that
contract.

The operation registry is exhaustive. Adding a mutation to a public store
interface without a registered operation type and materializer is a type or
build failure.

Cross-runtime state identity uses these exact derivations:

```text
frontier_digest = D("causal-frontier", {
  library_id,
  epoch,
  epoch_id,
  causal_frontier
})

blob_content_digest = DB("blob-content", blob_bytes)

materialized_key_digest = D("materialized-key", {
  registry_key,
  primary_key
})

materialized_row_digest = D("materialized-row", {
  registry_key,
  primary_key,
  row
})

materialized_leaf_digest = D("materialized-leaf", {
  materialized_key_digest,
  materialized_row_digest
})

materialized_branch_digest = D("materialized-branch", {
  branch_bit,
  left_digest,
  right_digest,
  row_count
})

materialized_commitment_body = {
  format: "freed_materialized_commitment_v1",
  row_count,
  trie_root_digest
}

materialized_digest = D("materialized-state", {
  library_id,
  epoch,
  epoch_id,
  schema_version,
  frontier_digest,
  materialized_commitment_body
})
```

A v1 content blob is at most 67,108,864,000,000 bytes, the exact generic-root
limit of 1,000,000 chunks times 67,108,864 bytes. Operation admission,
migration, restore, import, and replication reject a larger blob before
acknowledgment. Existing legacy library content above that limit blocks
migration until it is deliberately externalized or a later protocol is
reviewed. It is never truncated. Media-vault source evidence may instead use
the explicit owner-acknowledged oversize exclusion defined below. Backup stores
every admitted content or media payload through a chunked-object root, so the
smaller regular encrypted-file cap does not constrain a valid payload.

`materialized_rows` is the registry-defined logical synchronized projection,
not SQLite or IndexedDB storage bytes. It excludes row IDs, ingest sequence,
indexes, caches, and device-local or derived columns. It preserves absence
versus null. Each entry is
`{ registry_key, primary_key, row }`, sorted by ASCII `registry_key` and then
bytewise `C(primary_key)`.

`materialized_commitment_body` is the root of one canonical persistent Merkle
Patricia trie. A key digest is the decoded 256-bit
`materialized_key_digest`. Two unequal canonical
`{ registry_key, primary_key }` bodies with the same key digest are invalid.
An empty state has `row_count: 0` and `trie_root_digest: null`. A nonempty
state has one leaf per materialized row and a non-null root.

For two or more leaves, sort by decoded key digest. The canonical branch for
one range uses the first bit at which the range's first and last key differ,
numbered zero through 255 from the most significant bit. Its left child
contains every key with zero at that bit and its right child contains every
key with one. Both children are nonempty. Recursion stops at one leaf.
`branch_bit` strictly increases down a path, `row_count` is the exact sum of
both children, and no alternate branch placement or unary branch is valid.
This construction is unique for a logical row set and independent of
insertion order.

The adapter stores leaves and branch nodes by digest. An authoritative
transaction updates only touched leaves and their canonical ancestor paths in
the same durability transaction as the rows and operation receipt. Unchanged
subtrees are reused. One row change touches at most 256 branches and does not
scan the corpus. Checkpoint and migration verification may stream rows,
externally sort bounded leaf descriptors by key digest, and recompute the
complete root. They never allocate the full row set. Cross-runtime public
vectors cover empty, singleton, split, merge, insertion-order, deletion, and
key-collision rejection.

## Merge algebra

SQL statement order is not a merge strategy. Every synchronized field belongs
to one explicit algebra in the schema registry:

- **Causal register.** A causally later value wins. Concurrent values use the
  deterministic tuple `(hlc, actor_id, operation_id)`. This supports both
  `true` and `false`, so unsave, unarchive, unlike, and mark-unread propagate.
- **Element map.** Set-like fields such as tags store one causal register per
  member. Add and remove are both representable.
- **Keyed collection.** Logs, highlights, and other collections use stable
  element IDs. Insertion, field updates, and deletion are separate operations.
- **Immutable content.** Captured source content is addressed by a content
  digest. A conflicting replacement is preserved as a conflict record unless
  a registered repair operation resolves it.
- **Entity tombstone.** Deletion is a stamped, delete-wins operation. It
  dominates older and concurrent updates. A later restore requires an explicit
  restore operation that causally observed the winning tombstone.
  `entity_generation` is the winning restore operation ID, not a locally
  incremented number. Concurrent restores use the deterministic causal-register
  tuple to select one generation token. Descendants of a losing restore remain
  conflict records until an explicit rebase operation maps them to the winning
  generation. Updates from an older or losing generation cannot modify the
  restored entity. Concurrent restore and delete resolves to delete; causally
  later explicit restore is the only way back.
- **Device-local register.** The field never enters synchronized operations or
  cloud segments.
- **Derived field.** The field is recomputed from authoritative inputs and is
  never replicated.

### Executable field registry

Gate A produces one machine-readable, compile-time exhaustive field registry.
Every entry declares:

- registry key, root, entity, exact leaf path or dynamic-key pattern, value
  codec, nullability, and validation;
- synchronized, device-local, secret, derived, blob, compatibility, or opaque
  locality and its sole authority;
- allowed operation types and payload schema;
- merge algebra, omission semantics, explicit clear, deletion, restore, and
  relationship cascade;
- every legacy source path and deterministic migration rule;
- backup, export, redaction, and provenance behavior; and
- materialized projection and query eligibility.

The registry covers every current leaf under `feedItems`, `rssFeeds`,
`persons`, `accounts`, `preferences`, `meta`, and `desktopClient:*`, plus every
retained legacy or unknown root. Type-level leaf-path coverage makes adding a
field or public store method without a registry entry fail the build. A known
field cannot rely on a comment, a generic object merge, or an implementation
default. An unknown root or field is retained as opaque recovery evidence and
blocks cutover until a new registry version classifies it.

Relationship deletion is registered, never an implementation side effect.
Deleting a Person detaches independently durable Accounts by default. Deleting
the Person and its Accounts requires one explicit bounded
`delete_person_and_accounts` operation and receipt. Removing a feed and
deleting its items likewise requires a distinct registered bulk intent.
No boolean parameter may conceal a cascade.

### Secrets and local authorities

Provider cookies, cloud OAuth access or refresh tokens, API keys, provider
WebView session material, actor private keys, and authority private keys are
forbidden in operation payloads, blobs, segments, manifests, portable backups,
telemetry, and logs.

Contact-sync cursors and cached contact data, RSS validators and scheduler
state, provider discovery caches, provider health, social outbox execution
state, local AI health, display and graph state, cloud runtime state, and
rebuildable media caches each have an explicit local-authority registry entry,
storage owner, retention bound, snapshot or exclusion rule, and reset
semantics. Existing localStorage, Cache API, and native JSON authorities must
be migrated or explicitly retained before cutover. They cannot remain an
unregistered second database.

The current permanent `media-vault` is not a rebuildable cache. Its manifest
and every retained Meta export file form one authoritative device-local source
root with a durable generation. Migration and complete backup account for
every manifest entry and byte, or record an explicit user-visible exclusion
receipt. The importer streams ZIP members and media bytes through bounded
native staging. It cannot load a whole archive or media member into renderer
memory.

For two operations `a` and `b`:

1. If `a` causally observes `b`, `a` is later.
2. If `b` causally observes `a`, `b` is later.
3. Otherwise they are concurrent and the registered algebra decides.

This is what lets a correction made after seeing a bad fast-clock write recover
the state. A wall-clock-only last-writer-wins system cannot provide that.

Synced commands are replay-idempotent assignments, stable-element operations,
explicit deletion or restore operations, or uniquely identified events.
`toggle`, unkeyed increment, and generic JSON merge-patch commands are forbidden
at the authority boundary.

## Desktop durable store

Desktop uses stock SQLite through Rust. JavaScript does not own a SQLite
connection and does not receive an unbounded table.

At minimum, one transaction covers:

1. insert or verify the operation envelope;
2. validate the actor chain and causal frontier;
3. apply materialized entity, field-clock, relationship, and tombstone rows;
4. assign a monotone local `ingest_sequence`;
5. advance the local materializer frontier by `ingest_sequence`;
6. insert the immutable outbound operation into the cloud replication outbox;
7. update frontier commitments, touched materialized leaves, their canonical
   ancestor paths, and receipt metadata.

The transaction returns the previously committed receipt when
`operation_id` already exists. It never applies the payload twice.

HLC is conflict metadata, not queue position. A late remote operation may carry
an older HLC and still requires application. The local `ingest_sequence` alone
orders materializer work.

Cloud replication and provider side effects use separate outboxes. An ordinary
remote library mutation never enqueues or executes a provider action. A
registered `provider_intent` operation may do so only when it carries one
stable intent ID, provider, provider-account identity, target identity, action,
behavior revision, originating user authorization, and provider-authority
classification.

Exactly one eligible Desktop claims an intent for one bounded lease through a
compare-and-swap execution record. The claim, attempt identity, and preflight
receipt commit before provider contact. A completion receipt binds the intent,
claim, provider, account, behavior revision, remote result, and synchronized
acknowledgment. Response loss enters a typed unknown-outcome state. It is
reconciled from provider evidence where supported or surfaced for explicit
resolution, never blindly replayed. Claim expiry cannot authorize a second
side effect while the first outcome is unknown. Two replicas may converge on
the same intent without both executing it.

SQLite settings are selected from measured device capability, but correctness
does not vary by tier. WAL recovery, foreign keys, integrity checks, bounded
busy handling, and schema migration receipts are mandatory. Every acknowledged
authoritative write, epoch transition, schema transition, and cutover uses
`synchronous=FULL` or an equally explicit fsync protocol proven to make its
receipt durable across power loss. A derived read projection may use a weaker
setting only while Automerge remains authoritative, the projection is declared
rebuildable, and it never issues an authoritative durability receipt. Cache,
temporary storage, reader count, and mmap limits are explicit and measured.
"Let SQLite decide" is not a memory budget.

An authoritative database open treats its configured path as a literal
filesystem path, never as a SQLite URI. It selects a private page cache,
extended result codes, and `SQLITE_OPEN_NOFOLLOW`, so the connection cannot
join SQLite's discouraged process-global shared cache and the final database
component cannot redirect through a symbolic link. It resolves the
already-existing parent directory first so a system path alias such as macOS
`/var` does not make a literal final file unusable. This does not prove
parent-directory identity or authorize a production path. The later production
opener must pin and recheck its storage root independently.

Every authoritative connection lowers SQLite's general-purpose run-time limits
before compiling the checked-in schema or fixed queries. One string, BLOB, or
row is capped at 8 MiB, SQL text at 1 MiB, columns at 128, expression depth at
64, compound-select terms at 8, function arguments at 32, LIKE or GLOB pattern
bytes at 4,096, variable indexes at 64, and trigger depth at 8. Attached
databases and auxiliary SQLite statement workers are disabled. These ceilings
stay above the registered 4 MiB canonical payload and current 20-parameter
query surface while containing parser and row allocations from malformed
files or accidental future queries. They do not replace canonical payload
validation, bounded result pages, database-size policy, or the authenticated
production file locator.

On macOS, the authoritative journal also enables SQLite `fullfsync` alongside
`synchronous=FULL`. SQLite therefore requests `F_FULLFSYNC` for every commit
and checkpoint synchronization instead of relying on ordinary `fsync`, which
may return while a drive still buffers or reorders writes. The activation gate
must measure this stronger barrier's commit latency on supported storage. A
slow device does not authorize a weaker durability receipt.

Authoritative connections disable SQLite's legacy double-quoted string-literal
fallback for both schema and data statements. Checked-in SQL uses double quotes
only for identifiers and single quotes for strings. A misspelled identifier
therefore fails during preparation instead of silently becoming a string
literal with different semantics.

An existing authoritative file is inspected through a no-follow,
private-cache, read-only connection before SQLite receives writable authority.
That preflight verifies the application identity, physical version, and exact
live catalog. Foreign, future, unversioned, and changed files are rejected
without changing their database bytes or first receiving a writable database
handle. SQLite may still create ephemeral coordination sidecars while reading
a WAL-mode database. This keeps rejected database contents unchanged. It does
not yet authorize WAL configuration. The exact read-write handle repeats the
identity, version, and catalog verification before receiving that
configuration, so a path replacement between the two opens also fails without
database mutation. This does not close the separate production storage-root
handle and root-identity contract.

The dormant native projection kernel is a deliberately smaller predecessor to
this authoritative store. It consumes the same checked-in schema as the shared
TypeScript shadow-store contract, applies row upserts and deletions with one
monotone projection revision in one SQLite transaction, and binds keyset pages
and counts to that revision. A cursor from an older revision fails closed
instead of mixing projections. While Automerge remains authoritative this
derived store may use `synchronous=NORMAL`, emits no authoritative receipt, and
is fully rebuildable. Its first physical schema is versioned, `feed_page_v1`
enforces its registered 128-row ceiling and 2 MiB serialized response ceiling,
and the dormant base tier pins a 5-second busy timeout, 32 MiB page cache,
file-backed temporary work, and no mmap. The compact feed projection selects
only card fields inside SQLite. It caps media summaries at 8, tags at 32, and
content-signal tags at 32, bounds selected display strings, and never returns
full content blobs, preserved reader bodies, or the unmodelled-field escape
object. Invalid optional JSON shapes are omitted instead of coerced into
plausible card data. Shipping this dark module does not open a user database,
activate a reader, satisfy Gate B, or authorize any Gate C through Gate H
transition.

The derived store records one projection batch receipt in the same transaction
as its rows, deletions, and revision advance. Its identity is the stable batch
ID, canonical input digest, and expected previous projection revision. Exact
retry after timeout, process restart, or response loss returns the original
receipt without replaying the batch. Reusing the batch ID with a different
digest or previous revision fails closed. A batch contains between one and
1,000 combined row upserts and deletion intents. It admits one 4 MiB canonical
source document plus at most 64 KiB of bounded projection metadata, so every
valid source document can fit in one batch without weakening the source
payload ceiling. Failure to write the receipt rolls back the entire projection
transaction. Physical migrations are atomic and cannot bless an already
present table with an incompatible shape. This is derived-store retry evidence,
not a signed Library Core operation receipt. It cannot authorize a mutation,
epoch transition, bootstrap, cutover, or provider action.

Physical schema version 3 adds one crash-resumable derived rebuild record. A
rebuild binds its exact identifier to the durable source document, sorted-head
digest and count, storage generation, save revision, and expected row count.
It starts only in a fresh empty staging database at projection revision zero.
Each sequential batch commits its rows, ordinary projection receipt, batch
mapping, next batch index, projected row count, revision, and completion flag
in one transaction. Exact retry returns the durable batch receipt and current
rebuild state. A changed source, skipped batch, conflicting retry, or partial
state update rolls the transaction back.

An incomplete rebuild is not readable through feed pages or counts. The final
batch may mark the generation complete only when its cumulative projected row
count and the actual SQLite row count both equal the declared source row count.
The database remains a staging generation after completion.

The dormant native publisher accepts only distinct absolute staging and
destination paths in one directory. It requires a complete exact-source
rebuild, checkpoints every WAL frame, changes the closed generation to
self-contained delete-journal mode, passes SQLite `quick_check`, closes and
syncs the staging file, and atomically publishes it to a destination that must
not already exist. Unix creates the destination through an exclusive hard link,
syncs the parent, removes the staging name, and syncs the parent again. A crash
may retain both names for the same complete inode, never a partial destination.
Windows uses a write-through no-replace move. The destination is then reopened
read-only with no-follow semantics and the exact complete rebuild is verified
again. That readback is the response-loss recovery path.

Publication creates one immutable generation file. It does not select that
generation for a reader, replace an existing generation, clean an abandoned
staging file, authenticate the production storage root, or grant reader
authority. The later native adapter must bind the trusted storage-root handle
and commit the registered generation transition before any surface can read
the published file.

The dormant Desktop derived-shadow projection probe exposes this input through
one bounded worker session. Session admission binds the exact durable
Automerge document ID, the SHA-256 digest and count of its sorted heads, and the
storage generation and save revision. Every new batch reloads the current
durable binary, reproduces that complete source identity, and fails closed if
it changed. A document commit invalidates the session before the new document
becomes visible.

One session retains only sorted entity IDs capped at 250,000 entries and
16 MiB, plus its most recent response batch. It returns at most 1,000 rows and
4 MiB per batch, rejects an individual row that cannot fit, permits exact
replay of only the most recent batch after response loss, and rejects skipped
or reordered batch indexes.
After each request drains, the worker releases the decoded Automerge document.
The next batch may pay another decode cost, but an abandoned migration cannot
pin the complete document in memory. No main-thread adapter consumes these
responses yet. This compatibility probe still uses `Automerge.load` and
therefore cannot satisfy the external-memory Gate C migration contract,
produce an authoritative migration candidate, or authorize storage cutover. It
does not open SQLite, create a projection receipt, change the active Automerge
writer, or contact a provider.

Blob content is content-addressed and may live outside hot tables. Before an
authoritative row may reference a new external blob, native code writes and
fsyncs a temporary file, atomically renames it to the content-addressed path,
and fsyncs the parent directory. Only then may the `synchronous=FULL` database
transaction commit the reference and acknowledgment. A crash before the
database commit can create only a safe orphan.

Startup replays only the durable staging and recovery journal under explicit
item and elapsed-time budgets before the interface becomes available. It never
walks or hashes the complete blob corpus. A row with a blob reference becomes
visible only after that exact blob's identity, length, and digest verify on
first read or through an already durable verification receipt. Missing or
corrupt bytes quarantine the affected transaction and entity and return a
typed unavailable result without blocking unrelated library rows. Remaining
integrity work runs through a resumable, bounded background queue with a
durable cursor, per-batch limits, cancellation, and restart recovery. Orphan
cleanup runs only from verified reachability, never inside the user mutation
transaction or the blocking startup budget.

Nonauthoritative device caches use collision-resistant keys derived from
library ID, entity ID, entity generation, and content digest. Their manifests
bind original identity, digest, byte length, media type, creation time, and
last access. Replacement is temp-write, fsync, atomic rename, parent fsync, and
manifest commit. Reads verify identity, length, and digest; mismatch is a miss
and quarantine, not accepted content. Each cache has a byte and entry limit
with bounded LRU eviction. Eviction can never remove the only authoritative
copy.

The current reader-content cache is not presumed rebuildable. For new captures
it may contain the only complete HTML body, and its sanitized filenames are
not injective. Migration accounts for every file, maps it through explicit
original entity identity plus content digest, and promotes verified bodies to
authoritative Library Core blobs. If multiple current entity IDs sanitize to
one path, the bytes remain ambiguous conflict evidence and silent assignment is
forbidden.

## Query boundary

The UI store contains only:

- the active page or bounded result window;
- aggregate counts needed by visible navigation;
- selected entity detail;
- small device-local interface state;
- query cursors and versions.

It never contains the complete item, person, account, or content corpus.

Every query declares:

- query schema version;
- stable sort and tie-break keys;
- limit and maximum allowed limit;
- opaque cursor;
- selected columns;
- whether full content is allowed;
- cancellation identity;
- source epoch number, globally unique epoch ID, and frontier digest.

Query kind, request schema, response DTO, projection, row and byte maxima,
sort, cursor version, total-count semantics, cache budget, invalidation keys,
and supported adapters form one exhaustive versioned registry. Adding an
unregistered full-corpus read or a query without hard limits is a type or build
failure.

A bounded query applies keyset predicates, projection, and limit inside the
storage engine before row decoding or collection. The engine may scan an index
or compute an aggregate internally, but Rust, WASM, workers, service workers,
and renderers cannot decode, sort, collect, or transfer an unbounded candidate
set and slice it afterward. Nested collections have independent limits or
separate paged detail queries.

Counts, search, Friends graph inputs, map inputs, archive operations, and export
enumeration are native queries. A selector that scans all items in React or
Zustand is a regression. A bulk action sends a registered normalized predicate
plus expected revision. Native storage atomically freezes its selected-set
digest, count, durable membership or immutable checkpoint, and bulk intent,
then executes only that frozen membership through the bounded transaction
contract. The renderer never enumerates an unbounded ID set.

Capture, import, and reconciliation writes return an exact bounded receipt with
revision and attempted, inserted, updated, unchanged, removed, and failed
counts. Optional returned IDs have a hard cap. Before-and-after corpus scans
are forbidden for accounting.

Read cutover requires an exhaustive inventory of every full-corpus consumer,
including navigation, settings, content fetch, capture accounting, provider
action derivation, diagnostics, import, export, and backup. Gate D converts
every product reader. After Gate D, the only registered full-document consumers
are the isolated legacy migration and replication bridges under `Legacy
bridge`. They are short-lived, never populate UI state, and obey explicit
worker memory budgets until Gate E removes the legacy full-document sync
bridge. Moving only the feed leaves the memory architecture unchanged.

Cursors use keyset pagination and bind the query kind, normalized filters,
sort order, storage epoch number, globally unique epoch ID, query generation,
and snapshot revision. Offset pagination is forbidden for mutable library
views. A follow-up page either reads the same pinned storage snapshot or
returns typed `CURSOR_STALE` when epoch, generation, revision, query version,
normalized filters, projection, or sort no longer matches. It never applies an
old keyset cursor to a newer materialization. Every response returns its
revision and next cursor. Equal sort tuples use entity ID as the final strict
key.

### Default feed-page protocol

`feed_page_v1` currently names one exact dormant query only: the visible,
nonhidden, nonarchived chronological page already implemented by the native
projection reader. Its request carries the query and schema versions, one
reader-session ID, one cancellation ID, a limit from 1 through 128, and an
optional opaque cursor. It accepts no undeclared filter field.

The current renderer and future bounded adapters share one canonical version 1
browse-filter predicate. Normalization preserves exact strings, snapshots and
binary-sorts set-like tag and signal inputs, and pins hidden, archived,
platform, RSS identity, author, feed URL, post/story, saved, tag, and signal
semantics. The renderer normalizes once per browse pass and applies the same
predicate without allocating one adapter object per item. This closes the
semantic filter definition. `feed_page_v1` remains the narrower default page.
The dormant PWA browse projector now applies every normalized predicate while
building a query-specific IndexedDB generation, including archived and hidden
variants without changing the default generation. A later registered query
must still bind that normalized filter to its request and cursor, implement the
same execution in SQLite, and prove exact result parity before a product reader
can use it. Recommendation ordering is not silently approximated. Version 1
preserves the current two stable passes exactly: published time descending,
then computed priority descending.
The complete order is therefore priority descending, published time
descending, then source-map enumeration sequence ascending. Both current
workers use one shared comparator contract. A bounded adapter must compute
priority from one generation-bound clock, retain the source enumeration
sequence, push the full order into its storage query, and bind the order
version and clock identity to its cursor. The dormant PWA projector now freezes
one safe ranking clock, retains source sequence, and writes the complete order
tuple into its IndexedDB compound key. The bounded browse request and cursor
that consume those rows are now registered as `feed_browse_page_v1`.

The request carries one bounded canonical filter, one safe ranking clock, the
recommendation-order schema version, one reader-session identity, one
cancellation identity, a limit from 1 through 128, and an optional opaque
cursor. The cursor binds the authenticated generation plus priority, published
time, source sequence, and UTF-8 entity identity. The selected generation
stores the same canonical filter, clock, and order version. Any mismatch fails
closed instead of applying a cursor to a differently filtered or scored
generation. The PWA worker transport exposes the request, response, and shared
exact cancellation path, but no product surface calls them.

The dormant native browse store now closes the physical SQLite half of that
same query. One immutable generation stores the exact source document ID,
sorted-head digest and count, transition and projection revisions, canonical
filter JSON, ranking clock, recommendation order version, and total row count.
The generation digest is therefore not the native layer's only source proof.
Pages admit at most 128 compact rows and 2 MiB of encoded input, retain exact
replay receipts, and become readable only after the declared, receipted, and
physical row counts agree. SQLite performs
the complete priority-descending, published-time-descending,
source-sequence-ascending, binary-identity-ascending keyset order through one
checked index without a temporary sort. The private connection uses a 4 MiB
page cache, disables mmap, and spills temporary work to disk. An existing file
must pass a read-only application and schema identity preflight before writable
configuration. Compact card JSON is identity-checked and byte-bounded at this
layer. The later transport adapter must still authenticate the source and
validate the shared closed feed-card DTO before insertion.

Freed Desktop now exposes this primitive through a dormant writer transport.
It admits one session-bound active generation, and begin, append, finalize,
and cancel return the exact durable next batch, written row count, declared
row count, and completion state. An exact begin retry after response loss
returns the live stored progress. A changed binding or cross-session write
fails closed. Explicit cancellation drops the connection without selecting
the partial generation. Factory reset also quiesces any active writer before
removing the derived browse directory.

The dormant Desktop worker materializer now authenticates the exact Automerge
document ID, sorted heads, storage generation, save revision, normalized
filter, ranking clock, and recommendation-order version before it opens the
native writer. It counts visible rows without retaining their identities, then
projects the source through one iterator and one replayable page capped at 128
rows. Every compact card passes the shared closed parser before transport.
The main-thread adapter forwards those pages to SQLite, resumes an exact
receipted append or finalization after response loss, and cancels both sides
on failure. It does not retain a corpus-sized ID or row array.

The first Desktop product caller retains the same transport and native
receipts, but now sources the query-specific generation from the authenticated
selected SQLite shadow rather than the renderer item array. It scans one
generation once for the exact filtered row count and once for bounded
projection output, retaining at most one native item page and one replayable
128-row browse page. The renderer retains the source-map enumeration IDs needed
for the exact Automerge tie-break plus compact ranking metadata. Incremental
patch responses identify source additions and removals so that tie-break
remains exact without a corpus rescan. State or source movement fails closed
before publication. This is an interim Gate D memory correction. The default
renderer no longer hydrates the legacy item corpus. A remaining compatibility
lease streams exact lossless rows from the authenticated selected SQLite
generation, restores canonical source enumeration and product ranking, and
clears the temporary renderer array after the final consumer releases it. It
does not ask the Automerge worker to clone or broadcast its item projection.
An unavailable or stale derived generation temporarily falls back to the
authoritative Automerge projection and returns to SQLite after the next
successful selection. Those compatibility consumers remain unbounded Gate D
debt until each becomes a registered
aggregate or paged query. Append-style Automerge change chunks still require
the native external-memory decoder, and Automerge remains authoritative.

The authenticated SQLite facet summary also returns the exact count of items
carrying Freed's internal sample-data fingerprint. Settings and blank-state
sample controls use that count, so neither surface leases the full compatibility
corpus merely to decide whether cleanup is available. Story Wall uses a
source-fenced SQLite candidate query that admits only visible, nonarchived rows
with media, returns at most 250 complete candidates, and fails closed to the
compatibility reader when the exact result would exceed that bound. Its existing
product filters and manifest builder still run over the complete candidate set.
Saved overview analytics use a source-fenced SQLite aggregate over the selected
generation. JavaScript supplies the same seven local-day and 24 local-hour
windows as the legacy view. Native code streams Saved rows once and returns only
the exact visible total, latest timestamp, bucket counts, source counts, and content
mix. One exact adjacent repeated local-hour window at a spring-forward
daylight-saving transition remains valid because the compatibility view
constructs each bucket independently.
The renderer applies its locale-aware ordering after receipt and never
leases the compatibility corpus on a successful native read. Malformed legacy
fields, stale source identity, response overflow, or an unavailable native
reader fail closed to the exact compatibility reducer.

Friends activity, graph summaries, suggestions, selected-person timelines, and
Friend detail map inputs now use three registered source-fenced SQLite readers.
`persons_graph_v1` accepts
at most 5,000 unique social or RSS source keys, returns no item bodies, and
retains only exact item and recent-window counts, the fixed signal vocabulary,
latest activity, location presence, bounded avatar data, and five sample item
identities per source under an 8 MiB response ceiling. Sample order is
published time descending and binary item identity ascending. The shared
suggestion scorer consumes those aggregates through the same calculation used
by compatibility item evidence. Each source summary also publishes the complete
current-visible location candidate count and at most eight candidate identities,
published timestamps, and effective timestamps at the graph reference time.

`person_timeline_v1` pages compact cards 50 rows at a time, admits at most 100
rows per request and 2 MiB per response, returns the exact matching total, and
binds its canonical cursor to the selected generation and exact source-set
digest. The Friend detail renderer retains only the current 50-row window, can
walk every older page, and can return explicitly to the newest page. Hidden rows
stay excluded and archived rows remain eligible, matching the existing Friends view.
The exact location-item reader resolves every advertised candidate for the
selected Friend under the same graph source token. It validates source ownership,
identity, published and effective timestamps, visibility, and location presence,
then supplies that lossless bounded set to the existing map resolver separately
from the current 50-row timeline page. Missing summaries, count mismatch,
malformed or duplicate candidates, more than eight combined candidates, or equal
published and effective timestamps fail closed to compatibility. Equal timestamps
remain ambiguous because the compatibility resolver preserves source order rather
than applying the timeline's binary identity tie-break. Standalone account detail
does not perform location reads or acquire a location compatibility lease.

All three readers recheck the complete Automerge source
identity before and after native work. Duplicate sources, stale generations,
malformed aggregates, count drift, cursor mismatch, or response overflow fail
closed to one shared reference-counted compatibility lease. A successful retry
releases that lease. The device-local
`freed.libraryCore.friendsReaderV1.disabled=1` switch selects compatibility
before native work. The Friend editor scans the same authenticated generation
through source-fenced 64-row item pages. It retains only the alphabetically
best 50 compact visible unlinked authors matching the current search after a 150 ms
debounce. It publishes no candidate until the scanner closes its final source
fence. Saving a newly linked profile runs one final source-fenced pass that
retains only the selected identities and their exact first and last capture
provenance. A stale, canceled, or unavailable scan fails closed without
acquiring the compatibility projection. The device-local
`freed.libraryCore.friendEditorReaderV1.disabled=1` switch explicitly restores
the prior compatibility lease. The PWA keeps its current in-memory reader until
its IndexedDB product cutover.
Provider settings scan the same authenticated selected generation through the
source-fenced 64-row item scanner. Facebook group repair carries one compact
group-ID winner set across pages. Facebook and Instagram media backup stage
only bounded compact candidate pages in one temporary local JSONL file. It
performs no provider work until the scanner closes its final source fence, then
streams and archives one staged page at a time. YouTube synchronization retains
deduplicated visible saved-video identities, not `FeedItem` rows. The normal
path never acquires the compatibility projection.
A background item-scan session remains capped at 60 seconds, but its exact
generation, transition, projection, and item-bound cursor may reopen the same
currently selected immutable generation after expiry. A changed selection or
cursor mismatch remains stale and reserves no reader session.
A stale source, malformed row, unavailable native reader, or canceled scan
fails closed without reporting success or starting provider work. The
device-local `freed.libraryCore.providerSettingsReaderV1.disabled=1` switch
explicitly restores the existing compatibility view before native work. The
SQLite path uses stable global-ID order for deterministic user-triggered
batches. These reads do not add automatic provider work, change cadence, or
make Automerge anything other than the active authority. Specialized feed
modes remain compatibility consumers pending their own registered bounded
queries.

SearchJump now uses one bounded, source-fenced 64-row scan for exact Library tags,
archive totals, and complex scope counts, plus compact native aggregates for
simple feed scopes. It fetches only the selected item detail.
On the healthy default native path, opening or typing in the palette does not
acquire the renderer compatibility projection. A canceled scan stops at the
next bounded page, and a changed source
version cannot publish an older item detail. The device-local
`freed.libraryCore.searchJumpReaderV1.disabled=1` switch restores compatibility
hydration. Until the native frozen-predicate bulk mutation contract lands, an
actual no-query mark-read or archive command acquires the shared compatibility
projection only for the existing Automerge mutation and releases it afterward.
That execution bridge remains Gate D debt because the renderer still enumerates
the exact bulk IDs. Automerge remains authority.

The Freed Desktop ordinary all-content feed, when no search is active and
neither Saved-only nor Friends mode is selected, now reads the authenticated
selected SQLite generation through the bidirectional `feed_browse_page_v3`
request. Version 3 leaves the closed `feed_browse_page_v1` and
`feed_browse_page_v2` request and response shapes unchanged. Version 1 remains
the PWA-facing all-content contract and the cross-runtime cursor vector.

Version 3 adds one explicit `direction` of `next` or `previous`, and returns
both traversal edges as `previousCursor` with `previousOrder` alongside the
existing `nextCursor` and `nextOrder`. Both edges bind the same immutable
generation digest, transition sequence, and projection revision as the response
source, and each binds the exact row it names: the leading edge binds the first
returned row and the trailing edge the last. A page with no rows carries no edge
on either side. A backward request without a cursor fails closed, because a
backward page is defined only relative to a known leading row and there is no
last-page entry point. A malformed direction, a cursor that decodes to another
generation or revision, an oversized page, or a V2 generation scope presented as
a V3 filter all fail closed before any row is read.

Both directions walk the same canonical priority-descending,
published-time-descending, source-sequence-ascending, binary-identity-ascending
order through the same unique physical index. The backward predicate is the
exact mirror of the forward one, so the two directions cannot disagree at a page
boundary, and the query plan uses that index without a temporary sort. A
backward scan collects rows nearest the cursor first and restores canonical
order before returning, so the response byte ceiling truncates the rows furthest
from the cursor rather than the ones adjacent to it. A non-null edge proves only
that the page filled its limit, exactly as a full forward page may be followed
by an empty one; one further read in that direction terminates with an empty
page. A bidirectional session is not retired when it reaches the forward end,
because the reader still owns resident pages the user can scroll back through.

React retains at most two whole reader pages, and ReaderView may pin exactly one
selected compact card outside that window. Traversing past the retired 512-row
threshold is ordinary traversal, not a fallback condition: the all-content feed
no longer reacquires the full renderer compatibility projection when the user
scrolls deeply. Scrolling back toward the head restores an evicted leading page
through a bounded SQLite read and evicts the trailing one, and the visible list
stays anchored to the same card in both directions. Resident source offsets are
tracked independently of optimistic removals, so a local archive or unsave
cannot shift the offsets the reader resumes from. Read, like, save, archive, and
provider-receipt updates continue to patch resident and pinned cards without
reopening the generation.

Source drift, a contract or integrity failure, native failure, or the
device-local `freed.libraryCore.feedBrowseBidirectionalReaderV1.disabled=1`
switch restores the exact Automerge compatibility feed. That rollback returns
the ordinary feed to the compatibility projection rather than to a forward-only
bounded reader, because without reverse paging an evicted leading page would
lose rows the user can scroll back to. The existing
`freed.libraryCore.feedBrowseReaderV1.disabled=1` switch also still applies.
Feed search, the PWA, Friends, and Saved remain on their current contracts.
This is an active Gate D SQL read transition. Automerge remains authority, and
the transition adds no provider request, cadence, navigation, cookie, header,
writer, cloud, backup, or replacement-replication behavior.

The Freed Desktop Friends-only feed, when no search is active and Saved-only is
not selected, now reads the authenticated selected SQLite generation through
`feed_browse_page_v2`. Version 2 leaves the closed
`feed_browse_page_v1` request and its all-content callers unchanged. Its
generation binding adds `identityMode` and `friendsPredicateSchemaVersion` to
the normalized filter, ranking clock, recommendation-order version, exact
document identity, heads, storage generation, and save revision. The live
Friends route sends `identityMode: "friends"` with predicate schema version 1.
It does not send a renderer-derived author list or a separate identity-set
digest. The cursor remains bound to the immutable generation and source
revision.

Friends predicate version 1 preserves the current Person-first compatibility
semantics exactly. The first matching social Account in current source order
resolves a Person. When that Person exists, only its `relationshipStatus`
decides membership, so a non-friend Person shadows a matching legacy Friend
source. A missing or unlinked Person falls back to any matching legacy Friend
source. Later duplicate Account matches are ignored. The exact authenticated
Automerge snapshot and its source order therefore remain part of the predicate
input. The source-fenced Desktop materializer applies that predicate before it
publishes the query-specific generation. It derives exact source positions with
one map capped to the current 64-row native scan page instead of retaining a
corpus-sized index. SQLite then uses the existing priority-descending,
published-time-descending, source-sequence-ascending, binary-identity-ascending
order and returns at most 128 compact rows under the 2 MiB response ceiling.
Relationship, ordering-relevant item, and ranking-weight changes invalidate the
reader identity and rebuild one exact source-bound generation. Harmless read,
like, and provider-receipt patches update the resident Friends pages and pinned
card without reopening the generation. React retains only two feed pages plus
at most one selected compact card, so page eviction cannot dismiss the existing
ReaderView selection and hydration path. Source drift,
predicate-version mismatch,
malformed pages, native failure, or the device-local
`freed.libraryCore.friendsFeedReaderV1.disabled=1` switch restores the exact
Automerge compatibility feed. The PWA remains on its current Automerge reader.
Friends search and the combined Friends plus Saved mode remain compatibility
consumers pending their own bounded query contracts.
This is an active Gate D SQL read transition. Automerge remains authority, and
the transition adds no provider request, cadence, navigation, cookie, header,
writer, cloud, backup, or replacement-replication behavior.

The Freed Desktop Saved feed now reads the authenticated selected SQLite
generation through the registered `saved_feed_page_v1` source-fenced reader.
It preserves the four user-facing modes: `date_saved`, `date_published`,
`recommended`, and `shortest_read`. The first SQLite Saved ordering contract is
explicitly versioned. Equal keys use binary global-ID order instead of retaining
the legacy renderer input sequence or locale comparator. Recommended order
recalculates priority at one pinned ranking clock, then orders equal priorities
by raw publication time and binary global ID. The Freed Desktop compatibility
fallback recalculates and orders at that same clock. The PWA retains its existing
Saved ordering. This is an intentional Gate D ordering standardization, not a
claim of byte-for-byte legacy tie parity. The query-specific materializer
performs source-fenced scans with at most 64 rows resident per scan, retains only
matching Saved compact rows, and does not build a corpus-sized source-position
index. It preserves `savedAt` plus `readingTime` in the compact DTO.
Each reader page returns at most 128 compact rows. React retains
at most the current and adjacent feed page, for at most 256 compact feed rows,
and replaces that window as the user traverses the complete Saved result
forward. Crossing a prior 512-row compatibility threshold is no longer a
fallback condition. ReaderView may pin exactly one selected compact card after
its feed page is evicted. Selection continues through the existing ReaderView
local-content and hydration path. This slice adds no item-detail query. Source drift,
malformed pages, native failure, or the
device-local `freed.libraryCore.savedFeedReaderV1.disabled=1` switch restores
the Automerge compatibility path. Ordinary forward traversal does not.
Selection and cleanup are distinct recovery boundaries. Cleanup holds the
registry write transaction while choosing and deleting retired generations,
accepts only single-component paths under the canonical generation root, and
in steady state retains the current generation plus its exact rollback. A
cleanup failure after selection commits cannot undo or ambiguously fail that
selection. Any extra retired rows or files remain non-authoritative and cleanup
retries on the next selection.
Automerge remains authority. This reader adds no provider request, cloud
publication, writer, replication, release, or installation behavior. It is an
active Gate D SQL read transition recorded in the activation manifest.

The cursor is versioned binary data encoded as canonical unpadded base64url. It
binds the immutable generation digest, transition sequence, projection
revision, nonnegative chronological sort key, and final entity ID. The maximum
entity identity produces a cursor of at most 5,540 bytes. A response carries
the same source identity, at most 128 compact feed-card rows, the exact visible
row count for its pinned projection, and an optional next cursor bound to that
source and final row. The response ceiling is 2 MiB after JSON serialization.

The compact projection excludes preserved reader bodies and every unmodelled
escape object. It bounds media URLs and types at 8 each, tags at 32, and content
signal tags at 32, with independent scalar and UTF-8 byte ceilings per string.
Protocol parsers accept only closed plain data records and dense undecorated
arrays, snapshot every retained value, reject invalid Unicode, accessors,
unknown fields, negative or unsafe numeric values, and impossible totals, and
measure the exact serialized ceiling one bounded row at a time without
constructing a second page-sized JSON string. They never retain caller-owned
arrays. The dormant Freed Desktop runtime now implements this exact protocol
without assigning a product reader. It opens only an already-selected
authenticated immutable generation, admits at most two concurrent reader
sessions, pins each session for at most 60 seconds, fixes each SQLite page cache
at 2 MiB, and releases the session on exact cancellation, cursor exhaustion, or
expiry. Authenticated generation handles may remain cached after a logical
session closes, but the pool remains capped at two handles, avoids a corpus-file
rehash on every short feed refresh, and is fully quiesced before factory reset.
TypeScript and Rust share one exact canonical cursor vector.

The dormant PWA runtime implements the same protocol over a row-oriented
IndexedDB generation. An explicit dormant worker request derives one generation
identity from the exact committed Automerge heads and storage revision, then
scans the immutable feed map twice without constructing a corpus-sized key,
value, row, or sort array. The first pass counts visible rows. The second
reproduces the native visibility and compact feed-card projection rules one item
at a time and sends unsorted pages of at most 128 rows to IndexedDB. The
compound row key performs final keyset ordering without a renderer sort. Each
page has an exact SHA-256 replay receipt, generation-plus-entity uniqueness,
contiguous batch identity, and a durable cumulative row count. Selection
becomes visible in one transaction only after the staged and physical row
counts equal the declared total. Restart can resume the next page, exact page,
completed materialization, and finalization replays are idempotent, and a new
selection retains at most one complete rollback generation. Dedicated bounded
request and response kinds in the existing Automerge worker transport admit at
most two logical sessions for 60 seconds, reject an expired or replaced source,
bind exact cancellation identity, and release an exhausted cursor. IndexedDB
order keys encode entity IDs as canonical UTF-8 byte hex so their final
tie-break ordering matches SQLite binary collation instead of browser UTF-16
string ordering. The authenticated source permits at most 256 distinct
lowercase Automerge heads and hashes its exact storage generation, save
revision, sorted head set, and projection domain before any derived row becomes
selectable.

Both platform runtimes are now implemented, so
`runtime_adapter_unimplemented` is resolved for `feed_page_v1`.
The product filter predicate is now defined once and used by the current
renderer. The current recommendation order is also defined once and used by
both active workers. The PWA now also persists exact filtered recommendation
order in a separate query-specific IndexedDB generation while holding at most
one 128-row output page, then serves it through the closed dormant browse
protocol. Desktop generation selection and the native browse reader now serve
the default product feed through bounded pages. Desktop full-text search also
streams the authenticated selected SQLite generation twice: once to build its
disposable MiniSearch term index and once to retain the first 100 matching rows
in the existing priority-plus-relevance order while counting every match. The
scanner shares one in-flight build across feed, header, and command surfaces,
keeps only one 64-row lossless page during traversal, and discards the index
when the query clears. The input renderer corpus is never indexed or copied on
that path. Renderer-cache eviction and the remaining product readers are still
absent, so `adapter_proof_missing` still blocks the query and Gate D remains
inactive. Authenticated PWA materialization, runtime registration, and shared
semantic contracts likewise do not activate Gate D on their own.

An interactive cursor does not pin an unbounded SQLite read transaction or WAL.
If an adapter uses a pinned snapshot, the query registry declares its maximum
age, memory or disk budget, release behavior, and crash cleanup. Cancellation,
disconnect, cursor exhaustion, or expiry releases it. Expiry returns
`CURSOR_STALE`. Export, backup, and migration use separately registered durable
checkpoints rather than stretching an interactive cursor indefinitely.

A replacement search query must prove matching and stable-order compatibility
with the current product behavior. If the native engine cannot reproduce that
behavior within the budget, the change uses a new query version and an explicit
product decision. It does not silently reinterpret a search.

Initial hard bounds:

- feed page: 128 rows;
- search page: 100 hits;
- search snippet: 512 characters;
- ordinary serialized response: 2 MiB;
- streamed reader-body chunk: 256 KiB;
- retained feed pages: 2;
- retained compact summaries: 512;
- retained reader bodies: 16 entries and 16 MiB total.
- Friends overview or native timeline request: 100 rows;
- active Friend detail renderer window: 50 rows;
- Friends graph result: 5,000 total nodes and edges with level of detail;
- map result: 1,000 markers or clusters;
- Story Wall candidate page: 250 rows;
- provider-media page: 250 rows;
- feed-card nested collections: 8 media summaries, 32 tags, and 32 signal
  summaries;
- interactive pinned snapshot: 60 seconds and 16 MiB;
- change-feed batch: 512 changed entity IDs and 128 invalidation keys;
- content-fetch claim: 50 rows;
- semantic-classification claim: 100 rows;
- provider-action claim: 25 rows;
- repair-work claim: 50 rows.

Feed cards never embed full preserved bodies, evidence collections, highlights,
or other unbounded nested data. Full reader content is ID-addressed and
streamed.

The renderer's Library Core DTO state budget is 48 MiB settled and 64 MiB
burst. Every cache reports cardinality, bytes, hits, misses, and evictions.
Reset, restore, and epoch cutover advance the query generation so a stale
completion cannot repopulate a newer UI state.

Stores subscribe only to a compact change feed containing revision, bounded
changed entity IDs, invalidated query or facet keys, and `resetRequired`. It
carries no hydrated entity rows. Overflow, loss, epoch change, or unsupported
revision emits `resetRequired`; consumers rerun registered queries. No worker
broadcasts a complete corpus after mutation.

Content fetch, semantic classification, provider-action derivation, and repair
work use durable bounded claim, lease, acknowledgment, and failure queues.
Restart and response loss recover by stable work ID rather than rescanning the
library. Query cutover does not alter provider authorization, cadence, or
side-effect execution.

## PWA durable store

The PWA implements the same logical operation and materialization contract
behind one browser storage adapter. IndexedDB is the required MVP engine. It
stores bounded record pages, tombstones, search postings, cursors, intent
queues, and result receipts without holding the corpus in JavaScript memory.

SQLite WASM with OPFS may be added later as a measured adapter only after the
supported browser matrix proves:

- durable reopen and crash recovery;
- worker-only access where required;
- migration across application versions;
- bounded memory on target iOS, Android, and desktop browsers;
- correct behavior without cross-origin isolation where Freed must run;
- a visible answer from `navigator.storage.persisted()`.

The future adapter must pass the same conformance suite and rebuild from
immutable cloud objects into a verified generation. It never mutates or
translates an active IndexedDB store in place.

Freed requests persistent storage when the user enables a local library and
reports whether the browser granted it. A denial is a durability warning, not a
silent success.

One dedicated worker owns the PWA adapter connection. Tabs, service workers,
and obsolete application versions are fenced from concurrent local intent
writes. Existing but unreadable storage enters recovery, never an empty-library
bootstrap.

IndexedDB commits each intent envelope, local rows, tombstones, ingest cursor,
receipt, and intent outbox atomically before acknowledgment. Its crash proof
injects failure at every adapter-specific commit boundary and reopens the
store. A future SQLite WASM adapter cannot borrow IndexedDB or Desktop evidence.

## Replication protocol

`op_segments_v1` stores immutable, content-addressed operation segments and a
small compare-and-swap manifest.

Each segment contains:

- library ID, epoch number, globally unique epoch ID, schema version, and
  encoding version;
- exact actor range starts and ends as
  `{ actor_id, sequence, operation_id, chain_digest }`;
- branch-qualified accepted causal frontier and separately quarantined tips;
- ordered canonical operation envelopes;
- previous segment references where applicable.

A segment contains at most 1,000 operations or 4 MiB of canonical uncompressed
bytes in the initial protocol. Compression is versioned, while identity always
hashes the canonical uncompressed `segment_body`, which omits every derived
digest and byte count. An outer header carries the body digest, encoded-body
digest, uncompressed byte count, and encoded byte count. The encoded digest
hashes only the encoded body, not its own header. Fetch, decompression, and
parsing enforce compressed size, expanded size, operation count, nesting, and
string limits before materialization.

```text
segment_digest = D("segment-body", segment_body)
encoded_body_digest = DB("segment-encoded", encoded_body_bytes)
```

The manifest contains:

- protocol, epoch number, and globally unique epoch ID;
- persistent authenticated roots for live segments, retained history, accepted
  actor tips, quarantined branch tips, verified checkpoints, checkpoint
  promotions, compaction receipts, enrollments, and retirements;
- a required nullable repair receipt digest for a repair target genesis;
- monotone manifest generation;
- the previous manifest content digest, authentication digest, and generation;
- required nullable signer actor ID and enrollment-certificate digest.

The canonical `manifest_body` omits the transition-certificate digest,
manifest digest, and signature. Its literal closed schema is:

```text
manifest_body = {
  protocol: "op_segments_v1",
  epoch,
  epoch_id,
  schema_version,
  live_segments_root,
  retained_history_root,
  accepted_actor_tips_root,
  quarantined_branch_tips_root,
  snapshot_checkpoints_root,
  checkpoint_receipt_promotions_root,
  compaction_receipts_root,
  actor_enrollments_root,
  actor_retirements_root,
  repair_receipt_digest,
  generation,
  previous_manifest_digest,
  previous_manifest_auth_digest,
  previous_manifest_generation,
  signer_actor_id,
  signer_actor_enrollment_certificate_digest
}

manifest_digest = D("manifest", manifest_body)

actor_manifest_signature = S(
  "manifest",
  actor_private_key,
  {
    transition_certificate_digest,
    manifest_digest
  }
)

genesis_authority_signature = S(
  "manifest-genesis-authority",
  target_authority_private_key,
  {
    transition_certificate_digest,
    manifest_digest,
    target_authority_key_id
  }
)

manifest_auth_body = {
  authorization_kind:
    "actor_signature" | "transition_genesis_authority_signature",
  transition_certificate_digest,
  manifest_digest,
  signer_actor_id,
  enrollment_certificate_digest,
  authority_key_id,
  signature
}

manifest_auth_digest = D("manifest-auth", manifest_auth_body)
```

Each root is one `authenticated_object_set_root_body` with the corresponding
registered `set_kind`. Live and retained segment entries contain
`{ segment_digest, encoded_body_digest, uncompressed_byte_count,
encoded_byte_count }`, keyed by decoded segment digest. Accepted and
quarantined tip entries use the canonical causal-tip tuple as key and body.
Checkpoint entries are
`{ checkpoint_digest, storage_root_digest, canonical_byte_length }`, keyed by
decoded checkpoint digest. Promotion and compaction entries use their
field-specific receipt tuple. Enrollment and retirement entries are keyed by
actor ID and certificate digest. Every storage root, entry digest, count, sort
key, and reachable node recomputes exactly.

Checkpoint receipt promotions use the exact equality rules under `Snapshot and
restore`. `repair_receipt_digest` is non-null exactly for a target genesis
manifest whose transition reason is `actor_fork_repair` or
`clock_quarantine_repair`, and it equals that transition's receipt. Every other
manifest sets it null. A normal manifest that moves a live segment or blob
root into retained history includes exactly the compaction receipt whose
predecessor, generation, replacement checkpoint, and resulting root
descriptors authorize that move. Physical removal from retained history still
requires the exact actor acknowledgments below.

`C(manifest_body)` is at most 1 MiB. Its size is independent of retained
history and library contents. A publication rewrites only changed
authenticated-set paths and the fixed-size manifest. There is no
65,536-member terminal cap and no collection-size condition that refuses a new
publication. Checkpointing bounds active replay work. An offline but unretired
actor can block physical deletion from retained history, not checkpointing,
manifest publication, provider sync, or ordinary writes.

The immutable authentication object is
`{ manifest_auth_body, manifest_auth_digest }`. Manifest content can therefore
be uploaded and closure-verified before the target transition exists. After the
transition certificate digest is known, the applicable signer signs the exact
content and the authentication object is uploaded and read back before the
compound authority compare-and-swap.

`manifest_body` carries required nullable `previous_manifest_digest`,
`previous_manifest_auth_digest`, and `previous_manifest_generation` fields.
Only the first library genesis manifest has all three null and generation zero.
Every other manifest, including an epoch's target genesis manifest, sets those
three fields to the exact current compound cloud tuple and sets its own
generation to `previous_manifest_generation + 1`. Partial nullability,
generation gaps, reuse, or overflow is invalid. A normal publication requires
the predecessor fields to equal the current same-epoch tuple before
compare-and-swap. A target genesis manifest requires them to equal the exact
source tuple bound by the transition certificate. Starting from the current
cloud tuple, a verifier can therefore fetch each content-addressed manifest and
its exact winning authentication object and walk an unambiguous authenticated
predecessor chain across epoch transitions. Another valid signature over the
same manifest content is not accepted history unless the current tuple or its
authenticated successor names that exact authentication digest.

For `actor_signature`, `signer_actor_id` and
`enrollment_certificate_digest` are required, `authority_key_id` is null, both
actor fields equal the corresponding non-null fields in `manifest_body`, and
`signature` equals `actor_manifest_signature`. The verifier fetches the
content-addressed enrollment certificate by digest before authenticating the
manifest, recomputes and verifies that object, verifies that the actor is active
for the manifest epoch, then verifies the signature.

For `transition_genesis_authority_signature`, both actor fields are null in the
auth body and manifest body, `authority_key_id` equals the transition's exact
target authority key ID, and `signature` equals
`genesis_authority_signature`. This form is valid only for the target genesis
manifest named by that same transition certificate. The compound transition
verification checks the target-key proof and this signature atomically before
installing either object. The target key and genesis signature gain no
independent authority if the transition loses. Every later manifest uses
`actor_signature`.

The manifest's actor-enrollment and actor-retirement certificate digest sets
are unique and sorted by decoded digest bytes. Every object is uploaded,
fetched back by digest, and verified before a manifest that depends on it may
win compare-and-swap. The enrollment set contains the manifest actor's
certificate for actor-signed manifests and every certificate needed to validate
live or quarantined operation branches after compaction. The retirement set
contains every retirement that affects the active census or safe compaction.
Conflicting, missing, or unreachable signer metadata is invalid.

The manifest authentication object's transition digest must equal the
transition digest in the current compound cloud authority state. A normal
manifest publish compares
and replaces the full tuple `(transition_certificate_digest, manifest_digest,
manifest_auth_digest, manifest_generation,
active_recovery_capabilities_digest, recovery_capability_change_pointer,
spent_recovery_redemptions_digest, migration_claim_pointer)` while
preserving the spent-redemption digest, active-recovery digest,
recovery-capability-change pointer, and migration-claim pointer. It cannot
succeed after a transition moved the epoch. A transition
compares that same tuple and atomically installs its target transition,
genesis-manifest content and authentication tuple, target active-recovery root,
protocol-determined recovery-capability-change pointer, and target
spent-redemption digest and migration-claim pointer. Automerge migration and
eligible same-library recovery clear the exact applicable non-null lifecycle
pointer. Other transitions
preserve null or the exact abandonment pointer. This single serialization
point prevents same-epoch
publication from being omitted by cutover and prevents an old epoch from
publishing after cutover.

Sync is:

1. persist local operations, referenced blob bytes, and segment bytes;
2. upload and remotely verify every missing immutable blob before exposing a
   segment that references it;
3. upload missing immutable segments;
4. fetch the current manifest content and authentication object, then fetch the
   transition certificate and any named actor certificate objects by digest;
   verify those certificate bytes and authority chain before authenticating the
   manifest;
5. validate actor chains and union compatible segment identities and exact
   accepted tips. Retain incompatible or forked tips in quarantine instead of
   selecting the greatest sequence;
6. compare-and-swap the signed next-generation manifest through the compound
   cloud authority state, conditional on the exact unchanged transition digest,
   previous manifest digest, previous manifest-auth digest, previous
   generation, active-recovery digest, recovery-capability-change pointer, and
   spent-redemption digest, and migration-claim pointer;
7. on any manifest, recovery, migration-claim, or transition conflict, fetch,
   validate, union, and retry with a bounded policy;
8. download unknown blobs and segments, then apply complete operations
   idempotently;
9. publish a new manifest only after local application commits.

Compare-and-swap prevents lost manifest replacement. It does not provide
semantic convergence. The operation algebra does.

Segment upload response loss is safe because the digest is the identity.
Duplicate segments and duplicate operations are no-ops. Reordered segments
remain valid because actor-chain gaps wait for their predecessors.

Every storage adapter makes referenced blob bytes durable and proves they
survive reopen before materializing, acknowledging, or advancing the frontier
for the referencing transaction. Desktop streams into a bounded temporary
file, verifies length and digest, fsyncs it, atomically renames it to the
content-addressed path, and fsyncs the parent directory. IndexedDB either
commits the blob and reference in one durable transaction or uses a staged
record with reopen verification before publication. OPFS uses its proven sync
or flush primitive, atomic publication protocol, and reopen verification. A
missing, oversized, corrupt, or unverified blob holds the entire transaction
unapplied. A browser adapter cannot claim filesystem fsync evidence it cannot
produce.

Manifests with a reused or decreasing generation, invalid or retired signer,
unknown enrollment, invalid signature, sibling predecessor, regressed
transition digest, or collapsed sequence-only frontier are rejected. A valid
higher-epoch transition whose reason is `rollback` is not a regression.
Manifest CAS merge never sequence-maxes incompatible actor tips.
Acknowledgment and compaction bind exact branch-qualified tips.

An ordinary next-generation manifest is a literal superset of the previous
manifest's live segment, quarantined, and reachable blob roots. Its accepted
frontier is monotone under exact actor-chain causality: an old tip may disappear
only when a verified descendant replaces it. A non-descendant tip replacement
requires an authority-certified repair receipt. Removing any root requires an
authority-certified compaction receipt that binds epoch ID, transition digest,
removed segments and blobs, replacement checkpoint, exact actor
acknowledgments, previous manifest digest, target manifest generation, and
digest of the resulting live-root set.

The unbounded omission proof uses the generic chunked-object contract:

```text
compaction_proof_body = {
  compaction_id,
  library_id,
  epoch,
  epoch_id,
  transition_digest,
  previous_manifest_digest,
  previous_manifest_auth_digest,
  previous_manifest_generation,
  target_manifest_generation,
  removed_segment_digests,
  removed_blob_roots,
  actor_acknowledgments,
  replacement_checkpoint_digest,
  replacement_checkpoint_storage_root_digest,
  replacement_checkpoint_byte_length,
  replacement_checkpoint_frontier_digest,
  resulting_live_root_set_digest
}

compaction_proof_digest = D("compaction-proof", compaction_proof_body)

compaction_proof_byte_length = byte_length(C(compaction_proof_body))

compaction_proof_storage_root_body = {
  artifact_kind: "compaction_proof",
  artifact_digest: compaction_proof_digest,
  canonical_byte_length: compaction_proof_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

compaction_proof_storage_root_digest = D(
  "chunked-object-root",
  compaction_proof_storage_root_body
)

compaction_receipt_body = {
  compaction_id,
  library_id,
  epoch,
  epoch_id,
  transition_digest,
  previous_manifest_digest,
  previous_manifest_auth_digest,
  previous_manifest_generation,
  target_manifest_generation,
  replacement_checkpoint_digest,
  replacement_checkpoint_storage_root_digest,
  replacement_checkpoint_byte_length,
  replacement_checkpoint_frontier_digest,
  compaction_proof_digest,
  compaction_proof_storage_root_digest,
  compaction_proof_byte_length,
  resulting_live_root_set_digest,
  signing_authority_key_id
}

compaction_receipt_digest = D(
  "compaction-receipt",
  compaction_receipt_body
)

authority_signature = S(
  "compaction-receipt",
  transition_target_authority_private_key,
  { receipt_digest: compaction_receipt_digest }
)
```

`removed_segment_digests` is a unique set sorted by decoded digest.
`removed_blob_roots` contains closed
`{ content_digest, byte_length }` entries sorted by decoded digest and then
byte length. `actor_acknowledgments` contains one closed
`{ actor_id, enrollment_certificate_digest, acknowledged_tip }` entry for every
active actor, sorted by actor ID and then the canonical tip tuple. The proof's
manifest, generation, checkpoint, frontier, and resulting-root fields equal the
fixed receipt byte for byte. Target generation is exactly previous generation
plus one. The replacement checkpoint is accepted authority under the same
transition and causally dominates every removed operation. Every removed blob
is absent from the complete live root set recomputed from that checkpoint,
retained segments, quarantine, and retained proof artifacts.

`compaction_receipt_body.signing_authority_key_id` is required and equals the
target authority key ID installed by the exact transition digest in that body.
A verifier obtains that public key only from the accepted transition
certificate chain and verifies the receipt with it. It never substitutes the
current authority key or key material carried by the receipt.

The target manifest lists this exact receipt digest and has the receipt's target
generation and predecessor tuple. The receipt does not contain the target
manifest digest. Its proof storage root and every chunk become live proof roots
before the target manifest can win and remain reachable for as long as any
accepted history depends on the omission. A valid manifest signer alone cannot
authorize omission.

Initial releases do not destructively garbage-collect cloud operations.
Compaction introduces verified checkpoints, but old segments remain available
until every enrolled device has acknowledged a safe frontier or the owner has
explicitly retired the missing device.

Blob roots referenced by live segments, quarantined operations, verified
checkpoints, backups under construction, or any not-yet-compacted exact actor
frontier remain reachable. Blob garbage collection requires the same exact
actor acknowledgments as operation compaction.

## Legacy bridge

Automerge remains authoritative until the new operation protocol is available
on every writable supported client and the cloud manifest has not changed
epochs.

During the read-migration period:

- migration reads an immutable raw Automerge binary, never filtered UI state;
- existing cloud sync continues to use Automerge semantic merge;
- SQL may serve verified reads;
- the legacy worker may be short-lived, but its bytes remain authoritative;
- no SQL-originated write is accepted.
- a committed legacy mutation remains committed if derived SQL projection
  fails. The projection records a rebuild requirement. The caller does not
  retry a non-idempotent legacy mutation merely because projection repair
  failed.

The active legacy IndexedDB bridge uses schema version 2 before the bootstrap
transaction is wired. Version 1 feed bytes migrate byte for byte with save
revision zero. Every load returns the bytes plus the exact nonnegative
`{ generation, saveRevision }`. A save compares both values and increments
only `saveRevision` in the same readwrite transaction that replaces the
bytes. A clear compares both values, deletes the bytes, increments
`generation`, and resets `saveRevision` to zero in one transaction. A blocked
upgrade, missing or malformed metadata, revision overflow, or mismatch fails
closed. Connections close on `versionchange`.

Ordinary persistence derives a repeatable payload with `saveSince` from the
last committed Automerge heads and appends it to the last committed bytes. It
never uses Automerge's mutable incremental-save cursor. Compaction and
explicit full replacement write a complete save. Full replacement also
requires the caller revision captured before its asynchronous work began.
Candidate bytes, heads, revision, search indexes, and other derived worker
state become committed only after the storage compare-and-swap succeeds.
If the loaded bytes do not decode, recovery retains the bytes and revision
from that exact read. It never re-reads storage to obtain broader permission
to clear. Only a recognized Automerge decode failure classifies the bytes as
corrupt. Allocation exhaustion and unknown load failures preserve the bytes
and fail closed. A clear still compares the exact failed-read revision, so a
newer concurrent save cannot be deleted by an older recovery attempt.

During protocol activation:

1. Desktop and PWA ship dormant `library_core_v1` readers, writers, and sync.
2. Every supported adapter proves the same operation, checkpoint, materialized
   commitment, and device-local source-contribution fixtures. Fixture parity
   does not require every installation to decode the owner's private Automerge
   corpus.
3. Every known Automerge writer first reconciles through the existing semantic
   merge path, or the owner explicitly retires the missing device.
4. The accepted legacy source authority elects exactly one capable migration
   authority installation for one immutable source digest and candidate ID
   through the authenticated, expiring, response-loss-safe candidate-claim
   compare-and-swap. Only the installation holding the current claim loads the
   complete Automerge binary. A browser may hold this role only when admission
   proves the private source fits its temporary-worker budget.
5. Every other installation contributes any authoritative device-local source
   through its own fenced, manifest-bound bounded stream, or the owner
   explicitly retires or excludes that source under its registered policy.
   It does not decode the global Automerge document.
6. The migration authority creates the complete candidate, proof, logical
   checkpoint, and operation segments. Other installations initialize by
   streaming and verifying the accepted checkpoint, blob roots, and subsequent
   segments. They do not build an independent private-corpus candidate.
7. Cross-client replay and checkpoint bootstrap prove identical materialized
   digests on every adapter.
8. The owner activates one new cloud epoch through the signed global transition
   protocol.
9. The new epoch uses an epoch-specific cloud namespace and write capability.
   A legacy client cannot produce an accepted active-epoch operation or
   authenticated manifest. Because released legacy binaries cannot be
   retroactively made read-only, writes that they later publish to the legacy
   namespace are classified as orphaned legacy recovery input. An upgraded
   client surfaces and explicitly imports or rejects that input. It never
   silently merges those bytes into the active epoch.
10. The local authority transaction switches the active engine and replication
    protocol together.

An Automerge compatibility export may remain for rollback and older read-only
tools. It is derived from one exact operation frontier and carries a receipt.
Incoming legacy bytes cannot mutate a `library_core_v1` epoch.

## Migration

Migration input is an immutable Automerge binary plus immutable manifests for
every authoritative device-local source, with:

- byte digest;
- exact Automerge heads and heads digest;
- schema version;
- source installation generation;
- field-registry and canonical-codec versions;
- exhaustive raw-root, field, entity, and byte counts;
- immutable manifests and durable generations for authoritative device-local
  reader content and the permanent media vault; and
- start timestamp and build identity.

The raw source and exact head set derive as follows:

```text
legacy_source_authority_body = {
  library_id,
  active_epoch,
  active_epoch_id,
  active_engine: "automerge_legacy",
  schema_version,
  replication_protocol: "automerge_blob_v1",
  frontier_digest,
  authority_key_id,
  transition_digest,
  updated_by_operation_id
}

source_authority = legacy_source_authority_body

automerge_source_digest = DB("automerge-source", automerge_binary_bytes)

automerge_heads_body = {
  heads
}

automerge_heads_digest = D("automerge-heads", automerge_heads_body)

migration_source_contributor_body = {
  format: "freed_migration_source_contributor_v1",
  library_id,
  source_authority,
  source_installation_id,
  contributor_actor_id,
  contributor_actor_public_key,
  contributor_actor_public_key_fingerprint,
  contributor_actor_incarnation_nonce,
  enrollment_operation_id
}

migration_source_contributor_body_digest = D(
  "migration-source-contributor-body",
  migration_source_contributor_body
)

migration_source_contributor_actor_proof = S(
  "migration-source-contributor-proof",
  contributor_actor_private_key,
  { migration_source_contributor_body_digest }
)

migration_source_contributor_certificate_body = {
  migration_source_contributor_body,
  migration_source_contributor_body_digest,
  migration_source_contributor_actor_proof
}

migration_source_contributor_certificate_digest = D(
  "migration-source-contributor-certificate",
  migration_source_contributor_certificate_body
)

migration_source_contributor_authority_signature = S(
  "migration-source-contributor-authority",
  source_authority_private_key,
  { migration_source_contributor_certificate_digest }
)

migration_source_body = {
  automerge_source_digest,
  automerge_byte_length,
  automerge_heads_body,
  automerge_heads_digest,
  automerge_schema_version,
  automerge_source_generation,
  local_sources,
  source_contributor_certificates,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length,
  field_registry_version,
  canonical_codec_version,
  migration_version,
  captured_at_ms,
  build_identity
}

migration_source_digest = D("migration-source-set", migration_source_body)
```

The migration contributor actor ID, public-key fingerprint, and incarnation
nonce use the actor identity codecs above with
`source_installation_id` as `installation_incarnation`. The contributor proves
possession before the current legacy source authority signs the certificate.
That certificate grants only post-claim manifest contribution and
source-fence authority for the named installation and library. It grants no
target writer, provider, release, backup, recovery, enrollment, or epoch
authority.

`source_contributor_certificates` contains the complete closed
`{ migration_source_contributor_certificate_body,
migration_source_contributor_certificate_digest,
migration_source_contributor_authority_signature }` objects sorted by decoded
source installation ID. The installation ID and actor ID are unique. Every
certificate recomputes its body digest, actor proof, certificate digest, source
authority, and authority signature. There is exactly one certificate for every
installation represented in `local_sources`, with no extras.

`legacy_source_authority_body` is the closed installation-neutral projection of
an accepted legacy `library_control` record. Every reconciled known writer must
project byte-identical bytes. Its local control record also carries that
writer's own `installation_id`, but that device-local value is deliberately not
part of shared source authority. The elected installation is bound separately
through `migration_authority_installation_id`.

Each Automerge head is exactly 32 bytes encoded as 64 lowercase hexadecimal
characters. `heads` is a unique set sorted by decoded bytes.
`automerge_byte_length`, schema version, source generation, and capture time are
nonnegative safe integers.

For Library Core v1, every `installation_id` and
`source_installation_id` is exactly 32 cryptographically random bytes encoded
as 64 lowercase hexadecimal characters. Sorting by installation ID means
sorting those decoded 32 bytes. A source key is one exact member of the closed
ASCII registry `reader_content` or `media_vault`. The reserved ASCII key
`automerge` may appear only in source-fence, proof, count, and disposition
records for the elected migration installation. It does not appear in
`local_sources`, because the Automerge source is committed by the dedicated
fields above. A later source key requires a protocol amendment and public
cross-adapter vector.

`local_sources` contains closed
`{ source_installation_id, source_key, manifest_digest,
manifest_storage_root_digest, manifest_byte_length, generation, entry_count,
content_byte_length, source_contributor_actor_id,
source_contributor_certificate_digest }` entries sorted by decoded source
installation ID and then ASCII source key. The actor and certificate fields
equal the one source contributor certificate for that installation. The
composite `(source_installation_id, source_key)` is unique. Each installation
has at most one entry for each registered source key.
The array contains at most 64 entries.
Generations, counts, and lengths are nonnegative safe integers.
`manifest_byte_length` is positive and at most 268,435,456 bytes,
`entry_count` is at most 1,000,000, and `content_byte_length` is the exact safe
integer sum of entry byte lengths. In Library Core v1,
`field_registry_version`, `canonical_codec_version`, and `migration_version`
are each the exact positive safe integer `1`. `build_identity` is the closed
`{ commit_sha, build_kind, platform }` object. `commit_sha` is exactly 40
lowercase hexadecimal characters. `build_kind` is exactly `release`,
`snapshot`, `preview`, or `local`. `platform` is exactly `darwin-arm64`,
`darwin-x86_64`, `windows-arm64`, `windows-x86_64`, `linux-arm64`,
`linux-x86_64`, or `web`. A later version, hash algorithm, build kind, or
platform requires a registry amendment and public vector. Every digest and
identifier uses its registered exact codec.

An authoritative reader-content source has this literal portable manifest:

```text
reader_content_source_root_binding_body = {
  format: "freed_reader_content_source_root_binding_v1",
  library_id,
  source_installation_id,
  source_namespace,
  binding_kind: "native_root_handle" | "cache_origin",
  root_identity,
  root_generation,
  root_locator_digest
}

reader_content_source_root_binding_digest = D(
  "reader-content-source-root-binding",
  reader_content_source_root_binding_body
)

reader_content_lookup_plan_entry_body = {
  format: "freed_reader_content_lookup_plan_entry_v1",
  library_id,
  source_installation_id,
  source_namespace,
  source_locator,
  candidate_bindings
}

reader_content_lookup_plan_entry_digest = D(
  "reader-content-lookup-plan-entry",
  reader_content_lookup_plan_entry_body
)

reader_content_lookup_plan_body = {
  format: "freed_reader_content_lookup_plan_v1",
  library_id,
  source_installation_id,
  source_namespace,
  logical_source_digest,
  logical_source_generation,
  entry_count,
  entries_root_body
}

reader_content_lookup_plan_digest = D(
  "reader-content-lookup-plan",
  reader_content_lookup_plan_body
)

reader_content_probe_outcome_body = {
  format: "freed_reader_content_probe_outcome_v1",
  library_id,
  source_installation_id,
  source_namespace,
  reader_content_lookup_plan_entry_digest,
  outcome: "hit" | "missing" | "error",
  reader_content_source_entry_digest,
  error_code,
  disposition:
    "content_admitted" |
    "verified_rebuildable_absence" |
    "unresolved_conflict" |
    "fatal_source_error"
}

reader_content_probe_outcome_digest = D(
  "reader-content-probe-outcome",
  reader_content_probe_outcome_body
)

reader_content_probe_outcome_set_body = {
  format: "freed_reader_content_probe_outcome_set_v1",
  library_id,
  source_installation_id,
  source_namespace,
  reader_content_lookup_plan_digest,
  set_kind: "reader_content_probe_outcomes",
  entry_count,
  entries_root_body
}

reader_content_probe_outcome_set_digest = D(
  "reader-content-probe-outcome-set",
  reader_content_probe_outcome_set_body
)

reader_content_source_entry_body = {
  source_installation_id,
  source_key: "reader_content",
  source_namespace:
    "native_reader_content" |
    "cache_freed_articles_v1" |
    "cache_freed_articles_pinned_v1",
  source_locator,
  physical_identity,
  reader_content_lookup_plan_entry_digest,
  reader_content_probe_outcome_digest,
  identity_state: "resolved" | "ambiguous" | "unresolved",
  entity_reference,
  candidate_entity_references,
  identity_evidence,
  content_digest,
  byte_length,
  media_type
}

reader_content_source_entry_digest = D(
  "reader-content-source-entry",
  reader_content_source_entry_body
)

reader_content_namespace_source_body = {
  source_namespace,
  reader_content_source_root_binding_body,
  reader_content_source_root_binding_digest,
  reader_content_lookup_plan_body,
  reader_content_lookup_plan_digest,
  reader_content_probe_outcome_set_body,
  reader_content_probe_outcome_set_digest,
  entry_count,
  payload_byte_length
}

reader_content_source_manifest_body = {
  format: "freed_reader_content_source_manifest_v1",
  library_id,
  source_installation_id,
  source_key: "reader_content",
  generation,
  source_build_identity,
  namespace_sources,
  entry_count,
  resolved_count,
  ambiguous_count,
  unresolved_count,
  payload_byte_length,
  entries
}

reader_content_source_manifest_digest = D(
  "reader-content-source-manifest",
  reader_content_source_manifest_body
)
```

An entity reference is the closed `{ registry_key, primary_key }` object.
`registry_key` is registered nonempty ASCII of at most 255 bytes. The canonical
`C(primary_key)` is at most 4,096 bytes. Identity evidence is exactly one of
these closed tagged objects:

```text
{
  kind: "authenticated_logical_reference",
  entity_reference,
  logical_record_digest,
  logical_reference_path
}

{
  kind: "embedded_payload_identity",
  entity_reference,
  payload_identity_digest,
  payload_identity_path
}

{
  kind: "reversible_physical_key",
  entity_reference,
  physical_key_codec_id,
  physical_key_input_digest
}
```

Every digest is lowercase 64-character hexadecimal. Each path or codec ID is a
registered nonempty ASCII value of at most 255 bytes. The referenced record,
payload field, or codec input is reopened and the entity reference is
independently recomputed. A sanitized filename, URL, cache key, array
position, or coincidentally equal content digest is not identity evidence.

Each lookup-plan `candidate_bindings` array contains between zero and 64 closed
`{ entity_reference, identity_evidence }` objects. The evidence's entity
reference equals the binding's reference byte for byte. The array is sorted by
ASCII registry key, bytewise `C(primary_key)`, then bytewise
`C(identity_evidence)`. Exact duplicate bindings collapse to one. Two unequal
evidence objects for the same entity reference are retained as separate
bindings but resolve to one candidate reference after both verify. The
authenticated set sort key for a lookup-plan entry is
`(source_namespace, C(source_locator))`. This physical locator is unique in the
plan. One probe therefore serves every logical candidate that mapped to the
same physical locator.

For a hit, verified candidate bindings reduce to the unique sorted set of
entity references. One reference produces `identity_state: "resolved"`, that
non-null `entity_reference`, an empty `candidate_entity_references` array, and
the lexicographically first verified evidence for that reference. Two or more
references produce `"ambiguous"`, a null entity reference, the sorted candidate
references, and null identity evidence. Zero references produce
`"unresolved"`, a null entity reference, an empty candidate array, and null
identity evidence. A candidate may not equal another candidate byte for byte.
Ambiguous and unresolved entries remain conflict evidence until an explicit
later operation resolves them.

`source_namespace` is the complete closed v1 physical namespace registry.
Native entries use
`native_reader_content`; Cache API entries use the exact cache name encoded by
the other two literals. A later cache or native authority requires a protocol
amendment. `source_locator` is exactly one closed tagged object:

```text
{
  kind: "native_path",
  relative_path
}

{
  kind: "cache_request",
  request_url,
  request_method,
  request_headers,
  request_body_digest,
  request_body_byte_length,
  response_vary,
  binding_state: "bound" | "unbound"
}
```

The source-root binding is mandatory. For `native_root_handle`,
`root_identity` is exactly one of:

```text
{ platform: "unix", device_id_u64, inode_id_u64 }
{ platform: "windows", volume_serial_u64, file_id_u128 }
```

Every `*_u64` value is an unsigned 64-bit integer encoded as canonical decimal
ASCII with no sign or leading zero except the literal `0`. `file_id_u128` uses
the same rule over the unsigned 128-bit range. Numeric JSON values are invalid
for these fields because JavaScript cannot preserve their full range.
`root_generation` is the source authority's nonnegative safe-integer durable
generation, and `root_locator_digest` commits the configured root locator
without publishing a host path.

Capture opens the root once and pins that authority handle. It resolves each
relative-path component with handle-relative no-follow operations. It never
reopens an authoritative file from a joined path string. The final handle must
name a regular file on the pinned device or volume. The entry's
`physical_identity` is exactly one of:

```text
{
  kind: "unix_file",
  device_id_u64,
  inode_id_u64,
  byte_length
}

{
  kind: "windows_file",
  volume_serial_u64,
  file_id_u128,
  byte_length
}
```

The adapter reads that identity before streaming content and again from the
same open handle after the final byte. Both identities and byte lengths must be
byte-identical. Symlinks, junctions, reparse points, mount crossings, root
replacement, or an identity change are blocking evidence. A lexical path check
alone is never admission.

For `cache_origin`, `root_identity` is the closed
`{ platform: "web", origin, cache_namespace }` identity,
`root_generation` is the durable reader-content write-journal generation, and
`root_locator_digest` commits the exact origin and registered cache name. A
Cache hit has the closed physical identity
`{ kind: "cache_response", cache_namespace, request_locator_digest,
response_metadata_digest, byte_length }`. The request locator digest is
`D("reader-content-lookup-plan-entry", lookup_plan_entry_body)`.
`response_metadata_digest` is the lowercase hexadecimal
`DB("blob-content", C({ status, status_text, response_headers,
response_vary }))`, with the response fields using the Fetch codecs already
defined for requests. The byte length equals the streamed body length. A
manifest namespace cannot mix physical root bindings. Every binding body and
digest recomputes and equals the namespace adapter whose entries it covers.

Native relative paths are nonempty Unicode scalar strings whose exact UTF-8
encoding is at most 8,192 bytes and contains no NUL or control character. They
use `/`, contain no empty, `.` or `..` segment, and never begin with `/`.
Verifiers preserve the exact bytes and do not normalize or case-fold them.

Cache request URLs are exact absolute HTTPS URL strings of at most 8,192 UTF-8
bytes with no userinfo or fragment. `request_method` is 1 to 32 uppercase ASCII
bytes. `request_headers` contains at most 128 closed `{ name, value }` entries
in the order exposed by the pinned Fetch `Headers` iterator. Names are
lowercase HTTP token ASCII, values are exact Unicode scalar strings of at most
8,192 UTF-8 bytes with no NUL, CR, or LF, and the canonical array is at most
65,536 bytes. The adapter records the iterator's exact normalized sequence and
never attempts to reconstruct header occurrences that the Fetch implementation
has already combined.
Request-body digest and positive safe byte length are both null for no body and
both non-null otherwise. The digest is `DB("blob-content",
request_body_bytes)`. `response_vary` is the unique sorted lowercase HTTP
header-name token set parsed from the effective response `Vary` field; the
literal `*` is exclusive. A Cache entry is `bound` exactly when the method is
`GET`, headers are empty, both body fields are null, and `response_vary` is
empty. Every other Cache entry is `unbound` conflict evidence. It remains
distinct through its complete locator instead of collapsing onto the URL.
`C(source_locator)` is at most 131,072 bytes.

PWA manifest construction never calls `Cache.keys()` or any API that first
returns the full cache key set. The Cache API has no cursor or immutable
enumeration snapshot, so a paged wrapper around `keys()` would still allocate
the whole corpus and would not prove one generation.

Instead, every authoritative reader-content write first commits a durable
logical reference or write-journal entry. At capture time the adapter freezes
that logical source digest and generation, builds the persistent
`reader_content_lookup_plan` set outside the source barrier, then probes each
planned physical locator exactly once. For each plan row it opens the literal
registered cache with `caches.open(source_namespace)`, reconstructs the exact
bound `GET` request, and calls:

```text
cache.match(request, {
  ignoreSearch: false,
  ignoreMethod: false,
  ignoreVary: false
})
```

The probe performs no `fetch`, navigation, Service Worker fallback, or other
network request. A plan locator whose method, headers, body, or Vary binding is
not the exact `bound` shape defined above is a fatal source error and is never
probed.

Every plan entry produces exactly one
`reader_content_probe_outcome_body`, keyed in the
`reader_content_probe_outcomes` set by the decoded lookup-plan entry digest. A
`hit` has a non-null source-entry digest, null error code, and disposition
`content_admitted`. The source entry repeats the lookup-plan entry digest and
the outcome digest. A `missing` outcome has both fields null and disposition
`verified_rebuildable_absence` only when the authenticated logical record's
registered policy says the bytes are derivable without data loss. Otherwise
its disposition is `unresolved_conflict`. An `error` has a null source-entry
digest, a registered nonempty ASCII error code of at most 255 bytes, and
disposition `unresolved_conflict` or `fatal_source_error`. Missing and error
outcomes never invent positive content fields. A fatal outcome blocks the
manifest. Every other outcome remains explicit in the complete set and is
never silently omitted.

Each `namespace_sources` member has the closed
`reader_content_namespace_source_body` shape. The array is sorted by
`source_namespace` and contains no duplicate. A PWA manifest contains exactly
two members, one for `cache_freed_articles_v1` and one for
`cache_freed_articles_pinned_v1`. Each has non-null root binding, lookup plan,
and probe-outcome set bodies and digests. The outcome set names that exact plan
digest and has the same entry count. A Desktop native manifest contains exactly
one `native_reader_content` member with a non-null root binding and null
lookup-plan and outcome-set fields. Native traversal instead uses bounded
directory cursors beneath the pinned root handle.

For every namespace, its entry and payload counts equal the exact subset of
manifest entries carrying that namespace. The manifest's total counts are the
safe-integer sums across namespace members. Every nested body and digest,
logical source, generation, installation, root binding, plan root, outcome
root, and count verifies byte for byte. An exact Cache response found outside
the durable plan is non-authoritative cache garbage. It may be reclaimed or
rebuilt, but it cannot enter migration, backup, or conflict evidence unless a
prior durable write-journal receipt binds it.

`content_digest` is
`DB("blob-content", content_bytes)`. Byte length is a positive safe integer.
Media type is null or registered nonempty ASCII of at most 255 bytes.

`entries` contains closed `{ reader_content_source_entry_body,
reader_content_source_entry_digest }` pairs, sorted by
`source_namespace`, bytewise `C(source_locator)`, the identity-state order
`resolved`, `ambiguous`, `unresolved`, bytewise `C(entity_reference)`,
bytewise `C(candidate_entity_references)`, and decoded entry digest. The entry
digest recomputes from the body. The canonical physical key
`(source_namespace, C(source_locator))` is unique. Two rows for that key, or
conflicting bytes or identities discovered for it, are blocking source
evidence and cannot both enter a valid manifest. The manifest has at most
1,000,000 entries and its canonical bytes are at most 268,435,456 bytes.
For a Cache entry, both plan and outcome digests are non-null. They reopen one
plan row with the same namespace and locator and its unique `hit` outcome. That
outcome names this exact source-entry digest. For a native entry, both fields
are null. No source entry exists for a missing or error outcome. The plan,
outcome set, and admitted Cache entries form an exact bijection over hit
outcomes, while every non-hit plan row remains represented by its terminal
outcome.
`source_build_identity` is the closed `{ commit_sha, build_kind, platform }`
object for the adapter that captured the manifest. The entry, resolved,
ambiguous, and unresolved counts are nonnegative safe integers that recompute
exactly from `entries`; the three identity-state counts sum to `entry_count`.
`payload_byte_length` is the exact safe-integer sum of entry byte lengths. Its
chunked root has artifact kind
`reader_content_source_manifest`, names the manifest digest, and reconstructs
the exact canonical body. The matching `local_sources` entry repeats that
digest, storage-root digest, canonical byte length, generation, entry count,
and payload byte length. Desktop native-directory and PWA Cache API adapters
must implement the same parser, canonical codec, digest, identity-state, and
rejection contract. Their adapter-specific canonical fixtures preserve their
different physical namespaces and locators; they are not required to produce
byte-identical manifests for unlike physical sources.

Manifest construction never materializes the complete descriptor array or
canonical manifest in memory. Each adapter first writes immutable descriptor
pages of at most 8 MiB and 65,536 entries, sorted by the manifest tuple. It
uses a bounded external merge over those pages, streams canonical encoding,
incremental digesting, and chunked-root output, and retains at most one
descriptor page plus 8 MiB of encoding and merge buffers. Desktop may use
private temporary files. A PWA uses origin-private IndexedDB or OPFS staging
and yields between bounded pages. The complete canonical manifest may still
reach its 256 MiB protocol bound, but no adapter allocates a buffer of that
size.

The expensive census and sorted-run preparation happens before the short
source capture barrier. The prepared object records the source generation,
physical-root identity, descriptor-page roots, counts, and byte sums. Under
the barrier, the adapter compares the current generation and physical root to
that prepared object, atomically fixes the exact prepared manifest and storage
root as the captured generation, reads them back, and releases the barrier.
A mismatch discards or resumes preparation outside the barrier and retries.
The barrier never performs the first full scan, external sort, or complete
manifest encoding.

The source media-vault snapshot digest, storage-root digest, and byte length
name the exact chunked portable snapshot captured under the bounded source
capture barrier defined below. Its source manifest digest, storage-root
digest, canonical byte length, generation, entry count, and content-byte sum
equal the
one `media_vault` entry in `local_sources` whose `source_installation_id` equals
`migration_authority_installation_id`. For that entry, `manifest_digest` is exactly
`DB("media-vault-source-manifest", source_manifest_bytes)`, not the backup-file
plaintext digest or a platform-native checksum. A second authoritative
`media_vault` entry from another installation blocks source closure and cutover.
For that entry, `entry_count` is the exact count of manifest entries plus
signed exclusions, and `content_byte_length` is the safe integer sum of
included entry byte lengths; exclusions contribute zero content bytes.
It must first be reconciled into the elected permanent vault under an
owner-visible operation and then disappear as an authoritative source in the
new captured generation. V1 cannot silently exclude it, select one copy, or
claim that the singular snapshot migrated both vaults.

Before any migration batch, resume, verification, or cutover receipt, the
elected migration authority verifies raw byte length and
`automerge_source_digest`, then opens those exact bytes through the pinned
external-memory Automerge decoder and version. The decoder incrementally
verifies framing and change hashes, writes bounded immutable change and object
runs to private staging, externally sorts them, recomputes the unique sorted
32-byte head set, and requires byte-for-byte equality with
`automerge_heads_body` and its digest. No `Automerge.load` fallback,
source-sized resident buffer, or in-memory complete change graph is permitted,
even when the current host has enough RAM.

The authority also streams every device-local source contribution from its
owning installation, recomputes the registered manifest digest, generation,
counts, and byte length, and requires exact equality with its `local_sources`
entry. Each contribution is independently resumable and receives only a short
cutover fence after the candidate has been completely prepared. It cannot
grant its owner authority to decode or mutate the global source. A source
digest and head or manifest description captured from different states is
invalid.

Source closure enumerates every raw root and leaf, including `meta`,
`desktopClient:*`, legacy `friends`, every registered entity and preference,
unknown compatibility roots, authoritative reader content, and every permanent
media-vault manifest entry and file. Each source path has one receipt-bound
disposition: mapped, retained as opaque recovery evidence, explicitly excluded
by its local-authority contract and user-visible receipt, or blocking. No
unknown field is silently dropped.

Legacy identity migration processes `persons` and `accounts` independently and
idempotently. A partially populated target cannot cause either half of legacy
`friends` data to be skipped. Unkeyed list occurrences receive stable IDs
derived with `D("legacy-occurrence", { source_digest, registry_key,
primary_key, leaf_path, source_index })`; content hashes cannot collapse equal
duplicate entries. `primary_key` is the entity's exact key or the reserved
UTF-8 string `"$singleton"` for a singleton root such as preferences. The
registry key keeps singleton and entity namespaces distinct.
Parallel `content.mediaUrls` and `content.mediaTypes` preserve source index and
malformed unmatched tails as conflict evidence. Migration never zip-truncates,
invents a default type, or deduplicates URLs. Dynamic maps emit explicit
per-key set and remove operations.

The device-local reader-content manifest records resolved original identity or
the exact ambiguous or unresolved identity state, plus source locator, byte
length, and content digest. The current sanitized filename is only a lookup
hint because distinct IDs can collide. An ambiguous or unresolved file remains
conflict evidence and blocks silent assignment. Once verified and migrated,
reader bodies are authoritative Library Core blobs. Truly rebuildable thumbnail
and media caches remain device-local under their registry entries.

The elected migration authority prepares a bounded pre-claim source capture
without copying or hashing the corpus under a writer barrier. Before entry it
creates either an immutable storage snapshot handle or a complete
content-addressed staged copy, then streams and hashes that immutable view,
derives heads, counts, byte length, and storage-root commitments, and persists
the proposed fixed-size anchor. The same rule applies to every authoritative
device-local source manifest.

The source owner then enters its ordinary write-serialization primitive only
long enough to create or verify the immutable snapshot identity and compare the
current generation, digest, heads, byte length, physical-root identity, and
storage root with the prepared anchor. The transaction commits that fixed-size
binding or aborts. It performs no corpus copy, first decode, full scan, hash,
external sort, manifest encoding, or remote upload. A source that cannot create
an immutable view without source-proportional work inside the barrier is not a
v1-capable migration source.

The barriers need not share one process or memory space. They are not
`source_admission_fences`, grant no target or cutover authority, and are
released immediately after the fixed-size bindings are durable and read back.
Their sole purpose is to create the exact
`migration_source_body` needed by the first claim without decoding the complete
corpus. Each barrier has a fresh operation ID, uses the source owner's durable
write-serialization primitive, and must complete or abort within 60,000 ms of
local monotonic elapsed time. Abort acknowledges no source capture and releases
the barrier. All corpus-sized verification continues outside it. No transition
certificate, migration receipt, or cutover payload is signed until the late
source-fence activations and final equality checks prove that every captured
binding is still current.

After the claim is current, every device-local source durably creates and reads
back this exact post-claim contribution record before granting its final
admission fence:

```text
migration_local_source_contribution_payload_body = {
  library_id,
  source_installation_id,
  source_key,
  manifest_digest,
  manifest_storage_root_digest,
  manifest_byte_length,
  generation,
  entry_count,
  content_byte_length,
  source_contributor_actor_id,
  source_contributor_certificate_digest,
  migration_source_digest,
  migration_candidate_id,
  active_migration_claim_digest,
  claim_fencing_generation,
  export_operation_id
}

migration_local_source_contribution_payload_digest = DB(
  "blob-content",
  C(migration_local_source_contribution_payload_body)
)

migration_local_source_contribution_body = {
  format: "freed_migration_local_source_contribution_v1",
  migration_local_source_contribution_payload_body,
  migration_local_source_contribution_payload_digest,
  migration_claim_operation_grant_digest,
  migration_claim_operation_grant_consumption_digest,
  migration_claim_source_commit_admission_body,
  migration_claim_source_commit_admission_digest,
  migration_claim_source_commit_admission_signature
}

migration_local_source_contribution_digest = D(
  "migration-local-source-contribution",
  migration_local_source_contribution_body
)

migration_local_source_contribution_signature = S(
  "migration-local-source-contribution-signature",
  contributor_actor_private_key,
  { migration_local_source_contribution_digest }
)
```

The payload's source identity and manifest fields equal one exact `local_sources`
descriptor. The source owner reopens the immutable manifest and storage root,
recomputes their digests, lengths, generation, counts, and content-byte sum,
and requires the payload's `migration_source_digest` to name the complete
source set containing that descriptor. The contributor actor and certificate
fields equal that descriptor and its verified source-contributor certificate.
The proof-of-possession key from that certificate verifies the contribution
signature. The candidate, current claim, and fencing generation match the
authenticated current claim byte for byte.
The `source_contribution_commit` grant binds
`migration_local_source_contribution_payload_digest`; the wrapper binds that
same payload to the matching grant, consumption, and source-commit admission
records without a circular digest.
The contribution's cloud source-commit admission receipt verifies the exact
`source_contribution_commit` grant, consumption, payload, operation, source
domain, process generation, and monotonic deadline under the current source
authority. Local mode requires all three admission fields to be null because
the grant and contribution commit together.
The payload's `export_operation_id` is stable across exact retry. A source-generation or
manifest change after claim acquisition rejects the contribution and requires
signed abandonment. Manifest capture remains pre-claim and authority-free;
this contribution and all full-byte streaming are post-claim.

The claimant prepares the complete candidate before it blocks a source. It
opens the captured Automerge bytes through the external-memory decoder,
streams every device-local contribution, constructs every target batch,
checkpoint, blob, media plan, prepared proof, reservation set, and
pre-finalization closure set, uploads them, fetches them back, and verifies all
corpus-sized content while legacy writers remain active. The prepared candidate
records the exact captured Automerge heads and every device-local manifest
generation and digest. Later writes do not silently enter that candidate. A
changed captured source requires signed abandonment and a fresh capture because
Library Core v1 has no translated migration tail.

Before preparation completes, each source owner may create one durable
nonblocking fence reservation for the exact candidate, claim generation,
manifest, contribution, and expected source generation. Reservation stores a
locally generated bearer token only in protected source-private operation
state and publishes only its domain-separated digest. It does not reject or
redirect ordinary writes.

Cutover activates the reserved Automerge fence and every authoritative
device-local fence only after all corpus-sized candidate and remote-closure
work is complete. Each activation consumes an exact current operation grant,
serializes with ordinary writes and source revocation, and compares the
prepared source generation, manifest, contribution, and physical root. Any
mismatch leaves or restores ordinary write authority, releases every already
activated fence, and requires signed abandonment plus a new source capture.
All activations, the bounded finalization delta, and the winning authority
compare-and-swap share one 60-second monotonic finalization deadline. While
active, new writes are
acknowledged only after a durable epoch-neutral intent is recorded for exact
replay; a source that cannot record such an intent rejects before
acknowledgment.

The final equality checks, source activation transactions, bounded
activation-sidecar assembly, fixed-root transition verification, compound
cloud authority compare-and-swap, and local epoch commit are the only work
performed while source fences are active. No full decode, cache census,
filesystem walk, external sort, prepared-proof traversal, arbitrary object
upload, or corpus-sized readback occurs inside that interval.

Library Core v1 admits at most 64 `local_sources`, therefore at most 65
source-fence activations in one transition including the Automerge source. The
complete canonical finalization sidecar is at most 2,097,152 bytes, 1,024
immutable objects or authenticated-set nodes, 65 source-authority mutations,
and one atomic authority-bundle write. A preflight receipt records those exact
counts, byte lengths, bundle members, and source capability checks before the
first activation. An operation absent from that receipt is forbidden.
Exceeding a cap, losing a source, or failing to complete within 60,000
monotonic milliseconds releases every activated fence, acknowledges no
cutover, and requires signed `protocol_limit` abandonment. A later protocol
version may raise a cap only with new public vectors and measured
bounded-finalization evidence.

The sidecar contains only source activation records, source-activation entries
and authenticated-set nodes, and the bounded final proof plus dependency-acyclic
wrappers. Every corpus-sized object, reservation, batch, disposition, prepared
proof, genesis object-set path, and genesis closure already exists and was read
back before activation. The prebuilt genesis closure includes the corpus,
prepared proof, and reservations. It explicitly excludes the current
transition's activation sidecar, final proof, receipt, cutover grant and
consumption, transition certificate, and manifest authentication object. The
transition certificate binds those objects directly.

The sidecar is the sole object-store exception to the prebuilt-closure and
pre-upload rule. Its digest, canonical byte length, object count, and fence
count are bound by the receipt and cutover payload. One winning authority
compare-and-swap atomically persists the sidecar, final proof, receipt, cutover
grant and consumption, transition certificate, manifest authentication object,
and target authority tuple. There is no upload or readback round trip inside
the fence window. After an ambiguous response, readback resolves the already
decided authority transaction. The migration receipt and transition certificate
bind the complete authenticated set of reservation and activation records,
token digests, and captured generations. Bearer tokens never enter a receipt,
proof, log, backup, transition, or cross-installation message.

The active Gate D compatibility bridge uses one narrower device-local receipt
before decode. `freed_local_automerge_migration_claim_v1` binds the exact
IndexedDB generation, save revision, byte length, source digest, and current
Desktop installation ID to a device-held Ed25519 public key. Its digest domain
is `legacy-source-admission-claim` and its signature domain is
`legacy-source-admission-claim-key`. On macOS and Windows the private key
remains in the operating-system credential vault. Linux does not attempt this
claim until a noninteractive platform vault exists and stays on the Automerge
rollback path. The immutable signed receipt is stored only under the
private migration root and verified after readback. This receipt detects
changed or substituted local migration evidence after its first admission. It
is not `freed_migration_candidate_claim_v1`, is never source authority, grants
no writer or cloud authority, and cannot satisfy any elected migration,
candidate registration, or cutover requirement below.

Before the elected installation decodes the complete Automerge corpus, acquires
a source admission fence, or writes target state, it must hold the one current
authenticated migration claim for the library:

```text
migration_candidate_claim_body = {
  format: "freed_migration_candidate_claim_v1",
  claim_mode: "cloud" | "local",
  library_id,
  source_authority,
  migration_source_digest,
  automerge_source_digest,
  automerge_heads_digest,
  migration_candidate_id,
  migration_authority_installation_id,
  claim_operation_id,
  claim_revision,
  claim_fencing_generation,
  predecessor_lifecycle_selector,
  predecessor_claim_history_root,
  predecessor_claim_cleanup_digest,
  claim_nonce,
  claimed_at_ms,
  expires_at_ms
}

migration_candidate_claim_digest = D(
  "migration-candidate-claim",
  migration_candidate_claim_body
)

migration_candidate_claim_authority_signature = S(
  "migration-candidate-claim-authority",
  source_authority_private_key,
  { migration_candidate_claim_digest }
)

migration_claim_authority_domain =
  {
    kind: "source",
    source_installation_id,
    source_key
  } |
  {
    kind: "candidate_registry",
    migration_candidate_id,
    target_authority_key_id
  } |
  {
    kind: "library_authority",
    library_id,
    target_epoch_id
  }

migration_claim_source_attempt_body = {
  source_process_generation_id,
  grant_request_monotonic_ms
}

migration_claim_source_attempt_digest = D(
  "migration-claim-source-attempt",
  migration_claim_source_attempt_body
)

migration_claim_operation_grant_body = {
  format: "freed_migration_claim_operation_grant_v1",
  grant_mode: "cloud" | "local",
  library_id,
  claim_pointer,
  claim_history_root,
  migration_candidate_id,
  claim_fencing_generation,
  operation_kind:
    "source_contribution_commit" |
    "source_fence_reservation" |
    "source_fence_activation" |
    "candidate_object_commit" |
    "candidate_registration" |
    "cutover",
  operation_id,
  authority_domain,
  operation_payload_digest,
  source_attempt_body,
  source_attempt_digest,
  issued_at_ms,
  expires_at_ms,
  grant_nonce
}

migration_claim_operation_grant_digest = D(
  "migration-claim-operation-grant",
  migration_claim_operation_grant_body
)

migration_claim_operation_grant_authority_signature = S(
  "migration-claim-operation-grant",
  source_authority_private_key,
  { migration_claim_operation_grant_digest }
)

migration_claim_operation_grant_consumption_body = {
  format: "freed_migration_claim_operation_grant_consumption_v1",
  library_id,
  migration_claim_operation_grant_digest,
  claim_pointer,
  claim_history_root,
  migration_candidate_id,
  claim_fencing_generation,
  operation_kind,
  operation_id,
  authority_domain,
  operation_payload_digest,
  source_attempt_body,
  source_attempt_digest,
  consumed_at_ms,
  authority_store_revision
}

migration_claim_operation_grant_consumption_digest = D(
  "migration-claim-operation-grant-consumption",
  migration_claim_operation_grant_consumption_body
)

migration_claim_source_commit_admission_body = {
  format: "freed_migration_claim_source_commit_admission_v1",
  library_id,
  migration_candidate_id,
  claim_pointer,
  claim_history_root,
  claim_fencing_generation,
  operation_kind:
    "source_contribution_commit" |
    "source_fence_reservation" |
    "source_fence_activation",
  operation_id,
  authority_domain,
  operation_payload_digest,
  migration_claim_operation_grant_digest,
  migration_claim_operation_grant_consumption_digest,
  source_attempt_body,
  source_attempt_digest,
  source_commit_monotonic_ms,
  elapsed_ms
}

migration_claim_source_commit_admission_digest = D(
  "migration-claim-source-commit-admission",
  migration_claim_source_commit_admission_body
)

migration_claim_source_commit_admission_signature = S(
  "migration-claim-source-commit-admission-authority",
  source_authority_private_key,
  { migration_claim_source_commit_admission_digest }
)

migration_source_fence_reservation_payload_body = {
  library_id,
  migration_candidate_id,
  claim_pointer,
  claim_history_root,
  claim_fencing_generation,
  source_installation_id,
  source_key,
  source_generation,
  source_manifest_digest,
  migration_source_digest,
  source_contribution_digest,
  physical_root_binding_digest,
  fence_acquire_operation_id,
  fence_token_digest,
  source_revocation_high_water_mark
}

migration_source_fence_reservation_payload_digest = DB(
  "blob-content",
  C(migration_source_fence_reservation_payload_body)
)

migration_source_fence_reservation_body = {
  format: "freed_migration_source_fence_reservation_v1",
  migration_source_fence_reservation_payload_body,
  migration_source_fence_reservation_payload_digest,
  migration_claim_operation_grant_digest,
  migration_claim_operation_grant_consumption_digest,
  migration_claim_source_commit_admission_body,
  migration_claim_source_commit_admission_digest,
  migration_claim_source_commit_admission_signature
}

migration_source_fence_reservation_digest = D(
  "migration-source-fence-reservation",
  migration_source_fence_reservation_body
)

migration_source_fence_activation_payload_body = {
  library_id,
  migration_candidate_id,
  claim_pointer,
  claim_history_root,
  claim_fencing_generation,
  source_installation_id,
  source_key,
  source_generation,
  source_manifest_digest,
  migration_source_digest,
  source_contribution_digest,
  physical_root_binding_digest,
  migration_source_fence_reservation_digest,
  fence_activate_operation_id,
  activated_at_monotonic_ms,
  finalization_deadline_monotonic_ms,
  source_revocation_high_water_mark
}

migration_source_fence_activation_payload_digest = DB(
  "blob-content",
  C(migration_source_fence_activation_payload_body)
)

migration_source_fence_activation_body = {
  format: "freed_migration_source_fence_activation_v1",
  migration_source_fence_activation_payload_body,
  migration_source_fence_activation_payload_digest,
  migration_claim_operation_grant_digest,
  migration_claim_operation_grant_consumption_digest,
  migration_claim_source_commit_admission_body,
  migration_claim_source_commit_admission_digest,
  migration_claim_source_commit_admission_signature
}

migration_source_fence_activation_digest = D(
  "migration-source-fence-activation",
  migration_source_fence_activation_body
)

migration_claim_abandonment_body = {
  format: "freed_migration_claim_abandonment_v1",
  library_id,
  source_authority,
  abandoned_migration_candidate_id,
  abandoned_migration_authority_installation_id,
  abandoned_claim_digest,
  abandoned_claim_fencing_generation,
  abandonment_operation_id,
  claim_revision,
  predecessor_lifecycle_selector,
  predecessor_claim_history_root,
  abandonment_nonce,
  candidate_state: "absent" | "registered",
  registered_migration_candidate_digest,
  registered_candidate_registration_digest,
  last_batch_digest,
  candidate_checkpoint_digest,
  candidate_object_registry_root_body,
  candidate_object_registry_revision,
  reason_code:
    "source_changed" |
    "claim_expired" |
    "claimant_unavailable" |
    "candidate_invalid" |
    "owner_canceled" |
    "protocol_limit",
  requested_at_ms
}

migration_claim_abandonment_digest = D(
  "migration-claim-abandonment",
  migration_claim_abandonment_body
)

migration_claim_abandonment_authority_signature = S(
  "migration-claim-abandonment-authority",
  source_authority_private_key,
  { migration_claim_abandonment_digest }
)

migration_claim_source_revocation_body = {
  format: "freed_migration_claim_source_revocation_v1",
  library_id,
  source_installation_id,
  source_key,
  migration_claim_abandonment_digest,
  abandoned_migration_candidate_id,
  abandoned_claim_fencing_generation,
  observed_migration_claim_pointer,
  source_generation,
  revocation_operation_id
}

migration_claim_source_revocation_digest = D(
  "migration-claim-source-revocation",
  migration_claim_source_revocation_body
)

migration_candidate_object_registry_entry_body = {
  format: "freed_migration_candidate_object_registry_entry_v1",
  library_id,
  migration_candidate_id,
  claim_fencing_generation,
  staging_kind:
    "target_operation" |
    "target_blob" |
    "migration_batch" |
    "candidate_checkpoint" |
    "media_vault_staging_generation",
  object_digest,
  byte_length,
  registration_operation_id
}

migration_candidate_object_registry_entry_digest = D(
  "migration-candidate-object-registry-entry",
  migration_candidate_object_registry_entry_body
)

migration_candidate_object_commit_payload_body = {
  library_id,
  migration_candidate_id,
  claim_fencing_generation,
  registry_revision,
  predecessor_root_body,
  target_root_body,
  appended_entry_digest,
  registry_operation_id
}

migration_candidate_object_commit_payload_digest = DB(
  "blob-content",
  C(migration_candidate_object_commit_payload_body)
)

migration_candidate_object_registry_body = {
  format: "freed_migration_candidate_object_registry_v1",
  migration_candidate_object_commit_payload_body,
  migration_candidate_object_commit_payload_digest,
  migration_claim_operation_grant_digest,
  migration_claim_operation_grant_consumption_digest
}

migration_candidate_object_registry_digest = D(
  "migration-candidate-object-registry",
  migration_candidate_object_registry_body
)

migration_candidate_staging_census_entry_body = {
  format: "freed_migration_candidate_staging_census_entry_v1",
  migration_candidate_object_registry_entry_body,
  migration_candidate_object_registry_entry_digest,
  verified_object_digest,
  verified_byte_length
}

migration_candidate_staging_census_entry_digest = D(
  "migration-candidate-staging-census-entry",
  migration_candidate_staging_census_entry_body
)

migration_terminal_lifecycle_selector =
  {
    kind: "claim_abandonment",
    digest: migration_claim_abandonment_digest
  } |
  {
    kind: "recovery_supersession",
    digest: migration_recovery_supersession_digest
  }

migration_candidate_staging_census_body = {
  format: "freed_migration_candidate_staging_census_v1",
  library_id,
  terminal_lifecycle_selector,
  migration_candidate_id,
  claim_fencing_generation,
  candidate_object_registry_root_body,
  candidate_object_registry_revision,
  set_kind: "migration_candidate_staging_census",
  entry_count,
  census_root_body
}

migration_candidate_staging_census_digest = D(
  "migration-candidate-staging-census",
  migration_candidate_staging_census_body
)

migration_candidate_object_disposition_receipt_body = {
  library_id,
  terminal_lifecycle_selector,
  migration_candidate_id,
  claim_fencing_generation,
  migration_candidate_staging_census_entry_digest,
  disposition: "quarantined" | "deleted",
  quarantine_storage_root_digest,
  disposition_operation_id
}

migration_source_fence_disposition_receipt_body = {
  library_id,
  terminal_lifecycle_selector,
  migration_candidate_id,
  claim_fencing_generation,
  source_installation_id,
  source_key,
  migration_source_fence_reservation_body,
  migration_source_fence_reservation_digest,
  migration_source_fence_activation_body,
  migration_source_fence_activation_digest,
  migration_claim_source_revocation_digest,
  disposition: "not_acquired" | "released" | "superseded",
  disposition_operation_id
}

migration_staging_disposition_receipt_body = {
  format: "freed_migration_staging_disposition_receipt_v1",
  disposition_kind: "candidate_object" | "source_fence",
  candidate_object_receipt,
  source_fence_receipt,
  authorized_at_ms,
  signing_authority_epoch,
  signing_authority_epoch_id,
  signing_authority_transition_digest,
  signing_authority_key_id
}

migration_staging_disposition_receipt_digest = D(
  "migration-staging-disposition-receipt",
  migration_staging_disposition_receipt_body
)

migration_staging_disposition_receipt_authority_signature = S(
  "migration-staging-disposition-receipt-authority",
  disposition_authority_private_key,
  { migration_staging_disposition_receipt_digest }
)

migration_staging_disposition_set_body = {
  format: "freed_migration_staging_disposition_set_v1",
  disposition_kind: "candidate_object" | "source_fence",
  library_id,
  terminal_lifecycle_selector,
  migration_candidate_id,
  claim_fencing_generation,
  set_kind:
    "migration_candidate_dispositions" |
    "migration_source_fence_dispositions",
  entry_count,
  disposition_root_body
}

migration_staging_disposition_set_digest = D(
  "migration-staging-disposition-set",
  migration_staging_disposition_set_body
)

migration_claim_cleanup_body = {
  format: "freed_migration_claim_cleanup_v1",
  library_id,
  migration_claim_abandonment_digest,
  abandoned_migration_candidate_id,
  abandoned_claim_fencing_generation,
  candidate_state: "absent" | "registered",
  registered_migration_candidate_digest,
  registered_candidate_registration_digest,
  candidate_object_registry_root_body,
  candidate_object_registry_revision,
  last_batch_digest,
  candidate_checkpoint_digest,
  migration_candidate_staging_census_body,
  migration_candidate_staging_census_digest,
  candidate_object_count,
  source_fence_disposition_set_body,
  source_fence_disposition_set_digest,
  source_fence_disposition_count,
  candidate_staging_disposition_set_body,
  candidate_staging_disposition_set_digest,
  candidate_staging_disposition_count,
  cleanup_proof_digest,
  cleanup_proof_storage_root_digest,
  cleanup_proof_byte_length,
  cleanup_operation_id,
  completed_at_ms,
  signing_authority_key_id
}

migration_claim_cleanup_digest = D(
  "migration-claim-cleanup",
  migration_claim_cleanup_body
)

migration_claim_cleanup_authority_signature = S(
  "migration-claim-cleanup-authority",
  source_authority_private_key,
  { migration_claim_cleanup_digest }
)
```

The claim body is closed. `source_authority` is the byte-identical accepted
`legacy_source_authority_body` and the signing key matches its
`authority_key_id`. The source, heads, candidate, and installation fields equal
the immutable proposed candidate input byte for byte. The operation ID and
nonce are fresh opaque identifiers. The operation ID uses the operation-ID
codec. The nonce is 32 random bytes encoded as 64 lowercase hexadecimal
characters. Claim revision and fencing generation are positive safe integers.
There is no protocol-small claim-history cap. The first claim for a library has
revision and fencing generation one, a null predecessor pointer, the canonical
empty `migration_claim_history` root, and a null predecessor cleanup digest. A
renewal increments revision by one, keeps the fencing generation unchanged,
names the exact current candidate-claim pointer and its history root as
predecessors, keeps the predecessor cleanup digest null, and preserves the
source, candidate, installation, and claim mode. The authority store appends
the new lifecycle object to that persistent root before its compare-and-swap
may publish the new pointer. No candidate claim may directly replace a
different candidate or installation.

For `claim_mode: "cloud"`, both timestamps are positive safe integers and
`expires_at_ms` is greater than `claimed_at_ms`. At compare-and-swap admission,
authenticated authority-store time `t` must satisfy
`claimed_at_ms <= t`, `t - claimed_at_ms <= 60000`, `t < expires_at_ms`, and
`expires_at_ms - t <= 1800000`. The accepted compound authority pointer is the
durable proof that the store applied those bounds. Client time never
establishes eligibility or expiry. Expiry stops issuance or consumption of new
operation grants. It does not retroactively invalidate a grant consumed before
its own deadline. After authenticated store time reaches claim expiry, a
surviving installation holding the current source authority may sign and
compare-and-swap an exact `claimant_unavailable` or `claim_expired`
abandonment over that pointer. Expiry never clears the pointer by itself.
For `claim_mode: "local"`, both timestamp fields
are null. The claim never self-expires and only the same local
`library_control` transaction may publish, abandon, or consume it. Every other
nullability combination is invalid.

A cloud source or candidate commit does not rely on a stale claim read. It
consumes one exact `migration_claim_operation_grant` in the linearizable
authority-store grant registry before its local transaction. The source
authority signature, current compound pointer, history root, candidate,
fencing generation, operation ID, authority domain, and operation payload
digest must match. The authority domain is one exact union member with no extra
fields. `source_contribution_commit`, `source_fence_reservation`, and
`source_fence_activation` require the `source` member.
`candidate_object_commit` and `candidate_registration` require
`candidate_registry`. `cutover` requires `library_authority`. Every identity in
the selected member equals the current claim and candidate.

Candidate registration is the first claim-bound authority mutation. While the
immutable candidate registry has no entry for the current claim, the authority
store may issue or consume only `candidate_registration`. It rejects source
contribution, reservation, activation, candidate-object, and cutover grants.
Registration create-if-absent and abandonment compare-and-swap serialize over
the exact claim pointer and exact candidate-registry absence or entry. If
registration wins, abandonment must use `candidate_state: "registered"` and
freeze that exact entry. If abandonment wins with `candidate_state: "absent"`,
registration and every other grant or commit fail the pointer check. A stale
absence read can never publish an absent-state abandonment after registration.

The operation payload digest is
`DB("blob-content", C(operation_payload_body))`, where the payload is the
complete closed authority mutation prepared before the grant. Dispatch is exact:
`source_contribution_commit` uses
`migration_local_source_contribution_payload_body`;
`source_fence_reservation` uses
`migration_source_fence_reservation_payload_body`;
`source_fence_activation` uses
`migration_source_fence_activation_payload_body`; `candidate_object_commit`
uses `migration_candidate_object_commit_payload_body`;
`candidate_registration` uses
`migration_candidate_registration_payload_body`; and `cutover` uses
`migration_cutover_payload_body`. The committed operation wrapper may add only
the matching payload digest, grant, consumption, and applicable source-commit
admission records. Those outer records never enter the payload and therefore
cannot create a grant-consumption hash cycle.
Consumption repeats that digest byte for byte. Changing any payload field
requires a fresh operation ID and grant. Before signing a cloud grant, the
source authority obtains one fresh authenticated authority-store time sample
and copies it byte for byte into `issued_at_ms`. The consuming authority-store
transaction writes its own authenticated time into `consumed_at_ms` and
requires
`issued_at_ms <= consumed_at_ms < expires_at_ms`,
`consumed_at_ms - issued_at_ms <= 60000`,
`expires_at_ms - issued_at_ms <= 60000`,
`consumed_at_ms < claim.expires_at_ms`, and
`expires_at_ms <= claim.expires_at_ms`. A future-issued grant, a grant consumed
at either expiry boundary, or a grant whose issue sample is more than 60,000
milliseconds old is invalid. The strict `<` boundary is the sole cloud expiry
rule. A cloud grant is consumed once by its exact operation ID and cannot be
issued or consumed after claim expiry.

For a cloud grant whose kind is `source_contribution_commit`,
`source_fence_reservation`, or `source_fence_activation`,
`source_attempt_body` and `source_attempt_digest` are non-null. The body is
created by the source runtime before it contacts the authority store. Its
process generation comes from the runtime-owned current process-generation
record, never from a caller parameter. The runtime also creates one
nonserializable live attempt handle that retains the original monotonic clock
anchor and maps only to this attempt digest. Its process generation is a fresh
32-byte random value encoded as 64 lowercase hexadecimal characters and is
never reused by another process generation. Its request timestamp is a
nonnegative safe-integer millisecond sample from that process's monotonic
clock. The grant signs the complete attempt body and digest. Consumption
repeats both byte for byte. A different generation, request anchor, body, or
digest is a permanent mismatch. Serialized equality does not prove liveness
and cannot replace the handle. For a local grant or any non-source operation
kind, both fields are null. Every other nullability combination is invalid.

Consumption atomically writes the closed consumption body and digest above in
the grant registry while the exact pointer and history root remain current.
Exact operation retry returns the same receipt. A different operation body
under that ID is a permanent conflict. The local transaction then commits
within the same bounded monotonic attempt, verifies the receipt, and stores its
digest. A cloud source transaction first proves that the original live attempt
handle still exists, that it maps to the signed attempt digest, and that its
process generation equals the runtime-owned current process-generation record.
Neither value is caller-supplied at commit. A cloud source transaction also
stores and signs the exact
`migration_claim_source_commit_admission_body`. Its source-attempt body and
digest equal the grant and consumption byte for byte. The monotonic anchor
exists only in that live process and cannot be reconstructed after restart.
`source_commit_monotonic_ms` is a nonnegative safe-integer sample from the same
monotonic clock. `elapsed_ms` is the exact nonnegative safe-integer difference
from `source_attempt_body.grant_request_monotonic_ms`. The commit timestamp is
captured inside the source transaction, and
`elapsed_ms < grant.expires_at_ms -
consumption.consumed_at_ms`. A pause and the store round trip count against that
bound. A process restart, missing live handle, changed runtime generation,
missing monotonic anchor, invalid clock sample, or elapsed deadline requires
abandoning the consumed grant and obtaining a fresh operation ID and grant. It
may not synthesize a new handle or admission receipt around the old
consumption. The admission authority domain is the exact `source` member, its
operation kind is one of the three closed source kinds, and every claim,
operation, payload, grant, and consumption field matches byte for byte. The
current source authority verifies the signature in the same source-local
transaction that commits the operation.

Local mode sets the source-attempt body and digest and the source-commit
admission body, digest, and signature to null
because grant consumption and the source operation are one indivisible
`library_control` transaction. A cloud source operation requires both
source-attempt fields and all three admission fields. Failure
before local commit leaves an idempotently consumed but harmless grant. Before
the monotonic deadline, response resolution may reopen the same receipt and the
still-live in-memory attempt handle. After it, a fresh operation ID and grant are
required. A pointer replacement or covering source revocation makes an
uncommitted receipt ineligible. Portable proofs retain the non-secret grant
body, digest, authority signature, consumption body and digest, and applicable
source-commit admission body, digest, and signature.
For `grant_mode: "cloud"`, issue, expiry, and consumption times are positive
safe-integer authority-store milliseconds. The issue value is the exact fresh
authenticated sample bound by the source-authority signature. The consumption
value is assigned by the store transaction, not supplied by the caller. The
store enforces every inequality above before writing the immutable consumption
receipt. The store revision is a positive safe integer. A portable verifier
recomputes those same inequalities from the signed grant and exact consumption
receipt; it never substitutes client wall time or changes the strict boundary.
For `grant_mode: "local"`, all three times and the store revision are null. The
grant and consumption commit in the same local `library_control` transaction
as the operation, with no cloud grant registry. The nonce is 32 random bytes
encoded as 64 lowercase hexadecimal characters in either mode. No other
nullability is valid.

The authority store holds one immutable claim-lifecycle object per digest and
publishes its typed pointer through the compound cloud authority record. It
updates that pointer only through exact-predecessor compare-and-swap while every
non-claim authority field remains byte-identical. Before the first claim, the
pointer is null. Renewal replaces one candidate-claim pointer with the next
claim for the same candidate and fencing generation.
Local mode applies the identical pointer and immutable-object rules inside one
durable `library_control` transaction and local content-addressed lifecycle
store. It performs no cloud compare-and-swap.

Changing source, candidate, or installation requires a signed abandonment.
A voluntary abandonment before cloud expiry is initiated by the claimant and
first commits its crash-durable `abandonment_pending` barrier keyed by the
exact claim pointer. An authenticated owner cancellation may instead be
initiated by the current source authority. After cloud expiry, any surviving
installation holding that current authority may initiate
`claimant_unavailable` or `claim_expired` abandonment without the claimant's
process, token, key, or local barrier. It durably records its own abandonment
intent before compare-and-swap. Local claims do not expire and use the
restarted local authority transaction. These barriers block the initiating
installation's local resume, batch, checkpoint, fence, and staging commits and
survive response loss. If a renewal wins first, abandonment loses. If
abandonment wins, every later grant, source commit, batch, checkpoint, fence,
or staging commit fails its pointer or revocation-generation check.

The abandonment object names the exact current claim, candidate, installation,
fencing generation, next contiguous revision, and predecessor pointer. Its
`source_authority` is the exact current accepted legacy source-authority
projection at abandonment admission, and the current authority key signs it.
The abandoned claim object preserves and verifies its possibly older source
projection through `abandoned_claim_digest`. The compound compare-and-swap
checks both relationships and the candidate registry in one serialization
domain. The operation ID and nonce use the claim codecs. Request time is a
positive safe integer.

For `candidate_state: "absent"`, the candidate registry is proven absent in the
winning abandonment transaction. Registered candidate and registration
digests, last batch, candidate checkpoint, candidate-object root, and registry
revision are all null. This state is valid only because no operation except
candidate registration could receive a grant before registration. Candidate
or registration bytes uploaded before a failed create-if-absent are
non-authoritative garbage and never enter portable closure. For
`candidate_state: "registered"`, both registered digests, the exact current
candidate-object root body, and its contiguous revision are non-null and equal
the immutable registry. Last batch and candidate-checkpoint digests fetch and
recompute as objects for that exact candidate. Either may be null only when its
durable corresponding registry is provably empty. No mixed nullability is
valid. The reason code is one exact literal from the closed schema above.
Abandonment revision is the prior claim revision plus one.
`claim_expired` is valid only for a cloud claim after authenticated store time
reaches its expiry. It is invalid for a local claim. `claimant_unavailable` is
valid for either mode only when current authority can prove that ordinary
claimant cooperation is unavailable. It does not imply local wall-clock
expiry.
Its predecessor history root is the exact current pointer's history root. The
authority store adds the abandonment lifecycle entry to that persistent set
and publishes the resulting root in the replacement pointer. No lifecycle
operation materializes or signs the complete claim history, and collection
size never blocks abandonment.

Abandonment atomically replaces the exact candidate-claim pointer with
`{ kind: "claim_abandonment", digest:
migration_claim_abandonment_digest, claim_history_root }`. The root is the
verified predecessor root plus this exact abandonment entry. Response loss is
resolved by exact pointer readback. The abandonment pointer cannot be replayed
over a later pointer. Pointer replacement revokes candidate authority in the
shared control plane before distributed cleanup begins. A source-local
revocation transaction below is still required because pointer read and fence
commit are not one atomic store operation.

For an absent-state abandonment, no source contribution or fence operation was
admissible, so no source revocation is required and every source-disposition
set is canonically empty. For a registered-state abandonment, the source
revocation and disposition process below remains mandatory.

After a registered-state abandonment wins, each source owner reads the abandonment pointer,
then commits one `migration_claim_source_revocation_body` in the same durable
serialization domain as fence acquire and release. That transaction raises the
source's rejected fencing-generation high-water mark, reads the sole
candidate-source acquisition record, and idempotently releases or supersedes
it. An acquire commit rechecks that no revocation covers its candidate and
fencing generation. If acquire wins first, revocation observes and disposes
it. If revocation wins first, acquire cannot commit. Exact revocation retry or
readback returns the same object and digest. A different body under the same
revocation operation ID or source key is a permanent conflict.

For `candidate_state: "absent"`, cleanup is a bounded terminal proof. It
reopens the exact claim history and abandonment, proves the candidate registry
still has no entry, and carries null candidate, registration, checkpoint,
census, and candidate-root fields. Candidate and source-fence disposition set
bodies use their canonical empty roots, all three counts are zero, and there
are no disposition receipts. The proof may carry the bounded source and
lifecycle bytes required by its portable closure, so it is not described as
fixed-size. The signed cleanup does not claim that unregistered temporary bytes
were deleted. It proves only that no authoritative candidate or source
operation survived.

For `candidate_state: "registered"`, before deleting or quarantining any candidate-local byte, the migration
authority reopens the abandonment's frozen authority-owned candidate root and
streams every registered object from the authority-owned store. It recomputes
each object digest and length, wraps the exact registry entry in one
`migration_candidate_staging_census_entry_body`, and commits the persistent
`migration_candidate_staging_census` set. The census body binds the frozen
candidate-object registry root and revision. In ordinary abandonment cleanup,
its `terminal_lifecycle_selector` is exactly
`{ kind: "claim_abandonment", digest:
migration_claim_abandonment_digest }`; the candidate ID and fencing generation
equal that abandonment. The census root count has no protocol-small cap and is
in exact one-to-one correspondence with that frozen registry. A missing, extra,
or unequal object blocks cleanup. Claimant-local unregistered files are ignored
as garbage rather than invented as proof.

Every disposition first derives and signs one immutable
`migration_staging_disposition_receipt_body`. Its
signing epoch, epoch ID, transition digest, and key ID equal the historical
source authority in the abandonment, `authorized_at_ms` is a positive safe
integer, and that authority key verifies
`migration_staging_disposition_receipt_authority_signature`. The complete
canonical signed object is
`{ migration_staging_disposition_receipt_body,
migration_staging_disposition_receipt_digest,
migration_staging_disposition_receipt_authority_signature }`. It is durable and
read back before any destructive action. The signature authorizes exactly one
idempotent disposition operation. It does not claim that the action has already
completed.

Candidate-object receipts have
`disposition_kind: "candidate_object"`, a non-null census-entry digest, null
source and fence fields, and disposition `quarantined` or `deleted`. A deleted
object may disappear only after the signed receipt is durable and read back.
A deleted receipt has a null quarantine root. A quarantined receipt has a
non-null immutable quarantine storage-root digest whose complete payload was
uploaded, fetched, and verified before receipt signing. After the authorized
physical action is confirmed, the authority appends the complete signed receipt
to the candidate-disposition set. The final signed cleanup, not the
preauthorization alone, attests that every listed action completed. The set has
one receipt for every census entry with no extras, so later portable closure
retains the census entry, signed receipt, and signed cleanup instead of
demanding deleted bytes.

Source-fence receipts have `disposition_kind: "source_fence"`, null
candidate-object census digest, and one exact source identity from the
candidate's composite census, including the elected Automerge source.
Disposition is `not_acquired`, `released`, or `superseded`. `not_acquired`
requires null reservation and activation bodies and digests and a source-local
revocation proving no acquisition existed before later acquisition was barred.
The other two dispositions repeat the sole reservation body and digest.
Activation is non-null only when activation occurred. Each nested grant and
consumption record verifies, including the non-secret token digest.
`released` proves durable release. `superseded`
retains the old record only as non-authoritative evidence behind the revocation
high-water mark. The persistent `migration_source_fence_dispositions` set has
one complete signed receipt for every expected source with no extras.
No candidate payload is physically deleted until that complete source-fence
set is terminal. An unreachable source may delay deletion or final aggregate
creation, but it cannot leave portable history depending on bytes that were
already destroyed.

A crash before signed-receipt durability performs no destructive action. A
crash after receipt durability but before action completion resumes the exact
operation ID and signed bytes. A crash after the action but before set insertion
verifies the terminal physical state and appends that same signed receipt. A
different receipt or physical result under the operation ID is a permanent
conflict. Neither cleanup nor recovery garbage collection may sign its final
aggregate until every action is terminal and every exact signed receipt is in
the applicable authenticated set.

The signed cleanup repeats the abandonment's `candidate_state`, registered
digests, candidate root, revision, batch, and checkpoint byte for byte. In the
registered branch it embeds the three fixed-size authenticated set roots, their
registered digests, and recomputed counts. Set nodes and referenced receipts
are immutable and read back before signing. Cleanup never materializes all
candidate objects or dispositions in one array, and a valid candidate cannot
outgrow the cleanup protocol. The census and both disposition-set bodies use
the exact abandonment selector, candidate ID, and fencing generation carried
by the cleanup. In the absent branch the census body and digest are null and
both disposition roots are the canonical empty roots required above. A
recovery-supersession selector is invalid in
`migration_claim_cleanup_body` and uses the distinct recovery-GC registry
defined under recovery.

The candidate-object registry set sort key is
`(staging_kind, object_digest, byte_length, registration_operation_id)`.
The candidate-staging census sort key is the decoded candidate-object registry
entry digest.
The candidate-disposition sort key is the exact candidate census-entry digest.
The source-fence-disposition sort key is
`(source_installation_id, source_key)`. A `candidate_object` wrapper requires a
non-null candidate-object body and null source-fence body. A `source_fence`
wrapper requires the inverse. Partial, doubled, or cross-kind bodies are
invalid. Each disposition-set entry contains the complete canonical signed
receipt object above and keys it by the field-specific sort key. Counts are
nonnegative safe integers and equal their authenticated root's `entry_count`.

For a registered candidate, an unreachable authoritative source prevents
cleanup creation and registry admission. The abandonment pointer remains
current while that source reconnects, reconciles, or is retired under its
registered policy. Progress may be stored locally, but no partial or immutable
final cleanup object exists. Candidate-absent cleanup has no acquired source
authority to reconcile and is never blocked by source reachability.
Cleanup repeats the exact abandonment batch and checkpoint digests and binds
the complete cleanup-proof triple below and all three set roots. The registered
branch verifies those values against the registered candidate. The absent
branch instead verifies the state-correct null fields and canonical empty
roots. Its operation ID uses the operation-ID codec and its completion time is
a positive safe integer.

The authority store has an immutable create-if-absent cleanup registry keyed by
`migration_claim_abandonment_digest`. It admits one fetched, recomputed,
authority-signed cleanup object after the abandonment pointer is current.
`signing_authority_key_id` equals the authority key in the abandonment's exact
current `source_authority`, and that same historical key verifies the cleanup
signature.
Response loss is resolved by exact registry readback. A different digest is a
permanent collision. The registry is never updated or deleted.

A new claim may replace only that exact abandonment pointer and must name the
registered cleanup digest in `predecessor_claim_cleanup_digest`. The cleanup
may be the candidate-absent terminal proof or the complete registered-candidate
cleanup, but its state must equal the abandonment and every repeated registry
field must match byte for byte. The new claim increments
revision by one, increments fencing generation by one, and uses a fresh
candidate ID. It may bind a new source or installation only after capturing the
new immutable `migration_source_body` and verifying the current accepted legacy
source authority. Claim mode must match the authority store: a compound cloud
record admits only `cloud`, while local `library_control` admits only `local`.
This lifecycle cannot switch an existing library between those modes. The new
pointer's persistent claim-history root contains the complete predecessor set
plus the new claim entry. This creates one authenticated history without
reusing stale candidate authority and without a protocol-small revision limit.

The claimant durably stores the proposed canonical body, digest, signature,
operation ID, predecessor pointer, and canonical `migration_source_body` before
the compare-and-swap. Abandonment likewise persists its complete object and
local pending barrier before publication. Claim setup reopens the source
body and recomputes the claim's source, Automerge, and heads digests without
logically decoding the full corpus. Cloud mode uploads the immutable lifecycle
object, fetches it by digest, and recomputes its body, digest, signature, source
bindings, revision, fencing generation, and predecessor before the authority
pointer may name it.
Response loss is resolved by exact authority-pointer readback. If the pointer
equals the proposed typed pointer, the operation succeeded. If it names a valid
successor, the caller lost authority. If the predecessor remains current, the
caller first resolves the operation ID through the authority store's
linearizable idempotency record. While the original cloud proposal remains
admissible, it may retry only byte-identical bytes. After authenticated store
time is at or beyond that proposal's expiry and the idempotency record proves
it did not commit, the store permanently rejects the old operation ID and may
admit a freshly signed proposal for the same candidate, predecessor, revision,
and fencing generation with a new operation ID, nonce, and timestamps. A
delayed old proposal can no longer win. It never creates a second candidate or
advances revision merely because a response was lost.

Every full source decode, admission-fence acquisition, migration batch,
candidate checkpoint write, and cutover attempt first reads the current claim
and verifies its source-authority signature, exact source and candidate
identity, claim mode, revision, fencing generation, predecessor history, and,
in cloud mode, unexpired authority-store time. Cloud expiry or any pointer
replacement stops new work. The current accepted legacy source-authority
projection must also remain byte-identical to the claim's `source_authority`.
A changed frontier, transition, key, or source operation stops work and
requires signed abandonment. An in-flight
local computation may finish only as non-authoritative staging. It cannot enter
the migration proof or accepted epoch after its claim loses. The claim grants
only this migration candidate authority. It grants no provider, release,
backup, recovery, or ordinary Library Core write authority.

Every source and target authority serializes the highest observed migration
fencing generation with its own fence or staging commits and rejects a lower
generation. Every device-local source owner independently fetches and verifies
the current candidate-claim pointer before exporting a contribution or granting
a fence, then binds the claim digest and fencing generation into that durable
record. A later generation supersedes an old fence but cannot pretend that the
source contributed to the new candidate. Any local commit that raced a remote
pointer change remains candidate-local evidence and is ineligible for the
winning proof.

Fence reservation and activation are source-local idempotent transactions
keyed by `(library_id, migration_candidate_id, claim_fencing_generation,
source_installation_id, source_key)`. Reservation carries one stable
`fence_acquire_operation_id`, the exact current claim and consumed operation
grant, expected source generation, manifest digest, migration-source digest,
contribution digest, and physical-root binding digest. The reserved Automerge
source has all three source-specific digests null. No device-local source
permits any of them to be null. The reservation grant binds
`migration_source_fence_reservation_payload_digest`. The reservation wrapper
then binds that same payload to the matching grant and consumption receipts
without a circular hash dependency.

The source owner, not the migration coordinator, generates the 32-byte random
fence token and stores it in protected crash-recovery state before reserving.
The durable authority record stores only
`fence_token_digest = DB("admission-fence-token", fence_token_bytes)`. The
complete non-secret request and consumed grant receipt serialize with the
source-revocation high-water mark. A covering revocation or higher fencing
generation rejects reservation. Exact retry returns the same record and token
digest, never the token. A different operation or token digest for the same
key is permanently rejected. Cloud reservation and activation also verify and
store their exact source-commit admission body, digest, and source-authority
signature. Local mode requires those three fields to be null because each
operation and grant consumption share one transaction.

Reservation state is `reserved` and does not affect ordinary writes.
Activation uses a separate stable operation ID and current
`source_fence_activation` grant. In one source-authority transaction it
rechecks the exact pointer, claim-history root, candidate, fencing generation,
source generation, manifest, physical-root binding, contribution, reservation,
and revocation high-water mark, then changes state to `active`. Exact retry
returns the same active record. The caller receives only the record and digest.
The activation grant binds
`migration_source_fence_activation_payload_digest`. The activation wrapper
binds that same payload to the matching grant and consumption receipts. Its two
monotonic timestamps are positive safe integers from that source process. The
deadline is after activation and no more than 60,000 milliseconds later. They
are never compared across installations. Cloud cutover admission uses
authenticated authority-store time. Local cutover admission uses only the
local authority transaction's monotonic deadline.

Release is requested by operation ID; the source owner loads its protected
token, recomputes the digest, and atomically changes the exact reservation or
active record to `released`. It is idempotent and terminal for that candidate,
generation, and source. A lost response is resolved by record readback, so it
cannot strand a fence whose source owner lacks the token or create a second
one. Reacquisition requires signed abandonment and a higher fencing
generation. Proofs and cleanup cite the reservation, activation, release, and
grant-consumption records without publishing the bearer token.

Cutover compares the exact final candidate-claim pointer, fencing generation,
and, in cloud mode, unexpired authority-store time in the authority transaction
that installs the transition. The receipt carries a stable
`cutover_operation_id` but no grant or consumption digest. The exact `cutover`
grant binds `migration_cutover_payload_digest`, which commits the complete
source tuple, final claim and history root, migration receipt, target transition
core fields and every transition-independent target tuple field, and that
operation ID without a circular hash. Cloud mode consumes that grant while the
exact source tuple and claim remain current. The signer then derives the final
transition certificate, which
embeds the exact payload, grant, authority signature, and consumption bodies
and their digests alongside the bound core fields. Only after its digest exists
does the target authority derive and sign the transition-dependent manifest
authentication object. The
winning compare-and-swap rechecks the still-current unexpired claim and exact
consumption, verifies that authentication object against the certificate and
payload's manifest fields, installs the certificate and complete target tuple, and
clears the pointer atomically. A consumed grant whose later compare-and-swap
loses is harmless. Exact retry may reuse its immutable consumption only while
the same pointer is current and unexpired. Portable verification resolves the
unique grant and consumption through the receipt's operation ID, recomputes the
payload, and requires every final-certificate cutover-admission field to match.
A response-loss readback must find the certificate, target tuple, and
cleared pointer together or none of them. Local-only cutover consumes its grant,
derives the certificate, and installs all effects in one indivisible
`library_control` transaction. A local-only
claim cannot transfer to another installation and requires the signed
abandonment path before a new candidate. A lost cutover response is resolved
from the accepted transition and cleared pointer. It never reopens or replaces
the consumed claim.

Before the first migration batch, one immutable candidate record fixes the
initial winning claim, target authority, and actor:

```text
migration_candidate_body = {
  migration_candidate_id,
  library_id,
  migration_source_digest,
  source_authority,
  migration_authority_installation_id,
  initial_migration_claim_body,
  initial_migration_claim_digest,
  initial_migration_claim_authority_signature,
  target_epoch,
  target_epoch_id,
  target_authority_public_key,
  target_authority_key_id,
  target_actor_id,
  target_actor_enrollment_certificate,
  target_actor_enrollment_certificate_digest,
  target_actor_starting_tip,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length,
  target_media_vault_restore_plan_digest,
  target_media_vault_restore_plan_storage_root_digest,
  target_media_vault_restore_plan_byte_length,
  target_media_vault_manifest_digest,
  target_media_vault_generation,
  target_media_vault_admission_fence
}

migration_candidate_digest = D(
  "migration-candidate",
  migration_candidate_body
)

migration_candidate_registration_payload_body = {
  library_id,
  migration_candidate_id,
  migration_candidate_digest,
  initial_migration_claim_digest,
  registration_migration_claim_digest,
  claim_fencing_generation,
  initial_candidate_object_registry_root_body,
  registration_operation_id
}

migration_candidate_registration_payload_digest = DB(
  "blob-content",
  C(migration_candidate_registration_payload_body)
)

migration_candidate_registration_body = {
  format: "freed_migration_candidate_registration_v1",
  migration_candidate_registration_payload_body,
  migration_candidate_registration_payload_digest,
  migration_claim_operation_grant_digest,
  migration_claim_operation_grant_consumption_digest
}

migration_candidate_registration_digest = D(
  "migration-candidate-registration",
  migration_candidate_registration_body
)

migration_candidate_registration_authority_signature = S(
  "migration-candidate-registration-authority",
  source_authority_private_key,
  { migration_candidate_registration_digest }
)
```

The registration grant binds
`migration_candidate_registration_payload_digest`; the wrapper binds that same
payload to the exact grant and consumption without a circular digest.
`source_authority` inside the candidate is the exact accepted
`legacy_source_authority_body`.
`migration_authority_installation_id` names the one capable installation
selected by the authenticated candidate-claim compare-and-swap for this exact
source digest. The initial claim object is the first accepted current claim for
this candidate and recomputes its digest and authority signature. Its source,
candidate, and installation fields equal the enclosing candidate. A competing
installation may prepare bounded local evidence, but cannot decode the complete
source, fence it, or commit target operations under the winning candidate.
Losing or expired candidate work remains non-authoritative staging and is
safely discarded.
Target authority key ID, actor ID, enrollment digest, and starting tip
recompute from the complete bytes in this record. The record is durable and
read back before any target operation commits.

The authority store has an immutable create-if-absent registry keyed by
`(library_id, migration_candidate_id)`. Registration is admitted only while
`registration_migration_claim_digest` names the exact current claim for the
same candidate and fencing generation and, in cloud mode, that claim is
unexpired. The initial digest still equals the candidate's first winning claim.
The current registration claim may be that initial claim or any valid renewal
in its unbroken same-candidate chain. Candidate, registration, both claims,
source authority, installation, and source digest agree byte for byte. The
operation ID uses the operation-ID codec. Before create-if-absent, the complete
candidate and signed registration objects are durable, uploaded, fetched back,
and recomputed.
The create-if-absent transaction and abandonment use one linearizable
serialization boundary over the claim pointer and this registry key.
Registration rechecks the candidate-claim pointer immediately before inserting
the entry. Abandonment rechecks the exact absent or registered entry immediately
before replacing that pointer. Neither an absent-state abandonment and a
registration nor two unequal registrations can both win.
Response loss is resolved by exact registry readback. The exact digest means
success. A different digest is a permanent candidate-ID collision. The mapping
is never updated or deleted, including after abandonment.

Candidate registration also creates the canonical empty
`migration_candidate_objects` root. Before any staged target object, batch,
checkpoint, blob, or media generation can enter a proof or become eligible for
cutover, its immutable bytes are uploaded to the authority-owned candidate
store, fetched back, and verified by digest and length. Only then may the
source authority append one exact
`migration_candidate_object_registry_entry_body` to that root through
linearizable compare-and-swap. The authority-owned store retains the bytes
until the registry entry receives a terminal disposition. The registry body
wraps the exact `migration_candidate_object_commit_payload_body`. Its
`candidate_object_commit` grant binds the payload digest, and the wrapper binds
the exact grant and consumption without a circular digest. The payload commits
the candidate, fencing generation, predecessor and target roots, appended
entry, revision, and idempotent operation ID. Revision starts at one, advances
contiguously, and exact retry returns the same state. A different append under
one operation ID is a permanent conflict.

The authority-owned root is the complete candidate object registry.
Claimant-local
temporary files that never entered it are non-authoritative garbage and are
irrelevant to abandonment, recovery, backup, or a successor claim. Each
proof-eligible local commit stores the exact accepted registry digest and root
alongside its object. A registry append that wins without the local commit is a
durable authority-owned object but an incomplete candidate operation. It blocks
cutover until the same operation finishes or the object is terminally
dispositioned. A local object commit without the winning append remains
ineligible staging.

Abandonment reads and freezes the exact current root and registry revision in
its signed body. Any surviving installation holding the source authority can
then coordinate cleanup from that shared census without the claimant's disk,
token, key, or process. A source that is unreachable must first be reconciled
or retired through its explicit writer-retirement policy. That authority
operation advances the source-local revocation high-water mark and supplies
the source-fence terminal receipt. Physical access to a dead claimant never
gates a successor claim.

Every batch, final receipt, candidate checkpoint, closure, and transition names
the one registered candidate digest and byte-identical target actor and
media-plan identity. An accepted claim with an unregistered candidate ID grants
no target-write authority. This prevents one claim from blessing two candidate
bodies with different target keys, actors, or media plans.

The migration uses deterministic bytewise ordering by `(registry_key,
primary_key, leaf_path, dynamic_key_or_occurrence)`. A migration transaction
obeys the same 1,000-member and 4 MiB canonical-byte bounds as every other
transaction. One large entity or preferences root may therefore span batches.
Each committed batch records:

```text
migration_batch_body = {
  library_id,
  target_epoch,
  target_epoch_id,
  migration_candidate_id,
  migration_candidate_digest,
  migration_source_digest,
  active_migration_claim_body,
  active_migration_claim_digest,
  active_migration_claim_authority_signature,
  batch_index,
  previous_batch_digest,
  first_cursor,
  last_cursor,
  transaction_digests,
  entity_counts,
  operation_count,
  row_count,
  canonical_byte_length,
  batch_frontier,
  batch_frontier_digest,
  batch_materialized_digest,
  cumulative_frontier,
  cumulative_frontier_digest
}

migration_batch_digest = D("migration-batch", migration_batch_body)
```

`first_cursor` and `last_cursor` are closed
`{ registry_key, primary_key, leaf_path, dynamic_key_or_occurrence }` objects
using the same singleton convention and bytewise ordering as migration.
`batch_index`, counts, and length are nonnegative safe integers.
`previous_batch_digest` is null only for index zero and required otherwise.
`transaction_digests` remains in emitted transaction order.
`entity_counts` contains closed `{ registry_key, count }` entries sorted by
ASCII registry key. Both frontiers use the exact branch-qualified canonical tip
shape, and their digests recompute through `D("causal-frontier", ...)`.
The active claim object is the exact current claim read immediately before the
target transaction. It recomputes its digest and signature, belongs to this
candidate and installation, has an unbroken predecessor chain from the
candidate's initial claim, was current at commit admission, and, in cloud mode,
was unexpired then.
The batch materialized digest recomputes through
`D("materialized-state", ...)` over the transactionally updated
`materialized_commitment_body`. Applying one batch updates only its touched
leaves and canonical ancestor paths from the previous batch commitment. It
never re-enumerates rows committed by earlier batches. Final migration
verification independently streams the complete candidate once and recomputes
the canonical trie root.

Resume is allowed only when the source identity and completed batch receipts
still match. A changed source starts a new candidate generation. It never
continues under the old receipt.

An abandonment cleanup is independently verifiable through this chunked
artifact, whose digest, root, and length are committed by the signed cleanup:

```text
migration_claim_cleanup_proof_body = {
  library_id,
  migration_claim_abandonment_body,
  migration_claim_abandonment_digest,
  migration_claim_abandonment_authority_signature,
  migration_claim_history_root,
  candidate_state: "absent" | "registered",
  migration_candidate_body,
  migration_candidate_digest,
  migration_candidate_registration_body,
  migration_candidate_registration_digest,
  migration_candidate_registration_authority_signature,
  migration_source_body,
  migration_source_digest,
  candidate_object_registry_root_body,
  candidate_object_registry_revision,
  candidate_checkpoint_digest,
  candidate_checkpoint_storage_root_digest,
  candidate_checkpoint_byte_length,
  migration_candidate_staging_census_body,
  migration_candidate_staging_census_digest,
  source_fence_disposition_set_body,
  source_fence_disposition_set_digest,
  candidate_staging_disposition_set_body,
  candidate_staging_disposition_set_digest
}

migration_claim_cleanup_proof_digest = D(
  "migration-claim-cleanup-proof",
  migration_claim_cleanup_proof_body
)

migration_claim_cleanup_proof_byte_length =
  byte_length(C(migration_claim_cleanup_proof_body))

migration_claim_cleanup_proof_storage_root_body = {
  artifact_kind: "migration_claim_cleanup_proof",
  artifact_digest: migration_claim_cleanup_proof_digest,
  canonical_byte_length: migration_claim_cleanup_proof_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

migration_claim_cleanup_proof_storage_root_digest = D(
  "chunked-object-root",
  migration_claim_cleanup_proof_storage_root_body
)
```

`migration_claim_history_root` contains every exact lifecycle object from
revision one through the abandonment, including bodies, digests, and authority
signatures, but excludes the cleanup object that will bind this proof. Bounded
set traversal verifies the contiguous predecessor chain without embedding it
as an array. The proof's state and every repeated field equal the abandonment
and cleanup byte for byte.

For `candidate_state: "absent"`, candidate, registration, candidate-root,
checkpoint, and census fields are null. The immutable candidate registry is
still absent and both disposition sets are canonical empty sets. No unbounded
grant-registry scan is required. The signed abandonment was admitted by the
same serialization domain that permits only candidate-registration issuance
and consumption while the registry is absent, and its winning absence check
revoked that claim pointer before any later grant could commit. The proof
retains the migration source body named by the claim but creates no candidate
or deletion fiction. For `"registered"`, the candidate and registration reopen
the immutable candidate registry. The source body and the candidate-object
census jointly name every
contributor certificate, signed local contribution, batch, target operation,
target blob, media staging generation, and candidate checkpoint. The verifier
streams every set node and recomputes the batch chain and abandonment digests.
For a quarantined disposition it also streams the retained payload and
recomputes its digest and length. For a deleted disposition it verifies only
the pre-disposition census entry, terminal signed receipt, and signed cleanup
aggregate that roots the receipt. It must not fetch or require deliberately
deleted payload bytes. Missing or extra set members, receipts, or retained
objects are invalid.

In the registered branch, the checkpoint digest, root, and length are either
all null when the durable candidate checkpoint registry was empty, or all
non-null and resolve one verified `logical_checkpoint_body`. Its checkpoint
payload is required only when quarantined; a deleted checkpoint is proven by
its census entry and terminal receipt. The source-fence and
candidate-disposition roots equal the cleanup body byte for byte. Each
disposition receipt reopens its idempotent durable record and corresponds to
exactly one expected source or census entry. In the absent branch, checkpoint
and census fields are null and both disposition sets prove zero membership.

The cleanup proof root and every chunk are durable and read back before the
authority signs the cleanup. Its digest, storage root, and byte length equal
the cleanup body. The immutable cleanup registry reopens and verifies this
complete artifact before admitting the cleanup. A portable backup, genesis
closure, or later claim that depends on the abandonment retains the root, every
chunk, every authenticated set node, every census entry and terminal
disposition receipt, and every immutable protocol object that still exists.
For a `deleted` disposition it retains the pre-disposition census entry and
signed terminal receipt under the signed cleanup, not the deliberately deleted
candidate payload.

Verification is field-level, not ID-only. It covers absence versus null,
non-finite historical values, device-local exclusions, blob digests,
relationships, preferences, delete-wins concurrency, explicit restore,
retirement, and every schema registry entry.

The corpus-sized migration evidence is finalized before source fences activate:

```text
migration_prepared_proof_body = {
  library_id,
  target_epoch,
  target_epoch_id,
  migration_candidate_id,
  migration_candidate_digest,
  migration_candidate_registration_body,
  migration_candidate_registration_digest,
  migration_candidate_registration_authority_signature,
  migration_source_body,
  migration_source_digest,
  migration_claim_history_root,
  initial_migration_claim_digest,
  final_migration_claim_digest,
  final_migration_claim_fencing_generation,
  local_source_contributions,
  source_fence_reservations,
  batches,
  root_counts,
  field_counts,
  entity_counts,
  dispositions,
  target_frontier,
  target_frontier_digest,
  target_materialized_digest,
  target_checkpoint_digest,
  target_checkpoint_storage_root_digest,
  target_checkpoint_byte_length,
  target_reachable_blob_set_digest,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length,
  target_media_vault_restore_plan_digest,
  target_media_vault_restore_plan_storage_root_digest,
  target_media_vault_restore_plan_byte_length,
  target_media_vault_manifest_digest,
  target_media_vault_generation,
  target_media_vault_admission_fence
}

migration_prepared_proof_digest = D(
  "migration-prepared-proof",
  migration_prepared_proof_body
)

migration_prepared_proof_byte_length =
  byte_length(C(migration_prepared_proof_body))

migration_prepared_proof_storage_root_body = {
  artifact_kind: "migration_prepared_proof",
  artifact_digest: migration_prepared_proof_digest,
  canonical_byte_length: migration_prepared_proof_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

migration_prepared_proof_storage_root_digest = D(
  "chunked-object-root",
  migration_prepared_proof_storage_root_body
)

source_admission_fence_entry_body =
  {
    format: "freed_source_admission_fence_entry_v1",
    transition_kind: "migration",
    library_id,
    transition_id: migration_candidate_id,
    source_installation_id,
    source_key,
    migration_source_fence_reservation_body,
    migration_source_fence_reservation_digest,
    migration_source_fence_activation_body,
    migration_source_fence_activation_digest,
    reservation_grant_body,
    reservation_grant_digest,
    reservation_grant_authority_signature,
    reservation_consumption_body,
    reservation_consumption_digest,
    activation_grant_body,
    activation_grant_digest,
    activation_grant_authority_signature,
    activation_consumption_body,
    activation_consumption_digest
  } |
  {
    format: "freed_source_admission_fence_entry_v1",
    transition_kind: "rollback",
    library_id,
    transition_id: rollback_id,
    source_installation_id,
    source_key,
    rollback_source_fence_reservation_body,
    rollback_source_fence_reservation_digest,
    rollback_source_fence_reservation_authority_signature,
    rollback_source_fence_activation_body,
    rollback_source_fence_activation_digest,
    rollback_source_fence_activation_authority_signature
  }

source_admission_fence_entry_digest = D(
  "source-admission-fence-entry",
  source_admission_fence_entry_body
)

source_admission_fence_set_body =
  {
    format: "freed_source_admission_fence_set_v1",
    transition_kind: "migration",
    library_id,
    migration_candidate_id,
    migration_prepared_proof_digest,
    rollback_id: null,
    rollback_prepared_proof_digest: null,
    set_kind: "source_admission_fences",
    entry_count,
    root_node_digest
  } |
  {
    format: "freed_source_admission_fence_set_v1",
    transition_kind: "rollback",
    library_id,
    migration_candidate_id: null,
    migration_prepared_proof_digest: null,
    rollback_id,
    rollback_prepared_proof_digest,
    set_kind: "source_admission_fences",
    entry_count,
    root_node_digest
  }

source_admission_fence_set_digest = D(
  "source-admission-fence-set",
  source_admission_fence_set_body
)

transition_finalization_sidecar_entry_body = {
  index,
  object_kind:
    "migration_source_fence_activation" |
    "rollback_source_fence_activation" |
    "source_admission_fence_entry" |
    "authenticated_object_set_node" |
    "migration_proof" |
    "rollback_proof" |
    "chunked_object_root" |
    "chunked_object_chunk",
  object_digest,
  canonical_byte_length
}

transition_finalization_sidecar_entry_digest = D(
  "transition-finalization-sidecar-entry",
  transition_finalization_sidecar_entry_body
)

transition_finalization_sidecar_body =
  {
    format: "freed_transition_finalization_sidecar_v1",
    transition_kind: "migration",
    library_id,
    migration_candidate_id,
    migration_prepared_proof_digest,
    rollback_id: null,
    rollback_prepared_proof_digest: null,
    source_admission_fence_set_body,
    source_admission_fence_set_digest,
    source_fence_count,
    entry_count,
    canonical_payload_byte_length,
    entries
  } |
  {
    format: "freed_transition_finalization_sidecar_v1",
    transition_kind: "rollback",
    library_id,
    migration_candidate_id: null,
    migration_prepared_proof_digest: null,
    rollback_id,
    rollback_prepared_proof_digest,
    source_admission_fence_set_body,
    source_admission_fence_set_digest,
    source_fence_count,
    entry_count,
    canonical_payload_byte_length,
    entries
  }

transition_finalization_sidecar_digest = D(
  "transition-finalization-sidecar",
  transition_finalization_sidecar_body
)

transition_finalization_sidecar_byte_length =
  byte_length(C(transition_finalization_sidecar_body)) +
  transition_finalization_sidecar_body.canonical_payload_byte_length

migration_proof_body = {
  library_id,
  target_epoch,
  target_epoch_id,
  migration_candidate_id,
  migration_candidate_digest,
  migration_candidate_registration_digest,
  migration_source_digest,
  migration_claim_history_root,
  initial_migration_claim_digest,
  final_migration_claim_digest,
  final_migration_claim_fencing_generation,
  migration_prepared_proof_digest,
  migration_prepared_proof_storage_root_digest,
  migration_prepared_proof_byte_length,
  source_admission_fence_set_body,
  source_admission_fence_set_digest,
  source_fence_count,
  target_frontier_digest,
  target_materialized_digest,
  target_checkpoint_digest,
  target_checkpoint_storage_root_digest,
  target_checkpoint_byte_length,
  target_reachable_blob_set_digest,
  target_media_vault_manifest_digest,
  target_media_vault_generation
}

migration_proof_digest = D("migration-proof", migration_proof_body)

migration_proof_byte_length = byte_length(C(migration_proof_body))

migration_proof_storage_root_body = {
  artifact_kind: "migration_proof",
  artifact_digest: migration_proof_digest,
  canonical_byte_length: migration_proof_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

migration_proof_storage_root_digest = D(
  "chunked-object-root",
  migration_proof_storage_root_body
)

migration_receipt_body = {
  library_id,
  target_epoch,
  target_epoch_id,
  migration_candidate_id,
  migration_candidate_digest,
  migration_candidate_registration_digest,
  target_authority_public_key,
  target_authority_key_id,
  target_actor_id,
  target_actor_enrollment_certificate,
  target_actor_enrollment_certificate_digest,
  target_actor_starting_tip,
  target_actor_ending_tip,
  migration_source_digest,
  initial_migration_claim_digest,
  final_migration_claim_digest,
  final_migration_claim_fencing_generation,
  cutover_operation_id,
  migration_prepared_proof_digest,
  migration_prepared_proof_storage_root_digest,
  migration_prepared_proof_byte_length,
  migration_proof_digest,
  migration_proof_storage_root_digest,
  migration_proof_byte_length,
  source_admission_fence_set_digest,
  source_fence_count,
  transition_finalization_sidecar_digest,
  transition_finalization_sidecar_byte_length,
  transition_finalization_sidecar_object_count,
  batch_count,
  source_root_count,
  source_field_count,
  source_entity_count,
  source_disposition_count,
  migrated_operation_count,
  migrated_row_count,
  target_frontier_digest,
  target_materialized_digest,
  target_checkpoint_digest,
  target_checkpoint_storage_root_digest,
  target_checkpoint_byte_length,
  target_reachable_blob_set_digest,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length,
  target_media_vault_restore_plan_digest,
  target_media_vault_restore_plan_storage_root_digest,
  target_media_vault_restore_plan_byte_length,
  target_media_vault_manifest_digest,
  target_media_vault_generation,
  target_media_vault_admission_fence,
  target_database_schema,
  integrity_result,
  build_identity
}

migration_receipt_digest = D(
  "migration-receipt",
  migration_receipt_body
)

migration_cutover_payload_body = {
  format: "freed_migration_cutover_payload_v1",
  library_id,
  source_compound_authority_tuple,
  migration_candidate_id,
  migration_candidate_digest,
  final_migration_claim_pointer,
  migration_claim_history_root,
  final_migration_claim_fencing_generation,
  migration_receipt_digest,
  transition_finalization_sidecar_digest,
  transition_finalization_sidecar_byte_length,
  transition_finalization_sidecar_object_count,
  transition_reason: "automerge_migration",
  target_epoch,
  target_epoch_id,
  target_engine,
  target_schema,
  target_replication_protocol,
  target_genesis_manifest_digest,
  target_genesis_closure_digest,
  target_genesis_closure_storage_root_digest,
  target_genesis_closure_byte_length,
  source_enrolled_actor_census,
  target_enrolled_actor_census,
  target_manifest_digest,
  target_manifest_generation,
  target_active_recovery_digest,
  target_recovery_capability_change_pointer,
  target_spent_recovery_redemptions_digest,
  target_migration_claim_pointer,
  signing_authority_key_id,
  target_authority_public_key,
  target_authority_key_id,
  cutover_operation_id
}

migration_cutover_payload_digest = DB(
  "blob-content",
  C(migration_cutover_payload_body)
)
```

Sidecar indexes are contiguous from zero and `entry_count` equals the array
length and the receipt's `transition_finalization_sidecar_object_count`.
`canonical_payload_byte_length` is the exact safe-integer sum of entry byte
lengths. Every entry's immutable canonical bytes are present in the atomic
authority bundle and recompute its registered digest and byte length. The
complete `transition_finalization_sidecar_byte_length` is positive and at most
2,097,152, entry count is at most 1,024, and source-fence count is at most 65.
The entry-kind registry admits only activation evidence, its authenticated set
nodes, and the fixed final proof and wrappers. A receipt, cutover payload,
cutover grant, cutover consumption, genesis closure, manifest authentication
object, or transition certificate in the sidecar is invalid. The sidecar and
its set body repeat the same transition kind, library, migration candidate or
rollback ID, prepared-proof digest, fence count, and required null fields byte
for byte.
The fence set uses the authenticated-object-set contract. Its sort key is the
closed `{ source_installation_id, source_key,
reservation_operation_id }` body, where the operation ID is selected from the
branch's exact reservation body. Entries sort by decoded installation ID,
ASCII source key, and bytewise operation ID. The composite source identity is
unique within one set.

`migration_claim_history_root` is the exact persistent authenticated set root
published by the final winning claim pointer. Its entries contain the complete
lifecycle from revision one through that claim. Each entry is one closed
`{ sort_key, migration_claim_history_entry_body,
migration_claim_history_entry_digest }` value. The sort key and body use the
root-free schema above, and the entry digest recomputes through
`migration-claim-history-entry`.
For `kind: "candidate_claim"`, `lifecycle_object` is the exact
`{ migration_candidate_claim_body, migration_candidate_claim_digest,
migration_candidate_claim_authority_signature }` object. For
`kind: "claim_abandonment"`, it is the exact
`{ migration_claim_abandonment_body, migration_claim_abandonment_digest,
migration_claim_abandonment_authority_signature }` object. Cleanup is never
embedded in or added to the history entry. The root-free selector kind and
digest exactly match its immutable lifecycle object.

When a later claim names an abandonment's non-null
`predecessor_claim_cleanup_digest`, verification resolves that exact cleanup
from the immutable registry and its proof digest, storage-root digest, and byte
length from immutable storage. It
reads back the root and every chunk, reconstructs the canonical cleanup-proof
body, recomputes all three commitments, and verifies its complete candidate,
registration, source-contributor, contribution, batch, checkpoint, revocation,
fence, and staging closure. A cleanup body or registry lookup without that
verified proof is not a valid predecessor for a later claim.

Bounded traversal of the persistent set reconstructs entries in numeric claim
revision order and verifies contiguous revisions and exact typed predecessor
pointers.
Renewals preserve source, candidate, installation, claim mode, and fencing
generation. Abandonment consumes the exact prior claim. A later claim consumes
that exact abandonment plus its cleanup digest, increments fencing generation,
and uses a new candidate ID. The initial claim digest selects the first claim
for the winning candidate. From there through the final claim, only renewals
for that same source, candidate, installation, mode, and fencing generation are
allowed. `final_migration_claim_digest` selects the final entry,
`final_migration_claim_fencing_generation` equals its generation, and that
claim was current and, in cloud mode, unexpired when cutover committed.
History is never truncated or reset. The proof streams the set and lifecycle
objects without materializing the full history, and no history-size threshold
blocks renewal, abandonment, cleanup, or cutover.

The prepared proof recomputes the candidate-registration body, digest, and
authority signature, reopens the immutable
`(library_id, migration_candidate_id)` registry entry, and requires
byte-identical equality. Its initial claim equals the candidate's initial
claim. Its registration claim is a valid current claim in the same candidate
chain and fencing generation at registration admission. The final proof and
receipt repeat the registered and prepared-proof digests, so the receipt,
proofs, candidate, and transition cannot disagree about target keys, actor
identity, media plan, or source.

The prepared proof's `local_source_contributions` contains the full closed
`{ migration_local_source_contribution_body,
migration_local_source_contribution_digest,
migration_local_source_contribution_signature }` objects sorted by decoded
source installation ID and then ASCII source key. Each digest recomputes from
its body and each signature verifies through the exact contributor certificate
committed by `migration_source_body`. Exactly one contribution exists for every
`local_sources` descriptor, with no extras, and every contribution payload
field equals that descriptor, the proof's source, candidate, current claim, and
final claim fencing generation. Its wrapper's grant, consumption, and
source-commit admission records verify against that exact payload.
The Automerge source has no entry in this array because its immutable bytes,
heads, generation, and length are committed directly by
`migration_source_body`.

The prepared proof's `source_fence_reservations` contains the reservation half
of every final entry. It is complete, sorted, uploaded, read back, and verified
before activation. The final `source_admission_fence_set_body` is a persistent
authenticated set whose entries contain closed
`{ source_installation_id, source_key,
migration_source_fence_reservation_body,
migration_source_fence_reservation_digest,
migration_source_fence_activation_body,
migration_source_fence_activation_digest,
reservation_grant_body, reservation_grant_digest,
reservation_grant_authority_signature,
reservation_consumption_body, reservation_consumption_digest,
activation_grant_body, activation_grant_digest,
activation_grant_authority_signature,
activation_consumption_body, activation_consumption_digest }` objects sorted
by decoded source installation ID, ASCII source key, and bytewise canonical
reservation operation ID. Each grant payload digest equals the corresponding
reservation or activation payload digest. `claim_pointer` inside each payload
selects a valid claim in
`migration_claim_history_root` for this candidate and was current when the source
owner granted the fence. `claim_fencing_generation` equals the final migration
claim fencing generation. `migration_source_digest` always equals the proof's
source digest. For a device-local source, `source_manifest_digest`,
`source_contribution_digest`, and `physical_root_binding_digest` are non-null and equal
its exact descriptor, contribution object, and source binding. For the
reserved Automerge source, all three fields are null, and `source_generation` equals
`automerge_source_generation`. No other nullability is valid. The composite
source identity is unique, so exactly
one fence entry exists for every `local_sources` entry plus the Automerge
source, with no extras. The Automerge fence uses
`migration_authority_installation_id` and reserved source key `automerge`.
Every fence entry reopens the source owner's durable reservation and activation
records by their composite key and operation IDs and requires every field to
match byte for byte. The nested cloud source-commit admission records verify
against those exact grant and consumption objects and their monotonic
deadlines. Local records carry the required null admission fields.
The set entry digest and every authenticated set node recompute. Its migration
candidate ID and prepared-proof digest equal this migration, both rollback
fields are null, and `source_fence_count` equals its entry count. The final
proof commits that set directly. The migration receipt and
cutover commit its digest and the exact finalization sidecar digest, object
count, and byte length. The winning authority compare-and-swap atomically
persists the sidecar, final proof, receipt, cutover grant and consumption,
transition certificate, manifest authentication object, and target tuple. No
receipt or transition may substitute a token digest, claim, generation, or
acquire operation that is absent from the set.

The prepared proof's `batches` contains every closed
`{ migration_batch_body, migration_batch_digest }` pair in contiguous
`batch_index` order and verifies the previous-digest chain. `root_counts`
contains closed
`{ source_installation_id, source_key, root_key, count }` entries.
Its `field_counts` contains closed
`{ source_installation_id, source_key, registry_key, field_path, count }`
entries. Its `entity_counts` contains closed
`{ source_installation_id, source_key, registry_key, count }` entries. Each
collection is sorted by decoded source installation ID, ASCII source key, and then
its remaining ASCII key fields. Every composite key is unique and every count
is a nonnegative safe integer. Its `dispositions` contains one instance of this
literal closed schema for every source path, sorted by decoded source
installation ID, ASCII source key, and bytewise `C(source_path)`:

```text
{
  source_installation_id,
  source_key,
  source_path,
  disposition: "mapped" | "opaque_evidence" | "excluded" | "blocking",
  source_entry_digest,
  source_content_digest,
  source_byte_length,
  target_registry_key,
  target_primary_key,
  target_membership_proof,
  target_blob_digest,
  target_blob_byte_length,
  opaque_evidence_kind,
  opaque_content_digest,
  opaque_byte_length,
  opaque_storage_root_digest,
  registered_exclusion,
  blocking_reason_code
}
```

`source_path` is one of three closed tagged objects:

```text
{
  kind: "automerge",
  root_key,
  registry_key,
  primary_key,
  leaf_path,
  occurrence_id
}

{
  kind: "reader_content",
  source_namespace,
  source_locator
}

{
  kind: "media_vault",
  source_entry_digest
}
```

Automerge root, registry, primary-key, leaf, and occurrence fields use the
exact field-registry and migration cursor codecs. Fields that do not apply to a
singleton or non-occurrence leaf are null. Reader namespace and locator equal
one exact reader source-manifest entry. Media source-entry digest equals one
exact included entry or signed exclusion in the media source manifest.
The `source_key` and path kind must be `automerge` and `automerge`,
`reader_content` and `reader_content`, or `media_vault` and `media_vault`.

The composite `(source_installation_id, source_key, source_path)` is unique.
The Automerge source again uses the elected migration installation ID and
reserved source key `automerge`.

`target_membership_proof` is the closed
`{ target_checkpoint_digest, target_frontier_digest,
materialized_key_digest, materialized_row_digest, materialized_leaf_digest,
trie_path }` object. `trie_path` is the ordered array of at most 256 closed
`{ branch_bit, sibling_side: "left" | "right", sibling_digest,
sibling_row_count }` steps from the leaf to the checkpoint's
`materialized_commitment_body.trie_root_digest`. Branch bits and row counts use
the materialized-trie rules above. Verifiers recompute the key, row, leaf, each
branch, final root, row counts, checkpoint, and frontier. The key body is
exactly `{ registry_key: target_registry_key,
primary_key: target_primary_key }`.

For `mapped`, the target registry key, primary key, membership proof, and
applicable target blob fields are required and every evidence,
exclusion, and blocking field is null. For `opaque_evidence`, target fields are
null,
`opaque_evidence_kind` is exactly `unknown_schema_bytes`,
`nonfinite_legacy_value`, `unregistered_legacy_value`,
`reader_identity_ambiguous`, `reader_identity_unresolved`, or
`reader_cache_request_unbound`; content digest, positive safe byte length, and
storage-root digest are required; and exclusion and blocking fields are null.
The root has artifact kind
`migration_opaque_evidence`, the same artifact digest and byte length, and an
exact verified chunk set. Those roots and chunks are part of the target
provenance closure, remain reachable anywhere the migration receipt remains,
and never masquerade as materialized rows.

For `excluded`, target, target-blob, opaque, and blocking fields are null and
`registered_exclusion` is the closed
`{ registry_key, field_path, field_registry_version,
exclusion_policy: "device_local" }` object. It must match the exact frozen
field-registry rule for this source path. Owner preference, an unsupported
value, or missing bytes cannot be relabeled as device-local exclusion. For
`blocking`, target, target-blob, opaque, and exclusion fields are null and
`blocking_reason_code` is exactly `unknown_required_field`,
`invalid_source_value`, `reader_identity_conflict`,
`reader_content_missing`, `media_vault_conflict`,
`source_digest_mismatch`, `source_generation_changed`, or
`unregistered_source_path`. Any blocking disposition prevents a successful
migration proof or receipt. No other nullability combination is valid.

For a reader-content path, `source_entry_digest`, `source_content_digest`, and
`source_byte_length` are required and equal one exact entry in that
installation's reader manifest. They are null for Automerge and media-vault
paths, whose existing cursor or entry-digest fields already identify their
source. A mapped reader entry must be `resolved` and use a native locator or a
`bound` Cache locator. Its target blob digest and positive byte length are
required and equal the source content digest and byte length byte for byte.
Its `target_registry_key` and `target_primary_key` equal the source entry's
verified `entity_reference.registry_key` and
`entity_reference.primary_key` byte for byte. Its identity evidence is
reopened and reverified before the target mapping commits. A mapped reader body
cannot be attached to another target entity even when its bytes or locator
match. Its membership proof verifies that exact entity key in the migration
candidate's final target checkpoint. A blob existing without that materialized
entity membership, or membership under another key, is not a mapped result.
Before the disposition is accepted, migration streams the exact source bytes,
recomputes their digest and length, writes the target blob, reads it back, and
recomputes the same values. Target-blob fields are null for every non-reader
path and every non-mapped reader disposition.

Every reader-manifest entry has exactly one disposition with its source entry
digest, and no disposition cites an absent or second entry. An unbound Cache
entry deterministically becomes `reader_cache_request_unbound` opaque
evidence. Otherwise an ambiguous or unresolved entry becomes the corresponding
reader identity opaque kind. Every remaining resolved entry is mapped or
blocking under one exact reason above. This bijection preserves every source
body and forbids silent identity assignment, skipped reader bytes, or mapping
one source body to another target blob.
The receipt's seven summary counts are nonnegative safe integers and equal the
corresponding exact totals recomputed while streaming the proof. The receipt,
proof, candidate, final batch, target checkpoint, and target manifest agree on
every repeated candidate, source, target, frontier, materialized, blob-set,
media, claim, fence, and actor commitment. `integrity_result` is exactly
`passed`.
Target frontier, materialized, checkpoint, blob-set, database-schema, and build
fields use their registered closed schemas and independently recompute every
named digest.
The media-vault fields equal the complete `operation_kind: "migration"` plan
whose operation ID is `migration_candidate_id`. The snapshot digest equals
`migration_source_body.source_media_vault_snapshot_digest`; its storage root
and byte length equal the corresponding source fields. The target plan storage
root and every chunk are durable and reachable, its byte length is a
nonnegative safe integer, and its target manifest generation and admission
fence equal the plan byte for byte.

Every opaque-evidence root and chunk is independently fetched and verified
before `integrity_result` may be `passed`; every registered exclusion
recomputes from the frozen field registry. A missing, extra, dangling, or
wrong-kind evidence root blocks cutover.

The fixed-size receipt never embeds the proof body, batch array, disposition
array, frontier, or count maps. Its proof root and every chunk, plus every
opaque-evidence root and chunk named by its dispositions, are present in the
transition closure before source authority signs the transition and remain
reachable through every checkpoint, backup, and historical authority proof
that retains the receipt.

Any missing source root, field, batch, disposition, or target digest makes the
receipt incomplete and blocks cutover. A `blocking` disposition prevents
`integrity_result: "passed"` and cutover even when every source path has been
enumerated.

Cutover requires:

- complete source enumeration;
- zero unexplained field differences;
- exact count and digest agreement;
- database integrity checks;
- query contract checks;
- candidate snapshot plus the Gate C crash and retry proof that discarding an
  uncommitted candidate leaves every source authority unchanged;
- current source heads equal the migration source heads;
- every authoritative device-local generation equals the captured generation;
- the final authenticated migration claim remains current and, in cloud mode,
  unexpired;
- every receipt-bound source admission fence remains held;
- the target media-vault exclusive fence remains held, its complete plan and
  manifest are reopened and verified, and no target-vault write has escaped it;
- no active legacy mutation, device-local authoritative write, or cloud merge;
- one atomic authority and epoch transaction that installs the target
  media-vault pointer and generation with `library_control`.

If the source changes before cutover, verification is invalid. The migration
restarts from a new immutable source. The final admission fences are mandatory,
not an optional startup optimization.

Cutover also requires every known legacy writer to have reconciled or been
explicitly deferred or retired. A local snapshot is not proof that an offline
device holds no divergent Automerge history.

## Rollback and recovery

- Before cutover, rollback deletes only the candidate generation.
- After the first `library_core_v1` write, rollback is a forward migration to a
  newer epoch that preserves every committed operation. Restoring the
  pre-cutover Automerge binary is prohibited. A compatibility export may serve
  as the target only when it proves parity at the current frontier.
- After legacy retirement, recovery rolls forward from a verified
  adapter-neutral logical checkpoint plus operation segments. It does not
  restore an old Automerge writer.
- A failed authority transaction leaves the previous epoch active.
- A committed transaction whose response was lost is recovered by operation ID
  and receipt.
- A corrupt local database is quarantined before restore. It is never replaced
  until the recovery input passes digest and frontier validation.

Before any rollback target mutation, one immutable candidate fixes the source
snapshot, target authority, target actor, and fenced media plan:

```text
rollback_candidate_body = {
  rollback_id,
  library_id,
  source_authority,
  source_epoch,
  source_epoch_id,
  source_transition_digest,
  source_frontier_digest,
  source_materialized_digest,
  source_checkpoint_digest,
  source_checkpoint_storage_root_digest,
  source_checkpoint_byte_length,
  source_reachable_blob_set_digest,
  source_media_vault_manifest_digest,
  source_media_vault_generation,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length,
  target_epoch,
  target_epoch_id,
  target_authority_public_key,
  target_authority_key_id,
  target_actor_id,
  target_actor_enrollment_certificate,
  target_actor_enrollment_certificate_digest,
  target_actor_starting_tip,
  target_engine: "library_core_v1",
  target_schema_version,
  target_replication_protocol: "op_segments_v1",
  target_media_vault_restore_plan_digest,
  target_media_vault_restore_plan_storage_root_digest,
  target_media_vault_restore_plan_byte_length,
  target_media_vault_manifest_digest,
  target_media_vault_generation,
  target_media_vault_admission_fence
}

rollback_candidate_digest = D(
  "rollback-candidate",
  rollback_candidate_body
)
```

`source_authority` is the exact accepted compound cloud authority tuple. The
source checkpoint, reachable set, media snapshot, manifest pointer, and
generation are captured from that authority. The media plan has
`operation_kind: "rollback"` and `operation_id: rollback_id`. Target authority
key ID, actor ID, enrollment digest, starting tip, plan root, and every target
media identity recompute from the complete candidate. The candidate is durable
and read back before any target operation or target-vault staging write.
`rollback_sources` contains at most 65 closed
`{ source_installation_id, source_key, source_generation,
source_root_digest, physical_root_binding_digest }` entries sorted by decoded
installation ID and ASCII source key. `source_key` is exactly `library_core` or
`media_vault`, the composite identity is unique, and each digest and generation
equals the source owner's current durable authority record. There is exactly
one `library_core` entry and a `media_vault` entry only when that vault has an
independent write-serialization domain.

Every post-cutover rollback uses its own valid source-fence schema. It never
borrows migration-only claim fields:

```text
rollback_source_fence_reservation_body = {
  format: "freed_rollback_source_fence_reservation_v1",
  rollback_id,
  rollback_candidate_digest,
  library_id,
  source_authority,
  source_epoch,
  source_epoch_id,
  source_transition_digest,
  source_installation_id,
  source_key,
  source_generation,
  source_root_digest,
  physical_root_binding_digest,
  source_frontier_digest,
  source_checkpoint_digest,
  source_media_vault_generation,
  fence_acquire_operation_id,
  fence_token_digest,
  source_revocation_high_water_mark,
  reserved_at_monotonic_ms
}

rollback_source_fence_reservation_digest = D(
  "rollback-source-fence-reservation",
  rollback_source_fence_reservation_body
)

rollback_source_fence_reservation_authority_signature = S(
  "rollback-source-fence-reservation-authority",
  source_authority_private_key,
  { rollback_source_fence_reservation_digest }
)

rollback_source_fence_activation_body = {
  format: "freed_rollback_source_fence_activation_v1",
  rollback_id,
  rollback_candidate_digest,
  library_id,
  source_authority,
  source_epoch,
  source_epoch_id,
  source_transition_digest,
  source_installation_id,
  source_key,
  source_generation,
  source_root_digest,
  physical_root_binding_digest,
  source_frontier_digest,
  source_checkpoint_digest,
  source_media_vault_generation,
  rollback_source_fence_reservation_digest,
  fence_activate_operation_id,
  activated_at_monotonic_ms,
  finalization_deadline_monotonic_ms,
  source_revocation_high_water_mark
}

rollback_source_fence_activation_digest = D(
  "rollback-source-fence-activation",
  rollback_source_fence_activation_body
)

rollback_source_fence_activation_authority_signature = S(
  "rollback-source-fence-activation-authority",
  source_authority_private_key,
  { rollback_source_fence_activation_digest }
)

rollback_prepared_proof_body = {
  rollback_id,
  rollback_candidate_digest,
  library_id,
  source_epoch,
  source_epoch_id,
  source_transition_digest,
  source_engine,
  source_schema_version,
  source_replication_protocol,
  source_frontier_digest,
  source_materialized_digest,
  source_checkpoint_digest,
  source_checkpoint_storage_root_digest,
  source_checkpoint_byte_length,
  source_reachable_blob_set_digest,
  source_media_vault_manifest_digest,
  source_media_vault_generation,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length,
  source_fence_reservations,
  target_epoch,
  target_epoch_id,
  dispositions,
  target_frontier,
  target_frontier_digest,
  target_materialized_digest,
  target_checkpoint_digest,
  target_checkpoint_storage_root_digest,
  target_checkpoint_byte_length,
  target_reachable_blob_set_digest,
  target_media_vault_restore_plan_digest,
  target_media_vault_restore_plan_storage_root_digest,
  target_media_vault_restore_plan_byte_length,
  target_media_vault_manifest_digest,
  target_media_vault_generation,
  target_media_vault_admission_fence
}

rollback_prepared_proof_digest = D(
  "rollback-prepared-proof",
  rollback_prepared_proof_body
)

rollback_prepared_proof_byte_length =
  byte_length(C(rollback_prepared_proof_body))

rollback_prepared_proof_storage_root_body = {
  artifact_kind: "rollback_prepared_proof",
  artifact_digest: rollback_prepared_proof_digest,
  canonical_byte_length: rollback_prepared_proof_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

rollback_prepared_proof_storage_root_digest = D(
  "chunked-object-root",
  rollback_prepared_proof_storage_root_body
)

rollback_proof_body = {
  rollback_id,
  rollback_candidate_digest,
  library_id,
  source_epoch,
  source_epoch_id,
  source_transition_digest,
  target_epoch,
  target_epoch_id,
  rollback_prepared_proof_digest,
  rollback_prepared_proof_storage_root_digest,
  rollback_prepared_proof_byte_length,
  source_admission_fence_set_body,
  source_admission_fence_set_digest,
  source_fence_count,
  target_frontier_digest,
  target_materialized_digest,
  target_checkpoint_digest,
  target_checkpoint_storage_root_digest,
  target_checkpoint_byte_length,
  target_reachable_blob_set_digest,
  target_media_vault_manifest_digest,
  target_media_vault_generation
}

rollback_proof_digest = D("rollback-proof", rollback_proof_body)

rollback_proof_byte_length = byte_length(C(rollback_proof_body))

rollback_proof_storage_root_body = {
  artifact_kind: "rollback_proof",
  artifact_digest: rollback_proof_digest,
  canonical_byte_length: rollback_proof_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

rollback_proof_storage_root_digest = D(
  "chunked-object-root",
  rollback_proof_storage_root_body
)

rollback_receipt_body = {
  rollback_id,
  rollback_candidate_digest,
  library_id,
  source_epoch,
  source_epoch_id,
  source_transition_digest,
  source_engine,
  source_schema_version,
  source_replication_protocol,
  source_frontier_digest,
  source_materialized_digest,
  source_checkpoint_digest,
  source_checkpoint_storage_root_digest,
  source_checkpoint_byte_length,
  source_reachable_blob_set_digest,
  source_media_vault_manifest_digest,
  source_media_vault_generation,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length,
  target_epoch,
  target_epoch_id,
  target_authority_public_key,
  target_authority_key_id,
  target_actor_id,
  target_actor_enrollment_certificate,
  target_actor_enrollment_certificate_digest,
  target_actor_starting_tip,
  target_actor_ending_tip,
  target_engine: "library_core_v1",
  target_schema_version,
  target_replication_protocol: "op_segments_v1",
  rollback_prepared_proof_digest,
  rollback_prepared_proof_storage_root_digest,
  rollback_prepared_proof_byte_length,
  rollback_proof_digest,
  rollback_proof_storage_root_digest,
  rollback_proof_byte_length,
  source_admission_fence_set_digest,
  source_fence_count,
  transition_finalization_sidecar_digest,
  transition_finalization_sidecar_byte_length,
  transition_finalization_sidecar_object_count,
  source_disposition_count,
  target_frontier_digest,
  target_materialized_digest,
  target_checkpoint_digest,
  target_checkpoint_storage_root_digest,
  target_checkpoint_byte_length,
  target_reachable_blob_set_digest,
  target_media_vault_restore_plan_digest,
  target_media_vault_restore_plan_storage_root_digest,
  target_media_vault_restore_plan_byte_length,
  target_media_vault_manifest_digest,
  target_media_vault_generation,
  target_media_vault_admission_fence,
  compatibility_export_digest,
  integrity_result: "passed",
  build_identity
}

rollback_receipt_digest = D("rollback-receipt", rollback_receipt_body)
```

The rollback prepared proof contains every corpus-sized disposition,
checkpoint, frontier, and reservation object and is uploaded, fetched, and
verified before activation. Each reservation and activation uses the exact
rollback candidate and accepted source-authority tuple. There is no migration
claim digest or nullable stand-in. Each source owner signs its own reservation
and activation, serializes activation with ordinary source writes, and requires
one exact `rollback_sources` descriptor plus the source epoch, transition,
frontier, checkpoint, media generation, token digest, operation IDs, and
revocation high-water mark to match byte for byte. There is exactly one
reservation and one activation per descriptor with no extras.

The final rollback fence set uses the rollback branch of
`source_admission_fence_entry_body`, has exactly one activation for every
prepared reservation, contains no migration branch, repeats the exact rollback
ID and rollback-prepared-proof digest, and has null migration fields. The same
65-fence,
2,097,152-byte, 1,024-object, 65-mutation, one-atomic-bundle, and 60,000-ms
finalization caps apply. Exceeding any cap releases every activated fence and
produces no rollback transition. The final proof binds only the prepared-proof
triple, authenticated activation-set root and count, and fixed target
commitments. The receipt binds both proof triples plus the exact finalization
sidecar digest, count, and length. The winning authority compare-and-swap
atomically persists the sidecar, final proof, receipt, transition certificate,
manifest authentication object, and target tuple.

`dispositions` contains one migration-style closed disposition for every
source registry path and blob root, with no `blocking` entry.
`source_fence_count` and `source_disposition_count` are nonnegative safe
integers and equal the exact authenticated-set and streamed prepared-proof
counts. Source and target frontiers and materialized digests prove semantic
parity after applying every committed source operation. Target epoch is exactly
source epoch plus one and its epoch ID is fresh. Every candidate, authority,
actor, source snapshot, plan, manifest, generation, and fence field equals
`rollback_candidate_body` byte for byte. The actor ending tip is the verified
target actor tip after all rollback transactions. The target remains Library
Core authority. An Automerge compatibility export is non-authoritative derived
output: its digest is required only when one is produced and null otherwise.
It must reproduce the same registered logical projection, but it never changes
target engine or replication protocol. The fixed receipt never embeds the
proof, fences, dispositions, or frontier. Its proof roots and chunks remain
reachable anywhere the receipt is retained.

The transition certificate contains `rollback_receipt_digest` and null
`migration_receipt_digest` for `transition_reason: "rollback"`. The active
source authority signature over that transition is the rollback authorization.
Its prebuilt target closure carries the candidate, rollback-prepared-proof root
and chunks, target actor certificate, candidate checkpoint, media plan storage
root and chunks, and target manifest. The certificate directly binds the
receipt, rollback-proof root and chunks, finalization sidecar, and manifest
authentication object outside that closure.
Every other transition has null `rollback_receipt_digest`. Checkpoints retain
the complete receipt record only when one is in their authority history.

## Export, import, snapshot, and restore

Markdown export is a sharing format, not a backup. It may omit relationships,
field clocks, tombstones, device-local state, conflict records, operation
history, and exact absence semantics.

The complete backup format includes:

- one adapter-neutral logical checkpoint containing authenticated rows,
  field clocks, relationships, tombstones, actor state, receipts, frontier,
  and materializer position;
- an optional adapter-specific physical checkpoint built from the verified
  logical checkpoint in a fresh scrubbed store, never copied from a live
  mixed-authority database;
- operation frontier and required uncheckpointed segments;
- schema and epoch metadata;
- content-addressed blobs;
- historical actor enrollments, authority certificates, and public keys;
- an encrypted library-authority recovery capability when the backup is
  intended to resume the same library;
- a manifest with per-file digests;
- an explicit list of excluded secrets and device-local fields.

Active actor private keys are always excluded. A same-library backup is not
declared restorable unless its encrypted authority recovery capability can be
opened and its key ID matches the certified authority chain. An already active
device may instead enroll the restored installation. Without either path,
restore is an import into a new library ID, not a resurrection of the old
library's write authority.

### Backup encryption format

Portable backup format `freed_backup_v1` encrypts every database checkpoint,
operation segment, blob, and private recovery-key file.

The portable artifact is one canonical framed byte stream. It begins with the
16 bytes `UTF8("FREED_BACKUP_V1") || 0x00`, followed by an unsigned
big-endian 16-bit version equal to one and an unsigned big-endian 64-bit record
count. Each record is:

```text
record_index_u64_be
path_byte_length_u32_be
path_utf8_bytes
content_byte_length_u64_be
content_bytes
```

Indexes begin at zero, are contiguous, and equal physical order. Path length is
1 through 4,096 bytes. Record count, record index, and content length cannot
exceed the JavaScript safe-integer maximum, and the applicable role limit is
checked before allocation. The final 32 bytes are
`hex_decode(DB("backup-container", all_preceding_container_bytes))`, followed
by exact end of file. Hashing, writing, and parsing are streaming operations.
No implementation buffers the full artifact or one unbounded record.

Record zero is exact `C({ backup_bundle_body, backup_bundle_digest,
backup_bundle_signature })` at `bundle/backup-bundle.jcs`. Record one is the
encrypted manifest at
`manifest/backup-manifest.jcs.xchacha20poly1305`. Inventory page records follow
in the fixed category-field order of `backup_inventory_root_body`. Each
category is emitted depth-first from its signed root, with child descriptors in
canonical range order. This lets a streaming reader authenticate each parent
before its child arrives and reconstruct the exact page census without an
unbounded path map. Ordinary encrypted-file records follow in canonical
`logical_path` order at
`files/` plus its exact logical path plus
`.xchacha20poly1305`. Record count equals two plus the exact reachable inventory
page count plus the number of encrypted file entries. The manifest path, every
inventory path, and every derived ciphertext path use only lowercase ASCII
letters, decimal digits, `/`, `.`, `_`, and `-`. They are unique under exact
bytes and path-prefix interpretation. No Unicode or case-fold algorithm
participates in archive identity. A collision is invalid before emission.

Only these regular-file records exist. Directories are an in-memory path
interpretation, not records. Symlinks, hard links, sparse extents, devices,
alternate streams, mode bits, timestamps, owner IDs, platform metadata,
duplicate paths, extra records, noncanonical UTF-8, backslashes, absolute
paths, empty components, dot components, and parent components are forbidden.
The reader parses the bundle and encrypted manifest first, walks and validates
the inventory page records in the exact authenticated preorder, derives each
ordinary expected path and length incrementally from the encrypted-file leaf
pages, then streams ordinary records in exact order and checks every ciphertext
length and digest before decryption. A ZIP, directory,
or platform package may transport the one stream, but that wrapper is not part
of `freed_backup_v1` and never supplies identity or authority.

Within the authenticated content, the unencrypted outer header contains only
the closed fields needed to choose the decoder and key derivation parameters:

```text
{
  format: "freed_backup_v1",
  recovery_mode: "same_library" | "import_only",
  backup_id,
  library_id,
  source_epoch,
  source_epoch_id,
  authority_key_id,
  canonical_encoding: "rfc8785_jcs",
  digest_algorithm: "sha256",
  kdf: {
    algorithm: "argon2id",
    version: 19,
    salt,
    memory_kib: 65536,
    iterations: 3,
    parallelism: 1,
    output_bytes: 32
  },
  aead: {
    algorithm: "xchacha20_poly1305_ietf",
    nonce_bytes: 24,
    nonce_prefix_bytes: 16,
    chunk_plaintext_bytes: 1048576,
    max_file_plaintext_bytes: 17179869184,
    tag_bytes: 16
  }
}
```

`salt` is a fresh cryptographically random 16-byte lowercase hexadecimal
value. The KDF input is the exact UTF-8 bytes of the owner-entered recovery
secret. No Unicode normalization, trimming, case folding, or terminating null
is applied. The interface must make that exactness visible and must not retain
the recovery secret after derivation.

The KDF output wraps one fresh cryptographically random 32-byte
`backup_data_key`. The closed recovery-envelope body is:

```text
{
  header,
  wrap_nonce,
  wrapped_backup_data_key
}

recovery_envelope_digest = D(
  "backup-recovery-envelope",
  recovery_envelope_body
)
```

`wrap_nonce` is a fresh 24-byte lowercase hexadecimal value.
`wrapped_backup_data_key` is lowercase hexadecimal ciphertext with the
16-byte authentication tag appended. Its associated data is
`C({ header, purpose: "backup_data_key" })`. The recovery-envelope digest is
stored in the backup manifest. It is also bound by the recovery delegation.
The envelope does not contain the manifest digest, so envelope, manifest, and
delegation derivation remain acyclic.

Every encrypted logical file uses independently authenticated chunks and a
closed manifest entry containing:

```text
{
  role,
  logical_path,
  media_type,
  content_digest,
  protocol_object_digest,
  plaintext_byte_length,
  plaintext_digest,
  nonce_prefix,
  chunk_count,
  chunk_ciphertext_digests,
  ciphertext_byte_length,
  ciphertext_digest
}
```

`role` is exactly one of `physical_checkpoint`,
`operation_segment`, `recovery_private_key`,
`source_manifest`, `source_manifest_auth`,
`active_recovery_capabilities`, `spent_recovery_redemptions`,
`recovery_capability_change_certificate`, `recovery_delegation_certificate`,
`authority_transition_certificate`,
`migration_candidate_claim`, `migration_claim_abandonment`,
`migration_claim_cleanup`,
`migration_claim_source_revocation`,
`migration_source_contributor_certificate`,
`migration_local_source_contribution`,
`migration_candidate`, `migration_candidate_registration`,
`migration_batch`, `migration_receipt`, `rollback_candidate`,
`rollback_receipt`, `compaction_receipt`,
`repair_receipt`, `restore_preparation`, `restore_staging`,
`import_execution_receipt`,
`chunked_object_root`, `chunked_object_chunk`,
`actor_enrollment_certificate`, or `actor_retirement_certificate`. A new role
requires a backup format version.
The v1 archive contains no direct regular-file checkpoint entry. Its exact
current logical checkpoint is the chunked artifact selected by the signed
manifest's checkpoint digest, storage-root digest, and byte length. In
`same_library` mode the archive also contains exactly one
`recovery_private_key` entry at `recovery/private-key.bin`; in `import_only`
mode it contains none. The recovery entry plaintext is exactly the
32-byte RFC 8032 Ed25519 seed encoding that derives the delegation's
`recovery_public_key`. It also retains its file-level plaintext digest below.
`content_digest` is the exact chunk digest for
`chunked_object_chunk` and null for every other role. Complete library and
media payload identity lives in the corresponding chunked-object root rather
than a regular-file entry.
`protocol_object_digest` is the exact segment, source-manifest,
source-manifest-auth, active-recovery, spent-redemption, capability-change,
recovery-delegation, migration-candidate-claim, migration-claim-abandonment,
migration-claim-cleanup, migration-claim-source-revocation,
migration-source-contributor-certificate,
migration-local-source-contribution, migration-candidate,
migration-candidate-registration, migration-batch, migration-receipt,
rollback-candidate, rollback-receipt,
compaction-receipt, repair-receipt, restore-preparation, restore-staging,
import-execution-receipt, chunked-object-root,
enrollment-certificate, or retirement-certificate digest for those roles and
null for every other role.
For `authority_transition_certificate` it is exactly
`D("epoch-transition-certificate", certificate_body)`, and the plaintext is
the complete outer certificate header with its canonical body, digest, target
authority proof, and discriminated authorization proof.
For `migration_candidate_claim`, `migration_claim_abandonment`, and
`migration_claim_cleanup`, it is respectively the registered
`migration_candidate_claim_digest`, `migration_claim_abandonment_digest`, or
`migration_claim_cleanup_digest`, and plaintext is the complete canonical
object containing body, digest, and authority signature.
For `migration_claim_source_revocation`, it is
`migration_claim_source_revocation_digest`, and plaintext is the complete
canonical body and digest. For `migration_source_contributor_certificate`, it
is `migration_source_contributor_certificate_digest`, and plaintext is the
complete canonical body, digest, contributor proof, and source-authority
signature. For `migration_local_source_contribution`, it is
`migration_local_source_contribution_digest`, and plaintext is the complete
canonical body, digest, and contributor signature. For
`migration_candidate_registration`, it is
`migration_candidate_registration_digest`, and plaintext is the complete
canonical body, digest, and authority signature. For `migration_batch`, it is
`migration_batch_digest`, and plaintext is the complete canonical body and
digest.
For `restore_preparation` it is exactly
`D("restore-preparation", restore_preparation_body)`.
For `import_execution_receipt` it is exactly
`D("import-execution-receipt", import_execution_receipt_body)`.
For `chunked_object_root` it is exactly
`D("chunked-object-root", chunked_object_root_body)`, and the plaintext is the
complete canonical root object. A `chunked_object_chunk` has null
`protocol_object_digest`.
Certificate and authentication plaintext is the complete canonical object, not
only its body or digest.

The archive contains exactly one current checkpoint root and zero or more
historical checkpoint roots, all with artifact kind `checkpoint`. A historical
root is required for every
candidate, accepted, or replacement checkpoint named by a retained transition,
receipt, restore staging object, genesis closure, or compaction proof when that
checkpoint is not the current logical checkpoint. Historical checkpoints are
immutable proof objects, never alternate local activation choices. Their
canonical bytes, byte lengths, and digests reverify before authority history is
accepted. Root and chunk logical paths use the deterministic chunked-object
paths below, so two canonical objects cannot alias one path.

The root-role entries are the exact no-extra union of the current logical
checkpoint root, every required historical checkpoint root, one deterministic
`content_blob` or `media_vault_file` root for every
`reachable_blob_set_body.blobs` entry, the backup's media-vault snapshot root,
every `import_provenance_evidence` root named by each retained import plan and
its generated-provenance set, every source logical-checkpoint root named by a
retained import plan, and every other root required by retained import,
migration, rollback, compaction, repair, restore, genesis-closure, or exclusion
provenance. The chunk-role
entries are the exact deduplicated union, by content digest and byte length, of
every chunk named by those roots. Every root chunk has one matching chunk-role
entry and every chunk-role entry is named by at least one root. An equal digest
with a different length, a root without all chunks, or an unreferenced root or
chunk invalidates the bundle.

```text
plaintext_digest = DB("backup-file-plaintext", plaintext_bytes)
ciphertext_digest = DB("backup-file-ciphertext", ciphertext_bytes)
```

The closed `file_associated_data_body` is
`{ format: "freed_backup_v1", backup_id, role, logical_path, media_type,
content_digest, protocol_object_digest, plaintext_byte_length,
plaintext_digest }`.

`nonce_prefix` is 16 fresh random bytes encoded as 32 lowercase hexadecimal
characters and cannot repeat under one backup data key. Chunk index is a
zero-based safe integer. Its 24-byte XChaCha nonce is
`hex_decode(nonce_prefix) || uint64_be(chunk_index)`. Every non-final chunk has
exactly 1,048,576 plaintext bytes. The final chunk has the exact remainder.
A zero-byte file has one empty-plaintext chunk. `chunk_count` is therefore
`max(1, ceil(plaintext_byte_length / 1048576))` and at most 16,384. Each chunk
uses associated data `C({ file: file_associated_data_body, chunk_index,
chunk_count, chunk_plaintext_offset, chunk_plaintext_byte_length })`.

`ciphertext_bytes` is the exact concatenation of chunk ciphertexts in index
order. Every non-final ciphertext is 1,048,592 bytes and the final ciphertext
is its plaintext length plus the 16-byte tag, so no extra framing or inferred
padding exists. `chunk_ciphertext_digests` has exactly `chunk_count` entries in
index order, each equal to
`DB("backup-file-ciphertext-chunk", chunk_ciphertext_bytes)`.
`ciphertext_digest` covers the complete concatenation. Duplicate logical paths,
plaintext digests with different lengths, ciphertext digests with different
lengths, repeated nonce prefixes, or chunk arrays inconsistent with the file
lengths are invalid.

Encryption and restore hold at most one plaintext and one ciphertext chunk in
memory. After each chunk tag verifies, restore writes its plaintext only to an
unexposed durable quarantine file. No parser or application reader can open
that file until all chunks, total lengths, the whole plaintext digest, and the
whole ciphertext digest verify. On failure the quarantine file is deleted.
This same framing applies to the encrypted backup manifest, logical checkpoint,
physical checkpoint, segments, blobs, and media files.

Archive logical paths are canonical lowercase-ASCII slash-separated relative
paths using only letters, decimal digits, `.`, `_`, and `-` inside a component.
They have no empty, dot, parent, absolute, or backslash component and no exact
or path-prefix collision. A logical path occupies at most 4,072 ASCII bytes,
so the exact 6-byte `files/` prefix and 18-byte
`.xchacha20poly1305` suffix always fit the container's 4,096-byte record-path
limit.

Every encrypted protocol-object role other than `physical_checkpoint`,
`recovery_private_key`, `chunked_object_root`, and `chunked_object_chunk` uses
the exact logical path
`proof/objects/<role>/<protocol_object_digest>.bin`. The role literal and
lowercase hexadecimal digest are copied byte for byte from the file entry.
`recovery_private_key` uses its fixed path above. A physical checkpoint uses
the exact path in its physical-checkpoint descriptor. Chunked roots and chunks
use their fixed content-addressed paths above. No emitter may choose another
path, even when the plaintext and digest are otherwise valid.

Every `physical_checkpoint_entries` element is the closed object:

```text
{
  adapter_kind,
  logical_path,
  physical_schema_version,
  source_generation,
  plaintext_byte_length,
  plaintext_digest
}
```

`adapter_kind` is exactly `desktop_sqlite_v1`, `pwa_sqlite_opfs_v1`, or
`pwa_indexeddb_v1`. `physical_schema_version` and
`plaintext_byte_length` are positive safe integers. `source_generation`,
`logical_path`, and `plaintext_digest` use their canonical string encodings.
Entries sort by adapter kind and canonical logical path. Each entry must match
exactly one `encrypted_file_entries` element with role
`physical_checkpoint` and identical logical path, plaintext length, and
plaintext digest. Every encrypted `physical_checkpoint` has exactly one such
entry. A physical checkpoint larger than the 16 GiB regular-file limit is
omitted rather than split, because it is only a rebuildable accelerator.
Physical checkpoints are optional accelerators and cannot replace the
required logical checkpoint. They are admissible only when the adapter and
physical schema are proven to contain no provider secrets, cookies, actor or
authority private keys, excluded registry data, device-local authorities, or
other fields forbidden from the logical checkpoint. A mixed-authority live
database is never copied into a portable backup, including through coordinated
SQLite backup, because active pages, free-list pages, journals, and deleted
bytes can retain forbidden data. The safe implementation builds a fresh
accelerator database from the already verified logical checkpoint, validates
its closed schema and content against that checkpoint, vacuums or otherwise
proves the absence of unreferenced pages, then encrypts it. When this proof is
unavailable, the physical checkpoint is omitted. Restore opens an optional
physical checkpoint only inside a staging generation, runs the adapter's
integrity and closed-schema checks, derives the complete adapter-neutral
logical checkpoint from it, and requires canonical equality with the signed
logical checkpoint, including rows, clocks, relationships, tombstones, actor
states, receipts, frontiers, materializer position, blob roots, and exclusions.
Any mismatch discards the accelerator and rebuilds from the authoritative
logical bytes. Physical state never becomes the fallback authority.

The frozen reachable blob set is the closed object:

```text
reachable_blob_set_body = {
  library_id,
  source_epoch_id,
  blobs
}

reachable_blob_set_digest = D(
  "live-root-set",
  reachable_blob_set_body
)
```

`blobs` contains closed `{ content_digest, byte_length }` entries, sorted by
decoded digest bytes and then byte length. Duplicate content digests, invalid
digests, and negative or unsafe byte lengths are invalid. Zero-byte content is
valid. It is the exact
set union of the logical checkpoint's blob roots, every blob referenced by any
preserved operation envelope in `operation_segment_set_body`, including
quarantined, incomplete, opaque, and unapplied envelopes, and every included
media-vault snapshot entry. A digest appearing in more than one source must
carry one identical byte length. Each union element matches exactly one
`chunked_object_root` encrypted entry whose body has artifact kind
`content_blob` when any checkpoint or operation references it and
`media_vault_file` otherwise, the same artifact digest, and the same canonical
byte length. Every content or media root belongs to the union. An explicitly
excluded media-vault entry is not in the set. There is exactly one root per
unique content digest and byte length. Its chunks are the exact no-extra
payload partition named by that root, so an individual payload may exceed the
16 GiB regular-file limit without weakening its original whole-content digest.
The archive path for any root is
`proof/chunked-roots/<protocol_object_digest>.jcs`; the path for a distinct
chunk is
`proof/chunked-payloads/<content_digest>-<plaintext_byte_length>.bin`.
Equal chunks used by multiple roots share the one chunk entry. Digest equality
with unequal length is invalid.

The exact operation coverage is the closed object:

```text
operation_segment_set_body = {
  library_id,
  source_epoch_id,
  logical_checkpoint_digest,
  segments
}

operation_segment_set_digest = D(
  "backup-operation-segment-set",
  operation_segment_set_body
)
```

`segments` contains closed
`{ segment_digest, first_operation_id, last_operation_id, operation_count,
canonical_byte_length }` entries, sorted by decoded segment digest bytes.
Counts and lengths are positive safe integers. The set includes every live
segment named by the frozen source manifest, with no backup-time compaction or
checkpoint omission rule. It therefore includes segments containing
quarantined, incomplete-transaction, opaque, unknown-schema, or repair-pending
envelopes. Every digest matches exactly one `operation_segment` encrypted
entry's `protocol_object_digest`, and every such entry belongs to the set.
Decrypted segment canonical bytes must independently recompute the digest,
range, count, and byte length. Thus a backup cannot preserve a quarantined tip
while omitting the envelope needed to inspect or repair it, and the backup
checkpoint cannot become hash-cyclic through a compaction receipt that names
itself.

The permanent device-local media vault has one portable snapshot contract:

```text
media_vault_snapshot_body = {
  library_id,
  installation_id,
  source_generation,
  source_manifest_digest,
  source_manifest_storage_root_digest,
  source_manifest_byte_length,
  entries,
  exclusions
}

media_vault_snapshot_digest = D(
  "media-vault-backup-snapshot",
  media_vault_snapshot_body
)

source_manifest_digest = DB(
  "media-vault-source-manifest",
  source_manifest_bytes
)

source_manifest_byte_length = byte_length(source_manifest_bytes)

source_manifest_storage_root_body = {
  artifact_kind: "media_vault_source_manifest",
  artifact_digest: source_manifest_digest,
  canonical_byte_length: source_manifest_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

source_manifest_storage_root_digest = D(
  "chunked-object-root",
  source_manifest_storage_root_body
)

media_vault_snapshot_byte_length = byte_length(
  C(media_vault_snapshot_body)
)

media_vault_snapshot_storage_root_body = {
  artifact_kind: "media_vault_snapshot",
  artifact_digest: media_vault_snapshot_digest,
  canonical_byte_length: media_vault_snapshot_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

media_vault_snapshot_storage_root_digest = D(
  "chunked-object-root",
  media_vault_snapshot_storage_root_body
)
```

The two storage-root bodies independently obey the generic chunked-object
contract. The source-manifest fields in `media_vault_snapshot_body` equal the
first root's logical digest, root digest, and byte length byte for byte.

Snapshot capture uses a short immutable-generation pin, not a
corpus-duration vault fence. One local authority transaction seals the current
source manifest and generation, increments a durable pin count for every
reachable entry, and moves later writes to a new copy-on-write generation.
The transaction then releases ordinary writers. Manifest streaming, file
copying, chunking, encryption, and verification run against the sealed
generation outside the write barrier. Cancellation or completion decrements
the pin only after every reader and backup operation releases it. Garbage
collection cannot remove pinned bytes. A platform adapter that cannot provide
an immutable generation must materialize one through a bounded copy-on-write
index before backup; it may not hold all vault writes until the backup archive
finishes.

The registered source entry is the literal closed object:

```text
registered_source_entry_projection = {
  library_id,
  installation_id,
  source_generation,
  source_logical_path,
  content_digest,
  byte_length,
  media_type
}

source_entry_digest = D(
  "media-vault-source-entry",
  registered_source_entry_projection
)
```

The library, installation, and generation equal the snapshot. Source logical
path is one to 4,096 UTF-8 bytes, relative, and obeys the target path's
separator and component restrictions. Content digest uses the registered
32-byte codec, byte length is a nonnegative safe integer, and media type is one
to 255 ASCII bytes. The original media-vault source manifest has exactly this
entry schema, so parsing it does not depend on an unspecified adapter
projection.

`entries` contains closed
`{ source_entry_digest, source_logical_path, content_digest, byte_length,
media_type }` values sorted by decoded source-entry digest. Their content fields
equal the registered projection. `exclusions` contains one direct or inherited
closed binding per excluded source-entry digest, sorted by decoded
source-entry digest and then binding digest. The direct receipt body is:

```text
exclusion_body = {
  library_id,
  installation_id,
  source_epoch,
  source_epoch_id,
  source_frontier_digest,
  source_generation,
  source_entry: registered_source_entry_projection,
  source_entry_digest,
  reason_code:
    "owner_excluded" |
    "source_bytes_missing" |
    "source_bytes_unreadable" |
    "source_bytes_exceed_v1_payload_limit" |
    "unsupported_media_type",
  acknowledged_at_ms,
  signing_actor_id,
  signing_actor_enrollment_certificate_digest,
  signing_actor_state: {
    actor_id,
    enrollment_certificate_digest,
    accepted_sequence,
    accepted_operation_id,
    accepted_chain_digest,
    retired: false,
    retirement_certificate_digest: null
  },
  authority_transition_digest,
  signing_authority_key_id,
  signature_algorithm: "ed25519"
}
```

For a direct binding, the closed record is
`{ binding_kind: "direct", exclusion_body, exclusion_digest, actor_signature,
authority_signature }`. Library, installation, and generation equal the
snapshot.
`source_entry_digest` recomputes from the complete embedded source entry, so a
later recursive backup preserves the excluded path, content digest, byte
length, and media type without needing the old adapter manifest.
`acknowledged_at_ms` is a nonnegative safe integer. Every reason is shown to
and explicitly acknowledged by the owner before the receipt is signed. Its
digest is `D("media-vault-exclusion", exclusion_body)`, and its signature is
`S("media-vault-exclusion", actor_private_key, { exclusion_digest })`. The
authority countersignature is
`S("media-vault-exclusion-authority", authority_private_key,
{ exclusion_digest })`. The actor enrollment is valid and unretired at the
exact bound epoch and frontier. The embedded actor state uses the checkpoint
actor-state schema, matches `signing_actor_id` and its enrollment digest, and
has a tip that is present in or causally dominated by
`source_frontier_digest`. The authority countersignature certifies this exact
unretired state. A verifier never infers non-retirement merely from an absent
retirement certificate. `signing_authority_key_id` equals the target authority
key installed by `authority_transition_digest`, and the verifier obtains that
key only from the accepted authority chain. Both signatures and the complete
enrollment, retirement, actor-state, and authority proof are included in the
backup or retained source-plan proof closure.

An exclusion carried into a different installation or generation uses a new
authority-signed current binding while preserving the original owner
acknowledgment:

```text
inherited_exclusion_body = {
  library_id,
  installation_id,
  source_epoch,
  source_epoch_id,
  source_frontier_digest,
  source_generation,
  source_entry: registered_source_entry_projection,
  source_entry_digest,
  origin_exclusion_digest,
  source_exclusion_binding_digest,
  source_media_vault_snapshot_digest,
  provenance_operation_kind:
    "migration" | "same_library_restore" | "new_library_import" | "rollback",
  provenance_operation_id,
  provenance_intent_digest,
  signing_authority_key_id,
  signature_algorithm: "ed25519"
}

inherited_exclusion_digest = D(
  "media-vault-inherited-exclusion",
  inherited_exclusion_body
)

inherited_exclusion_authority_signature = S(
  "media-vault-inherited-exclusion-authority",
  target_authority_private_key,
  { inherited_exclusion_digest }
)
```

The inherited record is
`{ binding_kind: "inherited", inherited_exclusion_body,
inherited_exclusion_digest, authority_signature }`. Its library, installation,
epoch, frontier, generation, and embedded source entry equal the current
snapshot. `source_exclusion_binding_digest` names the complete direct or
inherited binding in the verified source snapshot.
`origin_exclusion_digest` always names the first direct owner-signed receipt.
An inherited source binding preserves that same origin digest. The provenance
operation and acyclic restore-intent digest name the exact verified source
snapshot, source binding, target mapping intent, current target identity, and
admission fence. The signing key is the accepted current authority or the
candidate target authority promoted atomically by that operation's winning
transition. It cannot manufacture a new exclusion because the final verified
plan deterministically recomputes the named intent and must prove the direct
owner acknowledgment and every inherited step back to it.

Recursive verification streams the retained source plans and binding chain,
rejects cycles, and requires each step's source snapshot and target identity to
match byte for byte. A new target creates one new current binding. It never
edits or pretends that the original receipt was signed for a later
installation. Backups retain the current binding plus the exact plan roots,
chunks, historical bindings, actor certificates, and authority chain required
to reach the direct receipt.

`entries.length + exclusions.length` is at most 10,000,000, matching the target
plan limit. Source-entry digests are unique across both arrays. A larger source
vault cannot claim a complete v1 backup and must use a reviewed later protocol
version.

The backup contains the exact `source_manifest_storage_root_body`,
`media_vault_snapshot_storage_root_body`, and every chunk each names, using the
generic root and chunk roles. Reassembling the first root yields the exact
`source_manifest_bytes`; reassembling the second yields the exact
`C(media_vault_snapshot_body)` bytes. Their independent encrypted-file
plaintext digests continue to use the `backup-file-plaintext` domain. Parsing
the original manifest and applying the registered source-entry projection
produces an exact bijection: every original entry occurs once in `entries` or
`exclusions`, never both. Every included entry references the one encrypted
payload object selected by its content digest and byte length. Multiple source
paths and media types may reference the same bytes without duplicating the
payload record. The snapshot, not the payload record, preserves each source
path and media type. Exclusions carry no payload. A missing, duplicate,
unmapped, unacknowledged, or unresolved root or chunk makes the backup
incomplete.

Backup seals and pins one immutable media-vault generation in the short
copy-on-write transaction defined above. It does not retain a write fence while
reading the source manifest, enumerating files, encrypting the archive, or
waiting for remote I/O. The registered source-manifest decoder yields exact
library ID, installation ID, and generation fields; they equal the snapshot
body byte for byte. Every later read uses the pinned generation, while new
writes enter a descendant generation. The manifest and included files remain
protected only from mutation and garbage collection until the container is
finalized, read back, and verified. A pinned-object identity mismatch
invalidates the snapshot rather than mixing moments.

Migration, restore, and import never install the source device's
local-authority pointer. Before signing any inherited exclusion, the operation
builds one acyclic mapping intent:

```text
media_vault_restore_intent_body = {
  operation_kind:
    "migration" | "same_library_restore" | "new_library_import" | "rollback",
  operation_id,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length,
  target_library_id,
  target_installation_id,
  target_generation,
  target_path_mapping_intents,
  target_admission_fence
}

media_vault_restore_intent_digest = D(
  "media-vault-restore-intent",
  media_vault_restore_intent_body
)
```

`target_path_mapping_intents` is the exact canonical projection of the final
`target_path_mappings` array with only
`target_exclusion_binding_digest` omitted from every element. It retains every
source and target entry digest, disposition, target content field, and source
exclusion binding digest. It uses the final mapping order, limits, nullability,
and uniqueness rules below. The operation constructs and durably verifies this
body first, then signs each inherited binding against its digest. It cannot
include a final inherited-binding digest and therefore has no dependency on
the later plan.

Each operation then builds the same closed target plan:

```text
media_vault_restore_plan_body = {
  operation_kind:
    "migration" | "same_library_restore" | "new_library_import" | "rollback",
  operation_id,
  source_media_vault_snapshot_body,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length,
  source_exclusion_proof_objects,
  target_library_id,
  target_installation_id,
  target_generation,
  media_vault_restore_intent_digest,
  target_path_mappings,
  target_exclusion_bindings,
  target_manifest_body,
  target_manifest_digest,
  target_admission_fence
}

target_media_vault_manifest_digest = D(
  "media-vault-target-manifest",
  target_manifest_body
)

media_vault_restore_plan_digest = D(
  "media-vault-restore-plan",
  media_vault_restore_plan_body
)

media_vault_restore_plan_byte_length = byte_length(
  C(media_vault_restore_plan_body)
)

media_vault_restore_plan_storage_root_body = {
  artifact_kind: "media_vault_restore_plan",
  artifact_digest: media_vault_restore_plan_digest,
  canonical_byte_length: media_vault_restore_plan_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

media_vault_restore_plan_storage_root_digest = D(
  "chunked-object-root",
  media_vault_restore_plan_storage_root_body
)
```

`operation_id` equals the migration candidate ID, restore operation ID, import
ID, or rollback ID selected by `operation_kind`. The value is generated once
and reused by every receipt, barrier, staging object, transition, and
activation record for that operation. A plan whose kind and operation ID do
not match its containing operation is invalid. Its source snapshot digest,
storage-root digest, and byte length equal the independently verified source
snapshot triple.

Every schema that directly carries a target library ID, installation ID,
generation, target-manifest digest, plan digest, plan-storage-root digest,
length, or admission fence repeats the applicable value byte for byte. Closed
schemas that do not carry those fields commit them transitively through the
exact candidate, receipt, checkpoint, closure, or transition digest they name.
In particular, actor enrollment binds the candidate identity and target
library but does not pretend to carry media fields absent from its closed
schema. A final receipt and transition bind the exact candidate or receipt that
does carry them. The target actor's library and installation binding must
match. The final `library_control` and media-vault pointer install those exact
identities. No operation may infer or substitute one of these identities from
a staging path.

`target_exclusion_bindings` contains the complete canonical inherited binding
record for every excluded mapping, sorted by decoded
`inherited_exclusion_body.source_entry_digest`. Its digest set is an exact bijection with the
non-null `target_exclusion_binding_digest` values in `target_path_mappings` and
with `target_manifest_body.exclusions`. No direct receipt is rewritten into
this array, no binding is present without a mapping, and no digest lacks its
canonical preimage.

The verifier projects `target_path_mapping_intents` from the final mappings,
reconstructs `media_vault_restore_intent_body` from the plan's exact operation,
source-snapshot triple, target identity, generation, and admission fence, and
requires its digest to equal `media_vault_restore_intent_digest`. Every
inherited binding's `provenance_operation_kind`,
`provenance_operation_id`, and `provenance_intent_digest` equal that
reconstructed intent. A binding that names the final plan digest is invalid,
because it would recreate the fixed-point cycle this two-stage commitment
removes.

Canonicalizing `source_media_vault_snapshot_body` recomputes
`source_media_vault_snapshot_digest`. `source_exclusion_proof_objects` is the
exact no-extra transitive source-authority and lineage closure needed to verify
every direct or inherited exclusion binding. Its entries are closed
`{ object_kind, protocol_object_digest, canonical_object }` values, unique and
sorted by object kind and decoded digest. It uses the same object-kind
registry, digest equations, and recursive verification rules as
`source_authority_proof_objects` below, with the complete canonical bytes
embedded because the media plan is itself portable provenance. For an
inherited binding it includes the source snapshot and plan roots, prior
binding, provenance operation, and current target-authority path. It also
includes each direct signing actor's enrollment and applicable retirement
state, the accepted transition and
manifest authentication chain at the exclusion's bound epoch and frontier,
and every recovery delegation, active or spent capability body, capability
change, possession proof, receipt, and actor or authority object needed to
validate a recovery-authorized transition. The exact actor-state attestation
is carried inside the direct countersigned exclusion body rather than inferred
from a missing retirement object. Canonicalizing and
verifying every object recomputes its digest and complete signature chain.
Every object is required by at least one exclusion or by the authority path
that validates it, and no unreferenced object is allowed.

Every `target_path_mappings` element is the literal closed object:

```text
{
  source_entry_digest,
  target_source_entry_digest,
  disposition: "installed" | "excluded",
  target_logical_path,
  content_digest,
  byte_length,
  media_type,
  source_exclusion_binding_digest,
  target_exclusion_binding_digest
}
```

Mappings are unique and sorted by decoded `source_entry_digest`. For
`installed`, target path, content digest, byte length, and media type are
required, `target_source_entry_digest` recomputes from the complete target
registered-source-entry projection, and both exclusion-binding digests are
null. The target path is
target-namespace-relative, canonical, unique, and never reuses the source
installation's absolute or generation path. Its content fields equal the
source snapshot entry byte for byte. For `excluded`, all four target content
fields are null and `source_exclusion_binding_digest` is required and equals
the source snapshot's exact direct or inherited binding digest.
`target_exclusion_binding_digest` is required and equals the new inherited
binding created for the target snapshot. Its source binding, source snapshot,
provenance operation, intent, source entry, and target identity equal this
mapping and the reconstructed intent byte for byte. Its embedded current
source-entry digest equals `target_source_entry_digest`; that projection uses
the target identity and generation with the preserved source-relative logical
path and content metadata from the source binding. No other null combination
is valid.

V1 permits at most 10,000,000 mappings. Each target logical path is one to
1,024 UTF-8 bytes, uses `/` separators, has no leading slash, empty component,
`.` or `..` component, backslash, NUL, or control character, and is compared
byte for byte without decoder normalization. Content and source-entry digests
use the registered 32-byte codec. Byte lengths are nonnegative safe integers.
Media types use the registered nonempty ASCII codec with at most 255 bytes.
Plan and target-manifest decoders enforce these limits before allocation.

A target logical path is preserved metadata, never a host filesystem path.
Vault payload bytes live only under their content-addressed digest path, and
the manifest row is keyed by `target_source_entry_digest` with binary text
collation. Two logical paths that a host filesystem would case-fold or
normalize to the same spelling remain distinct rows and cannot overwrite one
another. Any later export to a user-selected directory must use a separately
registered collision-safe filename encoder; it cannot use raw logical paths as
authority.

The literal closed target manifest is:

```text
target_manifest_body = {
  format: "freed_media_vault_manifest_v1",
  target_library_id,
  target_installation_id,
  target_generation,
  entries,
  exclusions
}
```

`entries` contains closed
`{ target_logical_path, content_digest, byte_length, media_type,
source_entry_digest, target_source_entry_digest }` values sorted by canonical
target path and then decoded target-source-entry digest. `exclusions` contains
closed `{ source_entry_digest, target_source_entry_digest,
exclusion_binding_digest }` values sorted by decoded target-source-entry
digest. Both sets are unique. The manifest contains exactly one
entry for every installed mapping and exactly one current inherited exclusion
for every excluded mapping, with equal fields and no extras.

The mapping set is an exact no-loss bijection over the source snapshot. Every
included source entry has exactly one installed mapping with identical content
fields. Every source exclusion has exactly one excluded mapping bound to its
source binding and one target binding whose embedded target source entry
preserves the path, content digest, length, and media type. Every target source
entry recomputes with the target library, installation, generation, and logical
path and is unique across both target arrays. No source entry
appears in both sets, and no mapping lacks one source entry. The target
manifest digest recomputes from that exact census and equals both digest fields
above.

The literal closed admission fence is:

```text
target_admission_fence = {
  source_key: "media_vault",
  fence_token_digest,
  target_installation_id,
  previous_target_manifest_digest,
  previous_target_generation,
  target_generation
}
```

The operation privately retains a fresh 32-byte random token encoded as 64
lowercase hexadecimal characters. `fence_token_digest` is
`DB("admission-fence-token", fence_token_bytes)`. The token never enters a
plan, receipt, proof, backup, or log. Previous manifest digest and generation
are both null for
canonical empty target state and both required otherwise. `target_generation`
is one for empty state and exactly the previous safe integer plus one
otherwise. It equals the plan and target manifest generation.

V1 never replaces unrelated authoritative target-vault data. New-library
import and same-library restore require canonical empty target state, so both
previous fields are null. If a restore target has any local vault entry, restore
blocks and offers a separate future merge or a fresh target installation.
Migration and rollback are the only non-empty cases. Their previous target
manifest bytes, digest, installation ID, and generation must equal the fenced
source media manifest and source snapshot exactly, and the source-to-target
mapping accounts for every one of its entries or signed exclusions. Any
additional prior entry, different generation, or mismatched installation
blocks the operation. A later merge protocol must define an exact two-source
mapping and conflict policy before it may relax these rules.

Before staging the first target file, the implementation streams and verifies
the complete canonical plan into immutable chunks, then commits this durable
exclusive fence, the logical plan digest, the storage-root digest, and the
safe byte length in one target-vault authority transaction. The root object and
all chunks are durable and read back before that transaction commits. The
private token is durable in the operation's protected recovery state before
the fence transaction, and exact response-loss readback returns the matching
digest without exposing the token. The
positive byte length and every chunk obey the generic chunked-object bounds;
no single backup file or in-memory buffer must contain the complete plan.
Crash recovery restores the fence and resolves the exact committed root before
opening either library or vault write authority. While held, every ordinary
target-vault write fails closed with the retryable
`media_vault_transition_in_progress` result and cannot be acknowledged.
Provider capture journals remain durable outside the vault authority and may
materialize only after activation or abort releases the fence. V1 deliberately
has no cutover write queue, so no acknowledged write can be stranded between
the old and target generations.

All target files and the manifest stage beneath the unique target generation
and are reopened and verified before activation. The durable fence remains
held while cloud publication or compare-and-swap response loss is resolved and
through the final local authority transaction. That transaction compares the
complete fence and atomically installs the target vault pointer and generation
with the library activation record. Only its successful commit releases the
fence on the success path. Old target-vault state remains intact until that
commit; source installation identity and generation never become target
authority.

Immediately before emitting or publishing any transition or genesis
authorization, the implementation rechecks the complete fence, previous vault
pointer and generation, staged target manifest, plan digest, storage root,
length, every root chunk, and library staging record in one local read
transaction. A mismatch takes the pre-authorization abort path and no remote
candidate is emitted. After a candidate transition or
genesis is confirmed as the remote winner, local activation is
retry-to-completion. A later fence mismatch or local corruption quarantines the
installation and rebuilds its staged local state from the already winning
remote closure. It can never abort, replan, release the fence against the old
pointer, or publish another candidate.

A failed operation releases its fence only through this closed abort receipt:

```text
media_vault_fence_abort_body = {
  operation_kind,
  operation_id,
  media_vault_restore_plan_digest,
  media_vault_restore_plan_storage_root_digest,
  media_vault_restore_plan_byte_length,
  target_admission_fence,
  abort_reason:
    "source_changed" |
    "cloud_transition_lost" |
    "pre_authorization_validation_failed" |
    "pre_genesis_import_abandoned",
  authorization_resolution:
    "authorization_not_emitted" |
    "authorization_stale_against_confirmed_successor",
  observed_cloud_authority
}

media_vault_fence_abort_digest = D(
  "media-vault-fence-abort",
  media_vault_fence_abort_body
)
```

`authorization_not_emitted` requires null `observed_cloud_authority` and proof
in durable local phase state that no transition or genesis authorization bytes
were produced. `authorization_stale_against_confirmed_successor` requires the
complete read-back cloud authority tuple, a different winning transition, and
proof that the abandoned authorization's exact compare-and-swap predecessor
can never match again. An absent tuple, timeout, transport error, or uncertain
response is not an abort proof and keeps the fence held. A replayable
self-authorized genesis candidate can never use the abort path.

The abort transaction is idempotent on `(fence_token_digest, operation_id)`.
The caller supplies the private token and the authority transaction recomputes
the digest before acting. It
requires the old vault pointer and generation to remain exact, records and
reads back the receipt, quarantines or deletes the staged generation according
to the registered reason, preserves the old pointer, and releases only that
fence atomically. No queued-write digest or replay cursor exists because a
fenced vault write was never acknowledged. A retry returns the same receipt.
Changed-source migration, a losing restore compare-and-swap,
pre-authorization validation failure, and pre-genesis import abandonment all
use this path. Replanning begins only after it completes. On success, the same
local authority transaction that installs the planned vault pointer and
generation releases the fence. Retrying that transaction compares the exact
installed pointer and returns the same successful result; it never reapplies a
mutation.

Restore staging, import planning, and migration receipts bind the source
snapshot, complete plan digest, plan storage-root digest and byte length, target
manifest digest, target generation, and exact admission fence. Logical
checkpoints and portable backups that retain one of those receipts retain the
plan storage root and every chunk as reachable provenance. Compaction cannot
leave a receipt with a dangling plan digest. Resolving the retained plan
storage root reconstructs the complete source snapshot, every exclusion
receipt, and its exact proof objects. A later
backup of the target vault resolves every target-manifest exclusion binding
through that retained plan. It stores the current inherited binding in the new
snapshot and retains the source plan, prior binding, original direct receipt,
and complete proof closure. A later transition creates another current binding
for its own target identity and generation while preserving the original
receipt digest. It fails if any lineage object is missing. Restored, migrated,
and imported exclusions are therefore recursively backuppable rather than
digest-only tombstones or forged claims that an old signature covered a new
installation.

Portable source-authority proof is also closed. The backup inventory's
`source_recovery_capability_change_chain` category lists typed change pointers
from the captured source pointer back to null, newest first, with no repeats
and at most 65,536 links. Its `source_authority_proof_objects` category
contains closed
`{ object_kind, protocol_object_digest }` entries sorted by object kind and
decoded digest. Every kind is an exact member of the shared
`portable_protocol_object_kind_v1` registry and uses its sole digest dispatch.
The set is the no-extra transitive subset needed by the captured authority
tuple and backup mode.

For a successful migration it includes the migration receipt and proof,
candidate and registration, exact final claim-history root, candidate registry,
every source grant, consumption, and source-commit admission record,
reservation and activation records, batches,
checkpoint, and reachable set and chunk nodes. For an ordinary abandonment it
instead includes the abandonment, registered cleanup and cleanup proof,
plus the exact state-selected closure. Candidate-absent cleanup includes no
candidate, registration, census, fence, disposition, or candidate payload.
Registered-candidate cleanup includes its candidate census, terminal
disposition receipts, and every reachable set and chunk node. For a
recovery-consumed pointer it includes the exact
`migration_recovery_supersession`, lifecycle root, exact candidate registry
state, any abandonment cleanup that registered before recovery, and any
recovery-GC object that registered afterward. It never requires a nonexistent
abandonment cleanup or a deleted candidate payload whose signed disposition
and aggregate are present. A capability
registration whose live manifest advanced also includes the exact
`backup_registration_descendant_proof` and every authenticated set node it
reaches.

When the captured migration pointer is an abandonment, the set contains the
complete typed lifecycle from revision one through that abandonment, its
registered cleanup object, cleanup-proof root and chunks, and every
claim-history set node. For `candidate_state: "registered"` it also contains
the candidate, candidate registration, every candidate-object,
source-fence-disposition, and candidate-disposition set node, candidate
checkpoint and root, source-revocation records, operation grants and
consumption receipts, and every staging-disposition receipt. For
`candidate_state: "absent"` all of those candidate-specific members are
forbidden. Each object
recomputes and links by exact typed predecessor pointer. Every object with an
explicit authority or contributor signature verifies it. An unsigned nested
source-revocation body gains portable authentication only through its exact
signed disposition receipt and signed cleanup aggregate.
The set is the exact transitive proof closure, with no extras, of the current
source manifest and authentication object, every authority transition from
library genesis through the captured source transition, current active and spent bodies,
every change link's previous and target active or spent body, every
capability-change link's bound manifest and exact authentication object, every
non-null migration pointer carried by any current or historical transition or
capability-change link and that pointer's complete lifecycle and candidate.
An ordinary abandonment branch requires its state-correct cleanup proof and
only that state's persistent-set dependencies. A lifecycle consumed by
same-library recovery instead requires
the exact `migration_recovery_supersession` object named by that transition
plus any registered recovery-GC closure, and never invents a missing
abandonment cleanup. Every
delegation named by an active set or registration link, every transition named
by a recovery link, every migration or rollback receipt named by a historical
transition, each candidate named by one of those receipts, every abandoned
candidate and registration named by a cleanup proof, every batch, source
contribution, revocation, and staging record required by that proof, every
historical checkpoint named by a retained transition, receipt, closure,
cleanup proof, restore-staging object, or compaction proof and that
checkpoint's exact chunked storage root,
every restore-staging body named by a historical recovery transition and its
exact restore-preparation object, every import-execution receipt named by a
historical imported
genesis transition, every compaction receipt authorizing a root omitted by any
manifest in the accepted chain, every repair receipt authorizing a
non-descendant actor-tip replacement in that chain, each compaction,
migration, rollback, or repair receipt's exact proof or plan storage root,
every authority transition's exact genesis-closure storage root,
every import-plan or media-plan storage root named by one of those candidates,
receipts, or staging objects, and every actor or authority certificate needed
to verify those objects. Every non-chunked protocol object, including each
authority transition certificate, has exactly one encrypted file with the
matching role and protocol-object digest. A `checkpoint` or
`migration_claim_cleanup_proof` inventory object instead has exactly one
`chunked_object_root` inventory object whose artifact kind and artifact digest
match it. It has no duplicate regular-file representation. Each chunked root
reaches exactly the encrypted chunk entries named by its closed body. Complete
canonical bytes independently recompute every digest and signature. Exactly
one manifest, authentication object, active body, and
spent body match the four current source fields in the backup manifest.
Bootstrap validates every compaction receipt, repair receipt, migration or
rollback proof, historical checkpoint, retained plan, root, and chunk before
treating the captured manifest's omissions, repaired frontiers, or historical
plan provenance as accepted authority.

The final same-library delegation being created for this backup is not one of
these source-proof files because the backup manifest precedes and is bound by
that new delegation. The complete proof set verifies under the recursive rules
above and reconstructs the current active and spent bodies. This proof is
mandatory in both recovery modes, so `import_only` remains independently
verifiable without the old cloud namespace.

Large backup inventories use an encrypted Merkle-page index. The literal page
schemas are:

```text
backup_inventory_page_body = {
  format: "freed_backup_inventory_page_v1",
  backup_id,
  category:
    "source_recovery_capability_change_chain" |
    "source_authority_proof_objects" |
    "physical_checkpoint_entries" |
    "encrypted_file_entries" |
    "operation_segment_entries" |
    "actor_enrollment_certificate_digests" |
    "actor_retirement_certificate_digests" |
    "excluded_registry_keys",
  level,
  first_sort_key,
  last_sort_key,
  subtree_item_count,
  items,
  children
}

backup_inventory_page_digest = D(
  "backup-inventory-page",
  backup_inventory_page_body
)

backup_inventory_page_descriptor = {
  backup_id,
  page_digest,
  logical_path,
  plaintext_byte_length,
  plaintext_digest,
  nonce_prefix,
  chunk_count,
  chunk_ciphertext_digests,
  ciphertext_byte_length,
  ciphertext_digest,
  first_sort_key,
  last_sort_key,
  subtree_item_count
}

backup_inventory_root_body = {
  backup_id,
  source_recovery_capability_change_chain_root,
  source_authority_proof_objects_root,
  physical_checkpoint_entries_root,
  encrypted_file_entries_root,
  operation_segment_entries_root,
  actor_enrollment_certificate_digests_root,
  actor_retirement_certificate_digests_root,
  excluded_registry_keys_root
}

backup_inventory_root_digest = D(
  "backup-inventory-root",
  backup_inventory_root_body
)
```

Every category has exactly one root descriptor, including an empty category.
A page and every descriptor that names it carry the exact backup ID from the
signed manifest. A mismatch at any depth is invalid.
A level-zero page has `children: []` and zero to 4,096 items. Each item is the
closed `{ sort_key, value }` object. A branch page has `items: []` and two to
4,096 child descriptors. Level is a nonnegative safe integer and child level
is exactly parent level minus one. Page plaintext is at most 4 MiB and tree
depth is at most eight.

`sort_key`, `first_sort_key`, and `last_sort_key` are required nullable fields.
The sole empty-category representation is one level-zero root page with empty
items and children, zero subtree count, and null first and last keys. No other
page or descriptor may carry a null range. A nonempty leaf's first and last
keys equal its first and last item keys. A branch range equals its first and
last child ranges.

Every non-null sort key is lowercase hexadecimal encoding of these exact key
bytes:

- recovery-capability change chain: `uint64_be(position)`, where position zero
  is the captured pointer and positions increase toward genesis;
- source-authority proof object: `UTF8(object_kind) || 0x00 ||
hex_decode(protocol_object_digest)`;
- physical checkpoint: `UTF8(adapter_kind) || 0x00 || UTF8(logical_path)`;
- encrypted file: `UTF8(logical_path)`;
- operation segment: `hex_decode(segment_digest)`;
- actor enrollment or retirement certificate: `hex_decode(certificate_digest)`;
- excluded registry key: exact ASCII key bytes.

The value is the category's exact closed schema and independently recomputes
its key. Keys are unique within a category and compare by decoded unsigned
bytes. A key with the wrong width, separator, field projection, or canonical
value is invalid.

Pagination is deterministic. Starting with the complete key-sorted value
sequence, a leaf takes the longest consecutive prefix that keeps both the
4,096-item and 4 MiB canonical-page bounds. The next leaf starts at the next
item. Branch construction repeats over the resulting descriptor sequence,
taking the longest consecutive prefix within the same bounds. If a final
branch group would contain one descriptor, its immediately preceding group
contributes its last descriptor, producing two legal groups. A non-root group
always has at least two descriptors before that adjustment, and the fixed
descriptor schema guarantees the preceding group has at least three when the
adjustment is needed. Construction stops when one page can be the root; it
never wraps a single page in a one-child branch. The empty-category rule above
is the only zero-item exception.

Leaf ranges are disjoint, adjacent in canonical item order, and complete.
Branch descriptors are sorted by `first_sort_key`; their ranges are disjoint,
adjacent, and exactly cover the parent range. Counts are exact subtree sums.
Duplicate or omitted items, overlapping ranges, malformed trees, a
non-maximal page, an avoidable one-child branch, or any other pagination result
is invalid.

Each descriptor's logical path is
`inventory/<category>/<page_digest>.page`. Page canonical bytes recompute
`page_digest`, `plaintext_byte_length`, and
`DB("backup-file-plaintext", page_bytes)`. Its encryption uses the ordinary
1 MiB chunk algorithm. Chunk associated data is the canonical closed
`{ header, purpose: "backup_inventory_page",
category, page_digest, logical_path, plaintext_byte_length, plaintext_digest,
chunk_index, chunk_count, chunk_plaintext_offset,
chunk_plaintext_byte_length }` object, so no ciphertext-derived field feeds its
own encryption. `chunk_count` is at most four. Root page descriptors are embedded in the signed manifest through
`backup_inventory_root_body`; child descriptors are authenticated inside their
parent page. A verifier can therefore locate, authenticate, decrypt, and walk
the tree from the signed roots without a separate file table.

Inventory page files are not `encrypted_file_entries` and never list
themselves. The bundle contains the exact no-extra set of inventory pages
reachable from the eight signed root descriptors. This gives the index an
acyclic bootstrap: the signed manifest authenticates category roots, each
branch authenticates its children, and leaves authenticate the ordinary
encrypted-file entries.

The category values retain their existing semantics and sort rules.
`encrypted_file_entries` sorts by canonical logical path.
`excluded_registry_keys` sorts by ASCII registry key. Actor-certificate arrays
are unique and sorted by decoded digest. Operation-segment items are the exact
`operation_segment_set_body.segments` array. Reconstructing each category and
its closed wrapper recomputes the source-authority closure, operation-segment
set, physical-checkpoint set, actor-certificate sets, exclusions, and encrypted
file census named below.

The small signed bootstrap manifest is:

```text
backup_manifest_body = {
  format: "freed_backup_v1",
  recovery_mode: "same_library" | "import_only",
  backup_id,
  library_id,
  source_epoch,
  source_epoch_id,
  source_schema_version,
  field_registry_version,
  canonical_codec_version,
  source_authority_key_id,
  source_transition_digest,
  source_manifest_digest,
  source_manifest_auth_digest,
  source_manifest_generation,
  source_active_recovery_capabilities_digest,
  source_recovery_capability_change_pointer,
  source_spent_recovery_redemptions_digest,
  source_migration_claim_pointer,
  backup_generation,
  logical_checkpoint_digest,
  logical_checkpoint_storage_root_digest,
  logical_checkpoint_byte_length,
  frontier_digest,
  recovery_envelope_digest,
  reachable_blob_set_digest,
  operation_segment_set_digest,
  media_vault_snapshot_digest,
  media_vault_snapshot_storage_root_digest,
  media_vault_snapshot_byte_length,
  backup_inventory_root_body,
  backup_inventory_root_digest,
  created_at_ms
}

backup_manifest_digest = D("backup-manifest", backup_manifest_body)

backup_manifest_signature = S(
  "backup-manifest",
  authority_private_key,
  { backup_manifest_digest }
)
```

The manifest's complete inventory-root body independently recomputes
`backup_inventory_root_digest`.
`source_migration_claim_pointer` equals the exact compound source-authority
field. It is null or a fetched and verified `claim_abandonment` pointer. V1
does not begin or finalize a backup while it is a `candidate_claim`. The
abandonment's complete signed lifecycle and registered cleanup object are
included in `source_authority_proof_objects` and independently verified.
For a registered candidate, every source-fence disposition must be
`not_acquired`, `released`, or `superseded`; an unreachable authoritative
source blocks backup. Candidate-absent cleanup proves the source-fence set is
empty and has no source reachability dependency.

Backup begins by pinning one immutable captured source tuple, logical
checkpoint, reachable-blob root, operation-segment frontier, and media-vault
snapshot. A short source transaction fixes those roots and generations, then
releases ordinary writers. Inventory, encryption, upload, and readback proceed
against the pinned objects without a corpus-duration writer fence.
`backup_manifest_body.source_*` fields name this captured tuple.

Before signing, the implementation reads the live compound tuple and verifies
that it has the same transition, authority key, active-recovery root,
capability-change pointer, spent-redemption root, and migration pointer, and
that its manifest is an authenticated same-transition descendant of the
captured manifest. It streams the intervening manifest and receipt chain and
proves the captured checkpoint and every pinned object remain reachable. A
later ordinary manifest generation does not abort the backup. A transition,
authority change, capability change, migration lifecycle change,
non-descendant manifest, or lost pinned object does.

The active authority signs the captured backup manifest only after that
descendant proof. Same-library registration later compares the exact live
tuple, binds both the captured tuple and the proven live descendant, and may
retry while further ordinary same-transition descendants appear. This lets a
busy library finish a backup without pretending the backup contains writes
that happened after its captured frontier.
`backup_inventory_root_body.backup_id` equals
`backup_manifest_body.backup_id` byte for byte, and every root descriptor,
child descriptor, and inventory page carries that same exact backup ID. The
manifest is invalid if its canonical signed bytes exceed 1 MiB, which the
closed fixed category count and four-chunk page descriptors make enforceable.
The reconstructed inventory categories are the fields removed from the
bootstrap body, not optional side data.
The logical-checkpoint digest, storage-root digest, and byte length bind the
registry-sorted adapter-neutral checkpoint and equal one verified chunked
checkpoint artifact. The media-vault snapshot digest, storage-root digest, and
byte length equal the verified chunked snapshot artifact and the independently
recomputed canonical snapshot body. The snapshot's embedded source-manifest
triple resolves through its own exact root and chunks. Both actor-certificate
arrays are unique and sorted by decoded
digest bytes. They equal the exact union of the corresponding certificate sets
required anywhere by the current source manifest, every current or historical checkpoint
`actor_states` and receipt record entry, every media-vault exclusion signer,
and every historical signer or actor named by
`source_authority_proof_objects`. This includes zero-sequence actors with no
accepted-frontier tip. Each digest has exactly one
matching encrypted certificate entry with the same role and
`protocol_object_digest`, and every such encrypted entry belongs to its set.
Decrypted canonical certificate bytes must recompute and verify that digest.
The signed manifest object is
`{ backup_manifest_body, backup_manifest_digest, backup_manifest_signature }`.
Its exact canonical bytes use the same 1 MiB authenticated chunk framing as
every other encrypted file. The bundle records their plaintext length,
plaintext digest, fresh nonce prefix, derived chunk count, ordered chunk
ciphertext digests, complete ciphertext length, and complete ciphertext
digest. Manifest chunk associated data is
`C({ header, purpose: "backup_manifest", backup_manifest_digest,
backup_manifest_plaintext_byte_length, backup_manifest_plaintext_digest,
chunk_index, chunk_count, chunk_plaintext_offset,
chunk_plaintext_byte_length })`.
`backup_manifest_plaintext_digest` is
`DB("backup-file-plaintext", canonical_signed_manifest_bytes)`. Every nonce,
count, length, and digest obeys the ordinary file limits above.

```text
backup_manifest_ciphertext_digest = DB(
  "backup-manifest-ciphertext",
  backup_manifest_ciphertext
)
```

In `same_library` mode, backup finalization creates an authority-signed
recovery delegation. Its closed `delegation_body` is:

```text
{
  library_id,
  source_epoch,
  source_epoch_id,
  source_transition_digest,
  source_manifest_digest,
  source_manifest_auth_digest,
  source_manifest_generation,
  source_active_recovery_capabilities_digest,
  source_recovery_capability_change_pointer,
  source_spent_recovery_redemptions_digest,
  source_migration_claim_pointer,
  backup_id,
  backup_manifest_digest,
  backup_manifest_ciphertext_digest,
  recovery_envelope_digest,
  recovery_public_key,
  permitted_operation: "recover_same_library_once",
  redemption_id,
  signing_authority_key_id
}
```

The canonical delegation body omits its digest and signature. Its digest and
authority signature derive as follows:

```text
delegation_digest = D(
  "backup-recovery-delegation",
  delegation_body
)

authority_signature = S(
  "backup-recovery-delegation",
  authority_private_key,
  { delegation_digest }
)
```

The public delegation certificate is
`{ delegation_body, delegation_digest, authority_signature }`. It is not a
file hashed by the backup manifest it references. The encrypted private
recovery key is one of the manifest-bound encrypted files.
`source_manifest_generation` is a nonnegative safe integer.
`redemption_id` is exactly 32 fresh random bytes encoded as 64 lowercase
hexadecimal characters. `signing_authority_key_id` names the source authority
key that signs this delegation and must equal the terminal key in the supplied
source authority chain.

The delegation's library ID, source epoch, source transition, source manifest,
source manifest authentication, source manifest generation, source
active-recovery digest, source recovery-capability-change pointer,
spent-redemption digest, typed migration-claim pointer, backup ID, backup
manifest digest, encrypted-manifest digest, and recovery-envelope digest must
equal the corresponding authenticated captured backup manifest, bundle, and
delegation fields byte for byte. Those captured bytes never change. At
registration, the live cloud tuple may differ only in manifest fields and only
through the exact same-transition descendant proof below. Transition,
authority key, active and spent recovery roots, capability-change pointer, and
typed migration pointer must still equal the captured tuple. Any other mismatch
is invalid rather than a selectable alternate source.

The final unencrypted `backup_bundle_body` is the closed object:

```text
{
  header,
  recovery_mode: "same_library" | "import_only",
  recovery_envelope_body,
  recovery_envelope_digest,
  backup_manifest_digest,
  backup_manifest_ciphertext_logical_path:
    "manifest/backup-manifest.jcs.xchacha20poly1305",
  backup_manifest_plaintext_byte_length,
  backup_manifest_plaintext_digest,
  backup_manifest_nonce_prefix,
  backup_manifest_chunk_count,
  backup_manifest_chunk_ciphertext_digests,
  backup_manifest_ciphertext_byte_length,
  backup_manifest_ciphertext_digest,
  delegation_certificate,
  terminal_authority_claim: {
    source_transition_digest,
    source_authority_public_key,
    source_authority_key_id
  }
}

backup_bundle_digest = D("backup-bundle", backup_bundle_body)

backup_bundle_signature = S(
  "backup-bundle",
  authority_private_key,
  { backup_bundle_digest }
)
```

The final bundle object is
`{ backup_bundle_body, backup_bundle_digest, backup_bundle_signature }`.
The bundle recovery mode must equal the header and authenticated manifest
recovery modes. In `same_library` mode, `delegation_certificate` is required,
must be valid as defined above, and the manifest contains exactly one recovery
private-key entry. In `import_only` mode, `delegation_certificate` is null and
the manifest contains no recovery private-key entry or redemption capability.
The terminal authority claim is a bounded untrusted bootstrap hint. Its key ID
recomputes from its public key, and its transition digest equals the header and
manifest claim, but it gains no authority before decryption. The reader uses
the key only for tentative bundle, manifest, and delegation signature checks.
The encrypted source-authority proof inventory contains the complete canonical
chain from genesis through the source transition and must independently derive
the same terminal key. Recovery-signed links gain authority only after their
encrypted support closure verifies through the staged bootstrap below. The
bundle contains ciphertext location and digest, not plaintext manifest fields
or file contents. The derivation is acyclic: envelope precedes manifest,
manifest precedes delegation, and the final bundle binds all three.

`backup_manifest_digest` is required in both recovery modes. It equals the
digest committed by every manifest chunk's associated data and must recompute
from the decrypted signed manifest. In `same_library` mode it also equals the
delegation's `backup_manifest_digest`. In `import_only` mode the bundle field
is the sole public fixed-size commitment used to authenticate manifest chunks
before the quarantined manifest can be parsed. A missing or mismatched value
invalidates the bundle.

`recovery_envelope_body.header` and `backup_bundle_body.header` are
byte-identical. Their format, recovery mode, backup ID, library ID, source epoch,
and source epoch ID equal the authenticated backup manifest. The manifest's
`source_authority_key_id` equals the header's `authority_key_id`, the terminal
claim key ID, the key derived from the verified encrypted authority chain, and
the target authority key ID of the source transition. That one terminal key
verifies the backup manifest signature,
bundle signature, and same-library delegation signature when present. No
component may select a different display, staging, source, or verification
identity from duplicated fields.

The encrypted manifest occupies the fixed v1 archive path
`manifest/backup-manifest.jcs.xchacha20poly1305`. A different or duplicate
location is invalid.

Registered recovery authority uses one immutable set and one authenticated
change chain:

```text
active_recovery_capabilities_body = {
  library_id,
  entries
}

active_recovery_capabilities_digest = D(
  "active-recovery-capabilities",
  active_recovery_capabilities_body
)

backup_registration_descendant_entry_body = {
  format: "freed_backup_registration_descendant_entry_v1",
  library_id,
  delegation_digest,
  accepted_manifest_generation,
  entry_kind: "manifest_link" | "supporting_object",
  predecessor_manifest_digest,
  predecessor_manifest_auth_digest,
  predecessor_manifest_generation,
  target_manifest_digest,
  target_manifest_auth_digest,
  target_manifest_generation,
  object_kind,
  object_digest,
  object_byte_length
}

backup_registration_descendant_entry_digest = D(
  "backup-registration-descendant-entry",
  backup_registration_descendant_entry_body
)

backup_registration_descendant_proof_body = {
  format: "freed_backup_registration_descendant_proof_v1",
  library_id,
  delegation_digest,
  captured_source_tuple,
  live_source_tuple,
  set_kind: "backup_registration_descendants",
  entry_count,
  descendant_chain_root_body
}

backup_registration_descendant_proof_digest = D(
  "backup-registration-descendant-proof",
  backup_registration_descendant_proof_body
)

recovery_capability_change_body = {
  registration_id,
  attempt_operation_id,
  library_id,
  change_kind: "register" | "revoke",
  previous_active_recovery_capabilities_digest,
  target_active_recovery_capabilities_digest,
  previous_recovery_capability_change_pointer,
  delegation_digest,
  redemption_id,
  transition_certificate_digest,
  manifest_digest,
  manifest_auth_digest,
  manifest_generation,
  backup_registration_descendant_proof_digest,
  spent_recovery_redemptions_digest,
  migration_claim_pointer,
  signing_authority_key_id
}

recovery_capability_change_digest = D(
  "recovery-capability-change",
  recovery_capability_change_body
)

recovery_capability_change_signature = S(
  "recovery-capability-change-authority",
  authority_private_key,
  { recovery_capability_change_digest }
)
```

The descendant proof's captured tuple equals the delegation source tuple. Its
live tuple equals the exact compare-and-swap predecessor. The persistent
`backup_registration_descendants` set contains every manifest link and every
manifest-authentication object, compaction or repair receipt,
operation-segment commitment, and typed migration or capability-change object
needed to prove that the live tuple is an authenticated same-transition
descendant.

A `manifest_link` entry has all six predecessor and target manifest fields
non-null, has null object fields, and advances exactly one contiguous
generation. Its `accepted_manifest_generation` equals its target generation.
A `supporting_object` entry has all six manifest-link fields null, has a
non-null member of `portable_protocol_object_kind_v1`, digest, and positive
byte length, and names the accepted generation whose verification requires it.
No other nullability is valid. Entries sort by numeric accepted generation,
the order `manifest_link`, `supporting_object`, then decoded target-manifest or
object digest. The persistent set sort key is that same tuple.

The canonical proof object is stored at
`proof/backup-registration-descendants/<backup_registration_descendant_proof_digest>.jcs`.
Every authenticated set node and supporting protocol object remains reachable
from the source-authority proof, backup inventory, genesis, restore, and import
closures for as long as the registration remains relevant. Verification
streams the set and rejects a fork, transition change, authority-key change,
capability change, migration-pointer change, missing generation, or missing
reachable object.

`registration_id` is stable for one intended capability registration across
ordinary manifest movement. `attempt_operation_id` is stable only for
byte-identical change-certificate bytes. If the predecessor tuple, descendant
proof, target set, or any other signed byte changes, the next proposal uses a
fresh attempt operation ID while preserving the registration ID. Exact retry
never replaces bytes under one attempt ID. Captured backup, bundle, delegation,
and encrypted payload bytes remain unchanged.

`backup_registration_descendant_proof_digest` is non-null for `register` and
reopens that exact proof. It is null for `revoke`, whose already registered
delegation and current authority chain are verified through the active set.

`entries` contains closed `{ delegation_digest, redemption_id }` values,
unique on both fields, sorted by decoded delegation digest bytes, and capped at
4,096 entries in v1. Every named delegation object is fetched, recomputed, and
verified against its historical authority-chain signer and exact library before
the set is accepted. The active-entry redemption IDs and the complete spent
redemption ID set are disjoint for every accepted cloud tuple. Registration
fetches and verifies the spent body, proves the candidate ID is absent, rejects
registration when the spent set already has 4,096 entries, and preserves that
exact spent digest and typed migration-claim pointer through compare-and-swap.
The pointer is null or a fetched and verified abandonment pointer. An active
candidate claim rejects capability change. Publication compares the exact
typed pointer in the compound source tuple, preserves it in the target tuple,
and resolves response loss by exact full-tuple readback. A
change certificate is the
immutable
`{ recovery_capability_change_body, recovery_capability_change_digest,
recovery_capability_change_signature }` object.

Cloud-tuple acceptance walks the typed change-pointer chain to a previously
accepted local pointer or to null genesis. A
`capability_change_certificate` link fetches and verifies the exact change
certificate, signing authority, previous and target active-set bodies,
unchanged manifest and spent tuple, and exact one-entry registration or
revocation delta, then follows its
`previous_recovery_capability_change_pointer`. A
`recovery_transition_certificate` link fetches and verifies the transition
certificate, exact active-set removal, exact spent-set union, and its embedded
previous change pointer, then follows that pointer. Null terminates only at the
empty genesis active and spent bodies. Missing, forked, cyclic, repeated,
noncontiguous, type-mismatched, or ambiguously located links reject the tuple.
The reconstructed final active set and spent set equal the current cloud roots.
Every capability-change link also repeats the exact typed migration-claim
pointer from its source and target compound tuples. Null needs no lifecycle
object. An abandonment pointer requires the complete fetched claim,
abandonment, and cleanup chain and exact pointer readback. A candidate-claim
pointer rejects the change.
V1 accepts at most 65,536 non-null change links from genesis. Registration,
revocation, and recovery each add exactly one. A candidate link above that
limit fails before signing or compare-and-swap; ordinary manifests and
transitions preserve the count. Reaching the limit requires a reviewed protocol
upgrade or new-library import. It never truncates authenticated history.

After every backup object and the final bundle are durable and read back,
`same_library` completion rereads the compound cloud tuple. Registration is
eligible when the live tuple has the same transition, authority key,
active-capability digest, capability-change pointer, spent-redemption digest,
and byte-identical null or verified abandonment migration pointer as the
delegation source. Its manifest may be a later authenticated
same-transition descendant. A current candidate-claim pointer rejects
registration. The change body binds the exact live tuple, the delegation's
captured tuple, the streamed descendant proof above, and the exact one-entry
union.
Before compare-and-swap, the public delegation certificate, target active-set
body, and change-certificate object are uploaded to their content-addressed
remote locations, fetched back, and digest, signature, source-tuple, entry, and
previous-change bindings are reverified. One compound compare-and-swap changes
only the active-capability digest and sets the change pointer to
`{ kind: "capability_change_certificate",
digest: recovery_capability_change_digest }`. It verifies that all three
immutable objects exist and authenticate one another. Completion is reported
only after tuple readback
and remote object readback prove membership. If compare-and-swap loses only to
a later ordinary same-transition manifest, registration rebuilds the bounded
descendant proof and change certificate under the same `registration_id` and a
fresh `attempt_operation_id`, then retries without re-encrypting the captured
backup. A transition, authority, capability, spent-set, or migration
pointer change regenerates the authority-bound backup objects or produces an
`import_only` bundle. A lost response is resolved by reading the exact tuple
and fetching all three objects, never by blind re-registration.

Explicit revocation uses the same certificate with `change_kind: "revoke"` and
the exact one-entry removal. The target set and change certificate receive the
same content-addressed publish, readback, signature, binding, existence, and
response-loss checks before and after compound compare-and-swap. Revocation
does not add the redemption ID to the spent set. The previous change pointer
and its kind prevent an old signed registration from replaying after removal. Normal
manifests and ordinary transitions preserve both capability fields exactly.

Library Core v1 uses conservative active-capability reachability. While any
recovery entry remains active, garbage collection retains every immutable
delegation, source manifest and exact authentication object, transition and
authority-chain object, recovery-capability change certificate, actor
certificate, compaction or repair receipt, checkpoint, operation segment, and
referenced blob needed to verify an unbroken authenticated path from the
oldest active delegation source tuple through every later accepted frontier to
the current tuple. V1 does not attempt to synthesize a smaller proof graph.
Revocation or successful redemption releases one entry's pin only after the
new compound tuple commits, reads back, and the complete reachability graph for
all remaining active entries is recomputed. An object still reachable from
another capability, accepted frontier, quarantine branch, or backup in
progress remains pinned.

Backup completion requires the exact bundle, envelope, encrypted manifest,
every reachable inventory page, and every ordinary encrypted file to be durable
and read back. `same_library` completion
also requires the delegation and opens the encrypted recovery private key in
isolated memory once, proves that its RFC 8032 seed derives
`recovery_public_key`, then zeroizes it. `import_only` completion proves that
both are absent. A backup without its mode-exact complete bundle proof is
incomplete even when every data file exists.

Restore first checks the bundle, envelope, authority-chain, and ciphertext
structures, bounds, canonical bytes, and digests without granting them
authority. It validates the bounded terminal key claim and tentatively verifies
the bundle signature and, in
`same_library`, the current backup delegation signature. These checks detect
ordinary corruption but do not yet establish a historical recovery link.
`import_only` rejects a current delegation.

The reader then unwraps the backup data key and AEAD-authenticates the signed
manifest into an unexposed quarantine store. It strictly parses the bounded
bootstrap metadata, tentatively verifies the manifest signature, walks the
signed `source_authority_proof_objects` and
`source_recovery_capability_change_chain` inventory roots, and decrypts exactly
that proof closure into the same quarantine. It does not
decrypt, parse, stage, or expose checkpoint rows, operation segments, content
blobs, or media during this bootstrap.

Using the quarantined canonical proof bytes, the reader validates from genesis
through the terminal transition: every ordinary authority signature, every
recovery delegation and possession proof, every active and spent body, the
typed capability-change chain, each exact manifest and authentication object,
and the terminal key. It then re-verifies the bundle, manifest, and current
backup delegation signatures under the now trusted chain and requires every
public and encrypted duplicate to match byte for byte. Only after that complete
proof succeeds do bundle and manifest gain authority and may ordinary files
enter staging.

Each later file verifies ciphertext digest, AEAD tag, plaintext length, and
plaintext digest before entering the candidate store. A wrong secret,
corruption, or authentication failure returns one typed
`backup_authentication_failed` result and reveals no partial plaintext or
which private check failed. Derived keys, the backup data key, decrypted
recovery private key, quarantined proof objects, and temporary plaintext
buffers are zeroized or deleted on success, failure, or cancellation. No
unauthenticated or authority-unverified application plaintext is exposed. KDF
or AEAD parameter changes require a new backup format version.

Only a verified `same_library` bundle can enter this authority path.
Same-library recovery creates a fresh target authority key and an exact
recovery transition certificate whose authorization kind is
`recovery_delegation`. The decrypted recovery key proves possession:

```text
migration_recovery_supersession_body = {
  format: "freed_migration_recovery_supersession_v1",
  library_id,
  source_compound_authority_tuple,
  delegation_digest,
  redemption_id,
  restore_operation_id,
  restore_staging_digest,
  target_epoch,
  target_epoch_id,
  target_authority_key_id,
  previous_migration_claim_pointer,
  migration_claim_history_root,
  terminal_lifecycle_digest,
  candidate_state: "absent" | "registered",
  registered_migration_candidate_id,
  registered_migration_candidate_digest,
  registered_candidate_registration_digest,
  candidate_object_registry_root_body,
  candidate_object_registry_revision,
  cleanup_state: "absent" | "registered",
  registered_cleanup_digest,
  recovery_transition_operation_id,
  created_at_ms
}

migration_recovery_supersession_digest = D(
  "migration-recovery-supersession",
  migration_recovery_supersession_body
)

migration_recovery_supersession_target_signature = S(
  "migration-recovery-supersession-target",
  target_authority_private_key,
  { migration_recovery_supersession_digest }
)

recovery_authorization = S(
  "backup-recovery-possession",
  recovery_private_key,
  {
    delegation_digest,
    redemption_id,
    certificate_digest,
    target_authority_key_id,
    migration_recovery_supersession_digest
  }
)
```

`source_compound_authority_tuple` is the complete exact source
compare-and-swap record, including transition, manifest, manifest
authentication, generation, active recovery, capability-change pointer, spent
redemption, and migration pointer fields. The previous pointer and history
root equal that tuple. Delegation, redemption, restore operation, and restore
staging equal the exact verified backup and recovery proposal. Bounded
traversal verifies every lifecycle entry through the terminal pointer.

For `candidate_state: "absent"`, every registered-candidate and candidate-root
field is null. This is valid only when the lifecycle candidate was never
admitted to the immutable candidate registry. Because candidate registration
was the only operation admissible before that entry, no source contribution,
fence, candidate-object, or cutover object exists for this lifecycle and no
recovery-GC object can later be registered for it. For `"registered"`, every field
is non-null, reopens the exact candidate and registration, and binds the exact
current persistent `migration_candidate_objects` root and contiguous registry
revision. The canonical empty root is still non-null for a registered candidate
with zero objects. There is no available-object subset and no omission of
registered staging.

For `cleanup_state: "absent"`, `registered_cleanup_digest` is null and the
cleanup registry has no entry for the terminal abandonment. It is always absent
for an active candidate. For `"registered"`, the digest is non-null and reopens
the exact immutable cleanup for the terminal abandonment. A candidate claim
cannot name a registered cleanup. An abandonment may use either state according
to the exact registry read in the winning recovery transaction.

The winning recovery compare-and-swap conditions on the exact candidate
registry root and revision and exact cleanup-registry result in this proof.
Candidate-object append rechecks the current migration pointer inside its
commit transaction. It cannot commit after the pointer is cleared. A concurrent
append or cleanup registration makes recovery lose and rebuild the proof. This
closes the object set without pretending that claimant-local garbage is part of
portable history.

The target epoch is the source tuple's epoch plus one, the target key matches
the recovery certificate, and the operation ID is stable across byte-identical
retry. The new target key verifies the target supersession signature. The
delegation recovery public key separately verifies `recovery_authorization`,
which binds the supersession and transition digests. The proof never claims that
unreachable source-local fences or staging bytes were cleaned. The winning
epoch transition makes all of them non-authoritative. Their later revocation,
quarantine, or deletion is garbage collection and cannot restore old
authority.

The canonical signed supersession object is stored immutably at
`proof/migration-recovery-supersession/<migration_recovery_supersession_digest>.jcs`.
The genesis closure retains it, the verified lifecycle set nodes, every
candidate registry entry, every still-existing object named by its exact root,
and any registered cleanup closure. A recovery-consumed lifecycle is portable
through this proof even when no abandonment cleanup could have existed.

Recovery-authorized garbage collection uses a distinct closed record. It never
pretends that an active claim was abandoned and never enters the ordinary
abandonment cleanup registry:

```text
migration_recovery_gc_body = {
  format: "freed_migration_recovery_gc_v1",
  library_id,
  migration_recovery_supersession_digest,
  recovery_transition_digest,
  terminal_lifecycle_selector: {
    kind: "recovery_supersession",
    digest: migration_recovery_supersession_digest
  },
  migration_candidate_id,
  claim_fencing_generation,
  candidate_object_registry_root_body,
  candidate_object_registry_revision,
  migration_candidate_staging_census_body,
  migration_candidate_staging_census_digest,
  candidate_object_count,
  source_fence_disposition_set_body,
  source_fence_disposition_set_digest,
  source_fence_disposition_count,
  candidate_staging_disposition_set_body,
  candidate_staging_disposition_set_digest,
  candidate_staging_disposition_count,
  signing_authority_epoch,
  signing_authority_epoch_id,
  signing_authority_transition_digest,
  signing_authority_key_id,
  gc_operation_id,
  completed_at_ms
}

migration_recovery_gc_digest = D(
  "migration-recovery-gc",
  migration_recovery_gc_body
)

migration_recovery_gc_authority_signature = S(
  "migration-recovery-gc-authority",
  current_authority_private_key,
  { migration_recovery_gc_digest }
)
```

This object exists only when the supersession has
`candidate_state: "registered"`. Its candidate ID, fencing generation, registry
root, and revision equal the supersession byte for byte. The census is the
complete one-to-one expansion of that frozen root and uses the exact recovery
supersession selector. Both disposition sets use the same selector, candidate,
and fencing generation. Their entries are the complete signed disposition
objects defined above. For a recovery selector, a source-fence receipt has a
null `migration_claim_source_revocation_digest`: the accepted recovery
transition, not a fictional abandonment revocation, supplies the authority
fence. `not_acquired` requires null reservation and activation records.
`superseded` requires the exact reservation and optional activation made
ineligible by the recovery transition. `released` is valid only when the source
owner completed and durably proved release before the recovery transition.

The receipt signing tuple names an accepted authority transition at or after
the recovery transition. The recovery-GC signer tuple names the exact current
accepted authority when the GC registry admits the object. The verifier follows
the unbroken authority chain from recovery through each receipt signer and the
final signer. A rotation during collection does not bless stale signatures:
already completed receipts remain valid historical entries, while the final GC
object is signed by the current authority.

The authority store has an immutable create-if-absent recovery-GC registry
keyed by `migration_recovery_supersession_digest`. Admission requires the
recovery transition to remain in the current accepted authority chain, exact
readback of every signed receipt and authenticated-set node, confirmation of
every terminal physical action, and the exact current signing-authority tuple.
Response loss resolves by registry readback; a different digest is a permanent
collision. The canonical signed object is stored at
`proof/migration-recovery-gc/<migration_recovery_gc_digest>.jcs`, and the
registry maps the supersession digest to that exact GC digest. GC registry
absence remains valid because recovery authority never
depends on later physical cleanup. Once registered, the complete signed GC
object, census, disposition roots, set nodes, signed receipts, quarantine
roots, and retained payloads become part of portable closure. Deleted payloads
remain omitted only behind their census entry, signed disposition, and signed
GC aggregate. This object has no edge back to a later transition or manifest
and therefore does not change the acyclic recovery certificate derivation.

The verifier checks the target signature and `target_authority_proof` against
the exact target authority public key and checks the recovery authorization
against the delegation's exact recovery public key. Same-library recovery is
eligible only when the exact `{ delegation_digest, redemption_id }` entry is in
the current active-capability set, the redemption ID is absent from the spent
set, and the current authenticated authority and manifest history is a verified
descendant of the delegation source tuple. The backup checkpoint is a
reconstruction base, not permission to roll the library backward.

Before proposing the recovery transition, the restoring installation fetches
and verifies every current descendant manifest, compaction receipt, operation
segment, quarantined branch, actor certificate, receipt, and blob needed to
advance the staged backup to the exact current accepted frontier and
materialized digest. The final source barrier and closure proof cover that
reconstructed state. Missing or contradictory descendant objects block
same-library recovery and leave verified new-library import as the fallback.
V1 does not claim a trusted wall clock.

If the source tuple has a non-null migration lifecycle pointer, recovery also
fetches and verifies its complete typed lifecycle and any registered candidate
or cleanup object that exists. It does not require an abandonment cleanup or
source-local fence record that the lost authority could never complete. The
transition's previous migration pointer equals that exact lifecycle pointer,
and the genesis closure carries the signed
`migration_recovery_supersession` object and every immutable lifecycle,
candidate, and cleanup object named by it. Winning recovery atomically advances
the epoch and clears the pointer, which makes all old candidate, fence, and
staging records non-authoritative before local activation. When
`candidate_state` is `"registered"`, each reachable source may later record its
old fence as `superseded`, and candidate staging may be quarantined or deleted,
through the exact signed disposition and `migration_recovery_gc` contract
above. When it is `"absent"`, those records cannot exist and recovery-GC is
forbidden. Registered-state records are post-transition garbage-collection
evidence, not a precondition for key-loss recovery, and never restore old
candidate authority.

```text
spent_recovery_redemptions_body = {
  library_id,
  redemption_ids
}

spent_recovery_redemptions_digest = D(
  "spent-recovery-redemptions",
  spent_recovery_redemptions_body
)
```

`redemption_ids` is the complete unique set of exact 64-character lowercase
hexadecimal redemption IDs, sorted by decoded identifier bytes, with at most
4,096 entries in v1. The immutable body is uploaded under and fetched by its
digest. Before recovery, the verifier fetches the previous active-capability
and spent-redemption bodies and recomputes both source digests. It proves the
exact delegation entry is present and the candidate redemption ID is absent.
It constructs the exact sorted active-set removal and spent-set union, uploads
both target bodies to their content-addressed locations, fetches them through
the remote read path, and recomputes both target digests before it derives the
transition certificate or genesis closure. The closure names both verified
target bodies. The compound authority compare-and-swap installs the recovery
transition, removes exactly the used active-capability entry, replaces the
exact source spent digest with that exact target digest, and sets
`recovery_capability_change_pointer` to
`{ kind: "recovery_transition_certificate", digest: certificate_digest }`.
It re-fetches both target bodies and verifies exact removal and union
before committing the tuple. All other active capabilities remain exact.
Normal transitions preserve both recovery sets and the change pointer exactly.
Reaching the v1 entry cap disables further same-library recovery until a
reviewed protocol upgrade; it never drops old IDs.
The winner thereby rotates to a fresh authority key and permanently retires
the recovery key. A losing, replayed, spent, or stale capability
cannot enroll actors, sign manifests, or authorize any later transition.

Creating or restoring a snapshot is one database and blob-namespace-consistent
operation. The checkpoint freezes one reachable blob set and records every blob
path, length, and digest before it releases the snapshot barrier. Contact state,
content blobs, indexes, operations, and the library cannot come from different
moments. Backup completion verifies that every referenced blob exists and that
the backup contains a bijection with the frozen reachable set: every frozen
digest and byte length has exactly one verified backup object, and every backup
blob belongs to that set. A blob that exists only in the live source does not
satisfy backup completion.

The frozen reachable set remains pinned against garbage collection until the
backup bundle, recovery envelope, encrypted manifest, complete inventory tree,
logical checkpoint, operation segments, and all blob copies are durable and
verified.
`same_library` also requires its delegation; `import_only` instead proves a
delegation and recovery private-key entry are absent. Releasing the database
snapshot does not release that pin.

The adapter-neutral checkpoint is the portable authority. Desktop and PWA
encode the same registry-sorted logical rows and digests even when their
physical stores differ. A physical SQLite checkpoint is an optional
same-adapter acceleration and never the only portable representation. SQLite,
IndexedDB, and OPFS first capture the authoritative logical checkpoint and blob
roots in one frozen adapter generation. Any optional physical accelerator is
then built as the fresh scrubbed store defined above. Restore validates into a
staging generation with a unique restore operation ID and staging digest:

```text
logical_checkpoint_body = {
  format: "freed_logical_checkpoint_v1",
  library_id,
  epoch,
  epoch_id,
  schema_version,
  field_registry_version,
  canonical_codec_version,
  anchor_kind: "accepted_authority" | "transition_candidate",
  source_transition_digest,
  source_manifest_digest,
  transition_candidate_anchor,
  promoted_receipt_digests,
  accepted_frontier,
  quarantined_frontier,
  materialized_rows,
  field_clocks,
  relationships,
  tombstones,
  actor_states,
  receipt_records,
  materializer_position,
  blob_roots,
  excluded_registry_keys
}

logical_checkpoint_digest = D("checkpoint", logical_checkpoint_body)

restore_preparation_body = {
  restore_operation_id,
  backup_bundle_digest,
  backup_manifest_digest,
  source_logical_checkpoint_digest,
  source_logical_checkpoint_storage_root_digest,
  source_logical_checkpoint_byte_length,
  source_library_id,
  target_library_id,
  target_installation_id,
  target_epoch_id,
  target_schema_version,
  frontier_digest,
  materialized_digest,
  reachable_blob_set_digest,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length,
  target_media_vault_restore_plan_digest,
  target_media_vault_restore_plan_storage_root_digest,
  target_media_vault_restore_plan_byte_length,
  target_media_vault_manifest_digest,
  target_media_vault_generation,
  target_media_vault_admission_fence
}

restore_preparation_digest = D(
  "restore-preparation",
  restore_preparation_body
)

restore_staging_body = {
  restore_operation_id,
  restore_preparation_digest,
  target_candidate_checkpoint_digest,
  target_candidate_checkpoint_storage_root_digest,
  target_candidate_checkpoint_byte_length
}

restore_staging_digest = D("restore-staging", restore_staging_body)
```

An `accepted_authority` checkpoint has non-null `source_transition_digest` and
`source_manifest_digest` and null `transition_candidate_anchor`. The transition
is accepted authority for the checkpoint's exact library and epoch. The
manifest is an already accepted captured predecessor manifest that does not
reference this checkpoint. A later manifest may reference the completed
checkpoint. No checkpoint may name a manifest that contains that checkpoint.

A `transition_candidate` checkpoint has null `source_transition_digest` and
`source_manifest_digest`. Its required closed anchor is:

```text
{
  transition_reason:
    "library_genesis_import" |
    "automerge_migration" |
    "rollback" |
    "same_library_recovery" |
    "actor_fork_repair" |
    "clock_quarantine_repair",
  operation_id,
  source_authority,
  source_evidence
}
```

`source_evidence` is a unique list of closed `{ kind, digest }` values sorted
by kind and decoded digest. For `library_genesis_import`, `source_authority` is
null, `operation_id` is the import ID, and source evidence contains exactly the
import-source and import-plan digests. For `automerge_migration`,
`source_authority` is the exact accepted `legacy_source_authority_body`,
`operation_id` is the migration candidate ID, and source evidence contains
exactly the migration-candidate digest. For `rollback`, `source_authority` is the
exact accepted Library Core compound authority tuple, `operation_id` is the
rollback ID, and source evidence contains exactly the rollback-candidate
digest. For `same_library_recovery`, `source_authority` is the exact current
reconciled Library Core compound authority tuple, `operation_id` is the
restore operation ID, and source evidence contains exactly the
restore-preparation digest. That preparation binds the source backup
checkpoint triple and complete staged target state but deliberately does not
name this candidate checkpoint. The later restore-staging record cross-binds
the preparation and candidate checkpoint triple, and the transition names
that staging digest. For either repair reason, `source_authority` is the exact accepted
Library Core compound authority tuple, `operation_id` is the repair ID, and
source evidence contains exactly the repair-plan digest and storage-root
digest. The candidate objects themselves bind the source checkpoint,
reachable-blob set, media snapshot, target authority, actor, plan, and fenced
target manifest. A repair plan instead binds the exact quarantined branches,
replacement operations, target actor, target frontier, and materialized
digest. No other reason or evidence kind is valid in v1.

The candidate checkpoint's library, target epoch, target epoch ID, actor state,
frontier, materialized digest, blob roots, media plan, and source evidence equal
the applicable immutable preparation and later transition receipt. It is
non-authoritative staging before the transition. It can be named by that
receipt and candidate target manifest. When the transition wins, it becomes a
verified reconstruction base for producing the first accepted checkpoint, but
it never becomes an `accepted_authority` checkpoint. It cannot be used for
backup, restore, compaction, delegation, or user-visible activation before the
transition. After the transition, its canonical bytes remain an immutable
historical checkpoint proof named by the retained receipt and closure. Every
later checkpoint, manifest proof closure, compaction, and backup that retains
that receipt retains the historical object too. It still never competes with
the current accepted checkpoint for activation.

After an import, migration, rollback, same-library recovery, or repair
transition commits and reads back, any accepted target writer may create a new
`accepted_authority`
checkpoint over
the identical target logical state. It anchors the accepted transition and
winning target-genesis manifest. For imported library genesis that manifest is
generation zero. Migration, rollback, same-library recovery, and repair use
the exact generation
installed by their compound transition, derived from the accepted predecessor
tuple. The
compound transition has already made the target epoch and staged operations
globally authoritative. The initiator still keeps local user access and backup
disabled until it reads back the next manifest generation naming this accepted
checkpoint. Empty-library genesis does not use a `transition_candidate`
checkpoint.

For restore, the preparation's source logical-checkpoint digest, storage-root
digest, and byte length equal the authenticated backup manifest and verified
checkpoint root. The staging record's target candidate-checkpoint triple equals
the independently constructed target checkpoint and its verified root. That
checkpoint has transition reason `same_library_recovery`, the same operation
ID, and the exact preparation digest in its source evidence. The transition's
restore staging digest, target checkpoint in its genesis closure, and
candidate manifest all cross-bind those exact values.

`source_media_vault_snapshot_digest` equals the authenticated
backup manifest's `media_vault_snapshot_digest`, the independently decrypted
snapshot body's recomputed digest, and
`media_vault_restore_plan_body.source_media_vault_snapshot_digest`. The
storage-root digest and byte length likewise equal the backup manifest,
verified root, staging record, and plan fields. The complete snapshot body
embedded in the plan equals those reconstructed canonical bytes. A mismatch
across any two values rejects the staging generation before target-vault
mutation.

`materialized_rows` uses the exact logical projection and ordering defined
under `Operation envelope`. `field_clocks` contains closed
`{ registry_key, primary_key, field_path, entity_generation, hlc_wall_ms,
hlc_counter, actor_id, operation_id }` entries. `relationships` contains closed
`{ relationship_type, left_registry_key, left_primary_key,
right_registry_key, right_primary_key, entity_generation, tombstoned,
hlc_wall_ms, hlc_counter, actor_id, operation_id }` entries. `tombstones`
contains closed `{ registry_key, primary_key, entity_generation, hlc_wall_ms,
hlc_counter, actor_id, operation_id }` entries. `actor_states` contains closed
`{ actor_id, enrollment_certificate_digest, accepted_sequence,
accepted_operation_id, accepted_chain_digest, retired,
retirement_certificate_digest }` entries. The retirement digest is null only
while `retired` is false and required otherwise.

For an actor with `accepted_sequence` zero, `accepted_operation_id` is null and
`accepted_chain_digest` is the exact `actor_chain_genesis` derived from its
enrollment certificate. For a positive accepted sequence, both fields are
non-null and name that exact accepted tip.

`receipt_records` contains closed
`{ receipt_kind, receipt_id, receipt_body, receipt_digest, authorization }`
entries. Each `receipt_kind` selects one exact closed body and authorization
schema from the executable registry. The record carries the canonical bytes
needed to recompute and verify the digest and proof, not only a dangling
reference. Actor enrollment, retirement, repair, compaction, migration,
rollback, and authority receipts needed to validate the checkpoint are
present. `materializer_position` is the adapter-neutral closed
`{ frontier_digest, ingest_sequence, materialized_digest }` object.
`ingest_sequence` is the exact nonnegative global journal sequence represented
by the checkpoint frontier. It is not a SQLite row ID or IndexedDB cursor.
`blob_roots` contains closed
`{ content_digest, byte_length, media_type, registry_key, primary_key,
field_path }` entries. `accepted_frontier` and `quarantined_frontier` contain
the exact branch-qualified tip shape from the operation contract.
`excluded_registry_keys` is the complete explicit set of registry entries not
represented in this portable checkpoint.

The dormant PWA portable-checkpoint adapter materializes these records into
bounded IndexedDB stores for generation state, collection rows, page receipts,
selected-generation control, actor tips and enrollments, materialized rows,
read-state sidecars, a compact ordered feed projection, raw operation
transport, and authenticated operation state. One verified checkpoint page
commits in one IndexedDB transaction.
Exact retry reuses the page receipt. A changed retry, skipped page, duplicate
row identity, or transaction failure cannot advance staging. Selection occurs
only after every collection count and the complete import receipt match the
manifest, header, frontier, and materialized digest. The adapter retains the
selected generation and one rollback generation and exposes at most 128 rows
from one collection or operation tail per read. It has no production caller.
Automerge remains the active product and replication authority until the
separately governed cutover.

The dormant operation-tail path extends one selected portable checkpoint with
immutable `freed_operation_segment_v1` objects. A segment contains at most
1,000 canonical operation envelopes and at most 4,000,000 canonical envelope
bytes. Its closed body binds the exact library, storage epoch, schema, first
and last global ingest sequences, base and result frontier digests, previous
segment digest, operation count, and canonical byte count. A domain-separated
digest authenticates that body. The wire object stores one closed header
followed by the exact bounded entries in contiguous ingest order, then gzip. A
separate SHA-256 digest authenticates the exact stored bytes and determines the
immutable flat object locator.

The first segment after a checkpoint starts at
`materializer_position.ingest_sequence + 1`, names the checkpoint frontier as
its base frontier, and has no previous segment digest. Each later segment
starts at the next global ingest sequence, names the current imported
frontier, and binds the prior body digest. The PWA importer verifies stored
bytes, bounded wire framing, closed records, canonical envelope identity, body
digest, locator, expected tail tuple, and exact writer receipt before
committing. One IndexedDB transaction writes every operation occurrence,
records the segment, and advances the generation frontier and tail. Exact
segment replay is idempotent. A gap, changed replay, duplicate operation ID,
one-sided transaction failure, wrong frontier, or wrong predecessor leaves the
selected tail unchanged. Readers return at most 128 envelopes from the
selected generation per request.

The native operation outbox pager preserves transaction boundaries. A page
contains only complete transactions. If the first pending transaction exceeds
the requested entry or byte budget, the pager fails before returning any
entry. If a later complete transaction would cross the page budget, the page
ends before that transaction and the next cursor remains at the preceding
transaction boundary. Segment construction therefore never needs to infer or
repair a transaction split caused by pagination.

Raw segment ingestion authenticates wire structure, storage attribution, and
durable operation identity but does not grant readability. The separate PWA
admission path first verifies the complete authority-signed actor enrollment
certificate against the exact selected checkpoint actor state. It then groups
each segment into complete transactions, verifies every Ed25519 operation
signature, transaction digest, actor sequence and chain predecessor, and
requires every causal tip to resolve to the checkpoint frontier, an accepted
actor tip, or a previously authenticated operation.

Cryptographic verification occurs before the write transaction. The following
IndexedDB transaction rechecks the selected generation plus every actor tip,
then atomically stores authenticated occurrences, advances actor and
authenticated generation tips, records the authenticated segment, and applies
the registered `feed_item_read_assignment` minimum-present algebra. The
materializer writes a compact read-state sidecar even when the target feed row
is not locally cached, and updates the selected `feedItems` row when it is
present. Equal read times use the binary operation ID as the stable source
tie-break. Exact enrollment and segment retry are idempotent.

Raw imported and authenticated cursors remain distinct. Invalid signatures,
unknown causal tips, unenrolled or retired actors, stale actor tips, split
transactions, concurrent checkpoint selection, and changed retries cannot
advance authenticated state or modify materialized rows. Unverifiable raw
bytes may remain as non-authoritative evidence. Browser construction digests
use the bounded dependency-free SHA-256 implementation over the canonical
domain input. Ed25519 verification uses platform Web Crypto.

The selected authenticated generation also owns one disposable
`feed_page_v1` physical index. Checkpoint import projects each visible
`feedItems` row with the shared compact card contract while that one verified
row is already in hand. The physical key is descending published time followed
by the UTF-8 global identity. Full record bodies are not duplicated in the
index. Database upgrade from version 3 scans the existing materialized rows
with an IndexedDB cursor, rebuilds only the compact index, and counts visible
rows per retained generation without allocating a corpus-sized array.

The bounded reader pins the selected checkpoint digest and exact authenticated
ingest sequence as its source identity. It admits at most two sessions for 60
seconds, validates and returns no more than 128 compact cards and 2 MiB per
response, and releases exact cancellation, expiry, and exhausted sessions.
An accepted operation or selected checkpoint change advances the source and
invalidates every older cursor. The read-assignment materializer updates its
sidecar, the full materialized row, and the compact feed card in the same
IndexedDB transaction that advances authenticated operation state. A crash
cannot expose a new cursor source with an old card or a new card under an old
source.

This path still has no production caller. Supported operation parity beyond
read assignment, PWA intent publication and results, cloud scheduling, and
governed activation remain required before it may affect product state or
participate in an authority cutover.

The dormant PWA intent transport uses one immutable, content-addressed segment
chain per enrolled PWA actor. Every entry contains one exact canonical signed
operation envelope and binds the same library, storage epoch, actor, operation
ID, and actor sequence. A segment contains no more than 1,000 operations or
4,000,000 canonical envelope bytes and remains below the ordinary 5 MB stored
object ceiling after the versioned `intents` frame is gzipped. Segments cannot
cross actors, epochs, or libraries. Sequence gaps, changed bytes, reordered
entries, duplicate frame identities, a stale previous-segment digest, and an
import receipt that names another verified range fail closed.

One small mutable intent head per actor names the next actor sequence and the
latest immutable segment. An empty head starts at sequence 1. A nonempty head
may reference only the exact content-addressed object for its library and actor
whose last sequence is one before `next_intent_sequence`. Drive conditional
publication, the durable PWA outbox, Desktop acceptance, result segments, and
provider execution remain separate later slices. This contract performs no
network request and grants no canonical or provider authority.

The dormant PWA intent outbox shares the versioned Library Core IndexedDB
database. It accepts only complete transactions produced by the closed signing
contract and commits their canonical envelopes, operation identities, actor
sequence, transaction boundary, previous-operation link, and actor-chain tip
atomically. Exact transaction replay is idempotent. Changed bytes under an
existing transaction identity, an actor sequence gap, an epoch change, or a
broken actor-chain extension aborts without advancing the durable actor.

An unpublished segment candidate begins one sequence after the exact locally
recorded publication head and includes only complete contiguous transactions.
The candidate never exceeds 1,000 operations or 4,000,000 canonical envelope
bytes. Local publication state advances only after the caller supplies the
exact prior head digest, verified immutable segment reference, next actor head,
and matching canonical readback digest. This proves local crash recovery and
publication bookkeeping only. The store does not perform the upload, compare
and swap, readback, provider action, product activation, or Automerge cutover.

A receipt that commits checkpoint digest X is forbidden from
X's `receipt_records`. The manifest, transition, or closure binds that receipt
externally. The receipt becomes eligible for inclusion only in a later
checkpoint whose digest it does not commit. This rule applies uniformly to
compaction, migration, rollback, import-execution, restore, repair, and any
future registered receipt and makes receipt-to-checkpoint derivation
acyclic.

`promoted_receipt_digests` is a unique list sorted by receipt kind, receipt ID,
and decoded digest. A `transition_candidate` checkpoint requires the canonical
empty list. For `accepted_authority`, `receipt_records` is the exact union of
the predecessor manifest's checkpoint receipt set and the records named by
`promoted_receipt_digests`, with no other addition or omission. Every promoted
receipt is fully verified under the checkpoint's accepted authority history,
does not commit this checkpoint digest, and satisfies exactly one timing class:
it was created after the predecessor manifest, or it is the exact precursor
receipt named by the accepted transition that installed that predecessor as
its target genesis manifest and was already verified in that transition's
closure. The precursor exception applies only to the import-execution,
migration, rollback, or repair receipt field discriminated by that transition.
It does not permit an arbitrary older receipt or any receipt that commits the
promoting checkpoint. The next manifest's
`checkpoint_receipt_promotions` contains one closed
`{ checkpoint_digest, promoted_receipt_digests }` entry for every named
checkpoint, sorted by decoded checkpoint digest, with no duplicate or missing
checkpoint. Each entry's list is byte-identical to that checkpoint's list. An
ordinary checkpoint uses the empty list. The first accepted checkpoint after
import promotes exactly the signed import execution and final receipts. After
migration, rollback, or repair it promotes exactly the receipt bound by the
winning transition. Same-library recovery has no independent receipt
promotion: its accepted transition already retains the exact restore
preparation and staging objects in the authority proof closure.

Checkpoint collections are unique and sorted as follows: logical rows by their
existing materialized ordering; field clocks and tombstones by ASCII registry
key, bytewise `C(primary_key)`, and field path where present; relationships by
relationship type and bytewise canonical endpoint tuples; actor states by
decoded actor ID; receipt records by receipt kind, receipt ID, and decoded
digest; frontiers by decoded actor ID, sequence, operation ID, and chain
digest; blob roots by decoded content digest and then their canonical owning
field tuple; exclusions by ASCII registry key. Every count, sequence, HLC
component, and byte length is a nonnegative safe integer. Every ID, digest,
value, nullability rule, media type, and receipt kind must pass its exact
field-registry codec. An inline field value may occupy at most 256 KiB of
canonical bytes; larger content must be a referenced blob. A v1 checkpoint
contains at most 10,000,000 entries in any one collection and 16 GiB of
canonical bytes. Implementations stream canonical output and input in bounded
pages rather than allocating those maxima.

The logical checkpoint contains no adapter row IDs, indexes, cache bytes,
secrets, or unregistered fields. Desktop and every supported writable PWA
adapter publish and consume public vectors for empty, mixed, maximum-boundary,
and rejected checkpoint bodies. They must produce identical canonical bytes
and digest for the same logical state.

Checkpoint self-consistency is mandatory:

```text
checkpoint_frontier_digest = D("causal-frontier", {
  library_id,
  epoch,
  epoch_id,
  causal_frontier: accepted_frontier
})

checkpoint_materialized_commitment_body =
  materialized_commitment_v1(materialized_rows)

checkpoint_materialized_digest = D("materialized-state", {
  library_id,
  epoch,
  epoch_id,
  schema_version,
  frontier_digest: checkpoint_frontier_digest,
  materialized_commitment_body: checkpoint_materialized_commitment_body
})
```

`materializer_position.frontier_digest` equals
`checkpoint_frontier_digest`. For an `accepted_authority` checkpoint captured
by a backup, the backup manifest's `frontier_digest` also equals it.
`materializer_position.materialized_digest` equals
`checkpoint_materialized_digest`. `materialized_commitment_v1` is the exact
canonical trie construction defined above. Checkpoint verification streams
rows through bounded external leaf sorting and never turns this equation into
a full-corpus resident array. The checkpoint's accepted and quarantined
frontiers equal the exact accepted predecessor-manifest frontiers for
`accepted_authority`, or the exact registered transition preparation frontiers
for `transition_candidate`. Positive-sequence
`actor_states` and accepted-frontier tips form an exact bijection by actor ID,
sequence, operation ID, and chain digest. A zero-sequence actor state has no
accepted-frontier tip, and no accepted-frontier tip lacks one actor state.
For an accepted backup checkpoint, its actor-certificate sets in the backup
manifest and its checkpoint receipt records cover every actor and authority
object those frontiers need. The unique
`{ content_digest, byte_length }` projection of `blob_roots`, unioned with
every preserved segment blob reference and included media-vault snapshot
entry, equals `reachable_blob_set_body.blobs`; recomputation equals the backup
manifest's `reachable_blob_set_digest`. Checkpoint and backup-manifest
exclusions are identical.

An `accepted_authority` checkpoint's library, epoch, epoch ID, schema, and
transition fields match the source transition certificate. Its
`source_manifest_digest`, accepted and quarantined frontiers, actor state,
logical state, and blob roots match the one frozen predecessor-manifest
snapshot. Its receipt records match that snapshot plus only the exact promoted
receipt delta above. The authenticated backup
manifest binds that checkpoint digest and source-manifest digest, then
separately binds the complete captured cloud tuple: manifest authentication,
generation, active-recovery root, recovery-capability-change pointer, and
spent-redemption root. Capability registration can therefore change authority
metadata without pretending that logical library content changed.
For an accepted backup checkpoint, field-registry and canonical-codec versions
equal the backup manifest. The
operation-segment set is the exact source-manifest segment coverage required by
the checkpoint and frontiers. Restore rejects a bundle with any independently
valid but contradictory component.

Concurrent restores do not share a mutable generation. The cloud authority
compare-and-swap alone chooses the winner. Its transition certificate binds the
restore operation ID and staging-generation digest, and that operation ID
becomes the new generation token. Local completion time grants no priority. A
losing candidate and all of its descendants remain quarantined conflict input
until an explicit operation imports or discards them.

Restore advances authority only through the global transition protocol after
every digest, frontier, blob, schema, authority-chain, and recovery-capability
check passes. If the existing library has newer cloud authority, restore first
reconciles it or imports the backup under a new library ID. A local backup never
overwrites a newer cloud epoch. The winning local transition transaction
installs the staged library-control record and the fenced target media-vault
manifest pointer and generation together. A target-vault fence conflict
prevents either authority from activating.

Import into a new library has an exact authority boundary:

```text
import_source_body = {
  backup_bundle_digest,
  backup_manifest_digest,
  backup_id,
  logical_checkpoint_digest,
  logical_checkpoint_storage_root_digest,
  logical_checkpoint_byte_length,
  source_library_id,
  source_epoch,
  source_epoch_id,
  source_frontier_digest,
  source_materialized_digest,
  source_reachable_blob_set_digest,
  source_provenance_object_set_digest,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length
}

import_source_digest = D("import-source", import_source_body)

import_plan_body = {
  import_id,
  import_source_body,
  import_source_digest,
  source_provenance_object_set_body,
  target_library_id,
  target_epoch,
  target_epoch_id,
  target_authority_public_key,
  target_authority_key_id,
  target_actor_id,
  target_actor_enrollment_certificate,
  target_actor_enrollment_certificate_digest,
  target_actor_starting_tip,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length,
  target_media_vault_restore_plan_digest,
  target_media_vault_restore_plan_storage_root_digest,
  target_media_vault_restore_plan_byte_length,
  target_media_vault_manifest_digest,
  target_media_vault_generation,
  target_media_vault_admission_fence,
  mapping_registry_version,
  identity_mappings,
  blob_mappings,
  source_provenance_mappings,
  source_semantic_atom_set_body,
  source_semantic_atom_set_digest,
  target_emission_set_body,
  target_emission_set_digest,
  transaction_plan
}

import_plan_digest = D("import-plan", import_plan_body)

import_plan_byte_length = byte_length(C(import_plan_body))

import_plan_storage_root_body = {
  artifact_kind: "import_plan",
  artifact_digest: import_plan_digest,
  canonical_byte_length: import_plan_byte_length,
  chunk_plaintext_byte_limit: 67108864,
  chunks
}

import_plan_storage_root_digest = D(
  "chunked-object-root",
  import_plan_storage_root_body
)

emitted_transaction_set_body = {
  import_id,
  transaction_digests
}

emitted_transaction_set_digest = D(
  "import-emitted-transaction-set",
  emitted_transaction_set_body
)

generated_provenance_set_body = {
  import_id,
  import_plan_digest,
  import_plan_storage_root_digest,
  import_plan_chunk_entries,
  source_logical_checkpoint_digest,
  source_logical_checkpoint_storage_root_digest,
  source_logical_checkpoint_byte_length,
  target_provenance_objects,
  target_candidate_checkpoint_digest,
  target_candidate_checkpoint_storage_root_digest,
  target_candidate_checkpoint_byte_length,
  target_media_vault_restore_plan_digest,
  target_media_vault_restore_plan_storage_root_digest,
  target_media_vault_restore_plan_byte_length,
  target_media_vault_restore_plan_chunk_entries
}

generated_provenance_set_digest = D(
  "import-generated-provenance-set",
  generated_provenance_set_body
)

import_execution_receipt_body = {
  import_id,
  import_source_digest,
  import_plan_digest,
  import_plan_storage_root_digest,
  import_plan_byte_length,
  target_library_id,
  target_epoch,
  target_epoch_id,
  target_authority_public_key,
  target_authority_key_id,
  target_actor_id,
  target_actor_enrollment_certificate,
  target_actor_enrollment_certificate_digest,
  target_actor_starting_tip,
  target_actor_ending_tip,
  mapping_registry_version,
  source_provenance_object_set_digest,
  source_semantic_atom_set_digest,
  target_emission_set_digest,
  emitted_transaction_set_digest,
  generated_provenance_set_digest,
  target_frontier_digest,
  target_materialized_digest,
  target_checkpoint_digest,
  target_checkpoint_storage_root_digest,
  target_checkpoint_byte_length,
  target_reachable_blob_set_digest,
  source_media_vault_snapshot_digest,
  source_media_vault_snapshot_storage_root_digest,
  source_media_vault_snapshot_byte_length,
  target_media_vault_restore_plan_digest,
  target_media_vault_restore_plan_storage_root_digest,
  target_media_vault_restore_plan_byte_length,
  target_media_vault_manifest_digest,
  target_media_vault_generation,
  target_media_vault_admission_fence,
  target_manifest_digest,
  target_manifest_generation,
  disposition_counts,
  build_identity
}

import_execution_receipt_digest = D(
  "import-execution-receipt",
  import_execution_receipt_body
)

import_execution_authority_signature = S(
  "import-execution-receipt-authority",
  target_authority_private_key,
  { import_execution_receipt_digest }
)

import_receipt_body = {
  import_execution_receipt_digest,
  import_execution_authority_signature,
  target_transition_digest,
  target_manifest_auth_digest,
  publication_mode: "local_only" | "cloud_confirmed",
  published_cloud_authority
}

import_receipt_digest = D("import-receipt", import_receipt_body)

import_authority_signature = S(
  "import-receipt-authority",
  target_authority_private_key,
  { import_receipt_digest }
)
```

`import_source_digest` recomputes from the complete embedded
`import_source_body`. The source body and complete
`source_provenance_object_set_body` in the plan are the durable preimages that
bind the source bundle, backup ID, checkpoint, frontier, materialized state,
reachable set, provenance census, and media snapshot. The provenance body
recomputes the source body's exact `source_provenance_object_set_digest`; its
backup, library, epoch, and epoch-ID fields equal the source body and
authenticated backup manifest. Exactly one `backup_bundle` object and exactly
one `backup_manifest` object in the provenance census have source digests
equal to `import_source_body.backup_bundle_digest` and
`import_source_body.backup_manifest_digest`, respectively. Those are the
distinguished current bundle and manifest entries. The current bundle's
complete signed bytes are byte-identical to outer record zero, the current
manifest's complete signed bytes are byte-identical to the decrypted
authenticated manifest, and
`backup_bundle_body.backup_manifest_digest` equals
`import_source_body.backup_manifest_digest` byte for byte. No historical
bundle or manifest entry may satisfy either current-object role. The source
checkpoint digest,
storage-root digest, and byte length equal the authenticated backup manifest
and verified chunked checkpoint. Both signed backup objects, the checkpoint
root and chunks, and the provenance preimage therefore remain recoverable
through the retained chunked plan after the original source archive is gone.

The import source body is accepted only after recomputing the complete
reachable-blob-set body from the authenticated backup checkpoint, preserved
segments, and media snapshot. Its digest equals both
`source_reachable_blob_set_digest` and the backup manifest's
`reachable_blob_set_digest`. Canonicalizing
`source_media_vault_snapshot_body` recomputes
`source_media_vault_snapshot_digest`, which equals the authenticated backup
manifest's `media_vault_snapshot_digest`. Its storage-root digest and byte
length equal the authenticated backup fields and reconstruct those exact
snapshot bytes. The media-vault plan embeds identical snapshot bytes and the
same logical digest, storage root, and length. Its target library,
installation, generation, manifest, and fence equal the import plan, candidate
actor binding, final receipt, and activated `library_control` record wherever
those fields occur. Any mixed backup, target, or installation identity blocks
planning.

`source_provenance_object_set_body` is the complete no-extra census of every
non-authoritative or historical protocol object carried by the authenticated
backup:

```text
source_provenance_object_set_body = {
  format: "freed_import_provenance_object_set_v1",
  backup_id,
  source_library_id,
  source_epoch,
  source_epoch_id,
  objects
}
```

`objects` contains closed
`{ object_kind, source_digest, byte_length }` entries. `object_kind` is one
exact member of the shared `portable_protocol_object_kind_v1` registry and
uses that registry's sole digest dispatch. The import set is the complete
no-extra subset present in the authenticated backup. This includes operation
grants and consumptions, source-fence reservation and activation records,
candidate registries and censuses, terminal disposition receipts, recovery
supersession, recovery-GC aggregates, descendant-registration proof, and
authenticated set nodes when the source authority history reaches them. It
never omits one because another closure used a narrower local list.
Entries are unique and sorted by object kind, decoded source digest, then byte
length. The backup ID, library ID, epoch, and epoch ID equal the authenticated
backup manifest. `source_digest` is the registered protocol-object digest for
its kind. Certificate and receipt bytes are the complete canonical signed
object, not only the body whose digest selects it. For `backup_bundle`, the
bytes are exactly `{ backup_bundle_body, backup_bundle_digest,
backup_bundle_signature }`. For `backup_manifest`, they are exactly
`{ backup_manifest_body, backup_manifest_digest, backup_manifest_signature }`.
For `import_receipt`, they are exactly `{ import_receipt_body,
import_receipt_digest, import_authority_signature }`. A
`migration_candidate_claim`, `migration_claim_abandonment`, or
`migration_claim_cleanup` entry is the complete canonical body, digest, and
authority-signature object, and `source_digest` is its registered lifecycle
digest. A `migration_claim_cleanup_proof` or `checkpoint` entry names the
logical canonical object reconstructed from the exact corresponding
`chunked_object_root` and `chunked_object_chunk` entries. It has no duplicate
regular-file representation. A
`chunked_object_chunk` instead uses its exact
`DB("blob-content", bytes)` digest. `byte_length` is a nonnegative safe
integer and equals the exact canonical or chunk byte length.

The current logical checkpoint, current media snapshot, reachable library and
media payloads, and optional physical checkpoint are not members because their
complete authenticated censuses are bound separately by `import_source_body`.
The current logical checkpoint's digest, storage-root digest, and canonical
byte length are all present there. Before the import plan is committed and
before the first target mutation, the importer streams the exact source
checkpoint root object and every named chunk from the authenticated archive,
verifies their canonical bytes and identities, writes them to durable target
chunked storage under the same content-addressed identities, crosses the
storage durability barrier, reads every object back, and recomputes the
checkpoint digest, storage-root digest, byte length, root body, and complete
chunk set. The verified target copies are pinned as import staging roots for
the exact `import_id`. A write, durability, read-back, or recomputation failure
blocks plan commitment. The staging pin remains until an authenticated abandon
transaction removes it or the accepted target checkpoint and import receipt
assume permanent reachability. The source archive cannot be released before
that durable copy and read-back completes. The root and every chunk remain
reachable while the generated-provenance set, execution receipt, or resulting
import receipt is retained.
Historical checkpoints, retained plans, proofs, media manifests, opaque
evidence, quarantined operations, clocks, conflicts, and unknown-schema
evidence remain represented by their exact protocol objects or by the
`chunked_object_root` and `chunked_object_chunk` entries that reconstruct
them. Every receipt embedded in the current checkpoint's `receipt_records` is
projected into its registered object kind with its complete canonical signed
bytes. In particular, both `import_execution_receipt` and `import_receipt`
survive a later import even though the current checkpoint itself is represented
through the separate logical-checkpoint fields. `source_provenance_object_set_digest` is
`D("import-provenance-object-set", source_provenance_object_set_body)`.
Recomputation walks the complete backup proof closure, logical checkpoint,
segment set, and retained provenance roots. A source object missing from the
census or a census object absent from the backup invalidates the import source.

`identity_mappings` contains one literal closed entry per logical source
identity. Entries sort first by the unsigned UTF-8 bytes of
`source_registry_key`, then by the unsigned UTF-8 bytes of
`C(source_primary_key)`. Registry keys use the registered nonempty ASCII key
codec. Two entries with equal canonical key bytes are invalid:

```text
{
  source_registry_key,
  source_primary_key,
  target_registry_key,
  target_primary_key,
  disposition: "mapped" | "provenance_only" | "excluded" | "blocking",
  disposition_receipt_body,
  disposition_receipt_digest
}
```

For `mapped`, both target fields are required and both disposition receipt
fields are null. For `provenance_only`, `excluded`, or `blocking`, both target
fields are required null and both disposition receipt fields are required
non-null and recompute the same receipt. Every ordinary user-visible row,
explicit null, relationship, tombstone, clock, accepted operation, and
referenced blob must be `mapped` or `blocking`. The field registry may permit
`provenance_only` only for an exact
non-authoritative source kind such as quarantined protocol evidence that cannot
become target state. It may permit `excluded` only for an exact device-local
kind carrying a valid direct owner-signed exclusion receipt or an inherited
binding whose verified lineage reaches one. No implementation may select
either disposition from a generic fallback.

Mapped target identity tuples are injective. Two distinct source identities
cannot share one `{ target_registry_key, target_primary_key }`. When the source
records an alias or merge relationship, both target identities remain distinct
and the relationship is emitted as its own semantic atom. Import never
implements aliasing by destructive primary-key collapse.

`source_semantic_atom_set_body` is the complete registry-derived source
projection:

```text
{
  import_id,
  import_source_digest,
  mapping_registry_version,
  atoms
}
```

Each atom is the closed object:

```text
source_semantic_atom_body = {
  semantic_kind:
    "field_value" |
    "explicit_null" |
    "relationship" |
    "tombstone" |
    "field_clock" |
    "live_blob_reference",
  source_registry_key,
  source_primary_key,
  source_path_or_relationship,
  semantic_payload,
  identity_mapping_index
}

source_atom_digest = D(
  "import-source-semantic-atom",
  source_semantic_atom_body
)
```

`semantic_payload` uses the exact closed field, relationship, tombstone, clock,
or blob-reference codec registered for that kind. The registry produces
exactly one atom for every authoritative current logical field, explicit null,
relationship, tombstone, field clock, and live blob reference, with unique atom
digests sorted by decoded digest. Superseded, conflict-losing, compacted, and
historical accepted operations are provenance, not target semantic atoms. The
set digest is
`D("import-semantic-atom-set", source_semantic_atom_set_body)`.

`target_emission_set_body` contains closed
`{ source_atom_digest, target_atom_digest, transaction_index, member_index,
effect_index }` entries sorted by decoded source atom digest. Each target
digest recomputes from:

```text
target_semantic_atom_body = {
  semantic_kind,
  target_registry_key,
  target_primary_key,
  target_path_or_relationship,
  semantic_payload
}

target_atom_digest = D(
  "import-target-semantic-atom",
  target_semantic_atom_body
)
```

`effect_index` is a zero-based contiguous index within one operation member,
so one envelope may emit multiple independently mapped semantic atoms without
collapsing them. The set digest is
`D("import-emission-set", target_emission_set_body)`. The set is an exact
bijection with the mapped source atoms. Every mapped source atom occurs once,
every target atom has one source atom, and no excluded, provenance-only, or
blocking atom appears. Recomputing target atoms from the complete stored member
envelopes must reproduce every target atom digest and no extra user-state atom.
The plan carries both bodies and digests. The fixed-size execution receipt
commits their digests and the plan storage root. Verification streams the plan
chunks and recomputes both sets before accepting the receipt.

Every non-mapped entry carries this complete receipt:

```text
source_disposition_evidence_body = {
  import_id,
  import_source_digest,
  mapping_registry_version,
  source_registry_key,
  source_primary_key,
  reason_code,
  evidence_kind:
    "source_provenance_object" |
    "owner_exclusion_receipt" |
    "identity_disposition",
  evidence_object_kind,
  evidence_object_digest
}

source_evidence_digest = D(
  "import-source-disposition-evidence",
  source_disposition_evidence_body
)

disposition_receipt_body = {
  import_id,
  source_registry_key,
  source_primary_key,
  disposition: "provenance_only" | "excluded" | "blocking",
  reason_code:
    "registered_provenance_only" |
    "owner_authorized_exclusion" |
    "unsupported_required_identity" |
    "invalid_source_identity",
  source_disposition_evidence_body,
  source_evidence_digest,
  target_provenance_content_digest,
  target_provenance_storage_root_digest,
  target_provenance_byte_length,
  owner_exclusion_receipt_digest
}

disposition_receipt_digest = D(
  "import-disposition",
  disposition_receipt_body
)
```

The evidence body's import, source, registry, identity, and reason fields equal
the enclosing plan and disposition receipt byte for byte. For
`registered_provenance_only`, `evidence_kind` is
`source_provenance_object`; `evidence_object_kind` is one exact kind from
`source_provenance_object_set_body`; and `evidence_object_digest` equals the
source digest of the one matching provenance mapping. For
`owner_authorized_exclusion`, `evidence_kind` is
`owner_exclusion_receipt`; `evidence_object_kind` is the exact literal
`owner_exclusion_receipt`; and `evidence_object_digest` equals
`owner_exclusion_receipt_digest`. For either blocking reason,
`evidence_kind` is `identity_disposition` and both evidence-object fields are
required null. No other discriminator combination is valid. The complete
evidence body is embedded in the chunked import plan, and its non-null digest
always recomputes through the registered domain above.

The first two reason codes pair only with their matching disposition. The
three target-provenance fields are required only for `provenance_only` and name
one exact `import_provenance_evidence` content digest, storage-root digest, and
canonical byte length in `source_provenance_mappings`. They are all null for
every other disposition. `owner_exclusion_receipt_digest` is non-null exactly
for `excluded` and required null for `provenance_only` and `blocking`.
`blocking` uses one of the final two reasons and cannot appear in a successful
execution receipt. Every receipt's source fields match its mapping, and the
target-authority signature over the execution receipt authorizes the complete
set.

`source_provenance_mappings` contains closed
`{ object_kind, source_digest, target_content_digest,
target_storage_root_digest, canonical_byte_length }` entries sorted by object
kind, decoded source digest, then canonical byte length. It preserves source
actor certificates, authority history, operation segments, quarantined
evidence, clocks, receipts, and conflicts as immutable provenance even though
those objects do not gain target-library authority. Before planning, the
importer streams and verifies each exact source object's canonical bytes,
computes `target_content_digest = DB("blob-content", bytes)`, and stores those
bytes through one generic chunked-object root with
`artifact_kind: "import_provenance_evidence"`. The mapping's storage-root
digest and canonical byte length equal that verified root. The root and every
chunk are durable and read back before the plan is committed.

The plan carries this array and the execution receipt commits the plan root,
generated-provenance-set digest, and independently recomputed
source-provenance-set digest. The mappings are an exact bijection with the
separately authenticated source provenance object set whose digest is named by
`import_source_body`: every source entry has one mapping with the same kind,
source digest, and byte length; every target root reconstructs exactly that
source object's canonical bytes; target content identities are unique unless
the complete canonical bytes are equal; and no mapping lacks a source entry.
Every provenance-only disposition receipt names the exact target triple of one
mapping whose source evidence it preserves.
`emitted_transaction_set_body.transaction_digests` remains in committed target
order and equals the transaction-plan digest projection byte for byte.
Disposition counts are a source-registry-key-sorted set of closed
`{ key, count }` entries.

The immutable `C(import_plan_body)` bytes use the generic chunked-object
contract with `artifact_kind: "import_plan"`. The storage root is durable and
read back before mutation.

`generated_provenance_set_body` is derived only after the plan digest is known.
`import_plan_chunk_entries` is byte-identical to the verified import-plan root
body's `chunks` array and remains in contiguous root index order.
The three source logical-checkpoint fields equal the exact triple in
`import_source_body` and the authenticated backup manifest. The named root has
artifact kind `checkpoint`, reconstructs the source checkpoint's canonical
bytes, and names its complete chunk set.
`target_provenance_objects` is byte-identical to
`source_provenance_mappings`, including every target content digest,
storage-root digest, and canonical byte length. Each target root has artifact
kind `import_provenance_evidence`, reconstructs the exact verified source
object bytes, and names a complete chunk set. An omitted, extra, substituted,
or unreadable target provenance root invalidates the generated set and the
execution receipt.
`target_media_vault_restore_plan_chunk_entries` has the same rule for the media
plan. Neither array is re-sorted by digest. The target candidate checkpoint
digest, storage-root digest, and byte length name the exact chunked checkpoint
object committed by the execution receipt and genesis closure. Its verified
root names the complete checkpoint chunk set. Every logical checkpoint and
portable backup that retains the import receipt retains that historical
target checkpoint root and chunks, the source checkpoint root and chunks, both
plan storage roots, every named plan chunk, and every target-provenance root
and chunk.
Each chunk fits the backup file bound independently, so a legal imported
library cannot become unbackuppable merely because its complete plan exceeds
one backup file. Compaction cannot leave an import receipt with a dangling
historical checkpoint, plan root, target-provenance root, or chunk. Chunk
indexes are unique and contiguous within each named array. It also cannot drop
the source checkpoint root or any of its chunks while the import receipt
remains reachable.
`generated_provenance_set_digest` commits the complete body. The body is
recomputed from verified roots rather than embedded in the fixed-size receipt.

Any `blocking` identity disposition aborts before the first target mutation and
prevents a successful execution or final import receipt. Enumeration is not
permission to skip a blocked identity.

`blob_mappings` contains closed
`{ source_content_digest, target_content_digest, byte_length }` entries sorted
by decoded source digest. It is an exact bijection over
the separately authenticated reachable-blob-set body whose digest is named by
`import_source_body`: every source digest and byte length has exactly one
mapping, no mapping lacks a source member, and source digests are unique. V1
performs no content transformation, so
`target_content_digest` equals `source_content_digest` byte for byte and the
length is identical. A different target digest is invalid.

Before any dependent target operation commits, import streams the authenticated
source bytes, recomputes their length and `DB("blob-content", bytes)`, writes
them to the target content-addressed namespace, reads them back, and recomputes
the same values. Multiple logical, quarantined, provenance, operation, and
media-vault references share this one durable target object. The target
media-vault plan uses the same mapping for an equal content digest rather than
copying another payload.

`target_reachable_blob_set_digest` in the execution receipt recomputes the one
global no-extra reachable set defined above: all mapped target library blobs,
including bytes reachable only from quarantined, opaque, incomplete, unapplied,
or provenance operations, plus included media-vault files. Plan roots and
chunk payloads are not library blobs and never enter
`reachable_blob_set_body.blobs`. They remain pinned through the separately
committed generated-provenance set, receipt, historical checkpoint, and proof
closure. Roots and chunks are durable before the first dependent commit and
through checkpoint, genesis closure, activation, and later compaction rules.
An omitted, extra, unreadable, or digest-mismatched root or chunk still blocks
the execution receipt through that provenance contract.

`transaction_plan` contains closed
`{ transaction_id, source_mapping_indexes, semantic_atom_effects,
member_envelopes, transaction_body, transaction_digest }` entries in target
commit order.
`member_envelopes` contains each complete final signed target operation
envelope, including payload, blob references, HLC, causal frontier, sequence,
previous actor link, chain digest, creation time, and signature. The transaction
body is the complete ordered aggregate that derives the transaction digest.
Canonicalizing each stored envelope and transaction body reproduces the exact
bytes and digests committed on every retry. Source mapping indexes and member
arrays are contiguous and remain in member order.
`semantic_atom_effects` contains one member-index-aligned array of closed
`{ source_atom_digest, effect_index }` entries. Effect indexes are contiguous
within each member. Their union across the plan equals the emission set's
source digests exactly once. Recomputing target semantic atoms from each member
and effect index equals the corresponding emission entry.
In v1, `target_actor_starting_tip` is exactly the import actor's enrollment
chain genesis with sequence zero, null operation ID, and the chain digest
derived from its staged enrollment certificate. A positive tip or any
pre-import target operation is invalid because the target library must be
fresh and unexposed. A future protocol that permits bootstrap transactions must
name and bind them explicitly before it may relax this rule.

The plan and execution receipt carry byte-identical
`target_authority_public_key`, `target_actor_enrollment_certificate`, and
starting-tip values. The authority key ID and enrollment-certificate digest
recompute from those exact bytes. The genesis closure contains that complete
enrollment certificate, and the transition target actor census names its exact
actor ID and certificate digest. Any missing, extra, or substituted actor or
key invalidates the candidate before genesis authorization.

Before the first target mutation, one local authority transaction stores the
immutable plan under `(import_id, import_source_digest)`, verifies every
complete envelope, signature, actor link, transaction aggregate, ID, and
digest, and installs a durable import-exclusive writer barrier over the fresh,
unexposed target library and its import actor. That transaction records the
exact planned ending tip. Until import completes or is explicitly abandoned,
ordinary allocation, enrollment, retirement, publication, and user access for
that target library fail closed. Crash recovery restores the barrier before
opening the target store. Random target IDs and every final signed byte are
generated once before this transaction and never regenerated on resume. Each
bounded batch commits the next stored canonical envelopes verbatim, advances
the actor tip to their exact planned ending tip, and records its plan cursor in
the same transaction. Every batch and the final receipt must match the stored
plan byte for byte. Reusing `import_id` with another source or plan fails before
mutation. A crash after any batch therefore resumes the same members instead
of duplicating or forking the import. This durable, unreachable staging actor
is the sole v1 exception to ordinary in-transaction actor-sequence allocation.

`target_actor_ending_tip` in the execution receipt equals the final planned and
committed actor tip. Its target manifest digest and generation name the exact
verified but not yet authorized genesis manifest body.

Completion first verifies the final plan cursor, actor ending tip, materialized
digest, checkpoint, complete target blob roots, execution receipt and
signature, target media-vault plan, and target manifest body. One durable local
authority transaction then stores that immutable execution receipt and changes
the phase to `genesis_authorization_required`. Only after that commit does the
target authority derive and persist the exact transition certificate,
key-possession proof, genesis-manifest signature, and authentication object.

Cloud mode publishes the one create-if-absent candidate and reads back the exact
genesis authority tuple, resolving response loss before proceeding. Local-only
mode prepares the same verified genesis objects but records that no cloud tuple
exists. The implementation then constructs and signs the final import receipt
from the immutable execution receipt and actual transition, manifest-auth, and
publication result. For `cloud_confirmed`, `published_cloud_authority` is the
complete read-back compound tuple and names the exact transition, manifest,
authentication, and generation. For `local_only`, it is null.

The writer then builds the required post-genesis `accepted_authority`
checkpoint. It preserves the candidate checkpoint as receipt-bound provenance,
anchors the accepted genesis transition and generation-zero manifest, and
includes the complete signed execution and final receipts. A next-generation
manifest names this accepted checkpoint. Cloud mode publishes that manifest by
compare-and-swap against the exact read-back genesis tuple and reads back the
winner. Local-only mode commits the equivalent next-generation authority
objects locally. Response loss retries the same bytes and operation ID.

One final local authority transaction stores the signed final receipt,
candidate and accepted checkpoints, ending tip, exact next-generation
publication state, active library-control record, verified target media-vault
pointer and generation, and released barriers together. The active
library-control record names the accepted checkpoint and next-generation
manifest, never the candidate checkpoint. User access, backup, sync,
compaction, and ordinary actor allocation become possible only after that
transaction commits. After a confirmed cloud genesis win, any crash or local
validation failure retries this exact completion path and cannot return to
abandonment.

Abandonment is an irreversible authority operation:

```text
import_abandon_body = {
  import_id,
  import_source_digest,
  import_plan_digest,
  target_library_id,
  target_epoch_id,
  target_authority_public_key,
  target_authority_key_id,
  last_committed_plan_cursor,
  abandonment_phase: "pre_genesis_authorization",
  reason_code
}

import_abandon_digest = D("import-abandon", import_abandon_body)

import_abandon_signature = S(
  "import-abandon-authority",
  target_authority_private_key,
  { import_abandon_digest }
)
```

Abandonment is legal only in `pre_genesis_authorization`. In that phase no
genesis transition certificate, `genesis_self_authorization`,
`target_authority_proof`, genesis-manifest authority signature,
manifest-authentication object, or complete cloud create-if-absent candidate
has been produced or uploaded. The implementation checks the remote library ID
is still absent and proves the local staging record has never crossed that
phase boundary.

Before destruction, the complete signed abandonment receipt is written to
non-authoritative audit storage and read back. The implementation then
recomputes `target_authority_key_id` from the retained public key and verifies
the signature against that key. It then
zeroizes and deletes the target authority and actor private keys, immutable
plan, unused signed envelopes, partial store, blobs, local publication state,
and barrier state, and marks the target library and epoch IDs permanently
abandoned in that audit registry. Because no cloud genesis record was ever
installed, no replayable genesis authorization was emitted, and the signing
keys no longer exist, no partial or presigned target operation can later gain
authority.

After the complete import execution receipt, target closure, and target
manifest body verify, the durable phase transaction described above ends
abandonment authority. From that moment key deletion is forbidden, even before
the remote tuple exists. The operation must keep retrying the same
create-if-absent bytes, resolve response loss by readback, construct the final
receipt from the actual result, and complete local activation. A future
protocol may add an authenticated remote reservation and terminal tombstone,
but v1 has no local-only escape hatch after emitting replayable self-authority.

The new library generates a fresh authority key, library ID, epoch ID,
installation ID, actor key, and actor enrollment. Source rows, explicit nulls,
relationships, tombstones, blob roots, and accepted user-visible state become
fresh target-library operations signed by that actor. Source operation IDs,
actor IDs, actor certificates, HLC stamps, chain digests, and receipts remain
provenance and are never accepted as target operations or authority. A mapping
or disposition exists for every checkpoint identity and provenance object.
Desktop and every writable PWA adapter verify the same source digest, mapping
set, target materialized digest, and receipt before reporting success.

Import is an operation batch keyed by `(import_id, import_source_digest)` with
per-source-item identity. It stages and validates input before mutation.
Progress and the user-visible imported count include committed operations only,
not parsed files. Secondary attachment or cache work enters a repairable queue.
Restarting after any interruption produces the same state and receipt.

Parsing, ID lookup, row enumeration, blob copy, and archive emission remain
bounded from source through sink. Import stages at most 500 records or 4 MiB
per batch. Export and backup enumerate at most 100 rows or 4 MiB per batch from
one pinned checkpoint. JavaScript never holds every ID, row, blob, or the
complete import plan, output archive, or Blob. Plan construction, canonical
hashing, persistence, and replay stream bounded transaction entries to durable
storage. A restart resumes from the checkpoint-bound cursor and committed
receipt.

## Duplicate identity

Storage migration does not perform destructive deduplication.

Suspected duplicates become reversible edges:

```text
duplicate_edge(
  left_entity_id,
  right_entity_id,
  reason,
  evidence_digest,
  decision,
  decided_by_operation_id
)
```

A canonical alias may redirect queries while both source records remain
recoverable. Destructive consolidation requires an explicit reviewed operation
with a receipt and undo data.

## Memory and performance budgets

These are initial architecture gates, not claims about the current build. A
measurement is valid only with exact build, workload, source epoch, process
generation, and fixture identity.

`startup peak`, `settled total`, and `provider extraction peak` below refer to
the attributed Freed process-tree total. The renderer, native, worker, and
SQLite cache columns are component limits. A measurement must state its memory
source and shared-page treatment, and must not add overlapping process
generations.

### Resident memory

| host RAM       | startup peak | settled total | main renderer |  native | library worker after settle | provider extraction peak |
| -------------- | -----------: | ------------: | ------------: | ------: | --------------------------: | -----------------------: |
| 4 GiB          |    1,024 MiB |       768 MiB |       384 MiB | 192 MiB |        32 MiB or terminated |                1,280 MiB |
| 8 GiB          |    1,280 MiB |     1,024 MiB |       512 MiB | 256 MiB |        32 MiB or terminated |                1,792 MiB |
| 16 GiB or more |    1,536 MiB |     1,280 MiB |       640 MiB | 320 MiB |        32 MiB or terminated |                2,304 MiB |

Before settlement, a temporary library worker may use up to 192 MiB, 256 MiB,
or 384 MiB for the three tiers. It must return to 32 MiB or terminate within
30 seconds of quiescence. SQLite cache budgets are 32 MiB, 64 MiB, and 128 MiB.

The one-time legacy migration has no source-sized memory exception. Its
external-memory Automerge decoder streams the immutable source into bounded
change, object, and index runs on private staging storage. It may not call
`Automerge.load`, retain the complete change graph, or allocate a buffer
proportional to source byte length. Decode, canonical ordering, target
construction, and verification use external merge with fixed-size pages and
restartable cursors.

An external row consumer receives only the payload range named by its current
verified row. It cannot seek elsewhere in the companion spool. Payload bytes
cross that boundary through a fixed 64 KiB buffer into an uncommitted target
transaction. The complete spool receipt is verified again after consumption,
and the target transaction commits only after that final verification
succeeds.

Verified change and operation rows enter private scratch SQLite transactions.
The stage stores the verified bounded actor and head catalog, then every
change, operation, dependency, successor, scalar descriptor, and payload byte
with its exact source and run receipt. It preserves unsigned Automerge counters
as fixed-width big-endian bytes instead of narrowing them into signed SQLite
integers. Large payloads enter preallocated SQLite blobs through the same fixed
transfer buffer. The stage verifies its exact schema catalog before use and
commits nothing unless the complete row and companion-spool verification
succeeds. Foreign keys bind every change to its actor, every dependency to a
staged change, and every operation object and element key to an exact staged
operation ID. Automerge document chunks intentionally omit delete rows and
encode those operation IDs only as successors. Each successor therefore
resolves either to one exact staged operation or one reconstructed omitted
delete identity. Every predecessor for one omitted delete must name the same
object and effective property or list-element target. Explicit delete rows,
non-Lamport successor edges, explicit successors attached to another target,
and unequal targets for one omitted delete fail closed. Every staged head must
resolve to a staged change before the change receipt is accepted. Exact retry
returns the stored receipt only while the layout, receipted row, relationship,
payload, and graph-closure checks remain complete. A changed source, changed
layout entry, changed summary, dangling reference, incomplete stage, mixed
change and operation source identity, or schema drift fails closed.

The complete scratch graph receives one seal only after actor indexes and head
indexes are dense, each actor's change sequence is contiguous, maximum
operation counters never regress, and the union of stored operation IDs and
reconstructed omitted-delete IDs exactly covers counters one through the final
change maximum without a gap. One canonical SHA-256 projection covers the
source and row receipts, actor and head catalogs, every change, stored
operation, and omitted-delete descriptor, every dependency and successor, and
every payload byte streamed from SQLite through a fixed 64 KiB buffer. Exact
seal retry recomputes the projection. Same-count metadata or payload tampering,
counter gaps, incomplete actor intervals, and receipt drift fail closed.

After graph sealing, one separate immutable receipt selects every visible
non-increment operation whose successors are all explicit increments.
Increment rows do not become independently visible, and their edges do not
hide the counter value they adjust. Omitted delete identities never become
visible value rows. Their edges, and every explicit non-increment successor,
remove the superseded predecessor from this current set. Concurrent visible
operations all remain present. This stage does not apply counter arithmetic,
choose a conflict winner, order sequence elements, reconstruct objects, or
claim a registered materialized entity. Its digest binds the exact sealed
graph, every selected operation descriptor, and every selected payload byte.
Exact retry recomputes both the selection and digest. A missing, extra,
changed, or pre-seal row fails closed.

One later immutable resolved-value receipt retains every current conflict and
marks exactly one winner for each effective map property or list element.
Winner order is Automerge Lamport order: the unsigned operation counter first,
then the actor bytes in binary lexical order. Insert operations target their
own operation ID, while later sequence updates target that inserted element
ID. Winner selection runs as one SQLite window operation with temporary data
forced to disk. It must not execute one complete conflict scan per current
operation.

Counter increment operations never become visible values. Each increment must
be an explicit successor of at least one counter base, must contain one
canonical signed or unsigned integer, and adjusts every current counter base
it names. Orphan increments, increments attached to a non-counter,
malformed integer text, unsigned values above the signed projection range, and
arithmetic overflow fail closed. Counter bases are processed through fixed
pages. Exact replay recomputes winner membership and counter values, then binds
every resolved row, descriptor, and payload byte to the sealed graph and
current-operation receipts. This stage still does not order list elements,
reconstruct objects, select registered entities, open a production database,
or activate SQLite.

One later immutable sequence receipt orders every insertion in each list or
text object with Automerge's reference traversal. Children of one anchor are
visited in descending Lamport order, and each child's descendants are visited
before the next sibling. Deleted insertions remain anchors in this ordering
graph even though their resolved values are absent. This preserves the
positions of visible descendants without resurrecting deleted values.

The traversal pages sequence objects and uses a temporary SQLite stack rather
than a source-sized Rust collection or recursive call stack. Every insertion
must target a list or text object. A non-head anchor must resolve to an earlier
insertion in the same object. Cross-object anchors, non-sequence parents,
missing or duplicate insertion rows, ordinal gaps, and changed replay results
fail closed. Exact replay recomputes the full order and binds every object,
ordinal, and insertion operation to the sealed graph and resolved-value
receipt. This stage still does not reconstruct objects, select registered
entities, open a production database, or activate SQLite.

One later immutable FeedItem topology receipt selects exactly one winning
root `feedItems` map and admits only map-valued entity entries with nonempty
bounded IDs. It reconstructs each entity's complete winning map and sequence
node graph in temporary SQLite. Every node records its entity, exact parent,
depth, property name or visible sequence ordinal, and winning value operation.
Deleted entities omit descendants that remain independently current in the
Automerge graph. Deleted sequence anchors remain in the earlier ordering graph,
but do not receive materialized nodes, and visible elements are renumbered
densely.

The topology walk is iterative and disk-backed. It admits at most 128 nested
object levels. A shared value node, malformed map or sequence child, scalar
parent with children, non-map entity, missing parent, cross-entity parent,
depth overflow, changed payload, or stored topology drift fails closed. Exact
replay rebuilds the expected temporary topology and binds every entity and
node to the sealed graph, resolved-value, and sequence receipts. This stage
still does not serialize complete FeedItems, populate a published generation,
open a production database, or activate SQLite.

The following immutable FeedItem document receipt reconstructs each admitted
entity from that topology. Map keys use binary order, lists use their visible
sequence ordinals, text concatenates only ordered string payloads, and scalar
values retain their exact JSON-compatible Automerge meaning. One document is
limited to 4 MiB. Integers outside JavaScript's safe range, bytes, unknown
scalar extensions, malformed text values, and an embedded `globalId` that
differs from the owning `feedItems` key fail closed. The existing canonical
`__nonFinite` escape preserves NaN and infinities without turning them into
null. Negative zero fails closed because JSON would silently rewrite it as
positive zero. A user property named `__nonFinite` also fails closed at this
stage, which makes the escape unambiguous instead of silently reinterpreting
user data.

Temporary node JSON remains in SQLite. Native code holds at most one bounded
output plus one bounded child or scalar payload while assembling a document,
so neither the document set nor the source graph becomes a Rust allocation.
The durable document set records each entity's exact JSON bytes, byte length,
and SHA-256 digest. Its receipt binds the complete set to the FeedItem topology
receipt and exact replay rebuilds and compares every row. This stage still
does not project FeedItem columns, publish a generation, open a production
database, or activate SQLite.

The next immutable FeedItem projection receipt converts those exact documents
into the same lossless row shape used by the native shadow store. It reads and
projects one document at a time. Native memory therefore holds one bounded
document tree and one bounded projected row rather than a corpus-sized
collection. Strings and booleans enter their typed columns only without
coercion. Numeric columns admit only JavaScript-safe integers because the
canonical SQLite columns are `INTEGER`. Fractional, unsafe, nonfinite, and
wrong-type values keep a null typed column and survive under the exact `__raw`
escape. Missing fields remain distinct from present nulls through `__absent`.
Unknown root, author, and user-state fields remain in `rest`; full content and
preserved content remain in their dedicated JSON columns. Every JSON object in
those columns uses recursive UTF-8 key order in both Rust and TypeScript.
Reserved nonfinite-tag collisions and invalid Unicode fail closed, so semantic
equivalence cannot conceal adapter-specific row bytes. Negative zero also
fails closed because JSON cannot preserve its sign.

The scratch schema stores every projected column, its derived sort key, and
the source entity operation. One canonical digest covers the exact typed row
sequence, and the receipt binds that digest and count to the complete FeedItem
document receipt. Replay reprojects every document and compares the complete
row set before accepting the stored receipt. An identity mismatch, malformed
document, reserved escape collision, partial row set, changed column, changed
sort key, foreign-key error, or changed receipt fails closed. This stage still
does not populate an immutable published generation, open a production
database, register a command, contact a provider, change the active writer, or
activate SQLite.

The dormant population bridge opens one transaction-pinned, receipt-verified
snapshot of those scratch rows and copies them into one fresh derived
generation. It retains at most one page of 1,000 rows and one 4 MiB source
document plus 64 KiB of projection metadata. Every page digest binds the
complete scratch receipt, source operation indexes, and exact projected row
bytes. The destination commits each page through the existing rebuild receipt.
A response-loss retry derives its source cursor from the durable projected-row
count and continues without reapplying earlier rows. Source tampering,
receipt drift, an oversized row, a changed rebuild identity, or an incomplete
page fails closed. The bridge does not publish or select the completed file,
register a command, contact a provider, change the active writer, or activate
SQLite.

The migration worker's attributed resident ceiling is 384 MiB on a 4 GiB host,
512 MiB on an 8 GiB host, and 768 MiB on a host with 16 GiB or more. Admission
proves enough private staging capacity for the measured source, target,
external-sort runs, and rollback margin before decode begins. Insufficient
memory or storage leaves Automerge authoritative and reports a typed blocked
result. It never weakens the ordinary startup budget or asks every low-memory
client to repeat the decode. After cutover, those clients initialize from
bounded checkpoint and segment streams.

For a six-hour idle generation, median memory slope is at most 8 MiB per hour
and net growth is at most 64 MiB. After a bounded heavy operation, the app is
usable within 10 seconds and returns to its prior settled total plus 128 MiB
within 60 seconds.

### Query and ingest

With 25,000 representative items:

| operation                                   | budget |
| ------------------------------------------- | -----: |
| Warm page query p95                         |  50 ms |
| Cold page query p95                         | 150 ms |
| Navigation counts p95                       | 100 ms |
| Search p95                                  | 150 ms |
| Commit and materialize 1,000 captured items | 500 ms |

No budget permits an unbounded renderer result. Larger corpus checks run at
100,000 items in the dedicated performance lane.

## Blocking proof

The universal blocking set for Library Core contains only contracts whose
failure can lose data, split authority, corrupt convergence, or make a release
unusable:

1. Cross-runtime canonical vectors cover empty and nested objects, Unicode,
   every safe-integer boundary, registered fractional wrappers, exact set
   ordering, every domain used by the gate, and independently generated
   Ed25519 signatures. Rejection vectors cover duplicate names, noncanonical
   bytes, invalid Unicode, negative zero, fractions outside a registered
   wrapper, unsafe and nonfinite numbers, unknown outer fields, invalid lengths,
   alternate hex case, malformed or noncanonical public keys, `R`, or `S`, bad
   signatures, and domain substitution. Public backup vectors fix Argon2id
   output, key wrapping, file AEAD, signed manifest, delegation, bundle, and
   recovery-transition bytes. Desktop-created fixtures materialize through
   IndexedDB and round-trip through adapter-neutral checkpoint pages. Desktop
   and PWA must reject the same invalid bytes. Using the same body under two
   domain labels must produce different digests and signatures.
2. The executable field registry is compile-time exhaustive against every raw
   root and leaf, every public store read or mutation method, every operation
   payload, backup and export behavior, and every local authority. An unknown
   current field blocks cutover.
3. Mutation crash recovery at every commit boundary on every writable adapter:
   Desktop SQLite for canonical mutations and IndexedDB for PWA intents. Each
   fixture reopens before acknowledgment and proves operation or intent, rows,
   tombstones, actor state, cursor, receipt, and outbox are all committed or
   all absent. A future SQLite WASM adapter earns separate crash evidence.
4. Actor enrollment and signature rejection, sequence and chain fork detection,
   deterministic fork-repair convergence, and actor retirement.
5. Incomplete, duplicated, reordered, and digest-mismatched transaction-member
   delivery without partial materialization or frontier advancement.
6. Candidate-claim races, cloud expiry, local non-expiry, renewal, revision-cap
   abandonment, response loss before and after time admission, signed
   abandonment, distributed cleanup, candidate registration under a renewal,
   fence acquire and release response loss, key-loss recovery with an active
   lifecycle pointer, interrupted migration resume, changed-source rejection,
   source admission fencing, and exact final receipt validation run on the
   elected capable migration authority against the private corpus. Fault
   injection proves no decode, fence, or target commit occurs under an absent,
   stale, mismatched, or unverifiable claim. Every supported Desktop and PWA
   adapter independently
   proves the complete public migration fixture, streaming checkpoint bootstrap,
   operation-segment continuation, and its own fenced device-local source
   contribution. Adapter-local fixtures cover composite installation and source
   identity, bounded native and both registered Cache API reader manifests,
   resolved, ambiguous, and unresolved reader identity, duplicate content under
   different entities, invalid paths, exact manifest summary counts and byte
   lengths, mutation after capture, and claim-bound contribution and fence
   rejection for a different manifest or fencing generation. Shared
   cross-adapter vectors prove the same canonical parser and digest contract;
   adapter-specific vectors preserve each physical namespace rather than
   pretending unlike native and Cache sources have byte-identical manifests.
   Fixtures also cover
   cache namespace and key collisions, multiple reader-content sources, a
   second unreconciled media vault blocking cutover, registered fractions,
   unknown roots and fields, partial
   Person and Account targets, duplicate unkeyed list occurrences, malformed
   parallel media arrays, dynamic-map removal, sanitized cache-key collisions,
   Cache API or native reader content, permanent media-vault manifests and
   files, opaque evidence, and device-local exclusions. A low-memory adapter is
   never required to decode the owner's private Automerge corpus merely to prove
   compatibility. Fault injection also covers both serializations of a stale
   fence acquire racing source revocation. Neither ordering may leave an
   authoritative stale fence. An unreachable source leaves the abandonment
   current and the cleanup registry empty; reconnect completes revocation,
   cleanup-proof readback, and registration without changing the abandonment.
   Candidate-absent vectors crash, expire, cancel, and lose responses after
   claim publication but before registration. They cover both serializations of
   registration versus abandonment, repeated registration grant consumption,
   exact absent-state cleanup retry and readback, successor-claim admission,
   backup and genesis closure, and recovery without invented garbage
   collection. No non-registration grant is admitted while candidate absence is
   current, and every state-dependent nullability rule is enforced.
   Source and target fence fixtures prove that only token digests enter
   portable evidence, a wrong private token cannot release or abort, and exact
   retry after response loss can still complete from protected operation state.
   Disposition fixtures crash before receipt durability, between signed receipt
   and physical action, and between physical action and set insertion. They
   prove that no destructive action precedes authorization and that deleted
   payload omission requires both the exact signed receipt and the signed
   cleanup or recovery-GC aggregate. Active-claim recovery fixtures use the
   recovery-supersession selector, never fabricate an abandonment digest, and
   register optional post-transition GC without reopening candidate authority.
   Cloud source-commit fixtures pause across the remaining store-time allowance,
   restart without the live attempt handle, substitute a caller-supplied
   process generation, synthesize a serialized-equal attempt after restart, and
   race claim renewal or abandonment. They cover contribution, reservation, and
   activation, plus local and non-source nullability. Each late commit remains
   non-authoritative and requires a fresh operation ID and grant. Grant vectors
   reject issue time after consumption,
   issue samples older than 60,000 milliseconds, consumption exactly at either
   expiry, and every unequal nullability combination. They cover every closed
   operation payload and prove the payload, grant, consumption, source
   admission, wrapper, cutover certificate, and later manifest-authentication
   dependency graph is acyclic.
   Missing, truncated, extra, reordered, or digest-mismatched cleanup-proof
   dependencies reject cleanup, backup, and genesis closure. A forged local
   contribution, a contributor certificate without proof of possession, or a
   contribution signed by a different enrolled source actor is rejected.
   Reader fixtures reject a mapped target blob whose streamed digest or length
   differs from the source entry, preserve ambiguous and unresolved entries as
   opaque evidence, and keep an unbound Cache request opaque. Cache locator
   vectors distinguish method, ordered headers, request-body digest and length,
   response `Vary`, namespace, and URL without collision. Manifest construction
   proves byte-identical output under bounded descriptor pages and external
   merge on an input larger than the resident-memory limit. Operation-ID and
   source build identity vectors cover every accepted boundary and reject
   alternate encodings. Current and historical ordinary-abandonment pointers
   require their complete lifecycle, cleanup, checkpoint, root, and chunk
   closure in genesis and portable backup verification. A lifecycle consumed by
   same-library recovery instead requires its exact signed
   `migration_recovery_supersession` closure and only cleanup that actually
   registered; it never invents an abandonment cleanup that could not exist.
7. Future-clock quarantine plus authority-certified clock-repair convergence.
8. Competing global epoch transitions, same-epoch manifest races, exact compound
   authority-state compare-and-swap, remote genesis closure readback, every
   prepare, publish, and commit crash boundary, locally acknowledged writes
   racing final preparation, durable source and local authority fences,
   lost compare-and-swap response resolution, downgrade and sibling rejection,
   stale-writer fencing, and old-epoch namespace isolation.
9. Cutover, rollback, concurrent restore, one-use authority recovery,
   bidirectional adapter-neutral backup restore, backup authentication failure,
   key rotation, and receipt validation. Migration and rollback fixtures build
   corpus-sized prepared proofs before fences, then finalize only an
   activation-evidence sidecar. They cover zero and 65 fences, rejection at 66,
   the exact 2,097,152-byte boundary and first byte over it, multi-node
   activation sets, missing and extra activations, wrong prepared-proof
   binding, all finalization crash boundaries, deadline release, one atomic
   bundle write, ambiguous-response readback, and prohibition of corpus work or
   genesis-closure mutation inside the fence window. Rollback vectors use the
   rollback reservation and activation schemas and reject every migration-claim
   field.
10. Duplicate operation and response-loss replay.
11. Provider-intent claim races, response loss, unknown-outcome settlement,
    receipt replay, and claim expiry prove that no second provider side effect
    is authorized while an earlier outcome is unknown.
12. Two-device offline conflict convergence through authenticated manifest CAS
    conflicts, branch-qualified acknowledgment, and safe compaction.
13. Schema migration and database-plus-blob snapshot atomicity, including every
    local and replicated blob crash, missing, corruption, and garbage-collection
    boundary.
14. Import interruption and idempotent resume.
15. Bounded query enforcement and 4 GiB startup memory admission independently
    on Desktop and every supported writable PWA adapter and browser for an
    activated Library Core release.
16. On a corpus larger than the legacy 2,500-item hydration cap, records placed
    beyond that cap remain discoverable and actionable through saved, archive,
    search, tags, Friends, Map, Story Wall, provider settings, navigation
    existence, exact counts, and bulk mutations. Receipts and facets include
    those records. This proof passes independently on Desktop and every
    supported PWA adapter and browser. A current query kind cannot become
    unsupported or reduced merely to pass activation. De-support requires an
    explicit product decision before cutover.

Large permutation fuzzing, the private production corpus, 100,000-item
performance, prolonged memory slope, and compatibility matrix sweeps remain
required evidence, but run in nightly, dedicated migration, or soak lanes.
They do not make every feature PR or release rebuild the universe.

## Release activation inspection

The checked-in
`docs/library-core-activation-manifest.json` file is the sole source of release
activation declarations:

```text
{
  schemaVersion: 1,
  transitions: [{
    activationId,
    gate: "C" | "D" | "E" | "F" | "G" | "H",
    kind,
    rollbackTrigger,
    receiptExpectations
  }]
}
```

The manifest is append-only. Activation IDs are globally unique. Every prior
entry remains in the same position with the same canonical value. A release
may add at most 64 entries. Deletion, editing, reordering, duplication,
unsupported fields, or a missing current manifest blocks validation. A
previous boundary that predates the manifest is represented explicitly as
`previousPresent: false` and the canonical empty manifest digest. After the
first published release containing the manifest, each later published boundary
has `previousPresent: true`. For `complete_history`, where no previous
published boundary exists, `previousPresent: false` is the required bootstrap
state. When a previous boundary does exist, `previousPresent: false` is valid
only when an exact Git tree lookup at the resolved previous published release
commit proves that the manifest path is absent. A missing object, unresolved or
invalid ref, wrong object kind, permission error, read failure, or any other
failed lookup blocks validation and is never converted into absence. Once any
prior release artifact records Library Core activation evidence, every later
boundary must set `previousPresent: true` and its previous digest must equal
that prior artifact's exact current manifest digest.

Every newly prepared dev or production release carries one closed
`source.libraryCoreActivation` object:

```text
{
  schemaVersion: 1,
  range: {
    channel: "dev" | "production",
    previousPublishedTag,
    startMode:
      "complete_history" |
      "previous_product_commit" |
      "historical_tag_commit",
    fromExclusiveCommitSha,
    toInclusiveProductCommitSha
  },
  manifest: {
    path: "docs/library-core-activation-manifest.json",
    previousPresent,
    previousDigest,
    currentDigest
  },
  transitions: [{
    activationId,
    gate: "C" | "D" | "E" | "F" | "G" | "H",
    kind,
    rollbackTrigger,
    receiptExpectations
  }],
  inspectionDigest,
  decision: {
    state:
      "review_required" |
      "no_activation_declared" |
      "owner_approved",
    ownerApprovalReference,
    approvedInspectionDigest,
    approvedReleaseArtifactDigest
  }
}
```

The range ends at the current release receipt's exact product commit, not the
release-preparation commit. When a previous published release exists, its
artifact is read from the immutable tag commit. A mutable copy in the current
tree has no authority. A modern tagged receipt supplies its exact product
commit and carries no historical receipt fields. A genuinely pre-receipt tag
uses `historical_tag_commit`, null product and promoted-dev fields, and the
exact resolved tag commit. Both the tag commit and selected product boundary
must be ancestors of the current product commit. A first release uses
`complete_history` with null previous fields. Mixed receipt modes, a missing
tag, a malformed immutable artifact, channel drift, or unproven ancestry block
publication.

Preparation and validation independently read the manifest from
`fromExclusiveCommitSha` and `toInclusiveProductCommitSha`. The current file
must exist in the product commit. The exact append-only delta is the only input
to the release transition array. Callers cannot supply, omit, or rewrite
transition declarations. The release array is ASCII-sorted by activation ID
after derivation. An empty delta deterministically produces
`no_activation_declared`. A nonempty delta deterministically starts at
`review_required`.

`kind` is closed by gate:

| gate | allowed transition kinds                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C    | `migration_candidate_claim`, `migration_candidate_execution`, `source_admission_fencing`                                                                                   |
| D    | `sql_read_cutover`, `legacy_worker_eviction`, `renderer_corpus_eviction`                                                                                                   |
| E    | `replication_protocol_activation`                                                                                                                                          |
| F    | `library_core_writer_activation`, `migration_cutover`, `storage_epoch_cutover`, `rollback_execution`, `restore_execution`, `authority_key_rotation`, `recovery_activation` |
| G    | `installed_soak_activation`                                                                                                                                                |
| H    | `legacy_engine_retirement`                                                                                                                                                 |

Each transition has a stable ASCII activation ID, a concrete bounded rollback
trigger, its required primary receipt expectation, and either
`same_frontier_rollback_receipt` or `roll_forward_recovery_receipt`.
Primary expectations are:

| transition kind                   | primary receipt expectation        |
| --------------------------------- | ---------------------------------- |
| `migration_candidate_claim`       | `migration_claim_lifecycle`        |
| `migration_candidate_execution`   | `migration_receipt`                |
| `source_admission_fencing`        | `migration_receipt`                |
| `sql_read_cutover`                | `read_cutover_parity`              |
| `legacy_worker_eviction`          | `read_cutover_parity`              |
| `renderer_corpus_eviction`        | `read_cutover_parity`              |
| `replication_protocol_activation` | `replication_convergence`          |
| `library_core_writer_activation`  | `authority_transition_certificate` |
| `migration_cutover`               | `migration_receipt`                |
| `storage_epoch_cutover`           | `authority_transition_certificate` |
| `rollback_execution`              | `rollback_receipt`                 |
| `restore_execution`               | `restore_receipt`                  |
| `authority_key_rotation`          | `authority_rotation_receipt`       |
| `recovery_activation`             | `recovery_receipt`                 |
| `installed_soak_activation`       | `installed_soak_verdict`           |
| `legacy_engine_retirement`        | `retirement_receipt`               |

Transitions are unique and sorted by activation ID. `inspectionDigest` is
`"sha256:"` plus lowercase SHA-256 of the deterministic ASCII-key-sorted JSON
projection containing schema version, exact range, exact manifest evidence, and
exact derived transition array. Changing the product range, either manifest
digest, or any transition resets a nonempty delta to `review_required`.

`no_activation_declared` is derived, not asserted. It requires an empty
manifest delta and null approval fields. An active transition requires
`owner_approved`, a canonical current-task confirmation reference or legacy
owner GitHub issue-comment URL, an `approvedInspectionDigest` byte-identical to
the current inspection digest, and an `approvedReleaseArtifactDigest`
byte-identical to the current release-artifact proposal digest.

The proposal digest covers the complete canonical release JSON after replacing
only `source.libraryCoreActivation.decision` with one fixed sentinel. This
avoids a circular digest when the decision-only edit records the current-task
confirmation. The ordinary
top-level `approved` field must already be true before the proposal digest can
be computed. Any change to release copy, identity, source range, manifest
evidence, transition, or another non-decision release field changes the
proposal digest. Decision-only edits do not.

For a nonempty delta, the release executor finishes the release copy, sets the
release artifact's ordinary `approved` field to true, and runs the
`--library-core-review-draft` release-identity preflight. That mode admits only
one nonempty `review_required` delta. It validates the rest of the release
identity but cannot admit a no-activation or owner-approved release. The
executor may record an approved current-task confirmation before publication.

When the owner approves the release in the active task, the executor runs
`scripts/library-core-release-activation.mjs approval-intent` for the reviewed
artifact. It writes one private mode `0600` current-task confirmation outside
the repository. The confirmation contains the owner's plain-English decision,
current-task reference, deterministic release task ID, exact canonical intent,
intent digest, approval time, and expiry. The intent binds the release tag,
channel, artifact path, proposal digest, inspection digest, product commit,
manifest digest, and transition-set digest. The executor then runs
`record-owner-approval --owner-confirmation-file=<absolute-path>`. The recorder
validates the private confirmation through the shared current-task owner
confirmation contract and stores only its task ID and SHA-256 digest in the
release artifact. No GitHub comment is required.

This route is cooperative evidence. The private JSON does not authenticate the
owner, so the active task must contain the owner's explicit English decision.
The canonical intent and digests prevent that decision from being reused for a
different release or activation. The older authenticated GitHub comment route
remains readable for existing release artifacts and available as an optional
fallback. Normal release-identity validation remains mandatory before the PR
becomes ready, merges, or publishes a tag.

`review_required`, a stale digest, an invented field, a malformed transition,
an approval on an empty delta, or invalid owner evidence blocks
release identity validation. The owner decision approves inclusion of the
declared transition in that exact product range and release artifact. It does
not install a build, execute the transition, contact a provider, or replace the
separate runtime authority and receipt required by the gate.

Release generation preserves a reviewed decision only when the entire closed
object still validates against the exact range, derived manifest delta, and
release-artifact proposal. The release publisher and tagged workflow both run
the same release-identity validator. Changed-path
validation routes edits to this mechanism through its focused receipt,
activation, and identity contract suite rather than adding another broad
release test lane.

## Activation gates

| gate             | required result                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Contract      | Legacy bootstrap epoch, field algebra, locality, deletion, operation, signed actor, repair, transaction completeness, query, epoch transition, restore authority, blob, and backup registries are exhaustive                                                                                                                                               |
| B. Dormant core  | Desktop and every supported PWA adapter produce identical canonical bytes, actor identifiers, signed actor-enrollment certificates, payload, transaction and chain digests, signed-envelope verification, operation fixtures, logical checkpoint bytes and digests, materialized digests, and bidirectional encrypted backup vectors                       |
| C. Migration     | One elected capable authority completes a resumable, lossless, source-fenced private-corpus migration; every supported adapter proves the same public migration vectors, bounded checkpoint bootstrap, operation continuation, and its own fenced device-local source contribution without requiring a private-corpus Automerge decode                     |
| D. Read cutover  | Every product reader uses bounded queries on Desktop and every supported PWA adapter and browser; current query kinds retain complete semantics beyond 2,500 records; only the isolated migration and replication bridges retain short-lived full-document access until Gate E; legacy corpus can leave the renderer                                       |
| E. Replication   | `op_segments_v1` is the sole replication protocol on every writable supported adapter; offline, duplicate, response-loss, incomplete transaction, missing blob, actor fork, schema, authenticated manifest, bounded segment and blob transfer, and CAS conflict scenarios converge; the legacy full-document replication bridge is disabled or quarantined |
| F. Write cutover | Competing signed transitions select one global winner; crash recovery converges; downgrade, sibling, stale Library Core, and legacy clients cannot produce an accepted active-epoch operation or authenticated manifest                                                                                                                                    |
| G. Soak          | Tier budgets, provider extraction separation, sync, and recovery pass on the installed build                                                                                                                                                                                                                                                               |
| H. Retirement    | Roll-forward recovery is proven and no supported writer requires Automerge                                                                                                                                                                                                                                                                                 |

No gate is satisfied by code presence, an ID-only diff, or a test that skips on
the platform where the behavior actually runs.
