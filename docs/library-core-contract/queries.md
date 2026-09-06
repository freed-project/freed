## 8. Query contract

The generated query program catalog contains bounded SQLite queries only. Whole
document reads and IndexedDB adapters cannot appear in it.

Every query declares:

- stable query ID and version
- closed request and response DTOs
- maximum rows, response bytes, nested values, and execution time
- stable total order and keyset cursor schema
- exact snapshot or change-frontier binding
- required indexes and accepted query-plan shape
- cancellation behavior and cursor expiry
- renderer cache and invalidation topics

Browser callers cross one closed `query` worker request. Its payload is a
discriminated union of registered request types and its return type is selected
from the same query ID. The worker validates the request before dispatch and
never accepts SQL, table names, projection fragments, or arbitrary bind lists.
Adding a named query extends this union and its generated program catalog. It
does not add another transport method. Native hosts expose the equivalent
typed dispatch through the Rust core. Browser and native cursor codecs share
exact golden byte vectors, so a registered query has one wire identity rather
than platform-specific pagination behavior.

Each query row model is also declared in the executable contract. One field
descriptor closes the field name, scalar kind, nullability, UTF-8 byte range,
integer range, and enum membership. Generation produces the TypeScript row
type, strict wire parser, browser SQLite coercer, and Rust row descriptor.
Browser SQLite may coerce only SQLite integer booleans, while the wire parser
accepts booleans only. Both paths reject missing fields, unknown fields,
invalid scalar representations, and values outside the declared bounds. The
native executor decodes its SQLite row through the same generated descriptor
before deserializing the typed response. A query therefore cannot acquire a
second platform-specific result transform.

Ordinary interactive queries return no more than 2 MiB. Reader content uses a
separate ranged API. Export, backup, and migration enumerate a pinned durable
checkpoint through bounded pages.

Native checkpoint export begins one dedicated SQLite read transaction before
describing the source and holds that transaction across every bounded page.
Desktop and headless Primary keep this shared-core session on a separate WAL
reader, so ordinary signed mutations continue while every exported record
still comes from the exact described revision. Cursor continuity and the full
descriptor are checked on every page. Completion commits and drops the reader.
An abandoned host session expires after five minutes and rolls back, which
prevents a canceled provider upload from pinning WAL history indefinitely.
Local canonical snapshot creation uses the same single-transaction rule while
streaming records to its private archive. No whole database copy or renderer
corpus is created.

A cursor is opaque to the interface layer and binds the query version,
normalized filter digest, ordering keys, projection version, database
generation, and snapshot identity. A stale cursor returns `CURSOR_STALE`.

No query may scan or sort the full corpus in JavaScript. No query returns an
unbounded ID list. Corpus aggregates execute inside SQLite and return bounded
typed summaries. A view refreshes only invalidated pages and aggregates.

### Select query details

Read this common query contract for every query change, then read each matching
reference before implementation. Multiple query families require multiple
references. These files own the extracted requirements, not optional examples.

- Feed ranking, Saved lists and analytics, Friends feed predicates, shared feed adapters, and secondary-surface joins: [feed-and-secondary.md](queries/feed-and-secondary.md).
- Preferences, item-detail locators, hydration policy, and provider-delivery candidate discovery: [preferences-and-item-detail.md](queries/preferences-and-item-detail.md).
- Selected Person or Account detail, timelines, and contact matching: [person-and-account.md](queries/person-and-account.md).
- RSS subscription catalogs, graph source pages, navigation facets, graph layout, and worker paging: [identity-catalogs.md](queries/identity-catalogs.md).
- Reader body ranges, background maintenance, content enrichment claims, and provider media pages: [content-and-background.md](queries/content-and-background.md).
- Map and Story Wall candidate limits, projections, ordering, and overflow: [map-and-story.md](queries/map-and-story.md).
- Canonical invalidations, follower optimistic overlays, and device-local change feeds: [invalidation-and-overlays.md](queries/invalidation-and-overlays.md).
