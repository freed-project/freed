---
name: freed-library-core
description: Build or migrate Freed's bounded-memory Library Core across Desktop and PWA. Use for native SQLite storage, browser row storage, operation journals, causal merge rules, tombstones, bounded queries, Automerge migration, storage-epoch cutover, rollback, snapshots, imports, operation-segment sync, renderer corpus eviction, or any change that can alter durable library authority.
disable-model-invocation: true
---

# Library Core

Treat storage authority as product behavior. Read
[LIBRARY-CORE-CONTRACT.md](../../../docs/LIBRARY-CORE-CONTRACT.md) before
designing or editing a Library Core slice.

## Declare the slice

Record:

- active engine, storage epoch, schema version, and replication protocol before
  and after the change;
- current global epoch-transition certificate, authority key ID, and exact
  compound cloud authority tuple, including manifest authentication,
  generation, recovery capability, spent-redemption, and migration-claim
  fields;
- immutable source revision and frontier;
- actor enrollment, signature, chain, and transaction-completeness rules;
- operation and field-algebra entries affected;
- bounded query or migration receipt affected;
- rollback input and exact rollback condition;
- memory and latency budgets;
- focused fault boundary;
- whether provider-observable behavior changes.

If any item is unknown, inspect the current implementation. Do not invent a
placeholder authority or a temporary second writer.

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

## Keep the dormant census honest

The checked-in Gate A census is a compiler-enforced inventory, not activation
authority:

- synchronized schema work updates
  `packages/shared/src/library-core/field-registry.ts`;
- shared store contract work updates
  `packages/shared/src/library-core/store-surface-registry.ts`;
- Desktop and PWA worker message changes update the platform-owned
  `library-core-worker-surface-registry.ts` beside each worker type union;
- planned operation or query vocabulary changes update the corresponding
  shared registry;
- localStorage, IndexedDB, Cache API, Tauri store, native file, Keychain, or
  operating-system session ownership changes update
  `local-authority-registry.ts`.

Run the focused registry tests and the affected platform typechecks. A new
schema leaf, store method, or worker message must fail typecheck until
classified. Current authority and planned authority remain separate. An
unresolved codec, algebra, projection, retention limit, platform locator, or
migration rule stays typed as blocked instead of receiving a plausible
placeholder.

Never infer activation from registry presence. The combined census must keep
`activationAllowed: false` until every blocker is closed and the exact
transition is recorded through the activation manifest and its required
receipt.

## Keep dormant SQLite honest

The native and browser shadow stores share the versioned migrations under
`packages/shared/src/library-core/shadow-schema-v*.sql`. Rust consumes those
files with `include_str!`; the shared TypeScript contract must prove its
generated DDL is byte-equivalent after whitespace normalization. Do not add a
second handwritten native schema.

Apply projection upserts, deletions, and the monotone projection revision in
one database transaction. A bounded page or count binds one revision. A later
page using a cursor from an older revision fails closed instead of walking
across mixed projections. Prove the query plan uses the declared keyset index
without a temporary sort. Enforce the registered query limit at the adapter
boundary. Pin a physical schema version and set bounded busy handling, cache,
temporary storage, and mmap behavior explicitly even while the store is dark.

Bind every derived projection batch to one stable batch ID, canonical input
digest, and expected previous projection revision. Commit its rows, deletions,
revision advance, and durable receipt together. Bound each batch to at most
1,000 combined row upserts and deletion intents and 4 MiB of projected input.
Exact retry after response loss returns the original receipt without
reapplying. Changed replay tuples, oversized batches, and incompatible
migration objects fail closed, and a receipt write failure rolls back the whole
batch. Keep this derived receipt explicitly separate from signed authoritative
operation receipts. It grants no mutation or activation authority.

A dormant engine has no production caller, opens no user database, emits no
authority receipt, and does not append an activation-manifest transition. It
may compile into Freed Desktop behind an explicit dark-module boundary. A
command registration, startup open, backfill, read route, or writer route is an
activation change and follows the corresponding gate.

When a closed field operation reaches the dark projection, update only its
registered columns. Do not rebuild or overwrite the full row. Validate current
projected state, apply the shared field algebra, advance the projection
revision, and commit the derived receipt in one transaction. Missing entities,
malformed current values, stale revisions, and receipt failures roll back
without repair. This derived path does not satisfy the authoritative operation
materializer blocker.

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

## Preserve the invariants

1. Keep exactly one active writer epoch. Advance it only with a signed immutable
   transition certificate and one compare-and-swap of the complete cloud
   authority tuple. Local file presence or an incremented number is not
   authority.
2. Acknowledge a mutation only after the operation, rows, tombstones, cursor,
   and outbox commit together.
3. Reuse the same operation ID after timeout or response loss.
4. Derive core-body, transaction, actor-chain, and signature digests in the
   contract's non-circular phases. Desktop and PWA must produce identical
   canonical bytes.
5. Use causal context for later intent and the registered algebra for
   concurrent intent. Do not use SQL order or wall time as the merge contract.
6. Enroll device-local actor keys through the library authority and verify every
   operation signature, sequence, previous-operation link, and chain digest.
   Rotate actor identity only for a new installation incarnation, clone
   recovery, or restore. Preserve it across ordinary app updates. Reject stale
   epochs, retired actors, gaps, forks, unknown schemas, and changed migration
   sources.
7. Preserve forked suffixes as immutable quarantine evidence. Recovery emits
   new signed repair operations with source references. Never rewrite or replay
   the compromised envelopes.
8. Buffer a remote transaction until count, contiguous member indexes,
   signatures, individual digests, and aggregate digest all verify. Never
   materialize or acknowledge a partial transaction.
9. Read migration data from an immutable complete source, never UI state.
10. Return bounded DTOs with one source revision. Never cross a full corpus into
   React, Zustand, or a Web Worker that remains resident.
11. Keep Automerge authoritative until both Desktop and PWA can use the
   replacement replication epoch.
12. Fence every retired epoch through epoch-bound operation and manifest
    authentication. Treat old-client uploads and late writes as explicit orphan
    recovery input, never active authority.
13. Authenticate manifests and preserve branch-qualified actor tips. Never
    sequence-max incompatible forks for sync, acknowledgment, or compaction.
14. Roll back only from a receipt at the same frontier. Otherwise roll forward.
15. Make external blobs durable before an authoritative database reference,
    replicate and verify them before applying a referencing transaction, and
    snapshot the database plus its pinned reachable blob set at one frontier.
16. Keep provider traffic off during development. The first slice capable of
    turning a memory-rejected provider attempt into real provider contact is
    provider-observable. The owner approved the exact effect of existing
    scheduled Facebook and Instagram pulls succeeding after memory relief in
    `codex-task:019f4ce3-2ee3-76b2-bc0c-eb7f4958a7de`, with the statement "You
    are fully authorized to continue this optimization in ways which will
    increase provider pull frequency by fixing cases where we were previously
    unable to pull." The provider can therefore observe successful contact where memory
    rejection previously produced none. The lowest-profile alternative is to
    preserve the memory rejection and leave that data unsynced. This decision
    does not expire while the existing schedule, retry policy, requests,
    navigation, cookies, headers, and extraction behavior remain unchanged.
    Cite that exact decision and write and validate its healthy artifact before
    publishing the first active slice. Do not ask the owner to approve the same
    behavior again. Dormant storage work remains provider-free. Cadence,
    request, navigation, cookie, header, or extractor changes require their own
    decision.
17. Keep cloud replication and provider-action outboxes separate. A remote
    library operation never directly triggers provider activity.
18. Advance materializer work by local ingest sequence, not HLC.
19. Commit materialized state through the canonical persistent Merkle Patricia
    trie. Update only touched leaves and ancestor paths in ordinary writes and
    migration batches. Never rehash the complete corpus per transaction.
20. Elect one capable migration authority for the exact immutable Automerge
    source through the authenticated response-loss-safe candidate claim. Cloud
    claims expire only by authenticated store time. Local claims never expire
    and require explicit abandonment or winning cutover. Require the live exact
    claim and an exact payload-bound one-use grant for candidate registration,
    source contribution, fence reservation, fence activation, candidate-object
    commit, and cutover. Candidate registration is the first claim-bound
    authority mutation. While its registry entry is absent, no other operation
    grant may issue or consume. Registration and candidate-absent abandonment
    serialize over the same claim pointer and registry state. Cloud operations
    consume the grant in the authority store. Local operations bind it inside
    the same local control transaction. A cloud source grant binds a
    runtime-owned process generation and monotonic anchor created before grant
    acquisition. Commit requires the original nonserializable live attempt
    handle and the current runtime-owned generation. Serialized equality cannot
    revive an attempt after restart. A pause consumes the allowance but does
    not invalidate an otherwise timely attempt. A pause that exhausts the
    allowance, a restart, a missing live handle, a changed generation, or an
    invalid clock sample requires a fresh operation ID and grant. Cutover grants
    bind the closed transition-core payload, then the final certificate binds
    that payload, grant, and consumption without a hash cycle. Other
    installations prove adapter fixtures and bootstrap from the accepted
    checkpoint and operation segments. Do not make every browser decode the
    owner's private corpus. A second unreconciled permanent media vault blocks
    cutover.
21. Bound startup recovery by item count and elapsed time. Verify a referenced
    blob before exposing that entity, quarantine only affected state, and
    resume the remaining integrity scan from a durable background cursor.
    Never block startup on a full blob-corpus walk.
22. Keep every migration fence secret out of portable evidence. Persist only a
    domain-separated token digest in authority records, proofs, receipts,
    backups, and logs. The source owner generates and retains the private token
    only in protected, crash-recoverable operation state. A coordinator never
    publishes or retains it.
23. Serialize source-fence acquire, release, and abandonment revocation through
    one durable source-local authority domain. Prepare corpus-sized candidate
    work, prepared proof, reservations, and genesis closure before fence
    activation. Activate every fence only for the final bounded
    compare-and-swap window. Library Core v1 permits at most 64 local sources,
    65 fences including Automerge, a 2 MiB activation-evidence sidecar, 1,024
    sidecar objects, 65 source mutations, and 60 seconds. The sidecar contains
    only activation entries, authenticated-set nodes, the bounded final proof,
    and dependency-acyclic wrappers. It excludes the genesis closure, receipt,
    cutover payload, certificate, and manifest authentication object. Commit
    sidecar, final proof, receipt, cutover authority records, certificate,
    manifest authentication, and target tuple in one atomic authority bundle.
    No full decode, cache census, filesystem walk, external sort, arbitrary
    upload, closure mutation, or prepared-proof traversal runs while a source
    fence is active. While active, acknowledge a new source write only after
    its exact epoch-neutral replay intent is durable. Otherwise reject it before
    acknowledgment.
24. Decode Automerge through bounded external-memory runs. Never use
    `Automerge.load`, keep a source-sized change graph resident, or grant a
    large-host exception. Admission proves both the fixed memory ceiling and
    private staging capacity.
25. Build PWA reader manifests from both registered Cache namespaces and the
    durable logical lookup plan. Use one plan row and one probe per unique
    physical locator with sorted candidate bindings. Call only exact
    `cache.match` with every ignore option false and no network fallback.
    Persist one authenticated hit, missing, or error outcome for every plan row.
    Never enumerate the full Cache API key set. Resolve native reader files
    beneath one pinned root handle with
    no-follow semantics and reject links, reparse points, mount crossings, and
    root replacement. A mapped target identity must equal independently
    verified source identity.
26. Capture backups from one immutable checkpoint and media-vault generation,
    then release writers. Finalization may proceed across authenticated
    ordinary same-transition descendants without changing captured backup,
    bundle, delegation, or encrypted payload bytes. Keep one stable registration
    ID. Use a fresh attempt operation ID whenever the predecessor tuple,
    descendant proof, or signed certificate bytes change; exact retry means
    byte-identical attempt bytes. A busy library must not starve backup merely
    because new writes continue.
27. Commit cleanup through persistent candidate-census, source-fence, and
    terminal-disposition sets. Candidate size may delay physical deletion but
    never blocks ordinary legacy writes. An unreachable authoritative source
    blocks registered-candidate cleanup and a successor migration claim until
    it reconnects or is retired through policy. A claim abandoned before
    candidate registration uses the bounded candidate-absent cleanup branch:
    null candidate fields, canonical empty disposition sets, no source
    revocation, and no claim that unregistered temporary bytes were deleted. It
    is never blocked on source reachability. Same-library recovery is the
    cleanup-free authority escape hatch.
    Same-library recovery may supersede an active or abandoned lifecycle with
    its canonical proof before distributed cleanup. Later cleanup is garbage
    collection, not authority. Represent it with the recovery-supersession
    selector, signed disposition receipts, and the optional signed recovery-GC
    aggregate. Never fabricate an abandonment digest for an active-claim
    recovery.

## Build in the safe order

Use `freed-build-feature` for worktree and publication mechanics. Within the
Library Core program, prefer this sequence:

1. measurement and budgets;
2. exhaustive field, operation, query, deletion, and locality registries;
3. closed legacy-bootstrap and local-control schemas with pure validation and
   state classification;
4. a dormant atomic creator and adopter bootstrap transaction with readback,
   conflict preservation, and response-loss recovery;
5. dormant native or browser core;
6. one elected immutable resumable migration, bounded device-local source
   contributions, and full-field verification;
7. bounded reads at one revision;
8. exhaustive full-corpus consumer cutover, renderer eviction, and a
   short-lived compatibility engine;
9. dormant replacement replication on Desktop and PWA;
10. one coordinated writer and protocol epoch cutover;
11. installed soak and rollback window;
12. Automerge retirement.

Do not activate a later step because its code exists. Require the preceding
receipt and exact source frontier.

## Validate economically

During implementation, run the smallest deterministic proof for the contract
changed. At the publish checkpoint, run changed-path feature validation.

Blocking Library Core proofs are:

- closed legacy-bootstrap record, prepared-journal, receipt, and local-control
  shapes; exact identity codecs; 1 through 65 sorted unique Automerge heads;
  bounded complete namespace scans; canonical digest recomputation; exact
  source generation, revision, binary, and frontier fencing; bootstrap-frontier
  ancestry; creator versus TOFU read-only adopter classification; partial
  transaction rejection; multiple-record conflict; and response-loss readback
  without regeneration or renewed owner action;
- transaction crash atomicity on every writable Desktop and PWA adapter;
- duplicate operation and response-loss recovery;
- actor enrollment and signature rejection, restore rotation, retirement, fork
  detection, and deterministic repair convergence;
- incomplete and corrupted transaction-member rejection without partial apply;
- future-clock quarantine and certified repair convergence;
- concurrent delete, update, and explicit restore;
- elected migration claim races and response loss, interruption,
  cloud expiry and local non-expiry, operation-grant consumption,
  grant-bound live source attempts across process restart, source-revision
  drift, registration versus candidate-absent abandonment, state-correct
  absent cleanup, dead-claimant abandonment, recovery supersession, persistent
  registered-candidate cleanup sets larger than one page, external-memory
  decode, prepared migration and rollback proofs, valid rollback fences,
  65-fence and 2 MiB finalization boundaries, atomic sidecar publication,
  short fence activation, composite device-local source identity, pinned-root
  native traversal, lookup-plan Cache probes without `Cache.keys()`,
  reader-target identity equality, authoritative reader-content and permanent
  media-vault closure, adapter fixture parity, and bounded checkpoint
  bootstrap;
- global epoch races, same-epoch manifest races, compound authority-state
  compare-and-swap, remote genesis closure, prepared-transition recovery,
  stale-writer fencing, and legacy-namespace isolation;
- cutover, rollback, authority recovery, and concurrent-restore receipts;
- same-revision page and count behavior;
- two-device offline convergence through cloud manifest conflicts;
- authenticated manifest generation, exact branch acknowledgment, and safe
  compaction;
- schema and database-plus-blob snapshot atomicity, including blob crash
  boundaries;
- bidirectional Desktop and PWA encrypted backup and restore vectors, including
  a busy same-transition source that advances during backup construction;
- import idempotency;
- bounded query enforcement and full semantics beyond the legacy 2,500-item cap
  on every supported adapter.

For a read cutover, typecheck is also a consumer inventory: removing the
full-corpus state field must expose every remaining reader. Preserve existing
search semantics with parity fixtures or deliberately version the query after
an explicit product decision. A native feed query alone is not a memory
cutover while navigation, settings, search, content fetch, provider-action
derivation, backup, export, or product/UI sync still scans the complete corpus.
The registered short-lived legacy migration and replication bridges may
continue through Gate D until Gate E replaces them; they do not excuse another
full-corpus product reader.

Use `freed-sync-replay` for fault injection and `freed-memory-profile` for
memory admission. Route large fuzz matrices, private-corpus migration,
100,000-item performance, browser permutations, and long slopes to dedicated
or nightly evidence. Do not add them to every PR or release.

## Close the slice

Before publication:

1. Confirm every changed export has a real caller.
2. Confirm no unbounded DTO or whole-document transport was introduced.
3. Record exact head, tree, schema, epoch, source frontier, focused tests,
   runtime, rollback plan, and exact rollback trigger. If this slice executed
   a transition, also record the same-frontier rollback or recovery receipt.
   Dormant code and measurement do not invent a receipt for a transition that
   never occurred.
4. Classify provider-visible paths by behavior. A path-only change with no
   observable provider effect uses the approved `diff_authorized` audit path.
5. Dormant code and measurement may be merge-safe. Any Gate C through Gate H
   dormant-to-active transition is owner-reviewed work. This includes claiming
   or executing a migration candidate, source admission fencing, SQL read
   cutover, legacy-worker or renderer-corpus eviction, an active writer,
   replication protocol, storage epoch, rollback, restore, authority-key
   rotation, recovery transition, installed-soak activation at Gate G, or
   legacy-engine retirement. Stop at an
   owner-reviewed PR and obtain separate release, install, and activation
   authority. Task or merge authority alone never activates one of these
   transitions.
6. Do not append to
   `docs/library-core-activation-manifest.json` for dormant implementation. The
   exact product PR that deliberately makes the next release cross a Gate C
   through Gate H boundary appends one closed transition entry with its stable
   activation ID, rollback trigger, and receipt expectations. Never delete,
   edit, reorder, or reuse an earlier entry. Release tooling derives the exact
   activation delta from this history. It never trusts a handwritten
   `no_activation_declared` assertion.
7. A first `complete_history` release with no previous published boundary must
   set `previousPresent: false`. When a previous boundary exists, a release may
   set `previousPresent: false` only after an exact Git tree lookup at that
   resolved commit proves the activation manifest path is absent. Missing
   objects, invalid refs, wrong object kinds, permission errors, and read
   failures block release validation. After any prior release artifact records
   activation evidence, require `previousPresent: true` and exact digest
   continuity.
