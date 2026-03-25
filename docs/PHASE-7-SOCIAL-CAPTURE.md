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
- **Facebook stories** (`fb-stories-extract.js`): Injected into the FB story viewer overlay. Extracts author, media, timestamp, location/check-in. Emits via `fb-feed-data` with `postType: "story"`.
- **Instagram stories** (`ig-stories-extract.js`): Injected into the IG story viewer overlay. Extracts author handle (from URL + DOM), media URL, timestamp, location sticker. Emits via `ig-feed-data` with `postType: "story"`.

Story scraping is interleaved with feed scraping in each session. A coin flip (~50%) determines whether stories are scraped before or after the initial feed passes. ~15% of sessions skip story scraping entirely (real users don't always check stories). Up to 30 story frames are captured per session.

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
| 7.11 | Stories capture (IG + FB)                   | 🚧 In Progress |
| 7.12 | Social engagement write-back (like, seen)   | ✓ Complete  |
| 7.13 | Outbox processor for cross-device sync      | ✓ Complete  |
| 7.14 | Comment links (open on platform)            | ✓ Complete  |
| 7.15 | Cross-platform dedup (IG/FB cross-posts)    | Not Started |

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
- [~] Stories captured — IG + FB story scraping integrated (selector tuning needed)
- [ ] Cross-platform dedup (task 7.15): IG/FB cross-posted stories/posts create duplicate FeedItems because globalId is platform-prefixed (ig: vs fb:). The existing docDeduplicateFeedItems only deduplicates by linkPreview.url. A content-similarity pass is needed: match items by same Friend identity + similar text (first 120 chars) + timestamps within a few minutes.
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
| Anti-bot detection     | Native WebView, per-session OS-aware UA, Gaussian timing, webkit-mask init script, rquest Chrome TLS fingerprint for X |
| Legal concerns         | User captures their own data, no central server               |

---

## Future Anti-Detection Improvements

These are documented for future implementation. They were discussed and deferred in the anti-detection hardening PR (feat/anti-detection-hardening).

### Quiet Hours Sync Gating

Gate automatic sync to not run between midnight and 6am (configurable by user). A machine that checks social media at 3am with perfectly regular intervals is a bot signal. The sync scheduler should check the current hour before triggering a background scrape and apply additional random delay at day boundaries.

### Canvas Fingerprint Noise

Facebook and Instagram use canvas fingerprinting to build a persistent device fingerprint across sessions. The technique renders text or shapes to an offscreen canvas and reads back the pixel data - minor rendering differences between GPU drivers and font engines make each device unique.

Fix: inject a per-session imperceptible noise layer into `CanvasRenderingContext2D.prototype.getImageData` via the webkit-mask.js init script. Add `±1` to a deterministic-but-session-varied subset of pixel values. This breaks cross-session fingerprint matching without affecting visible rendering.

```javascript
// In webkit-mask.js (future addition)
const _origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
const _noise = (Math.random() * 2 - 1); // stable for this session
CanvasRenderingContext2D.prototype.getImageData = function(...args) {
  const data = _origGetImageData.apply(this, args);
  for (let i = 0; i < data.data.length; i += 127) {
    data.data[i] = Math.max(0, Math.min(255, data.data[i] + Math.round(_noise)));
  }
  return data;
};
```

### X API via X Login WebView (Option C)

Instead of Rust HTTP + rquest, inject GraphQL `fetch()` calls into the authenticated X login WebView. Since the WebView is already on the `twitter.com` domain after login, these are same-origin requests - the browser attaches cookies automatically, uses the real browser TLS stack (no BoringSSL compile dependency), and sends headers in the browser's native order.

This requires:
- Keeping the X login WebView alive after login (as a hidden window, like the FB/IG pattern)
- Injecting JS that calls `fetch()` against the GraphQL endpoint and returns results via Tauri event IPC
- Significant refactor of the X capture flow

This approach eliminates the need for rquest entirely and is architecturally cleaner. Deserves its own PR.

### TLS JA4H Header Order Analysis

Profile whether the HashMap → Vec ordered header change in x_api_request meaningfully changes Cloudflare's bot score in practice. Set up a test account, capture baseline bot scores before and after the change using Cloudflare's bot score headers (`cf-bot-score`, visible in network logs when testing against a CF-fronted endpoint), and quantify the improvement.

---

## Deliverable

`@freed/capture-facebook` and `@freed/capture-instagram` packages for DOM-based feed capture via Tauri WebView. Location data from these sources feeds into Phase 8 (Friend Map).
