# Phase 5: Desktop & Mobile App (Tauri)

> **Status:** 🚧 In Progress (direct desktop distribution live, macOS signing and notarization live in releases, legal consent gate shipped, tri-state sidebar chrome shipped, local snapshot restore shipped, public-safe bug reporting shipped, runtime memory telemetry shipped, native startup recovery shipped, bundled recovery updater flow shipped, permanent local social media vault shipped, desktop hot-path side-effect scheduling shipped, event-aware outbox drains shipped, incremental item-patch state updates shipped, incremental RSS feed metadata updates shipped, safe optimistic user mutations shipped, visible-scope bulk archive shipped, background runtime coordination shipped, renderer recovery safe mode shipped, deep local WebKit diagnostics shipped, adaptive high-memory scrape budgets shipped, idle Automerge worker recycling shipped, bounded scheduled RSS refresh shipped, density-aware fixed-height unified feed rows shipped, settings changelog preview shipped, fingerprinted sample-data cleanup shipped, visible cloud transfer diagnostics shipped, destructive cloud merge recovery shipped, manual Drive sync and activity timelines shipped, cloud upload waits behind active outbox work shipped, production-default Google token proxy fallback shipped, recoverable Google Contacts refresh failures shipped, global background activity monitoring shipped, and native terminal sync soaks shipped)
> **Dependencies:** Phase 4 (Sync Layer)  
> **Priority:** 🎯 HIGHEST — Universal liberation tool

---

## Overview

The universal liberation tool. Anyone can install this and escape algorithmic manipulation without technical setup. This phase packages capture, sync, and UI into Freed Desktop for direct distribution on macOS, Windows, and Linux.

Large app store distribution is not part of the current strategy. The mobile reading surface lives in the PWA, and native mobile packaging stays explicitly out of the critical path.

**Key architectural decisions:**

- **TypeScript capture via subprocess** — Existing `capture-x`, `capture-rss` packages run via Node/Bun subprocess, not rewritten in Rust
- **Shared React codebase:** `packages/pwa/` is embedded in WebView and deployed standalone to `app.freed.wtf`, while `dev-app.freed.wtf` follows the latest merge to `dev`
- **X authentication via WebView** — User logs into X inside the app; cookies captured from WebView session
- **Ranking runs here** — Desktop computes `priority` scores, syncs to PWA via Automerge
- **Versioned legal gate** — Freed Desktop blocks startup side effects until the current legal bundle is accepted locally on-device
- **Provider risk interstitials** — X, Facebook, Instagram, and LinkedIn require separate local consent before login or sync actions
- **Permanent social media vault:** Facebook and Instagram can copy the user's own uploaded media into local app data outside Automerge and outside normal cache pruning
- **Manual disconnect clears active pauses:** Disconnecting a social provider clears its current pause and resets future backoff escalation, but keeps historical diagnostics intact
- **Paused providers reuse the primary action:** Settings surfaces swap `Sync Now` to `Resume Now` when a provider is paused, instead of rendering a second resume button
- **Internal navigation history** — Desktop keeps a browser-style serialized navigation stack so `Cmd+[` and `Cmd+]` move through views and open reader state
- **Blank-state testing escape hatch** — Desktop empty states now offer a lightweight sample-data section below the primary blank-state prompt, so fresh installs can seed realistic data without detouring into Settings
- **Fingerprinted sample-data cleanup** - New sample batches carry an internal marker across feeds, items, people, and accounts, so accidental sample population can be cleared without matching on names, URLs, or content patterns
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
- **Local card density control:** The feed toolbar now exposes a three-stop card density slider that persists on the current device, with compact, comfortable, and expansive vertical card spacing
- **Hot-path side-effect scheduling:** Desktop routes native JSON persistence, encrypted secret store calls, cloud uploads, and outbox drains through typed queues so clicks, scroll callbacks, and document subscriptions do not directly run slow native I/O or large scans
- **Safe optimistic user mutations:** Feed cards, reader controls, read marks, item edits, feed renames, person edits, account edits, and preference changes project their visible UI state immediately, then reconcile counts and derived state from the Automerge worker
- **Incremental RSS feed metadata updates:** Desktop adds, updates, and removes RSS feed metadata through Automerge feed patches, so subscribing to a feed does not rehydrate the full 10,000 item library before the UI can recover
- **Cloud transfer diagnostics:** Desktop Settings shows local item count, Automerge document size, Drive stage, last download, last upload, remote bytes, uploaded bytes, cloud errors, why the next upload is pending, and recent Drive activity. When destructive merge protection blocks sync, Settings lets the user keep this device by replacing the cloud backup, or keep the cloud copy by replacing this device, and keeps that recovery card pinned while upload retries are paused. Uploads wait behind active outbox and social-scrape work before retrying, so normal local changes do not sit behind long backoff while another worker finishes.
- **Recoverable Google Contacts auth failures:** Token lookup and forced refresh errors are recorded in contact sync state and Settings instead of opening the fatal recovery screen
- **Google token proxy fallback:** Freed Desktop defaults missing or empty Google proxy build env to the production token proxy so dev and local builds cannot silently drift into direct Google token exchange
- **Background runtime coordination:** Desktop gates high-risk background work behind healthy renderer startup, shared memory pressure cooldowns, renderer recovery safe mode, and a native social-scrape lease so WebKit pressure cannot keep blanking the main window
- **Global background activity monitor:** The top toolbar shows a live activity spinner while provider syncs, Google Contacts sync, cloud sync, runtime jobs, updater downloads, or local AI model downloads are active. Opening the spinner docks the monitor to the right edge, shows active work with elapsed timers, and keeps the bounded live log open until the user closes it without starting new provider traffic.
- **Native terminal sync soaks:** Dev-channel installed builds can pick up local sync trigger files from the native process, wake the existing renderer sync bridge without stealing focus, retry a pending trigger after renderer recovery, and keep the renderer alive while the normal Facebook, Instagram, or LinkedIn refresh path runs.
- **Quiet installed startup:** Freed Desktop now keeps cold startup quiet when launched with `open -g`, holds the main window non-focusable through startup visibility probes, skips foreground-only startup occlusion recovery on that path, and lets installed-build soaks start the app without interrupting the primary workstation. Explicit Show, dock reopen, recovery retry, and other foreground actions still raise the app.
- **Deep local WebKit diagnostics:** Renderer stalls, memory preflight blocks, and recovery attempts write bounded local diagnostics with WebKit process identity, RSS, CPU, process age, WebView labels, cache sizes, vmmap summaries, short process samples, and scraper recycle PID verification. Main renderer recovery now treats high WebKit RSS plus high CPU as active pressure instead of reclaimable tail memory, and recycles the main renderer when multi-GB WebKit resident and footprint growth stay CPU-hot before the global high-memory ceiling is reached.
- **Adaptive social memory budgets:** Freed Desktop now scales high and critical scrape guardrails on high-memory machines, records native memory samples even when the renderer is hidden, and keeps low-priority semantic enrichment out of the launch path so Facebook and Instagram get memory first
- **Bounded scheduled RSS refresh:** Background RSS polling now refreshes only due stale feeds in capped batches, while manual RSS refresh keeps the full enabled-feed sweep

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

| Task | Description                                                             | Complexity |
| ---- | ----------------------------------------------------------------------- | ---------- |
| 5.1  | Tauri 2.0 project scaffold                                              | Medium     |
| 5.2  | Embed PWA React app in WebView                                          | Medium     |
| 5.3  | Native window vibrancy (macOS)                                          | Low        |
| 5.4  | Menu bar icon + background mode                                         | Medium     |
| 5.5  | Local WebSocket relay                                                   | Medium     |
| 5.6  | Playwright subprocess setup                                             | High       |
| 5.7  | System tray with sync status                                            | Low        |
| 5.8  | QR code display for phone pairing                                       | Low        |
| 5.9  | Auto-launch on login (optional)                                         | Low        |
| 5.10 | macOS notarization + DMG packaging                                      | High       |
| 5.11 | Windows installer                                                       | Medium     |
| 5.12 | Linux AppImage/Flatpak                                                  | Medium     |
| 5.22 | Auto-updater (tauri-plugin-updater)                                     | Medium     |
| 5.23 | CI/CD release pipeline (GH Actions)                                     | Medium     |
| 5.24 | macOS code signing + notarization                                       | High       |
| 5.25 | Windows code signing                                                    | Medium     |
| 5.26 | Independent update server domain                                        | Medium     |
| 5.27 | First-run legal gate and local-only acceptance storage                  | Medium     |
| 5.28 | Provider-specific risk interstitials for social capture                 | Medium     |
| 5.29 | Internal serialized navigation history with `Cmd+[` / `Cmd+]`           | Low        |
| 5.30 | Reviewed AI-assisted release notes and cumulative daily changelog cards | Medium     |
| 5.31 | Provider health dashboard, charts, and unsubscribe flow                 | Medium     |
| 5.32 | Rotating local database snapshots + restore UI                          | Medium     |
| 5.33 | Public-safe and private bug report bundles                              | Medium     |
| 5.34 | Native startup recovery window outside the React tree                  | Medium     |
| 5.35 | Hot-path side-effect scheduling for persistence, sync, and outbox work  | Medium     |
| 5.36 | Event-aware Automerge subscription metadata for item-patch outbox drains | Medium     |
| 5.37 | Incremental main-thread item-patch state updates                         | Medium     |
| 5.38 | Renderer recovery safe mode and deep local WebKit diagnostics            | Medium     |
| 5.39 | Visible cloud transfer diagnostics, manual sync, and activity timeline    | Medium     |
| 5.40 | Global toolbar background activity monitor                               | Medium     |

---

## Success Criteria

### Desktop

- [x] Desktop app launches with native vibrancy on macOS
- [x] Captures from X, RSS in background (refreshAllFeeds covers both)
- [x] Local WebSocket relay enables instant phone sync (binary protocol)
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
- [x] Provider-specific capture flows require additional local risk consent
- [x] Legal acceptance stays outside synced Automerge state
- [x] Permanent Facebook and Instagram media archive stores files, manifest rows, byte counts, retry state, and provider archive preferences locally outside synced Automerge state
- [x] Freed Desktop keeps rotating local database snapshots with a restore flow in Settings
- [x] Desktop E2E test infrastructure bootstrapped (Playwright + VITE_TEST_TAURI=1 mock layer)
- [x] Desktop E2E gates are split into smoke, functional regression, performance, and visual lanes, with dev build validation running the performance and visual lanes instead of hiding them until production release prep
- [x] Local desktop preview now defaults to the mocked browser harness, while tracked preview slots keep concurrent local threads to one desktop preview at a time unless native Tauri behavior is explicitly requested, and native preview windows carry a visible worktree and thread label
- [x] Desktop navigation history supports browser-style back and forward shortcuts for views and reader state
- [x] Freed Desktop registers a device-local OS-wide Save Content shortcut that opens the existing Save Content dialog, pre-fills the URL field from the clipboard when it holds an HTTP or HTTPS link, and opens the saved item in reader mode after persistence
- [x] Settings and crash recovery surfaces can export public-safe bug report bundles
- [x] Private diagnostic bundles are opt-in, redacted, and steered toward email instead of public GitHub attachment
- [x] Bug report actions now label whether they download a public-safe or private bundle, bulk-toggle private diagnostics, and block public GitHub issue drafts while private diagnostics remain selected
- [x] Browser desktop preview now guards native-only LinkedIn auth listeners, background social refresh paths, and local snapshot controls, so opening Settings and switching themes no longer crashes the preview
- [x] Freed Desktop emits native renderer heartbeats and warns in the local log when the main window goes silent long enough to suggest a renderer hang or crash
- [x] If the renderer dies before the app finishes booting, the next launch opens a native recovery window with retry, immediate in-place update install, and channel-aware browser download fallback actions outside the React tree
- [x] Performance benchmarks: MiniSearch lazy-build fix reduces markAsRead from ~300ms to ~30ms (10x)
- [x] Safe user-triggered document mutations project visible UI changes immediately, roll back on worker failure, and leave destructive or repair operations source-of-truth first
- [x] Visible-scope archive read actions batch filtered read items through one Automerge worker mutation, so large Instagram cleanup does not loop through one archive toggle per post
- [x] macOS DMG is notarized in CI releases
- [x] Checked-in release notes are reviewed before a release tag can publish
- [x] Production release prep and publish refuse stale `main` snapshots until current `dev` has been promoted into `main`, and PRs targeting `main` reject direct product edits outside the promotion flow
- [x] Debug panel Health tab charts provider reliability plus daily and hourly pull volume across RSS, X, Facebook, Instagram, LinkedIn, Google Drive, and Dropbox
- [x] Desktop Settings > Sync shows local item count, local document size, Drive stage, last download, last upload, remote bytes, uploaded bytes, cloud errors, pending upload explanations, a manual Drive `Sync now` action, and a recent activity timeline
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
- [x] Settings now use a shared polished dropdown treatment, and Appearance keeps the theme selector as one compact row instead of a descriptive mini card with live hover and focus previews across every theme
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
- [x] The feed toolbar now includes a local three-position card density slider, and full feed cards render compact, comfortable, or expansive vertical spacing without syncing that device preference through Automerge
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
- [x] High-risk background work now waits for healthy renderer startup, active outbox drains, social scrapes, and memory pressure cooldowns before running content fetches, RSS polls, automatic snapshots, cloud uploads, cloud startup downloads, outbox drains, or native social scrapes
- [x] Installed dev-channel builds can run Facebook, Instagram, and LinkedIn sync soaks from the terminal through a native app-data trigger, without System Events clicks or foreground focus theft
- [x] Internal desktop soak guidance now treats terminal triggers and the 10 minute timeout path as the required unattended workflow, including generated nightly plans, release soak notes, and handoff prompts
- [x] Installed Desktop cold startup now has a quiet presentation path for `open -g`, keeps the main window non-focusable through startup visibility probes, and skips foreground-only occlusion recovery so terminal-driven soaks can launch the app without force-activating it
- [x] Desktop terminal sync triggers now report real provider outcomes, fail zero-post or deferred runs, and ignore stale native timeouts instead of overwriting newer trigger results
- [x] Desktop terminal sync trigger requests now expire after the helper timeout, so old request files do not replay authenticated provider traffic on the next app launch
- [x] Desktop terminal sync triggers now retry the same request only after native keepalive proves the renderer was rebuilt mid-run, so unattended soaks do not hang on a lost bridge
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
- [x] Desktop releases idle Automerge worker documents after the request queue drains and terminates the worker until the next document operation, reducing retained renderer work during long background sessions
- [x] Desktop live UI state now caps preserved article text previews and fetches full preserved text on demand for the active reader item, instead of cloning entire article bodies through every feed-state update
- [x] Desktop native JSON persistence, encrypted secret store calls, cloud uploads, and outbox drains now run through typed side-effect queues with slow-task diagnostics, so common UI actions do not directly wait on native storage or broad outbox scans
- [x] Desktop Automerge subscriptions now carry change metadata, so item-patch mutations let the outbox drain only changed items while startup and full document updates keep the full scan path
- [x] Desktop item-patch updates now maintain a main-thread item index and adjust unread, total, and archivable aggregates incrementally instead of walking the visible item list after each patch
- [x] Desktop RSS feed metadata writes now persist through Automerge and send feed patches to the UI without hydrating the full feed item projection
- [x] Desktop reader hydration now uses native fetch and authenticated provider paths on open, caches successful reader content locally, pins saved items by default, hydrates X reply threads with media, hydrates visible Facebook and Instagram post comments, and explains private story replies when the user is online
- [x] Freed Desktop feed cards now show captured media thumbnails in the full feed, social story tiles, and the compact reader rail, with broken image fallback to the existing text card
- [x] Freed Desktop unified feed rows now use the local card density setting as a fixed-height virtualization contract, with matching loading skeletons, post cards and story rows sharing each selected height, side media wells, density-aware clamped previews, toolbar overflow access for narrower desktop widths, and no row remeasurement when media loads
- [x] Desktop persistence now appends Automerge incremental saves to the last snapshot and only compacts back to a fresh snapshot once incremental growth justifies it, instead of full-document reserialization on every mutation
- [x] Search now builds a shared MiniSearch index asynchronously in chunks, drops it after the query clears, rebuilds only when the worker says the searchable corpus changed, and indexes a smaller preserved-text window so one exploratory search cannot pin duplicate full-text copies of the library in renderer memory
- [x] Desktop perf memory checks now use CDP heap-usage sampling instead of the broken zero-value metric path, and they include a heavy preserved-text search scenario so renderer retention regressions show up in CI
- [ ] Windows installer is code-signed (requires EV certificate)
- [x] Update server runs on a Freed-owned domain instead of pointing the updater directly at GitHub Releases
- [x] Desktop settings can switch this install between production and dev release channels, and the dev channel will install a newer production release when no newer dev build exists without switching the saved channel

> **Current state:**
> macOS release builds are signed and notarized in GitHub Actions when the
> required Apple secrets are present. The release workflow now fails fast
> instead of silently shipping an unsigned macOS artifact. Windows
> SmartScreen warnings will still appear until an EV certificate is
> obtained or enough installs build reputation. The shared desktop toolbar
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
> Search now tears down its MiniSearch index as soon as the query clears,
> rebuilds it only when the worker reports a real corpus change, and indexes
> a smaller preserved-text window so a one-off search cannot keep a second
> library-sized text copy resident in renderer memory for the rest of the
> session. The desktop perf harness also switched from Chromium's broken
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
