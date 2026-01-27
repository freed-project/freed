# FREED

**What They Fear.**

> *The platforms built empires on your attention—and you just walked out the door.*

---

## Mental Sovereignty. Digital Dignity. Your MIND is not for sale.

FREED is an open-source browser extension that captures your social media feeds locally and lets you build your own unified timeline. No algorithms. No manipulation. No data collection. Just you, your content, and the people you actually care about.

**Website:** [freed.wtf](https://freed.wtf)

---

## Features

### 🔒 Local-First Privacy
All your data stays on your device. No servers, no tracking, no telemetry. We literally cannot see what you capture.

### 🌊 Unified Feed
One feed combining X, Facebook, and Instagram—weighted by what matters to you, not what maximizes their engagement metrics.

### 📍 Friend Map
See where your friends actually are in real life. Location extraction from posts and stories builds a live map. Social media should facilitate human connection, not replace it.

### ⚓ Ulysses Mode
A Ulysses pact against algorithmic manipulation. Block the platform feeds entirely and engage only through FREED. Choose your constraints before the Sirens start singing.

### 🔄 Cross-Device Sync
CRDT-powered sync across all your devices. Peer-to-peer when available, encrypted cloud backup when you want it.

### 💜 Open Source
MIT licensed. Fork it, audit it, improve it. The algorithm that serves you best is the one you wrote yourself.

---

## Project Structure

```
freed/
├── website/          # Marketing site (freed.wtf)
├── docs/             # Documentation
│   ├── ARCHITECTURE.md
│   ├── DESIGN.md
│   ├── MARKETING.md
│   ├── ROADMAP.md
│   └── LEGAL.md
├── freed/            # Main monorepo (coming soon)
│   ├── packages/
│   │   ├── shared/   # Shared types, CRDT schema
│   │   ├── extension/# Browser extension
│   │   └── pwa/      # Progressive Web App
│   └── docs/
└── mobile/           # Tauri mobile app (Phase 2)
```

---

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Bun
- **Build:** Vite
- **Extensions:** Chrome (MV3), Safari iOS, Firefox Android
- **Storage:** Automerge (CRDT) + IndexedDB
- **Sync:** WebRTC P2P + encrypted cloud backup
- **PWA:** React + Tailwind + Workbox
- **Maps:** MapLibre GL JS + Nominatim

---

## Development Status

| Phase | Status |
|-------|--------|
| Marketing Site | 🟡 In Progress |
| Foundation | ⚪ Pending |
| X Capture | ⚪ Pending |
| Facebook/Instagram | ⚪ Pending |
| Location/Friend Map | ⚪ Pending |
| Sync Layer | ⚪ Pending |
| Mobile Extensions | ⚪ Pending |
| Ulysses Mode | ⚪ Pending |
| Polish | ⚪ Pending |
| Native Mobile | ⚪ Future |

---

## Contributing

FREED is open source and welcomes contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Areas where we need help:
- Platform-specific DOM selectors
- Browser compatibility testing
- UI/UX design
- Documentation and translations
- Community building

---

## Legal

FREED operates in the user's browser on their own authenticated session—similar to ad blockers and browser developer tools. All data stays local. We have no servers and collect no data.

See [docs/LEGAL.md](docs/LEGAL.md) for full legal framework.

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

## Philosophy

> "The algorithm that serves you best is the one you wrote yourself."
> — *The Codex of Digital Autonomy*

FREED exists because we believe:
- Your attention belongs to you
- Algorithms should be transparent
- Technology should connect humans, not replace connection
- Freedom requires intentionality

Read the full manifesto at [freed.wtf/manifesto](https://freed.wtf/manifesto).

---

*Built for humans, not engagement metrics.*
