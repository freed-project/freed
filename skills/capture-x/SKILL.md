---
name: capture-x
description: Captures posts from X/Twitter using GraphQL APIs for background feed aggregation
user-invocable: true
metadata: {"requires": {"bins": ["bun"]}}
---

# X Feed Capture

Captures posts from X/Twitter using their internal GraphQL API. Runs in the background via OpenClaw, no browser tab required.

## Capture Modes

Three modes for controlling what gets captured:

| Mode | Description |
|------|-------------|
| `mirror` | Capture from everyone you follow on X (default) |
| `whitelist` | Only capture from explicitly listed accounts |
| `mirror_blacklist` | Mirror your follows, but exclude blacklisted accounts |

### Set Mode

```bash
capture-x mode                    # Show current mode
capture-x mode whitelist          # Switch to whitelist mode
capture-x mode mirror_blacklist   # Mirror minus blacklist
```

### Manage Whitelist

```bash
capture-x whitelist               # Show whitelist
capture-x whitelist add @user     # Add to whitelist
capture-x whitelist remove @user  # Remove from whitelist
```

### Manage Blacklist

```bash
capture-x blacklist               # Show blacklist
capture-x blacklist add @user     # Add to blacklist
capture-x blacklist remove @user  # Remove from blacklist
```

## Usage

### Start/Stop Capture

```bash
capture-x start    # Begin polling
capture-x stop     # Stop polling
capture-x status   # Show status and configuration
capture-x sync     # Manual sync now
```

### View Recent Posts

```bash
capture-x recent [count]   # Show recent posts (default: 10)
```

### Content Filtering

```bash
capture-x set retweets off   # Exclude retweets
capture-x set replies off    # Exclude replies
```

## Configuration

Operational settings in `~/.freed/config.json`:

```json
{
  "capture-x": {
    "pollInterval": 5,
    "browser": "chrome",
    "maxItemsPerPoll": 50
  }
}
```

Mode and lists are stored in the Automerge document (syncs across devices).

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
