# Phase 6: PWA

> **Status:** 🚧 In Progress (the official SQLite WebAssembly engine, exact schema identity, single-worker OPFS runtime, normalized checkpoint import, product mutation entrypoints, bounded feed and identity queries, navigation aggregates, follower transport coordinator, selective content range publication, bounded range reads, startup reconciliation, and IndexedDB Library deletion are implemented; Google Drive adapter binding, recovery UI, and physical iPhone proof remain open)

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
- [x] Publish one authenticated content range through sequential worker frames
      no larger than 256 KiB. Hash bytes incrementally, flush and close the OPFS
      object, then register its canonical range identity in SQLite. Changed or
      incomplete bytes are deleted without creating availability.
- [x] Reconcile the OPFS content vault before the worker becomes ready. Preserve
      exact file-length proofs, remove orphan or partial files, prune missing or
      mismatched SQLite proofs in bounded pages, and advance device content
      revision once when availability changes.
- [x] Read verified OPFS media through the SQLite worker in windows capped at
      256 KiB. SQLite resolves the canonical range proof and storage key;
      callers supply no OPFS path and receive no unbounded rendition.
- [x] Promote OPFS content to fully cached or pinned offline only after the
      worker streams every canonical range through the full-content digest.
      Exact replay is revision-stable and aggregate availability carries no
      fake monolithic storage key.
- [x] Purge excluded OPFS content through the worker in bounded 128-proof
      pages, cancel matching staged publications, and refuse eviction while
      the rendition remains pinned offline.
- [x] Page automatic hydration and least-recently-used eviction work through
      the same generated SQL as native Rust. Worker responses are capped at
      128 rows and source-fenced. Cached reads coalesce local recency writes,
      and cache pressure must present the exact candidate recency before OPFS
      bytes can be removed.
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
  - [x] Route PWA read, saved, archived, and liked product actions through the
        OPFS SQLite mutation context and commit boundary. SQLite supplies the
        active Library, epoch, enrolled actor, actor tip, capability presence,
        and bounded accepted frontier. IndexedDB is consulted only to sign the
        exact operation digest with the matching nonextractable actor key. It
        does not assign sequence numbers, retain an optimistic overlay, or
        receive a second copy of the mutation. A lost worker response retries
        the exact canonical transaction bytes once.
  - [x] Route FeedItem capture and removal, RSS feed changes, synchronized
        preference patches, Person upserts and removal, and Account upserts and
        removal through the same OPFS SQLite follower transaction boundary.
        Product code no longer calls an IndexedDB mutation method. Capture
        batches use the generated 32-member materializer ceiling. Other record
        batches use the generated 256-member ceiling. Repeated identities split
        before transaction assembly so every transaction remains homogeneous
        and unambiguous.
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
  - [x] Import one closed normalized v2 result transport segment through OPFS
        SQLite. The browser reconstructs and verifies the semantic segment
        digest from its direct canonical signed result records before opening
        one immediate transaction. Result materialization, optimistic overlay
        cleanup, logical cursor advancement, immutable-object receipt, and
        transport-head advancement commit or roll back together. Exact retries
        return the stored receipt, while changed bytes or object identity fail
        closed.
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
- [x] Import normalized typed checkpoints into a verified staging database and
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
  - [x] Replace an existing browser materialization inside one immediate SQLite
        transaction, matching native replacement semantics. Replacement fails
        before deleting canonical rows when any intent, optimistic field,
        replication result, or Primary staging transaction remains unresolved.
        Successful follower activation installs the exact checkpoint,
        manifest, writer, control, source revision, and installation receipt,
        which is readable through one closed worker response.
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
        binary UTF-8 tag order through the same typed query request. Covering
        indexes also provide per-platform latest activity, the latest enabled
        RSS fetch, and Google Contact import and linked-Person totals.
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
        and 2 MiB response ceilings without materializing a settings shell. A
        shared prototype-safe transform reconstructs bounded objects, arrays,
        quoted keys, and scalar leaves. PWA state hydration now takes
        synchronized preferences from this SQLite query instead of
        `00_library_shell`.
  - [x] `item_detail_v1` performs one primary-key lookup in browser SQLite and
        returns the same closed compact card and typed reader-body locators as
        native Rust. Full reader content remains outside the metadata response.
  - [x] `rss_feed_detail_v1` performs one primary-key lookup in browser SQLite
        and returns the same complete synchronized RSS Feed record as native
        Rust under a 64 KiB source-fenced response ceiling. Device-local
        scheduler state and compatibility-only HTTP validators never enter the
        query result.
  - [x] `item_reader_body_v1` returns exact bounded byte ranges from inline
        SQLite text or content-addressed chunks through the same closed worker
        query union as native Rust. Cross-chunk ranges reassemble losslessly,
        and no reader request can return more than 256 KiB of body bytes.
  - [x] `background_item_page_v1` uses the same source-fenced binary identity
        cursor as native Rust to traverse compact background metadata. Browser
        SQLite returns at most 64 rows from a 65-row primary-key read, includes
        hidden and archived records, and never returns reader bodies or accepts
        arbitrary SQL. PWA product scans call the shared adapter against OPFS
        SQLite and no longer page IndexedDB materialized FeedItem records. The
        closed row preserves RSS identity and sample provenance for maintenance
        actions.
  - [x] `content_fetch_claim_v1` executes the same generated SQL and closed
        four-field candidate contract in OPFS SQLite as native Rust. It pages
        at most 64 linked rows without preserved inline or blob content and
        never reconstructs candidates from IndexedDB records.
  - [x] `provider_media_page_v1` runs through OPFS SQLite with the same closed
        request, compact projection, generated SQL, 64-row response ceiling,
        and request-bound cursor as native Rust. Provider settings can share
        this contract without IndexedDB records or a browser-specific query.
  - [x] `change_feed_v1` returns only bounded topic, changed-identity, and
        reset notices from browser SQLite. Continuation pages retain one pinned
        upper revision while later writes arrive, revision gaps fail closed,
        and checkpoint activation writes one Library-wide reset notice.
  - [x] `person_timeline_v1` names one Person and walks the same generated,
        trigger-maintained timeline index as native Rust. Each page reads at
        most 101 rows, returns at most 100 compact cards and 2 MiB, and binds
        continuation to both the Person identity and SQLite source fence.
  - [x] `account_timeline_v1` names one unlinked Account and executes the same
        indexed typed Account-to-FeedItem join as native Rust. It carries the
        same row and byte bounds while binding continuation to the Account and
        SQLite source fence.
  - [x] `feed_browse_page_v3` applies ranked feed filters and bidirectional
        keyset paging directly in browser SQLite through the same closed query
        program and cursor codec as native Rust. Its registered expression
        index supplies both directions without a temporary sort. Each request
        reads at most 129 rows, returns at most 128, and carries no historical
        renderer source sequence.
  - [x] `friends_directory_page_v1` applies Friends search, relationship
        filters, outreach state, location presence, and the selected ordering
        inside browser SQLite. The same generated SQL and closed request run in
        native Rust. Each response returns at most 64 compact Person rows under
        512 KiB, carries an exact filtered total, and binds its opaque offset
        cursor to the complete request and SQLite source generation. The
        Friends overview retains only its visible page in React. Its closed row
        model now generates the PWA SQLite coercer, strict wire parser,
        TypeScript row type, and native Rust field descriptor from one contract
        definition, so browser and native result transforms cannot drift.
  - [x] `account_link_candidates_v1` runs the same generated selected-identity
        query in OPFS SQLite and native Rust. It returns at most five exact
        name or handle matches under 64 KiB. Friends retains only those visible
        recommendations and no longer builds a complete Person-to-Account
        candidate index in JavaScript.
  - [x] The Account detail and graph linking controls share one
        `person_picker_page_v1` hook backed by OPFS SQLite. It retains at most
        twelve compact Person rows and reads link-candidate labels from their
        five-row typed response instead of consulting identity dictionaries.
  - [x] `friend_candidate_review_v1` runs the same generated ranking program
        in OPFS SQLite and native Rust. It returns at most ten source-fenced
        candidates under 512 KiB from normalized identity, activity,
        content-signal, and bounded contact-overlap evidence. React retains no
        Person, Account, FeedItem, or activity dictionary for candidate review.
- [ ] Support metadata only, streaming, partial cache, full cache, pinned
      offline, and excluded content modes per device and rendition.
- [x] Delete IndexedDB Library generations, rows, overlays, checkpoint cursors,
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
- **Bounded Friends graph source:** The shared graph engine pumps OPFS SQLite Person, Account, and RSS pages into its worker one acknowledged page at a time. The worker compiles compact scene state under one canonical and local-layout fence, returns only scene buffers and visible metadata, and refuses more than 100,000 semantic rows. The React graph has no Account catalog or dictionary fallback. It selects stable IDs and reads labels and admitted counts from worker-owned metadata. Account linking searches OPFS SQLite through `person_picker_page_v1` and retains at most 12 compact Person rows.
- **People mutations:** Person and Account creation, bounded batch creation, synchronized profile and relationship updates, connection-person promotion, bounded reach-out history, and atomic removal use registered signed intent mutations and update the sparse local SQLite overlay immediately. Device-local graph coordinates stay outside canonical payloads.
- **FeedItem capture mutations:** New and updated FeedItems enter the signed epoch-scoped intent outbox in ordered bounded transactions. Local SQLite and search update after each durable batch, repeated identities retain input order across transaction boundaries, and device-local ranking fields never enter canonical payloads.
- **Library maintenance mutations:** Sample seeding, fingerprinted sample clearing, and bulk feed removal use the same signed Library Core operations as normal writes. SQLite executes registered bounded maintenance mutations without a JavaScript corpus scan.
- **Exact RSS mutations:** Feed rename emits only `rss_feed_title_assignment`. Bulk removal atomically freezes the exact RSS scope in OPFS SQLite, then emits signed removal transactions of at most 256 feeds. Neither path reads or replaces a renderer feed dictionary.
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

| Task | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Complexity |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 6.1  | Vite + React + Tailwind scaffold                                                                                                                                                                                                                                                                                                                                                                                                                             | Low        |
| 6.2  | AppShell layout (sidebar + timeline)                                                                                                                                                                                                                                                                                                                                                                                                                         | Medium     |
| 6.3  | Feed components (list, item, expanded)                                                                                                                                                                                                                                                                                                                                                                                                                       | Medium     |
| 6.4  | Virtual scrolling (1000+ items)                                                                                                                                                                                                                                                                                                                                                                                                                              | Medium     |
| 6.5  | Focus mode text renderer                                                                                                                                                                                                                                                                                                                                                                                                                                     | Low        |
| 6.6  | Feed ranking algorithm                                                                                                                                                                                                                                                                                                                                                                                                                                       | Medium     |
| 6.7  | Platform/author filters                                                                                                                                                                                                                                                                                                                                                                                                                                      | Low        |
| 6.8  | Settings panel                                                                                                                                                                                                                                                                                                                                                                                                                                               | Medium     |
| 6.9  | RSS sync status dashboard                                                                                                                                                                                                                                                                                                                                                                                                                                    | Medium     | ✓ Complete (PWA browses synced RSS while Freed Desktop manages subscriptions, polling, and OPML) |
| 6.10 | Connect to sync layer                                                                                                                                                                                                                                                                                                                                                                                                                                        | Medium     |
| 6.11 | PWA manifest + service worker                                                                                                                                                                                                                                                                                                                                                                                                                                | Medium     |
| 6.12 | Offline support + image caching                                                                                                                                                                                                                                                                                                                                                                                                                              | High       |
| 6.13 | Add to homescreen prompt                                                                                                                                                                                                                                                                                                                                                                                                                                     | Low        |
| 6.14 | First-run legal gate with local-only acceptance storage                                                                                                                                                                                                                                                                                                                                                                                                      | Low        |
| 6.15 | URL navigation state with browser back/forward support                                                                                                                                                                                                                                                                                                                                                                                                       | Low        |
| 6.16 | Public-safe bundles and private GitHub vulnerability reports                                                                                                                                                                                                                                                                                                                                                                                                 | Medium     |
| 6.17 | Preserve feed, Saved, Friends, Map, and Story Wall behavior through the SQLite cutover                                                                                                                                                                                                                                                                                                                                                                       | High       | ✓ Complete                                                                                       |
| 6.18 | Retire the Automerge service-worker cache route and enforce the Desktop and PWA release artifact boundary                                                                                                                                                                                                                                                                                                                                                    | Medium     | ✓ Complete                                                                                       |
| 6.19 | Execute the shared indexed `person_timeline_v1` query in browser SQLite with exact native parity and no renderer-built account-key filter                                                                                                                                                                                                                                                                                                                    | High       | ✓ Complete                                                                                       |
| 6.20 | Execute indexed bidirectional `feed_browse_page_v3` in browser SQLite with exact native parity and no renderer source-enumeration tie                                                                                                                                                                                                                                                                                                                        | High       | ✓ Complete                                                                                       |
| 6.21 | Execute all four indexed bidirectional `saved_feed_page_v2` variants in browser SQLite with exact native cursor parity                                                                                                                                                                                                                                                                                                                                       | High       | ✓ Complete                                                                                       |
| 6.22 | Validate every browser and native SQLite query response through one shared request-bound typed dispatcher before a client receives it                                                                                                                                                                                                                                                                                                                        | High       | ✓ Complete                                                                                       |
| 6.23 | Route ordinary feed, Saved feed, and signal counts through one shared normalized query adapter backed by the PWA OPFS SQLite worker, with bounded compact rows and opaque cursors                                                                                                                                                                                                                                                                            | High       | ✓ Complete                                                                                       |
| 6.24 | Route item detail, Library facets, Saved analytics, Map, and Story Wall through one shared normalized secondary-surface adapter backed by PWA OPFS SQLite                                                                                                                                                                                                                                                                                                    | High       | ✓ Complete                                                                                       |
| 6.25 | Route Friends feed paging through the shared normalized bidirectional feed query, with friend membership resolved from Account and Person relations inside PWA SQLite                                                                                                                                                                                                                                                                                        | High       | ✓ Complete                                                                                       |
| 6.26 | Route selected Person timelines through the shared `person_timeline_v1` adapter backed by the PWA OPFS SQLite worker, keyed by stable Person ID                                                                                                                                                                                                                                                                                                              | High       | ✓ Complete                                                                                       |
| 6.27 | Supply the Friends Galaxy worker with direct OPFS SQLite Person, Account, and RSS graph page executors so React never compiles the identity corpus                                                                                                                                                                                                                                                                                                           | High       | ✓ Complete                                                                                       |
| 6.28 | Route selected unlinked Account timelines through the shared `account_timeline_v1` adapter backed by the PWA OPFS SQLite worker, while linked Accounts continue through the combined Person timeline                                                                                                                                                                                                                                                         | High       | ✓ Complete                                                                                       |
| 6.29 | Hydrate synchronized PWA preferences through the shared bounded `preferences_snapshot_v1` transform instead of the selected IndexedDB shell                                                                                                                                                                                                                                                                                                                  | High       | ✓ Complete                                                                                       |
| 6.30 | Run Friends activity and source-fenced location resolution through `persons_graph_v1` and normalized item detail in OPFS SQLite, then delete the PWA IndexedDB read model and its scan-based tests                                                                                                                                                                                                                                                           | High       | ✓ Complete                                                                                       |
| 6.31 | Resolve explicit archive eligibility and toggle state from normalized SQLite item detail before creating signed follower intents                                                                                                                                                                                                                                                                                                                             | High       | ✓ Complete                                                                                       |
| 6.32 | Expose the OPFS SQLite typed query executor to shared UI and use bounded Account graph pages plus exact Account detail reads for the Friend editor instead of scanning browser FeedItem rows                                                                                                                                                                                                                                                                 | High       | ✓ Complete                                                                                       |
| 6.33 | Make Map, Story Wall, Library facets, feed signal counts, and Saved analytics fail closed on their typed OPFS SQLite readers, with no browser corpus or scan fallback                                                                                                                                                                                                                                                                                        | High       | ✓ Complete                                                                                       |
| 6.34 | Make the primary Feed surface use only bounded ordinary, Friends, Saved, and search OPFS SQLite readers, with no browser corpus, JavaScript Saved ordering, or reader-failure authority switch                                                                                                                                                                                                                                                               | High       | ✓ Complete                                                                                       |
| 6.35 | Make shared search use only normalized OPFS SQLite search pages, retain at most 100 ranked cards, and delete the browser MiniSearch index, corpus filter, scan fallback, compatibility tests, and package dependency                                                                                                                                                                                                                                         | High       | ✓ Complete                                                                                       |
| 6.36 | Delete SearchJump's rollback key, compatibility corpus lease, browser-derived facets, and selected-item fallback so missing or failed OPFS SQLite readers fail closed                                                                                                                                                                                                                                                                                        | High       | ✓ Complete                                                                                       |
| 6.37 | Route SearchJump complex counts and bulk selection through the typed source-fenced OPFS feed reader and delete its generic whole-item scanner dependency                                                                                                                                                                                                                                                                                                     | High       | ✓ Complete                                                                                       |
| 6.38 | Move SearchJump bulk resolution outside React, cover the complete OPFS SQLite feed or search scope, emit one explicit signed transaction of at most 1,000 members, and fail before mutation when durable multi-transaction staging is required                                                                                                                                                                                                               | High       | ✓ Complete                                                                                       |
| 6.39 | Freeze complete SearchJump scope actions in installation-local OPFS SQLite before the first intent, then emit the stable set through bounded 1,000-member signed transactions without returning selected IDs to React                                                                                                                                                                                                                                        | High       | ✓ Complete                                                                                       |
| 6.40 | Implement the normalized v2 intent transport publication transaction inside the PWA OPFS SQLite engine, using the shared closed header and immutable-reference contract, exact response-loss receipts, actor-head advancement, and transaction-completeness behavior matching native Rust                                                                                                                                                                    | High       | ✓ Complete                                                                                       |
| 6.41 | Import normalized v2 result transport segments inside one PWA OPFS SQLite transaction, including semantic digest and signature verification, result materialization, sparse-overlay cleanup, logical and transport cursor advancement, exact retry receipts, and full rollback on late receipt failure                                                                                                                                                       | High       | ✓ Complete                                                                                       |
| 6.42 | Route PWA read, saved, archived, and liked product actions directly through the OPFS SQLite follower mutation context and atomic intent transaction, with IndexedDB limited to the matching nonextractable signing key and no dual write                                                                                                                                                                                                                     | High       | ✓ Complete                                                                                       |
| 6.43 | Route every remaining PWA product write through registered signed OPFS SQLite follower transactions, including FeedItem, RSS, preferences, Person, and Account families, with generated bounds and no IndexedDB mutation calls                                                                                                                                                                                                                               | High       | ✓ Complete                                                                                       |
| 6.44 | Match native atomic checkpoint replacement in PWA OPFS SQLite, refuse replacement around unresolved local work, install the exact follower receipt, and expose that receipt through one closed worker request                                                                                                                                                                                                                                                | High       | ✓ Complete                                                                                       |
| 6.45 | Replace the production PWA portable checkpoint and shell bootstrap with normalized v2 Google Drive import directly into OPFS SQLite, then hydrate only the bounded visible feed window, preferences, facet total, and exact SQLite receipt                                                                                                                                                                                                                   | High       | ✓ Complete                                                                                       |
| 6.46 | Move PWA actor enrollment, normalized intent publication, normalized result import, and exact cloud receipts from the retired portable store onto the existing closed OPFS SQLite transport transactions. The closed worker boundary and transport-neutral coordinator now cover enrollment, bounded intent publication, response-loss repair, and atomic result reconciliation. Binding the coordinator to the approved Google Drive adapters remains open. | High       | 🚧 In Progress                                                                                   |
| 6.47 | Replace the actor key hidden inside the portable checkpoint database with a dedicated IndexedDB key vault that contains only one nonextractable Ed25519 key and its public identity per Library, with exact SQLite identity checks on every signature                                                                                                                                                                                                        | High       | ✓ Complete                                                                                       |
| 6.48 | Generate the PWA proof-only editor capability request from the shared contract after normalized checkpoint activation, store its exact canonical bytes in SQLite, and install only the matching authority-countersigned certificate with replay-stable receipts                                                                                                                                                                                              | High       | ✓ Complete                                                                                       |
| 6.49 | Delete the portable checkpoint store, IndexedDB feed reader, intent overlay, shell bootstrap, and their compatibility tests, leaving IndexedDB only as the nonextractable actor key vault                                                                                                                                                                                                                                                                    | High       | ✓ Complete                                                                                       |
| 6.50 | Hydrate exact total, unread, archivable, sample-root, and bounded per-platform navigation counts from the trigger-maintained SQLite facet row, with no FeedItem scan or renderer aggregation                                                                                                                                                                                                                                                                 | High       | ✓ Complete                                                                                       |
| 6.51 | Replace renderer-backed RSS rename and bulk removal with one field-level title assignment and one atomically frozen OPFS SQLite scope paged into bounded signed removal transactions                                                                                                                                                                                                                                                                         | High       | ✓ Complete                                                                                       |
| 6.52 | Replace the shared PWA sidebar's complete RSS Feed dictionary, derived count dictionaries, whole-catalog search, and renderer slicing with `rss_feed_page_v1` over OPFS SQLite. React retains ten visible subscriptions, exact per-row counts, and opaque source-fenced page cursors only. Legal maximum-sized rows shorten the page by bytes instead of failing the query                                                                                   | High       | ✓ Complete                                                                                       |
| 6.53 | Replace the shared Settings feed manager with 50-row OPFS SQLite windows and the existing atomically frozen complete-removal scope, then delete the uncalled PWA RSS capture and renderer-feed export module instead of preserving another compatibility path                                                                                                                                                                                                | High       | ✓ Complete                                                                                       |
| 6.54 | Replace the always-mounted command palette's complete Feed, Person, and Account dictionaries with query-on-open OPFS SQLite pages that retain at most 25 matching feeds and 25 matching social channels                                                                                                                                                                                                                                                      | High       | ✓ Complete                                                                                       |
| 6.55 | Replace always-mounted Header and Sidebar Friend and social Account counting with constant-time trigger-maintained OPFS SQLite facets                                                                                                                                                                                                                                                                                                                        | High       | ✓ Complete                                                                                       |
| 6.56 | Replace Header Feed and provider-author labels plus Feed, platform, and Library totals with one exact indexed OPFS SQLite scope query and the maintained facet row. The mounted Header retains no Feed, Account, per-Feed count, per-platform count, or total-item dictionary                                                                                                                                                                                | High       | ✓ Complete                                                                                       |
| 6.57 | Expose one closed SQLite follower transport frontier and direct actor-counter page, then coordinate immutable enrollment, one bounded normalized intent page, exact response-loss repair, and verified result-segment reconciliation through a provider-neutral transport contract. The coordinator never lists from React, reconstructs transactions, or owns Drive request behavior                                                                        | High       | ✓ Complete                                                                                       |
| 6.58 | Page hydration and least-recently-used eviction candidates through one generated source-fenced SQLite contract shared with native Rust, coalesce device-local access recency, and reject stale cache-pressure deletion before OPFS bytes are removed                                                                                                                                                                                                         | High       | ✓ Complete                                                                                       |
| 6.59 | Share the normalized checkpoint staging state machine with Desktop, retaining only the OPFS SQLite runtime binding. Delete the orphaned portable IndexedDB checkpoint and operation-store browser specifications                                                                                                                                                                                                                                             | High       | ✓ Complete                                                                                       |
| 6.60 | Consume the provider-neutral normalized follower coordinator from the shared sync package. Keep the PWA module as a thin OPFS SQLite runtime binding for enrollment, bounded intent pages, exact publication receipts, and atomic result import, with no second protocol implementation                                                                                                                                                                      | High       | ✓ Complete                                                                                       |
| 6.61 | Remove browser navigation history's full item-array subscription and complete item-ID set. Validate only the selected item through the same shared bounded SQLite point-query hook as Freed Desktop, retain navigation on read failure, and ignore stale missing-row responses                                                                                                                                                                               | High       | ✓ Complete                                                                                       |
| 6.62 | Read Map candidates and linked Person identity through the same bounded `map_markers_v1` SQL and closed transform as Freed Desktop. Remove the PWA MapView's complete Person and Account map subscriptions, leaving only the visible candidate window and ephemeral geocoding state in React                                                                                                                                                                 | High       | ✓ Complete                                                                                       |
| 6.63 | Remove the always-mounted Header item-array subscription. Share one revision-fenced `item_detail_v1` row with the command palette, deduplicate concurrent OPFS SQLite reads, retain only the active row, and render explicit loading or failure state instead of falling back to list controls                                                                                                                                                               | High       | ✓ Complete                                                                                       |
| 6.64 | Bind ordinary and Friends visible feed windows to the PWA Library item invalidation revision, while Saved retains its dedicated presentation revision and search remains separate. A committed OPFS SQLite item mutation now reopens the active bounded query instead of leaving stale empty rows beside updated navigation counts                                                                                                                           | High       | ✓ Complete                                                                                       |
| 6.65 | Remove the always-mounted AppShell and Google Contacts sync subscriptions to the renderer item corpus. Contact matching and suggestion linking read authoritative OPFS SQLite source pages only, and fail closed when that reader is unavailable instead of consulting historical renderer state                                                                                                                                                             | High       | ✓ Complete                                                                                       |
| 6.66 | Remove AppShell's historical invalid-Account and provisional-Person repair scans, including their complete renderer map subscriptions. Make the selected Friend mini-map consume its already bounded Person timeline directly, and delete the compatibility identity adapter that rebuilt candidates from Account and Person dictionaries                                                                                                                    | High       | ✓ Complete                                                                                       |
| 6.67 | Match Google Contacts through the same registered `contact_match_v1` OPFS SQLite query and trigger-maintained normalized identity keys as Freed Desktop. Return at most one Person ID and 32 Account IDs, retain no renderer identity corpus, and link existing Accounts through typed SQLite mutations                                                                                                                                                      | High       | ✓ Complete                                                                                       |
| 6.68 | Drive every PWA source-status card and shared sample-data Settings summary from `library_facet_summary_v1`. Keep exact counts and latest activity dates while deleting complete item, Feed, Person, Friend, and Account subscriptions from those views. PWA SQLite WebAssembly executes the same generated SQL and closed response contract as native Rust                                                                                                   | High       | ✓ Complete                                                                                       |
| 6.69 | Remove the primary Feed surface's complete RSS Feed and Account subscriptions. Read subscription presence from `library_facet_summary_v1`, resolve author navigation through the same indexed `filter_scope_summary_v1` Account identity as native Rust, and submit a typed Account mutation only when OPFS SQLite reports no matching row                                                                                                                   | High       | ✓ Complete                                                                                       |
| 6.70 | Remove Story Wall's complete Account subscription. Return nullable Account and Person IDs from the same bounded OPFS SQLite candidate query as Freed Desktop, apply account and person inclusion filters to those rows, and retain no identity catalog in React                                                                                                                                                                                              | High       | ✓ Complete                                                                                       |
| 6.71 | Read the selected Friends Person and Account through exact `person_detail_v1` and `account_detail_v1` OPFS SQLite queries, retain only those active rows, and remove the Friends React shell's complete RSS Feed subscription because the graph worker pages RSS identity directly from SQLite                                                                                                                                                               | High       | ✓ Complete                                                                                       |
| 6.72 | Run the Friend editor's `account_picker_page_v1` through SQLite WebAssembly in OPFS. Use the same trigger-maintained visible author activity, indexed unlinked Account ordering, FTS5 trigram substring search, 50-row response ceiling, shared request parser, and compact row transform as native Rust. Keep one or two scalar filtering inside the resident window and retain no Account catalog in React                                                 | High       | ✓ Complete                                                                                       |
| 6.73 | Rank Friend candidate review rows through the shared generated `friend_candidate_review_v1` OPFS SQLite query, retain at most ten typed rows in React, and delete the complete Person, Account, FeedItem, and compact-activity JavaScript scoring path plus its self-referential tests                                                                                                                                                                       | High       | ✓ Complete                                                                                       |
| 6.74 | Remove the Friends view's complete Person subscription. Use exact OPFS SQLite Person detail for selection, editing, linked-Account labels, and existing-Person write preparation, and derive only the selected overview entry in React                                                                                                                                                                                                                       | High       | ✓ Complete                                                                                       |
| 6.75 | Stop rebuilding a complete renderer-side Account source list for Friends activity. Query activity only for the selected visible channels, and let the Galaxy consume activity counts from its existing bounded OPFS SQLite Account and RSS source pages                                                                                                                                                                                                      | High       | ✓ Complete                                                                                       |
| 6.76 | Remove the Friends view's complete Account subscription. Extend exact OPFS SQLite Person detail with a 64-row linked-Account window and total count, transform the selected Friend from that closed response, and resolve edited Accounts through exact SQLite detail reads                                                                                                                        | High       | ✓ Complete                                                                                       |
| 6.77 | Replace renderer-managed Friend Person and Account write orchestration with one signed `friend_replace` intent. Read only exact current rows from OPFS SQLite, persist the complete desired Friend state atomically in the follower outbox, and let the Primary resolve the same generated mutation without partial writes or a compatibility shell                                                                                                                | High       | ✓ Complete                                                                                       |
| 6.78 | Remove the Friends view's remaining durable Zustand mutations. Sign relationship changes, deletion, Account linking, and reach-out events as their exact OPFS SQLite follower intents, and share the Person-root transform that prevents reach-out child rows from leaking into a root upsert                                                                                                                                                                   | High       | ✓ Complete                                                                                       |
| 6.79 | Make command-palette Person creation and promotion query exact OPFS SQLite identity rows and submit `friend_replace` or root-only `person_upsert` intents. Remove its renderer Account-map connection-person builder and partial Person store update                                                                                                                                                                                                                | High       | ✓ Complete                                                                                       |
| 6.80 | Replace Google Contacts Person and Account write sequences with one exact-read atomic `friend_replace` intent, route missing feed-author creation through OPFS SQLite `account_upsert`, and remove the final shared UI identity store mutations                                                                                                                                                                                                                    | High       | ✓ Complete                                                                                       |
| 6.81 | Remove every Person and Account write method from the PWA Zustand store, including partial updates, removals, relinking, reach-out writes, connection builders, batch methods, and deprecated Friend aliases. PWA development fixtures now submit normalized OPFS SQLite operations directly                                                                                                                                                                      | High       | ✓ Complete                                                                                       |
| 6.82 | Replace the PWA empty-feed and sync-status subscription-map reads. Empty feed state reads one exact selected subscription through `rss_feed_detail_v1`, while sync status reads the latest successful RSS refresh from `library_facet_summary_v1`. React retains no complete Feed map for either view                                                                                                                                                         | High       | ✓ Complete                                                                                       |
| 6.83 | Install the same normalized device-local Google Contacts generation tables in OPFS SQLite as the native core. The closed worker mutation boundary begins, appends, matches, activates, updates status, and dismisses suggestions through replay-safe bounded batches. The OPFS worker now runs the same byte-capped status, building-generation match, active suggestion, and unmatched-contact keyset queries as native Rust. Rust and TypeScript consume the same generated bounds and digest identity. Contact rows remain outside checkpoints and replication. Runtime product cutover remains in progress | High       | 🚧 In Progress                                                                                   |

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
- [x] Feed displays bounded pages from the authenticated OPFS SQLite Library Core generation
- [x] Per-source unread tracking works for opted-in feeds
- [x] Virtual scrolling handles 1000+ items smoothly
- [x] Reading enhancements work correctly (focus mode, font, reader view)
- [x] Ranking weights affect item order
- [x] Platform/author filters work (sidebar filter by platform/feed)
- [x] RSS source accordion pages subscriptions in the sidebar and top search moves matching feeds into the first page
- [x] RSS subscriptions, polling, and OPML management stay in Freed Desktop while the PWA shows synced feed and item status. Only the last successful refresh syncs. Retry timing and failures remain local to the polling device. Deprecated synchronized HTTP validators are ignored because the current Desktop transport does not persist them.
- [x] First launch is blocked behind a local-only legal clickwrap gate
- [x] PWA factory reset fences every open tab before clearing device preferences, the selected relay and cloud credentials, worker diagnostics, the OPFS SQLite pool, the OPFS content vault, and the nonextractable actor key vault. A durable cleanup barrier keeps automatic cloud sync paused after failed cloud deletion until reset succeeds or the user explicitly reconnects. OAuth handoff values, reader caches, and geocoding caches remain on the device. OAuth callbacks started before reset are rejected by their installation generation. Legal acceptance, release channel, and install prompt dismissal remain installation state.
- [x] Active view, feed filters, and reader selection round-trip through the URL for browser back/forward navigation
- [x] Settings and crash recovery surfaces can export public-safe bug report bundles
- [x] Bug report actions now label whether they download a public-safe or private bundle, and private diagnostics can be toggled as one group before emailing a report
- [x] Private reports can send a redacted description and selected stack traces to the repository's private GitHub vulnerability inbox after an explicit click, with no automatic retry and no diagnostic zip upload
- [x] PWA Settings surfaces Feeds, X / Twitter, Facebook, Instagram, LinkedIn, and Google Contacts as status-only sections with Freed Desktop sync and download handoff states
- [ ] PWA Settings surfaces exact OPFS SQLite checkpoint identity now. Add the normalized actor, intent head, result head, and reconciliation receipts as their SQLite cloud transactions are connected.
- [ ] PWA Google Drive resume, manual sync, and OAuth callback sync import only a complete authenticated normalized Library Core generation into OPFS SQLite and never synchronize a SQLite database, WAL, or SHM file. Reconnect normalized enrollment, intent publication, and result reconciliation without reviving the portable store.
- [x] PWA control, intent head, and result head adapters sample the shared bounded strong Drive v2 JSON ETag around each v3 media read and use exact v2 media PUT with If-Match for mutable updates. All immutable, list, create, media read, multipart, and resumable traffic remains on Drive v3. The request count and 60-second cadence are unchanged, and a stale ETag fails as `412` before exact current readback.
- [x] Person add, bounded batch add, and synchronized profile updates use whole-record Library Core intents while device-local graph coordinates remain local
- [x] FeedItem capture and typed field updates use bounded signed Library Core intents, update normalized SQLite projections, preserve repeated-identity order, and exclude device-local ranking fields
- [x] Sample seeding, fingerprinted sample clearing, and bulk feed removal use Library Core operations without waking Automerge or deleting real linked accounts
- [x] Production PWA bundles contain no Automerge JavaScript, worker, WASM asset, retired registry payload, or legacy `/sync` service-worker route. Stale rollback state cannot reactivate the retired engine, while historical verification and the required legacy-presence loss fence remain available.
- [x] Full-library search runs `search_page_v1` directly against OPFS SQLite, scans at most 256 filtered normalized rows per source-fenced request, streams at most 32 scored cards, and retains at most 100 result cards in React. Account aliases remain in normalized Account rows. No IndexedDB search projection or renderer alias corpus exists.
- [x] Runtime state hydrates bounded visible OPFS SQLite feed windows, synchronized preferences, exact trigger-maintained navigation aggregates, the selected checkpoint receipt, and query-on-open Feed, Person, and Account catalogs without a shell. Sample-data maintenance also resolves through typed SQLite contracts.
- [x] Archived, provider, feed, tag, signal, author, hidden, post, and story filters, all four Saved orders, facets, Saved analytics, Friends activity and timelines, Map, and Story Wall query the complete selected SQLite generation through bounded contracts.
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
