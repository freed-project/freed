# Storage Architecture Roadmap

Status: **Approved direction. Activation remains gated.**

The normative architecture lives in
[LIBRARY-CORE-CONTRACT.md](LIBRARY-CORE-CONTRACT.md). This roadmap records why
the work exists, what evidence is real, and the safest delivery order.

## Current implementation boundary

The first Gate A delivery is a dormant census. It makes the current synchronized
schema, shared store surface, Desktop and PWA worker messages, planned operation
and query vocabulary, and device-local authorities reviewable by the compiler.
It does not activate Library Core, change a writer, migrate data, or claim that
unresolved codecs, field algebra, query projections, retention limits, or the
legacy epoch bootstrap are complete.

Every planned successor remains `planned_blocked`. The combined census reports
`activationAllowed: false` until the executable contracts and one durable
legacy bootstrap transaction exist. Registry presence is not an activation
receipt.

## What the evidence establishes

On the owner's 15,846-item production document, the current Automerge and
WebKit design amplifies a small serialized corpus into hundreds of MiB of
resident memory. Larger synthetic documents scale roughly linearly. Full
document hydration, full-array derivations, binary copies, search indexes, and
provider WebViews then compete inside one memory-constrained application.

The evidence supports these conclusions:

- A paged row store can answer bounded library queries without materializing
  the corpus in the renderer.
- `WebAssembly.Memory` does not shrink, so terminating an idle legacy worker is
  more reliable than hoping its peak allocation returns to the operating
  system.
- Desktop search is built from truncated text today.
- The PWA's 2,500-item hydration cap limits the final message, not the
  full-corpus work performed before it.
- Facebook and Instagram captures have been blocked by memory pressure. Lower
  library memory can allow existing scheduled attempts to complete.

The evidence does not yet establish a universal 200 MiB renderer floor,
15 millisecond cold start, multi-million-item ceiling, or a precise amount of
memory attributable to Automerge alone. Those are hypotheses until the
process-safe attribution harness and matched fixtures measure them.

## Corrections to the earlier roadmap

The previous version contained five unsafe premises:

1. **Cloud convergence already exists.** Desktop and PWA cloud paths merge
   Automerge documents. The ETag compare-and-swap prevents one manifest or blob
   replacement from blindly overwriting another. It is not the semantic merge.
2. **Automerge cannot be deleted before replacement sync exists.** Doing so
   would turn two writable clients into divergent databases.
3. **A SQL writer flip is not independently reversible.** Rollback is safe only
   from a compatibility state proven at the same frontier.
4. **A filtered UI projection is not migration input.** Hidden records,
   truncated text, absent values, relationships, and source-head identity must
   come from an immutable raw source.
5. **A Web Worker is still a WebKit process.** The corpus leaves renderer
   memory only when the worker no longer retains it.

The implementation order below is built around those corrections.

## Engine decision

Desktop uses stock SQLite through Rust.

The PWA uses the same logical Library Core contract through a capability-tested
browser adapter. SQLite WASM with OPFS is preferred only where it proves
durability, compatibility, and bounded memory. A row-oriented IndexedDB
adapter remains the fallback. One full Automerge binary in IndexedDB is not the
fallback.

Private-corpus Automerge decoding runs only on an elected installation that
holds the current authenticated migration claim. It is resumable, uses the
external-memory decoder, stays under the fixed 384, 512, or 768 MiB tier
ceiling, and proves enough private staging capacity for source-sized runs.
Other installations bootstrap by streaming and verifying the accepted logical
checkpoint, blob roots, and operation segments. Every adapter proves public
migration vectors and its own installation-qualified, fenced device-local
source contribution. A low-memory browser does not decode the owner's full
legacy corpus merely to prove that it can run Library Core.

Turso remains rejected for this role. The measured evaluation in
[TURSO-EVALUATION.md](TURSO-EVALUATION.md) found unacceptable incremental FTS
behavior, resident memory, and silent index-maintenance failure. Adoption
depends on those probes changing, not on a version number.

## Delivery order

Each step is separately reviewable. "Dark" means code may ship but cannot own
user data yet.

| step | delivery | activation condition |
| --- | --- | --- |
| 0 | Process-safe memory attribution and matched tier fixtures | Exact build and process-generation evidence, no startup stall |
| 1 | Freeze the Library Core registries, authority, and legacy epoch bootstrap | The dormant census is complete; every synchronized field then gains executable algebra, locality, deletion, storage, operation, and query contracts; signed actor and global epoch-transition contracts are exhaustive; one durable control transaction records the initial epoch |
| 2 | Dormant Rust SQLite core and shared operation fixtures | Crash-safe complete transaction receipts, signature and fork rejection, and identical cross-platform materialization |
| 3 | Authenticated elected Automerge migration authority plus bounded device-local source contributions | Candidate registration is the first claim-bound mutation, and registration races state-correct candidate-absent abandonment and cleanup in one serialization domain; cloud claims use authenticated store time and expiry; local claims use null timestamps and never self-expire; every claim-bound source, candidate-registry, and cutover mutation uses a closed noncircular payload-bound grant; cloud source commits require the original runtime-owned process generation and live monotonic attempt handle; migration and rollback split corpus-sized prepared proofs from a maximum 65-fence, 2 MiB activation sidecar committed in one atomic authority bundle; rollback uses its own signed reservation and activation schema; full-field private-corpus diff, composite source identity, resumable receipts, changed-head rejection, and adapter fixture parity pass |
| 4 | Bounded Desktop query API | Stable cursors, explicit limits, cancellation, count and search parity |
| 5 | Desktop surfaces read verified SQL projection | No visible surface requires the full item array |
| 6 | Short-lived legacy compatibility engine | Automerge worker terminates after bounded work; provider WebViews do not overlap it |
| 7 | Dormant PWA Library Core adapter | Browser durability matrix, operation fixture parity, and bounded accepted-checkpoint bootstrap without private-corpus Automerge decode |
| 8 | Immutable operation-segment cloud sync | Two-device offline and CAS-conflict convergence through signed actors and one global authority pointer |
| 9 | Coordinated storage-epoch cutover | Desktop and PWA switch writer and protocol through one signed transition certificate; legacy clients are fenced into their retired namespace |
| 10 | Installed-build soak and rollback window | Tier memory, sync, provider extraction, recovery, export, and import gates pass |
| 11 | Automerge retirement | No supported writer needs it and roll-forward recovery is proven |

The first large memory win arrives at steps 5 and 6. SQL can serve bounded
reads while the authoritative legacy worker becomes short-lived. The final
architectural simplification arrives only after step 9.

Before step 5 completes, every full-corpus product and UI consumer must move
behind the bounded core: classification, content fetch, provider-action
derivation, product-facing cloud and LAN sync, search, Friends, map, counts,
startup maintenance, duplicate analysis, snapshot, backup, and export. The
registered short-lived legacy migration and replication bridges may remain
through Gate D until Gate E replaces them. Moving only React while another
WebKit product worker keeps scanning the corpus is not renderer eviction.

## Provider boundary

This program does not add provider requests, navigation, scrolling, clicking,
cookies, headers, or a faster schedule.

The first slice capable of turning a memory-rejected Facebook or Instagram
attempt into real provider contact is provider-observable. The owner approved
this exact effect for the existing Facebook and Instagram schedule in
`codex-task:019f4ce3-2ee3-76b2-bc0c-eb7f4958a7de`: "You are fully authorized to
continue this optimization in ways which will increase provider pull frequency
by fixing cases where we were previously unable to pull." The provider can see
successful contact where memory rejection previously produced none. The
lowest-profile alternative is to keep rejecting those attempts and leave that
data unsynced. The decision remains in scope only while cadence, retry policy,
requests, navigation, cookies, headers, and extraction behavior remain
unchanged. The first active slice must cite that exact decision and write and
validate its healthy Gate 1 artifact before publication. It does not need
another approval for the same behavior. Dormant storage, migration, and query
work remains provider-free. Any later change to provider cadence, retry policy,
request shape, WebView behavior, cookies, headers, or extraction code requires
its own provider-risk decision before implementation.

Provider extraction follows a two-phase memory boundary during migration:

1. capture results enter a durable local capture journal;
2. the provider WebView closes;
3. the library engine wakes and materializes the journal;
4. the library engine returns to its settled budget or terminates.

No in-memory handoff may require both the full legacy corpus and the provider
WebView to stay resident.

## Integrity work that cannot be skipped

The storage cutover must also repair these existing boundaries:

- Markdown export is a sharing format, not a complete backup.
- Import reports parsed items before all durable phases finish and is not one
  resumable transaction.
- Current snapshots write Automerge and contact state as separate files.
- Current destructive deduplication is heuristic and order-sensitive.
- Deletion lacks a durable row-level tombstone contract.
- Several current field policies still describe PWA convergence as absent,
  which is no longer factually correct.

These are part of Library Core correctness. They are not reasons to preserve
the current full-document architecture.

## Test and evidence routing

The following blocking-proof groups are illustrative. The closed universal
gate registry and proof requirements in
[LIBRARY-CORE-CONTRACT.md](LIBRARY-CORE-CONTRACT.md) are binding:

- transaction crash recovery;
- actor signature, retirement, fork detection, and deterministic repair;
- complete transaction-member delivery without partial materialization;
- future-clock quarantine and certified repair;
- migration claim races, response loss, interruption, and source change;
- exact payload-bound operation grants, grant-bound live source attempts,
  candidate registration versus absent-state abandonment, reservation and
  activation races, dead-claimant abandonment, state-correct absent cleanup,
  persistent registered-candidate cleanup, and deleted-payload closure;
- prepared migration and rollback proofs, signed rollback fences, exact
  prepared-proof binding, 65-fence and 2 MiB finalization boundaries, one
  atomic sidecar bundle, deadline release, and no corpus or genesis-closure
  work while fences are active;
- global epoch and same-epoch manifest races, compound authority-state
  compare-and-swap, prepared-transition recovery, and legacy fencing;
- cutover, rollback, authority recovery, and concurrent-restore receipts;
- recovery supersession for a consumed active or abandoned migration lifecycle;
- duplicate and response-loss replay;
- two-device offline convergence through authenticated branch-qualified
  manifests;
- schema and database-plus-blob snapshot atomicity, including missing and
  corrupt replicated blobs;
- bidirectional Desktop and PWA encrypted backup and restore, including
  paged-inventory bootstrap, recursive media-exclusion lineage, and busy
  same-transition descendant registration;
- complete reader lookup plans and authenticated hit, missing, or error probe
  outcomes without Cache enumeration or network fallback;
- import idempotency;
- bounded query, full semantics beyond the legacy 2,500-item cap, and activated
  4 GiB startup admission.

The private corpus, 100,000-item performance, large randomized convergence
matrix, browser compatibility sweep, and six-hour memory slope remain
mandatory evidence in dedicated or nightly lanes. They do not belong in every
ordinary feature or release workflow.

## Completion

The roadmap is complete only when:

- Desktop and PWA use one replicated operation contract;
- every visible library read is bounded;
- one atomic epoch owns writes;
- delete, offline conflict, replay, response loss, migration, rollback, import,
  snapshot, and recovery have deterministic proof;
- the installed application meets the tier budgets in the Library Core
  contract;
- Facebook and Instagram can run their existing schedule without library
  memory starvation;
- Automerge and its full-document containment machinery are removed from every
  supported writer.
