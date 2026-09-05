# Map and Story Wall candidate limits, projections, ordering, and overflow

`map_markers_v1` is the Map candidate query. It returns at most 1,000 visible,
nonarchived location rows ordered by publication time and binary item ID. Each
row contains only the author identity, compact popup text, explicit location,
time range, and item locator needed by Map. It contains no media arrays, tags,
signals, highlights, reader bodies, or unrelated user state. The generated SQL
uses the visible browse index and does not build a temporary sort. It reads one
overflow row to set `hasMore` instead of counting or scanning the candidate
corpus.

`story_wall_candidates_v1` is the Story Wall candidate query. It returns at
most 250 visible, nonarchived media rows in the same stable order. Each row
contains only its compact caption and author metadata, nullable joined Account
and Person IDs, plus at most eight media URLs and media types. The join uses the
unique Account provider and external identity index. Account inclusion filters
therefore operate on identities carried by the bounded candidate window, not a
complete renderer Account map. The row contains no FeedItem remainder, tags,
signals, highlights, engagement state, or reader bodies. Native Rust and
browser SQLite execute the same generated program through their existing typed
query dispatches. Story Wall uses the same one-row `hasMore` rule.
