---
name: capture-rss
description: Captures posts from RSS/Atom feeds for unified feed aggregation
user-invocable: true
metadata: {"requires": {"bins": ["bun"]}}
---

# RSS Feed Capture

Captures content from RSS and Atom feeds. Works with blogs, newsletters, YouTube channels, Reddit, Mastodon, and any standard RSS/Atom feed.

## Overview

This skill:
- Polls your subscribed RSS/Atom feeds periodically
- Normalizes content to FREED's unified FeedItem format
- Uses conditional GET (ETag/Last-Modified) for efficient polling
- Auto-discovers feed URLs from website URLs
- Supports OPML import/export for migration

## Usage

### Add a Feed

```
capture-rss add <url>
```

Add a feed by URL. Auto-discovers RSS feed from website URL.

Examples:
```
capture-rss add https://example.com/blog
capture-rss add https://username.substack.com
capture-rss add https://www.youtube.com/channel/UCxxx
capture-rss add https://www.reddit.com/r/technology
```

### Import from OPML

```
capture-rss import <file>
```

Import feeds from an OPML file (export from Feedly, Inoreader, etc.)

### List Feeds

```
capture-rss list
```

Show all subscribed feeds with status.

### Remove a Feed

```
capture-rss remove <url>
```

Remove a feed subscription.

### Manual Sync

```
capture-rss sync
```

Immediately sync all feeds without waiting for next poll.

### Export to OPML

```
capture-rss export <file>
```

Export your subscriptions to OPML format.

## Configuration

Configuration in `~/.freed/config.json`:

```json
{
  "capture-rss": {
    "pollInterval": 30,
    "maxItemsPerFeed": 50,
    "concurrency": 5
  }
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `pollInterval` | 30 | Minutes between polls |
| `maxItemsPerFeed` | 50 | Maximum items to keep per feed |
| `concurrency` | 5 | Parallel feed requests |

## Supported Sources

Works with any RSS/Atom feed. Special handling for:

### Newsletters
- Substack (`*.substack.com/feed`)
- Medium (`medium.com/feed/@username`)
- Ghost blogs (`*/rss/`)
- Buttondown, Beehiiv, etc.

### Video
- YouTube channels (auto-discovers feed URL)
- Nebula, Vimeo (if RSS provided)

### Social
- Mastodon (`instance/@user.rss`)
- Reddit (`/r/subreddit/.rss`, `/user/name/.rss`)
- Bluesky (via RSS bridge)

### Code
- GitHub releases (`/releases.atom`)
- GitHub commits (`/commits.atom`)

### Podcasts
- Any podcast feed (RSS is native format)

## Feed Discovery

When you add a URL, the skill tries to find the RSS feed:

1. **Platform patterns** - Known URL patterns for YouTube, Reddit, etc.
2. **HTML link tags** - `<link rel="alternate" type="application/rss+xml">`
3. **Common paths** - `/feed`, `/rss`, `/atom.xml`, etc.

If discovery fails, provide the direct feed URL.

## Data Storage

Feed items stored in `~/.freed/data/feed.automerge`:
- Same format as X/Twitter captures
- Enables unified feed across all sources
- CRDT sync across devices

## Conditional GET

The skill uses HTTP caching headers to minimize bandwidth:

- **ETag** - Server returns 304 if content unchanged
- **Last-Modified** - Only fetches if newer content available

This means polling frequently is cheap if feeds haven't updated.

## Privacy

- All data stays on your device
- No tracking or analytics
- Feed requests come directly from your machine
- Open source - audit the code

## Tips

1. **Polling interval** - 30 minutes is reasonable; most feeds don't update faster
2. **OPML backup** - Export periodically with `capture-rss export`
3. **Feed cleanup** - Use `capture-rss list` to check for dead feeds
4. **Categories** - Topics are extracted from feed categories
