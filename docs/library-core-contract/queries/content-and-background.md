# Reader body ranges, background maintenance, content enrichment claims, and provider media pages

`item_reader_body_v1` is the only interactive reader-body byte path. The
request names the item, selects content or preserved text, and supplies an
explicit byte offset and a range no larger than 256 KiB. The response is no
larger than 512 KiB and contains canonical base64 for exactly that range plus
the total content length and the inline-or-blob locator. SQLite reads one
metadata row and no more than five intersecting 65,536-byte content chunks.
Both native and browser runtimes reject an offset past the end. An offset at
the exact end returns an empty range. Views can therefore stream large bodies
without loading them into React or inventing a whole-item transport.

`background_item_page_v1` is the compact corpus traversal for maintenance and
background jobs. It orders every normalized FeedItem by binary `globalId`,
including hidden and archived records, and returns at most 64 metadata cards
after reading at most 65 rows. Its opaque cursor binds the final identity to
the exact Library generation and source revision. SQLite satisfies the order
from the FeedItem primary key. The query has no offset, no total count, and no
reader-body bytes. A job that needs content follows an explicit locator through
the ranged reader or selective content plane. Its closed row also carries the
exact hidden bit, optional RSS source identity, and optional sample-data
provenance needed by maintenance actions. Desktop and PWA call one shared
adapter for this traversal. PWA reads OPFS SQLite directly and never reconstructs
these pages from IndexedDB materializations.

`content_fetch_claim_v1` is the dedicated discovery query for article content
enrichment. SQLite selects only rows with a nonempty link URL and no preserved
body, either inline or content-addressed. It returns at most 64 closed rows
containing only `globalId`, `linkUrl`, `publishedAt`, and `capturedAt`, after
reading at most 65 rows. The source-fenced keyset cursor orders candidates by
publication time and binary identity. Freed Desktop feeds these compact rows
directly into its existing paced fetch queue. It does not reconstruct a
FeedItem, page the generic corpus, or change fetch cadence, retries, headers,
or provider behavior. A partial SQLite index contains only eligible rows and
satisfies the complete keyset order without a table scan or temporary sort.
Native Rust and browser OPFS SQLite execute the same generated SQL and shared
response contract.

`provider_media_page_v1` is the query-specific source for provider settings,
Facebook group-name repair, media backup, and saved YouTube discovery. The
request names Facebook, Instagram, or YouTube and may require saved rows.
Facebook and Instagram select their own source rows. Saved YouTube discovery
selects visible saved candidates across sources because a manually saved URL
is a `saved` item, then the shared URL parser accepts only YouTube identities.
SQLite applies those visibility and saved predicates before paging.
Each page returns at most 64 compact media cards after reading at most 65 rows.
Its cursor binds the provider, saved mode, Library generation, source revision,
and final binary `globalId`. Desktop and PWA execute the same generated SQL and
closed TypeScript contract. No generic corpus scan, rollback key, legacy lease,
reader body, or provider network behavior participates in this query.
