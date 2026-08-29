# FREEDme

> **Their algorithms optimize for profit. Optimize yours for life.**

Capture your social/rss/newsletter feeds locally. Tune the ranking algo yourself. Sync across devices. No cloud dependency, no tracking, no algorithmic manipulation.

[Freed.wtf](https://freed.wtf)

---

## Branch Flow

- `dev` is the default integration branch
- `main` is the production promotion branch
- Production web surfaces live at `freed.wtf` and `app.freed.wtf`
- Dev web surfaces live at `dev.freed.wtf` and `dev-app.freed.wtf`

---

## Features

- 🌊 **Unified feed** — X, RSS, YouTube, newsletters, podcasts in one timeline
- ⚖️ **Your ranking** — Weight by recency, author, topic, custom semantics. Not engagement
- 🔒 **Local-first** — All data on your device, we can't see it
- 🔄 **Cross-device sync** — Your devices stay in step directly, with your own cloud storage as backup
- 📌 **Save for later** — Capture any URL with reader view
- ⚓ **Ulysses mode** — Block platform feeds, stay intentional
- 📍 **Friend map** — See where your people are posting from

---

## Architecture

Freed uses SQLite everywhere. Freed Desktop and the headless Primary share one
native Rust core. The PWA runs official SQLite WebAssembly over OPFS. Every
view uses bounded typed queries, and synchronization exchanges normalized
signed logical objects rather than database files or a monolithic Library
document. See
[the Library Core architecture](docs/LIBRARY-CORE-ARCHITECTURE.md) and
[the detailed contract](docs/LIBRARY-CORE-CONTRACT.md).

```
  Capture Layers              Sync                    Clients
 ─────────────────      ─────────────────      ─────────────────
  X, RSS, Facebook,  →   Sync + Storage   →    Desktop App
  Instagram, etc.        Local + Cloud          Phone PWA
                                                Extension
```

One active Primary admits canonical mutations. The Primary may run inside
Freed Desktop or the headless service. Freed Desktop and PWA followers keep
fully queryable local SQLite replicas, apply edits through durable signed
intent overlays, and choose independently which large content to stream,
cache, pin offline, or exclude.

---

## Capture Layers

| Package             | Sources                                                              | Method                 | Status     |
| ------------------- | -------------------------------------------------------------------- | ---------------------- | ---------- |
| `capture-x`         | X/Twitter                                                            | GraphQL API            | ✓ Complete |
| `capture-rss`       | Blogs, Medium, Substack, YouTube, podcasts, Mastodon, Reddit, GitHub | RSS/Atom               | ✓ Complete |
| `capture-save`      | Any URL                                                              | Readability extraction | ✓ Complete |
| `capture-facebook`  | Facebook                                                             | DOM scraping           | Phase 7    |
| `capture-instagram` | Instagram                                                            | DOM scraping           | Phase 7    |
| `capture-linkedin`  | LinkedIn                                                             | DOM scraping           | Phase 12   |
| `capture-tiktok`    | TikTok                                                               | TBD                    | Phase 12   |
| `capture-threads`   | Threads                                                              | TBD                    | Phase 12   |

---

## Roadmap

### [Phase 1: Foundation](docs/PHASE-1-FOUNDATION.md) ✓

Marketing site, monorepo, sync schema, CI/CD.

### [Phase 2: Capture Skills](docs/PHASE-2-CAPTURE-SKILLS.md) ✓

`capture-x` and `capture-rss` packages with OpenClaw skill wrappers.

### [Phase 3: Save for Later](docs/PHASE-3-SAVE-FOR-LATER.md) ✓

URL capture with Readability extraction.

### [Phase 4: Sync Layer](docs/PHASE-4-SYNC.md) 🚧

Local WebSocket relay + cloud backup.

### [Phase 5: Desktop & Mobile App](docs/PHASE-5-DESKTOP.md) 🎯

**HIGHEST PRIORITY** — Native apps (macOS, Windows, Linux, iOS, Android) bundling capture, sync, and reader UI.

### [Phase 6: PWA](docs/PHASE-6-PWA.md) 🚧

Mobile companion at [app.freed.wtf](https://app.freed.wtf), with the dev channel at `dev-app.freed.wtf`.

### [Phase 7: Facebook + Instagram](docs/PHASE-7-SOCIAL-CAPTURE.md)

DOM scraping via headless browser.

### [Phase 8: Friend Map](docs/PHASE-8-FRIEND-MAP.md)

Location-based social view.

### [Phase 9: Browser Extension](docs/PHASE-9-BROWSER-EXTENSION.md)

Quick saves and Ulysses mode.

### [Phase 10: Polish](docs/PHASE-10-POLISH.md)

Onboarding, statistics, accessibility.

### [Phase 11: Power User Integrations](docs/PHASE-11-OPENCLAW.md)

Headless capture via OpenClaw CLI (no Desktop App required) + [Omi](https://www.omi.me/) wearable integration to surface voice memories and meeting summaries as feed items.

### [Phase 12: Additional Platforms](docs/PHASE-12-ADDITIONAL-PLATFORMS.md)

LinkedIn, TikTok, Threads, Bluesky, Reddit, YouTube.

### [Phase 13: POSSE Integration](docs/PHASE-13-POSSE.md)

Compose and publish through your own site.

---

## Key Decisions

1. **One active Primary:** Freed Desktop or the headless service admits canonical mutations through the same native Library Core
2. **No Freed content backend:** Synchronization uses storage owned by the user
3. **SQLite everywhere:** Every client queries a local SQLite Library through one generated contract
4. **Shared React views:** `packages/ui` consumes platform-neutral typed query and mutation adapters
5. **Typed capture boundary:** Provider packages normalize bounded values and submit registered mutations
6. **Ranking in the Primary:** Canonical scores are materialized through signed Primary operations and queried locally on every client
7. **Logical-object sync:** Devices exchange signed normalized records and selective content, never database files
8. **Next.js for the marketing site:** The public site remains isolated in the `www` lane

---

## Quick Start

### Prerequisites

```bash
# Match the repo toolchain
nvm use

# Clone and install dependencies
git clone https://github.com/cyberspatial/freed.git
cd freed
npm run setup
```

### Local Feature Previews

Use `./scripts/worktree-preview.sh pwa` or `./scripts/worktree-preview.sh desktop` from a product worktree. The helper marks PWA and Freed Desktop previews as feature previews, accepts local legal gates, and seeds sample data so the app opens ready for inspection.

### Marketing Website (freed.wtf)

```bash
npm run website:dev    # Dev server at http://localhost:3000
npm run website:build  # Production build
```

### PWA

```bash
npm run pwa:dev    # Dev server at http://localhost:5173
npm run pwa:build  # Production build
npm run pwa:test   # Run Playwright tests
```

### Desktop App (Tauri)

Requires [Rust](https://rustup.rs/) and platform-specific dependencies. See [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm run desktop:dev    # Dev mode with hot reload
npm run desktop:build  # Build distributable (DMG, EXE, etc.)
```

### Capture Skills (CLI)

#### RSS Capture

```bash
cd skills/capture-rss
npx tsx src/index.ts add https://simonwillison.net   # Subscribe to feed
npx tsx src/index.ts sync                            # Fetch new items
npx tsx src/index.ts recent 20                       # Show recent items
npx tsx src/index.ts list                            # List subscriptions
```

#### X/Twitter Capture

```bash
cd skills/capture-x
npx tsx src/index.ts status                          # Auth status
npx tsx src/index.ts mode mirror_blacklist           # Set capture mode
npx tsx src/index.ts sync                            # Fetch timeline
npx tsx src/index.ts recent 20                       # Show recent items
```

#### Save for Later

```bash
cd skills/capture-save
npx tsx src/index.ts add https://example.com/article # Save URL
npx tsx src/index.ts add https://... --tags "tech"   # Save with tags
npx tsx src/index.ts list                            # List saved items
npx tsx src/index.ts search "keyword"                # Search saved content
```

### Build Everything

```bash
# From repo root
npm run build      # Build all packages
npm run typecheck  # Type-check all packages
```

---

## Configuration

**Operational settings** (`~/.freed/config.json`):

```json
{
  "capture-x": { "pollInterval": 5, "browser": "chrome" },
  "capture-rss": { "pollInterval": 30 }
}
```

**Subscriptions & preferences** sync across your devices.

---

## Contributing

Freed is open source. See [CONTRIBUTING.md](CONTRIBUTING.md).

Areas where we need help:

- Desktop app UI
- Additional capture layers
- Sync layer implementation
- Testing

---

## Legal

Freed operates locally using your own authenticated sessions. All data stays local. We have no servers and collect no data.

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

_Built for humans, not algorithms._
