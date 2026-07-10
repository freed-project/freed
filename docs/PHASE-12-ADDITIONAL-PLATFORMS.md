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
- No scraping required. It has legitimate API access.
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

YouTube subscription import, focused playback, exact-video application handoff,
and a private user-owned playlist for YouTube Premium offline preparation.

```
packages/capture-youtube/
├── src/
│   ├── index.ts
│   ├── client.ts         # YouTube Data API client
│   ├── normalize.ts      # Subscription and video data -> Freed sources/items
│   ├── constants.ts      # OAuth scopes, endpoints, and playlist identity
│   └── types.ts
├── test/
│   ├── client.test.ts
│   └── normalize.test.ts
├── package.json
└── tsconfig.json
```

**Note:** `capture-rss` already handles YouTube channel feeds. This package adds:

- The authenticated user's subscription roster
- Conversion from stable channel IDs to existing public Atom feed sources
- Video metadata such as duration when the API path needs it
- Creation and reuse of a private `Freed Offline` playlist
- Idempotent insertion of user-selected videos into that playlist

The integration intentionally does not import the algorithmic Home feed. Watch
Later and watch history are not dependable capture sources in the current Data
API, so Freed owns a normal private playlist instead.

The shared reader adds two playback paths:

- `Watch here in Focus Mode` loads one click-to-load YouTube embed with no autoplay or
  automatic next video.
- `Play in YouTube` uses a canonical watch URL so iOS can open the exact video
  through YouTube's Universal Link.

YouTube Premium downloads remain inside YouTube. Freed adds a selected video to
`Freed Offline` and opens that playlist. The user chooses the playlist download
inside YouTube, and Freed does not claim to detect download completion.

**API Access:**

- YouTube Data API v3
- Incremental OAuth 2.0, with read-only subscription access first and
  `youtube.force-ssl` only when the user enables playlist writes
- Default quota is 10,000 units per day, while playlist creation and each item
  insert currently cost 50 units
- Deployed builds must enable the YouTube Data API and approve both scopes on
  the existing Google OAuth project

See [YouTube Focus and Offline Integration](YOUTUBE-INTEGRATION.md) for the
initial behavior, security boundaries, quota limits, Premium handoff, native
Screen Time option, and future resolver or relay research.

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
| 12.21 | `@freed/capture-youtube` package scaffold  | Low        | ✓ Done |
| 12.22 | YouTube Data API integration               | Medium     | ✓ Done |
| 12.23 | YouTube subscriptions feed                 | Medium     | ✓ Done |
| 12.24 | Focus player and exact-video handoff       | Medium     | ✓ Done |
| 12.25 | Private `Freed Offline` playlist           | Medium     | ✓ Done |
| 12.26 | YouTube OAuth connection and recovery      | Medium     | ✓ Done |

---

## Success Criteria

- [x] LinkedIn feed posts captured to FeedItem
- [x] LinkedIn is visible in desktop Sources navigation and source status UI
- [x] LinkedIn shares the Desktop scraper window modes: shown, cloaked, hidden
- [x] LinkedIn background scrape and auth-check WebViews force provider media silent
- [x] LinkedIn desktop flows have regression coverage in Playwright
- [x] LinkedIn shares the desktop provider health summaries, rate-limit pause state, resume controls, and the unified provider section used in Settings and Debug panel cards
- [x] LinkedIn shares the same provider severity colors and per-provider sync spinner behavior as the other social sources
- [x] LinkedIn login stays open after auth so users can finish platform prompts while sync starts, then closes only after scrape startup health is confirmed
- [x] LinkedIn post-login sync uses the user's selected scraper window mode instead of switching modes for the first scrape
- [x] LinkedIn zero-post runs now fail with local DOM diagnostics for candidate counts, activity URNs, login chrome, feed containers, and URL instead of clearing the last capture error as a successful empty sync
- [ ] Mozi activity captured to FeedItem with plans, trips, attendance, or overlap-adjacent events
- [ ] Mozi is visible in desktop Sources navigation and source status UI
- [ ] Mozi desktop flows have regression coverage in Playwright
- [ ] TikTok feed captured (video metadata at minimum)
- [ ] Threads posts captured to FeedItem
- [ ] Bluesky timeline captured via AT Protocol
- [ ] Reddit home feed captured (beyond RSS)
- [x] YouTube subscriptions captured beyond manually entered RSS through an explicit PWA OAuth sync, with stable roster reconciliation and a bounded recent upload window
- [x] YouTube videos offer click-to-load focused playback without autoplay or automatic next-video behavior
- [x] YouTube videos offer a canonical exact-video handoff for the YouTube application
- [x] An explicitly connected YouTube account can create or reuse a private `Freed Offline` playlist and add a selected video without claiming it was downloaded
- [x] The private offline playlist can open in YouTube for the user's Premium-managed playlist download
- [x] YouTube access tokens stay device-local and out of Automerge, application logs, diagnostics, and bug reports
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
| YouTube  | Data API + public RSS | OAuth         | Good                  | Medium     | Subscriptions, focused viewing, Premium offline handoff |

---

## Notes

- Feasibility varies by platform. Some may prove impractical.
- Each capture layer should fail gracefully without breaking others
- Consider community contributions for selector maintenance
- Bluesky is the most promising due to open protocol
- API-based platforms (Bluesky, Reddit, YouTube) are more stable than DOM scraping
- YouTube embeds, subscription reads, and playlist writes are separate provider-visible behaviors and must remain user-controlled and bounded
- The default YouTube API quota cannot support playlist writes for a large user population without an approved increase and quota-aware backpressure
- Mozi should be treated as a planning source, not squeezed into the RSS mental model
- Mozi overlap views should be derived from captured items at read time, not stored as source-authored canonical records
