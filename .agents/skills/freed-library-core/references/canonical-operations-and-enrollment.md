# Canonical operations and enrollment

## Keep canonical operation bytes honest

Use the shared cross-runtime vectors for every canonical construction change.
Library Core v1 accepts only null, booleans, Unicode scalar strings, dense
arrays, plain closed records, and safe integers. Reject negative zero,
fractions, unsafe or nonfinite numbers, sparse or decorated arrays, accessors,
symbol keys, non-enumerable fields, non-plain objects, invalid Unicode, cycles,
more than 128 nesting levels, and a direct domain input above 4 MiB including
its prefix. Reject more than 65,536 nodes even when their canonical bytes fit.

Sort object names by UTF-16 code units and do not normalize Unicode. Domain
prefixes include their terminal zero byte. A generic string label is not a
registered digest domain. Desktop and PWA must match the same exact bytes and
digest vectors before either path may construct authoritative operations.
Before constructing or verifying an epoch transition, require the shared and
native canonical codecs to register identical `epoch-transition-certificate`
digest and signature prefixes plus the `authority-key-possession` signature
prefix. Registering these domains grants no authority and does not validate a
transition body, certificate chain, recovery delegation, or cloud compare-and-swap.

The construction encoder is not an inbound verifier. Never verify received
bytes by calling `JSON.parse` or a duplicate-erasing native JSON parser because
duplicate object names have already been erased. Use the shared bounded
duplicate-preserving parser and byte-for-byte canonical comparison first. That
parser establishes only canonical Library Core value bytes. The authoritative
inbound path still needs closed-schema validation, exact digest derivation, and
strict signature verification before materialization.

Reuse the shared protocol scalar predicates for fixed lowercase hexadecimal
values, operation-instance IDs, bounded Unicode-scalar entity IDs, and
nonnegative safe integers. Do not create artifact-specific regex copies or
allocate encoded copies merely to count a bounded entity ID. Scalar syntax does
not prove randomness, cryptographic derivation, authority, or semantic
ownership.

Closing one operation payload or entity-ID schema does not close the operation.
Keep entity existence, touched fields, field algebra, materialization, provider
intent, and runtime authority independently blocked until each has an
executable contract. Every operation without an exact entity-key binding keeps
the typed `entity_id_schema_unresolved` blocker. Bind touched fields by their
exact field-registry keys and keep `touched_fields_unresolved` until the full
set is closed. The initial `feed_item_read_assignment` payload is local
read-state syntax only. Its `readAt` algebra treats absence as unread and
retains the earliest valid assignment under duplicate, reordered, or
concurrent delivery. It never authorizes or schedules a provider-visible seen
action.

Close transaction-member construction one operation at a time. Snapshot a
closed input, enforce the registered payload and entity codecs, bound the
causal frontier before allocation, and derive payload and member digests only
through registered domains. A member-body schema omits chain, transaction, and
signature fields exactly where the protocol says to omit them. It does not
claim transaction completeness, actor-chain validity, signature verification,
materialization, journaling, or runtime authority.

Aggregate a transaction only from closed member constructions. Bound count and
canonical member bytes before returning it. Require one library, epoch, actor,
transaction ID, contiguous member indexes, contiguous actor sequences, unique
operation IDs, and exact previous-operation links. Derive the transaction
digest before actor-chain digests and derive signing-body digests only after
both are fixed. Unsigned construction grants no persistence or authority.

Finalize operation envelopes only from a provenance-branded assembled
transaction. Close public keys as 32-byte lowercase hexadecimal Ed25519 values
and signatures as 64-byte lowercase hexadecimal Ed25519 values. Preflight the
complete canonical envelope budget before invoking the signer, sign only the
domain-separated signing-body digest input, and return no transaction unless
every signature and envelope digest succeeds. Finalization remains construction
only until strict inbound verification, actor enrollment, journaling,
materialization, and replication land independently.

Prove Ed25519 verification across browser and native runtimes with the same
public vector before an envelope verifier can become authoritative. Snapshot
the bounded message bytes before the first asynchronous platform call. Reuse an
audited cryptographic implementation already present in the runtime when it
supports strict Ed25519 verification. Do not add a second elliptic-curve stack,
write custom cryptography, generate keys, or infer actor enrollment from a
syntactically valid public key.

Verify received operations as one complete transaction from canonical bytes,
not independently decoded objects. Snapshot the accepted actor tip first.
Reconstruct the closed member bodies and aggregate transaction, then require
exact actor, epoch, predecessor, sequence, payload, transaction, and actor-chain
derivations before checking every actor signature. Preserve the exact canonical
journal text in the verified result. Causal-tip authority, retry identity,
operation conflicts, and the actor-tip recheck still belong inside the later
authoritative SQLite transaction.

Construct enrollment identity without self-reference. Derive the public-key
fingerprint first, then derive the actor ID from the exact library,
installation incarnation, public key, and random actor nonce, then derive the
closed enrollment-body digest. Reuse the same sorted bounded causal-tip
contract for the observed frontier. Body construction is not proof of key
possession, an authority certificate, committed enrollment, or writer
authority.

Construct an enrollment certificate only from the provenance-branded body.
Sign the exact enrollment-body digest through the actor-proof domain, close and
digest the certificate body, sign that digest through the enrollment-authority
domain, and derive actor-chain genesis from the certificate digest, actor ID,
and epoch ID. Reject malformed signer or digest output and return no partial
certificate. Construction alone does not verify either signature, establish
current authority state, commit enrollment, persist a key, or grant writer
authority.

Verify enrollment from canonical received bytes, never a duplicate-erased
object. Recompute the authority key ID from the accepted authority public key,
then recompute the actor fingerprint, actor ID, body digest, certificate digest,
and chain genesis. Require exact accepted library, epoch, epoch ID, authority
key ID, schema, algorithm, and observed frontier. Verify actor possession before
the active-authority signature. A verified certificate is still not committed
enrollment: retry identity, operation and actor conflicts, sequence allocation,
and authority-state mutation remain one later atomic transaction.

Repeat complete operation verification inside the native authoritative
boundary. Shared TypeScript verification is useful for early rejection and
cross-runtime parity, but it is not authority for SQLite. Rust must parse the
original canonical bytes, load the immutable enrolled actor identity and public
key from the authoritative database, reconstruct every digest and claimed chain
link, verify every signature, then create the sealed journal input privately.
The atomic commit must distinguish an exact stored retry from a fresh current
tip and reject every stale fork. Never expose a renderer command that accepts a
preverified-looking object or a digest bundle assembled by JavaScript.
Native enrollment may construct the same kind of sealed input only from an
exact private authority snapshot. Do not expose a verify-and-enroll path until
that authority epoch is itself stored authoritatively and rechecked inside the
same enrollment transaction.
Store immutable accepted authority epochs separately from the one active
authority pointer. Enrollment and ordinary operation commits must recheck that
pointer after beginning their SQLite write transaction. Verification completed
before an epoch change never authorizes a write after the change.
An exact retry of an enrollment that already committed is not a new authority
write and must still return its existing actor state after a later epoch
advance. New enrollment under an inactive epoch must fail closed. Encode the
epoch relationship in SQLite foreign keys as well as native admission code.

Keep the native authoritative commit input sealed inside the verifier and
journal module. Renderer IPC must never gain authority by sending an object
that merely resembles a verified transaction. Commit the immutable journal,
causal-tip references, projection updates, actor-tip compare-and-swap, exact
retry receipt, contiguous per-operation ingest sequence, materializer frontier,
projection revision, and the applicable enrollment or operation replication
outbox in one immediate `synchronous=FULL` SQLite transaction.
Outbox rows reference the immutable canonical journal row by primary key. Do
not copy canonical operation or enrollment bytes into a second hot table.
Read pending outbox entries through bounded keyset pages with both row and byte
ceilings. Order from indexed outbox or ingest keys and prove the query plan
does not build a temporary sort. Return canonical payloads only by joining the
single immutable journal or enrollment row. A dormant page reader grants no
network, acknowledgment, deletion, or runtime replication authority.
Scope actor-sequence uniqueness and compare-and-swap state to the exact
library, epoch ID, and actor. Actor sequence restarts at one after an epoch
transition even when actor identity remains stable.
Fault injection must prove rollback from the latest write in that transaction.
