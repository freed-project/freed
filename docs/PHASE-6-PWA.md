# Phase 6: PWA

> **Status:** 🚧 In Progress (the official SQLite WebAssembly engine, exact schema identity, single-worker OPFS runtime, and normalized checkpoint activation are implemented; product query cutover, physical iPhone proof, and IndexedDB Library deletion remain open)

> **Architecture:** The PWA runs official SQLite WebAssembly over OPFS in
> one worker. It uses the same schema catalog, named SQL, result DTOs, mutation
> intent codecs, normalized checkpoint records, and conformance vectors as the
> native core. IndexedDB is not a Library database or fallback. A narrow
> IndexedDB keystore may remain only for nonextractable browser keys when
> WebKit offers no suitable alternative.

> **Dependencies:** Phase 4 (Sync Layer), Phase 5 (Desktop App)

## Current SQLite PWA work

- [x] Consume the same generated normalized checkpoint registry, typed primary
      key identity, protocol ceilings, and content chunk transforms as the
      native core. The browser transform has no `00_library_shell` record.
- [x] Generate the exact final normalized SQLite schema bytes and schema digest
      for both browser TypeScript and native Rust from the shared contract.
- [ ] Prove the iOS 17 durability floor through
      physical iPhone storage, suspension, recovery, quota, and playback tests.
- [x] Run official SQLite WebAssembly through one dedicated Library worker over
      the high-performance `opfs-sahpool` VFS, with one bounded protocol, one
      connection generation, one cross-window Library lock, exact schema
      identity verification, and no arbitrary SQL method exposed to React.
- [ ] Add the explicit recovery route and complete physical OPFS lifecycle
      verification in Chromium, WebKit, and iPhone Safari.
- [ ] Persist the Library, query indexes, search, intent outbox, result receipts,
      and sparse optimistic overlay in OPFS-backed SQLite.
  - [x] Install the shared strict transaction, operation, replication,
        invalidation, signed-intent, result, and sparse optimistic-field table
        catalog in browser SQLite with the same schema digest as native Rust.
  - [x] Include the generated FeedItem read, saved, archived, and liked
        programs, member bounds, entity identity, and invalidation topics in
        the shared browser contract. The saved-archive program uses one coupled
        clock and like state uses an independent clock.
  - [x] Commit signed read, saved, archived, and liked follower transactions
        through one closed worker request. Browser SQLite verifies the original
        canonical envelopes and signatures, rechecks the active actor,
        capability, target, and actor tip inside one immediate transaction,
        persists the exact intent plus sparse optimistic fields, and advances
        the local intent tip atomically. Exact byte retries return the durable
        result, changed identity reuse fails, and late write faults roll back
        the transaction.
  - [x] Apply one closed authority-signed Primary result through the same
        worker boundary. Browser SQLite verifies exact canonical bytes and the
        active authority key, requires a contiguous actor-scoped result chain,
        binds the result to one pending intent and its complete optimistic
        field identity set, stores the immutable result, removes the overlay,
        and settles the intent plus result cursor in one immediate transaction.
        It advances the canonical projection only for the exact next source
        revision. A later result is retained without skipping intervening
        authoritative revisions or materializing its rows ahead of catchup.
        Exact retries return the durable receipt. Changed bytes, result-chain
        gaps, incomplete projections, stale authority, and a late cursor fault
        cannot partially settle the result.
  - [x] Page pending and published signed intent members directly from browser
        SQLite through one closed actor-bound worker request. Each page returns
        at most 128 exact canonical members and 1,048,576 serialized bytes in
        actor-counter order. The cursor must name the exact stored operation
        and transaction, one legal 131,072-byte member always fits, and the
        indexed query uses no offset, table scan, temporary sort, shell, or
        reconstructed transaction object.
  - [x] Generate the follower-intent page, transaction-member, and canonical
        byte ceilings from the shared SQLite contract for both Rust and
        TypeScript. The Primary stages exact members outside authoritative
        state, rederives every typed identity from the signed canonical bytes,
        and invokes the atomic resolver only for a complete transaction.
  - [x] Record one exact successful intent publication through a closed browser
        SQLite worker mutation. The local row moves from pending to published
        only after its caller supplies the durable publication identity and
        timestamp. Exact response-loss retries return the same receipt. A
        changed identity, time before transaction creation, missing row, or
        resolved transaction fails without altering SQLite.
  - [x] Include the generated FeedItem removal and tombstone program in the
        shared browser contract. Browser execution and restore remain open.
  - [x] Include the generated normalized FeedItem capture program in the shared
        browser contract with a 32-member transaction bound, 131,072-byte
        canonical item ceiling, typed root and child SQL, refresh-safe user
        state ownership, and tombstone refusal. Browser SQLite now accepts the
        signed capture as an intent without changing canonical rows, then
        materializes the exact stored payload through that generated program
        only after a valid accepted Primary result advances the source
        revision.
  - [x] Verify signed transaction members through the executable operation
        registry instead of a hand-maintained operation list. Accepted results
        replay every registered upsert, assignment, reach-out, preference, and
        removal family through the same generated SQL used by native Rust.
        Transactions are homogeneous and honor each program's member bound.
        Exact next-revision commits emit one entity-scoped invalidation per
        member. Results beyond the next revision settle durably but wait for
        ordered operation or checkpoint catchup before changing canonical rows.
- [ ] Import normalized typed checkpoints into a verified staging database and
      activate only after exact registry, frontier, state, and content-root
      proof.
  - [x] Stage closed normalized records directly in browser SQLite with the
        exact 128-record and 2,097,152-byte page ceilings, canonical byte
        identity, idempotent replay, and changed-replay rejection. IndexedDB
        and Library shells do not participate in staging.
  - [x] Verify the cross-runtime checkpoint digest, apply generated row import
        SQL in one transaction, validate every foreign key, content chunk,
        accepted authority, actor chain tip, and normalized capability, and
        activate only an empty SQLite target. Failure preserves the staged
        records and leaves the active Library empty.
- [ ] Serve every product surface through bounded named SQLite queries without
      holding or scanning a corpus in React.
  - [x] `feed_page_v1` executes the generated normalized SQL in SQLite
        WebAssembly with a source-fenced keyset cursor, at most 129 scanned
        rows for a 128-row response, exact response-byte enforcement, and a
        closed worker request that cannot carry arbitrary SQL.
  - [x] All browser queries now cross one typed `query` worker request whose
        discriminated query ID selects the exact request and response types.
        The former feed-specific worker method is deleted. Future named
        queries extend the closed union instead of adding transport methods.
  - [x] `library_facet_summary_v1` reads trigger-maintained SQLite counters,
        saved-platform counts, and tag refcounts without scanning FeedItem
        rows. The worker returns one source-fenced bounded summary with exact
        binary UTF-8 tag order through the same typed query request.
  - [x] `saved_analytics_v2` executes the same generated one-row aggregate as
        native Rust. Browser SQLite returns exact Saved totals, latest time,
        seven day buckets, 24 hour buckets, and bounded source and content
        counts without scanning FeedItems in TypeScript or returning item rows
        to React.
  - [x] `saved_feed_page_v2` executes the same four generated Saved query
        variants and cursor codec as native Rust. Browser SQLite applies the
        complete filter, exact count, forward or reverse keyset, and selected
        sort before returning at most 128 compact cards. Every variant uses
        its matching expression index without a temporary sort, and no
        FeedItem corpus enters TypeScript.
  - [x] `preferences_snapshot_v1` reads normalized typed nodes directly from
        browser SQLite through the shared typed query request. It preserves all
        five value kinds, exact binary UTF-8 path order, and the shared 512-row
        and 2 MiB response ceilings without materializing a settings shell.
  - [x] `item_detail_v1` performs one primary-key lookup in browser SQLite and
        returns the same closed compact card and typed reader-body locators as
        native Rust. Full reader content remains outside the metadata response.
  - [x] `item_reader_body_v1` returns exact bounded byte ranges from inline
        SQLite text or content-addressed chunks through the same closed worker
        query union as native Rust. Cross-chunk ranges reassemble losslessly,
        and no reader request can return more than 256 KiB of body bytes.
  - [x] `background_item_page_v1` uses the same source-fenced binary identity
        cursor as native Rust to traverse compact background metadata. Browser
        SQLite returns at most 64 rows from a 65-row primary-key read, includes
        hidden and archived records, and never returns reader bodies or accepts
        arbitrary SQL.
  - [x] `change_feed_v1` returns only bounded topic, changed-identity, and
        reset notices from browser SQLite. Continuation pages retain one pinned
        upper revision while later writes arrive, revision gaps fail closed,
        and checkpoint activation writes one Library-wide reset notice.
  - [x] `person_timeline_v1` names one Person and walks the same generated,
        trigger-maintained timeline index as native Rust. Each page reads at
        most 101 rows, returns at most 100 compact cards and 2 MiB, and binds
        continuation to both the Person identity and SQLite source fence.
  - [x] `feed_browse_page_v3` applies ranked feed filters and bidirectional
        keyset paging directly in browser SQLite through the same closed query
        program and cursor codec as native Rust. Its registered expression
        index supplies both directions without a temporary sort. Each request
        reads at most 129 rows, returns at most 128, and carries no historical
        renderer source sequence.
- [ ] Support metadata only, streaming, partial cache, full cache, pinned
      offline, and excluded content modes per device and rendition.
- [ ] Delete IndexedDB Library generations, rows, overlays, checkpoint cursors,
      search postings, and compatibility code after verified cutover.

---

## Overview

The PWA is Freed's complete mobile client. It queries a local SQLite Library,
supports durable edits through signed intents, manages selective offline
content, and enforces a first-run legal gate before synchronization or update
side effects begin.

**Key architectural decisions:**

- **Shared codebase** — Same React app embedded in Desktop WebView and deployed to [app.freed.wtf](https://app.freed.wtf), with the dev channel on `dev-app.freed.wtf`
- **Local SQLite client:** Executes bounded named queries locally and displays canonical rankings computed by the Primary
- **Light saves:** Saves URL stubs immediately; full detail extraction requires Freed Desktop
- **Offline-first:** Service worker precaches the app shell and bounded static assets. Library records, search, intents, results, and content indexes live in SQLite WebAssembly over OPFS. Large content lives in separate OPFS vault files.
- **Versioned first-run consent** — PWA startup is blocked until the current legal bundle is accepted locally in the browser
- **URL-driven navigation** — Active view, feed scope, and open reader state serialize into the URL so browser back and forward behave naturally
- **Desktop handoff in source settings:** PWA Settings exposes Feeds, X / Twitter, Facebook, Instagram, LinkedIn, and Google Contacts as sync status dashboards with clear Freed Desktop management handoff states
- **Mobile settings scope:** PWA Settings hides AI controls and source connection controls that only Freed Desktop can run
- **Cloud sync diagnostics:** PWA Settings shows local item count, Drive stage, last download, last import, last intent upload, remote bytes, the last cloud error, why synchronization is waiting, recent Drive activity, and a manual `Sync now` action. The PWA imports immutable normalized checkpoints into local SQLite and publishes signed user intents without downloading or synchronizing a live SQLite file.
- **Blank-state testing escape hatch** — PWA empty states now include a secondary sample-data section below the main handoff prompt for quick local testing
- **Archived saved-item repair control** — Archived views now surface a one-click `Unarchive Saved Content` action when legacy or imported items end up both saved and archived
- **Safe optimistic user mutations:** Read, saved, archived, and liked changes commit to a sparse local SQLite overlay and the signed epoch-scoped intent outbox atomically. They remain Pending until the Primary publishes canonical acceptance, and provider-visible success requires a separate real provider result receipt. Device display controls remain local. Friends graph pins use closed one-row SQLite set and clear programs over OPFS and never enter the signed intent outbox.
- **Bounded Friends graph source:** The shared graph engine can pump OPFS SQLite Person, Account, and RSS pages into its worker one acknowledged page at a time. The worker compiles compact scene state under one canonical and local-layout fence, returns only scene buffers and visible metadata, and refuses more than 100,000 semantic rows. PWA product-store wiring remains part of the reader cutover.
- **People mutations:** Person and Account creation, bounded batch creation, synchronized profile and relationship updates, connection-person promotion, bounded reach-out history, and atomic removal use registered signed intent mutations and update the sparse local SQLite overlay immediately. Device-local graph coordinates stay outside canonical payloads.
- **FeedItem capture mutations:** New and updated FeedItems enter the signed epoch-scoped intent outbox in ordered bounded transactions. Local SQLite and search update after each durable batch, repeated identities retain input order across transaction boundaries, and device-local ranking fields never enter canonical payloads.
- **Library maintenance mutations:** Sample seeding, fingerprinted sample clearing, and bulk feed removal use the same signed Library Core operations as normal writes. SQLite executes registered bounded maintenance mutations without a JavaScript corpus scan.
- **SQLite-only PWA:** SQLite WebAssembly over OPFS is the only PWA Library row store. Production builds reject Automerge assets, retired registry payloads, IndexedDB Library databases, legacy `/sync` routes, and rollback flags that could reactivate a retired runtime.
- **Complete bounded reads:** Feed filters, all Saved orders, facets, Friends activity and timelines, Map, and Story Wall use registered SQLite queries beyond the visible interface window. Query pages are capped, source movement fails closed, and React retains only the visible and adjacent windows.
- **Narrow secondary surfaces:** The OPFS SQLite engine runs `map_markers_v1` and `story_wall_candidates_v1` through the one typed worker dispatch. Map receives at most 1,000 compact location rows. Story Wall receives at most 250 compact media rows with eight media references each. Neither query returns a general FeedItem or reader body.
- **Mobile chrome polish:** The PWA mobile toolbar uses balanced menu and format controls, every top-level view keeps Theme and Zoom at the top of the far-right menu with tappable 10% zoom steps, the mobile drawer starts with search, Settings stacks compact sections, and the reader keeps fixed menus plus sane article spacing

---

## Design Philosophy

**Core Principles:**

1. **Timeline by default, unread tracking opt-in** — Ephemeral content flows by; important sources can track unread
2. **Unified content types** — RSS, videos, podcasts, social in one view
3. **Clean, minimal chrome** — Content-first design
4. **Seamless sync** — Immutable Library Core checkpoints, operation segments, and PWA intents through Google Drive

**Key Features:**

1. **Per-source unread tracking** — Enable for newsletters and priority sources, mark items read when they scroll past, and finish the list when you leave after reaching bottom
2. **Reading enhancements** — Focus mode, font options, theming
3. **Custom ranking** — User-controlled weights, not engagement
4. **Source filtering** — View by platform, author, or topic
5. **Compact feed actions** — Header-level like, comment, save, archive, and open affordances keep cards scannable on small screens
6. **Instant safe mutations** — Safe user-triggered data changes update visible content before worker reconciliation, while destructive paths still wait for confirmed source-of-truth state

---

## Package Structure

```
packages/pwa/
├── public/
│   ├── favicon.svg
│   └── manifest.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── BottomNav.tsx
│   │   │   └── Header.tsx
│   │   │
│   │   ├── feed/
│   │   │   ├── FeedList.tsx
│   │   │   ├── FeedItem.tsx
│   │   │   ├── FeedItemExpanded.tsx
│   │   │   └── FocusText.tsx
│   │   │
│   │   ├── sources/
│   │   │   ├── SourceList.tsx
│   │   │   └── AddSourceModal.tsx
│   │   │
│   │   └── settings/
│   │       ├── SettingsPanel.tsx
│   │       ├── WeightSliders.tsx
│   │       └── SyncSettings.tsx
│   │
│   ├── hooks/
│   │   ├── useFreedDoc.ts
│   │   ├── useFeed.ts
│   │   ├── useSyncStatus.ts
│   │   └── usePreferences.ts
│   │
│   └── lib/
│       ├── ranking.ts
│       ├── focus-text.ts
│       └── filters.ts
│
├── index.html
├── package.json
├── vite.config.ts
└── tailwind.config.ts
```

---

## Visual Design

**Layout:** Three-column (sources | feed | reader) on desktop, single column with bottom nav on mobile.

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌─────────┐  ┌─────────────────────────────────────────────┐  │
│  │ Sources │  │         Feed Timeline                       │  │
│  │ ─────── │  │  ┌─────────────────────────────────────┐    │  │
│  │ All     │  │  │ ◉ Source Name              2h ago │    │  │
│  │ X       │  │  │ Article headline with enough      │    │  │
│  │ RSS     │  │  │ text to show the first few lines  │    │  │
│  │ Saved   │  │  │ ┌───────────────────────────────┐ │    │  │
│  │         │  │  │ │      [Hero Image]             │ │    │  │
│  │ Folders │  │  │ └───────────────────────────────┘ │    │  │
│  │ ─────── │  │  └─────────────────────────────────────┘    │  │
│  │ Friends │  │                                              │  │
│  │ Tech    │  │  ┌─────────────────────────────────────┐    │  │
│  │ News    │  │  │ Next item...                       │    │  │
│  └─────────┘  │  └─────────────────────────────────────┘    │  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Reading Enhancements

### Focus Mode

Bolds word beginnings to create fixation points:

```typescript
// packages/pwa/src/lib/focus-text.ts
export interface FocusOptions {
  enabled: boolean;
  intensity: "light" | "normal" | "strong";
}

export function applyFocusMode(
  text: string,
  options: FocusOptions,
): TextSegment[] {
  if (!options.enabled) return [{ text, emphasis: false }];

  const segments: TextSegment[] = [];
  const words = text.split(/(\s+)/);

  for (const word of words) {
    if (/^\s+$/.test(word)) {
      segments.push({ text: word, emphasis: false });
    } else if (/^[a-zA-Z]+$/.test(word)) {
      const count = getEmphasisCount(word.length, options.intensity);
      segments.push({ text: word.slice(0, count), emphasis: true });
      if (word.length > count) {
        segments.push({ text: word.slice(count), emphasis: false });
      }
    } else {
      segments.push({ text: word, emphasis: false });
    }
  }

  return segments;
}
```

---

## Feed Display

PWA displays items sorted by pre-computed `priority` score from Desktop/OpenClaw:

```typescript
// packages/pwa/src/lib/feed.ts
export function sortFeedItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

// Optional: local filtering (doesn't recompute scores)
export function filterByPlatform(
  items: FeedItem[],
  platform: Platform | null,
): FeedItem[] {
  if (!platform) return items;
  return items.filter((item) => item.platform === platform);
}

export function filterByAuthor(
  items: FeedItem[],
  authorId: string | null,
): FeedItem[] {
  if (!authorId) return items;
  return items.filter((item) => item.author.id === authorId);
}
```

**Note:** Each operational environment runs the same registered ranking and
filter query against its local SQLite database. The PWA does this inside its
SQLite WebAssembly worker and keeps only bounded visible pages in React.

---

## Tasks

| Task | Description                                                                                                                                                                       | Complexity |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 6.1  | Vite + React + Tailwind scaffold                                                                                                                                                  | Low        |
| 6.2  | AppShell layout (sidebar + timeline)                                                                                                                                              | Medium     |
| 6.3  | Feed components (list, item, expanded)                                                                                                                                            | Medium     |
| 6.4  | Virtual scrolling (1000+ items)                                                                                                                                                   | Medium     |
| 6.5  | Focus mode text renderer                                                                                                                                                          | Low        |
| 6.6  | Feed ranking algorithm                                                                                                                                                            | Medium     |
| 6.7  | Platform/author filters                                                                                                                                                           | Low        |
| 6.8  | Settings panel                                                                                                                                                                    | Medium     |
| 6.9  | RSS sync status dashboard                                                                                                                                                         | Medium     | ✓ Complete (PWA browses synced RSS while Freed Desktop manages subscriptions, polling, and OPML) |
| 6.10 | Connect to sync layer                                                                                                                                                             | Medium     |
| 6.11 | PWA manifest + service worker                                                                                                                                                     | Medium     |
| 6.12 | Offline support + image caching                                                                                                                                                   | High       |
| 6.13 | Add to homescreen prompt                                                                                                                                                          | Low        |
| 6.14 | First-run legal gate with local-only acceptance storage                                                                                                                           | Low        |
| 6.15 | URL navigation state with browser back/forward support                                                                                                                            | Low        |
| 6.16 | Public-safe bundles and private GitHub vulnerability reports                                                                                                                      | Medium     |
| 6.17 | Complete bounded IndexedDB Library parity for feed, Saved, Friends, Map, and Story Wall                                                                                           | High       | ✓ Complete                                                                                       |
| 6.18 | Retire the Automerge service-worker cache route and enforce the Desktop and PWA release artifact boundary                                                                         | Medium     | ✓ Complete                                                                                       |
| 6.19 | Execute the shared indexed `person_timeline_v1` query in browser SQLite with exact native parity and no renderer-built account-key filter                                         | High       | ✓ Complete                                                                                       |
| 6.20 | Execute indexed bidirectional `feed_browse_page_v3` in browser SQLite with exact native parity and no renderer source-enumeration tie                                             | High       | ✓ Complete                                                                                       |
| 6.21 | Execute all four indexed bidirectional `saved_feed_page_v2` variants in browser SQLite with exact native cursor parity                                                            | High       | ✓ Complete                                                                                       |
| 6.22 | Validate every browser and native SQLite query response through one shared request-bound typed dispatcher before a client receives it                                             | High       | ✓ Complete                                                                                       |
| 6.23 | Route ordinary feed, Saved feed, and signal counts through one shared normalized query adapter backed by the PWA OPFS SQLite worker, with bounded compact rows and opaque cursors | High       | ✓ Complete                                                                                       |
| 6.24 | Route item detail, Library facets, Saved analytics, Map, and Story Wall through one shared normalized secondary-surface adapter backed by PWA OPFS SQLite | High | ✓ Complete |
| 6.25 | Route Friends feed paging through the shared normalized bidirectional feed query, with friend membership resolved from Account and Person relations inside PWA SQLite | High | ✓ Complete |

---

## Deployment

Vercel project `freed-pwa` now follows the dev-first branch flow.

- **Production:** [app.freed.wtf](https://app.freed.wtf)
- **Dev:** `dev-app.freed.wtf` via native Vercel deploys from `dev`
- **Preview:** Auto-generated per pull request

Build chain: `@freed/shared` → `@freed/sync` → `vite build` (configured in `packages/pwa/vercel.json`).

---

## Success Criteria

- [x] PWA deploys to app.freed.wtf via Vercel
- [x] Merges to `dev` redeploy `dev-app.freed.wtf`
- [x] PWA can switch locally between the production and dev release channels, redirecting between `app.freed.wtf` and `dev-app.freed.wtf`
- [x] Dev snapshots keep the last release version visible and add build provenance in Settings
- [x] Feed displays bounded pages from the authenticated IndexedDB Library Core generation
- [x] Per-source unread tracking works for opted-in feeds
- [x] Virtual scrolling handles 1000+ items smoothly
- [x] Reading enhancements work correctly (focus mode, font, reader view)
- [x] Ranking weights affect item order
- [x] Platform/author filters work (sidebar filter by platform/feed)
- [x] RSS source accordion pages subscriptions in the sidebar and top search moves matching feeds into the first page
- [x] RSS subscriptions, polling, and OPML management stay in Freed Desktop while the PWA shows synced feed and item status. Only the last successful refresh syncs. Retry timing and failures remain local to the polling device. Deprecated synchronized HTTP validators are ignored because the current Desktop transport does not persist them.
- [x] First launch is blocked behind a local-only legal clickwrap gate
- [x] PWA factory reset fences every open tab before clearing device preferences, the selected relay and cloud credentials, worker diagnostics, and all local Library Core IndexedDB databases. A durable cleanup barrier keeps automatic cloud sync paused after failed cloud deletion until reset succeeds or the user explicitly reconnects. OAuth handoff values, reader caches, and geocoding caches remain on the device. OAuth callbacks started before reset are rejected by their installation generation. Legal acceptance, release channel, and install prompt dismissal remain installation state.
- [x] Active view, feed filters, and reader selection round-trip through the URL for browser back/forward navigation
- [x] Settings and crash recovery surfaces can export public-safe bug report bundles
- [x] Bug report actions now label whether they download a public-safe or private bundle, and private diagnostics can be toggled as one group before emailing a report
- [x] Private reports can send a redacted description and selected stack traces to the repository's private GitHub vulnerability inbox after an explicit click, with no automatic retry and no diagnostic zip upload
- [x] PWA Settings surfaces Feeds, X / Twitter, Facebook, Instagram, LinkedIn, and Google Contacts as status-only sections with Freed Desktop sync and download handoff states
- [x] PWA Settings surfaces cloud sync diagnostics for connected Google Drive accounts so users can see whether the browser imported an immutable checkpoint, published signed intents, reconciled results, hit an error, or needs a manual `Sync now` pass
- [x] PWA Google Drive resume, manual sync, and OAuth callback sync import only a complete authenticated immutable Library Core generation, publish signed epoch-scoped intents, refresh and retry once when Drive unexpectedly rejects an expired access token, disconnect by clearing the captured provider credentials before resetting app connection state, and never synchronize a SQLite database, WAL, or SHM file
- [x] PWA control, intent head, and result head adapters sample the shared bounded strong Drive v2 JSON ETag around each v3 media read and use exact v2 media PUT with If-Match for mutable updates. All immutable, list, create, media read, multipart, and resumable traffic remains on Drive v3. The request count and 60-second cadence are unchanged, and a stale ETag fails as `412` before exact current readback.
- [x] Person add, bounded batch add, and synchronized profile updates use whole-record Library Core intents while device-local graph coordinates remain local
- [x] FeedItem capture and whole-record updates use bounded signed Library Core intents, update IndexedDB and search without waking Automerge, preserve repeated-identity order, and exclude device-local ranking fields
- [x] Sample seeding, fingerprinted sample clearing, and bulk feed removal use Library Core operations without waking Automerge or deleting real linked accounts
- [x] Production PWA bundles contain no Automerge JavaScript, worker, WASM asset, retired registry payload, or legacy `/sync` service-worker route. Stale rollback state cannot reactivate the retired engine, while historical verification and the required legacy-presence loss fence remain available.
- [x] Full-library search keeps its normalized term projection in IndexedDB, streams scored matches in 32-row pages, and retains at most 100 result cards in React instead of rebuilding a corpus-wide MiniSearch heap
- [x] Runtime state, counts, full-library scans, and item detail resolve from the current IndexedDB materialization after local intents instead of rereading the immutable bootstrap checkpoint. Fractional location coordinates survive canonical signing and restart exactly, and hidden or archived captures remain stored without corrupting visible feed totals.
- [x] Archived, provider, feed, tag, signal, author, hidden, post, and story filters, all four Saved orders, facets, Saved analytics, Friends graph and timelines, Map, and Story Wall read the complete selected IndexedDB generation. Browser acceptance covers 2,607 records in Chromium and WebKit.
- [x] PWA Settings omits AI controls and provider management controls that only Freed Desktop can run
- [x] Theme changes in Settings temporarily clear the frosted backdrop on touch devices so the active page treatment stays visible while previewing themes
- [x] Mobile Settings now open as a full-height sheet with a persistent close button, larger back target, and reliable section jumps instead of snapping back to the last scrolled provider section
- [x] Mobile Settings use full-size shared settings typography, compact stacked sections, and a dedicated Support modal launched from Danger Zone
- [x] Shared Settings list panels keep RSS management and OPML previews inside filtered inner scrollers capped to the Settings sheet height
- [x] Appearance exposes `Show read in grayscale`, and mark-read-on-scroll now subtracts the feed list offset before marking mobile rows as passed
- [x] The shared floating mobile sidebar now behaves like a real toggle, so the same hamburger button opens and closes it cleanly
- [x] The mobile toolbar keeps the hamburger furthest left, the format menu furthest right, and viewport-fixed action menus while reader content scrolls
- [x] Mobile feed and reader gutters are balanced so cards and zoomed reader articles avoid lopsided spacing and excessive blank space under short content
- [x] Private diagnostics stay opt-in and are clearly separated from public GitHub sharing
- [x] PWA installable on mobile (add to homescreen) — manifest ids and scope set, browser install notice shipped, iOS Safari homescreen guidance shipped, Playwright coverage added
- [x] Offline access works (service worker + image cache), article HTML and cacheable reader images are warmed locally for offline reading
- [x] Legacy synced reader HTML remains available through an on-demand worker fallback, stays out of hydrated feed lists, and is cached locally when opened without deleting another device's only compatibility copy
- [x] The article proxy resolves and pins public addresses, revalidates every bounded redirect, rejects non-HTML responses, and stops oversized response bodies before they exhaust server memory
- [x] Saved reader content uses the permanent pinned cache tier by default, with local cache modes for Saved Only, Everything Opened, Recent Feed, and Manual Only

---

## Dependencies

```json
{
  "dependencies": {
    "@freed/shared": "*",
    "@freed/sync": "*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.22.0",
    "@tanstack/react-virtual": "^3.0.0",
    "framer-motion": "^11.0.0",
    "zustand": "^4.5.0",
    "date-fns": "^3.3.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "tailwindcss": "^4.0.0",
    "vite": "^5.1.0",
    "vite-plugin-pwa": "^0.18.0"
  }
}
```

---

## Deliverable

Mobile-friendly PWA at [app.freed.wtf](https://app.freed.wtf), plus the dev channel at `dev-app.freed.wtf`, with offline article, image, and pinned saved-reader support.
