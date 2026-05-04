# Phase 6: PWA Reader

> **Status:** ✅ Complete (first-run legal gate shipped, public-safe bug reporting shipped, homescreen install flow shipped, offline article and image caching shipped, local reader cache modes shipped)
> **Dependencies:** Phase 4 (Sync Layer), Phase 5 (Desktop App)

---

## Overview

Mobile companion to Freed Desktop for on-the-go reading. Timeline-focused, minimal chrome, content-first design. This is the primary mobile distribution surface, and it now enforces a first-run legal gate before sync or update side effects begin.

**Key architectural decisions:**

- **Shared codebase** — Same React app embedded in Desktop WebView and deployed to [app.freed.wtf](https://app.freed.wtf), with the dev channel on `dev-app.freed.wtf`
- **Thin client** — Displays pre-computed rankings from Desktop/OpenClaw, minimal local computation
- **Light saves** — Can save URLs with metadata extraction (og tags); full article extraction requires Desktop
- **Offline-first:** Service worker caches feed data, saved reader HTML, and images for offline reading
- **Versioned first-run consent** — PWA startup is blocked until the current legal bundle is accepted locally in the browser
- **URL-driven navigation** — Active view, feed scope, and open reader state serialize into the URL so browser back and forward behave naturally
- **Desktop handoff in source settings** — PWA Settings exposes X / Twitter, Facebook, Instagram, and LinkedIn with clear Freed Desktop sync and download handoff states
- **Blank-state testing escape hatch** — PWA empty states now include a secondary sample-data section below the main handoff prompt for quick local testing
- **Archived saved-item repair control** — Archived views now surface a one-click `Unarchive Saved Content` action when legacy or imported items end up both saved and archived

---

## Design Philosophy

**Core Principles:**

1. **Timeline by default, unread tracking opt-in** — Ephemeral content flows by; important sources can track unread
2. **Unified content types** — RSS, videos, podcasts, social in one view
3. **Clean, minimal chrome** — Content-first design
4. **Seamless sync** — Automerge CRDT for cross-device

**Key Features:**

1. **Per-source unread tracking** — Enable for newsletters and priority sources, mark items read when they scroll past, and finish the list when you leave after reaching bottom
2. **Reading enhancements** — Focus mode, font options, theming
3. **Custom ranking** — User-controlled weights, not engagement
4. **Source filtering** — View by platform, author, or topic
5. **Compact feed actions** — Header-level like, comment, save, archive, and open affordances keep cards scannable on small screens

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
  options: FocusOptions
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
  platform: Platform | null
): FeedItem[] {
  if (!platform) return items;
  return items.filter((item) => item.platform === platform);
}

export function filterByAuthor(
  items: FeedItem[],
  authorId: string | null
): FeedItem[] {
  if (!authorId) return items;
  return items.filter((item) => item.author.id === authorId);
}
```

**Note:** Ranking algorithm runs on Desktop/OpenClaw (see Phase 5). PWA is a thin client that displays and filters.

---

## Tasks

| Task | Description                            | Complexity |
| ---- | -------------------------------------- | ---------- |
| 6.1  | Vite + React + Tailwind scaffold       | Low        |
| 6.2  | AppShell layout (sidebar + timeline)   | Medium     |
| 6.3  | Feed components (list, item, expanded) | Medium     |
| 6.4  | Virtual scrolling (1000+ items)        | Medium     |
| 6.5  | Focus mode text renderer               | Low        |
| 6.6  | Feed ranking algorithm                 | Medium     |
| 6.7  | Platform/author filters                | Low        |
| 6.8  | Settings panel                         | Medium     |
| 6.9  | RSS subscription management            | Medium     |
| 6.10 | Connect to sync layer                  | Medium     |
| 6.11 | PWA manifest + service worker          | Medium     |
| 6.12 | Offline support + image caching        | High       |
| 6.13 | Add to homescreen prompt               | Low        |
| 6.14 | First-run legal gate with local-only acceptance storage | Low |
| 6.15 | URL navigation state with browser back/forward support | Low |
| 6.16 | Public-safe and private bug report bundles | Medium |

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
- [x] Feed displays items from Automerge document
- [x] Per-source unread tracking works for opted-in feeds
- [x] Virtual scrolling handles 1000+ items smoothly
- [x] Reading enhancements work correctly (focus mode, font, reader view)
- [x] Ranking weights affect item order
- [x] Platform/author filters work (sidebar filter by platform/feed)
- [x] RSS source accordion pages subscriptions in the sidebar and top search moves matching feeds into the first page
- [x] RSS subscription management functional (add/remove/OPML import-export)
- [x] First launch is blocked behind a local-only legal clickwrap gate
- [x] Active view, feed filters, and reader selection round-trip through the URL for browser back/forward navigation
- [x] Settings and crash recovery surfaces can export public-safe bug report bundles
- [x] Bug report actions now label whether they download a public-safe or private bundle, and private diagnostics can be toggled as one group before emailing a report
- [x] PWA Settings surfaces X / Twitter, Facebook, Instagram, and LinkedIn with Freed Desktop sync and download handoff states
- [x] Theme changes in Settings temporarily clear the frosted backdrop on touch devices so the active page treatment stays visible while previewing themes
- [x] Mobile Settings now open as a full-height sheet with a persistent close button, larger back target, and reliable section jumps instead of snapping back to the last scrolled provider section
- [x] Shared Settings list panels keep RSS management and OPML previews inside filtered inner scrollers capped to the Settings sheet height
- [x] Appearance exposes `Show read in grayscale`, and mark-read-on-scroll now subtracts the feed list offset before marking mobile rows as passed
- [x] The shared floating mobile sidebar now behaves like a real toggle, so the same hamburger button opens and closes it cleanly
- [x] Private diagnostics stay opt-in and are clearly separated from public GitHub sharing
- [x] PWA installable on mobile (add to homescreen) — manifest ids and scope set, browser install notice shipped, iOS Safari homescreen guidance shipped, Playwright coverage added
- [x] Offline access works (service worker + image cache), article HTML and cacheable reader images are warmed locally for offline reading
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
