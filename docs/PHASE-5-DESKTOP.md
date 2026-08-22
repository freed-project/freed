# Phase 5: Desktop & Mobile App (Tauri)

> **Status:** 🚧 In Progress (direct desktop distribution live, macOS signing and notarization live in releases, Windows signing plan scaffolded, legal consent gate shipped, tri-state sidebar chrome shipped, local snapshot restore shipped, public-safe bug reporting shipped, runtime memory telemetry shipped, native startup recovery shipped, bundled recovery updater flow shipped, permanent local social media vault shipped, desktop hot-path side-effect scheduling shipped, event-aware outbox drains shipped, incremental item-patch state updates shipped, incremental RSS feed metadata updates shipped, safe optimistic user mutations shipped, visible-scope bulk archive shipped, background runtime coordination shipped, renderer recovery safe mode shipped, blocked-preflight crash-loop protection shipped, deep local WebKit diagnostics shipped, adaptive high-memory scrape budgets shipped, classifier health notification isolation shipped, idle Automerge worker recycling shipped, bounded SQLite maintenance scans shipped, explicit local-only primary Library authority shipped, SQLite-backed sample-data accounting, Story Wall candidates, Saved analytics, and full-library native search shipped, the four-mode Saved feed and non-Saved Friends-only feed moved onto bounded Gate D SQLite reads, the ordinary all-content feed moved onto bidirectional bounded SQLite paging, bounded scheduled RSS refresh shipped, density-aware fixed-height unified feed rows shipped, local interface zoom controls shipped, settings changelog preview shipped, fingerprinted sample-data cleanup shipped, visible cloud transfer diagnostics shipped, destructive cloud merge recovery shipped, manual Drive sync and activity timelines shipped, multi-Desktop provider request warnings shipped, cloud upload waits behind active outbox work shipped, production-default Google token proxy fallback shipped, recoverable Google Contacts refresh failures shipped, global background activity monitoring shipped, native terminal sync soaks shipped, and sync relay port handoff retries shipped)

> **Architecture:** Freed Desktop is a bounded SQLite client and a host
> for the shared native Library Core. Every view calls a named typed query.
> Every durable product edit calls a registered mutation. React retains only
> visible windows and ephemeral interface state. Tauri owns command wiring and
> host capabilities, not Library semantics. Automerge, whole-corpus renderer
> state, Library shells, shadow readers, and compatibility leases are deleted
> at the verified SQLite-only cutover.
> **Dependencies:** Phase 4 (Sync Layer)  
> **Priority:** 🎯 HIGHEST — Universal liberation tool

## Current SQLite Desktop work

- [ ] Complete extraction of Library semantics into
      `packages/library-core-native` so Freed Desktop and the headless Primary
      call the same Rust core.
- [x] Open the final normalized Desktop database in its own private
      descriptor-bound `library-sqlite` directory under a separate process
      lease. Startup installs and verifies the generated schema identity, and
      one registered Tauri command accepts only the flat closed typed query
      requests implemented by the native core. The historical database remains
      outside this database and receives no mirrored normalized writes.
- [x] Generate the shared checkpoint registry, protocol limits, 39 mutation
      IDs, and 33 bounded query IDs for Rust and TypeScript from one executable
      contract source, with generated-drift validation. The same source now
      defines the 18-mutation Primary writer capability and the
      capture-only scraper capability. Rust and TypeScript consume generated
      constants, and no parallel actor-operation registry remains.
- [x] Check in the final normalized SQL schema, bind it to a generated SHA-256,
      define closed root and child checkpoint payload fields, and expose a
      bounded native SQLite checkpoint exporter with stable keyset cursors.
      New and reopened databases verify Freed's fixed SQLite application ID
      before any schema write, so a foreign file cannot be adopted by accident.
      Native staging now activates every normalized record kind atomically
      after exact digest, binary64, content, and foreign-key verification.
      The contract also generates the exact row import SQL used by native Rust
      and browser TypeScript, so checkpoint transforms cannot drift by runtime.
- [x] Add strict normalized transaction, operation, causal-tip, replication,
      invalidation, signed-intent, result, and sparse optimistic-field tables
      to the shared schema. Canonical protocol members remain individually
      bounded to 131,072 bytes and large content stays in chunk rows.
- [x] Make accepted follower admission produce its authority-signed result in
      the same native SQLite transaction as the canonical operation. The
      active epoch key is rechecked under the write lock. Exact canonical
      result bytes, the per-actor result cursor, materialized rows, actor tip,
      revision, receipts, replication entries, and invalidations commit or
      roll back together. Exact retry returns the stored result without a new
      signature or sequence.
- [x] Model accepted, rejected, and already-applied follower outcomes as closed
      typed outbox rows. Rejected results carry one registered reason without
      requiring an accepted transaction row. Already-applied results reference
      the original immutable result digest. Product rows and revisions remain
      exclusive to accepted mutations.
- [x] Produce bounded authority-signed rejected and already-applied envelopes
      natively. Exact retries return the stored bytes without consuming another
      result sequence. Rejections name no canonical operation or receipt.
      Already-applied results prove the original accepted result and carry its
      canonical operation, receipt, and current replacement projection. Neither
      outcome advances the product revision or actor operation tip.
- [x] Resolve a verified mutation against its target under the same immediate
      SQLite transaction used for admission. A missing root returns
      `target_missing`. A matching typed tombstone returns `target_tombstoned`.
      Both results bind the current source revision and commit only the result
      outbox row and actor-scoped result cursor.
- [x] Resolve a cryptographically valid transaction that no longer extends the
      accepted actor tip as `precondition_failed`. The Primary signs the current
      source revision and advances only the follower result chain. The stale
      transaction cannot create an accepted operation or change product state.
- [x] Export exact signed follower results through an actor-bound native keyset
      page. Each page is capped at 128 records and 1,048,576 serialized bytes,
      carries a sequence and digest cursor, preserves every canonical byte, and
      rejects gaps, chain splices, cross-actor cursors, and undersized pages.
      The SQLite plan uses the actor and result sequence index without an
      offset, scan, or temporary sort.
- [x] Verify a complete signed transaction before evaluating mutable actor and
      capability policy. Under the immediate admission transaction, a retired
      actor receives `actor_retired`, while a retired, bounded, or
      mutation-excluding capability receives `capability_denied`. Both are
      authority-signed exact-retry results that leave accepted operations,
      product rows, actor operation tips, invalidations, and revisions alone.
- [x] Represent result authority and intent epochs as separate closed fields.
      A valid old-epoch intent receives `epoch_stale` from the strictly newer
      active authority. Policy and epoch rejections include exact current
      replacements for optimistic fields. Native and PWA SQLite store both
      epoch IDs, and the PWA verifies and settles the rejection atomically.
- [x] Store accepted authority epochs, the active authority pointer, signed
      transition state, frontier tips, complete actor chain tips, enrollment
      certificates, and normalized actor capabilities in the final schema and
      checkpoint registry. Activation fails atomically when the header has no
      matching accepted authority, an active actor has no capability, or a
      capability names an unregistered mutation.
- [ ] Extend the executable contract across field schemas, payload codecs,
      mutation SQL, query SQL, invalidations, and deletion obligations.
  - [x] `feed_item_capture_upsert` executes through generated normalized SQL
        instead of the retired JSON product projection. One signed transaction
        carries at most 32 capture members. Each item is capped at 131,072
        canonical bytes, root, media, and topic rows commit atomically, refresh
        preserves user-owned state, and tombstones prevent resurrection.
- [ ] Route feed, Saved, search, item detail, Friends, map, analytics, Story
      Wall, settings, exports, and diagnostics through bounded named queries.
  - [x] The native core now dispatches `feed_page_v1` as a typed request and
        response over the generated SQL program. One deferred SQLite snapshot
        pins source identity, keyset paging, visible count, row limit, and the
        2 MiB response budget. Its opaque cursor matches the TypeScript codec
        byte for byte and fails closed after the source revision changes.
        Freed Desktop command and product view wiring remain open.
  - [x] `library_facet_summary_v1` now computes counts and the bounded tag set
        from SQLite trigger-maintained counters and refcounts through the same
        browser and native dispatch. It returns one source-fenced typed
        aggregate, orders Unicode tags by SQLite binary UTF-8 bytes, never scans
        FeedItem rows, and never sends item rows to React.
  - [x] `saved_analytics_v2` now computes the Saved overview through one
        generated native SQLite aggregate. It returns exact totals, latest
        time, fixed day and hour buckets, and bounded binary-ordered source and
        content counts in one source-fenced response under 2 MiB. Final
        Freed Desktop view wiring and historical reader deletion remain open.
  - [x] `saved_feed_page_v2` now executes all four Saved orders through closed
        generated native SQLite variants. Date saved, date published,
        recommendation priority, and shortest read each use a matching
        expression index in both directions without a temporary sort. Filters
        and exact counts stay in SQLite, each request reads at most 129 rows,
        and edge cursors bind the filter, sort, generation, revision, and full
        order key. Final Freed Desktop view wiring and V1 deletion remain open.
  - [x] `preferences_snapshot_v1` now returns normalized preference nodes
        through the native core in exact SQLite binary path order. The closed
        response preserves boolean, integer, real, text, and null values,
        rejects mismatched value columns, and enforces 512-row and 2 MiB
        ceilings without constructing a settings shell.
  - [x] `item_detail_v1` now performs one primary-key SQLite lookup and returns
        the shared compact card plus typed reader-body locators. It never
        returns a full body or catch-all object, and the response uses the
        ordinary 2 MiB ceiling. Background item scans are metadata-only and no
        longer alias the historical full-content detail projection.
  - [x] `person_detail_v1` now performs one primary-key SQLite lookup through
        the extracted native core. It returns one closed Person header, at most
        64 binary-ordered tags, and the latest 20 stable reach-out events under
        a 512 KiB ceiling. Accounts and timeline cards remain separate bounded
        queries. Freed Desktop view wiring remains open.
  - [x] `account_detail_v1` now performs one primary-key SQLite lookup through
        the shared native and PWA dispatch, returns at most eight ordered
        follow-roster roles, and never hydrates a Person or FeedItem corpus.
        Freed Desktop view wiring remains open.
  - [x] `rss_feed_detail_v1` now performs one primary-key SQLite lookup through
        the shared native and PWA dispatch and returns every synchronized RSS
        Feed field under a 64 KiB ceiling. Freed Desktop uses it when a partial
        feed edit or refresh targets a feed outside the visible renderer
        window, preserving polling, unread, folder, URL, and sample fields.
  - [x] `person_graph_page_v1`, `account_graph_page_v1`, and
        `rss_feed_page_v1` now stream compact
        identity roots through source-fenced binary primary-key pages shared
        by native Rust and PWA SQLite. Each request returns at most 128 rows
        and 2 MiB without notes, contact fields, histories, polling policy, or
        a complete identity corpus. Account and RSS rows include indexed
        visible activity counts and latest activity times. RSS rows also use
        the latest visible item image only when the feed has no image. This
        removes the separate JavaScript graph activity aggregate from the
        final reader path. Person and Account rows also join foreign-keyed
        installation-local SQLite positions that never enter checkpoints or
        replication. The extracted native core executes generated one-row set
        and clear programs with exact-retry no-op behavior and no canonical
        revision or outbox effect. Freed Desktop graph-worker and product
        store wiring remain open.
  - [x] The shared Friends graph engine accepts a bounded SQLite query
        function and pumps Person, Account, and RSS pages into worker-owned
        compact source state one page at a time. The Freed Desktop native query
        binding remains open and the existing graph path stays active until
        the reader cutover.
  - [x] `item_reader_body_v1` now reads one exact byte range from inline SQLite
        text or no more than five content-addressed chunks through native Rust.
        Requests are capped at 256 KiB, responses at 512 KiB, and offsets past
        the body fail closed. Freed Desktop view wiring remains open.
  - [x] `background_item_page_v1` now traverses compact metadata in binary
        global ID order through a source-fenced primary-key cursor. Each native
        request returns at most 64 rows, reads at most 65, includes hidden and
        archived records needed by background jobs, and never carries reader
        bodies or uses offset paging. Freed Desktop contact discovery and
        explicit Library enumeration use the shared typed adapter. Filtered
        content enrichment uses its dedicated query contract instead of the
        historical item query.
  - [x] `content_fetch_claim_v1` now selects only linked rows with no inline or
        content-addressed preserved body. Native SQLite returns 64 compact
        candidates from at most 65 rows, and the existing paced fetch queue
        consumes those candidates without reconstructing FeedItems or changing
        network cadence, retries, headers, or provider behavior.
  - [x] Provider settings, Facebook group-name repair, media backup, and saved
        YouTube discovery now call `provider_media_page_v1` through the native
        typed query command. SQLite filters provider, visibility, and saved
        state before returning compact 64-row pages. The path has no generic
        item scan, compatibility lease, or rollback switch.
  - [x] `change_feed_v1` now pages compact invalidations through the native
        core in revision and ordinal primary-key order. One cursor pins the
        upper revision while later commits continue, responses contain no
        entity rows, and missing revisions fail closed. Normalized checkpoint
        activation emits one explicit Library reset notice. Freed Desktop view
        subscription wiring remains open.
  - [x] `feed_browse_page_v3` now executes the complete ranked-feed filter and
        bidirectional keyset order in the extracted native core. Forward and
        reverse reads share one registered expression index, inspect at most
        129 rows for a 128-row result, and bind both edge cursors to the exact
        generation and revision. The final tie-break is the normalized global
        ID, so no renderer source-enumeration sequence enters SQLite or the
        cursor. Freed Desktop product view wiring remains open.
- [ ] Route the exhaustive mutation registry through atomic native
      journal-plus-materialization transactions with exact retry receipts.
  - [x] The dormant `feed_item_read_assignment` core path now uses its
        generated SQLite program and the extracted native verifier to
        atomically commit the signed
        transaction, actor tip, normalized FeedItem value, field clock,
        receipt, replication outbox, bounded invalidation, and revision. Exact
        retry returns the stored receipt only while writer admission and the
        signed capability remain valid. The old source-text locator test was
        deleted because executable native tests now prove this contract.
  - [x] The dormant saved, archived, and liked assignment paths now consume
        generated programs through the same native transaction executor.
        Saved and archived share one deterministic clock and always clear the
        opposing state. Like state uses an independent clock and clears its
        obsolete provider receipt. No path performs provider traffic.
  - [x] The dormant FeedItem removal path now atomically writes a typed
        convergent tombstone and deletes the normalized root through generated
        SQL. Owned child rows cascade, while stale removals remain journaled
        without replacing the winning tombstone.
  - [x] Account removal, both Person removal policies, and both RSS feed
        removal policies use generated mutation programs. A Person removal can
        delete linked Accounts or preserve them while SQLite atomically clears
        their Person references. Relationship effects, root deletes,
        convergent tombstones, exact receipts, invalidations, and revisions
        commit in the same verified native transaction.
  - [x] RSS feed upsert now verifies one closed signed payload and writes its
        synchronized fields directly into typed normalized columns through a
        generated mutation program. Exact sample-data fingerprints are
        admitted, unknown shapes fail closed, and a removed feed cannot be
        resurrected within the storage epoch.
  - [x] Account upsert now writes its typed root columns and replaces its
        normalized follow-role rows through generated contract statements in
        one verified transaction. Person references and provider identity
        constraints remain enforced by SQLite, and a removed Account cannot be
        resurrected within the storage epoch.
  - [x] Person upsert writes its typed root columns and normalized tag set in
        one verified transaction. Reach-out events use their own closed append
        mutation, accepted-operation row identity, and deterministic
        latest-twenty retention. Person profile writes cannot erase event
        history, and a removed Person cannot be resurrected within the storage
        epoch.
  - [x] Preference assignment now deep-merges object patches and atomically
        replaces scalar or array subtrees through generated SQL. Typed object
        and array markers preserve explicit empty containers. Shared signing
        and native admission enforce 512-node, 4,096-byte path, and 8,192-byte
        text ceilings without storing a settings document.
  - [x] RSS feed title assignment now accepts one closed bounded title and
        source timestamp, resolves concurrent renames with a deterministic
        field clock, and commits the typed feed update, receipt, outbox,
        invalidation, and revision in one native transaction.
  - [x] Account person assignment now links or detaches one Account through a
        closed nullable person ID, resolves concurrent edits with a
        deterministic field clock, and relies on SQLite foreign keys to refuse
        links to missing People without partial writes.
- [ ] Replace whole-corpus subscriptions with a compact bounded invalidation
      feed and query reruns.
- [ ] Keep large content in a content-addressed vault with per-device hydration
      policy and verified range reads.
- [ ] Remove `shellJson`, `DocState`, whole FeedItem transport, Automerge
      workers, shadow stores, compatibility flags, and unconsumed migration
      exports after one-epoch activation proof.

---

## Overview

The universal liberation tool. Anyone can install this and escape algorithmic manipulation without technical setup. This phase packages capture, sync, and UI into Freed Desktop for direct distribution on macOS, Windows, and Linux.

Large app store distribution is not part of the current strategy. The mobile reading surface lives in the PWA, and native mobile packaging stays explicitly out of the critical path.

**Key architectural decisions:**

- **TypeScript capture via subprocess** — Existing `capture-x`, `capture-rss` packages run via Node/Bun subprocess, not rewritten in Rust
- **Shared React codebase:** `packages/pwa/` is embedded in WebView and deployed standalone to `app.freed.wtf`, while `dev-app.freed.wtf` follows the latest merge to `dev`
- **X authentication via WebView** — User logs into X inside the app; cookies captured from WebView session
- **Ranking runs here:** Freed Desktop computes priority through registered
  native mutations and synchronizes the resulting typed normalized records.
- **Versioned legal gate** — Freed Desktop blocks startup side effects until the current legal bundle is accepted locally on-device
- **Provider risk interstitials** — X, Facebook, Instagram, and LinkedIn require separate local consent before login or sync actions
- **Permanent social media vault:** Facebook and Instagram can copy the user's
  own uploaded media into the content-addressed local vault outside normal
  cache pruning.
- **Manual disconnect clears active pauses:** Disconnecting a social provider clears its current pause and resets future backoff escalation, but keeps historical diagnostics intact
- **Paused providers reuse the primary action:** Settings surfaces swap `Sync Now` to `Resume Now` when a provider is paused, instead of rendering a second resume button
- **Internal navigation history** — Desktop keeps a browser-style serialized navigation stack so `Cmd+[` and `Cmd+]` move through views and open reader state
- **Blank-state testing escape hatch** — Desktop empty states now offer a lightweight sample-data section below the primary blank-state prompt, so fresh installs can seed realistic data without detouring into Settings
- **Fingerprinted sample-data cleanup** - New sample batches carry an internal marker across feeds, items, people, and accounts, so accidental sample population can be cleared without matching on names, URLs, or content patterns
- **Explicit local-only primary authority** - A provider-free Freed Desktop establishes signed Library authority and a durable local writer admission during startup, so ordinary mutations and sample-data cleanup work without configuring cloud sync. Existing cloud and follower authority remain fail-closed.
- **Archived saved-item repair control** — Archived views now surface a one-click `Unarchive Saved Content` action when legacy or imported items end up both saved and archived
- **Live sidebar snap preview** — During desktop resize drag, the expanded card still tracks the grab rail directly, while compact and closed thresholds now animate in place so the sidebar snaps to the icon rail or slides offscreen before mouseup
- **Inset compact rail** — The icon-only sidebar now keeps a real outer inset around square buttons instead of rendering full bleed against the shell, while stacked icon rows stay visually tight
- **Balanced sidebar icon scale** — Labeled desktop sidebar rows now use a smaller icon baseline that matches the Settings row more closely, while the compact rail keeps its larger touch-friendly glyphs and Facebook gets a small visual correction
- **Tighter labeled sidebar gutters** — Desktop labeled sidebar rows now spend less width on left padding, icon gaps, and right-side clip gutters, especially in the narrow simplified state, so icons sit closer to the shell edge and labels crop later
- **Lateral compact tooltips** — Icon-only desktop sidebar tooltips now open to the right of the rail instead of below the trigger, which keeps the compact column readable in dense layouts
- **Inline Feeds chevron** — In the labeled desktop sidebar, the Feeds expand and collapse control now sits immediately after the `Feeds` label instead of aligning against the far-right count lane
- **Balanced compact rail inset** — The icon-only desktop sidebar now uses the same outer inset on the bottom edge as it already uses on the top and sides, so the Settings button no longer sits flush against the floor
- **Live toolbar reopen cue** — During desktop drag preview, once the primary sidebar crosses into the closed state, the toolbar control now swaps immediately from collapse to expand so the reopen affordance stays truthful before mouseup
- **Animated preview rail toggle:** The desktop reader keeps the compact preview rail mounted through show and hide transitions, while `Animations: None` still snaps instantly
- **Local display scale controls:** The far-right view menu and Appearance settings group global Theme and Zoom controls together, including a 75% to 200% slider that persists on the current device and tappable A controls that move to the next 10% boundary, while feed-only Card density stays in its own section
- **Hot-path side-effect scheduling:** Desktop routes native JSON persistence, encrypted secret store calls, cloud uploads, and outbox drains through typed queues so clicks, scroll callbacks, and document subscriptions do not directly run slow native I/O or large scans
- **Safe optimistic user mutations:** Feed cards, reader controls, read marks, item edits, feed renames, person edits, account edits, and synced preference changes project their visible UI state immediately, then reconcile counts and derived state from the Automerge worker. Device display controls bypass Automerge and persist locally.
- **Incremental RSS feed metadata updates:** Desktop adds, updates, and removes RSS feed metadata through Automerge feed patches, so subscribing to a feed does not rehydrate the full 10,000 item library before the UI can recover
- **Cloud transfer diagnostics:** Desktop Settings shows local item count, Automerge document size, Drive stage, last download, last upload, remote bytes, uploaded bytes, cloud errors, why the next upload is pending, and recent Drive activity. When destructive merge protection blocks sync, Settings lets the user keep this device by replacing the cloud backup, or keep the cloud copy by replacing this device, and keeps that recovery card pinned while upload retries are paused. Uploads wait behind active outbox and social-scrape work before retrying, so normal local changes do not sit behind long backoff while another worker finishes.
- **Recoverable Google Contacts state:** Token lookup and forced refresh errors are recorded in contact sync state and Settings instead of opening the fatal recovery screen. Corrupt or unsupported local sync ledgers block automatic provider requests, preserve their raw recovery evidence, and wait for explicit Sync Now or reconnect repair.
- **Google token proxy fallback:** Freed Desktop defaults missing or empty Google proxy build env to the production token proxy so dev and local builds cannot silently drift into direct Google token exchange
- **Background runtime coordination:** Desktop gates high-risk background work behind healthy renderer startup, shared memory pressure cooldowns, renderer recovery safe mode, and a native social-scrape lease so WebKit pressure cannot keep blanking the main window
- **Global background activity monitor:** The top toolbar shows a live activity spinner while provider syncs, Google Contacts sync, cloud sync, runtime jobs, updater downloads, or local AI model downloads are active. Opening the spinner docks the monitor to the right edge, shows active work with elapsed timers, and keeps the bounded live log open until the user closes it without starting new provider traffic.
- **Native terminal sync soaks:** Dev-channel installed builds can pick up local sync trigger files from the native process, wake the existing renderer sync bridge without stealing focus, retry a pending trigger after renderer recovery, and keep the renderer alive while the normal Facebook, Instagram, LinkedIn, or YouTube refresh path runs.
- **Relay port handoff retries:** When a restarted Freed Desktop instance reaches startup before the previous relay listener releases port `8765`, the native relay now keeps retrying the bind in the background instead of giving up after the first `Address already in use` error.
- **Quiet installed startup:** Freed Desktop now keeps cold startup quiet when launched with `open -g`, holds the main window non-focusable through startup visibility probes, skips foreground-only startup occlusion recovery on that path, and lets installed-build soaks start the app without interrupting the primary workstation. Explicit Show, dock reopen, recovery retry, and other foreground actions still raise the app.
- **Deep local WebKit diagnostics:** Renderer stalls, memory preflight blocks, and recovery attempts write bounded local diagnostics with WebKit process identity, RSS, CPU, process age, WebView labels, cache sizes, vmmap summaries, short process samples, and scraper recycle PID verification. Main renderer recovery now treats high WebKit RSS plus high CPU as active pressure instead of reclaimable tail memory, and recycles the main renderer when multi-GB WebKit resident and footprint growth stay CPU-hot before the global high-memory ceiling is reached.
- **Adaptive social memory budgets:** Freed Desktop now scales high and critical scrape guardrails on high-memory machines, records native memory samples even when the renderer is hidden, and keeps low-priority semantic enrichment out of the launch path so Facebook and Instagram get memory first
- **Classifier health notification isolation:** Device-local semantic classifier health persists without broadcasting a model lifecycle change, so a terminal batch cannot rearm itself every five seconds or recreate the Automerge worker
- **Bounded scheduled RSS refresh:** Background RSS polling now refreshes only due stale feeds in capped batches, while manual RSS refresh keeps the full enabled-feed sweep and bypasses local retry windows. Retry windows, failure counters, and fetch errors are device-local. Deprecated synchronized HTTP validators are ignored because the current transport does not persist validators. One machine cannot throttle another through the shared document.
- **Single-flight document startup:** Concurrent React startup effects share one application initialization and one worker INIT request. The renderer installs one permanent Automerge subscription instead of allowing duplicate acknowledgements to replay stale UI state.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Freed Desktop (Tauri)                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    WebView (React PWA)                   │   │
│  │  ┌─────────┐  ┌─────────────────────────────────────┐   │   │
│  │  │ Sources │  │         Unified Timeline            │   │   │
│  │  │ ─────── │  │                                     │   │   │
│  │  │ All     │  │  [Article cards with glass UI]      │   │   │
│  │  │ X       │  │                                     │   │   │
│  │  │ RSS     │  │                                     │   │   │
│  │  │ Saved   │  └─────────────────────────────────────┘   │   │
│  │  └─────────┘                                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌───────────────────────────┼───────────────────────────────┐ │
│  │                    Native Layer (Rust)                     │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │ │
│  │  │capture-x │  │capture-  │  │capture-  │  │  Local   │  │ │
│  │  │  (API)   │  │   rss    │  │   dom    │  │  Relay   │  │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │ │
│  │                      │                                     │ │
│  │               ┌──────┴──────┐                              │ │
│  │               │  Playwright │  (headless, system Chrome)   │ │
│  │               └─────────────┘                              │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

```
packages/desktop/
├── src/                      # React UI (shared with PWA)
├── src-tauri/
│   ├── src/
│   │   ├── main.rs          # Entry point
│   │   ├── capture.rs       # Capture orchestration
│   │   ├── relay.rs         # WebSocket server
│   │   └── tray.rs          # System tray
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
└── tsconfig.json
```

---

## UI Design

**Three-column layout, dark theme, native vibrancy**

| Element           | Implementation                                                                 |
| ----------------- | ------------------------------------------------------------------------------ |
| Window background | Tauri `vibrancy: "under-window"` (native blur)                                 |
| Sidebar           | Translucent, CSS `backdrop-filter` on dark base                                |
| Buttons           | CSS glass approximation, SwiftUI later                                         |
| Cards             | Dark cards with subtle borders, upper-right social actions, read-state dimming |
| Reader pane       | Clean typography, large hero images, toolbar open action                       |

---

## Design Tokens

```css
/* Dark glass theme */
:root {
  --bg-primary: rgba(18, 18, 18, 0.85);
  --bg-sidebar: rgba(28, 28, 30, 0.7);
  --bg-card: rgba(44, 44, 46, 0.9);
  --bg-card-hover: rgba(58, 58, 60, 0.9);
  --border-glass: rgba(255, 255, 255, 0.08);
  --border-glass-strong: rgba(255, 255, 255, 0.15);
  --text-primary: rgba(255, 255, 255, 0.92);
  --text-secondary: rgba(255, 255, 255, 0.55);
  --text-tertiary: rgba(255, 255, 255, 0.35);
  --accent: #ff6b35;
  --accent-hover: #ff8555;
}
```

---

## Tauri Configuration

```json
// src-tauri/tauri.conf.json
{
  "windows": [
    {
      "title": "Freed",
      "width": 1200,
      "height": 800,
      "transparent": true,
      "decorations": false,
      "macOSConfig": {
        "vibrancy": "under-window",
        "vibrancyState": "followsWindowActiveState"
      }
    }
  ]
}
```

---

## Playwright Integration

For DOM capture (Facebook, Instagram), use system Chrome via Playwright subprocess:

```typescript
// capture-service/src/dom-capture.ts
import { chromium } from "playwright-core";

export async function captureDomFeed(
  platform: "facebook" | "instagram",
  cookies: Cookie[],
): Promise<FeedItem[]> {
  const browser = await chromium.launch({
    channel: "chrome", // Use system Chrome
    headless: true,
  });

  const context = await browser.newContext();
  await context.addCookies(cookies);

  const page = await context.newPage();
  // Platform-specific capture logic...

  await browser.close();
  return items;
}
```

---

## Tasks

### Desktop

| Task | Description                                                                                                                                                                                                                                                                                                | Complexity |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 5.1  | Tauri 2.0 project scaffold                                                                                                                                                                                                                                                                                 | Medium     |
| 5.2  | Embed PWA React app in WebView                                                                                                                                                                                                                                                                             | Medium     |
| 5.3  | Native window vibrancy (macOS)                                                                                                                                                                                                                                                                             | Low        |
| 5.4  | Menu bar icon + background mode                                                                                                                                                                                                                                                                            | Medium     |
| 5.5  | Local WebSocket relay                                                                                                                                                                                                                                                                                      | Medium     |
| 5.6  | Playwright subprocess setup                                                                                                                                                                                                                                                                                | High       |
| 5.7  | System tray with sync status                                                                                                                                                                                                                                                                               | Low        |
| 5.8  | QR code display for phone pairing                                                                                                                                                                                                                                                                          | Low        |
| 5.9  | Auto-launch on login (optional)                                                                                                                                                                                                                                                                            | Low        |
| 5.10 | macOS notarization + DMG packaging                                                                                                                                                                                                                                                                         | High       |
| 5.11 | Windows installer                                                                                                                                                                                                                                                                                          | Medium     |
| 5.12 | Linux AppImage/Flatpak                                                                                                                                                                                                                                                                                     | Medium     |
| 5.22 | Auto-updater (tauri-plugin-updater)                                                                                                                                                                                                                                                                        | Medium     |
| 5.23 | CI/CD release pipeline (GH Actions)                                                                                                                                                                                                                                                                        | Medium     |
| 5.24 | macOS code signing + notarization                                                                                                                                                                                                                                                                          | High       |
| 5.25 | Windows code signing with Microsoft Artifact Signing                                                                                                                                                                                                                                                       | Medium     |
| 5.26 | Independent update server domain                                                                                                                                                                                                                                                                           | Medium     |
| 5.27 | First-run legal gate and local-only acceptance storage                                                                                                                                                                                                                                                     | Medium     |
| 5.28 | Provider-specific risk interstitials for social capture                                                                                                                                                                                                                                                    | Medium     |
| 5.29 | Internal serialized navigation history with `Cmd+[` / `Cmd+]`                                                                                                                                                                                                                                              | Low        |
| 5.30 | Reviewed AI-assisted release notes and cumulative daily changelog cards                                                                                                                                                                                                                                    | Medium     |
| 5.31 | Provider health dashboard, charts, and unsubscribe flow                                                                                                                                                                                                                                                    | Medium     |
| 5.32 | Rotating local database snapshots + restore UI                                                                                                                                                                                                                                                             | Medium     |
| 5.33 | Public-safe bundles and private GitHub vulnerability reports                                                                                                                                                                                                                                               | Medium     |
| 5.34 | Native startup recovery window outside the React tree                                                                                                                                                                                                                                                      | Medium     |
| 5.35 | Hot-path side-effect scheduling for persistence, sync, and outbox work                                                                                                                                                                                                                                     | Medium     |
| 5.36 | Event-aware Automerge subscription metadata for item-patch outbox drains                                                                                                                                                                                                                                   | Medium     |
| 5.37 | Incremental main-thread item-patch state updates                                                                                                                                                                                                                                                           | Medium     |
| 5.38 | Renderer recovery safe mode and deep local WebKit diagnostics                                                                                                                                                                                                                                              | Medium     |
| 5.39 | Visible cloud transfer diagnostics, manual sync, and activity timeline                                                                                                                                                                                                                                     | Medium     |
| 5.40 | Global toolbar background activity monitor                                                                                                                                                                                                                                                                 | Medium     |
| 5.41 | Multi-Desktop registration and duplicate provider request warning                                                                                                                                                                                                                                          | Low        |
| 5.42 | Execute indexed bidirectional `saved_feed_page_v2` through the native core with all four Saved orders and exact browser parity                                                                                                                                                                             | High       | ✓ Complete |
| 5.43 | Materialize signed FeedItem capture through the generated normalized SQLite mutation program with bounded members and bytes, atomic children, preserved user state, exact retry effects, and tombstone refusal                                                                                             | High       | ✓ Complete |
| 5.44 | Open the final normalized Desktop database through its own descriptor-bound directory and process lease, verify its generated schema identity at startup, and register one flat closed typed native query command                                                                                          | High       | ✓ Complete |
| 5.45 | Decompose each historical FeedItem into generated normalized root, media, topic, tag, highlight, signal, event, descriptor, and chunk rows with exact large-content reassembly and no shell or whole-item row                                                                                              | High       | ✓ Complete |
| 5.46 | Decompose the historical RSS, Person, Account, reach-out, follow-role, and preference shell fields into final typed tables, using one generated preference ownership policy across Rust and TypeScript while excluding device-local and compatibility-only state                                           | High       | ✓ Complete |
| 5.47 | Build an inert final-schema migration candidate from one old SQLite snapshot, bind its authority tuple and causal frontier, close live and excluded row counts plus foreign keys, and stream its normalized product digest across bounded export pages without shell evidence or activation                | High       | ✓ Complete |
| 5.48 | Sign the next normalized storage epoch with the accepted authority key, bind the complete candidate and final contract identities, recheck every old source fence, and install authority, causal baseline, writer admission, metadata, and generation atomically inside the candidate without selecting it | High       | ✓ Complete |
| 5.49 | Enroll a fresh normalized Primary actor with actor and authority signatures, bind the carried source frontier, and install exactly the generated Primary-writer mutation capability in one transaction                                                                                                     | High       | ✓ Complete |
| 5.50 | Verify one private descriptor-bound Desktop authority selector against signed normalized SQLite and fence every historical database, journal, store, backup, restore, clear, and mutation opening path once selected                                                                                       | High       | ✓ Complete |
| 5.51 | Publish the Desktop selector through a private flushed pending file, atomic fixed-name rename, directory flush, exact readback verification, and idempotent response-loss replay without overwriting another epoch                                                                                         | High       | ✓ Complete |
| 5.52 | Route the ordinary feed, Saved feed, and signal counts through the closed normalized query command, preserve opaque bidirectional keyset cursors and bounded compact rows, and remove their dependency on the historical item query                                                                        | High       | ✓ Complete |
| 5.53 | Route item detail, Library facets, Saved analytics, Map, and Story Wall through their closed normalized query projections and one shared compact-row view transform                                                                                                                                        | High       | ✓ Complete |
| 5.54 | Extract ordinary feed, Saved feed, and signal-count orchestration into one shared bounded adapter, with Freed Desktop supplying only the native query executor                                                                                                                                             | High       | ✓ Complete |
| 5.55 | Extract item detail, Library facets, Saved analytics, Map, and Story Wall orchestration into one shared bounded adapter, with Freed Desktop supplying only the native query executor                                                                                                                       | High       | ✓ Complete |
| 5.56 | Bind Friends mode into the normalized feed query, resolve friend membership through Account and Person joins in SQLite, and remove Desktop shell and historical-item dependencies from Friends paging                                                                                                      | High       | ✓ Complete |
| 5.57 | Route selected Person timelines through the shared `person_timeline_v1` adapter, keyed by stable Person ID, with bounded compact rows and opaque source-fenced cursors                                                                                                                                     | High       | ✓ Complete |
| 5.58 | Supply the Friends Galaxy worker with direct native `person_graph_page_v1`, `account_graph_page_v1`, and `rss_feed_page_v1` executors so React never compiles the identity corpus                                                                                                                    | High       | ✓ Complete |
| 5.59 | Route selected unlinked Account timelines through the shared native `account_timeline_v1` adapter, keyed by stable Account ID, while linked Accounts continue through the combined Person timeline                                                                                                         | High       | ✓ Complete |
| 5.60 | Expose one generic typed normalized query executor to shared UI and use bounded Account graph pages plus exact Account detail reads for the Friend editor instead of scanning the Desktop item corpus                                                                                                      | High       | ✓ Complete |
| 5.61 | Make Map, Story Wall, Library facets, feed signal counts, and Saved analytics fail closed on their typed SQLite readers, with no renderer corpus lease or scan fallback                                                                                                                                    | High       | ✓ Complete |
| 5.62 | Make the primary Feed surface use only bounded ordinary, Friends, Saved, and search SQLite readers, with no corpus lease, renderer sort, or reader-failure authority switch                                                                                                                                | High       | ✓ Complete |
| 5.63 | Make shared search use only normalized SQLite search pages, retain at most 100 ranked cards, and delete the renderer MiniSearch index, corpus filter, scan fallback, and package dependency                                                                                                                | High       | ✓ Complete |
| 5.64 | Delete SearchJump's rollback key, compatibility corpus lease, renderer-derived facets, and selected-item fallback so missing or failed SQLite readers fail closed                                                                                                                                          | High       | ✓ Complete |
| 5.65 | Route SearchJump complex counts and bulk selection through the typed source-fenced feed reader and delete its generic whole-item scanner dependency                                                                                                                                                        | High       | ✓ Complete |
| 5.66 | Move SearchJump bulk resolution outside React, cover the complete SQLite feed or search scope, commit one explicit transaction of at most 1,000 members, and fail before mutation when durable multi-transaction staging is required                                                                       | High       | ✓ Complete |
| 5.67 | Freeze complete SearchJump scope actions in installation-local native SQLite before the first mutation, then execute the stable set through bounded 1,000-member transactions without returning selected IDs to React                                                                                      | High       | ✓ Complete |
| 5.68 | Delete the provider-settings rollback key and legacy renderer-item acquisition path, leaving Facebook group repair, media backup, and saved YouTube discovery on bounded source-fenced SQLite reads                                                                                                        | High       | ✓ Complete |
| 5.69 | Register Freed Desktop's final normalized Primary mutation commands for admitted actor context, native operation signing, and atomic transaction commit, with exact closed bounds and no shell mutation                                                                                                                                                                  | High       | ✓ Complete |
| 5.70 | Route Freed Desktop's non-provider FeedItem, RSS, preference, Person, and Account product mutations through the selected normalized Primary, while reusing the same canonical transaction transform for editable followers and refusing Primary activation against an unselected migration candidate                                                                      | High       | ✓ Complete |
| 5.71 | Refresh Desktop's post-mutation source version, total count, and compact changed items through bounded normalized queries whenever the selected Primary is active, with no call to retired historical count, shell, or item readers                                                                                                                                         | High       | ✓ Complete |
| 5.72 | Bind the one-time Desktop migration candidate and its recovery identity atomically inside normalized SQLite, outside checkpoint export, before authority installation or selector publication                                                                                                                                                                            | High       | ✓ Complete |
| 5.73 | Recover interrupted normalized authority and local Primary actor installation only from an exact stored match, rejecting changed certificates, authority rows, frontier rows, actor state, capability state, or mutation grants                                                                                                                                              | High       | ✓ Complete |
| 5.74 | Complete the one-time normalized cutover during Freed Desktop startup while the process owns both Library leases, skip only an absent or inactive historical source, publish one verified immutable selector, and fence every historical authority opening immediately after publication                                                                                   | High       | ✓ Complete |
| 5.75 | Bootstrap Freed Desktop renderer state after cutover from the bounded normalized facet and preferences queries, keeping item, Feed, Person, and Account collections empty until their owning views request a typed window, with no production shell read                                                                                                             | High       | ✓ Complete |
| 5.76 | Route Freed Desktop exact-item reads, mutation target discovery, background capture scans, import identity scans, and saved-video discovery through normalized detail or source-fenced background pages, leaving the historical offset reader reachable only by browser fixtures while later tasks replace workflows that still accumulate complete identity sets | High       | ✓ Complete |
| 5.77 | Resolve partial Person and Account mutations through exact bounded normalized detail queries when the entity is not in the current visible renderer window, preserving complete synchronized fields without repopulating global renderer maps or reading the shell                                                                                              | High       | ✓ Complete |
| 5.78 | Resolve partial RSS Feed edits and batch refreshes through the exact bounded normalized feed detail query when the feed is not in the current visible renderer window, preserving every synchronized feed field without repopulating the renderer feed map or reading the shell                                                                                 | High       | ✓ Complete |
| 5.79 | Freeze complete RSS Feed removal and untitled-title repair scopes atomically in native SQLite, then submit bounded typed transactions from paged stable identities without depending on the renderer feed map                                                                                                                                            | High       | ✓ Complete |
| 5.80 | Select normalized SQLite on the first launch of a fresh Freed Desktop installation after proving that retired IndexedDB and every historical Library table contain no data, without creating an empty shell, historical authority, or second-launch migration                                                                                           | High       | ✓ Complete |
| 5.81 | Expose a typed native normalized checkpoint descriptor and pinned page command that rechecks Library, epoch, writer, revision, frontier, and record count inside each SQLite read transaction                                                                                                                                            | High       | ✓ Complete |
| 5.82 | Move writer reassignment into the selected normalized SQLite authority, carry the prior causal frontier into the new epoch, enroll the target Desktop actor atomically, publish its generation-zero typed checkpoint, and delete the historical journal and portable-checkpoint transfer command                                                                                     | High       | ✓ Complete |
| 5.83 | Make the private Desktop selector a stable one-way choice of normalized SQLite for one Library, verify the current authority and generation inside SQLite on every open, and leave live epoch transitions out of the selector record                                                                                                                                            | High       | ✓ Complete |
| 5.84 | Expose closed native begin, bounded page append, and atomic replacement commands for normalized checkpoint import, deriving the activation digest from staged SQLite bytes and refusing replacement while local operations remain unresolved                                                                                                                                    | High       | ✓ Complete |
| 5.85 | Expose selected-database follower checkpoint status, v2 actor request, authority countersignature, enrollment installation, and exact response-loss replay commands as the replacement for the historical follower journal enrollment path                                                                                                                                            | High       | ✓ Complete |
| 5.86 | Expose closed native commands for normalized follower mutation context, operation signing, intent commit and paging, Primary intent ingestion, signed result paging, publication receipt, and exact result import, then route new Desktop follower mutations through those commands instead of the historical journal                                                                 | High       | ✓ Complete |
| 5.87 | Expose one closed native command that atomically records a normalized v2 intent transport page, its exact semantic and stored digests, immutable object identity, actor head advance, completed transaction publication state, and response-loss replay receipt                                                                                                                    | High       | ✓ Complete |
| 5.88 | Expose one closed native command that atomically verifies and imports a normalized v2 result segment, reconciles accepted or rejected intents and optimistic fields, persists the exact transport receipt, advances both result heads, and returns the same receipt after response loss                                                                                              | High       | ✓ Complete |
| 5.89 | Extend the shared constant-time Library facet query with trigger-maintained unread, archivable, sample-root, and bounded per-platform counts so Desktop and PWA navigation never scan FeedItem rows or derive whole-Library totals in React | High | ✓ Complete |
| 5.90 | Replace the primary sidebar's complete RSS Feed dictionary, derived per-feed count dictionaries, whole-catalog search, and renderer slicing with the shared `rss_feed_page_v1` native SQLite reader. React retains ten visible subscriptions, exact per-row counts, and opaque source-fenced page cursors only. Legal maximum-sized rows shorten the page by bytes instead of failing the query | High | ✓ Complete |
| 5.91 | Replace Settings feed management and export previews with 50-row native SQLite windows, route complete unsubscribe through the atomically frozen SQLite scope, resolve OPML import duplicates through exact feed queries, and generate OPML through bounded background feed pages outside React | High | ✓ Complete |
| 5.92 | Replace the always-mounted command palette's complete Feed, Person, and Account dictionaries with query-on-open native SQLite pages that retain at most 25 matching feeds and 25 matching social channels | High | ✓ Complete |
| 5.93 | Replace always-mounted Header and Sidebar Friend and social Account counting with constant-time trigger-maintained native SQLite facets | High | ✓ Complete |
| 5.94 | Replace Header Feed and provider-author labels plus Feed, platform, and Library totals with one exact indexed native SQLite scope query and the maintained facet row. The mounted Header retains no Feed, Account, per-Feed count, per-platform count, or total-item dictionary | High | ✓ Complete |
| 5.95 | Require production renderer startup to obtain verified normalized SQLite authority from native startup, fail closed before loading Library state when migration or fresh genesis is unavailable, and keep portable shell setup confined to the isolated browser test projection | High | ✓ Complete |
| 5.96 | Delete portable shell creation and historical authority bootstrap from the Desktop client. The browser harness now reports normalized authority before exposing its isolated in-memory view fixture and cannot create or select product storage | High | ✓ Complete |
| 5.97 | Fence historical generic item queries, whole-item upserts, shell replacement, and ordinary generic mutations from production. Refresh follower aggregates through the normalized SQLite facet query. The existing provider delivery-state mutations remain on their unchanged path until their separately reviewed normalized cutover | High | ✓ Complete |

---

## Success Criteria

### Desktop

- [x] Desktop app launches with native vibrancy on macOS
- [x] Captures from X, RSS in background (refreshAllFeeds covers both)
- [x] Local WebSocket relay enables instant phone sync (binary protocol)
- [x] Local sync relay retries `AddrInUse` startup races so overlapping restarts can recover the port without needing another relaunch
- [x] QR code pairing works (token-authenticated; local SVG render, no third-party QR API)
- [x] System tray shows sync status
- [x] App runs in background after window close
- [x] Auto-updater checks GitHub Releases on launch and in the background, then installs updates in-app
- [x] Desktop Settings > Updates embeds a compact scrolling preview of the latest five changelog cards with a full changelog link
- [x] CI/CD release pipeline builds for macOS (ARM + Intel), Windows, Linux on tag push
- [x] Dev release tags run the faster dev validation lane and build only the internal macOS Apple Silicon target, while production tags keep full validation and all supported platform builds
- [x] App icons generated for all platforms
- [x] macOS DMG builds
- [x] Windows NSIS + MSI installers build
- [x] Linux AppImage, .deb, .rpm all build
- [x] All updater artifacts signed and uploaded to GitHub Releases
- [x] First launch is blocked behind a local-only legal clickwrap gate
- [x] A provider-free primary Library establishes explicit durable local writer admission before exposing state, while cloud-identified and follower Libraries cannot be silently reclassified as local-only
- [x] Provider-specific capture flows require additional local risk consent
- [x] Legal acceptance stays outside synced Automerge state
- [x] Permanent Facebook and Instagram media archive stores files, manifest rows, byte counts, retry state, and provider archive preferences locally outside synced Automerge state
- [x] Freed Desktop keeps rotating local database snapshots with a restore flow in Settings
- [x] Desktop E2E test infrastructure bootstrapped (Playwright + VITE_TEST_TAURI=1 mock layer)
- [x] Desktop E2E gates are split into smoke, functional regression, performance, and visual lanes, with dev build validation running the performance and visual lanes instead of hiding them until production release prep
- [x] Local desktop preview now defaults to the mocked browser harness, while tracked preview slots keep concurrent local threads to one desktop preview at a time unless native Tauri behavior is explicitly requested, native preview windows carry a visible worktree and thread label, and feature previews auto-accept local legal gates plus seed sample data
- [x] Desktop navigation history supports browser-style back and forward shortcuts for views and reader state
- [x] Freed Desktop registers a device-local OS-wide Save Content shortcut that opens the existing Save Content dialog, pre-fills the URL field from the clipboard when it holds an HTTP or HTTPS link, opens the saved item in reader mode after stub persistence, and pulls readable details in the background
- [x] Freed Desktop factory reset closes Automerge admission, settles document work already accepted by the worker, and rejects later mutations before deletion. It clears device display and AI choices, snapshots, runtime diagnostics, shortcut configuration, local provider sessions, active cloud credentials, and the local document. A durable cleanup barrier keeps automatic cloud sync paused after failed cloud deletion until reset succeeds or the user explicitly reconnects. The relay rotates its pairing token, clears held document bytes, disconnects old mobile sessions, and stays paused whenever document deletion is uncertain. Existing PWA clients must scan the current pairing QR code again after a successful reset. Local discovery and request history, backoff and receipt ledgers, encrypted AI keys, local model files, the media vault, scraper window modes, and provider user agent identity stay intact. Legal acceptance, release channel, and installation identity also remain installation state.
- [x] Settings and crash recovery surfaces can export public-safe bug report bundles
- [x] Private diagnostic bundles are opt-in, redacted, and steered toward email instead of public GitHub attachment
- [x] Bug report actions now label whether they download a public-safe or private bundle, bulk-toggle private diagnostics, and block public GitHub issue drafts while private diagnostics remain selected
- [x] Private reports can send a redacted description and selected stack traces to the repository's private GitHub vulnerability inbox after an explicit click, with no automatic retry and no diagnostic zip upload
- [x] Browser desktop preview now guards native-only LinkedIn auth listeners, background social refresh paths, and local snapshot controls, so opening Settings and switching themes no longer crashes the preview
- [x] Freed Desktop emits native renderer heartbeats and warns in the local log when the main window goes silent long enough to suggest a renderer hang or crash
- [x] If the renderer dies before the app finishes booting, the next launch opens a native recovery window with retry, immediate in-place update install, and channel-aware browser download fallback actions outside the React tree
- [x] Search does not build or retain a renderer index, and item-state mutations cannot trigger search-index work in React
- [x] Safe user-triggered document mutations project visible UI changes immediately, roll back on worker failure, and leave destructive or repair operations source-of-truth first
- [x] Visible-scope archive read actions batch filtered read items through one Automerge worker mutation, so large Instagram cleanup does not loop through one archive toggle per post
- [x] macOS DMG is notarized in CI releases
- [x] Checked-in release notes are reviewed before a release tag can publish
- [x] Production release prep and publish refuse stale `main` snapshots until current `dev` has been promoted into `main`, and PRs targeting `main` reject direct product edits outside the promotion flow
- [x] Debug panel Health tab charts provider reliability plus daily and hourly pull volume across RSS, X, Facebook, Instagram, LinkedIn, Google Drive, and Dropbox
- [x] Desktop Settings > Sync shows local item count, local document size, Drive stage, last download, last upload, remote bytes, uploaded bytes, cloud errors, pending upload explanations, a manual Drive `Sync now` action, and a recent activity timeline
- [x] Desktop Settings > Sync warns when more than one Freed Desktop installation is registered with the library because parallel RSS or authenticated provider polling can duplicate request traffic. PWA clients do not trigger the warning.
- [x] Failing RSS feeds can be reviewed and unsubscribed from the health panel, with optional article/history deletion
- [x] Sidebar source actions and source settings surface degraded or paused provider health outside the debug panel
- [x] Debug panel Health tab charts provider reliability plus daily and hourly pull volume across RSS, X, Facebook, Instagram, LinkedIn, Google Drive, and Dropbox, with an in-card duration dropdown for each provider
- [x] Failing RSS feeds can be reviewed and unsubscribed from the health panel, with optional article/history deletion
- [x] Provider status indicators switch to a live spinner while that provider is actively syncing
- [x] Social provider sections surface a filtered inner scrape log with line-by-line progress while capture is running, and paused or degraded summaries keep the latest failure reason plus timestamp visible outside the debug panel
- [x] Settings modal includes an explicit close button in the sidebar on larger screens and at the mobile header edge on small screens
- [x] Risk dialogs and other central overlay modals stay vertically scrollable on tiny mobile screens so action buttons remain reachable
- [x] Desktop sync header and source settings surface degraded or paused provider health outside the debug panel
- [x] Provider health cards reuse the same sync provider sections as Settings, with `Sync Now` actions embedded inside each provider section
- [x] Provider sections prompt for reconnect when the last social sync failed with expired or unauthorized auth state
- [x] Settings > Sources nav shows visible provider status dots, and the primary Sources sidebar keeps smaller right-edge dots or spinners aligned with the unread and total counts lane
- [x] Hovering a row in the primary Sources sidebar swaps the unread and total counts for the same three-dot actions affordance used by feed rows
- [x] Primary Sources sidebar status dots ease sideways with the hover swap so the metadata lane animates smoothly instead of snapping
- [x] Source action menus include a quick sync-status summary with the reason for warning states and a direct path into the full source settings
- [x] Source action menus only appear for actionable providers, hide the dead-end `All` row menu, and include `Sync now` for social providers as well as feeds
- [x] Clicking `Sync now` from a source action menu keeps the menu open so the user can watch the status and spinner update in place
- [x] Clicking the same source actions trigger again closes the already-open menu instead of reopening it through the outside-click handler
- [x] Source action menu headers spell out provider counts as `863 unread, 1.1K total` style summaries instead of a slash pair
- [x] Clicking `Sync now` shows a visible `Syncing Initiated` acknowledgment while the menu stays open, even if the provider is already syncing
- [x] `Cooling down` uses a small amber emoji indicator instead of an amber spinner so the paused state feels distinct at a glance
- [x] LinkedIn and the other social source rows keep a sidebar status indicator even if auth state lags behind, falling back to the provider's actual item counts before hiding the dot
- [x] Facebook group settings show active group counts in the header, keep refresh with the bulk actions as `Refresh groups`, keep each group row to one line, split scraped `Last active ...` text into its own smaller right-aligned column, show ID-tail fallback labels for groups whose names are still missing, show row-level progress while a missing-name group is being checked, provide a browser handoff action for leaving a group on Facebook, verify that single group after the leave handoff before removing it locally, repair stored missing group names from captured posts, refreshed group data, or individual group pages, and keep late-loaded groups inside a filtered inner scroller capped to the Settings modal
- [x] The redundant desktop header sync dropdown has been removed, leaving the sidebar source menus and provider settings as the canonical sync status and action surfaces
- [x] Desktop view chrome now routes through one shared top toolbar, so feed, reader, and Friends stop stacking separate bars on top of each other
- [x] Desktop top-toolbar controls now keep normal click behavior, but a full drag gesture from the wordmark, title area, or toolbar buttons repositions the native window the way a title bar should
- [x] Desktop top-toolbar title and subtitle blocks now reserve enough space for the wordmark, sidebar toggle, and traffic-light inset so view captions never overlap the left controls as the sidebar narrows
- [x] Narrow desktop reader mode now stays inline instead of falling into the full-screen mobile overlay, auto-collapses the thumbnail rail, and keeps the compact desktop sidebar accessible while an item is open
- [x] The primary sidebar and right debug drawer now render as floating shell cards using the same glassy header treatment as the marketing navbar
- [x] Reader toolbar controls now lock to the live sidebar and thumbnail-rail widths, so the sidebar toggle, dual-column toggle, and back-to-list control stay aligned with the floating cards below them
- [x] Toggling the desktop reader preview rail now animates the rail width open and closed unless global animations are set to none
- [x] Settings now use a shared polished dropdown treatment, and Appearance keeps the compact theme selector and global Zoom control in one section above the separate feed-only Card density control, with live hover and focus previews across every theme
- [x] Settings use a stronger modal shadow plus a blur-only frosted backdrop, the backdrop temporarily clears while previewing themes so desktop and touch users can see the active page treatment underneath, and hover previews now blur between the previous and next theme before snapping back unless the user clicks
- [x] The shared Settings shell now keeps the desktop close control aligned with the left sidebar header, while the mobile sheet runs flush to the top edge with a tighter toolbar and reliable section-to-section navigation
- [x] Appearance now exposes `Show read in grayscale`, and mark-read-on-scroll correctly normalizes mobile list offsets before deciding which rows have scrolled past
- [x] Appearance now exposes synced global animation intensity controls, and story cards share the same feed-to-reader layout transition path as regular cards
- [x] Desktop resize grips now live in the gaps between floating panels and use neutral hover feedback instead of a loud accent stripe
- [x] Friends and Map sit directly under `All` in the primary Sources sidebar so navigation order matches the product's main reading flow
- [x] Feeds sidebar status uses aggregate feed health, stays green when at least one followed feed is healthy, turns amber only when every followed feed is failing, and shows a spinner while RSS sync is actively running
- [x] The unified feed no longer reuses a bland hamburger glyph and now uses the chosen Crystal Core mark in the shared navigation icon set
- [x] Sidebar source badges no longer paint dark circular backplates over the icons, and the colored dots or spinners now sit farther out toward the upper-right corner without the black halo
- [x] The desktop toolbar now measures against the actual sidebar card instead of the outer shell gap, keeps the collapse control visually flush with the sidebar's right edge in expanded mode, and still tucks it directly beside the wordmark in the compact icon rail
- [x] Reopening the primary sidebar from a fully closed state now always restores the default expanded width instead of resurrecting the last dragged width or compact rail state
- [x] Once the primary sidebar crosses into its simplified narrow labeled state or the compact icon rail, the RSS section always behaves as closed and never renders inline sub-feed rows
- [x] The primary sidebar now resizes without a minimum width, previews its expanded, compact, and fully closed snap states live during drag, keeps the resize handle under the cursor while the card itself snaps, uses a tighter square-button compact rail with quieter 18px glyphs, lightly boosts the visually smaller brand marks like `X` and Facebook so they sit with the rest of the source icons, shell-matched corner radii, keeps narrow desktop windows on that compact desktop rail, and only falls back to the floating drawer on actual mobile devices
- [x] Expanded sidebar padding now flips between tighter roomy and condensed presets at a crossover instead of interpolating linearly, labeled widths below 200px drop counts, chevrons, and similar trailing chrome before labels, narrow-width labels now clip cleanly without ellipses and keep a small inner right gutter before the shell edge, provider status dots and spinners now ride on the source icons at every sidebar width, widths below 100px snap into the compact rail, compact search moves into a floating palette, and the shared mobile drawer now closes when the same hamburger button is tapped again
- [x] Device display state now stays outside Automerge, including card density, interface zoom, sidebar modes and widths, Friends detail rail state, map and feed view modes, saved sorting, signal filters, reader preview layout, and debug panel width. Existing synced values seed local storage once for backward compatibility.
- [x] Provider sync actions swap to an inline spinner while that specific provider is actively syncing
- [x] The top toolbar shows a right-edge background activity spinner while any observed sync, runtime job, updater download, or local AI model download is active, and the spinner opens a right-docked live activity popover with elapsed active-work timers without opening Settings
- [x] Provider health badges and section headers use specific state labels like `Cooling down`, `Paused`, `Reconnect required`, and `Sync issue` instead of generic attention copy
- [x] Settings expandable lists now use the shared filtered inner-list panel, so Facebook groups, RSS management, OPML previews, saved import errors, and scrape logs cannot stretch the outer Settings scroll when content loads late
- [x] Settings > Feeds can filter to one needs-review bucket and bulk unsubscribe the currently shown set from a toolbar above the list, while the feed rows sit in their own searchable inner scroller and still show whether the feed looks likely dead or just failing
- [x] Settings > Saved now shows an overview dashboard with saved-volume charts and source mix, instead of listing every saved item inline
- [x] Desktop debug tooling now samples runtime memory, relay document size, relay client count, and content-fetcher queue depth so long-run RAM growth can be correlated without attaching Instruments first
- [x] Desktop diagnostics now also sample renderer JS heap and DOM node counts so overnight RAM growth can be split between native process pressure and WebView pressure
- [x] Desktop diagnostics now include Freed-owned WebKit renderer RSS, Automerge binary size, IndexedDB size, WebKit cache size, and adaptive memory guardrails that reclaim scraper windows and network-cache blobs before pausing social capture
- [x] Social scrape memory preflight now records whether recycled WebKit process IDs exited, were retained, or were replaced, plus the RSS delta after cleanup
- [x] Desktop now records rotating runtime-health diagnostics with renderer heartbeat state, memory preflight results, recovery attempts, and active background work so blank-renderer reports include the last bad minute of runtime context
- [x] Concurrent native runtime-health writers now share process and operating-system locks across Unix rollover, whole-record appends, non-Unix bounded rewrites, and factory-reset cleanup, so every physical JSONL line remains independently parseable and repeated events keep their exact multiplicity
- [x] High-risk background work now waits for healthy renderer startup, active outbox drains, social scrapes, and memory pressure cooldowns before running content fetches, RSS polls, automatic snapshots, cloud uploads, cloud startup downloads, outbox drains, or native social scrapes
- [x] A blocked social memory preflight no longer destroys its calling renderer, preventing startup replay from recursively rearming the same failed preflight while the native cooldown is being recorded
- [x] Installed dev-channel builds can run Facebook, Instagram, LinkedIn, and YouTube sync soaks from the terminal through a native app-data trigger, without System Events clicks or foreground focus theft
- [x] Internal desktop soak guidance now treats terminal triggers and the 10 minute timeout path as the required unattended workflow, including generated nightly plans, release soak notes, and handoff prompts
- [x] Installed Desktop cold startup now has a quiet presentation path for `open -g`, keeps the main window non-focusable through startup visibility probes, and skips foreground-only occlusion recovery so terminal-driven soaks can launch the app without force-activating it
- [x] Desktop terminal sync triggers now report real provider outcomes, fail zero-post or deferred runs, and ignore stale native timeouts instead of overwriting newer trigger results
- [x] Desktop terminal sync trigger requests now expire after the helper timeout, so old request files do not replay authenticated provider traffic on the next app launch
- [x] Desktop terminal sync triggers now retry the same request only after native keepalive proves the renderer was rebuilt mid-run, so unattended soaks do not hang on a lost bridge
- [x] Desktop terminal sync triggers now use sparse 10 minute locked-machine retries with an explicit long-soak timeout override, so unattended runs do not churn the renderer every 30 seconds while the workstation is locked
- [x] Desktop terminal sync triggers now short-circuit locked-machine requests in native code before waking the main renderer, so locked soak retries do not inflate WebKit memory
- [x] Desktop terminal sync trigger helpers and the native trigger watcher now use provider-safe deferral backoff and stop after post-completion renderer rebuilds, so installed soaks do not create duplicate Instagram, LinkedIn, or YouTube traffic while diagnosing recovery
- [x] Idle desktop memory recovery now ignores reclaimable WebKit RSS tail when physical footprint is healthy, but still recovers the main renderer when the high-RSS WebKit process is hot on CPU, including active multi-GB WebKit growth below the global high-memory ceiling
- [x] Renderer recovery now requires both native window visibility and renderer document visibility before treating heartbeat gaps as foreground stalls, so background provider work is not paused by normal hidden WebKit timer throttling
- [x] Native renderer recovery now marks failed recovery state, requests relaunch, and forces the old process to exit if the main WebView label stays stuck after a destroyed renderer
- [x] Native relay broadcasts now reuse shared document buffers and stop writing a full snapshot on every live document push, reducing clone pressure during heavy sync churn
- [x] Desktop worker state no longer ships the full `allItemIds` list or full Automerge binary back to the main thread on every mutation, and the content fetcher now bounds its failed-item cooldown cache instead of keeping an immortal set of every fetch miss
- [x] Background fetch now tracks in-flight items, runs one active worker job at a time, and uses randomized pacing plus capped backoff so slow AI or network work cannot overlap the queue into renderer pressure
- [x] Background fetch no longer rescans the entire visible feed on every document mutation, it only rescans when the document item count changes, which cuts repeated O(n) churn during read toggles and preference writes
- [x] Outbox retry bookkeeping now drops completed and terminally failed IDs instead of keeping a session-long retry map for every action it has ever seen
- [x] Removing RSS feeds now also drops their retained provider-health diagnostics instead of keeping dead feed histories in memory and storage forever
- [x] Provider-health persistence now compacts RSS feed attempt history, derives per-feed charts from retained attempts, trims oversized error reasons, updates failing-feed diagnostics incrementally, and batches hot RSS writes so renderer memory is not burned repeatedly on `sync-health.json` parse and stringify cycles
- [x] Native runtime-health sampling continues while the renderer is hidden, including background pause state, active job age, safe-mode state, WebKit RSS, and adaptive memory limits
- [x] Desktop social scrape guardrails now scale beyond the old 4 GB ceiling on high-memory machines, while low-priority semantic enrichment and startup content-signal backfill wait through the launch quiet period
- [x] Local AI classifier health writes stay device-local without notifying model lifecycle subscribers, so a terminal backfill stays terminal instead of rebuilding the Automerge document every five seconds
- [x] Desktop releases idle Automerge worker documents after the request queue drains and terminates the worker until the next document operation, reducing retained renderer work during long background sessions
- [x] Desktop live UI state now caps preserved article text previews and fetches full preserved text on demand for the active reader item, instead of cloning entire article bodies through every feed-state update
- [x] Desktop native JSON persistence, encrypted secret store calls, cloud uploads, and outbox drains now run through typed side-effect queues with slow-task diagnostics, so common UI actions do not directly wait on native storage or broad outbox scans
- [x] Desktop Automerge subscriptions now carry change metadata, so item-patch mutations let the outbox drain only changed items while startup and full document updates keep the full scan path
- [x] Desktop outbox and article-fetch discovery now stream lossless, generation-pinned SQLite pages with stable keyset cursors instead of traversing the full renderer item corpus
- [x] Desktop feed browse materialization now scans the selected SQLite generation in bounded pages instead of walking the renderer item corpus a second time
- [x] Settings > Saved reads exact time, source, and content aggregates directly through `saved_analytics_v2`. Map, Story Wall, Library facets, and feed signal counts also fail closed on their typed SQLite readers without leasing or scanning a renderer item corpus.
- [x] Friends now reads selected Person timelines through `person_timeline_v1`. The shared adapter sends one stable Person ID to the native core, retains one bounded 50-row window, and never builds a renderer-side account-key filter or calls the historical item query. Source activity summaries remain on their existing bounded reader until the normalized graph-page cutover.
- [x] Friends now reads an unlinked Account timeline through `account_timeline_v1`. The selected detail sends one stable Account ID to native SQLite. Linked Accounts still use their Person timeline, and React never builds provider keys or filters FeedItems.
- [x] Provider settings now read source-fenced 64-row SQLite pages. Media backup stages compact local candidates and starts provider work only after source verification, while YouTube retains compact saved-video identities instead of the renderer item corpus
- [x] FriendEditor now reads at most 50 alphabetically ranked visible unlinked author candidates through source-fenced 64-row SQLite pages, debounces rapid searches for 150 ms, resolves exact selected-profile provenance through Account detail queries before saving, cancels stale source results, and has no renderer corpus or rollback path
- [x] SearchJump opens and searches without hydrating the renderer corpus. It uses one bounded source-fenced scan for exact Library tags, archive totals, and complex scope counts, compact aggregates for simple scopes, and one source-fenced selected item. Native reader failure fails closed. No rollback key, compatibility lease, renderer-derived facet fallback, or selected-item fallback remains.
- [x] The Freed Desktop Saved feed preserves all four user-facing sort modes through the normalized `saved_feed_page_v2` query with binary global-ID ties. SQLite owns filtering, ordering, and opaque bidirectional keyset cursors. React retains at most two bounded compact pages plus one selected card and never reacquires a whole Library projection.
- [x] The Freed Desktop non-Saved Friends-only feed uses `feed_browse_page_v2` when no search is active, with Person-first predicate schema v1, the existing recommendation order, ranking-weight invalidation, and a source-order working map capped to one 64-row native scan page. React retains two feed pages plus one selected card so eviction preserves ReaderView. Version 1 and its all-content callers remain unchanged. Source drift, predicate mismatch, native failure, or `freed.libraryCore.friendsFeedReaderV1.disabled=1` restores the Automerge compatibility path. Friends search, Friends plus Saved, and the PWA remain unchanged
- [x] The Freed Desktop ordinary all-content feed pages through the normalized `feed_browse_page_v3` query when no search is active and neither Saved-only nor Friends mode is selected. It carries an explicit `next` or `previous` direction and returns exclusive edge cursors bound to the exact generation and first and last rows. Backward reads mirror the forward keyset predicate through the same unique index without a temporary sort. React retains two bounded compact pages plus at most one pinned selected card and restores an evicted leading page without reacquiring the full Library.
- [x] Freed Desktop's ordinary feed, four-mode Saved feed, and signal counts call the flat normalized SQLite query command with exact shared request and response validation. The adapters retain only compact bounded rows, preserve opaque forward and backward keyset cursors, reconstruct the existing feed-card view model from the shared projection, and never call the historical item query. Friends remains on its existing reader until the normalized contract closes the Friends predicate inside SQLite.
- [x] Freed Desktop returns the first filtered SQLite feed page before scanning later pages, keeps the old page hidden behind an explicit loading state during filter transitions, and computes command-palette facets, signal counts, sidebar counts, Friends activity, map candidates, Story Wall candidates, and tiny-mutation refreshes through native bounded queries or aggregates instead of streaming the complete Library into the renderer. Later pages and maintenance scans skip redundant whole-table counts. The production shell omits derived Friends rows and retired feed-order IDs.
- [x] Desktop item-patch updates now maintain a main-thread item index and adjust unread, total, and archivable aggregates incrementally instead of walking the visible item list after each patch
- [x] Desktop RSS feed metadata writes now persist through Automerge and send feed patches to the UI without hydrating the full feed item projection
- [x] Desktop reader hydration now uses native fetch and authenticated provider paths on open, caches successful reader content locally, pins saved items by default, hydrates X reply threads with media, hydrates visible Facebook and Instagram post comments, and explains private story replies when the user is online
- [x] Freed Desktop feed cards now show captured media thumbnails in the full feed, social story tiles, and the compact reader rail, with broken image fallback to the existing text card
- [x] Freed Desktop unified feed rows now use the local card density setting as a fixed-height virtualization contract, with matching loading skeletons, post cards and story rows sharing each selected height, side media wells, density-aware clamped previews, toolbar overflow access for narrower desktop widths, a local interface zoom slider for root display scale, and no row remeasurement when media loads
- [x] Desktop persistence now appends Automerge incremental saves to the last snapshot and only compacts back to a fresh snapshot once incremental growth justifies it, instead of full-document reserialization on every mutation
- [x] Full-library search runs natively against the active SQLite Library, scores one row at a time, streams at most 32 cards per page, strips preserved HTML, and lets React retain only the best 100 filtered cards. No renderer MiniSearch index, corpus filter, scan fallback, or browser-test compatibility path remains.
- [x] Map candidates are classified when SQLite rows are written and ordered through a partial location timeline index, so opening Map does not scan and sort the full Library before returning its bounded page.
- [x] Map and Story Wall call `map_markers_v1` and `story_wall_candidates_v1` directly. Their compact source-fenced rows exclude reader bodies, tags, signals, highlights, and unrelated state. Their row-to-visible-card transform lives in the shared contract package instead of a Desktop-only adapter.
- [x] Freed Desktop and PWA keep a bundled geographic map style that uses the same OpenFreeMap vector tiles and glyphs when the remote style document is unavailable. A transient style-endpoint failure no longer leaves the map background blank, and the live OpenFreeMap style remains preferred when it loads.
- [x] Desktop perf memory checks now use CDP heap-usage sampling instead of the broken zero-value metric path, and they include a heavy preserved-text search scenario so renderer retention regressions show up in CI
- [ ] Windows installer is code-signed (Microsoft Artifact Signing plan scaffolded)
- [x] Update server runs on a Freed-owned domain instead of pointing the updater directly at GitHub Releases
- [x] Desktop settings can switch this install between production and dev release channels, and the dev channel will install a newer production release when no newer dev build exists without switching the saved channel

> **Current state:**
> macOS release builds are signed and notarized in GitHub Actions when the
> required Apple secrets are present. The release workflow now fails fast
> instead of silently shipping an unsigned macOS artifact. Windows signing is
> planned through Microsoft Artifact Signing, and the repo now includes
> `docs/WINDOWS-SIGNING.md` plus an inert Tauri `signCommand` scaffold for the
> future implementation. Windows SmartScreen warnings will still appear until
> that path is provisioned, enabled, and verified in a signed release. The shared desktop toolbar
> now behaves like a real title bar again, including threshold-based window
> dragging from toolbar controls plus normal cursor and selection treatment
> for static toolbar labels. Desktop now also keeps dev installs on the
> newest eligible build even when that build comes from the production
> channel. When production gets ahead of the last dev build, the app now
> offers that production update without flipping the saved channel away
> from dev. Desktop now also writes
> rotating local Automerge snapshots, including Google contact match state,
> so catastrophic local corruption can be rolled back from Settings.
> The desktop runtime now also emits periodic memory telemetry into the
> debug panel and local logs, including process RSS, virtual size, relay
> document size, relay client count, renderer heap usage, and DOM node
> counts. We also removed the native relay's old habit of cloning whole
> document buffers into multiple owners and writing a fresh snapshot on
> every broadcast, which was an especially bad trade once sync churn stayed
> hot for an hour or more. The worker now fetches full item-id lists and
> full Automerge binaries only on demand for import dedupe, relay, cloud
> backup, and snapshots, rather than shipping those payloads back to the
> main thread on every state update. Desktop memory telemetry now also samples
> Freed-owned WebKit renderer RSS, Automerge binary size, IndexedDB storage,
> WebKit cache size, and adaptive high and critical memory limits. Native
> runtime-health sampling now continues even while the renderer is hidden, so
> overnight reports still show memory, pause, safe-mode, and active background
> job state. Social capture now runs a native preflight that recycles stale scraper windows,
> records which WebKit process IDs exited or survived the recycle, and trims
> only Freed WebKit network-cache blobs before it decides a scrape must pause.
> On high-memory machines, scrape guardrails now scale beyond the old 4 GB
> critical cap, and low-priority semantic enrichment waits through launch so it
> does not spend the first Automerge-heavy background slot before provider sync.
> The background runtime now also gates content fetches, RSS polls,
> automatic snapshots, cloud uploads, outbox drains, and social scrapes behind
> healthy renderer startup and shared pressure cooldowns, while native recovery
> writes runtime-health records and relaunches if the old renderer label stays
> stuck after destroy. Critical memory pressure pauses background content fetching, then
> offers a restart action instead of letting WebKit conduct the RAM orchestra
> with a shovel. The background content fetcher now runs one active worker job
> at a time, randomizes its next fetch delay, backs off after timeouts or AI
> provider failures, bounds and ages out its failed-item cooldown cache, and it
> keeps an in-flight set so unrelated state updates cannot queue the same fetch
> work over and over while a URL is already being processed. It also stopped
> rescanning the full visible feed on every tiny document mutation and now
> only rescans when the document item count actually changes. The outbox also
> prunes completed retry bookkeeping instead of letting that map grow across
> a long session, and removing RSS feeds now also forgets their saved health
> history instead of leaving dead diagnostics behind. Local browser preview
> now also short-circuits native-only snapshot, consent-store, provider-health,
> memory-monitor, and background refresh paths so legal acceptance no longer
> dumps the preview into the recovery screen after a reload. Desktop feed-state
> updates also now cap preserved article text previews and fetch the full
> preserved text only for the reader item that is actually open, instead of
> cloning full article bodies through the live UI state on every mutation.
> RSS feed metadata writes now use the same incremental worker pattern, so
> adding or editing one feed persists the Automerge change and patches the UI
> without rebuilding the full desktop feed projection.
> Desktop search now scans and scores the active SQLite Library one row at a
> time in the native process. It streams at most 32 result cards per page and
> React retains the best 100 filtered cards, so typing never builds a renderer
> search heap or clones the full `FeedItem[]`. The desktop perf harness also switched from Chromium's broken
> zero-value heap metric path to `Runtime.getHeapUsage()` and added a heavy
> preserved-text search scenario, so memory regressions stop passing CI by
> emitting a very confident `0.0 MB`.
> Desktop persistence also now appends Automerge incremental saves to the
> last stored snapshot and compacts back to a fresh snapshot only when the
> incremental tail has grown large enough to justify it.
> Local developer workflow now also defaults desktop preview to the
> `VITE_TEST_TAURI=1` browser harness, with tracked preview slots so
> multiple concurrent worktrees do not each spin up their own native Tauri
> stack by default. When a real native preview is needed, the launched
> window now shows a worktree plus thread label so parallel preview apps
> can be told apart at a glance.
> Release notes now use a
> checked-in review gate: `./scripts/release.sh` prepares draft notes and
> daily editorial memory, then `./scripts/release-publish.sh` tags only after
> the reviewed release artifact passes validation and is approved. The latest
> dev release prep now returns through a PR to `dev`. Production prep starts
> from current `main` after any required promotion and returns through a
> release-only PR to `main`. Tagging requires the exact merged remote commit.
> Protected release branches no longer depend on direct
> release commits or branch pushes. The latest
> release of each day is cumulative, so website changelog cards describe
> everything newly shipped since the previous day instead of unioning same-day
> bullets after the fact. Production releases now also carry forward
> intermediary dev prereleases since the prior production release, so the
> public card does not drop features that first shipped on `dev`. Release
> artifacts now render a distinct opener plus
> separate `Features`, `Fixes`, and `Follow-ups` sections so the card headline
> can reinforce the theme without collapsing the details into one bucket. The
> desktop updater now shows only that reviewed opener line when an update is
> available. The public changelog now paginates in URL-addressable sets of 5
> releases so older builds can be linked directly without turning the page
> into a mile-long papyrus scroll, and card hover states now key off the
> existing timeline lane instead of inventing a second internal accent rail.
> Freed Desktop Settings now embeds those latest five cumulative changelog
> cards in the Updates pane, with a channel-aware link to the full changelog.
> The updater endpoint now lives behind `freed.wtf/api/desktop-updates/{{target}}`,
> and Freed Desktop can switch locally between production releases from `main`
> and dev prereleases from `dev` without syncing that preference through the
> shared document.
> Dev release tags now run the dev validation tier and package only the
> internal macOS Apple Silicon build. Production tags run the production
> validation tier, build every supported platform in parallel, upload platform
> assets to a pre-created draft release, then generate `latest.json` once after
> all signed artifacts are present so updater metadata does not race between
> matrix jobs.
> The public marketing site is controlled by the `www` branch. After any
> GitHub release is published, the workflow now redeploys `freed.wtf` from the
> current `www` branch so the changelog snapshot rebuilds against the newly
> published release instead of waiting for a later production ship. Production
> desktop tags still come from `main`, and production website deploys still
> require the reviewed website and changelog state to be merged into `www`
> first. Production prep and publish now also validate that `main` still
> matches current `dev` on product-owned paths, PRs to `main` reject direct
> product edits unless they come from a `chore/promote-dev-to-main-*`
> promotion branch, and the release workflow rechecks that same guard before a
> production tag can build. Dev releases refresh the public changelog from
> current `www` without ever moving `www` to `dev`. See
> `RELEASE-SECRETS.md` for the full setup checklist.
>
> The reader header toolbar now uses one consistent icon-button geometry for
> sidebar, rail, bookmark, and archive controls. Back navigation reaches
> farther left, action buttons no longer reserve bogus slot space between one
> another, the archive action no longer changes apparent size when active, and
> the trailing reader actions sit closer to the content instead of drifting
> inside an oversized right gutter.
>
> The map surface now overrides the generic sidebar-gap viewport compensation
> and uses its own balanced vignette overlay. That removes the hard left edge
> the inherited mask was creating, softens the visible boundary around the map,
> and evens out the top-right corner so the feathering reads consistently on
> all four sides.
>
> The unified feed crystal-core icon now renders slightly larger than the rest
> of the sidebar icon set in both labeled and compact rail modes, so it carries
> the same visual weight as the platform marks without forcing another global
> icon-size rebalance.
>
> Compact-sidebar search now stays visibly active whenever the floating search
> palette is open or a query is currently filtering content. The floating
> palette uses the same corner radius as the sidebar shell, and active search
> on non-reader views now promotes a clearable search field into the center of
> the top toolbar instead of leaving stale scope copy there.
>
> The desktop sidebar and header now share one live boundary contract instead
> of guessing at one another's geometry. The toolbar controls track the real
> sidebar handle during drag preview, the collapse and rail toggles now use the
> same fixed icon-button box without off-center glyph hacks, expanded padding
> stays on the two requested presets, and narrow labeled mode keeps the older
> cleanup rules intact at the same time: `Feed`, `Search`, no counts, no
> subfeeds, and clipped labels with a small right gutter instead of ellipses.
> Sidebar status badges also use one shared overlay position in labeled and
> compact modes, with the dark backplate removed. The narrow labeled sidebar
> also trims its label-side right padding further now, so clipped text can run
> closer to the shell edge without turning into edge-to-edge soup.
>
> Local browser preview now keeps desktop snapshots, legal consent, provider
> health persistence, and runtime memory telemetry on browser-safe fallbacks
> instead of calling native Tauri APIs, so accepting the desktop legal gate no
> longer crashes the `4173` preview into the recovery screen.

### Mobile

- [ ] iOS app builds and runs
- [ ] Android app builds and runs
- [ ] Syncs with Desktop when on same network
- [ ] Falls back to cloud sync when away
- [ ] Background refresh works (iOS)
- [ ] Background service works (Android)
- [ ] App Store approved
- [ ] Play Store approved

---

## Deliverable

Native apps for **macOS, Windows, Linux, iOS, and Android** with capture, sync, and reader UI. No CLI or technical setup required.

---

## Dependencies

```toml
# Cargo.toml
[dependencies]
tauri = { version = "2", features = ["macos-private-api"] }
tokio = { version = "1", features = ["full"] }
```

```json
{
  "dependencies": {
    "@freed/shared": "*",
    "@freed/sync": "*",
    "@freed/pwa": "*"
  }
}
```
