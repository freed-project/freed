# Phase 5: Desktop & Mobile App (Tauri)

> **Status:** 🚧 In Progress (direct desktop distribution live, macOS signing and notarization live in releases, legal consent gate shipped, local snapshot restore shipped, public-safe bug reporting shipped, runtime memory telemetry shipped, native startup recovery shipped)
> **Dependencies:** Phase 4 (Sync Layer)  
> **Priority:** 🎯 HIGHEST — Universal liberation tool

---

## Overview

The universal liberation tool. Anyone can install this and escape algorithmic manipulation without technical setup. This phase packages capture, sync, and UI into Freed Desktop for direct distribution on macOS, Windows, and Linux.

Large app store distribution is not part of the current strategy. The mobile reading surface lives in the PWA, and native mobile packaging stays explicitly out of the critical path.

**Key architectural decisions:**

- **TypeScript capture via subprocess** — Existing `capture-x`, `capture-rss` packages run via Node/Bun subprocess, not rewritten in Rust
- **Shared React codebase** — `packages/pwa/` is embedded in WebView and deployed standalone to `app.freed.wtf`, with the dev channel on `dev-app.freed.wtf`
- **X authentication via WebView** — User logs into X inside the app; cookies captured from WebView session
- **Ranking runs here** — Desktop computes `priority` scores, syncs to PWA via Automerge
- **Versioned legal gate** — Freed Desktop blocks startup side effects until the current legal bundle is accepted locally on-device
- **Provider risk interstitials** — X, Facebook, Instagram, and LinkedIn require separate local consent before login or sync actions
- **Manual disconnect clears active pauses:** Disconnecting a social provider clears its current pause and resets future backoff escalation, but keeps historical diagnostics intact
- **Paused providers reuse the primary action:** Settings surfaces swap `Sync Now` to `Resume Now` when a provider is paused, instead of rendering a second resume button
- **Internal navigation history** — Desktop keeps a browser-style serialized navigation stack so `Cmd+[` and `Cmd+]` move through views and open reader state
- **Blank-state testing escape hatch** — Desktop empty states now offer a lightweight sample-data section below the primary blank-state prompt, so fresh installs can seed realistic data without detouring into Settings
- **Archived saved-item repair control** — Archived views now surface a one-click `Unarchive Saved Content` action when legacy or imported items end up both saved and archived

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

---

## Success Criteria

### Desktop

- [x] Desktop app launches with native vibrancy on macOS
- [x] Captures from X, RSS in background (refreshAllFeeds covers both)
- [x] Local WebSocket relay enables instant phone sync (binary protocol)
- [x] QR code pairing works (token-authenticated; local SVG render, no third-party QR API)
- [x] System tray shows sync status
- [x] App runs in background after window close
- [x] Auto-updater checks GitHub Releases and installs updates in-app
- [x] CI/CD release pipeline builds for macOS (ARM + Intel), Windows, Linux on tag push
- [x] App icons generated for all platforms
- [x] macOS DMG builds
- [x] Windows NSIS + MSI installers build
- [x] Linux AppImage, .deb, .rpm all build
- [x] All updater artifacts signed and uploaded to GitHub Releases
- [x] First launch is blocked behind a local-only legal clickwrap gate
- [x] Provider-specific capture flows require additional local risk consent
- [x] Legal acceptance stays outside synced Automerge state
- [x] Freed Desktop keeps rotating local database snapshots with a restore flow in Settings
- [x] Desktop E2E test infrastructure bootstrapped (Playwright + VITE_TEST_TAURI=1 mock layer)
- [x] Local desktop preview now defaults to the mocked browser harness, while tracked preview slots keep concurrent local threads to one desktop preview at a time unless native Tauri behavior is explicitly requested
- [x] Desktop navigation history supports browser-style back and forward shortcuts for views and reader state
- [x] Settings and crash recovery surfaces can export public-safe bug report bundles
- [x] Private diagnostic bundles are opt-in, redacted, and steered toward email instead of public GitHub attachment
- [x] Freed Desktop emits native renderer heartbeats and warns in the local log when the main window goes silent long enough to suggest a renderer hang or crash
- [x] If the renderer dies before the app finishes booting, the next launch opens a native recovery window with retry and latest-build download actions outside the React tree
- [x] Performance benchmarks: MiniSearch lazy-build fix reduces markAsRead from ~300ms to ~30ms (10x)
- [x] macOS DMG is notarized in CI releases
- [x] Checked-in release notes are reviewed before a release tag can publish
- [x] Debug panel Health tab charts provider reliability plus daily and hourly pull volume across RSS, X, Facebook, Instagram, LinkedIn, Google Drive, and Dropbox
- [x] Failing RSS feeds can be reviewed and unsubscribed from the health panel, with optional article/history deletion
- [x] Sidebar source actions and source settings surface degraded or paused provider health outside the debug panel
- [x] Debug panel Health tab charts provider reliability plus daily and hourly pull volume across RSS, X, Facebook, Instagram, LinkedIn, Google Drive, and Dropbox, with an in-card duration dropdown for each provider
- [x] Failing RSS feeds can be reviewed and unsubscribed from the health panel, with optional article/history deletion
- [x] Provider status indicators switch to a live spinner while that provider is actively syncing
- [x] Social provider sections surface a scrollable scrape log with line-by-line progress while capture is running
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
- [x] Facebook group settings show active group counts in the header, keep refresh with the bulk actions, and split scraped `Last active ...` text into its own smaller right-aligned column instead of mashing it into the group name
- [x] The redundant desktop header sync dropdown has been removed, leaving the sidebar source menus and provider settings as the canonical sync status and action surfaces
- [x] Desktop view chrome now routes through one shared top toolbar, so feed, reader, and Friends stop stacking separate bars on top of each other
- [x] Desktop top-toolbar controls now keep normal click behavior, but a full drag gesture from the wordmark, title area, or toolbar buttons repositions the native window the way a title bar should
- [x] The primary sidebar and right debug drawer now render as floating shell cards using the same glassy header treatment as the marketing navbar
- [x] Reader toolbar controls now lock to the live sidebar and thumbnail-rail widths, so the sidebar toggle, dual-column toggle, and back-to-list control stay aligned with the floating cards below them
- [x] Settings now use a shared polished dropdown treatment, and Appearance keeps the theme selector as one compact row instead of a descriptive mini card with live hover and focus previews across every theme
- [x] Settings use a stronger modal shadow plus a blur-only frosted backdrop, the backdrop temporarily clears while previewing themes so desktop and touch users can see the active page treatment underneath, and hover previews now blur between the previous and next theme before snapping back unless the user clicks
- [x] Appearance now exposes `Show read in grayscale`, and mark-read-on-scroll correctly normalizes mobile list offsets before deciding which rows have scrolled past
- [x] Desktop resize grips now live in the gaps between floating panels and use neutral hover feedback instead of a loud accent stripe
- [x] Friends and Map sit directly under `All` in the primary Sources sidebar so navigation order matches the product's main reading flow
- [x] Feeds sidebar status uses aggregate feed health, stays green when at least one followed feed is healthy, turns amber only when every followed feed is failing, and shows a spinner while RSS sync is actively running
- [x] Provider sync actions swap to an inline spinner while that specific provider is actively syncing
- [x] Provider health badges and section headers use specific state labels like `Cooling down`, `Paused`, `Reconnect required`, and `Sync issue` instead of generic attention copy
- [x] Settings > Feeds can filter to one needs-review bucket and bulk unsubscribe the currently shown set from a toolbar above the list, while each row still shows whether the feed looks likely dead or just failing
- [x] Settings > Saved now shows an overview dashboard with saved-volume charts and source mix, instead of listing every saved item inline
- [x] Desktop debug tooling now samples runtime memory, relay document size, relay client count, and content-fetcher queue depth so long-run RAM growth can be correlated without attaching Instruments first
- [x] Desktop diagnostics now also sample renderer JS heap and DOM node counts so overnight RAM growth can be split between native process pressure and WebView pressure
- [x] Native relay broadcasts now reuse shared document buffers and stop writing a full snapshot on every live document push, reducing clone pressure during heavy sync churn
- [x] Desktop worker state no longer ships the full `allItemIds` list or full Automerge binary back to the main thread on every mutation, and the content fetcher now bounds its failed-item cooldown cache instead of keeping an immortal set of every fetch miss
- [x] Background fetch now tracks in-flight items so unrelated document updates cannot enqueue duplicate fetch work while a URL is already being processed
- [x] Background fetch no longer rescans the entire visible feed on every document mutation, it only rescans when the document item count changes, which cuts repeated O(n) churn during read toggles and preference writes
- [x] Outbox retry bookkeeping now drops completed and terminally failed IDs instead of keeping a session-long retry map for every action it has ever seen
- [x] Removing RSS feeds now also drops their retained provider-health diagnostics instead of keeping dead feed histories in memory and storage forever
- [x] Desktop live UI state now caps preserved article text previews and fetches full preserved text on demand for the active reader item, instead of cloning entire article bodies through every feed-state update
- [x] Desktop persistence now appends Automerge incremental saves to the last snapshot and only compacts back to a fresh snapshot once incremental growth justifies it, instead of full-document reserialization on every mutation
- [x] Search now drops its MiniSearch index as soon as the query clears, rebuilds only when the worker says the searchable corpus changed, and indexes a smaller preserved-text window so one exploratory search cannot pin a second full-text copy of the library in renderer memory
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
> main thread on every state update. The background content fetcher now
> bounds and ages out its failed-item cooldown cache, and it keeps an
> in-flight set so unrelated state updates cannot queue the same fetch work
> over and over while a URL is already being processed. It also stopped
> rescanning the full visible feed on every tiny document mutation and now
> only rescans when the document item count actually changes. The outbox also
> prunes completed retry bookkeeping instead of letting that map grow across
> a long session, and removing RSS feeds now also forgets their saved health
> history instead of leaving dead diagnostics behind. Desktop feed-state
> updates also now cap preserved article text previews and fetch the full
> preserved text only for the reader item that is actually open, instead of
> cloning full article bodies through the live UI state on every mutation.
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
> stack by default.
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
> The updater endpoint now lives behind `freed.wtf/api/desktop-updates/{{target}}`,
> and Freed Desktop can switch locally between production releases from `main`
> and dev prereleases from `dev` without syncing that preference through the
> shared document.
> The public marketing site is controlled by the `www` branch. After any
> GitHub release is published, the workflow now redeploys `freed.wtf` from the
> current `www` branch so the changelog snapshot rebuilds against the newly
> published release instead of waiting for a later production ship. Production
> desktop tags still come from `main`, and production website deploys still
> require the reviewed website and changelog state to be merged into `www`
> first. Dev releases refresh the public changelog from current `www` without
> ever moving `www` to `dev`. See `RELEASE-SECRETS.md` for the full setup
> checklist.

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
