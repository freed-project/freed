# FREED Roadmap

> **Philosophy:** "Their algorithms optimize for profit. Optimize yours for life."

---

## Vision

Capture your social feeds locally. Tune the ranking algorithm yourself. Sync across devices. No cloud dependency, no tracking, no algorithmic manipulation.

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
│                 ┌──────────────────┴──────────────────┐                    │
│                 │                                     │                    │
│   ┌───────────┐ │ ┌───────────┐ ┌───────────┐       │                    │
│   │ capture-  │ │ │ capture-  │ │ capture-  │  ...  │                    │
│   │ linkedin  │ │ │  tiktok   │ │  threads  │       │                    │
│   └─────┬─────┘ │ └─────┬─────┘ └─────┬─────┘       │                    │
│         └───────┴───────┴─────────────┘             │                    │
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
│          │                                                   │              │
└──────────┼───────────────────────────────────────────────────┼──────────────┘
           │                                                   │
┌──────────┼───────────────────────────────────────────────────┼──────────────┐
│          │                  CLIENT LAYER                     │              │
│          ▼                                                   ▼              │
│   ┌─────────────┐                                     ┌─────────────┐       │
│   │ Desktop App │ ◄───────────────────────────────────│  Phone PWA  │       │
│   │  (primary)  │        real-time sync               │  (mobile)   │       │
│   │             │                                     │             │       │
│   │ • Capture   │                                     │ • Read      │       │
│   │ • Sync hub  │                                     │ • Offline   │       │
│   │ • Reader UI │                                     │ • Portable  │       │
│   └─────────────┘                                     └─────────────┘       │
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

| Package | Sources | Method | Phase |
|---------|---------|--------|-------|
| `capture-x` | X/Twitter | GraphQL API | ✓ Complete |
| `capture-rss` | Blogs, Medium, Substack, YouTube, podcasts, Mastodon, Reddit, GitHub | RSS/Atom | ✓ Complete |
| `capture-save` | Any URL | Readability extraction | Phase 3 |
| `capture-facebook` | Facebook | DOM scraping | Phase 7 |
| `capture-instagram` | Instagram | DOM scraping | Phase 7 |
| `capture-linkedin` | LinkedIn | DOM scraping | Phase 11 |
| `capture-tiktok` | TikTok | TBD | Phase 11 |
| `capture-threads` | Threads | TBD | Phase 11 |

---

## Roadmap

### Phase 0: Marketing Site ✓

Landing page at freed.wtf with manifesto.

---

### Phase 1: Foundation ✓

Monorepo setup, `@freed/shared` types, Automerge schema, CI/CD.

---

### Phase 2: Capture Skills ✓

`capture-x` and `capture-rss` packages with OpenClaw skill wrappers.

---

### Phase 3: Save for Later

Independent capture layer for manually saved URLs.

**Deliverable:** `@freed/capture-save` package

**Plan:** [docs/PHASE-3-SAVE-FOR-LATER.md](docs/PHASE-3-SAVE-FOR-LATER.md)

---

### Phase 4: Sync Layer

Local WebSocket relay + cloud backup. No external servers.

**Deliverable:** `@freed/sync` package

**Plan:** [docs/PHASE-4-SYNC.md](docs/PHASE-4-SYNC.md)

---

### Phase 5: Desktop App

🎯 **HIGHEST PRIORITY** — The universal liberation tool.

Native app that bundles capture, sync relay, and reader UI. Install and go—no technical setup required.

**Deliverable:** macOS app (Windows later)

**Plan:** [docs/PHASE-5-DESKTOP.md](docs/PHASE-5-DESKTOP.md)

---

### Phase 6: PWA Reader

Mobile companion for on-the-go reading. Timeline-focused, offline-capable.

**Deliverable:** PWA at freed.wtf/app

**Plan:** [docs/PHASE-6-PWA.md](docs/PHASE-6-PWA.md)

---

### Phase 7: Facebook + Instagram

DOM scraping via Desktop App's headless browser. Each platform is its own capture layer.

**Deliverables:**
- `@freed/capture-facebook`
- `@freed/capture-instagram`

**Plan:** [docs/PHASE-7-SOCIAL-CAPTURE.md](docs/PHASE-7-SOCIAL-CAPTURE.md)

---

### Phase 8: Friend Map

Map view showing where friends have posted from.

**Deliverable:** Friend Map in PWA/Desktop

**Plan:** [docs/PHASE-8-FRIEND-MAP.md](docs/PHASE-8-FRIEND-MAP.md)

---

### Phase 9: Browser Extension

Quick saves and Ulysses mode (feed blocking).

**Deliverable:** Chrome extension

**Plan:** [docs/PHASE-9-BROWSER-EXTENSION.md](docs/PHASE-9-BROWSER-EXTENSION.md)

---

### Phase 10: Polish

Onboarding, statistics, accessibility, OpenClaw power features.

**Plan:** [docs/PHASE-10-POLISH.md](docs/PHASE-10-POLISH.md)

---

### Phase 11: Additional Platforms

Expand capture to more walled gardens. Each platform gets its own capture layer.

**Deliverables:**
- `@freed/capture-linkedin`
- `@freed/capture-tiktok`
- `@freed/capture-threads`

**Plan:** [docs/PHASE-11-ADDITIONAL-PLATFORMS.md](docs/PHASE-11-ADDITIONAL-PLATFORMS.md)

---

## Key Decisions

1. **Desktop App as hub** — Capture + sync + UI in one installable package
2. **Zero external infrastructure** — Local relay + user's cloud storage
3. **Automerge CRDT** — Conflict-free multi-device sync
4. **Tiered accessibility** — PWA-only → Desktop → OpenClaw (increasing capability)
5. **Capture layer pattern** — Each source normalizes to unified `FeedItem`

---

## Resources

- [Automerge](https://automerge.org/)
- [X API Research](https://github.com/fa0311/TwitterInternalAPIDocument)
- [OpenClaw Skills](https://docs.clawd.bot/tools/skills-config)

---

_Built for humans, not engagement metrics._
