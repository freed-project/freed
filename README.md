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
- 🔄 **Cross-device sync** — Automerge CRDT via local relay and cloud backup
- 📌 **Save for later** — Capture any URL with reader view
- ⚓ **Ulysses mode** — Block platform feeds, stay intentional
- 📍 **Friend map** — See where your people are posting from

---

## Architecture

```
  Capture Layers              Sync                    Clients
 ─────────────────      ─────────────────      ─────────────────
  X, RSS, Facebook,  →   Automerge CRDT   →    Desktop App
  Instagram, etc.        Local + Cloud          Phone PWA
                                                Extension
```

**Desktop App is the hub.** It runs capture, hosts the sync relay, and provides the reader UI. Phone PWA syncs to it for mobile reading. OpenClaw users can run capture headlessly instead.

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

Marketing site, monorepo, Automerge schema, CI/CD.

### [Phase 2: Capture Skills](docs/PHASE-2-CAPTURE-SKILLS.md) ✓

`capture-x` and `capture-rss` packages with OpenClaw skill wrappers.

### [Phase 3: Save for Later](docs/PHASE-3-SAVE-FOR-LATER.md) ✓

URL capture with Readability extraction.

### [Phase 4: Sync Layer](docs/PHASE-4-SYNC.md) 🚧

Local WebSocket relay + cloud backup.

### [Phase 5: Desktop & Mobile App](docs/PHASE-5-DESKTOP.md) 🎯

**HIGHEST PRIORITY** — Native apps (macOS, Windows, Linux, iOS, Android) bundling capture, sync, and reader UI.

### [Phase 6: PWA Reader](docs/PHASE-6-PWA.md) 🚧

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

1. **Desktop App as hub** — Capture + sync + UI in one installable package
2. **Zero external infrastructure** — Local relay + user's cloud storage (GDrive, Dropbox, iCloud)
3. **Automerge CRDT** — Conflict-free multi-device sync
4. **Shared React codebase** — `packages/pwa/` embedded in Desktop AND deployed standalone
5. **TypeScript capture via subprocess** — Capture packages run as TypeScript, not compiled into Tauri's Rust core. Easier to extend, easier to debug.
6. **Ranking on core, display on edge** — Desktop/OpenClaw computes `priority`, PWA just displays
7. **Capture layer pattern** — Each source normalizes to unified `FeedItem`
8. **Next.js for marketing site** — SSG for SEO, React for consistency with app codebase

---

## Quick Start

### Prerequisites

```bash
# Clone and install dependencies
git clone https://github.com/cyberspatial/freed.git
cd freed
cat .nvmrc          # expected Node version
npm install
```

This repo expects the Node version in `.nvmrc` and the matching npm release
declared in `package.json`. If your shell still resolves `npm` from somewhere
like `/usr/local/bin/npm`, run the npm that lives next to your active `node`
binary instead.

### Worktrees

Use the helper instead of bare `git worktree add`:

```bash
./scripts/worktree-add.sh ../freed-my-branch -b feat/my-branch
```

The helper now:

- detects the new worktree path by diffing the worktree list before and after creation
- installs dependencies with the npm binary that matches the active Node runtime
- avoids the broken "last worktree wins" assumption that can install into the wrong checkout

When the branch is ready to publish, use:

```bash
./scripts/worktree-publish.sh --title "fix: describe the change" --summary "What changed for the user" --test "Focused check you ran"
```

That stages the worktree, creates the commit when needed, pushes the branch to
`origin`, and opens a draft PR.

### Marketing Website (freed.wtf)

```bash
cd website
npm run dev        # Dev server at http://localhost:3000
npm run build      # Production build
```

### PWA Reader

```bash
cd packages/pwa
npm run dev        # Dev server at http://localhost:5173
npm run build      # Production build
npm run test       # Run Playwright tests
```

### Desktop App (Tauri)

Requires [Rust](https://rustup.rs/) and platform-specific dependencies. See [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
cd packages/desktop
npm run tauri:dev    # Dev mode with hot reload
npm run tauri:build  # Build distributable (DMG, EXE, etc.)
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

**Subscriptions & preferences** sync via Automerge document.

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
