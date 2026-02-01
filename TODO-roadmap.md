# FREED Master Roadmap

> **Last Updated:** 2026-01-30  
> **Status:** Planning  
> **Philosophy:** "Their algorithms optimize for profit. Optimize yours for life."

---

## Vision

Capture social media and RSS locally. Tune the feel algo yourself. Sync across devices. No cloud, no tracking, no algorithmic manipulation.

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CAPTURE LAYER                               │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                 API-BASED CAPTURE (Background)                  │  │
│  │  ┌──────────────┐                                               │  │
│  │  │  capture-x   │  X/Twitter GraphQL APIs                       │  │
│  │  │              │  • HomeLatestTimeline (chronological feed)    │  │
│  │  │              │  • Session cookie auth                        │  │
│  │  └──────────────┘                                               │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                 RSS-BASED CAPTURE (Universal)                   │  │
│  │  ┌──────────────┐  Blogs, newsletters, video, podcasts, social  │  │
│  │  │ capture-rss  │  • Medium     • Substack    • Ghost           │  │
│  │  │              │  • YouTube    • Podcasts    • Reddit          │  │
│  │  │              │  • GitHub     • Mastodon    • Bluesky         │  │
│  │  │              │  • Personal blogs & any RSS/Atom feed         │  │
│  │  └──────────────┘                                               │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                 DOM-BASED CAPTURE (Future/Fallback)             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │  │
│  │  │   Facebook   │  │  Instagram   │  │   LinkedIn   │           │  │
│  │  │  (Very Hard) │  │    (Hard)    │  │   (Future)   │           │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘           │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│                                 │                                     │
│                                 ▼                                     │
│            ┌─────────────────────────────────────────┐                │
│            │     @freed/shared (FeedItem Schema)     │                │
│            └──────────────────┬──────────────────────┘                │
│                               │                                       │
│                               ▼                                       │
│            ┌─────────────────────────────────────────┐                │
│            │        Automerge CRDT Document          │                │
│            └──────────────────┬──────────────────────┘                │
└───────────────────────────────┼───────────────────────────────────────┘
                                │
┌───────────────────────────────┼───────────────────────────────────────┐
│                          SYNC LAYER                                   │
│                               │                                       │
│            ┌──────────────────┴──────────────────────┐                │
│            │            automerge-repo               │                │
│            │  • WebRTC (LAN peer-to-peer)            │                │
│            │  • Cloud backup (encrypted)             │                │
│            │  • Optional relay server                │                │
│            └──────────────────┬──────────────────────┘                │
└───────────────────────────────┼───────────────────────────────────────┘
                                │
┌───────────────────────────────┼───────────────────────────────────────┐
│                         READER LAYER                                  │
│                               │                                       │
│          ┌────────────────────┴─────────────────────┐                 │
│          ▼                                          ▼                 │
│  ┌─────────────────┐                    ┌─────────────────┐           │
│  │   Desktop PWA   │                    │    Phone PWA    │           │
│  │ (freed.wtf/app) │                    │ (same codebase) │           │
│  │ • Unified feed   │                    │ • Mobile-first   │           │
│  │ • Friend map    │                    │ • Offline        │           │
│  │ • Settings      │                    │ • Add to home   │           │
│  └─────────────────┘                    └─────────────────┘           │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │               Browser Extension (Supplemental)                  │  │
│  │  • Ulysses mode (block platform feeds)                          │  │
│  │  • New tab integration (optional)                               │  │
│  │  • DOM capture fallback when APIs fail                          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │               Tauri Native App (Future)                         │  │
│  │  • Push notifications • Background sync                          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

---

## RSS Integration

RSS readers exist. What's novel here:

1. **Unified ranking** - A friend's tweet, their blog post, and a YouTube video all appear in one feed, weighted by _your_ preferences—not segregated into separate apps
2. **No cloud service** - Unlike Feedly/Inoreader, everything runs locally via OpenClaw
3. **Same data model** - RSS items normalize to `FeedItem` just like social posts, enabling cross-source search and filtering

OPML import supported for migrating existing subscriptions.

---

## Capture Sources Reference

### Tier 1: Launch (Phase 2)

| Source             | Method           | Skill         | Difficulty | Notes                                       |
| ------------------ | ---------------- | ------------- | ---------- | ------------------------------------------- |
| **X/Twitter**      | GraphQL API      | `capture-x`   | Hard       | Background polling via `HomeLatestTimeline` |
| **RSS/Atom**       | Standard parsing | `capture-rss` | Easy       | Universal, covers hundreds of sources       |
| **Medium**         | RSS              | `capture-rss` | Easy       | `medium.com/feed/@username`                 |
| **Substack**       | RSS              | `capture-rss` | Easy       | `*.substack.com/feed`                       |
| **YouTube**        | RSS              | `capture-rss` | Easy       | Channel RSS feeds                           |
| **Podcasts**       | RSS              | `capture-rss` | Easy       | Native format                               |
| **Personal Blogs** | RSS              | `capture-rss` | Easy       | WordPress, Ghost, Jekyll, Hugo, etc.        |

### Tier 2: Federated Social (Phase 2+)

| Source          | Method          | Skill         | Difficulty | Notes                                      |
| --------------- | --------------- | ------------- | ---------- | ------------------------------------------ |
| **Mastodon**    | RSS             | `capture-rss` | Easy       | `instance/@user.rss`                       |
| **Bluesky**     | RSS/AT Protocol | `capture-rss` | Medium     | RSS available, AT Protocol for richer data |
| **Reddit**      | RSS             | `capture-rss` | Easy       | `/r/subreddit/.rss`, `/user/name/.rss`     |
| **Hacker News** | RSS             | `capture-rss` | Easy       | Algolia RSS feeds                          |
| **GitHub**      | Atom            | `capture-rss` | Easy       | Releases, commits, issues                  |

### Save for Later (Phase 4.5)

| Feature               | Description                                   |
| --------------------- | --------------------------------------------- |
| **Browser Extension** | One-click save from any page                  |
| **Share Sheet**       | Save from mobile via system share             |
| **Manual URL Entry**  | Paste URL directly in app                     |
| **Reader View**       | Preserved article content for offline reading |
| **Normalize to Feed** | Outputs `FeedItem` with `platform: "saved"`   |

> **Note:** Tags, highlights, and archive are unified across all `FeedItem` types—not specific to saved items.

### Tier 3: Walled Gardens (Phase 7+)

| Source        | Method       | Skill               | Difficulty | Notes                              |
| ------------- | ------------ | ------------------- | ---------- | ---------------------------------- |
| **Facebook**  | DOM scraping | `capture-facebook`  | Very Hard  | Content script, obfuscated classes |
| **Instagram** | DOM scraping | `capture-instagram` | Hard       | Stories, posts, reels              |
| **LinkedIn**  | DOM scraping | `capture-linkedin`  | Hard       | Future consideration               |
| **TikTok**    | Unknown      | TBD                 | Very Hard  | May not be feasible                |

### Tier 4: Future Consideration

| Source                | Method       | Notes                               |
| --------------------- | ------------ | ----------------------------------- |
| **Threads**           | RSS? API?    | Meta platform, approach TBD         |
| **Discord**           | Bot/webhook? | Server-specific, different use case |
| **Slack**             | Webhook?     | Workspace-specific                  |
| **Email newsletters** | IMAP?        | Would require email access          |

### DOM Capture Reference (Browser Extension Fallback)

When API-based capture fails, fall back to DOM scraping via content scripts:

**X/Twitter** (Hard - frequent DOM changes):

```javascript
'article[data-testid="tweet"]'; // Tweet container
'[data-testid="User-Name"]'; // Author info
'[data-testid="tweetText"]'; // Tweet text
```

**Facebook** (Very Hard - obfuscated classes):

```javascript
'[role="feed"]'; // Feed container
'[role="article"]'; // Individual posts
// Navigate via structural position, not class names
```

**Instagram** (Hard - SPA):

```javascript
// Main feed articles, media via img/video tags
// Author info in post header
```

Use MutationObserver on feed containers. These selectors require ongoing maintenance.

---

## Tech Stack

| Layer         | Technology             | Notes                          |
| ------------- | ---------------------- | ------------------------------ |
| **Language**  | TypeScript             | Throughout all packages        |
| **Runtime**   | Bun                    | Package management, scripts    |
| **Build**     | Vite                   | All projects                   |
| **Monorepo**  | Bun workspaces         | `packages/` and `skills/`      |
| **Storage**   | Automerge CRDT         | Conflict-free sync             |
| **Sync**      | automerge-repo         | WebRTC + cloud backup          |
| **PWA**       | React 18 + Tailwind v4 | Mobile-first                   |
| **Extension** | Chrome MV3 + CRXJS     | Ulysses mode, fallback capture |
| **Maps**      | MapLibre GL JS         | Friend map feature             |
| **Capture**   | OpenClaw skills        | Background operation           |

---

## Data Model

```typescript
interface FeedItem {
  globalId: string; // "x:123" or "rss:https://..." or "youtube:VIDEO_ID"
  platform:
    | "x" // X/Twitter
    | "rss" // Generic RSS/Atom
    | "youtube" // YouTube (via RSS)
    | "reddit" // Reddit (via RSS)
    | "mastodon" // Mastodon (via RSS)
    | "github" // GitHub (via Atom)
    | "facebook" // Facebook (DOM capture)
    | "instagram" // Instagram (DOM capture)
    | "linkedin"; // LinkedIn (DOM capture, future)
  contentType: "post" | "story" | "article" | "video" | "podcast";
  capturedAt: number;
  publishedAt: number;

  author: {
    id: string;
    handle: string;
    displayName: string;
    avatarUrl?: string;
  };

  content: {
    text?: string;
    mediaUrls: string[];
    mediaTypes: ("image" | "video" | "link")[];
    linkPreview?: {
      url: string;
      title?: string;
      description?: string;
    };
  };

  // Captured for user-controlled ranking, hidden by default in UI
  engagement?: {
    likes?: number;
    reposts?: number;
    comments?: number;
    views?: number;
  };

  location?: {
    name: string;
    coordinates?: { lat: number; lng: number };
    source: "geo_tag" | "check_in" | "sticker" | "text_extraction";
  };

  // RSS-specific
  rssSource?: {
    feedUrl: string;
    feedTitle: string;
    siteUrl: string;
  };

  userState: {
    hidden: boolean;
    bookmarked: boolean;
    readAt?: number;
  };

  topics: string[];
}

interface UserPreferences {
  weights: {
    recency: number;
    platforms: Record<string, number>;
    topics: Record<string, number>;
    authors: Record<string, number>;
  };

  ulysses: {
    enabled: boolean;
    blockedPlatforms: string[];
    allowedPaths: Record<string, string[]>;
  };

  sync: {
    cloudProvider?: "gdrive" | "icloud" | "dropbox";
    autoBackup: boolean;
  };

  display: {
    itemsPerPage: number;
    compactMode: boolean;
    showEngagementCounts: boolean; // Default: false - opt-in only
  };
}
```

---

## Project Structure

```
freed/
├── packages/
│   ├── shared/                  # @freed/shared
│   │   ├── src/
│   │   │   ├── types.ts         # FeedItem, UserPreferences
│   │   │   ├── schema.ts        # Automerge document schema
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── capture-x/               # @freed/capture-x
│   │   ├── src/
│   │   │   ├── client.ts        # X GraphQL client
│   │   │   ├── endpoints.ts     # API definitions
│   │   │   ├── auth.ts          # Cookie extraction
│   │   │   └── normalize.ts     # Tweet -> FeedItem
│   │   └── package.json
│   │
│   ├── capture-rss/             # @freed/capture-rss
│   │   ├── src/
│   │   │   ├── parser.ts        # RSS/Atom parsing
│   │   │   ├── opml.ts          # OPML import
│   │   │   ├── discovery.ts     # Feed URL discovery
│   │   │   └── normalize.ts     # RSS item -> FeedItem
│   │   └── package.json
│   │
│   ├── pwa/                     # Feed reader PWA
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── views/
│   │   │   └── App.tsx
│   │   └── package.json
│   │
│   └── extension/               # Browser extension (Ulysses + fallback)
│       ├── src/
│       │   ├── content-scripts/
│       │   ├── background/
│       │   └── newtab/
│       ├── manifest.json
│       └── package.json
│
├── skills/                      # OpenClaw skills
│   ├── capture-x/
│   │   ├── SKILL.md
│   │   └── src/index.ts
│   └── capture-rss/
│       ├── SKILL.md
│       └── src/index.ts
│
├── website/                     # Marketing site (freed.wtf) ✓
├── workers/                     # Cloudflare Workers ✓
├── docs/                        # Documentation ✓
├── package.json                 # Bun workspaces root
└── TODO-roadmap.md              # This file
```

---

## Roadmap

### Phase 0: Marketing Site ✓

**Status:** Complete

- [x] freed.wtf landing page
- [x] Manifesto page
- [x] Glowmorphic design system
- [x] GitHub Pages deployment
- [ ] OG images for social sharing
- [ ] Final copy polish

---

### Phase 1: Foundation

**Status:** Complete ✓

- [x] Bun monorepo setup with workspaces
- [x] `@freed/shared` package with types
- [x] Automerge document schema
- [x] Basic project scaffolding
- [x] CI/CD pipeline

**Deliverable:** Empty monorepo with shared types, ready for capture packages.

---

### Phase 2: Capture Skills (Parallel)

**Status:** Complete ✓

#### 2a: X Capture (`capture-x`)

- [x] X GraphQL client implementation
- [x] `HomeLatestTimeline` endpoint (chronological feed)
- [x] Cookie extraction from browser profiles
- [x] Tweet -> FeedItem normalization
- [x] OpenClaw skill wrapper (`skills/capture-x/`)
- [x] Rate limiting and error handling

#### 2b: RSS Capture (`capture-rss`)

- [x] RSS/Atom parser integration
- [x] OPML import
- [x] Feed URL discovery helper
- [x] RSS item -> FeedItem normalization
- [x] OpenClaw skill wrapper (`skills/capture-rss/`)
- [x] Conditional GET (If-Modified-Since, ETag)

**Deliverable:** Two OpenClaw skills that capture content to local Automerge documents.

---

### Phase 3: Save for Later (`capture-save`)

**Status:** Not Started

Independent capture layer for manually saved URLs (like capture-x and capture-rss).

- [ ] `@freed/capture-save` package scaffold
- [ ] URL metadata extraction (title, description, image)
- [ ] Article content extraction (Readability-style parser)
- [ ] Reader view generation (preserved HTML/text)
- [ ] Normalize to `FeedItem` with `platform: "saved"`
- [ ] OpenClaw skill wrapper (`skills/capture-save/`)
- [ ] CLI: `capture-save add <url>`

**Deliverable:** `@freed/capture-save` package and skill for saving any URL.

**Detailed Plan:** [docs/PHASE-3-SAVE-FOR-LATER.md](docs/PHASE-3-SAVE-FOR-LATER.md)

---

### Phase 4: Sync Layer

**Status:** Not Started

**Architecture:** OpenClaw local relay + cloud backup. No external servers.

- [ ] automerge-repo integration
- [ ] IndexedDB storage adapter (browser)
- [ ] Filesystem storage adapter (OpenClaw/Node)
- [ ] **OpenClaw local WebSocket relay** (instant sync on home network)
- [ ] QR code / manual pairing for PWA ↔ OpenClaw
- [ ] Cloud sync to Google Drive / iCloud / Dropbox (user's account)
- [ ] Sync status indicators ("Local" / "Cloud" / "Offline")

**Deliverable:** Instant sync at home via OpenClaw, cloud sync when away. Zero external infrastructure.

**Detailed Plan:** [docs/PHASE-4-SYNC.md](docs/PHASE-4-SYNC.md)

---

### Phase 5: Desktop App (Tauri)

**Status:** Not Started

**🎯 HIGHEST PRIORITY** — The universal liberation tool. Anyone can install this and escape algorithmic manipulation without technical setup.

**Architecture:**

```
┌─────────────────────────────────────────────────────────────────┐
│                      FREED Desktop (Tauri)                      │
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

**UI Design:** Three-column layout, dark theme, native vibrancy

| Element           | Implementation                                   |
| ----------------- | ------------------------------------------------ |
| Window background | Tauri `vibrancy: "under-window"` (native blur)   |
| Sidebar           | Translucent, CSS `backdrop-filter` on dark base  |
| Buttons           | CSS glass approximation (Phase 1), SwiftUI later |
| Cards             | Dark cards with subtle borders, content-first    |
| Reader pane       | Clean typography, large hero images              |

**Design Tokens:**

```css
/* Dark glass theme */
--bg-primary: rgba(18, 18, 18, 0.85);
--bg-sidebar: rgba(28, 28, 30, 0.7);
--bg-card: rgba(44, 44, 46, 0.9);
--border-glass: rgba(255, 255, 255, 0.08);
--text-primary: rgba(255, 255, 255, 0.92);
--text-secondary: rgba(255, 255, 255, 0.55);
--accent: #ff6b35; /* FREED orange */
```

**Tasks:**

- [ ] Tauri 2.0 project scaffold (`packages/desktop/`)
- [ ] Embed PWA React app in WebView
- [ ] Native window vibrancy (macOS)
- [ ] Menu bar icon + background mode
- [ ] Local WebSocket relay (for phone sync)
- [ ] Playwright subprocess for DOM capture
- [ ] System tray with sync status
- [ ] QR code display for phone pairing
- [ ] Auto-launch on login (optional)
- [ ] macOS notarization + DMG packaging
- [ ] Windows installer (later)

**Deliverable:** Native desktop app with capture, sync, and reader UI. No CLI required.

**Detailed Plan:** [docs/PHASE-5-DESKTOP.md](docs/PHASE-5-DESKTOP.md)

---

### Phase 6: PWA Reader

**Status:** Not Started

Mobile companion to the Desktop App—for on-the-go reading.

**Design:** Timeline-focused, minimal chrome, content-first

- [ ] React + Tailwind + Framer Motion setup
- [ ] AppShell layout (sidebar + timeline)
- [ ] Unified feed view with ranking algorithm
- [ ] Per-source unread tracking (opt-in for newsletters, priority sources)
- [ ] Reading enhancements (focus mode, font options)
- [ ] Virtual scrolling for large feeds
- [ ] Feed settings (weights, filters)
- [ ] RSS subscription management
- [ ] Mobile-first responsive design
- [ ] Offline support (Workbox service worker)
- [ ] Add to homescreen prompt

**Deliverable:** Mobile-friendly PWA at freed.wtf/app.

**Detailed Plan:** [docs/PHASE-6-PWA.md](docs/PHASE-6-PWA.md)

---

### Phase 7: Facebook + Instagram Capture

**Status:** Not Started

**Requires:** Phase 5 Desktop App (Playwright for DOM scraping)

- [ ] `@freed/capture-facebook` package
- [ ] `@freed/capture-instagram` package
- [ ] DOM selectors for feed parsing
- [ ] Session/cookie management
- [ ] Stories capture
- [ ] Rate limiting to avoid bans
- [ ] Selector maintenance strategy (they change often)

**Note:** DOM scraping is fragile. These platforms actively fight scrapers. Most location data for Friend Map comes from here.

**Detailed Plan:** [docs/PHASE-7-SOCIAL-CAPTURE.md](docs/PHASE-7-SOCIAL-CAPTURE.md)

---

### Phase 8: Location & Friend Map

**Status:** Not Started

**Requires:** Phase 7 (Instagram provides most geo-tagged content)

- [ ] Location extraction from geo-tags
- [ ] Location extraction from text patterns
- [ ] Nominatim geocoding integration
- [ ] Geocoding cache layer
- [ ] MapLibre GL JS integration
- [ ] Friend map UI with recency indicators

**Deliverable:** Friend Map view showing where friends have posted from.

**Detailed Plan:** [docs/PHASE-8-FRIEND-MAP.md](docs/PHASE-8-FRIEND-MAP.md)

---

### Phase 9: Browser Extension

**Status:** Not Started

Supplement to Desktop App—quick saves and Ulysses mode.

- [ ] Chrome MV3 extension scaffold
- [ ] **One-click save** (integrates with `capture-save`)
- [ ] Ulysses mode (feed blocking overlay)
- [ ] Allowed paths configuration
- [ ] Optional new tab page integration
- [ ] DOM capture fallback (when Desktop App not running)
- [ ] Sync with Desktop/PWA via shared Automerge doc

**Deliverable:** Extension with save button and Ulysses mode.

**Detailed Plan:** [docs/PHASE-9-BROWSER-EXTENSION.md](docs/PHASE-9-BROWSER-EXTENSION.md)

---

### Phase 10: Polish + OpenClaw Enhancements

**Status:** Future

- [ ] Onboarding wizard
- [ ] Statistics dashboard
- [ ] Export functionality (JSON, CSV)
- [ ] Keyboard shortcuts
- [ ] Performance optimization
- [ ] Accessibility audit
- [ ] Native Liquid Glass buttons (SwiftUI, macOS only)
- [ ] OpenClaw skill improvements (advanced automation for power users)

**Detailed Plan:** [docs/PHASE-10-POLISH.md](docs/PHASE-10-POLISH.md)

---

## Key Decisions

1. **OpenClaw over custom daemon** - Leverage existing agent infrastructure for background capture
2. **Automerge over Dexie.js** - CRDT enables conflict-free multi-device sync
3. **PWA over new tab page** - Mobile access is primary use case
4. **X first, then RSS** - Build in parallel; X proves harder capture, RSS proves the pipeline
5. **`capture-` prefix** - Consistent naming for all capture packages
6. **Browser extension as supplement** - Ulysses mode + DOM fallback, not primary capture
7. **Zero external infrastructure** - OpenClaw local relay + user's cloud storage, no servers we operate
8. **Tauri for Desktop App** - Smaller binary than Electron, native vibrancy, Swift plugin potential
9. **System Chrome for DOM scraping** - Playwright `channel: 'chrome'` avoids bundling browsers
10. **Tiered accessibility** - PWA-only → Desktop App → OpenClaw (increasing capability/complexity)

---

## Risks & Mitigations

| Risk                                  | Mitigation                                       |
| ------------------------------------- | ------------------------------------------------ |
| X API changes break capture           | Community tracks changes; abstract API layer     |
| Cookie access blocked by browsers     | Document manual export flow as fallback          |
| Rate limiting on X                    | Exponential backoff, user-configurable intervals |
| Automerge doc grows too large         | Prune old items, archive by time range           |
| Facebook/Instagram too hard to scrape | Accept as lower priority; focus on X + RSS value |

---

## Resources

- [OpenClaw Skills Documentation](https://docs.clawd.bot/tools/skills-config)
- [Automerge](https://automerge.org/)
- [automerge-repo](https://github.com/automerge/automerge-repo)
- [X API Community Research](https://github.com/fa0311/TwitterInternalAPIDocument)

---

_Built for humans, not engagement metrics._
