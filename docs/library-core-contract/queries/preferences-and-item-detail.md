# Preferences, item-detail locators, hydration policy, and provider-delivery candidate discovery

Synchronized preferences are normalized typed SQLite nodes. The
`preferences_snapshot_v1` query returns at most 512 nodes and 2 MiB in SQLite
binary path order. Scalar rows use a `v:` path prefix. Object markers use `o:`
with a null value. Array markers use `a:` with their element count as an
integer. The remainder is SQLite's canonical JSON full-key path. Markers
preserve explicit empty objects and arrays without storing a settings object.
Object patches deep-merge. Scalar and array patches replace the named node and
all descendants in one transaction. Each stored row still contains exactly
one boolean, integer, real, text, or null value. Neither native nor browser code
reconstructs a monolithic settings object at the storage or transport boundary.

`preference_value_v1` reads one literal property path at an exact materialization
generation and canonical revision. Requests allow 32 segments and 8,192 encoded
bytes; SQLite derives the canonical fullkey and enforces the stored 4,096-byte
path bound. Exact root lookups and disjoint descendant ranges use the path index.
The response contains at most 512 nodes and 2 MiB. One overflow row detects an
oversized array; object inspection reads at most three descendants and returns
only a group summary unless the complete value is a numeric wrapper.

The selected root is remapped to `$._`, which does not enlarge its stored path.
Native and PWA use the same generated row descriptor, including finite real
numbers, and reject incomplete arrays, invalid parents and duplicate semantic
paths. Missing settings remain distinct from group summaries. Recovery loads
only the visible comparison; it never joins pages into an unbounded settings
object. This query does not remove the old whole-tree startup limit.

`ranking_weight_scope_v1` reads at most 64 selected recency, author, platform
or topic weights at one exact generation and canonical revision. Requests and
responses each have a 128 KiB bound. Results preserve request order and distinguish
an absent weight from invalid retained data. Only finite numbers and the existing
binary64 wrapper are numeric weights; other stored types refuse the entire read.
The generated selection-plan query derives SQLite fullkeys, then native and PWA
reuse the indexed point programs inside one read transaction. Native cancellation
is checked between selected weights.

Valid item author IDs can exceed the stored preference-path limit. Grouped
requests allow literal keys up to 4,096 UTF-16 code units; intermediate selection
paths have a 32 KiB bound. These larger lookup keys may return an indexed miss.
They do not permit larger stored rows: an existing oversized preference path is
refused, and the ordinary single-setting query retains its prior limits.

Primary ranking loads only weights addressed by its current candidate batch.
The shared adapter partitions requests by both 64-key and 96 KiB limits, checks
every result against the candidate source, and retains only relevant weight
entries in own-key maps. The existing ranking formula and absent-value defaults
remain. A stale chunk fails before any ranking write, and preference invalidations
received during a pass coalesce into a fresh pass.

`preferences_revision_v1` returns the latest preference invalidation revision,
using the existing `(topic, revision)` index, plus the materialization source.
Its single-row result does not grow with the preference collection. Consumers
compare both generation and preference revision because checkpoint import clears
invalidations. Item-only writes leave the marker unchanged. A revision beyond the
canonical source is invalid. Primary ranking checks this marker before each batch
and after its completion reload, and retries failed reads. It no longer subscribes
to the renderer's full weight-map identity. Startup still loads the complete
bounded preference snapshot; removing that ownership remains unfinished.

`item_detail_v1` is a metadata point query. It reuses the compact feed-card
projection and returns only typed locators that say whether each reader body is
absent, inline in SQLite, or stored as a content-addressed blob. It also returns
at most eight nullable media blob digests in exact ordinal alignment with the
bounded media URL and type arrays. A null digest means that media row has no
authenticated blob descriptor. The body bytes are fetched through
`item_reader_body_v1`. Item detail and background scans do not return full
bodies, media bytes, arbitrary remainder objects, or an enlarged metadata
response. Freed Desktop and the PWA use these locators to commit device-local
hydration policy. React receives no vault path or content byte buffer.

`item_annotations_v1` reads tags and highlights for one exact item. It preserves
the compact `item_detail_v1` contract and returns at most 64 tags and 64
highlights, with a 1 MiB response ceiling. Both reads must have the same source
generation and revision before the selected item receives its annotations.
The query preserves blob references instead of substituting empty text.
Note, tag and inline quote projections return bounded blobs internally. Readers
check their byte lengths before strict UTF-8 decoding, preserving NUL and a
leading U+FEFF. Notes retain distinct null and empty values; tags remain nonempty.
The limits are 8,192 note bytes, 512 tag bytes and 65,536 inline quote bytes.
Each SQL projection retains at most its limit plus one byte, so oversized values
are refused instead of silently truncated. Public response fields remain strings.
`item_annotation_text_range_v1` takes an exact item, annotation index, expected
source tuple and byte range. The backend resolves the canonical digest and
verifies the complete quote length, range map, range digests, full digest and
UTF-8 before returning any requested bytes. It checks generation, projection
revision and transition sequence again after its read snapshot. The request
accepts no renderer storage path. Body selectors remain `content` and `preserved`.

Each quote is bounded to 65,536 UTF-8 bytes and 64 physical ranges. Shared
hydration caps aggregate quote bytes at 524,288 and display JSON at 1 MiB.
Canonical annotations remain separate from the hydrated view. Missing,
unavailable, excluded, corrupt, oversized and invalid-text results expose no
partial quote set. Replacement assembly still enforces 64 highlights, 8,192
note bytes and the existing 98,304-byte canonical payload cap.

Native queries retain `query_only`; successful local recency bookkeeping runs
separately with final source checks. Native vault opens are nonblocking before
regular-file, owner, mode, link-count and length checks, so a FIFO cannot wait
for a peer before rejection. PWA reads use the serialized worker and local OPFS
vault. Deadlines are checked around awaited I/O; they cannot interrupt a pending
OPFS operation or guarantee a hard operating-system I/O deadline. Windows authenticated-range vault support and atomic edit
admission remain acceptance gaps. Read authentication alone does not prove
safe replacement of pending or concurrently changed annotations.
Content pinning does not request annotations. Native and browser SQLite use
the same generated point-query programs and reject oversized results.

Desktop provider-delivery discovery also has no renderer corpus path. Startup
and explicit replacement scans must visit bounded authoritative SQLite pages.
Ordinary item-patch events may enqueue only the exact changed rows carried by
the mutation receipt. If a bounded scan fails, provider delivery pauses. It
must not read a projected item map, reconstruct a Library shell, or fall back
to renderer state. This changes where candidates are discovered, not provider
admission, request behavior, retry budgets, or confirmation semantics.
