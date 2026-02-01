# FREED

> **Their algorithms optimize for profit. Optimize yours for life.**

Capture your social feeds locally. Tune the ranking algorithm yourself. Sync across devices. No cloud dependency, no tracking, no algorithmic manipulation.

**Website:** [freed.wtf](https://freed.wtf)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CAPTURE LAYER                                   │
│                                                                             │
│   ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
│   │ capture-x │ │capture-rss│ │capture-   │ │ capture-  │ │ capture-  │   │
│   │           │ │           │ │   save    │ │ facebook  │ │ instagram │   │
│   └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘   │
│         │             │             │             │             │         │
│         └─────────────┴─────────────┴─────────────┴─────────────┘         │
│                                    │                                       │
│                                    ▼                                       │
│                        ┌─────────────────────┐                             │
│                        │  FeedItem (unified) │                             │
│                        │  Automerge CRDT Doc │                             │
│                        └──────────┬──────────┘                             │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
┌───────────────────────────────────┼─────────────────────────────────────────┐
│                              SYNC LAYER                                      │
│                                    │                                        │
│          ┌─────────────────────────┴─────────────────────────┐              │
│          │                                                   │              │
│    Local Relay (WebSocket)                         Cloud Backup             │
│    instant sync on LAN                         GDrive/iCloud/Dropbox        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────┼─────────────────────────────────────────┐
│                             CLIENT LAYER                                     │
│          ┌────────────────────────┴────────────────────────┐                │
│          ▼                                                 ▼                │
│   ┌─────────────┐                                   ┌─────────────┐         │
│   │ Desktop App │ ◄─────────────────────────────────│  Phone PWA  │         │
│   │  (primary)  │          real-time sync           │  (mobile)   │         │
│   └─────────────┘                                   └─────────────┘         │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────┐       │
│   │                    Browser Extension (optional)                  │       │
│   │                 One-click save • Ulysses mode                   │       │
│   └─────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Desktop App is the hub.** It runs capture, hosts the sync relay, and provides the reader UI. Phone PWA syncs to it for mobile reading. OpenClaw users can run capture headlessly instead.

---

## Capture Layers

| Package | Sources | Method | Status |
|---------|---------|--------|--------|
| `capture-x` | X/Twitter | GraphQL API | ✓ Complete |
| `capture-rss` | Blogs, Medium, Substack, YouTube, podcasts, Mastodon, Reddit, GitHub | RSS/Atom | ✓ Complete |
| `capture-save` | Any URL | Readability extraction | Phase 3 |
| `capture-facebook` | Facebook | DOM scraping | Phase 7 |
| `capture-instagram` | Instagram | DOM scraping | Phase 7 |
| `capture-linkedin` | LinkedIn | DOM scraping | Phase 12 |
| `capture-tiktok` | TikTok | TBD | Phase 12 |
| `capture-threads` | Threads | TBD | Phase 12 |

---

## Features

### 🌊 Unified Feed

One feed combining X posts, blog articles, YouTube videos, newsletters, and podcasts—ranked by your preferences, not their engagement algorithms.

### 🔒 Local-First Privacy

All data stays on your device. We literally cannot see what you capture.

### 🐦 X/Twitter Capture

Three modes:
- **Mirror** — Capture from everyone you follow
- **Whitelist** — Only specified accounts
- **Mirror + Blacklist** — Mirror minus specific accounts

### 📡 RSS Integration

Subscribe to any RSS/Atom feed. OPML import for migrating from other readers.

### 🔄 Cross-Device Sync

Automerge CRDT enables conflict-free sync via local relay or cloud backup (Google Drive, iCloud, Dropbox). No central server.

### ⚓ Ulysses Mode _(Coming Soon)_

Browser extension that blocks platform feeds and redirects to FREED.

### 📍 Friend Map _(Coming Soon)_

See where your friends are posting from.

---

## Quick Start

### RSS Capture

```bash
cd skills/capture-rss && npx tsx src/index.ts add https://simonwillison.net
npx tsx src/index.ts sync
npx tsx src/index.ts recent 20
```

### X/Twitter Capture

```bash
cd skills/capture-x && npx tsx src/index.ts status
npx tsx src/index.ts mode mirror_blacklist
npx tsx src/index.ts sync
```

---

## Roadmap

### Phase 0–2: Foundation ✓

Marketing site, monorepo, `capture-x`, `capture-rss`.

### Phase 3: Save for Later

URL capture with Readability extraction. [Plan](docs/PHASE-3-SAVE-FOR-LATER.md)

### Phase 4: Sync Layer

Local WebSocket relay + cloud backup. [Plan](docs/PHASE-4-SYNC.md)

### Phase 5: Desktop App 🎯

**HIGHEST PRIORITY** — Native app bundling capture, sync, and reader UI. [Plan](docs/PHASE-5-DESKTOP.md)

### Phase 6: PWA Reader

Mobile companion at freed.wtf/app. [Plan](docs/PHASE-6-PWA.md)

### Phase 7: Facebook + Instagram

DOM scraping via headless browser. [Plan](docs/PHASE-7-SOCIAL-CAPTURE.md)

### Phase 8: Friend Map

Location-based social view. [Plan](docs/PHASE-8-FRIEND-MAP.md)

### Phase 9: Browser Extension

Quick saves and Ulysses mode. [Plan](docs/PHASE-9-BROWSER-EXTENSION.md)

### Phase 10: Polish

Onboarding, statistics, accessibility. [Plan](docs/PHASE-10-POLISH.md)

### Phase 11: OpenClaw Integration

Headless capture for power users. [Plan](docs/PHASE-11-OPENCLAW.md)

### Phase 12: Additional Platforms

LinkedIn, TikTok, Threads. [Plan](docs/PHASE-12-ADDITIONAL-PLATFORMS.md)

---

## Key Decisions

1. **Desktop App as hub** — Capture + sync + UI in one installable package
2. **Zero external infrastructure** — Local relay + user's cloud storage
3. **Automerge CRDT** — Conflict-free multi-device sync
4. **Tiered accessibility** — PWA-only → Desktop → OpenClaw (increasing capability)
5. **Capture layer pattern** — Each source normalizes to unified `FeedItem`

---

## Configuration

**Operational settings** (`~/.freed/config.json`):

```json
{
  "capture-x": { "pollInterval": 5, "browser": "chrome" },
  "capture-rss": { "pollInterval": 30 }
}
```

**Subscriptions & preferences** sync via Automerge document.

---

## Contributing

FREED is open source. See [CONTRIBUTING.md](CONTRIBUTING.md).

Areas where we need help:
- Desktop app UI
- Additional capture layers
- Sync layer implementation
- Testing

---

## Legal

FREED operates locally using your own authenticated sessions. All data stays local. We have no servers and collect no data.

See [docs/LEGAL.md](docs/LEGAL.md).

---

## License

MIT. See [LICENSE](LICENSE).

---

## Philosophy

- Your attention belongs to you
- Algorithms should serve your goals, not theirs
- Social media should facilitate human connection, not replace it

Read the manifesto at [freed.wtf/manifesto](https://freed.wtf/manifesto).

---

_Built for humans, not engagement metrics._
