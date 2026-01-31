---
name: capture-x
description: Captures posts from X/Twitter using GraphQL APIs for background feed aggregation
user-invocable: true
metadata: {"requires": {"bins": ["bun"]}}
---

# X Feed Capture

Captures posts from accounts you follow on X/Twitter using their internal GraphQL API. Runs in the background via OpenClaw, no browser tab required.

## Overview

This skill:
- Polls your X "Following" timeline periodically
- Normalizes tweets to FREED's unified FeedItem format
- Stores captured content in a local Automerge CRDT document
- Handles rate limiting with exponential backoff

## Usage

### Start Capture

```
capture-x start
```

Begins polling your X timeline. Default interval is 5 minutes.

### Stop Capture

```
capture-x stop
```

Stops background polling.

### Check Status

```
capture-x status
```

Shows:
- Whether capture is running
- Last capture time
- Number of items captured
- Rate limit status

### Manual Sync

```
capture-x sync
```

Immediately fetch new posts without waiting for next poll interval.

### View Recent

```
capture-x recent [count]
```

Display the most recent captured posts (default: 10).

## Configuration

Configuration is stored in `~/.freed/config.json`:

```json
{
  "capture-x": {
    "pollInterval": 5,
    "browser": "chrome",
    "maxItemsPerPoll": 50
  }
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `pollInterval` | 5 | Minutes between polls |
| `browser` | "chrome" | Browser for cookie extraction (chrome/firefox/edge/brave) |
| `maxItemsPerPoll` | 50 | Maximum tweets to fetch per poll |

## Authentication

This skill extracts session cookies from your browser to authenticate API requests. You must be logged into X in your browser.

### Supported Browsers

- Chrome (default)
- Firefox
- Edge
- Brave

### Troubleshooting Auth

If cookie extraction fails:

1. **Browser must be closed** - Some browsers lock the cookie database while running
2. **Manual cookie export** - Copy cookies from browser dev tools and paste:
   ```
   capture-x set-cookies "ct0=xxx; auth_token=yyy"
   ```
3. **Verify login** - Make sure you're logged into x.com in your browser

## Data Storage

Captured posts are stored in `~/.freed/data/feed.automerge`:

- CRDT format enables conflict-free sync across devices
- All data stays local - nothing is uploaded
- Storage grows over time; old items can be archived

## Rate Limits

X's API has rate limits. This skill:

- Respects rate limit headers
- Backs off exponentially when limited
- Waits automatically before retrying

Typical limits:
- ~500 requests per 15 minutes
- Each poll is 1 request

## Privacy

- All data stays on your device
- No telemetry or analytics
- Cookies are used only for API auth, never transmitted elsewhere
- Open source - audit the code yourself

## Technical Details

This skill uses X's internal GraphQL API (`HomeLatestTimeline` endpoint) - the same API the web client uses. It's undocumented and may change, but the community actively tracks changes.

### API Endpoint

```
POST https://x.com/i/api/graphql/{queryId}/HomeLatestTimeline
```

### Query IDs

Query IDs change periodically. If capture stops working, update the skill or check [fa0311/TwitterInternalAPIDocument](https://github.com/fa0311/TwitterInternalAPIDocument) for current IDs.
