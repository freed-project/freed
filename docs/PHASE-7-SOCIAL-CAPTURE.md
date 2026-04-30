# Phase 7: Facebook + Instagram Capture

> **Status:** 🚧 In Progress: Facebook and Instagram integrated into Desktop via Tauri WebView scraping, with feed pollution filtering, long-text expansion before extraction, silent background media guarding, provider health summaries, smart backoff, Facebook group controls, source-level post and story filtering, preserved Instagram story location metadata for map recovery, linked-account cross-post dedup across IG and FB, same-platform social story duplicate repair, X, Facebook, and Instagram reply hydration for the reader, captured authors now feeding the Phase 8 account catalog for identity review, and a local permanent media vault for a user's own Meta media
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
- **Long-form text expansion:** Facebook, Instagram, and LinkedIn extractors click common "see more" controls inside candidate post roots before reading text so long captions and essays are preserved in `content.text`.
- **Facebook comments** (`fb-comments-extract.js`): Opens the post URL in the authenticated WebView, expands visible comment controls, and emits inline reader replies with media.
- **Instagram comments** (`ig-comments-extract.js`): Opens post and reel URLs in the authenticated WebView, expands visible comment controls, and emits inline reader replies with media.
- **Facebook stories** (`fb-stories-extract.js`): Injected into the FB story viewer overlay. Extracts author, media, timestamp, location/check-in. Emits via `fb-feed-data` with `postType: "story"`.
- **Instagram stories** (`ig-stories-extract.js`): Injected into the IG story viewer overlay. Extracts author handle (from URL + DOM), typed media URLs, timestamp, and location sticker metadata. Timestamp-like fallback story IDs are replaced with stable content hashes. The normalized `FeedItem.location` now preserves the sticker source plus Instagram `locationUrl`, so later map resolution can recover real place names from generic labels such as `Locations`.

Story scraping is interleaved with feed scraping in each session. A coin flip (~50%) determines whether stories are scraped before or after the initial feed passes. ~15% of sessions skip story scraping entirely (real users don't always check stories). Up to 30 story frames are captured per session.

Story replies are treated differently from post comments. Facebook and Instagram story replies are private inbox conversations, so the reader shows an explicit private-replies state and keeps the Open action for replying on the platform.

Background scrape and auth-check sessions now force provider media elements silent through the injected WebKit mask layer. Audio elements are paused outright, video elements are forced muted, and newly inserted media is re-silenced as the DOM changes.

### Permanent Media Archive

Facebook and Instagram settings now expose a local-only media archive for the user's own uploaded media. This is not the standard content cache. Files are copied under the Freed Desktop app-data folder in `media-vault/{provider}` and are kept until the user explicitly deletes the archive, removes that provider archive, or factory-resets Freed Desktop.

The archive writes a local manifest with provider, source URL, post ID, media URL, local path, byte size, content hash, captured time, import source, and restore-planning roster hints. Media files, manifest rows, byte counts, failure records, retry state, and provider archive preferences are intentionally excluded from Automerge and are not synced.

Historical completeness comes from Meta export import. The importer accepts Accounts Center ZIP exports, prefers JSON-backed structures, scans Facebook and Instagram media folders defensively, skips message attachments, records discovered account handles, and copies media into the permanent vault with content-hash dedupe.

Recent coverage is continuous. After Facebook or Instagram sync stores captured items, Freed records roster metadata and attempts to archive recent own-account media when the provider archive is enabled and the user's handle is known. The archive dedupes by content hash, source URL, provider media ID, and normalized media URL, records bounded retry state for failed downloads, and never prunes permanent media.

Profile backfill is user-started and visible in settings. The current implementation backfills media already captured from the user's own provider identity and marks those files with the profile-backfill import source. Direct historical own-profile DOM crawling remains selector-sensitive and should stay slower, resumable, and separately smoke-tested before we claim full coverage beyond Meta export import.

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
| 7.11 | Stories capture (IG + FB, with map-ready location metadata) | 🚧 In Progress |
| 7.12 | Social engagement write-back (like, seen)   | ✓ Complete  |
| 7.13 | Outbox processor for cross-device sync      | ✓ Complete  |
| 7.14 | Comment links (open on platform)            | ✓ Complete  |
| 7.15 | Cross-platform dedup (IG/FB cross-posts)    | ✓ Complete  |
| 7.16 | Permanent local media vault                 | ✓ Complete  |
| 7.17 | Meta export import for own media            | ✓ Complete  |
| 7.18 | Own-profile backfill crawler                | 🚧 In Progress |
| 7.19 | Reader reply hydration for X posts          | ✓ Complete  |
| 7.20 | Reader comment hydration for Facebook and Instagram posts | ✓ Complete |

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
- [x] Settings UI for both platforms (login, check connection, sync, disconnect), with the same provider section also reused inside Debug panel health cards
- [x] Feed pollution filtering blocks promoted X entries and suggested FB/IG posts
- [x] Facebook Settings includes per-group include/exclude controls for joined groups inside a filtered inner scroller that prevents late group loads from shifting the outer Settings view
- [x] Desktop Sources settings expose per-source scraper window modes: shown, cloaked, hidden
- [x] Background FB and IG scraper WebViews force provider media silent during scrape and auth-check flows
- [x] Social providers surface paused/degraded health summaries in settings and the sidebar source surfaces
- [x] Explicit and heuristic rate-limit signals auto-pause social sync, notify the user, and allow manual resume
- [x] Social provider settings switch to reconnect prompts when the last sync error indicates expired or unauthorized auth
- [x] Settings Sources nav shows visible right-edge status dots, while the primary Sources sidebar keeps smaller inline status dots after each social provider name
- [x] Social sync actions show an inline spinner only while that specific provider is actively syncing
- [x] Social provider status dots switch to a live spinner while that provider is actively syncing
- [x] Social provider sections include a filtered line-by-line scrape log so users can see what the scraper is doing in real time without expanding the outer Settings view
- [x] Desktop social scraper commands serialize behind a shared native session lock so background WebKit jobs cannot overlap and starve the main renderer
- [x] Facebook, Instagram, and LinkedIn extractors expand common long-text controls before normalization
- [x] Social provider source menus surface a quick status explanation for warning or reconnect states before routing into full settings
- [x] Captured social authors can backfill the Phase 8 account catalog so followed accounts exist before identity confirmation
- [x] Empty states for both platforms in the feed view
- [x] Source indicators in sidebar for both platforms
- [x] Sync indicator panel shows both platforms
- [x] Direct Facebook and Instagram source views expose All, Posts, and Stories filters in the top toolbar
- [x] Facebook and Instagram settings expose `Back up my uploaded media`, `Import Meta export`, `Backfill from profile`, `Back up now`, and `Open vault folder`
- [x] Meta export ZIP import copies Facebook and Instagram media into a permanent local vault with a local manifest
- [x] Permanent media archive state stays outside Automerge and is not synced
- [x] Continuous backup archives recent own-account media after provider sync when the account handle is known
- [x] Facebook roster planning keeps group ID, name, and URL in the local archive manifest
- [ ] Facebook feed posts validated against real account (selector tuning)
- [ ] Instagram feed posts validated against real account (selector tuning)
- [ ] Direct own-profile crawler validated against saved Facebook profile, Instagram grid, reels, albums, and media-page DOM fixtures
- [~] Stories captured, with IG + FB story scraping integrated, Instagram story location URLs preserved for map recovery, playable story video rendering in the feed, stable fallback IG story IDs, and same-platform story duplicate repair. Selector tuning still needs work.
- [x] Cross-platform dedup (task 7.15): linked Facebook and Instagram stories or posts with similar text now collapse into one item when they land within a few minutes of each other, while preserving saved state, tags, and richer map metadata
- [x] Like button with outbox pattern: intent recorded immediately, synced to platform async
- [x] Two-state like UI: "noted" (amber) vs "memorialized" (red confirmed on platform)
- [x] Seen-sync via WebView navigation (FB/IG) - best-effort, confirmed via seenSyncedAt
- [x] X likes via GraphQL FavoriteTweet/UnfavoriteTweet mutations
- [x] X post reader hydration can fetch reply-thread items with media through the authenticated GraphQL path while online
- [x] Facebook and Instagram post reader hydration can fetch visible comments with media through authenticated WebView paths while online
- [x] Facebook and Instagram stories show a precise private-replies state in the reader because story replies live in platform inboxes
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
