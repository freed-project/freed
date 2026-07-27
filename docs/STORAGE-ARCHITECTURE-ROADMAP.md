# Storage Architecture Roadmap

Status: **Proposed.** Nothing here is authorized to build beyond Stage 0 and Stage 1.

Every number in this document is measured on the owner's real 15,846-item document (v26.7.2300, 2026-07-24/25) unless explicitly marked as an estimate. Estimates are marked because the difference matters.

## The finding

Automerge costs about **30 KB of resident memory per feed item**, linear, metadata only. Measured: 15,846 items at 545 MB, 31,692 items at 959 MB. Those same items are 217 bytes each on disk, so the amplification is roughly 148x for metadata alone. Body text is only 44 percent of the cost and history only 17 percent, which is why compaction and pruning never converged.

The same 15,846 items in SQLite cost **3.8 MB resident**, and 100,000 items cost **3.7 MB**. Flat, because only queried rows materialise.

`WebAssembly.Memory` has `grow()` and no `shrink()`. Peak resident becomes a permanent floor for the life of the instance. That is the mechanism behind 52 WebKit memory fixes that did not converge: they tuned thresholds against an allocation that structurally cannot shrink.

## What that costs today

The renderer sits around 4.26 GB. Consequences verified in telemetry:

- **100 percent of Facebook and Instagram scrapes return `stage: "memory_pressure"`, `itemsExtracted: 0`, `itemsPersisted: 0`.** A hidden authenticated WebView cannot open without headroom. X is unaffected because it intercepts GraphQL and needs no WebView.
- **Desktop full-text search is silently broken.** `DESKTOP_UI_PRESERVED_TEXT_LIMIT = 0` and `DESKTOP_UI_CONTENT_TEXT_LIMIT = 280` mean the search index is built over truncated text and empty preserved bodies.
- **The PWA does not hold a browsable full corpus**, despite loading one. `HYDRATED_FEED_ITEM_LIMIT = 2_500` is applied *after* every full-corpus pass has run, so it caps `postMessage` size, not memory. Worst of both.

## Do we need CRDTs

No. One merge concept survives and it is not a library.

`mergeUserState` (`packages/shared/src/schema.ts:901`) contains all of Freed's sophisticated merge logic. It has **exactly one caller** (`:1192`), reachable only from dedup and capture-reconcile. **It has never run on cross-device sync.** Automerge does plain last-writer-wins there. Freed pays 30 KB per item for what a timestamp column does free.

Cloud conflict control is already the ETag/If-Match compare-and-swap in `gdrive.ts`, not the CRDT. `A.merge` exists only because the transport ships one opaque blob.

There is no sequence-CRDT use case anywhere in the schema. `content.text`, `preservedContent.text`, notes and highlights are all replaced wholesale.

What replaces it: `userState` as a bounded join-semilattice expressed as `ON CONFLICT DO UPDATE`, plus a hybrid logical clock. The HLC is not optional. Without it every last-writer-wins rule is permanently winnable by one device with a fast clock, silently, with no marker and no self-healing.

### Three bugs the current lattice already has

These are latent only because PWA to desktop convergence does not exist. Fixing convergence without fixing these would introduce them.

1. **No un-operation can propagate.** `mergeUserState` ORs the flags: `target.saved = target.saved || source.saved`, same for `hidden`, `archived`, `liked`. Once true, forever true. Un-saving on one device can never reach another.
2. **Mark-as-unread always loses.** `mergeTimestamp` returns the defined side when one operand is `undefined`.
3. **Unlike-then-relike never reaches the platform.** `likedSyncedAt` is three-state (undefined / -1 terminal / positive) and a grow-only max register cannot model it.

## Turso

**Rejected for now, on evidence from its own compatibility matrix**, not on caution. Every property it was nominated for fails:

| property | Turso COMPAT.md |
| --- | --- |
| FTS5 | No. Uses Tantivy with Turso-specific `CREATE INDEX ... USING fts` |
| `GENERATED` | Virtual columns only, no `ALTER`, requires an experimental flag |
| `changes()` / `total_changes()` | Partial, no trigger support |
| `PRAGMA recursive_triggers` | No |
| MVCC | Experimental; all statements on a connection share one transaction |
| in-place `VACUUM` / `incremental_vacuum` | Experimental / No |

> **This section's original reasoning has been retracted and replaced by measurement.** It argued the fatal flaw was that "a Tantivy index is not SQLite B-tree pages", so the escape hatch preserves data but not the search index. That objection is weak and the owner correctly rejected it: indexes are derived data, you rebuild them. Do not use it.
>
> Turso was then benchmarked properly against the real corpus. **The verdict is unchanged but the reasons are different and much stronger.** See [TURSO-EVALUATION.md](TURSO-EVALUATION.md) for the full record, the reproduction scripts, and the adoption gate. In brief:
>
> - **Incremental FTS ingest scales with index size**: 313 ms/row into a 95,076-row index versus SQLite's flat 0.20 ms/row, about 1,570x. Plain writes are fine, so "Turso writes get slower as the database grows" is the wrong summary and will send you after the wrong thing.
> - **Silent, total index corruption.** Any virtual-table module Turso does not implement causes it to open a connection with no indexes at all and skip index maintenance on every write, while reporting success. Measured: 650 writes, zero reflected in any index, stale pre-update values left indexed. Traced to a swallowed error at `core/lib.rs:1514-1519`. Unfixed on `main` and unreported upstream.
> - **Turso costs 48x more peak RSS to build an index** (+153.5 MB vs SQLite's +3.2 MB) and carries ~474 MB more resident on the same corpus. For a project whose blocker is renderer memory, that alone decides it.

**The PWA unlock is not Turso-specific.** Official SQLite WASM over OPFS delivers identical page-cache physics, at 1.0, with FTS5 and `STORED` generated columns. The physics win is *a paged store instead of a CRDT*. It was never Turso.

Decision: **rusqlite on desktop, official sqlite-wasm on the phone.** The originally planned "Turso as a read-only CI conformance track from Stage 4" is dropped: stock SQLite cannot open a Turso-FTS file at all, so the diff it was meant to generate is not possible, and a conformance track against an engine that silently drops index writes would manufacture false confidence rather than readiness signal.

Adoption gate: see [TURSO-EVALUATION.md](TURSO-EVALUATION.md). The trigger is specific probes passing, not a version number.

## The floor

Estimates, because the dominant term is not yet measured. Stage 0 exists to fix that.

| | today | target |
| --- | --- | --- |
| desktop renderer, steady | ~4,260 MB | ~200-350 MB |
| desktop renderer, during scrape | blocked | ~550-1,150 MB |
| desktop Rust, data-attributable | — | ~52 MB, flat |
| PWA on a phone | 545 MB at 15.8k, ~2.9 GB at 100k, surfacing only 2,500 | ~140-260 MB, flat, genuinely complete |
| cold start | 1,700-1,900 ms | ~15-35 ms desktop, ~120-360 ms PWA |
| scale ceiling | fails past ~50k | desktop ~2M, phone ~250-300k |

Memory stops being the binding constraint at any scale on either platform. Disk becomes the limit, which is the correct place for one to live.

## Stages

Each stage is independently shippable, reversible, and soak-verifiable. One behavioral change at a time.

| # | stage | why |
| --- | --- | --- |
| 0 | Memory attribution harness | Every floor claim has one unmeasured dominant term. Zero behavior change |
| 1 | Raw-bytes cloud IPC | `bodyToBytes` boxes a 38 MB binary as 38M JS numbers. ~300-450 MB transient per sync |
| 2 | Priority decomposed and device-local | `priority` is synced and time-decaying, so no indexed sort key can exist until this lands |
| 3 | Locality and deletion contract | Types only. Forces the field-by-field argument, and forces a deletion decision that does not exist today |
| 4 | Shadow store with continuous projector | Proves the projection lossless against real data before anything reads it |
| 5 | Feed page and counts from SQL | First surface that does not read the array |
| 6 | Search, friends graph, map from SQL | Restores full-body search, which is broken today |
| 7 | **The corpus leaves the renderer** | **The memory floor, and where FB/IG becomes structurally reliable** |
| 8 | SQL becomes the writer; tombstones | Cold start collapses. Closes the deletion hole before a second writer exists |
| 9 | Delete Automerge; **scope** the gate | Two data models become one |
| 10 | Content-addressed segment sync | PWA to desktop convergence starts existing |

### Two things to get right

**The scrape gate is scoped, not deleted.** `scrape_memory_may_proceed` is a three-term conjunction. Two terms derive from `memory_high` / `memory_critical`, which are machine-derived and still meaningful on a small machine. Only the Automerge-ratchet compensation goes.

**Stage 8 is a one-way boundary.** Once writes go to SQL the Automerge document stops receiving them. A field the projector silently drops becomes unrecoverable once the retained copy is pruned. Stage 4's nightly field-level differ exists to catch that before Stage 8, not after.

## What gets deleted

Both Automerge workers (1,819 + 845 lines), `merge.ts`, the three CRDT containment guards, all full-document transport, the idle-unload and worker-termination machinery, `feed-text-compaction.ts`, `trimFeedItemForDesktopUi`, the MiniSearch main-thread index, `store.items` and its 13 subscribers, `HYDRATED_FEED_ITEM_LIMIT`, and the five full-corpus dedup passes per ingest batch.

A smaller system is a deliverable, not a side effect. Most of this is scar tissue from working around the CRDT memory problem and disappears with it.

## Residual risks

- **The WebKit shell baseline is unmeasured and is the dominant term.** Estimates spanned 60-250 MB, a 4x spread on the largest line in the renderer floor. Stage 0 exists for this.
- **About 1.4 GB of today's 4.26 GB is unattributed to any named mechanism.** The itemised removals sum to roughly 2.6-2.8 GB and that sum already double-counts. Do not promise the difference.
- **We now own convergence correctness.** A bug in `apply` makes devices diverge silently, which Automerge would have prevented outright. A digest checker converts silent divergence into an alert; it does not prevent it.
- **Dedup is not a semilattice operation and may not converge.** Union-find across four grouping strategies with a ±5-minute window is order-dependent.
- **CRDT history is discarded permanently.** Per-change provenance for the pre-migration corpus is gone.
- **Primary death.** The lease with monotone fencing detects and rejects dual-primary but does not promote. If the primary dies permanently nobody drains the outbound queue.
- **OPFS eviction on the phone.** There is no `navigator.storage.persist()` call anywhere in `packages/pwa` today, and iOS evicts non-persisted origins aggressively.
