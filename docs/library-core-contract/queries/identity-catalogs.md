# RSS subscription catalogs, graph source pages, navigation facets, graph layout, and worker paging

`rss_feed_detail_v1` is the matching normalized point query for one RSS Feed.
It returns every synchronized feed field, including polling and unread policy,
folder, site and image URLs, last successful fetch time, and sample provenance,
from one primary-key lookup under a 64 KiB response ceiling. Device-local
scheduler state and HTTP cache validators are excluded. Missing feeds return a
typed null result without consulting a renderer collection or Library shell.

`person_graph_page_v1`, `account_graph_page_v1`, and
`rss_feed_page_v1` provide compact identity source pages. The RSS page is the
canonical subscription catalog for every view, including Friends graph
compilation, the sidebar, settings, command surfaces, and OPML workflows. Each
returns at most 128 rows and
2 MiB in binary primary-key order after reading at most 129 rows. The Person
projection includes the latest reach-out time but excludes tags, notes, bio,
and reach-out history. The Account projection excludes contact fields,
follow-role history, and profile metadata that graph compilation does not use.
It includes the visible activity count and latest activity time computed by
SQLite through the provider and author index. The RSS feed projection carries
every synchronized subscription field plus exact visible and unread activity
counts. Its activity and image fallback use the RSS feed item index. Friends
compilation consumes only the compact subset it needs. The Friends worker
pages RSS rows from SQLite itself, so the React shell neither subscribes to nor
forwards an RSS Feed dictionary. Catalog views reuse the same closed row
without a second query contract. These fields replace
the separate whole-graph activity aggregate. JavaScript never scans FeedItems
to assemble graph activity. When legal RSS rows approach 2 MiB, native and
browser executors shorten the page by exact serialized bytes and bind the
continuation cursor to its final row. A legal row never makes the complete
catalog unreadable.
Settings management and preview surfaces use the same page contract with a
50-row visible window. Exact duplicate checks use `rss_feed_detail_v1`.
Complete unsubscribe freezes its scope inside SQLite before mutation. OPML
export visits source-fenced pages outside React and retains only the output
artifact required for download.
The command palette performs no identity read while closed. Once opened with a
typed query, it walks source-fenced RSS Feed and Account pages and retains at
most 25 matching rows from each catalog. Account page rows include the linked
Person name through the normalized foreign-key join, so the palette never
hydrates Person, Account, or RSS Feed dictionaries to label search results.
Native and browser Account executors shorten a page by exact serialized bytes
when legal maximum-sized identity rows approach the 2 MiB response ceiling.
The constant-time facet row also owns exact RSS Feed, enabled RSS Feed, Friend
Person, social Account, sample-record, and per-platform item counts. Its closed
response includes the latest captured and published time for each of at most 64
platforms, the latest enabled RSS fetch time, and Google Contact import and
linked-Person totals. Trigger-maintained counters answer the cardinalities.
Covering platform, feed, and contact indexes answer the latest-time and linked
identity fields without a table scan or temporary sort. Always-mounted
navigation and Settings read this one source-fenced summary. They never
subscribe to item, Feed, Person, or Account collections to derive status in
React. Desktop native Rust and PWA SQLite WebAssembly execute the same generated
SQL and validate the same closed response.
Person and Account rows left-join their installation-local graph position from
`library_device_person_graph_layout` and
`library_device_account_graph_layout`. A missing local row is an explicit
unpinned position. These tables use entity foreign keys, disappear with the
local entity, and never enter checkpoint export, intent replication, or
authority digests. Graph placement therefore uses SQLite without turning
device layout into synchronized product state. Each changed local mutation
advances a separate safe-integer layout revision. Graph responses expose it,
and their opaque cursors bind it alongside canonical generation and source
revision. A position change therefore invalidates an in-progress graph scan
without pretending that canonical Library state changed.
Freed Desktop submits these local set and clear mutations through the native
Library Core command. The PWA submits the identical typed request through its
single OPFS SQLite worker. React does not own a graph-position dictionary. A
successful mutation advances only the device layout revision and reopens the
bounded graph query. Startup may parse the retired
`freed-device-graph-layout-v1` localStorage record once. It verifies every
referenced entity through an exact SQLite query, applies only finite positions
through the typed mutation, and deletes the source record only after all
admitted rows succeed. Query or mutation failure preserves the source for a
later attempt. Missing entities are discarded. No normal product path reads or
writes graph layout in localStorage.
All three use one shared opaque identity cursor bound to the final row, database
generation, and source revision. Graph workers stream these pages and release
each source page after compiling its bounded output. React never receives the
complete identity corpus. The Friends worker protocol uses an explicit begin,
one-page append, and commit sequence. The client requests the next 128-row page
only after the worker acknowledges the current page. The worker rejects mixed
source or layout fences, reordered query families, discontinuous cursors,
non-increasing identities, and a source above 100,000 semantic rows. A failed
or superseded build preserves the last admitted scene.
The shipping Friends view supplies this page executor directly from each host.
Freed Desktop invokes the native query command and the PWA invokes its OPFS
SQLite worker. The Friends product worker acknowledges one page before the
host requests the next page, compiles the resident scene off the React thread,
and returns only renderer buffers plus bounded presentation metadata.
