# Phase 3: Save for Later (`capture-save`)

> **Status:** Current  
> **Dependencies:** Phase 1-2 (Capture layers)
>
> Save for Later is functional across desktop and PWA. Desktop has full article
> extraction, local HTML caching, Markdown import/export, background fetch
> healing, user-visible AI controls, and hierarchical tag navigation. The PWA
> now attempts full article capture through a server fetch proxy and falls back
> to a sync-healed stub when a site blocks extraction or exceeds limits.

---

## Overview

Phase 3 covers manually saved URLs and the reader flow around them. The core
architecture is now:

1. Save a URL from desktop or PWA.
2. Extract metadata plus article content with Readability-safe browser parsing.
3. Keep full HTML in a device-local cache, never in Automerge.
4. Sync compact preserved text through Automerge for cross-device fallback.
5. Render reader content through a layered waterfall:
   1. Local cached HTML
   2. Synced preserved text
   3. Live fetch on open

---

## Shipped Behavior

### Save Flow

- **Desktop:** fetches raw HTML through Tauri, extracts readable content, caches
  article HTML locally, and writes a sync-safe saved item to Automerge.
- **PWA:** posts the URL to a same-origin server fetch proxy, extracts readable
  content in the browser, caches article HTML in the Cache API, and writes a
  full saved item to Automerge.
- **PWA fallback:** when proxy fetch or extraction fails, the app writes a stub
  saved item so desktop sync can heal it later.

### Reader And Cache Layers

- **Layer 1:** device-local HTML cache
  - Desktop uses Tauri FS
  - PWA uses the Cache API
- **Layer 2:** synced `preservedContent.text`
- **Layer 3:** live fetch on open when online

### Library Management

- Freed Markdown import and export are implemented.
- Imported folder paths become hierarchical tags.
- Sidebar tag navigation supports parent and child tag filtering.

### AI Summaries

- Desktop background fetch can summarize newly cached saved articles.
- The AI settings section is available in Settings.
- Topic extraction now respects the `extractTopics` toggle instead of always
  writing topics whenever summarization succeeds.

---

## Tasks

| Task | Description | Status | Notes |
| ---- | ----------- | ------ | ----- |
| 3.1 | Create `@freed/capture-save` package scaffold | ✓ Complete | Package exists in `packages/capture-save/` |
| 3.2 | Implement browser-safe metadata and article extraction | ✓ Complete | Shared browser parser used by desktop and PWA |
| 3.3 | Implement desktop full save flow with local HTML cache | ✓ Complete | Uses Tauri `fetch_url` + FS cache |
| 3.4 | Implement PWA full save flow with fallback stub mode | ✓ Complete | Uses `/api/fetch-url` plus Cache API |
| 3.5 | Layered reader fallback for offline reading | ✓ Complete | Cache → preserved text → live fetch |
| 3.6 | Hierarchical tag navigation | ✓ Complete | Sidebar tag tree is live |
| 3.7 | Freed Markdown import/export | ✓ Complete | Import, export, and background fetch healing shipped |
| 3.8 | User-facing AI summarization controls | ✓ Complete | Settings UI is live, desktop-only key storage stays local |
| 3.9 | Broader mobile validation across hostile sites | ☐ Ongoing | Fallback stub mode remains intentional for blocked or oversized pages |

---

## Current Constraints

- The PWA fetch proxy only accepts `http` and `https` URLs.
- Oversized articles are rejected server-side and fall back to stub mode.
- AI summarization still runs on desktop because API key storage is device-local
  there.
- Phase 3 remains marked `Current` until broader mobile validation is complete,
  even though the missing core implementation gaps are now closed.
