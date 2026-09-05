# Feed ranking, Saved lists and analytics, Friends feed predicates, shared feed adapters, and secondary-surface joins

`feed_browse_page_v3` is the normalized ranked feed query. SQLite applies the
archived, hidden, platform, author, RSS feed, social-content, saved, tag, and
signal filters before paging. Its final order is rounded priority descending,
publication time descending, then binary global ID ascending. The global ID is
the stable primary-key tie-break. Historical renderer enumeration order is not
stored, checkpointed, or encoded in the V3 cursor. The reverse program mirrors
the keyset comparisons and order, then the adapter restores canonical row
order before returning the page. Both programs use the registered
`library_feed_items_browse_rank_all` expression index and may read at most 129
rows for a 128-row result. Next and previous cursors bind the database
generation and exact source revision. A filter change starts a new query
instead of reusing a cursor from another result set.

Priority is Primary-derived canonical state. Capture and import operations may
not supply `priority` or `priorityComputedAt`. The Primary snapshots one weight
policy and one monotone pass timestamp, then reads at most 64 stale candidates
through the `priority` variant of `background_item_page_v1`. That variant uses
`library_feed_items_priority_refresh` to select the oldest stale scores without
a table restart or temporary sort. The Primary computes each score with the
shared TypeScript transform and commits bounded signed
`feed_item_priority_assignment` transactions. Native Rust verifies and
materializes the operation. PWA SQLite applies the same accepted operation
during follower replay. Ranking refresh never changes an item's content
`updatedAt`, and React never sorts a corpus or recomputes canonical priority.
Library invalidations and weight changes coalesce into a follow-up pass, while
one hourly pass refreshes the time-decaying recent window.

The ordinary and Friends visible-window lifecycles reopen on the host's exact
Library item invalidation revision. Saved uses its dedicated presentation
revision, and search uses its own committed-query revision. These ephemeral
React fences never become storage authority. A successful mutation cannot
advance navigation counts while leaving an older empty or stale feed window
selected.

`saved_analytics_v2` is the normalized Saved overview aggregate. One deferred
SQLite snapshot materializes only each saved row's bounded platform, content
type, and effective saved time, then returns exact totals, latest time, seven
contiguous day buckets, 24 contiguous hour buckets, and binary-ordered label
counts. Native Rust and browser SQLite execute the same generated SQL. The
request accepts no SQL or arbitrary grouping, the result is one row under
2 MiB, and source generation or revision movement invalidates the response.
The historical Saved analytics reader and its document-head source vocabulary
are not part of this final query.

`saved_feed_page_v2` is the normalized Saved list query. Its closed sort enum
selects one of four generated SQL variants for date saved, date published,
recommendation priority, or shortest read. Each variant has matching forward
and reverse keyset programs and a dedicated expression index. The request
requires saved and visible rows, applies every remaining feed filter inside
SQLite, and reads at most 129 rows for a 128-row response. Each edge cursor
binds the normalized filter digest, sort mode, complete order key, database
generation, and source revision. Native Rust and browser SQLite share the same
program registry and exact cursor bytes. No caller can supply SQL or ask
application code to sort a Saved corpus.

Freed Desktop and the PWA invoke these queries through one shared bounded feed
adapter. Each host supplies a typed query executor. Freed Desktop calls the
native core and the PWA calls its dedicated SQLite WebAssembly worker. The
shared dispatcher validates each closed request and its exact response. The
ordinary feed, Saved feed, and signal counts retain only compact card pages and
opaque keyset cursors. They do not call a whole-Library query or reconstruct a
Library shell.

Friends uses `feed_browse_page_v3` with `identityMode = "friends"`. SQLite
resolves each row through the unique Account provider and external identity,
then requires its Person to have relationship status `friend`. The identity
mode and Friends predicate schema version are bound into every cursor digest,
so a cursor from all-content mode cannot cross into Friends mode.

One shared secondary-surface adapter executes `item_detail_v1`,
`library_facet_summary_v1`, `saved_analytics_v2`, `map_markers_v1`, and
`story_wall_candidates_v1` through the host executor. Map and Story Wall rows
use shared closed row-to-visible-card transforms. Each Story Wall row also
carries its nullable Account and Person IDs from the same indexed SQLite join
used to select the item. The transforms do not hydrate reader bodies, scan
identity catalogs, or invent a general FeedItem query.

`map_markers_v1` resolves the optional linked Person inside SQLite through the
unique Account provider and external identity index. Each row contains only the
Account ID plus the Person ID, name, avatar URL, and relationship status needed by the map. Desktop
and PWA use the same closed transform. React retains at most 1,000 location
candidates and ephemeral geocoding state. It never subscribes to complete
Person or Account maps, and the generic secondary-surface item reader does not
offer a Map compatibility projection.
