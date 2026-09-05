# Canonical invalidations, follower optimistic overlays, and device-local change feeds

`change_feed_v1` is the canonical view-refresh subscription payload. A request
names its last fully applied revision and receives at most 512 compact rows in
`revision, ordinal` primary-key order. Each row contains only a topic, an
optional changed identity, and `resetRequired`. The first page pins one upper
revision. Continuation cursors retain that upper bound even if later commits
arrive, so a reader completes one finite revision range before opening the
next. Every committed revision has at least one invalidation row. A missing
revision, a changed Library generation, or disagreement between materialized
and change-feed revisions fails closed unless an explicit reset row closes the
discarded range. Checkpoint activation emits one Library-wide reset
invalidation at its accepted source revision. No invalidation carries an
entity projection or reader content.

Freed Desktop drains this query after each accepted local transaction and
after each imported follower revision. It resolves only the FeedItem
identities present in one page through bounded point queries, then publishes
those compact results to interested views. Preferences and RSS identities
rerun their named readers. Broad identity, authority, or reset topics reopen
the affected bounded readers. A pending follower intent does not enter this
canonical feed. Its device-local optimistic state remains separate until the
Primary accepts or rejects it.

`optimistic_fields_v1` is the only visible-row overlay query. A request carries
at most 64 unique FeedItem IDs already present in the caller's visible SQLite
window. SQLite selects only the current follower actor's newest pending value
for each requested identity and one of the seven closed fields: `read_at`,
`saved`, `saved_at`, `archived`, `archived_at`, `liked`, and `liked_at`. A
response contains at most 448 sparse rows and 2 MiB. It carries both the
canonical projection revision and the device-local transition sequence.
Desktop and PWA reject foreign identities, duplicate fields, mixed source
fences, unknown value shapes, and sequence movement across a multi-batch
visible window. The shared transform merges these fields into the bounded
cards already returned by SQLite. It never returns or reconstructs a complete
FeedItem, Library shell, or renderer corpus.

`local_change_feed_v1` is the separate device-local refresh payload. Sparse
optimistic-field insertions and removals advance its monotonic sequence through
schema-owned SQLite triggers in native and browser runtimes. Each row carries
one topic and entity identity. It never advances `library_change_state`, enters
a checkpoint or operation segment, or crosses Drive. One page contains at most
512 identities and pins one local upper sequence with the same cursor codec as
the canonical feed. SQLite retains the newest 4,096 local invalidations. When a
reader starts behind that retained window, the first returned identity carries
`resetRequired` so the reader discards its device-local overlay window and
reopens bounded overlay queries. Full checkpoint replacement clears the local
sequence only after proving that no unresolved intent or optimistic field
exists.

Freed Desktop and the PWA initialize one local sequence from
`optimistic_fields_v1`, drain `local_change_feed_v1` after local intent writes
and follower result imports, and reopen only affected bounded readers. A local
intent may advance visible-window counters, but it cannot change the canonical
projection revision used for checkpoint, query, or sync identity.
