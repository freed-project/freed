# Phase 4: Sync Layer

> **Status:** 🚧 In Progress

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
> shipping artifacts. Installed-device acceptance remains open.

## Current SQLite sync work

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
- [x] Preserve current Google Drive endpoints, headers, retries, OAuth behavior,
      and cadence unless separately approved.

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
| Checkpoint protocol | Complete | Checkpoints contain typed normalized records only. Every logical record is capped at 131,072 canonical bytes. Pages contain at most 128 records and 2,097,152 decoded bytes. One native response is capped at 1,048,576 serialized bytes. |
| Editable followers | Complete | Followers commit signed intents and sparse optimistic overlays locally. The Primary validates and publishes signed acceptance, rejection, and provider-result records. Canonical operation import settles overlays atomically. |
| Selective content | Complete | Content descriptors, authenticated range maps, and content-addressed bytes support metadata-only, on-demand, partial, complete, pinned-offline, and excluded policies per device. |
| Historical cutover | Complete in code | One read-only source admission path imports the historical Library once. It never becomes runtime authority, transport, fallback, rollback proof, or a dual-write participant. |
| Drive behavior | Preserved | Existing endpoints, headers, OAuth behavior, retries, paging, request cadence, and provider adapter ownership remain unchanged. |
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
- [x] Google Drive transport behavior is unchanged by the Library Core cutover.
- [ ] Complete installed Freed Desktop and physical iPhone acceptance evidence.

## Dependencies

- Phase 1 and Phase 2 capture records
- Freed Desktop native Library Core from Phase 5
- PWA OPFS SQLite runtime from Phase 6
- Existing Google Drive adapter behavior and authenticated app-data storage
