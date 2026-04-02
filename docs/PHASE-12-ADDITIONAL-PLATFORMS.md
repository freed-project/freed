# Phase 12: Additional Platforms

> **Status:** 🚧 In Progress
> **Dependencies:** Phase 5 (Desktop App), Phase 7 (Facebook/Instagram patterns)

---

## Overview

Expand capture to more platforms. Each platform gets its own capture layer package, following the patterns established in earlier phases.

---

## Packages

### `@freed/capture-linkedin`

Professional network posts and articles, now fully surfaced in the desktop app with the same provider health summaries and pause controls as the other social sources.

```
packages/capture-linkedin/
├── src/
│   ├── index.ts
│   ├── scraper.ts
│   ├── selectors.ts
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Challenges:**

- LinkedIn aggressively blocks automation
- Session management more complex than other platforms
- May require browser profile approach rather than cookies

---

### `@freed/capture-mozi`

Private social planning network focused on trips, being-in-town windows, event attendance, and overlap signals.

```
packages/capture-mozi/
├── src/
│   ├── index.ts
│   ├── extractor.ts      # Structured payload capture from authenticated WebView
│   ├── selectors.ts      # DOM fallback selectors for visible cards and details
│   ├── normalize.ts      # Mozi activity -> FeedItem
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Approach:**

- Desktop-only authenticated source via Tauri WebView against `app.mozi.app`
- Prefer structured network payloads or embedded page data when available
- Fall back to DOM extraction only for fields the payload does not expose
- Normalize plans, trips, event attendance, and other visible planning activity into unified `FeedItem` records

**Why it matters:**

- Mozi is not a generic content feed or an RSS source
- The value is future-aware social planning data, not passive scrolling
- Captured items should eventually power Friend identity, time-aware map playback, and derived overlap views

**Desktop integration target:**

- Sources settings section with login, auth check, disconnect, and sync actions
- Sidebar source presence and source status indicator
- Sync status panel parity with LinkedIn
- Feed filtering parity with other desktop-authenticated sources

**Challenges:**

- Authenticated phone-based flow may require more brittle session handling than cookie-only providers
- The most useful items are future-dated, which means downstream consumers need time-window semantics
- Some overlap value is derived from multiple captured items and should not be persisted as canonical source content

---

### `@freed/capture-tiktok`

Short-form video feed.

```
packages/capture-tiktok/
├── src/
│   ├── index.ts
│   ├── scraper.ts
│   ├── selectors.ts
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Challenges:**

- Heavy anti-bot measures
- Video-first content doesn't fit text-based FeedItem as well
- May need different capture strategy (API if available, or accept limitations)

---

### `@freed/capture-threads`

Meta's Twitter competitor.

```
packages/capture-threads/
├── src/
│   ├── index.ts
│   ├── scraper.ts
│   ├── selectors.ts
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Approach TBD:**

- May have RSS support by then
- Shares infrastructure with Instagram (same Meta ecosystem)
- Could potentially reuse Instagram session

---

### `@freed/capture-bluesky`

Decentralized Twitter alternative built on AT Protocol.

```
packages/capture-bluesky/
├── src/
│   ├── index.ts
│   ├── client.ts         # AT Protocol client
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Advantages:**

- Open AT Protocol with official API
- No scraping required—legitimate API access
- Federation-friendly architecture
- App passwords for authentication

**Implementation:**

```typescript
// packages/capture-bluesky/src/client.ts
import { BskyAgent } from "@atproto/api";

export async function getTimeline(
  agent: BskyAgent,
  cursor?: string
): Promise<TimelineResponse> {
  return agent.getTimeline({ cursor, limit: 50 });
}
```

---

### `@freed/capture-reddit`

Reddit posts and comments (beyond RSS).

```
packages/capture-reddit/
├── src/
│   ├── index.ts
│   ├── client.ts         # Reddit API client
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Note:** `capture-rss` already handles Reddit via RSS feeds. This package adds:

- Home feed (personalized, requires auth)
- Saved posts
- Comment threads
- Upvote/downvote state

**API Access:**

- Reddit API requires OAuth app registration
- Rate limits: 60 requests/minute with OAuth
- Consider Reddit's API pricing changes

---

### `@freed/capture-youtube`

YouTube subscriptions and watch later (beyond RSS).

```
packages/capture-youtube/
├── src/
│   ├── index.ts
│   ├── client.ts         # YouTube Data API client
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Note:** `capture-rss` already handles YouTube channel feeds. This package adds:

- Subscriptions feed (personalized)
- Watch Later playlist
- Watch history (if accessible)
- Video metadata (duration, views, etc.)

**API Access:**

- YouTube Data API v3
- OAuth 2.0 for user data
- Quota limits: 10,000 units/day (free tier)

---

## Tasks

| Task  | Description                                | Complexity | Status |
| ----- | ------------------------------------------ | ---------- | ------ |
| 12.1  | `@freed/capture-linkedin` package scaffold | Low        | ✓ Done |
| 12.2  | LinkedIn DOM selectors                     | High       | ✓ Done |
| 12.3  | LinkedIn session management                | High       | ✓ Done |
| 12.4  | LinkedIn desktop source integration        | Medium     | ✓ Done |
| 12.5  | LinkedIn regression test coverage          | Medium     | ✓ Done |
| 12.6  | `@freed/capture-mozi` package scaffold     | Low        |        |
| 12.7  | Mozi auth and session flow research        | High       |        |
| 12.8  | Mozi extraction strategy: payload first    | High       |        |
| 12.9  | Mozi desktop source integration            | Medium     |        |
| 12.10 | Mozi regression test coverage              | Medium     |        |
| 12.11 | `@freed/capture-tiktok` package scaffold   | Low        |        |
| 12.12 | TikTok capture strategy research           | High       |        |
| 12.13 | `@freed/capture-threads` package scaffold  | Low        |        |
| 12.14 | Threads capture (similar to Instagram)     | Medium     |        |
| 12.15 | `@freed/capture-bluesky` package scaffold  | Low        |        |
| 12.16 | Bluesky AT Protocol client                 | Medium     |        |
| 12.17 | Bluesky authentication flow                | Medium     |        |
| 12.18 | `@freed/capture-reddit` package scaffold   | Low        |        |
| 12.19 | Reddit OAuth setup                         | Medium     |        |
| 12.20 | Reddit home feed capture                   | Medium     |        |
| 12.21 | `@freed/capture-youtube` package scaffold  | Low        |        |
| 12.22 | YouTube Data API integration               | Medium     |        |
| 12.23 | YouTube subscriptions feed                 | Medium     |        |

---

## Success Criteria

- [x] LinkedIn feed posts captured to FeedItem
- [x] LinkedIn is visible in desktop Sources navigation and source status UI
- [x] LinkedIn shares the Desktop scraper window modes: shown, cloaked, hidden
- [x] LinkedIn background scrape and auth-check WebViews force provider media silent
- [x] LinkedIn desktop flows have regression coverage in Playwright
- [x] LinkedIn shares the desktop provider health summaries, rate-limit pause state, and resume controls
- [ ] Mozi activity captured to FeedItem with plans, trips, attendance, or overlap-adjacent events
- [ ] Mozi is visible in desktop Sources navigation and source status UI
- [ ] Mozi desktop flows have regression coverage in Playwright
- [ ] TikTok feed captured (video metadata at minimum)
- [ ] Threads posts captured to FeedItem
- [ ] Bluesky timeline captured via AT Protocol
- [ ] Reddit home feed captured (beyond RSS)
- [ ] YouTube subscriptions captured (beyond RSS)
- [ ] Each platform handles its own rate limiting
- [ ] Selector/API maintenance strategy per platform
- [ ] Planning-oriented sources can surface future-dated activity without being forced through RSS assumptions

---

## Platform Comparison

| Platform | Method                | Auth Required | API Quality           | Difficulty | Primary Value |
| -------- | --------------------- | ------------- | --------------------- | ---------- | ------------- |
| LinkedIn | DOM scrape            | Cookies       | N/A                   | Very High  | Professional posts |
| Mozi     | WebView payload + DOM | Phone session | Unknown / likely none | High       | Social planning, trips, overlaps |
| TikTok   | TBD                   | TBD           | Limited               | Very High  | Short-form video feed |
| Threads  | DOM scrape            | Cookies       | N/A                   | High       | Social posts |
| Bluesky  | AT Protocol           | App password  | Excellent             | Low        | Timeline capture |
| Reddit   | OAuth API             | OAuth         | Good                  | Medium     | Home feed beyond RSS |
| YouTube  | Data API              | OAuth         | Good                  | Medium     | Subscriptions beyond RSS |

---

## Notes

- Feasibility varies by platform—some may prove impractical
- Each capture layer should fail gracefully without breaking others
- Consider community contributions for selector maintenance
- Bluesky is the most promising due to open protocol
- API-based platforms (Bluesky, Reddit, YouTube) are more stable than DOM scraping
- Mozi should be treated as a planning source, not squeezed into the RSS mental model
- Mozi overlap views should be derived from captured items at read time, not stored as source-authored canonical records
