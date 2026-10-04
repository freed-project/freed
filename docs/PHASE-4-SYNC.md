# Phase 4: Sync Layer

> **Status:** 🚧 In Progress

Native provider admission now has bounded lifetime counters in the existing
runtime-health sampler. The soak verdict reports their delta only across a
stable, covered interval with no active provider commands or provider windows.
Missing or inconsistent evidence is inconclusive. Installed consumer-role and
multi-device acceptance remain separate requirements.

Saved URL recovery now distinguishes absent targets from deleted items. The
owner reviews every URL, edits its title or description, and explicitly confirms
one complete replacement. Original targets, URLs and remaining archived content
stay fixed. Deleted items and unsupported capture types are refused. Opening the
editor stays offline; after acceptance, the Primary may fetch the publisher under
its existing content policy. Exact retries retain the signed replacement and use
the durable archive link. Notes and tags remain separate recovery transactions.
Installed multi-device acceptance is still outstanding.

PWA convergence audits now stream canonical records through an OPFS-backed sort
with a bounded cache. Deadline, cancellation and temporary-file failures return no
receipt and restore the connection settings. Memory-only backends retain bounded
paging. Synthetic large-Library validation does not replace installed Mac or
physical iPhone acceptance.

PWA result settlement keeps the Primary's signed timestamp in the original
result bytes and records local intent resolution from the consumer's receive
clock. A result is not rejected merely because the consumer enqueued it after
the Primary's timestamp. Local resolution cannot precede local enqueue even if
the consumer clock moves backward. Signature, actor-chain, transaction identity
and canonical import checks still apply.

PWA checkpoint refresh now preserves pending and published signed edits,
optimistic fields, actor counters, enrollment and exact transport history in the
same activation transaction. It requires the verified Library, epoch and writer,
nonregressing checkpoint history, unchanged authority certificate and a compatible
actor chain. Failed activation leaves the old state intact. An accepted result
clears its overlay only when the new canonical frontier covers that result;
checkpoint effects alone never acknowledge pending work. Installed multi-client
acceptance remains open.

Freed Desktop publishes bounded normalized operation segments after its verified
checkpoint. Desktop and PWA consumers import those segments in revision order.
Native SQLite stages partial transactions durably and applies complete signed
transactions through the shared native materializers without writer admission
or publication outboxes. Drive commits the exact immutable tail through a
strong-ETag operation head. Administrative revision gaps, content-descriptor
dependencies, and a chain of 64 segments require a new checkpoint. The chain
limit bounds recovery work; installed workload tuning remains open.

Native follower checkpoint refresh preserves signed pending and published edits,
enrollment, optimistic fields, and exact intent/result transport history within
the same Library and authority epoch. Activation faults roll back all retained
state. Successful consumer activation revokes stale native writer and provider
admission in that same transaction. Authority changes and regressing checkpoints fail without replacement.
Accepted results retain optimistic fields until the corresponding canonical
revision reaches the replica. Installed multi-Desktop convergence remains open.

Desktop discovery uses the native pinned Library ID, including before its first
checkpoint. Native checkpoint selection accepts the verified consumer receipt
for the imported generation. Native publication requires Primary admission,
and consumer setup can resume without creating a temporary Primary. The full
installed two-Desktop and PWA convergence scenario remains open.

PWA first-launch presentation distinguishes Google Drive connection from an
accepted Library. Before checkpoint selection, setup stays available without
mounting Library-backed routes or the Saved overview. Sync errors link back to
Settings. This does not change discovery, import verification, or cadence.

Replacing a PWA checkpoint for the same Library and authority epoch preserves
the exact local enrollment request, pending edits and intent/result transport history
inside the activation transaction. Failed activation leaves the previous state
intact. Periodic status reads use bounded receipts without exporting the Library.

PWA manual sync joins an automatic Google Drive refresh already in flight.
One lifecycle generation runs at most one import at a time; success and failure
release the slot, and a stopped generation cannot clear its successor.
The automatic refresh interval remains 60 seconds.

Drive discovery distinguishes separate Libraries from duplicate controls for the
same Library. When several Libraries are published, the PWA offers an explicit
Library ID choice and pins later discovery to the imported checkpoint identity.
It never chooses by modification time or deletes competing controls. Duplicate
controls for one identity remain an integrity error. Authenticated production
acceptance remains open.

PWA checkpoint imports distinguish advancing local materialization from a
stalled worker. A bounded progress signal keeps large receipt histories moving
without extending network cadence. Worker interruption recovers the previous
accepted database through SQLite's rollback journal before integrity checks.
Authenticated import and edit round-trip verification remain release evidence,
not a consequence of synthetic tests passing.

Checkpoint publication separates a five-minute no-progress deadline from a
fixed total budget. After the native snapshot is known, the budget is five
minutes plus ten seconds per estimated 4,096-record page, capped at two hours
from attempt start. This is an operational allowance, not a measured network
latency prediction. Only advancing export pages and newly verified immutable
objects refresh the stall timer. Repeated milestones, HTTP activity, and retries
do not extend either budget. Unknown preflight retains its five-minute bound.
Drive request concurrency, retries, and remote-byte verification are unchanged.
Installed publication and bidirectional follower acceptance remain open.

Headless inbound transport now runs after the remote writer and epoch check.
Complete unresolved native intent staging remains retryable after a late
authority failure. Incomplete transactions still advance their receive cursor.
Recovery verifies and replays the complete immutable segment containing the
pending counter, preserving native exact-retry and atomic admission semantics.
Offline native and coordinator tests cover these boundaries; installed
bidirectional acceptance is still required.

> **Architecture:** This phase is governed by
> [LIBRARY-CORE-ARCHITECTURE.md](LIBRARY-CORE-ARCHITECTURE.md) and
> [LIBRARY-CORE-CONTRACT.md](LIBRARY-CORE-CONTRACT.md).
> Google Drive synchronizes immutable typed protocol objects, never a SQLite
> file or Library shell. Checkpoints contain normalized records identified by
> stable registry plus typed primary key. Editable followers publish signed
> mutation intents and import canonical results from the active Primary. Large
> content uses optional content-addressed blobs and authenticated range maps.
> Automerge, ordinal checkpoint identity, IndexedDB Library rows, shell
> records, shadow stores, and compatibility paths are not part of this
> architecture.

> **Dependencies:** Phase 1-2 (Capture layers ✓)
>
> **Current implementation checkpoint:**
>
> Native Rust and browser SQLite now execute the same generated schema, 33
> bounded query programs, closed mutation programs, checkpoint registry,
> signed operation protocols, invalidation feeds, and content work programs.
> Freed Desktop, the headless Primary, and the PWA route Library reads and
> writes through these contracts. The Primary exports normalized version 2
> checkpoints and accepted transactions directly from SQLite. Followers stage,
> verify, and apply complete revisions atomically. React retains visible windows
> and sparse optimistic fields only. Retired document runtime, Library IndexedDB,
> shell, shadow-store, rollback-switch, and whole-corpus paths are absent from
> shipping artifacts. The version 2 release activation manifest declares one
> SQLite storage epoch and permits only fail-closed roll-forward recovery.
> Installed-device acceptance remains open.

Large installed Libraries now materialize one pinned temporary export index per
checkpoint session. The generated 4,096-record ceiling remains subordinate to
the 2,097,152-byte cloud page bound and 1,048,576-byte native response bound, so
receipt-heavy Libraries avoid thousands of repeated SQLite scans and Drive
objects without weakening bounded transport. A repeat publication is current
only when its stored receipt matches the exact Drive control revision and
canonical pointer. Desktop and headless publication now begin the pinned read
transaction and obtain its descriptor in one native command, so a concurrent
Library write cannot invalidate the checkpoint between description and export.

## Current SQLite sync work

Checkpoint serialization reuses only factory-validated, deeply frozen records
through weak references. Unknown input still crosses the full canonical and
closed-record checks. Small ASCII codec fragments avoid temporary UTF-8 buffers;
Unicode encoding and all byte ceilings remain unchanged. Receipt-heavy offline
publication profiling does not replace installed Drive acceptance, which remains
open after the v26.9.500-dev publication timeout.

The aggregate record ceiling derives from the existing manifest page count
and generated records-per-page limit. Publication and import share that ceiling;
the manifest, decoded-page, native-response, and publication-object byte/count
bounds remain unchanged. Older clients reject checkpoints above their previous
aggregate limit before staging. An updated PWA consumer is required before
claiming cross-client synchronization for these larger Libraries.

- [x] Define `freed_normalized_checkpoint_v2` registry identity and shared
      protocol ceilings from one executable source. Rust and TypeScript reject
      shell registry entries and losslessly chunk and reassemble a 4 MiB legal
      value without producing a record above 131,072 canonical bytes.
- [x] Define closed payload fields for each normalized root and child row,
      install the shared final SQL schema from the generated contract, and
      export exact native pages directly from normalized SQLite tables. One
      native response is capped at 1,048,576 serialized bytes and every record
      is rechecked against the 131,072-byte canonical ceiling.
- [x] Freeze one generated protocol registry for normalized checkpoint records,
      operation segments, signed intents, results, content descriptors, range
      indexes, manifests, and control tuples.
- [x] Remove the Library shell checkpoint record and every whole FeedItem JSON
      checkpoint row.
- [x] Stream normalized checkpoint manifests through one typed importer that
      verifies canonical ordering and computes the exact dataset digest while
      pages are appended. Native SQLite computes the activation digest again
      from staged canonical records. It can replace existing canonical rows in
      one transaction, and refuses the replacement without changing the
      current Library when local intents or outbound operations are unresolved.
- [x] Reassign one cloud writer through a signed normalized SQLite authority
      epoch, carry the exact prior causal frontier, re-enroll the target
      Desktop actor, and publish generation zero from the pinned typed export.
      The transfer has no portable checkpoint producer or historical-journal
      writer path.
- [x] Bind a follower checkpoint receipt and actor enrollment state inside the
      selected normalized database. Editable followers now have one native v2
      capability request, authority countersignature, exact replay check, and
      local intent-chain initialization path. The old journal is still the
      active Desktop follower caller until the remaining intent and result
      commands move to these normalized tables.
- [x] Generate equivalent native Rust and browser SQLite ranked-feed programs
      with complete filters, forward and reverse keyset paging, source-fenced
      cursors, a 129-row scan ceiling, and no historical source-enumeration
      field.
- [x] Generate equivalent native Rust and browser SQLite
      `saved_analytics_v2` programs. One source-fenced response returns exact
      Saved totals, latest time, seven day buckets, 24 hour buckets, and
      bounded binary-ordered source and content counts under 2 MiB. No
      FeedItem row crosses into application code for this aggregate.
- [x] Generate equivalent native Rust and browser SQLite
      `saved_feed_page_v2` programs for date saved, date published,
      recommendation priority, and shortest read. Each closed variant owns
      matching forward and reverse keysets plus an expression index. Cursors
      bind the filter digest, sort, generation, revision, and complete order
      key. One request reads at most 129 rows and returns at most 128 compact
      Saved cards without an application-side corpus scan or sort.
- [x] Generate the normalized `feed_item_capture_upsert` mutation program.
      Signed capture writes typed FeedItem source columns, media, and topics
      atomically, preserves established user state on refresh, refuses
      tombstone resurrection, and caps the complete canonical operation
      envelope at 131,072 bytes. Larger content remains a descriptor and chunk
      concern.
- [x] Stage and activate typed normalized records through bounded native SQLite
      transactions. Exact replay is idempotent, changed replay fails, finite
      fractions use exact binary64 wrappers, incomplete content and foreign
      references fail, and staging bytes are removed after activation.
- [x] Expose the same exporter and staging activation contract in the PWA
      SQLite worker.
- [x] Export the post-checkpoint operation stream from native SQLite as one
      authority-signed accepted-result record followed by its exact
      actor-signed operation envelopes. The descriptor binds Library, epoch,
      writer, source revision, transaction count, and operation count. Stable
      keyset cursors preserve source revision, record kind, member index, and
      semantic record digest. One logical record is capped at 131,072 bytes,
      one page at 128 records and 1,048,576 canonical bytes, and one native
      response at 1,048,576 serialized bytes.
- [x] Stage version 2 operation pages durably in PWA OPFS SQLite, verify the
      authority-signed acceptance and complete actor-signed transaction, then
      journal and materialize it atomically at the exact next source revision.
      Split pages, future revision gaps, changed replay, maximum inline content,
      and a final-proof fault are covered. A follower commits no replication
      outbox, and checkpoint replacement clears only the device-local stage and
      applied proof rows before installing the new frontier. Accepted local
      results settle their result chain first, then enter this same importer.
      No result handler owns a second projection or revision path.
- [x] Enforce the initial 131,072-byte canonical logical-record ceiling,
      128-record and 2,097,152-byte decoded page ceilings, and 1,048,576-byte
      native source-response ceiling, subject to the pre-freeze benchmark.
- [x] Represent larger legal fields through content descriptors and bounded
      content-addressed chunks or authenticated range indexes.
- [x] Let each client stream, partially cache, fully cache, pin offline, or
      exclude content without changing checkpoint authority.
- [x] Delete Automerge cloud merge, LAN document relay, compatibility control,
      shell, ordinal identity, dual-engine rollback, and SQLite file transport
      paths after verified one-epoch cutover.
- [x] Preserve current Google Drive endpoints, paging, and cadence. The
      separately approved authentication recovery adds one forced OAuth refresh
      and one exact request retry only after a Drive 401 response.

---

## Sync architecture

One active Primary owns canonical mutation admission for a Library and writer
epoch. The Primary runs inside Freed Desktop or the headless service and uses
the shared native SQLite Library Core. Freed Desktop and PWA followers keep
local SQLite replicas and submit signed mutation intents.

### Logical protocol

Synchronization exchanges only closed typed logical objects:

- normalized checkpoint records
- append-only normalized operation segments. Each accepted transaction begins
  with its authority-signed result, followed by the exact actor-signed members
  named by that result
- actor enrollment and retirement certificates
- signed follower intents
- signed Primary acceptance, rejection, and provider-result records
- authenticated checkpoint, operation, result, and content manifests
- content descriptors, content-addressed chunks, and authenticated range indexes
- one small authenticated control tuple

The protocol never exchanges SQLite files, WAL files, SHM files, rollback
journals, a Library shell, monolithic `DocState`, or whole FeedItem JSON rows.

Checkpoint records are identified by stable registry key plus typed canonical
primary key. Pages carry at most 128 records and 2,097,152 decoded canonical
bytes. Each record uses the initial 131,072-byte canonical ceiling until the
required benchmark freezes the protocol value. Larger legal values use the
content plane.

### Google Drive

Google Drive `appDataFolder` stores immutable protocol objects and one
compare-and-swap control file. The control tuple binds the Library, writer
epoch, schema version, protocol version, registry fingerprint, checkpoint,
operation frontier, and content root.

Publication uploads immutable dependencies first, verifies their stored bytes,
then advances the exact prior control revision. A lost commit response is
resolved by authenticated readback. Unreachable immutable objects are safe to
collect after retention and reachability proof.

This phase preserves existing Google Drive endpoints, headers, OAuth behavior,
retry policy, and cadence. Changing those behaviors requires separate scope and
evidence.

### Editable followers

A follower commits its signed intent and sparse optimistic overlay atomically
in local SQLite. The intent binds the Library, epoch, actor, capability,
transaction, ordered operations, actor-chain predecessor, and idempotency key.

The Primary verifies the complete envelope and either commits the whole
transaction or rejects it. It publishes a signed result that the follower
applies atomically. Provider acceptance and provider completion are distinct.
A client cannot display provider success until the Primary records the actual
provider result.

### Selective content

Metadata convergence does not require content hydration. Each client chooses
metadata-only, stream, partial-cache, full-cache, pinned-offline, or excluded
behavior for each asset or rendition. Multi-gigabyte media uses authenticated
range indexes and bounded chunks. Content bytes never enlarge a logical
checkpoint record.

### Failure behavior

Invalid signatures, stale writer epochs, split authority, unknown versions,
registry drift, gaps, changed replay, oversized records, incomplete manifests,
content digest mismatch, and stale cursors fail closed. Checkpoint imports
stage into SQLite and activate only after complete registry, frontier, state,
content-root, and integrity verification.

A crash before a SQLite commit leaves no accepted mutation. A crash after
commit recovers from the durable receipt and idempotency record. No failure
loads an alternate Library engine or compatibility path.

## Tasks

| Area | Status | Current contract |
| --- | --- | --- |
| Executable contract source | Complete | One checked source generates Rust and TypeScript schema identity, checkpoint registry, query SQL, mutation SQL, limits, invalidations, content programs, and replication constants. |
| Native authority | Complete | The extracted Rust core owns normalized SQLite, signed operation admission, authority epochs, checkpoints, snapshots, follower staging, results, invalidations, and content proofs. |
| Desktop product routing | Complete | Product views, exports, diagnostics, maintenance, capture, and provider completion use bounded typed SQLite queries and mutations. React retains visible windows and ephemeral UI state. |
| PWA product routing | Complete | Official SQLite WebAssembly over OPFS owns Library rows, indexes, outboxes, receipts, overlays, and bounded product queries. IndexedDB is limited to nonextractable browser keys. |
| Checkpoint protocol | Complete | Checkpoints contain typed normalized records only. Every logical record is capped at 131,072 canonical bytes. Pages contain at most 4,096 records and 2,097,152 decoded bytes. One native response is capped at 1,048,576 serialized bytes. A pinned temporary export index prevents repeated scans of the generated union view. |
| Editable followers | Complete | Followers commit signed intents and sparse optimistic overlays locally. The Primary validates and publishes signed acceptance, rejection, and provider-result records. Canonical operation import settles overlays atomically. |
| Selective content | Complete | Content descriptors, authenticated range maps, and content-addressed bytes support metadata-only, on-demand, partial, complete, pinned-offline, and excluded policies per device. |
| Historical cutover | Complete in code | One read-only source admission path imports the historical Library once. It never becomes runtime authority, transport, fallback, rollback proof, or a dual-write participant. |
| Drive behavior | Approved recovery | Endpoints, paging, normal request cadence, and provider adapter ownership remain unchanged. After a 401, Freed performs one single-flight OAuth refresh and retries that request exactly once with the replacement bearer token. |
| Device acceptance | Pending | Installed-build recovery and physical iPhone suspension, quota, and offline playback acceptance remain release evidence, not alternate architecture. |

## Success Criteria

- [x] Desktop, headless Primary, and PWA use SQLite as their only Library row store.
- [x] Every product read crosses a bounded named query contract.
- [x] Every durable product change crosses a closed typed mutation contract.
- [x] React stores only visible query windows, selected rows, and ephemeral UI state.
- [x] Checkpoints and operation tails contain normalized typed records, never a Library shell, monolithic document, whole-database file, or whole FeedItem transport row.
- [x] Editable followers use signed intent and result chains with atomic sparse overlays.
- [x] Large content is independently authenticated and selectable per device.
- [x] One executable source generates matching Rust and TypeScript contracts.
- [x] Historical authority code is isolated to read-only one-time source admission and loss detection.
- [x] Release artifacts reject retired document runtimes, Library IndexedDB databases, rollback flags, and shell records.
- [x] Google Drive transport preserves the Library Core cutover contract, with
      the separately approved bounded OAuth recovery after a 401.
- [ ] Complete installed Freed Desktop and physical iPhone acceptance evidence.

Native checkpoint page reads and completion probes use tuple keyset seeks on
the pinned export index. This prevents late pages from rescanning the exported
prefix. A deterministic SQLite VM-step test protects bounded work for first,
late, and terminal pages. Record order, page limits, receipts, and the wire
format are unchanged; receipt-heavy installed Drive acceptance remains open.

Desktop publication coalesces overlapping manual and scheduled requests. A
canceled native checkpoint export retains its local slot until the underlying
call settles; a new request receives a bounded busy error instead of replacing
the pinned cursor. Cancellation before export does not retain that slot. Writer
transfer uses the same exclusion boundary. Focused production-wiring tests
cover overlap, cancellation, late native completion, and recovery. Installed
Drive acceptance remains required before claiming the release effective.

## Dependencies

- Phase 1 and Phase 2 capture records
- Freed Desktop native Library Core from Phase 5
- PWA OPFS SQLite runtime from Phase 6
- Existing Google Drive adapter behavior and authenticated app-data storage

### Conflicting enrollment isolation

A native rejection of changed actor enrollment bytes leaves that actor unchanged
and does not stop independent device requests or accepted actor synchronization.
The coordinator records a bounded diagnostic and publishes no certificate for the
rejected request. Other native, authority, cancellation, and transport failures
still stop the pass. Recovery of a device whose retained request itself conflicts
with its accepted enrollment remains a separate verification requirement.

Google Drive follower certificate discovery matches the retained request against
the complete certificate digest, not the distinct nested enrollment-body digest.
Actor identity and request matching remain exact; SQLite still verifies the
canonical certificate, signatures, capabilities, and current authority before
enrollment. The transport fixture uses different digest fields to protect this
boundary.

Pending PWA enrollment diagnostics expose only the device and request identity
suffixes plus counts from the existing certificate discovery pass. They distinguish
a missing device certificate from a different request for the same device without
adding Drive requests or changing enrollment admission.

PWA sync reports its current local-checkpoint, Drive discovery, checkpoint import,
follower-sync, and view-refresh stage while the pass is running. This keeps an
unsettled pass attributable without adding provider calls or changing admission.

Checkpoint import progress separates immutable object download and verification,
local selection comparison, staging, page storage, activation, and cleanup.
Only bounded counts and byte totals enter the local progress display.

Long PWA Drive transfers retain the expiry of a reused access token and check
credentials before each existing request. Expiring credentials refresh without
restarting checkpoint import. Disconnect or lifecycle replacement during refresh
prevents the pending Drive request from being sent.

PWA enrollment can recover an unused device actor already admitted in the
verified checkpoint when an older client retained a different local request.
SQLite verifies the original certificate and active authority, exact key and
capability, zero accepted operations, and empty local intent history. Recovery
retains the pending request as evidence and commits the enrollment receipt and
intent genesis together. It never replaces the Primary actor or selects a
certificate merely because Drive discovery found the same actor ID.

PWA result settlement validates the complete operation-owned replacement fields
instead of requiring equality with sparse optimistic previews. Unsave and
unarchive can therefore settle the full authoritative saved/archive register.
Signed-result, identity, cursor, missing-field and atomic rollback checks remain
mandatory.

Operation sync uses the enrolled Primary actor identity already bound by checkpoint
export. Native export, PWA staging, and accepted-result materialization reject
missing, retired, or ambiguous writers and recheck admission before committing.

### Desktop synchronization ownership, September 17, 2026

Primary publication, consumer catch-up, and writer reassignment share one local
work owner. Cancellation returns promptly but retains that ownership until any
in-flight native command settles. Overlapping manual consumer calls join the
same pass; a replacement lifecycle cannot run over canceled native work.
Consumer checkpoint staging checks cancellation before activation.

An initial consumer connection failure now schedules another attempt after the
existing 60-second interval, refreshing its access token. Lifecycle replacement
and stop prevent stale callbacks and duplicate timers. Deterministic offline
tests cover cancellation, delayed native settlement, coalescing, initial-failure
recovery, and timer ownership. Installed convergence and cooperative Primary
handoff remain separate acceptance work.

### Consumer synchronization status, September 17, 2026

Freed Desktop reports enrollment, edits waiting to upload, edits awaiting Primary
acceptance, and accepted changes awaiting canonical application from native
SQLite state. Successful transport does not imply all edits have synchronized or
that the Primary is online. Checkpoint revision remains the operation anchor;
sync events report the verified local canonical revision separately. Native
settlement and Desktop presentation tests cover these distinctions. Installed
two-host acceptance remains open.

### Cooperative handoff recovery under development, September 18, 2026

The cooperative handoff implementation preserves old signed consumer intents
in a device-local archive before installing a new enrollment request. Recovery
inspection verifies original operation signatures and complete canonical
per-operation receipts to establish acceptance after checkpoint replacement.
An original authority's signed rejection is reported as historical evidence.
A successor's stale-epoch rejection cannot establish the original outcome.
Missing or contradictory evidence never authorizes automatic reissue.

Native and shared fixtures cover these boundaries. Explicit edit recovery,
PWA persistence parity and installed convergence remain open;
this work does not establish readiness to move the Primary to another host.

The registered transaction review reader now connects original signature and
outcome verification to a bounded Desktop view. Each continuation is bound to
the archive, signed transaction, Library generation and canonical revision.
This adds inspection, not automatic replay or cross-epoch admission.

Desktop archive reads now support acknowledged native cancellation and a
30-second queue/execution budget. Cancellation affects dedicated read snapshots;
it cannot interrupt or roll back a durable authority transfer. Successor recovery parity and complete edit recovery remain unfinished.

Desktop now has an explicit Apply again action for complete archived read,
saved, archive and liked assignment transactions. Native verification and key
custody precede one atomic replacement/link commit; response-loss retries return
the stored identity without signing again. Review pins canonical and local
optimistic revisions. Other edit types still need their original editors.
Native fault and cross-runtime byte fixtures cover the new boundary; repeated
transfers, PWA parity, full transfer UI and installed Mac acceptance remain open.

Reopened archive review now shows an existing replacement receipt without
submitting another mutation. That local receipt remains separate from proof of
Primary acceptance. Older archive discovery and repeated transfers remain open.

Native consumers can now archive another verified direct successor after a
completed reenrollment cycle. The prior receipt must exactly match the retained
actor request. Archive creation and lifecycle replacement share one transaction;
source, target and unfinished recovery fences remain protected. Fault fixtures
cover rollback, restart, retained old archive bytes and replacement links.
Older archive discovery, recovery across older epochs, PWA parity and installed
Mac acceptance remain unfinished.

Freed Desktop now discovers retained recovery archives through a bounded native
query and lets the owner select an older archive for transaction review. Pages
use the archive primary key and bind continuations to the current handoff,
Library generation and canonical revision. A new archive invalidates the old
continuation. Displayed counts describe stored edits, not acceptance. Explicit
reapplication across older transfers and PWA persistence remain unfinished.

Explicit read, saved, archive and liked recovery now accepts older-transfer
archives under the currently admitted consumer enrollment. Original retries
retain their first replacement receipt. Recovering a replacement that was later
archived requires its own review and explicit action. Native fixtures cover
both paths and preserve per-transaction linkage. Other edit types, PWA parity,
complete transfer UI and installed host acceptance remain unfinished.

A native editor recovery submission path now validates complete newly signed
editor transactions and commits them with their archive links. It refuses
changed targets, incomplete member sets and retroactive linkage of an unrelated
stored intent. Original-editor UI integration remains unfinished; this path does
not yet expose recovery for additional edit types to the owner.

Recovery review pagination now accepts independent canonical and local edit
counters, fixing continuations after offline changes. A changed counter still
requires a fresh review. Exact editor payload delivery remains unfinished.

Native recovery review now provides opt-in exact original envelopes through
byte-bounded pages for offline editors. Tests cover cursor-mode isolation and
large escaped payloads without truncation. Editor UI integration remains open;
this does not yet add owner-facing recovery for other edit types.

RSS feed-name recovery now opens an offline editor from verified original
payloads. It shows archived and last-synced names, requires every transaction
member to be reviewed, and stores revised names only after an explicit action.
It reuses the existing RSS transaction builder and signer, retaining signed
bytes through response-loss retries. The native submission atomically links the
replacement to the archive. Other editor families, PWA parity, complete transfer
UI and installed Mac acceptance remain unfinished.

Composite annotation recovery now opens an offline editor for complete annotation
transactions. It preserves item notes, quoted highlights, tags and stored-text
references while allowing explicit revisions. Last-synced comparison reads only
the selected item. Submission requires visiting every item and retains signed
bytes across retries. No URL preview or content fetch occurs. Other edit families,
PWA recovery, complete handoff UI and installed host acceptance remain open.

Native source adoption now verifies a staged direct successor against the stored
source consent and bounded remote checkpoint proof, then atomically installs a
consumer receipt and demotes the old Primary. Offline fixtures cover later
checkpoint generations, changed-stage refusal, late-write rollback, reopen retry
and successor enrollment with a retained key and new actor incarnation. Provider
and canonical writer gates stay closed on the demoted source. Desktop coordination now downloads through the shared staging reader without
claiming activation, then invokes native verification. A committed demotion retry
reuses its durable request without another download. The complete transfer UI and
installed acceptance remain unfinished. Previously promoted
sources with incompatible retained consumer history remain fenced pending recovery.

The first transfer panel now connects signed readiness and consent exchange,
source pause and authorization, target staging and activation, and source adoption.
It also appears on fenced startup and recovers saved phases after restart. Native
role notifications update the app before services resume. Settings no longer offers
legacy takeover, and the local-winner conflict shortcut refuses it. Complete
transfer acceptance remains open, including target cancellation before consent,
and repeated transfers with retained history.
The browser restart fixture uses mocked native receipts and is not installed proof.

Saved transfers can now reconnect Google Drive from the fenced startup panel.
Credentials-only sign-in preserves the handoff pause and starts no ordinary sync.
Canceling or closing a pending sign-in preserves previous credentials and rejects
late OAuth results. The owner retries the transfer step after sign-in succeeds.

The remaining direct writer reassignment routes are removed from Desktop and the
shared native command catalog. Retired sidecar calls fail without database changes.
Cooperative handoff retains its fenced installer and historical certificate reader.
This closes the legacy entry points; installed transfer acceptance remains open.

Source cancellation now retains the exact readiness and cancellation time in a
local ledger, atomically with restored admission. A canceled readiness stays
retired after restart and after another transfer replaces the current lifecycle.
Target cancellation still requires a verified source proof exchange; that workflow
and installed transfer acceptance remain unfinished.

Source cancellation now signs and retains its proof in the admission-restoration
transaction. Failed key access or proof persistence leaves the source fenced;
restart retries reuse the stored proof without needing the key. The transfer
panel exposes the receipt after restart. Target cancellation verification now restores consumer operation only after exact
native proof and role readback. Same-epoch checkpoint catch-up preserves the proof.
Fresh preparation retains the pending key and retires the old readiness identity.
Canceled consumers now follow a verified direct successor while retaining their
cancellation proof and offline intent bytes. Edits remain fenced until archival
and explicit reenrollment finish. A successor that reuses locally canceled
readiness is rejected. Recovered-consumer promotion and installed multi-device
acceptance remain unfinished.

A settled, reenrolled consumer can prepare as a later handoff target. Native
preparation verifies its exact committed recovery receipt and current enrollment
before replacing the completed lifecycle record. Archives and replacement links
remain intact. Completed recovery lookup uses an indexed Library, epoch and
receipt-digest key, verifies exact retained request bytes and rejects ambiguity.
The transfer fence still blocks edits until verified cancellation or activation;
recovery metadata alone grants no admission. The transfer panel keeps bounded archive discovery and verified review available
during transfer and after promotion to Primary. These views are read-only;
Primary reapplication remains unfinished.

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

A demoted former Primary can prepare a return transfer after its successor accepts
its consumer enrollment and its edits settle. Native preparation verifies the
signed successor and exact demotion receipt, then retains that proof and installs
the new target fence atomically. A failed write preserves the old fence; restart
reuses the saved readiness. This does not activate the return transfer. Complete
round-trip and installed Mac acceptance remain pending.

The activated target also exposes the source preparation form for a subsequent
transfer. The form requires the current Primary role and completed activation;
a staged target cannot start another transfer.

Native lifecycle coverage now exercises a complete return transfer after the
successor accepts the former Primary's consumer enrollment. It verifies the new
source fence, final checkpoint, signed authorization, staged target, immutable
manifest and checkpoint proof, activation using a retained historical authority
key, second demotion, checkpoint-digest convergence and restart recovery. Old
archive bytes survive. The second consumer can enroll and durably enqueue a
signed edit; retry after restart returns the same intent. This uses isolated
SQLite copies and synthetic transport evidence. Live HTTP, installed multi-device
and Mac acceptance remain pending.

A former Primary keeps archive discovery after demotion, even without a current
consumer recovery summary. Once enrolled with the successor, it can explicitly
reapply supported historical edits through the same atomic replacement link.
Native admission requires the completed demotion, selected successor checkpoint,
active consumer actor and closed writer admission. An active Primary still has
read-only archive review.

The shared TypeScript successor verifier now matches a native-produced handoff
certificate, including the epoch and complete certificate digests. It checks the
closed fields, pinned predecessor and enrolled target key, compatibility versions,
predecessor authorization and all target possession signatures within a bounded
canonical input. Native Rust, Node Web Crypto and headless Chromium verify the
same fixture. Shared hex parsing now rejects trailing newlines with exact-length
checks. Browser checkpoint activation now verifies a direct successor against
the locally accepted predecessor and enrolled target key before replacement.

Browser storage now recognizes the same physical schema 2 local recovery catalog
as native storage, while logical checkpoints remain schema 1. It verifies exact
version/hash pairs and catalog declarations without upgrading during ordinary
open. The migration helper requires an owned FULL write transaction, so a failed
recovery write also rolls back tables, metadata and the physical version. Worker
status reports the actual physical identity. Existing intent and archive rows
survive same-epoch checkpoint replacement and rollback in both physical versions.
The previous engine from the fetched dev commit refuses the upgraded SQLite
file. OPFS browser-restart acceptance remains unfinished; schema support alone does
not establish installed compatibility.

Direct-successor activation binds asynchronous signature verification to the
selected predecessor and staged authority record, then rechecks that proof inside
the write transaction. The receipt must name the signed target, and the checkpoint
cannot predate the authorized source revision. Old enrollment, intent bytes, actor
counters and optimistic state survive activation and rollback. Editing remains
fenced by the old enrollment epoch. Explicit archive and reenrollment are now available through Settings. Archived
edit reapplication remains unfinished; another transition refuses unfinished recovery.

Browser archive storage now streams the native row format with exact SQLite
integers, floating point bits, text bytes and binary values. Rust and WASM agree
on cell bytes and the complete empty-library archive digest. Storage tests cover
retry without writes, live-row changes, transaction indexes, pending and published
counts, corruption and rollback. The engine recovery lifecycle uses this helper;
OPFS restart acceptance remains unfinished.

The browser engine now prepares recovery by verifying the selected successor and
a new enrollment request signed by the retained actor key. It stores the archive
and exact prepared request in one transaction. Explicit commit verifies the
archive, retires old active slots and installs that request atomically; the archive
remains intact and editing waits for successor enrollment. Engine tests cover
response-loss retry, engine reconstruction, stale verification, corrupted archives
and rollback. Repeated cycles and OPFS restart acceptance remain unfinished. The key vault can derive recovery actors
without replacing its original key record.

Settings now offers explicit enrollment with the new Primary through closed worker
commands. A retry resumes the exact prepared request without signing another;
committed recovery returns its existing result. The retained key signs new edits
with the recovered actor identity, while stale epochs refuse signing. The control
reports preserved pending and published edits and does not resend them. Focused
tests cover duplicate clicks, missing keys and ambiguous commit responses. A
narrow-screen Chromium check covers the real control with a mocked lifecycle;
it does not establish OPFS persistence or installed acceptance.

Browser recovery can replace a completed prior consumer lifecycle after matching
its committed receipt to the exact retained enrollment and verifying the full
historical archive. The prior archive stays intact; lifecycle replacement and
creation of the next archive share one transaction. Focused tests cover receipt
drift, corrupted rows, unfinished recovery, time regression and late rollback.
These synthetic local-history tests do not establish two signed transfers or
OPFS restart acceptance.

The native return-transfer fixture now supplies a linked pair of signed handoff
certificates. Rust and TypeScript independently verify both, including their
predecessor digest and key continuity. Browser engine recovery follows both
certificates with distinct actor incarnations, retains the first archive and
retries the second commit without writes. That test installs selected checkpoint
rows directly; full checkpoint transport and OPFS restart acceptance remain open.

A PWA with old edits awaiting recovery can refresh checkpoints within its already
accepted successor epoch. A fresh signature proof binds the retained predecessor,
current authority and staged certificate, then is checked again inside activation.
The refresh preserves archived and live old edits, rejects revision or checkpoint
generation regression, and keeps editing fenced. Historical authority records must
remain unchanged so later recovery can still verify the original work.

Native checkpoint refresh now preserves the exact Library ID, epoch number and
certificate digest of both current and historical authority records. The existing
handoff recovery test rejects changes to these fields and the authority key while
preserving the original consumer enrollment through rollback.

PWA Settings now lists recovery archives on demand after recovery preparation or
commit. It holds eight rows at a time, replaces each page when advancing and drops
late responses after close. Counts identify pending and published work at archival;
they are not acceptance receipts. The query uses the shared generated SQL and cursor
format, rejects stale lifecycle or Library sources, and validates the lookahead row.
Verified transaction review is now available; explicit reapplication remains unfinished.

Browser recovery now exposes bounded archived transaction identity pages using the
same generated query and cursor contract as native. Archive digest and source
changes invalidate continuation. This discovery path performs no writes and makes
no claim about original signatures or Primary outcomes. Duplicate-safe browser reapplication remains required.

Browser verified recovery review now follows the native evidence contract. It
checks original enrollment and operation signatures, requires complete canonical
receipts for acceptance, and distinguishes a signed original-authority rejection
from unresolved history. Native-produced archive fixtures yield matching browser
responses. The read snapshot survives asynchronous verification and later worker
commands wait for it to close. Settings shows one bounded comparison page without
resigning or submitting old edits. Browser reapplication and installed acceptance
remain required.

The browser intent persistence boundary now binds fresh writes to this installation's
current completed enrollment and recovery lifecycle. It rechecks these facts with the
actor tip and capability in the same write transaction. Late actor-counter failures
roll back the intent, members and optimistic state together. Exact pending or published
retries preserve their original behavior. Recovery linkage still needs integration
with this transaction boundary before browser reapplication is available.

The browser worker now has an atomic recovery replacement command. It verifies the
original archive and outcome, pins the reviewed Library generation, canonical revision
and local optimistic sequence, requires the current successor enrollment, and preserves
the complete ordered operation and target set. Fresh intent rows and their durable
archive link share one FULL SQLite transaction. A link-insertion failure rolls all new
intent state back. A stored link resolves response-loss retry before current enrollment
or source checks, including after replacement settlement. The client validates the
returned receipt and does not automatically replay an ambiguous mutation. Settings now offers explicit assignment recovery after every member has been reviewed
at one source snapshot. The action rechecks the verified archive before signing and
uses the existing shared transaction builder with the retained browser key. Read,
saved, archived and liked assignments receive fresh action timestamps; unsupported
members or missing items refuse the whole transaction. A response-loss retry retains
the exact finalized bytes, while reopening first checks for a durable replacement
before signing. Other edit families still need their original editors. This does not
establish OPFS crash recovery, installed convergence or new-host readiness.


Browser recovery also opens an explicit RSS name editor for complete feed-name
transactions. It verifies original envelopes, loads each existing feed's last-synced
name from local SQLite, and allows revised names without fetching feed URLs. The
editor displays eight fields at a time and requires every field to be visited. It
warns that last-synced names omit pending edits and that a replacement may override
newer or queued names. Missing feeds, mixed families, changed Library source or
incomplete member sets refuse the whole action. The shared browser action boundary
retains finalized bytes and locks revised names across response-loss retry. Other
RSS operations and remaining editor families are still open.


Browser annotation recovery now uses the same note, highlight and tag fields as
Freed Desktop. It retains the complete archived set, including unloaded stored-text
references, and shows one last-synced item comparison at a time. Every item must be
visited before explicit submission. Changed Library state, missing items, mixed
families or unsupported outer blob members refuse the entire transaction. Revised
sets are copied before signing and stay locked across an ambiguous response; retry
uses the same finalized bytes and durable replacement link. Last-synced comparisons
omit pending annotations, and the editor warns about replacing newer or queued sets.
Other operation families and mixed transactions remain unfinished.


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

Freed Desktop can explicitly recover archived RSS unsubscribes through the same
atomic native recovery link used by other edited replacements. The review preserves
every feed and the original keep-articles or delete-articles scope. Deletion requires
confirmation that includes articles arriving after the original edit or before
Primary acceptance. Lost-response retries retain the same signed transaction.
Missing subscriptions do not prove that the original edit was accepted. Installed
acceptance and the full authority-transition validation remain incomplete.

Browser enrollment installation rechecks the selected authority and exact pending
request inside its write transaction after asynchronous signature verification.
A changed request or authority leaves enrollment and actor counters untouched.

Browser enrollment accepts an exact signed grant already delivered by a native
checkpoint, reusing its stored capability ID after checking actor identity and
permissions. Conflicting identity or extra permissions abort the transaction.
A native-generated protocol fixture now proves browser incremental convergence
through partial pages, engine reconstruction, duplicate delivery and signed
acceptance, including the complete logical checkpoint digest. This uses in-memory
SQLite; real OPFS acceptance of these replacement edits and installed multi-device
acceptance remain unverified.

Freed Desktop can explicitly reapply archived item deletions after reviewing the
complete original target set and confirming deletion. Absent targets remain
visible and are not dropped or treated as proof of acceptance. Bulk deletions
retain their original targets rather than reevaluating a filter against newer
items. The new signed transaction and recovery link use the existing atomic
native commit, and lost-response retries reuse the exact signed replacement.

Browser recovery now offers explicit item deletion review with the same fixed
original target set as Freed Desktop. Every target remains in order, including
absent items. Confirmation precedes signing, and a lost-response retry reuses
the same signed replacement through the durable recovery link. This does not
reevaluate an old bulk filter or include later Library additions.

Desktop and PWA feed renames use the registered RSS title assignment. A rename
does not resend polling settings, fetch history, or other feed metadata from a
stale replica. Previously archived full-record edits remain preserved and need
their own explicit recovery editor.


Freed Desktop and PWA share explicit recovery for archived full-record RSS edits.
Existing subscriptions start from last-synced settings beside archived values,
retaining current fetch history and sample provenance. An absent subscription can
be recreated under its exact archived URL, initially with polling disabled and
without old fetch history. The recovery query distinguishes absent, present and
deleted targets at the reviewed canonical frontier; absence does not establish
whether the original edit was accepted.

Every subscription must be visited and the proposed settings confirmed. One signed
replacement preserves every ordered member and uses the existing atomic recovery
link; lost-response retries reuse its exact bytes. Both write owners refuse
tombstoned targets before persistence. Platform-specific signing and linkage stay
separate, and this action never removes a deletion record.

Archived account-link recovery on Desktop and PWA now reviews the current and original
person links before creating a fresh assignment. It reuses bounded person search,
keeps the complete ordered account target set, requires all accounts to be
reviewed, and clears confirmation when a selection changes. Missing accounts
refuse recovery; missing original people require another selection or unlinking.
The normal registered builder signs replacements without ordinary enqueue, and
the existing native or browser worker transaction atomically stores the intent and recovery link.
PWA preparation also rechecks each selected person before key access and retains one finalized action across retries. Other Friends recovery editors remain unfinished.

Offline handoff replay now covers expired credentials during saved-proposal reads
and CAS, plus cancellation after reading the cloud winner. Repeated fixed-fixture
runs assert the same proposal/read/CAS order, unchanged proposal identity, closed
writer admission, and explicit retry with refreshed credentials without staging
another checkpoint. These tests exercise production TypeScript orchestration
with mocked native and cloud adapters; live transport and installed acceptance
remain separate requirements.

Freed Desktop and PWA can explicitly recover archived Person deletions through the existing
bounded deletion review. It preserves every original target, including absent
people, and requires confirmation that deletion also removes notes, reach-out
history and accounts linked at Primary acceptance. Current labels come from
source-pinned Person detail queries. The registered Person deletion builder signs
one whole replacement; the existing atomic recovery link owns persistence and
exact retries. The remaining Person/Friend editors are unfinished.

Recovery review distinguishes present, absent and deleted Person targets through
indexed lookups at the reviewed source. Tombstones take precedence over live rows.
Native and PWA recovery refuse fresh Person upserts and Friend replacements that
target a deleted Person before storing intents or recovery links. An existing
durable replacement remains retrievable after a later deletion. This supplies the
state and write guard needed by the unfinished Person/Friend recovery editors;
it does not offer restoration of deleted people.

Native follower enqueue now enforces the same registered transaction member limit,
operation family and entity type as the Primary and PWA before storing a new
intent. In particular, an atomic Friend replacement contains one member. Rejected
transactions do not advance the local actor counter or create optimistic state.
Existing durable recovery links remain readable on retry.

Desktop Person root recovery now has a source-pinned editor that preserves complete ordered records, starts existing people from current values, refuses tombstones and leaves absent people's avatar URLs empty. Signing snapshots selected values before key access and uses the normal registered builder; existing recovery linkage owns durable retries. Focused tests cover tag review, immutable inputs and response loss. The Desktop headless workflow verifies explicit confirmation and exact retry after a simulated lost response; native IPC is mocked. PWA uses the same Person form and a bounded source-pinned loader; its recovery action snapshots selected roots and retains finalized bytes across retries. Installed acceptance remains pending. Friend replacement recovery remains unfinished.

Person recovery reads the complete editable root through person_root_v1 on native and PWA SQLite. The query preserves up to 4,096 tags within the canonical 65,536-byte root limit, rejects overflow before returning a partial record, and excludes child history. Both recovery loaders use this query instead of the truncated display detail.

Ordinary Person and Friend editor reads also use the complete root. Bounded history and account context must match its generation and revision before an editable record is returned; stale combinations fail instead of losing tags outside the display window.

Friend recovery admission now refuses selected Account IDs with deletion tombstones inside the same transaction that creates the replacement intent and recovery link. A previously committed replacement still returns its exact receipt after later deletion. The complete Friend recovery editor remains unfinished.

A native-produced Friend archive with a signed enrollment certificate now verifies through PWA recovery without substituting the original transaction. The test covers deleted-account refusal, unchanged archived bytes, and exact retry after a later deletion and revision change. Successor admission uses synthetic local receipts; this is not installed handoff or OPFS evidence.

Desktop now exposes a Friend recovery form that reviews the Person and complete bounded account selection before signing one replacement. Omission and account-move effects require confirmation; no images load in the form. The action snapshots selected roots before key access and uses the existing atomic recovery link. Complete oversized-record coverage remains unfinished.

Friend account construction and validation now use UTF-8 binary ID order on Desktop and PWA, matching native verification. Shared mixed-case and Unicode vectors cover locale and UTF-16 ordering differences. Existing signed envelopes are not reordered or rewritten.

PWA Settings now exposes the shared Friend recovery form. Desktop and PWA share one bounded, revision-pinned context reader. The browser action verifies the original scope, snapshots selected values before key access, and retains the finalized replacement across ambiguous responses. Focused tests cover retry identity and absence of ordinary enqueue. Desktop headless browser coverage now verifies both review steps, complete account-page review, confirmation reset, omission warnings and identical signed-envelope retry after a simulated lost response. The rendered form was inspected. Native IPC and signing are mocked in this workflow. A separate PWA browser harness verifies the platform editor wrapper at phone width, including one retained action across response loss, locked editing and completed account review. Its verification and signing boundaries are mocked; the full PWA Settings/archive workflow, oversized-context coverage and installed acceptance remain pending.

Friend recovery now reads complete Account roots through `account_root_v1` on both runtimes. Native SQLite and browser SQLite tests preserve a 20,000-character field and reject oversized roots; optional roster fields retain their types. This closes the Account display-field limit. Linked-account paging is described below; installed acceptance remains unfinished.

The registered Person account-ID page query now reads through the existing index with a revision-bound cursor. Native and browser SQLite tests enumerate 130 links; Friend recovery no longer depends on the Person display projection. The shared editor now reviews large current-link sets in eight-account pages, starts them unselected, and retains at most 64 selections. Every current page and archived account requires review. Stale pages block submission; the final replacement remains one bounded signed transaction.

PWA archive verification now has a separate read-only path for the former locale-based Friend account order. A real Ed25519 test verifies untouched historical bytes and rejects reuse through normal assembly, signing and verification. New replacements remain strictly ordered. PWA WASM SQLite coverage now verifies a signed historical enrollment and out-of-order original, commits a correctly ordered fresh replacement, refuses deleted selections without writes, and returns the same durable link after revision changes while preserving archive bytes. Successor admission is synthetic; this is not cloud, OPFS or installed-build proof.


Account deletion recovery now uses the existing paged deletion review on Desktop
and PWA. It retains every original ordered target, including duplicates and
currently absent Accounts, and reads current labels at the reviewed Library
revision. Explicit confirmation covers account details and links changed before
Primary acceptance. It removes Library records without deleting provider accounts
or linked people. New signatures use the ordinary Account removal builder; the
existing recovery transaction owns intent and linkage atomicity. Ambiguous retries
retain the same signed bytes. Focused loader, signing and component tests cover both
platforms; a Desktop Settings browser test covers confirmation and response loss
with mocked native commands. This is not installed or OPFS acceptance.


Full Account recovery now has a native and browser write guard against Account
tombstones. It runs after exact durable-link lookup and before enqueue, so a
fresh replacement cannot recreate a deleted Account and a later deletion does
not invalidate an existing replacement receipt. Native signed fixtures and a
PWA WASM SQLite test with real historical enrollment and operation signatures
cover refusal without writes, unchanged archives and exact retry. These checks do not prove installed or OPFS behavior.


Full Account recovery is available in Desktop and PWA Settings. The shared form
reviews one complete record at a time, starts from current details when present,
and offers archived details, contact-field edits, unlinking and avatar clearing.
Every original ordered target remains, including duplicates. Changes clear the
explicit whole-record confirmation. Missing records start without avatar URLs;
the SQLite boundary refuses deleted Accounts. Selected person links must exist
at the reviewed source before signing.

The loader uses complete `account_root_v1` rows, with at most the registered
Account member limit and 64 KiB per root. Field edits cannot retain an oversized
root. Original and finalized transaction byte limits remain enforced. This is a
bounded design, not measured global renderer memory admission. Both platforms
reuse ordinary Account member builders, retain finalized bytes on ambiguous
responses and use atomic recovery linkage. Desktop browser coverage exercises
Settings entry, complete review, field edits, confirmation and exact retry with
mocked native commands. Installed and OPFS acceptance remain separate.


Reach-out recovery now refuses a replacement when the original event ID remains
in current history, independently on native and browser write boundaries. The
whole transaction refuses without intent or linkage writes; an existing replacement
receipt remains available on retry. Missing history does not prove failure because
only the latest 20 events are retained. Desktop and PWA now provide explicit reach-out editors.


Reach-out recovery compares each archived event with last-synced recent history,
requires every event to be visited and confirmed, and preserves historical dates
while signing a new action. Revised values are snapshotted before signing and
response-loss retry reuses the exact replacement. No message or provider request
is sent. Focused editor and signing tests pass; full feature, installed acceptance
and maximum legal detail coverage remain separate requirements.


Preference recovery now enforces the original object assignment paths inside
native and browser write transactions. Added, dropped or collapsed object paths
refuse before intent writes, while durable replacement receipts remain available
on retry. Historical import coverage remains unfinished.


Native fresh preference writes now use the generated field policy, with shared
vectors proving nested field, array and map behavior against the PWA sanitizer.
Unsupported writes refuse without preference or actor-counter changes; historical
signature inspection remains separate. Finite fractional weights now validate and
read consistently on both platforms, using the existing binary64 wire encoding.
Stored preference nodes and signed archive bytes remain unchanged. Recovery treats
encoded numbers as scalar assignments, including fractional-to-integer changes.
Historical canonical import coverage remains unfinished.

Preference recovery now has shared read-only comparison context. Both platform
loaders preserve member order and compare exact assignment paths against one
source-fenced snapshot, distinguishing stored settings from defaults. Arrays
remain whole assignments and empty groups remain in the original patch. The
Desktop and PWA Settings forms now connect this context to signing adapters. They
retain every ordered patch, snapshot inputs before asynchronous work, and reuse
the normal preference member builders. The PWA checks original assignment scope
before signing and retains the exact request after an ambiguous response.

The preference recovery form requires review of every setting and explicit
confirmation. It compares archived and current values, preserves whole-array
assignments and empty groups, and clears confirmation whenever a value changes.
After signing, the form locks its inputs and retries the same replacement after
an ambiguous response. Focused platform tests and the Desktop browser workflow
pass. Installed Mac acceptance and full multi-device convergence remain pending.


PWA historical preference verification now matches the native historical field
policy while fresh writes retain the current policy. Archive review preserves
authenticated old fields, and incremental catch-up checks the authority-signed
acceptance receipt before materializing them. Historical constructions cannot
be finalized or reused as fresh verified transactions. Shared cryptographic and
PWA SQLite tests cover unchanged bytes, mixed-member completeness, device-local
exclusions, tampering, mismatched receipts and exact retry. Live cloud joining across versions and installed Mac acceptance remain unverified.

The Rust historical validator and shared verifier also pass the same 32 policy
cases, covering all historical sections and device-local exclusions. This is
policy parity; installed Mac proof remains separate.

A signed historical preference fixture now comes from published native source
`v26.9.1700-dev`. Current native SQLite and PWA preserve its envelope and acceptance
receipt, replay duplicate pages, and match its final revision, actor frontier and
checkpoint digest. The original zero-operation descriptor remains intact; the
tests explicitly check current carried-frontier normalization at that baseline.
Checkpoint admission is synthetic, and this does not prove live cloud joining
or an installed build.

Preference recovery now reads only the selected setting through a source-bound
query shared by native SQLite and the PWA. The form retains one current value,
requires each comparison before confirmation, cancels abandoned reads and keeps
the same prepared edit after response loss. Group summaries cannot be used as
replacement values. Native/PWA fixture tests cover oversized unrelated trees,
exact values and invalid rows; a headless Desktop workflow verifies two scoped
reads and identical retry submissions. Ordinary startup still has the global
preference snapshot limit, and installed Mac acceptance remains incomplete.

Primary ranking now retrieves only the weights needed by each bounded candidate
batch. Native SQLite and PWA share a grouped read with exact source checks;
Desktop uses it without retaining a full weight map for the pass. Tests cover
large candidate scopes, long literal IDs, stale chunks, numeric validation and
preference changes during an in-flight batch. Startup still uses the global
preference snapshot, and installed Mac acceptance remains incomplete.

Ranking invalidation now compares a compact, indexed preference revision and
materialization generation instead of the renderer's full weight-map identity.
Native and PWA expose the same bounded marker. Preference changes during a pass
and checkpoint replacement request another pass; item-only writes do not change
the marker. Failed completion reads remain retryable. Startup's whole-preference
snapshot limit still needs removal.


Native checkpoint admission now recognizes a completed consumer recovery when a
later verified successor is selected. It checks the retained enrollment receipt,
new predecessor-signed certificate, selected writer and original archive before
accepting the checkpoint. Missing receipts, changed writers and corrupted prior
recovery evidence refuse admission. Local fixtures cover this admission boundary;
installed repeated-transfer acceptance remains pending.


An empty native recovery catalog no longer blocks ordinary consumer checkpoint
refresh. The signed-intent fixture now runs against both physical schemas 1 and
2, including activation rollback, preservation of pending edits and revocation
of stale Primary/provider admission. Existing handoff rows still enforce their
phase and proof checks.

Dormant physical schema 3 stores device-local pending preference effects without
changing logical checkpoints or replication protocol 2. Native and browser
fixtures cover signed backfill, atomic receipt settlement, checkpoint replacement,
successor recovery and retry after injected failures. Original signed intents and
recovery archives remain intact. Production openers still refuse schema 3; these
fixtures do not authorize migration or prove installed durability.

The native return-transfer fixture now sends a third consumer through the full
second-successor checkpoint path. It first catches up the predecessor enrollment,
then verifies rollback after a late checkpoint failure, retry, same-successor
refresh, a second immutable archive and explicit reenrollment. The consumer
regains edit admission without Primary or provider admission, and its first
archive remains byte-identical. This is local physical-schema-2 evidence;
installed acceptance remains pending.

The dormant schema 3 variant now migrates an enrolled consumer with a real signed
pending preference assignment before that second transfer. Late projection-restore
failure rolls back the checkpoint; retry preserves signed members, the actor tip
and derived effects. A second explicit recovery archives the old slots and clears
the projection atomically, with exact commit retry and the first archive intact.
The fixture also admits the real successor-signed enrollment certificate and
commits a fresh preference edit under the new actor. Enrollment and edit retries
preserve the actor tip and older archive; Primary and provider admission remain
closed. Schema 3 remains dormant in production.

Offline consumers now attempt one authenticated predecessor checkpoint before
admitting a direct successor whose target enrollment they missed. Desktop and
PWA use the same bounded downloader and coordinator. The native or worker read
command verifies all handoff signatures against locally selected authority;
the returned download reference grants no enrollment or writer admission.
Activation independently reconstructs the proof, checks the signed receipt and
source revision, and verifies the installed digest before commit. Ordinary
successor verification then requires the enrolled target as before.

The shared coordinator performs no recursive epoch search or new retry loop.
Cancellation, expired tokens, missing objects and mismatched digests refuse
activation. A retry after a lost predecessor commit response consults durable
runtime state. Native fixtures preserve pending signed edits through rollback
and successful import; the browser fixture downloads and verifies the signed native manifest and 29
compressed pages through the shared coordinator into real SQLite. A lost response
after the actual predecessor commit retries from durable state with no second
download, then admits the successor. These fixtures do not establish OPFS
process-restart durability or installed cross-device acceptance.

Browser successor refresh resolves the cloud writer from the unique active
Desktop actor, matching native checkpoints with the local writer label
`primary:desktop`. The follower receipt must name that actor. The later missed-transfer evidence
below extends this direct-transfer path and records synthetic large-checkpoint
admission. OS-crash boundaries and installed Mac acceptance remain unverified.

### Replica audit evidence, September 30, 2026

Desktop and PWA Settings now expose an explicit canonical replica audit. Its
receipt binds the existing checkpoint export descriptor and freshly computed
checkpoint digest from one read snapshot. Compare receipts at the same Library,
epoch and revision after pending edits settle. Matching counts or a prior import
receipt alone are not convergence evidence. Installed multi-device acceptance
and the separate zero-consumer-capture ledger remain required.

### Consumers that missed multiple transfers, September 30, 2026

Desktop and PWA authenticate a bounded chain from their selected authority to
the current successor. Each attempt accepts at most 32 signed transitions and
reads the exact immutable predecessor checkpoint for each transition. Historical
checkpoints are staged without selecting intermediate authorities. Final import
verifies their canonical contents and historical target enrollments before
replacing selected rows. Original enrollment and pending signed edits remain
available for explicit recovery; old edits are never automatically re-signed.

Native and PWA tests cover two real signed transitions, missing or changed
history, failed cleanup, retained state and response-loss retry. Consumed stages
are deleted in the successful activation transaction; failures retain them for
resumption and unrelated staging survives. Longer histories currently refuse;
resumable traversal beyond 32 transfers remains unfinished. Abandoned staging
has no automatic age-based deletion. Representative-size latency, installed
cross-device acceptance and actual new-host transition remain pending.

A signed two-transfer fixture with 100,000 synthetic FeedItems passes native
activation, late cleanup-failure rollback and retained pending-row checks. The
PWA activates the same history through its production OPFS worker and retains
the exact canonical digest after a full browser restart. Native and browser
audits agree. Synthetic cloud receipts and Linux execution do not establish
live-cloud or installed multi-device acceptance.

### Old Primary recovery after later transfers, September 30, 2026

An old Primary that authorized a transfer and then stayed offline can adopt a
verified later successor. Desktop stages at most 32 authenticated historical
checkpoints without activating intermediate authorities. Native adoption pins
the first signed transfer to the original consent and the final selection to
the verified cloud winner. Consent, original target identity and signed history
remain intact. Failed verification or cleanup leaves the old Primary fenced.

The native two-transfer lifecycle covers consent tampering, failed cleanup,
retry, database reopening, explicit successor enrollment and preparation to
receive authority again. Adoption alone grants no edit or capture rights.
Installed multi-device acceptance and actual host transition remain pending.


### Primary archive reapplication, October 3, 2026

An active promoted Desktop Primary can explicitly recover archived edits through canonical operation resolution. Canonical state and the unique installation-local replacement link share one SQLite commit. Consumers continue to use the durable intent path. Both routes preserve original envelopes and return an existing replacement before allocating another counter, including after restart or later authority fencing. The logical checkpoint and replication protocol are unchanged; installed multi-installation convergence remains required.

### Count-free Desktop cloud preflight

Desktop cloud coordination reads a distinct closed metadata identity containing
Library, epoch, admitted writer, canonical source revision, causal frontier and
installation-local actor identity. Native code rechecks the freshly selected
Library, schema/storage identity and generation receipt inside the same read
transaction as the writer, frontier and actor checks. This identity does not
certify checkpoint exportability or traverse receipt and feed-item census trees.
Full checkpoint preparation still reads the counted descriptor and enforces its
pinned snapshot and publication admission rules. Missing or corrupt census
objects remain full descriptor/export errors. Wire protocol, schema, authority
and provider cadence are unchanged. Installed startup acceptance is pending.

### Bounded checkpoint preparation attribution

Desktop checkpoint preparation records fixed native durations for selected open,
authority admission, reaper initialization, transaction begin, descriptor identity
and census, frontier validation, temporary materialization, order-index creation,
descriptor clone, session-lock acquisition and replacement of the previous export.
The observer preserves the full counted descriptor, pinned transaction, export
order and authority checks. Existing callers retain no-op observer wrappers.

The new scope emits at most a start marker and terminal summary, sharing the
existing twelve-event rolling minute cap and one sampled in-flight trace per
scope. A fixed entered-stage mask distinguishes skipped stages from measured
zero durations. Checkpoint duration slots use hexadecimal microseconds to keep
worst-case records below 512 bytes; legacy scope log layouts and stage ordinals
remain unchanged. Logging occurs outside session and diagnostic locks. Missing
terminal evidence under a shared budget is inconclusive. No identifiers,
content, errors or thread identities are logged. Invocation queueing and native
execution-thread ownership remain unmeasured. This attribution change does not
establish an installed responsiveness improvement.

### Linked URL projection

Generated compact-card queries now return the existing linked URL separately
from the canonical post URL. Native and PWA projections preserve that bounded,
nullable value without changing the physical SQLite schema or mutation path.
