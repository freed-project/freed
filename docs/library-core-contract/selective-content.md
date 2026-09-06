## 11. Selective content plane

Canonical Library rows carry descriptors, never large inline media. A
descriptor binds content digest, rendition identity, media type, byte length,
chunk or range layout, and available sources.

An `authenticated_ranges` descriptor binds an ordered range map by its exact
range count and canonical root digest. Each `b2_content_range` record carries
one contiguous byte offset, byte length, and lowercase SHA-256 range digest.
The root digest covers the content identity, logical byte length, range count,
and every ordered range tuple. Checkpoint activation rejects gaps, overlaps,
count mismatches, changed roots, and mixed inline-chunk and range layouts before
canonical rows become visible. The verifier streams range metadata and does not
allocate the logical content length.

Each client independently selects one policy per rendition:

- metadata only
- stream on demand
- partial cache
- complete cache
- pinned offline
- excluded

Policy, transfer progress, cache location, and eviction time are device local.
Descriptor and checkpoint completeness do not require content hydration.

The executable schema stores policy, availability, and verified ranges in
separate `library_device_content_*` tables. Policy has its own monotonic local
revision and never advances Library authority, the canonical change feed, or
the replication outbox. An absent policy means `metadata_only`. An offline pin
request does not claim that bytes exist. Only the verified publication path may
create availability or range rows.

Content digest verification is incremental. Downloads write to a temporary
file or OPFS object, verify exact length and digest, cross a durability barrier,
and atomically publish the local availability row. Multi-gigabyte media never
becomes one JavaScript, Rust, renderer, or IPC allocation.

The generated contract limits one publication append to 262,144 bytes. The PWA
worker owns the OPFS access handle, accepts only sequential offsets, hashes each
bounded append, flushes and closes the object, then commits its storage key to
SQLite. The native core applies the same canonical lookup, append ceiling,
incremental digest, durability callback, and SQLite registration to a host
supplied content-vault object. Caller-supplied lengths and digests never become
authority. A failed or changed stream is discarded before availability can be
published. A crash before the SQLite commit can leave an unreachable object,
but never a false cached-range claim.

Physical range keys bind the content digest, range index, and canonical range
digest. Freed Desktop resolves the vault through one held private directory
descriptor, writes a 0600 staging file, syncs it, renames it to the canonical
key, syncs the directory, and only then registers SQLite proof. The PWA follows
the same proof order with its worker-owned OPFS handle.

Cached reads use the same proof boundary. A request names one content digest,
range index, in-range offset, and a byte ceiling no larger than 262,144 bytes.
SQLite must prove that the local row still matches the canonical range before
the vault opens its physical object. Freed Desktop opens that object relative
to its held directory descriptor and rechecks file ownership, mode, link count,
and exact length on the opened descriptor. The PWA worker reads the equivalent
bounded OPFS slice. Neither runtime returns an unbounded rendition or trusts a
renderer-supplied storage key.

Every successful cached read records device-local recency. SQLite coalesces
that write to at most once per content digest per 60,000 milliseconds. Read
recency never enters checkpoints, authority revisions, or replication.

Background hydration discovers work through
`hydration_candidates_page_v1`. The generated SQL runs unchanged in native
Rust and browser SQLite. It returns at most 128 missing authenticated ranges,
prioritizes pinned offline content before complete-cache content, and uses a
stable keyset cursor. The page binds the materialization generation, canonical
source revision, transition sequence, and device content revision. Any source
movement invalidates continuation instead of mixing generations.

Full-cache promotion streams every verified range in canonical index order
through the blob-content digest domain. The verifier retains one 262,144-byte
window, one page of at most 128 range proofs, and incremental hash state. It
requires exact range count, exact total byte length, and the canonical content
digest before one SQLite transaction records `fully_cached` or
`pinned_offline`. Exact replay does not advance the device content revision.
Changing policy after completion switches only between those two local states.
Aggregate availability stores no synthetic whole-object key. Physical
locations exist only on the verified range rows.

If full verification later observes changed bytes, the same operation revokes
any complete claim, records local `corrupt` availability, and advances the
device content revision. It never changes canonical Library authority.

Eviction is a closed device-local operation over one content digest. It pages
at most 128 physical range proofs at a time, removes each object before
removing its SQLite proof, and returns exact released byte and range counts.
`pinned_offline` fails closed. The caller must first commit an explicit policy
transition away from the pin. Setting `excluded` at the runtime storage
boundary cancels local staging for that digest and completes the same eviction
before returning. A crash between physical deletion and SQLite cleanup leaves
only a stale proof for startup reconciliation to remove.

Cache-pressure discovery uses `eviction_candidates_page_v1`, the same
generated SQL in native Rust and browser SQLite. It returns no more than 128
unpinned cached renditions in least-recently-used order. The request supplies a
recency ceiling and continuation uses the same four-part source fence as
hydration. Every cache-pressure eviction must repeat the candidate's exact
`lastAccessedAt`. A newer read makes the eviction stale before physical bytes
can be removed. Explicit exclusion and explicit user eviction remain separate
closed reasons and do not masquerade as cache pressure.

Every runtime reconciles physical objects before declaring the vault ready.
The scan keeps at most 128 SQLite proofs in memory. It deletes unfinished and
unreferenced objects, prunes proofs for missing or length-mismatched files,
recomputes aggregate availability through generated SQL, and advances exactly
one device-local content revision when state changed. Exact physical and SQLite
matches survive restart and canonical checkpoint replacement.

Garbage collection preserves canonical references, active checkpoint roots,
backups, pinned local renditions, in-flight transfers, and retained receipts.
