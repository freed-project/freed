# Phase 12: Additional Platforms

> **Status:** Future  
> **Dependencies:** Phase 5 (Desktop App), Phase 7 (Facebook/Instagram patterns)

---

## Overview

Expand capture to more platforms. Each platform gets its own capture layer package, following the patterns established in earlier phases.

---

## Packages

### `@freed/capture-linkedin`

Professional network posts and articles.

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

| Task  | Description                                | Complexity |
| ----- | ------------------------------------------ | ---------- |
| 12.1  | `@freed/capture-linkedin` package scaffold | Low        |
| 12.2  | LinkedIn DOM selectors                     | High       |
| 12.3  | LinkedIn session management                | High       |
| 12.4  | `@freed/capture-tiktok` package scaffold   | Low        |
| 12.5  | TikTok capture strategy research           | High       |
| 12.6  | `@freed/capture-threads` package scaffold  | Low        |
| 12.7  | Threads capture (similar to Instagram)     | Medium     |
| 12.8  | `@freed/capture-bluesky` package scaffold  | Low        |
| 12.9  | Bluesky AT Protocol client                 | Medium     |
| 12.10 | Bluesky authentication flow                | Medium     |
| 12.11 | `@freed/capture-reddit` package scaffold   | Low        |
| 12.12 | Reddit OAuth setup                         | Medium     |
| 12.13 | Reddit home feed capture                   | Medium     |
| 12.14 | `@freed/capture-youtube` package scaffold  | Low        |
| 12.15 | YouTube Data API integration               | Medium     |
| 12.16 | YouTube subscriptions feed                 | Medium     |

---

## Success Criteria

- [ ] LinkedIn feed posts captured to FeedItem
- [ ] TikTok feed captured (video metadata at minimum)
- [ ] Threads posts captured to FeedItem
- [ ] Bluesky timeline captured via AT Protocol
- [ ] Reddit home feed captured (beyond RSS)
- [ ] YouTube subscriptions captured (beyond RSS)
- [ ] Each platform handles its own rate limiting
- [ ] Selector/API maintenance strategy per platform

---

## Platform Comparison

| Platform | Method      | Auth Required | API Quality | Difficulty |
| -------- | ----------- | ------------- | ----------- | ---------- |
| LinkedIn | DOM scrape  | Cookies       | N/A         | Very High  |
| TikTok   | TBD         | TBD           | Limited     | Very High  |
| Threads  | DOM scrape  | Cookies       | N/A         | High       |
| Bluesky  | AT Protocol | App password  | Excellent   | Low        |
| Reddit   | OAuth API   | OAuth         | Good        | Medium     |
| YouTube  | Data API    | OAuth         | Good        | Medium     |

---

## Notes

- Feasibility varies by platform—some may prove impractical
- Each capture layer should fail gracefully without breaking others
- Consider community contributions for selector maintenance
- Bluesky is the most promising due to open protocol
- API-based platforms (Bluesky, Reddit, YouTube) are more stable than DOM scraping
