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

Desktop provider-delivery discovery also has no renderer corpus path. Startup
and explicit replacement scans must visit bounded authoritative SQLite pages.
Ordinary item-patch events may enqueue only the exact changed rows carried by
the mutation receipt. If a bounded scan fails, provider delivery pauses. It
must not read a projected item map, reconstruct a Library shell, or fall back
to renderer state. This changes where candidates are discovered, not provider
admission, request behavior, retry budgets, or confirmation semantics.
