# FREED

> **Their algorithms optimize for profit. Optimize yours for life.**

FREED captures social media and RSS feeds locally, presents them through a unified timeline you control, and syncs across devices without any data leaving your possession.

**Website:** [freed.wtf](https://freed.wtf)

---

## What It Does

- **Captures X/Twitter** via background polling using their GraphQL API
- **Aggregates RSS/Atom feeds** from blogs, YouTube, Reddit, Substack, podcasts, and more
- **Normalizes everything** into a single unified feed format
- **Syncs across devices** via Automerge CRDT—no cloud service required
- **Runs locally** as OpenClaw skills—no servers, no tracking

---

## Features

### 🌊 Unified Feed

One feed combining X posts, blog articles, YouTube videos, newsletters, and podcasts—ranked by your preferences, not their engagement algorithms.

### 🔒 Local-First Privacy

All data stays on your device. FREED captures to a local Automerge document. We literally cannot see what you capture.

### 🐦 X/Twitter Capture

Three modes for controlling X capture:

- **Mirror** — Capture from everyone you follow on X
- **Whitelist** — Only capture from accounts you specify
- **Mirror + Blacklist** — Mirror your follows minus specific accounts

### 📡 RSS Integration

Subscribe to any RSS/Atom feed. Special handling for:

- YouTube channels, Reddit, Mastodon, GitHub releases
- Medium, Substack, Ghost, and other newsletters
- Podcasts (RSS is their native format)
- OPML import for migrating from other readers

### 🔄 Cross-Device Sync

Automerge CRDT enables conflict-free sync:

- WebRTC for peer-to-peer on local network
- Encrypted cloud backup (Google Drive, iCloud, Dropbox)
- No central server required

### ⚓ Ulysses Mode _(Coming Soon)_

Browser extension that blocks platform feeds and redirects to FREED. Choose your constraints before the Sirens start singing.

### 📍 Friend Map _(Coming Soon)_

See where your friends are posting from. Location extraction from geo-tags and text builds a map of your social circle. Social media should facilitate human connection, not replace it.

---

## Planned Platforms

### 📘 Facebook _(Planned)_

DOM-based capture for Facebook feeds and stories. Challenging due to obfuscated selectors, but on the roadmap.

### 📸 Instagram _(Planned)_

Capture posts, stories, and reels from your Instagram feed. Similar DOM-based approach to Facebook.

### 🦋 Bluesky _(Planned)_

Native AT Protocol integration for richer data than RSS alone.

### 🐘 Mastodon _(Planned)_

Enhanced capture via Mastodon API (beyond current RSS support) for notifications and direct messages.

### 💼 LinkedIn _(Future)_

Professional network capture. Lower priority but architecturally supported.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CAPTURE LAYER                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ capture-x   │  │ capture-rss │  │ Future: DOM scrapers    │  │
│  │ (GraphQL)   │  │ (RSS/Atom)  │  │ (Facebook, Instagram)   │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │
│         └────────────────┼─────────────────────┘                │
│                          ▼                                      │
│              ┌───────────────────────┐                          │
│              │   @freed/shared       │                          │
│              │   (FeedItem Schema)   │                          │
│              └───────────┬───────────┘                          │
│                          ▼                                      │
│              ┌───────────────────────┐                          │
│              │  Automerge CRDT Doc   │                          │
│              └───────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────┐
│                     SYNC LAYER                                  │
│              ┌───────────┴───────────┐                          │
│              │    automerge-repo     │                          │
│              │  WebRTC + Cloud Backup│                          │
│              └───────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────┐
│                    READER LAYER                                 │
│    ┌─────────────┐              ┌─────────────┐                 │
│    │ Desktop PWA │              │  Phone PWA  │                 │
│    └─────────────┘              └─────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
freed/
├── packages/
│   ├── shared/              # @freed/shared - types, Automerge schema
│   ├── capture-x/           # @freed/capture-x - X GraphQL client
│   └── capture-rss/         # @freed/capture-rss - RSS parser
├── skills/
│   ├── capture-x/           # OpenClaw skill for X capture
│   └── capture-rss/         # OpenClaw skill for RSS capture
├── website/                 # Marketing site (freed.wtf)
├── workers/                 # Cloudflare Workers
├── docs/                    # Documentation
└── TODO-roadmap.md          # Master roadmap
```

---

## Quick Start

### Capture RSS Feeds

```bash
# Add a feed (auto-discovers RSS URL)
cd skills/capture-rss && npx tsx src/index.ts add https://simonwillison.net

# Import from OPML
npx tsx src/index.ts import ~/Downloads/feedly-export.opml

# Sync all feeds
npx tsx src/index.ts sync

# View recent items
npx tsx src/index.ts recent 20
```

### Capture X/Twitter

```bash
cd skills/capture-x && npx tsx src/index.ts status

# Set capture mode
npx tsx src/index.ts mode mirror_blacklist
npx tsx src/index.ts blacklist add @annoying_account

# Sync timeline
npx tsx src/index.ts sync
```

---

## Tech Stack

| Layer    | Technology                      |
| -------- | ------------------------------- |
| Language | TypeScript                      |
| Runtime  | Bun / Node                      |
| Monorepo | npm workspaces                  |
| Storage  | Automerge CRDT                  |
| Sync     | automerge-repo (WebRTC + cloud) |
| PWA      | React + Tailwind (coming soon)  |
| Capture  | OpenClaw skills                 |

---

## Development Status

| Phase                                | Status      |
| ------------------------------------ | ----------- |
| Marketing Site                       | ✅ Complete |
| Foundation (monorepo, types, schema) | ✅ Complete |
| X Capture                            | ✅ Complete |
| RSS Capture                          | ✅ Complete |
| Sync Layer                           | ⚪ Pending  |
| PWA Reader                           | ⚪ Pending  |
| Browser Extension                    | ⚪ Pending  |
| Friend Map                           | ⚪ Pending  |
| Facebook/Instagram                   | ⚪ Future   |

See [TODO-roadmap.md](TODO-roadmap.md) for detailed roadmap.

---

## Configuration

FREED uses two configuration layers:

**Operational settings** (`~/.freed/config.json`):

```json
{
  "capture-x": { "pollInterval": 5, "browser": "chrome" },
  "capture-rss": { "pollInterval": 30 }
}
```

**Subscriptions & preferences** (Automerge document—syncs across devices):

- RSS feed subscriptions
- X capture mode (mirror/whitelist/blacklist)
- Feed weights and display preferences

---

## 💜 Contributing

FREED is open source and welcomes contributions. See [CONTRIBUTING.md](CONTRIBUTING.md).

Areas where we need help:

- PWA reader UI/UX
- Additional capture skills (Mastodon API, Bluesky AT Protocol)
- Sync layer implementation
- Documentation and testing

---

## ⚖️ Legal

FREED operates locally on your device using your own authenticated sessions—similar to RSS readers and browser developer tools. All data stays local. We have no servers and collect no data.

See [docs/LEGAL.md](docs/LEGAL.md) for details.

---

## 📜 License

MIT License. See [LICENSE](LICENSE).

---

## 🧭 Philosophy

FREED exists because:

- Your attention belongs to you
- Algorithms should serve your goals, not theirs
- Social media should facilitate human connection, not replace it
- A unified view of content you care about shouldn't require surrendering your data

Read the manifesto at [freed.wtf/manifesto](https://freed.wtf/manifesto).

---

_Built for humans, not engagement metrics._
