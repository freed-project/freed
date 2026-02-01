# Phase 2: Capture Skills

> **Status:** ✓ Complete  
> **Dependencies:** Phase 1 (Foundation ✓)

---

## Overview

First capture layers for X/Twitter and RSS feeds, with OpenClaw skill wrappers for CLI access.

---

## Packages Delivered

### 1. `@freed/capture-x`

Captures posts from X/Twitter using their internal GraphQL API.

```
packages/capture-x/
├── src/
│   ├── index.ts        # Public API
│   ├── auth.ts         # Cookie extraction from browsers
│   ├── client.ts       # GraphQL API client
│   ├── endpoints.ts    # API endpoint definitions
│   ├── normalize.ts    # Tweet -> FeedItem
│   └── types.ts        # X-specific types
├── package.json
└── tsconfig.json
```

#### Authentication (`auth.ts`)

```typescript
// Extract session cookies from browser databases
export async function extractCookies(browser: Browser): Promise<XCookies>;

// Supported browsers
export type Browser = 'chrome' | 'firefox' | 'edge' | 'brave';

// Required cookies for API access
export interface XCookies {
  ct0: string;         // CSRF token
  auth_token: string;  // Session token
}
```

#### API Client (`client.ts`)

```typescript
export class XClient {
  // Fetch home timeline (following feed)
  async getHomeTimeline(cursor?: string): Promise<TimelineResponse>;
  
  // Fetch user's following list
  async getFollowing(userId: string): Promise<User[]>;
  
  // Get current user info
  async getMe(): Promise<User>;
}
```

#### Capture Modes

| Mode | Description |
|------|-------------|
| `mirror` | Capture from everyone you follow on X (default) |
| `whitelist` | Only capture from explicitly listed accounts |
| `mirror_blacklist` | Mirror follows, exclude blacklisted accounts |

#### Normalization (`normalize.ts`)

```typescript
// Convert X tweet to unified FeedItem
export function tweetToFeedItem(tweet: Tweet): FeedItem {
  return {
    globalId: `x:${tweet.rest_id}`,
    platform: 'x',
    contentType: 'post',
    capturedAt: Date.now(),
    publishedAt: new Date(tweet.legacy.created_at).getTime(),
    author: {
      id: tweet.core.user_results.result.rest_id,
      handle: tweet.core.user_results.result.legacy.screen_name,
      displayName: tweet.core.user_results.result.legacy.name,
      avatarUrl: tweet.core.user_results.result.legacy.profile_image_url_https,
    },
    content: {
      text: tweet.legacy.full_text,
      mediaUrls: extractMediaUrls(tweet),
      mediaTypes: extractMediaTypes(tweet),
    },
    engagement: {
      likes: tweet.legacy.favorite_count,
      reposts: tweet.legacy.retweet_count,
      comments: tweet.legacy.reply_count,
      views: tweet.views?.count,
    },
    userState: createDefaultUserState(),
    topics: [],
  };
}
```

### 2. `@freed/capture-rss`

Captures content from RSS/Atom feeds with automatic format detection.

```
packages/capture-rss/
├── src/
│   ├── index.ts        # Public API
│   ├── parser.ts       # RSS/Atom parser
│   ├── discovery.ts    # Auto-discover feeds from URLs
│   ├── normalize.ts    # RssEntry -> FeedItem
│   ├── opml.ts         # OPML import/export
│   └── types.ts        # RSS-specific types
├── package.json
└── tsconfig.json
```

#### Feed Discovery (`discovery.ts`)

```typescript
// Auto-discover RSS feeds from any URL
export async function discoverFeeds(url: string): Promise<DiscoveredFeed[]>;

// Supports:
// - Direct feed URLs
// - HTML pages with <link rel="alternate" type="application/rss+xml">
// - Common feed paths (/feed, /rss, /atom.xml)
```

#### Parser (`parser.ts`)

```typescript
// Parse RSS 2.0, RSS 1.0, and Atom feeds
export async function parseFeed(url: string): Promise<ParsedFeed>;

export interface ParsedFeed {
  title: string;
  siteUrl: string;
  feedUrl: string;
  description?: string;
  imageUrl?: string;
  items: RssItem[];
}
```

#### Normalization (`normalize.ts`)

```typescript
// Convert RSS item to unified FeedItem
export function rssItemToFeedItem(item: RssItem, feed: RssFeed): FeedItem {
  return {
    globalId: `rss:${item.guid || item.link}`,
    platform: detectPlatform(feed.siteUrl), // youtube, reddit, mastodon, etc.
    contentType: detectContentType(item),
    capturedAt: Date.now(),
    publishedAt: new Date(item.pubDate).getTime(),
    author: {
      id: feed.url,
      handle: new URL(feed.siteUrl).hostname,
      displayName: feed.title,
      avatarUrl: feed.imageUrl,
    },
    content: {
      text: item.description || item.title,
      mediaUrls: extractEnclosures(item),
      mediaTypes: detectMediaTypes(item),
      linkPreview: {
        url: item.link,
        title: item.title,
        description: item.description,
      },
    },
    rssSource: {
      feedUrl: feed.url,
      feedTitle: feed.title,
      siteUrl: feed.siteUrl,
    },
    userState: createDefaultUserState(),
    topics: item.categories || [],
  };
}
```

#### OPML Support (`opml.ts`)

```typescript
// Import feeds from OPML file
export function parseOpml(xml: string): RssFeed[];

// Export feeds to OPML
export function generateOpml(feeds: RssFeed[]): string;
```

#### Platform Detection

RSS feeds from known platforms get special handling:

| Platform | Detection | Content Type |
|----------|-----------|--------------|
| YouTube | `youtube.com/feeds` | `video` |
| Reddit | `reddit.com/.rss` | `post` |
| Mastodon | ActivityPub signature | `post` |
| GitHub | `github.com/*.atom` | `post` |
| Podcast | `<enclosure type="audio/*">` | `podcast` |

---

## OpenClaw Skills

### `skills/capture-x`

```bash
# Status and configuration
capture-x status

# Capture modes
capture-x mode                    # Show current mode
capture-x mode whitelist          # Switch to whitelist-only
capture-x mode mirror_blacklist   # Mirror minus blacklist

# Whitelist management
capture-x whitelist add @user
capture-x whitelist remove @user

# Blacklist management  
capture-x blacklist add @user
capture-x blacklist remove @user

# Manual sync
capture-x sync

# View recent captures
capture-x recent [count]
```

### `skills/capture-rss`

```bash
# Subscribe to feeds
capture-rss add <url>             # Add feed (auto-discovers)
capture-rss add <url> --folder News

# List subscriptions
capture-rss list
capture-rss list --folder Tech

# Import/export
capture-rss import feeds.opml
capture-rss export > backup.opml

# Manual sync
capture-rss sync
capture-rss sync <feed-url>       # Sync specific feed

# View recent items
capture-rss recent [count]
```

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Browser cookie extraction | Use existing X session, no OAuth complexity |
| Internal GraphQL API | Same API as web client, full access to timeline |
| Multi-format RSS parser | Support RSS 1.0, 2.0, and Atom without external deps |
| Platform detection from RSS | Better content typing (video, podcast, etc.) |
| Conditional GET (ETag/Last-Modified) | Reduce bandwidth, respect server caching |

---

## Tasks

| Task | Description | Status |
|------|-------------|--------|
| 2.1 | Create `@freed/capture-x` package | ✓ |
| 2.2 | Implement browser cookie extraction | ✓ |
| 2.3 | Build GraphQL API client | ✓ |
| 2.4 | Normalize tweets to FeedItem | ✓ |
| 2.5 | Implement capture modes (mirror/whitelist/blacklist) | ✓ |
| 2.6 | Create OpenClaw skill wrapper for X | ✓ |
| 2.7 | Create `@freed/capture-rss` package | ✓ |
| 2.8 | Build RSS/Atom parser | ✓ |
| 2.9 | Implement feed discovery | ✓ |
| 2.10 | Normalize RSS items to FeedItem | ✓ |
| 2.11 | Add OPML import/export | ✓ |
| 2.12 | Create OpenClaw skill wrapper for RSS | ✓ |

---

## Dependencies

```json
{
  "@freed/capture-x": {
    "dependencies": {
      "@freed/shared": "*",
      "better-sqlite3": "^11.0.0"
    }
  },
  "@freed/capture-rss": {
    "dependencies": {
      "@freed/shared": "*",
      "fast-xml-parser": "^4.0.0"
    }
  }
}
```

---

## Technical Notes

### X API Rate Limits

- ~500 requests per 15-minute window
- Each timeline fetch is 1 request
- Default poll interval: 5 minutes
- Exponential backoff on rate limit errors

### RSS Polling

- Default poll interval: 30 minutes
- Respects `Cache-Control` and `Retry-After` headers
- Conditional GET reduces bandwidth by ~90%
- Feed-specific intervals can be configured

### Data Flow

```
X Timeline API        RSS Feed URL
      │                    │
      ▼                    ▼
 capture-x            capture-rss
      │                    │
      ▼                    ▼
   Tweet              RssItem
      │                    │
      └──────┬─────────────┘
             ▼
         FeedItem
             │
             ▼
       FreedDoc (Automerge)
             │
             ▼
    ~/.freed/data/feed.automerge
```
