# Phase 7: Facebook + Instagram Capture

> **Status:** 🚧 In Progress — Facebook and Instagram integrated into Desktop via Tauri WebView scraping
> **Dependencies:** Phase 5 (Desktop App)

---

## Overview

DOM scraping for Facebook and Instagram feeds using Tauri's native WebView (WKWebView on macOS). Instead of Playwright, posts are captured by injecting extraction scripts into the same WebView that handles authentication, making the traffic indistinguishable from normal browsing.

**Note:** DOM scraping is inherently fragile. These platforms actively fight scrapers and frequently change their DOM structure. This is lower priority than X + RSS.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Desktop App (Tauri)                        │
│                                                                  │
│  ┌────────────────────┐  ┌────────────────────┐                 │
│  │   FB WebView        │  │   IG WebView        │                │
│  │   (fb-scraper)      │  │   (ig-scraper)      │                │
│  │                     │  │                     │                │
│  │  Login: visible     │  │  Login: visible     │                │
│  │  Scrape: hidden,    │  │  Scrape: hidden,    │                │
│  │  injects extract.js │  │  injects extract.js │                │
│  │  emits fb-feed-data │  │  emits ig-feed-data │                │
│  └──────────┬──────────┘  └──────────┬──────────┘                │
│             │                        │                           │
│             └────────────┬───────────┘                           │
│                          ▼                                       │
│                ┌──────────────────┐                              │
│                │  Normalize to    │                              │
│                │  FeedItem[]      │                              │
│                └──────────────────┘                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

```
packages/capture-facebook/
├── src/
│   ├── index.ts          # Playwright-based entry (not used by desktop)
│   ├── browser.ts        # Browser-safe re-exports (types, normalize, selectors)
│   ├── scraper.ts        # DOM scraping logic (Playwright)
│   ├── selectors.ts      # CSS selectors (frequently updated)
│   ├── normalize.ts      # FB post -> FeedItem
│   ├── mbasic-parser.ts  # mbasic.facebook.com HTML parser
│   ├── rate-limit.ts     # Rate limiting state machine
│   └── types.ts          # FB-specific types
├── package.json
└── tsconfig.json

packages/capture-instagram/
├── src/
│   ├── index.ts          # Playwright-based entry (not used by desktop)
│   ├── browser.ts        # Browser-safe re-exports (types, normalize, selectors)
│   ├── scraper.ts        # DOM scraping logic (Playwright)
│   ├── selectors.ts      # CSS selectors
│   ├── normalize.ts      # IG post -> FeedItem
│   ├── rate-limit.ts     # Rate limiting state machine
│   └── types.ts          # IG-specific types
├── package.json
└── tsconfig.json
```

---

## Desktop Integration (Tauri WebView)

### Authentication

Both Facebook and Instagram use the same pattern:

1. `*_show_login` opens a visible WebView to the platform's login page
2. User authenticates through the real login flow (2FA, CAPTCHA, etc.)
3. `on_navigation` handler detects redirect away from login page
4. WebView is hidden and `*-auth-result` event is emitted
5. Cookies persist in the WebView for future scraping sessions

### Feed Scraping

1. `*_scrape_feed` creates/shows a WebView navigated to the platform's feed
2. Waits for page load with randomized jitter (12-16s)
3. Injects extraction script (`fb-extract.js` / `ig-extract.js`) at multiple scroll positions
4. Script reads visible posts from the DOM and emits them via Tauri event IPC
5. Frontend normalizes raw posts to `FeedItem[]` using `@freed/capture-*/browser`

### Extraction Scripts

Self-contained JavaScript injected into the WebView's execution context. No external dependencies. Each platform has its own script tuned to its DOM structure:

- **Facebook** (`fb-extract.js`): Locates "Feed posts" h3, walks subtrees for post-sized blocks
- **Instagram** (`ig-extract.js`): Queries `<article>` elements, extracts author/caption/media from semantic header/footer structure

---

## Rate Limiting

```typescript
const RATE_LIMITS = {
  facebook: {
    minInterval: 20 * 60 * 1000,  // 20 minutes between scrapes
    maxPostsPerScrape: 50,
  },
  instagram: {
    minInterval: 20 * 60 * 1000,  // 20 minutes between scrapes
    maxPostsPerScrape: 50,
    cooldownOnError: 60 * 60 * 1000,  // 1 hour cooldown if blocked
  },
};
```

---

## Tasks

| Task | Description                                 | Status      |
| ---- | ------------------------------------------- | ----------- |
| 7.1  | `@freed/capture-facebook` package scaffold  | ✓ Complete  |
| 7.2  | `@freed/capture-instagram` package scaffold | ✓ Complete  |
| 7.3  | Facebook DOM selectors                      | ✓ Complete  |
| 7.4  | Instagram DOM selectors                     | ✓ Complete  |
| 7.5  | Facebook feed scraping (WebView)            | ✓ Complete  |
| 7.6  | Instagram feed scraping (WebView)           | ✓ Complete  |
| 7.7  | WebView-based authentication                | ✓ Complete  |
| 7.8  | Rate limiting to avoid bans                 | ✓ Complete  |
| 7.9  | Selector versioning strategy                | ✓ Complete  |
| 7.10 | Location extraction (for Phase 8)           | ✓ Complete  |
| 7.11 | Stories capture                             | Deferred    |
| 7.12 | Social engagement write-back (like, seen)   | ✓ Complete  |
| 7.13 | Outbox processor for cross-device sync      | ✓ Complete  |
| 7.14 | Comment links (open on platform)            | ✓ Complete  |

---

## Success Criteria

- [x] `@freed/capture-facebook` package with full scraper, normalizer, and rate limiting
- [x] `@freed/capture-instagram` package with full scraper, normalizer, and rate limiting
- [x] Location data extracted from Facebook check-ins and Instagram location tags
- [x] Rate limiting prevents account bans (20m minimum between scrapes)
- [x] Selector versioning strategy implemented (SELECTOR_VERSION constant)
- [x] Facebook feed integrated into Desktop via Tauri WebView scraping
- [x] Instagram feed integrated into Desktop via Tauri WebView scraping
- [x] Both platforms integrated into Desktop refreshAllFeeds()
- [x] Settings UI for both platforms (login, check connection, sync, disconnect)
- [x] Empty states for both platforms in the feed view
- [x] Source indicators in sidebar for both platforms
- [x] Sync indicator panel shows both platforms
- [ ] Facebook feed posts validated against real account (selector tuning)
- [ ] Instagram feed posts validated against real account (selector tuning)
- [ ] Stories captured (deferred)
- [x] Like button with outbox pattern: intent recorded immediately, synced to platform async
- [x] Two-state like UI: "noted" (amber) vs "memorialized" (red confirmed on platform)
- [x] Seen-sync via WebView navigation (FB/IG) - best-effort, confirmed via seenSyncedAt
- [x] X likes via GraphQL FavoriteTweet/UnfavoriteTweet mutations
- [x] Comment links open post URL in system browser (platform-agnostic via PlatformContext.openUrl)
- [x] sourceUrl populated across all normalizers (X, Facebook, Instagram, RSS, Saved)

---

## Risks

| Risk                   | Mitigation                                                    |
| ---------------------- | ------------------------------------------------------------- |
| DOM changes frequently | Version selectors, monitor for breakage, quick update process |
| Account bans           | Conservative rate limiting, human-like scrolling with jitter  |
| Anti-bot detection     | Native WebView (WKWebView), real Safari UA, randomized timing |
| Legal concerns         | User captures their own data, no central server               |

---

## Deliverable

`@freed/capture-facebook` and `@freed/capture-instagram` packages for DOM-based feed capture via Tauri WebView. Location data from these sources feeds into Phase 8 (Friend Map).
