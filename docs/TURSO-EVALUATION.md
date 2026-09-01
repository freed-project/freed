# Turso evaluation

**Decision: use stock SQLite. Do not adopt Turso.** rusqlite on desktop, official sqlite-wasm over OPFS on the PWA.

Decided 2026-07-24, re-verified 2026-07-25 against Turso 0.7.1. This document exists because Turso is genuinely appealing and the question will come back. It records what was measured, so the next conversation starts from evidence instead of from the appeal.

Reproduction scripts and raw results are in [`docs/turso-evaluation/`](turso-evaluation/).

## Architecture consequence

This decision now governs the complete Library Core. Freed Desktop and the
headless Primary consume a bundled stock SQLite build through the same
extracted Rust core. The PWA consumes official SQLite WebAssembly over OPFS.
Both runtimes use one checked-in SQL catalog, generated typed bindings, and one
cross-runtime conformance suite. IndexedDB is not a Library row engine or
fallback. SQLite database files remain local and never become synchronization
or backup transport.

---

## Read this first if you are here to relitigate

Two arguments are **not** the reason, and should not be used:

- **"A Tantivy index is not SQLite pages, so file-format reversibility breaks."** Retracted. Indexes are derived data; you rebuild them. This objection was raised in a first analysis and was correctly called weak.
- **"It is pre-1.0."** Not an argument here. Freed is pre-1.0 too, and the project deliberately adopts bleeding-edge technology.

The real reasons are below, and neither is about portability or version numbers.

---

## Test conditions

| | |
| --- | --- |
| corpus | 110,922 rows, 160 MB of body text, 222.8 MB database |
| note on scale | this is **7 copies** of the owner's real corpus; real scale is 15,846 items |
| platform | darwin-arm64 |
| Turso | 0.7.1 via `@tursodatabase/database` |
| SQLite | 3.51.2 via `node:sqlite` |

0.7.1 **is** the current release as of 2026-07-25 (published 2026-07-22). `v0.8.0-pre.1` is an earlier branch cut from 2026-07-20, not a newer version.

---

## Disqualifier 1: incremental FTS ingest scales with index size

Plain writes are fine. Base row insert and build were comparable: **SQLite 1,063 ms vs Turso 1,115 ms**. If someone tells you "Turso writes get slower as the database grows", that is not what was measured and it will send you after the wrong thing.

What degrades is full-text index maintenance. A 500-row batch into a 95,076-row index:

| | total | per row |
| --- | --- | --- |
| SQLite FTS5 (including the AFTER INSERT/UPDATE/DELETE triggers external-content FTS5 needs) | 79 ms | **0.20 ms** |
| Turso | 156,600 ms | **313 ms** |

Roughly 1,570x. Two independent runs, so not warm-up.

The cost scales with total index size, consistent with rewriting the index on each commit:

| base rows | Turso ms/row | SQLite ms/row |
| --- | --- | --- |
| 500 | 2.02 | 0.02–0.13 (flat) |
| 2,000 | 4.2 | |
| 8,000 | 29.6 | |
| 95,076 | 313 | |

**Turso's FTS is build-once, not maintainable.** Freed ingests continuously, so a single new feed item would cost roughly 300 ms to index.

Reproduce: [`inc-scaling.mjs`](turso-evaluation/inc-scaling.mjs), [`incremental.mjs`](turso-evaluation/incremental.mjs). Results: [`results/inc-turso.json`](turso-evaluation/results/inc-turso.json), [`results/inc-sqlite.json`](turso-evaluation/results/inc-sqlite.json).

---

## Disqualifier 2: silent, total index corruption

This is the serious one, and it is much broader than the first measurement suggested.

### What happens

Turso writing into a database that contains **any virtual table module Turso does not implement** silently stops maintaining **every index in that database**. Writes report success. Table scans return the new rows. The indexes do not know any of it happened.

Measured: seed 100 rows with SQLite, then perform 500 inserts, 100 updates and 50 deletes through Turso.

- Table scan afterwards: **550 rows**, and stock SQLite agrees.
- `idx_tag` and `idx_n`: still exactly the original **100** entries.
- **Zero of 650 writes reached any index.**
- The 100 updated rows keep their **stale pre-update values indexed**, so index-driven reads return rows that no longer match the query.
- `PRAGMA integrity_check` on stock SQLite lists rows missing from indexes. Turso's own `integrity_check` reports "Page 3: never used" through "Page 9: never used" — it does not believe the index pages exist.

### What triggers it

Not what you would guess:

- **Not FTS5-specific.** fts4 and rtree do it too. Any module Turso lacks.
- **Not about the virtual table's own data.** A vtab on a completely unrelated table still corrupts writes to other tables.
- **Not a standalone-vs-external-content distinction.** A plain `CREATE VIRTUAL TABLE docs USING fts5(body)` is enough.
- **Not the implicit primary-key autoindex.** Ordinary `CREATE INDEX` indexes are lost as well.
- Read-only access with a vtab present is safe. Only writes corrupt.

### Root cause, read in the source (v0.7.1)

1. `core/vtab.rs:353` returns `LimboError::ExtensionError("Virtual table module not found: fts5")`.
2. `core/schema.rs:2098-2109` propagates it out of `handle_schema_row`, called with `?` at `core/schema.rs:1636-1647`, which aborts the schema scan.
3. `populate_indices(...)` at `core/schema.rs:1674` therefore **never runs**. Indexes are accumulated as `UnparsedFromSqlIndex` and only attached in that post-loop pass.
4. `core/lib.rs:1514-1519` catches the error and **swallows it**:

   ```rust
   Err(LimboError::ExtensionError(e)) => {
       // this means that a vtab exists and we no longer have the module loaded.
       // we print a warning to the user to load the module
       state.schema_guard = None;
       tracing::warn!("open warning, failed to load extension: {e}");
   }
   ```

The connection opens with tables and **no indexes at all**, and every subsequent write skips index maintenance.

### Status

**Unfixed on `main`** (331 commits ahead of v0.7.1 as of 2026-07-25). Commit `727efd8c` rewrote the classification but `core/schema.rs:2115-2127` still calls `VirtualTable::table(...)?` for an unknown module, and `core/lib.rs:1621-1626` contains the identical swallow verbatim.

**There is no upstream issue for this.** It appears to be unreported.

Reproduce: [`blast2.mjs`](turso-evaluation/blast2.mjs), [`write-safety.mjs`](turso-evaluation/write-safety.mjs).

---

## Memory, which is the one that matters most for Freed

Freed's central problem is renderer memory. Turso is worse on it, in both directions.

| index build over the same 110,922 rows | build ms | peak RSS delta | resident before build | index size |
| --- | --- | --- | --- | --- |
| SQLite FTS5 porter | 3,108 | **+3.2 MB** | 300.4 MB | 68.3 MB (43% of text) |
| SQLite FTS5 unicode61 | 3,127 | **+3.2 MB** | 300.2 MB | 71.7 MB (45%) |
| Turso `USING fts` | 7,706 | **+153.5 MB** | **774.1 MB** | 167 MB (104%) |
| Turso ngram | 28,785 | +481.2 MB | — | 326.5 MB |

Turso is **48x worse on peak build RSS** and carries roughly **474 MB more resident** on the same corpus before the index build even begins.

> **Note for anyone quoting these numbers:** every "A vs B" pair in this document is **SQLite first, Turso second**. This pair has been transposed at least once in conversation, which inverted the entire argument. SQLite is the 3.2 MB one.

Steady-state resident on 110,922 rows was fine for both: 48.7 MB vs 62.9 MB. File size was identical at 222.8 MB.

Raw: [`results/sqlite-porter-7.json`](turso-evaluation/results/sqlite-porter-7.json), [`results/turso-default-7.json`](turso-evaluation/results/turso-default-7.json). Measurement window is `fts.mjs:101-126`, which wraps only the index-build statement, identically for both engines.

---

## Search quality: the "Tantivy beats FTS5" premise is false as shipped

| capability | Turso 0.7.1 | SQLite FTS5 |
| --- | --- | --- |
| prefix `democr*` | **0 hits** across 7 syntaxes, literal and bound | 1,372 hits |
| stemming (`run` vs `running`) | **0 hits**; no stemmer exists (tokenizers are default/raw/simple/whitespace/ngram) | porter stems correctly |
| fuzzy `climat~1` | **0 hits, no error** | trigram gives substring and partial typo tolerance |
| `fts_score(body, ?)` with a bound parameter | silently returns **0**; needs literal constants, i.e. concatenating user input into SQL | n/a |
| multi-term default | OR (`climate change` → 6,277) | AND (315) |
| ngram | works, but 477–794 ms per query, unusable interactively | — |

Open upstream: #7636, #7637, #7532 (`fts_score` returns 0), #7530 (FK cascades bypass FTS maintenance), #4973 (FTS index not updated after `UPDATE OR REPLACE`, open since February), #5027 (index does not roll back on failed insert), #7611 (valid inserts make `integrity_check` report FTS directory mismatch), #7800 (custom index modules unsupported under MVCC, so FTS is unavailable on any Cloud database), #6533 (incremental maintenance, open since 2026-04-22, one comment, no owner).

**Prefix search and stemming have no issue filed at all**, so they are not tracked as gaps.

Reproduce: [`gate.mjs`](turso-evaluation/gate.mjs), [`quality.mjs`](turso-evaluation/quality.mjs).

---

## What Turso genuinely wins

Worth stating plainly, because a fair record is more useful than a one-sided one.

**Very high frequency terms.** `that` (54,320 hits), top-10: SQLite 28.38 ms vs Turso **2.25 ms**, 12.6x faster. FTS5's `ORDER BY rank` scores every match; Tantivy does top-K pruning.

**Predictable latency.** Turso is flat at 1.6–2.5 ms across every query shape. SQLite ranges 0.02–28 ms.

But that flatness is a floor, not a ceiling: Turso is faster on **2 of 11** query shapes. SQLite wins the other 9, often by 5x to 80x (`climate` 0.32 vs 1.92 ms; `tantivy` 0.02 vs 1.63 ms).

Per-call binding overhead is identical between the two, so Turso's latency is real index work rather than napi cost.

---

## Can the ingest cost be architected around?

Yes. It is not worth it.

Disqualifier 2 rules out an FTS5 table anywhere in a file Turso writes, so the only viable shapes are a separate search file or an external index. Rebuild-and-swap was costed at full scale ([`mitigations.mjs`](turso-evaluation/mitigations.mjs), [`results/mitigations.json`](turso-evaluation/results/mitigations.json)):

- Full rebuild of 110,922 rows in Turso: 7,746 ms, +109.6 MB peak, 371.3 MB sidecar.
- Search stayed online against the previous sidecar throughout: 17 queries, 0 failures, max latency 1.78 ms.
- Atomic rename swap: 247 ms.

It works. The problem is the comparison. Freed's real corpus is **15,846 items**, not 110,922. At real scale, **stock SQLite rebuilds its entire search index from scratch in roughly 0.44 seconds for 3.2 MB of peak RSS.** The machinery built to avoid the cost is more expensive than the cost.

The other options and what they cost:

- **Turso rows + SQLite FTS5 in a separate file.** Two files with no cross-file transaction, so you inherit dual-write reconciliation and orphan cleanup. And you must guarantee nothing ever creates an fts5 table in the Turso file, because if anything does, index maintenance silently stops. A landmine with no compile-time guard.
- **External index (Tantivy directly).** A real option, but it makes Turso irrelevant to the decision.

---

## Reversibility, stated correctly

Stock SQLite **cannot open a Turso-FTS database at all**:

```
malformed database schema (__turso_internal_fts_dir_items_fts_key) - near "USING": syntax error
```

Turso writes `CREATE INDEX ... USING ...` into `sqlite_master`. SQLite validates all of `sqlite_master` on open, so the whole schema load fails and **no table in the file is readable** — not just the indexed one. You also lose `integrity_check`, the `sqlite3` CLI, and every other diagnostic and repair tool on that file.

Mitigation, measured ([`drop-mitigation.mjs`](turso-evaluation/drop-mitigation.mjs)): `DROP INDEX items_fts` from Turso fully cleans `sqlite_master`, after which stock SQLite opens the file normally. So recovery exists, **but only through Turso, and only while Turso can still open the file.**

Turso's FTS lives inside the single `.db` file; there is no Tantivy sidecar directory.

Reproduce: [`crossread.mjs`](turso-evaluation/crossread.mjs), [`blast3.mjs`](turso-evaluation/blast3.mjs).

---

## Adoption gate

**The trigger to revisit is not a new version number.** It is these probes passing:

1. [`blast2.mjs`](turso-evaluation/blast2.mjs) returns `sqlite_viaIdxTagCount == sqlite_tableScanCount` and `integrity == ["ok"]`.
2. [`gate.mjs`](turso-evaluation/gate.mjs) returns a non-empty `prefix_star` and a non-zero `score_bound_param`.
3. Incremental FTS maintenance that does not scale with total index size (re-run [`inc-scaling.mjs`](turso-evaluation/inc-scaling.mjs) and require a flat ms/row curve).
4. Peak RSS during index build within the same order of magnitude as SQLite's, given Freed's memory constraints.

**As of 2026-07-25 on 0.7.1, zero of these hold.**

---

## Running the scripts

They expect Turso and a corpus that are not checked in:

```bash
npm i @tursodatabase/database
node docs/turso-evaluation/gate.mjs
```

Node must be the repo's pinned version (see `.nvmrc`); `node:sqlite` is used for the SQLite side. The scripts build their own fixtures. The 110,922-row corpus was generated by replicating the owner's real document seven times; at real scale, divide the row-count-dependent figures accordingly.

Result JSON in [`results/`](turso-evaluation/results/) is the output of the original runs, kept as the evidence behind the tables above.
