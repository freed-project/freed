# Bootstrap and legacy control

The dormant census does not create the one-time legacy epoch bootstrap. Close
the bootstrap record, prepared journal, local control, receipt, identity, and
recovery-state schemas first. A later slice may implement their durable
initialization transaction. Never guess an initial epoch or infer authority
from file presence or synchronized bytes.

Keep the pure A1 contract package-internal until A2 provides its first
production caller. A compiler-checked dormant module is useful. A public
package export with no runtime consumer is dead API.

Bootstrap uses one explicit local owner action to create one durable prepared
operation journal for the creator installation. The synchronized object is an
unsigned, content-addressed bootstrap record. It names the legacy epoch and
source frontier, but it does not grant owner or write authority. Every current
legacy writer can create synchronized Automerge values, so a self-signature or
an in-document key would be theater.

The record synchronizes under
`libraryCoreLegacyBootstrapRecord:<record_digest>`. Never add a cloud sidecar,
second provider object, request, or cadence for bootstrap. Readers complete
one bounded scan of the entire current reserved root namespace and every
conflict value, plus the complete historical set of reserved root keys in the
accepted Automerge change graph. Absence requires both sets to be empty. An
incomplete scan, deleted root, or tombstoned root blocks rebootstrap. Overflow
fails before allocation. Exact duplicates collapse. Two unequal records block
without winner selection.

The live owner action is required only to atomically create the closed local
prepared journal. That journal binds the exact installation, operation ID,
storage generation, save revision, source binary digest, source heads,
candidate record, candidate binary, candidate heads, and creator control. The
candidate frontier must descend from the exact source frontier. The executable
transaction loads the staged candidate bytes by their bound digest, proves
their exact candidate heads and record occurrence, and only then attempts its
compare-and-swap. The commit compare-and-swaps those source facts and writes
the candidate document, control, receipt, retained prepared journal, and next
revision in one local transaction. The receipt completes that exact journal.
Exact retry reads the prepared or committed objects without asking again.
Changed source bytes require explicit abandonment and a fresh owner action.

Another installation treats a valid synchronized record as TOFU read-only.
Its local control must say `adopter_tofu_read_only`, and that mode cannot
write. Writable adoption requires a separate authenticated pairing with an
existing authority holder or real user presence. Ordinary sync state, copied
credentials, a self-signature, and an in-document key cannot satisfy pairing.

Before adoption or creator readback, prove that the record's immutable source
frontier is an ancestor of the current document. Do not require old head
hashes to remain in the current head set. The local control tracks the current
frontier, schema, storage generation, and local access mode separately from the
immutable record. Every ordinary legacy save compare-and-swaps its local save
revision and atomically updates the document plus the current control
frontier. The prepared candidate and exact first commit name the bootstrap
operation in local control. A later ordinary save or adopter TOFU pin names
its own local operation instead of falsifying current provenance.
Derive incremental persistence from the last committed heads with repeatable
`saveSince` semantics. Never let `saveIncremental` advance its process-local
cursor before the storage transaction commits. Storage failure and response
loss must leave the exact same changes available for retry.
The legacy IndexedDB bridge uses schema version 2. A load returns exact bytes,
generation, and save revision. Every save and clear compares both version
fields in the transaction that changes bytes. Clear advances generation and
resets save revision to zero. Preserve version 1 bytes exactly at revision
zero, close connections on `versionchange`, and fail closed when an upgrade is
blocked. Full replacement requires the caller revision captured before its
asynchronous work began. Publish candidate bytes, heads, and derived worker
state only after storage commit. A failed decode retains the exact bytes and
revision from that read. Never re-read storage to broaden a later clear.
Recognized Automerge decode failures may enter explicit revision-fenced
recovery. Allocation exhaustion and unknown failures preserve the bytes and
fail closed.
Do not activate bootstrap while a compatibility rebuild can replace an
Automerge document through value-only export and import. Such a rebuild loses
the recorded change graph. Fence it after any bootstrap record exists or replace
it with an authenticated history-preserving transition first. Lost ancestry is
corruption, never authority to bootstrap again.

Protocol validators snapshot untrusted fields and arrays once into new
immutable plain values. They bound head and occurrence arrays before
allocation, never return-cast input objects, and never retain mutable aliases.
Digest, ancestry, and state checks use only those snapshots.

Retries after timeout or response loss reuse the exact operation ID and read
back the durable result. They never generate a second identity or silently
rebase an old owner action. Only wholly prepared or wholly committed creator
tuples are recoverable. Document-only, control-only, receipt-only, incomplete
scan, resource overflow, multiple records, and unsupported newer state block
without repairing or deleting evidence.
