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
The query preserves blob references instead of substituting empty text. The
current selected-item adapter rejects a blob-backed highlight until its text
can be hydrated; it never passes incomplete annotations to a replacement write.
Content pinning does not request annotations. Native and browser SQLite use
the same generated point-query programs and reject oversized results.

Desktop provider-delivery discovery also has no renderer corpus path. Startup
and explicit replacement scans must visit bounded authoritative SQLite pages.
Ordinary item-patch events may enqueue only the exact changed rows carried by
the mutation receipt. If a bounded scan fails, provider delivery pauses. It
must not read a projected item map, reconstruct a Library shell, or fall back
to renderer state. This changes where candidates are discovered, not provider
admission, request behavior, retry budgets, or confirmation semantics.
