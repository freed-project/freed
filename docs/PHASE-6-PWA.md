# Phase 6: PWA Reader

> **Status:** Not Started  
> **Dependencies:** Phase 4 (Sync Layer), Phase 5 (Desktop App)

---

## Overview

Mobile companion to the Desktop App—for on-the-go reading. Timeline-focused, minimal chrome, content-first design.

---

## Design Philosophy

**Core Principles:**

1. **Timeline by default, unread tracking opt-in** — Ephemeral content flows by; important sources can track unread
2. **Unified content types** — RSS, videos, podcasts, social in one view
3. **Clean, minimal chrome** — Content-first design
4. **Seamless sync** — Automerge CRDT for cross-device

**Key Features:**

1. **Per-source unread tracking** — Enable for newsletters and priority sources
2. **Reading enhancements** — Focus mode, font options, theming
3. **Custom ranking** — User-controlled weights, not engagement
4. **Source filtering** — View by platform, author, or topic

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

export function applyFocusMode(text: string, options: FocusOptions): TextSegment[] {
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

## Feed Ranking

```typescript
// packages/pwa/src/lib/ranking.ts
export function rankFeedItems(
  items: FeedItem[],
  preferences: UserPreferences
): FeedItem[] {
  const { weights } = preferences;
  
  return items
    .map(item => ({ item, score: calculateScore(item, weights) }))
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

function calculateScore(item: FeedItem, weights: UserPreferences["weights"]): number {
  let score = 0;
  
  // Recency (decays over time)
  const ageHours = (Date.now() - item.publishedAt) / (1000 * 60 * 60);
  score += Math.max(0, 100 - ageHours * 2) * (weights.recency / 100);
  
  // Platform weight
  score += (weights.platforms[item.platform] ?? 50) * 0.3;
  
  // Author weight
  score += (weights.authors[item.author.id] ?? 50) * 0.3;
  
  // Topic weights
  for (const topic of item.topics) {
    score += (weights.topics[topic] ?? 50) * 0.1;
  }
  
  return score;
}
```

---

## Tasks

| Task | Description | Complexity |
|------|-------------|------------|
| 6.1 | Vite + React + Tailwind scaffold | Low |
| 6.2 | AppShell layout (sidebar + timeline) | Medium |
| 6.3 | Feed components (list, item, expanded) | Medium |
| 6.4 | Virtual scrolling (1000+ items) | Medium |
| 6.5 | Focus mode text renderer | Low |
| 6.6 | Feed ranking algorithm | Medium |
| 6.7 | Platform/author filters | Low |
| 6.8 | Settings panel | Medium |
| 6.9 | RSS subscription management | Medium |
| 6.10 | Connect to sync layer | Medium |
| 6.11 | PWA manifest + service worker | Medium |
| 6.12 | Offline support + image caching | High |
| 6.13 | Add to homescreen prompt | Low |

---

## Success Criteria

- [ ] PWA loads at freed.wtf/app
- [ ] Feed displays items from Automerge document
- [ ] Per-source unread tracking works for opted-in feeds
- [ ] Virtual scrolling handles 1000+ items smoothly
- [ ] Reading enhancements work correctly
- [ ] Ranking weights affect item order
- [ ] Platform/author filters work
- [ ] RSS subscription management functional
- [ ] PWA installable on mobile (add to homescreen)
- [ ] Offline access works (service worker + image cache)

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

Mobile-friendly PWA at freed.wtf/app with offline support.
