# Phase 5: Desktop & Mobile App (Tauri)

> **Status:** 🚧 In Progress (direct desktop distribution live, macOS signing and notarization live in releases, legal consent gate shipped)
> **Dependencies:** Phase 4 (Sync Layer)  
> **Priority:** 🎯 HIGHEST — Universal liberation tool

---

## Overview

The universal liberation tool. Anyone can install this and escape algorithmic manipulation without technical setup. This phase packages capture, sync, and UI into Freed Desktop for direct distribution on macOS, Windows, and Linux.

Large app store distribution is not part of the current strategy. The mobile reading surface lives in the PWA, and native mobile packaging stays explicitly out of the critical path.

**Key architectural decisions:**

- **TypeScript capture via subprocess** — Existing `capture-x`, `capture-rss` packages run via Node/Bun subprocess, not rewritten in Rust
- **Shared React codebase** — `packages/pwa/` is embedded in WebView AND deployed standalone to app.freed.wtf
- **X authentication via WebView** — User logs into X inside the app; cookies captured from WebView session
- **Ranking runs here** — Desktop computes `priority` scores, syncs to PWA via Automerge
- **Versioned legal gate** — Freed Desktop blocks startup side effects until the current legal bundle is accepted locally on-device
- **Provider risk interstitials** — X, Facebook, Instagram, and LinkedIn require separate local consent before login or sync actions

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Freed Desktop (Tauri)                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    WebView (React PWA)                   │   │
│  │  ┌─────────┐  ┌─────────────────────────────────────┐   │   │
│  │  │ Sources │  │         Unified Timeline            │   │   │
│  │  │ ─────── │  │                                     │   │   │
│  │  │ All     │  │  [Article cards with glass UI]      │   │   │
│  │  │ X       │  │                                     │   │   │
│  │  │ RSS     │  │                                     │   │   │
│  │  │ Saved   │  └─────────────────────────────────────┘   │   │
│  │  └─────────┘                                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌───────────────────────────┼───────────────────────────────┐ │
│  │                    Native Layer (Rust)                     │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │ │
│  │  │capture-x │  │capture-  │  │capture-  │  │  Local   │  │ │
│  │  │  (API)   │  │   rss    │  │   dom    │  │  Relay   │  │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │ │
│  │                      │                                     │ │
│  │               ┌──────┴──────┐                              │ │
│  │               │  Playwright │  (headless, system Chrome)   │ │
│  │               └─────────────┘                              │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

```
packages/desktop/
├── src/                      # React UI (shared with PWA)
├── src-tauri/
│   ├── src/
│   │   ├── main.rs          # Entry point
│   │   ├── capture.rs       # Capture orchestration
│   │   ├── relay.rs         # WebSocket server
│   │   └── tray.rs          # System tray
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
└── tsconfig.json
```

---

## UI Design

**Three-column layout, dark theme, native vibrancy**

| Element           | Implementation                                  |
| ----------------- | ----------------------------------------------- |
| Window background | Tauri `vibrancy: "under-window"` (native blur)  |
| Sidebar           | Translucent, CSS `backdrop-filter` on dark base |
| Buttons           | CSS glass approximation, SwiftUI later          |
| Cards             | Dark cards with subtle borders, upper-right social actions, read-state dimming |
| Reader pane       | Clean typography, large hero images, toolbar open action |

---

## Design Tokens

```css
/* Dark glass theme */
:root {
  --bg-primary: rgba(18, 18, 18, 0.85);
  --bg-sidebar: rgba(28, 28, 30, 0.7);
  --bg-card: rgba(44, 44, 46, 0.9);
  --bg-card-hover: rgba(58, 58, 60, 0.9);
  --border-glass: rgba(255, 255, 255, 0.08);
  --border-glass-strong: rgba(255, 255, 255, 0.15);
  --text-primary: rgba(255, 255, 255, 0.92);
  --text-secondary: rgba(255, 255, 255, 0.55);
  --text-tertiary: rgba(255, 255, 255, 0.35);
  --accent: #ff6b35;
  --accent-hover: #ff8555;
}
```

---

## Tauri Configuration

```json
// src-tauri/tauri.conf.json
{
  "windows": [
    {
      "title": "Freed",
      "width": 1200,
      "height": 800,
      "transparent": true,
      "decorations": false,
      "macOSConfig": {
        "vibrancy": "under-window",
        "vibrancyState": "followsWindowActiveState"
      }
    }
  ]
}
```

---

## Playwright Integration

For DOM capture (Facebook, Instagram), use system Chrome via Playwright subprocess:

```typescript
// capture-service/src/dom-capture.ts
import { chromium } from "playwright-core";

export async function captureDomFeed(
  platform: "facebook" | "instagram",
  cookies: Cookie[]
): Promise<FeedItem[]> {
  const browser = await chromium.launch({
    channel: "chrome", // Use system Chrome
    headless: true,
  });

  const context = await browser.newContext();
  await context.addCookies(cookies);

  const page = await context.newPage();
  // Platform-specific capture logic...

  await browser.close();
  return items;
}
```

---

## Tasks

### Desktop

| Task | Description                        | Complexity |
| ---- | ---------------------------------- | ---------- |
| 5.1  | Tauri 2.0 project scaffold         | Medium     |
| 5.2  | Embed PWA React app in WebView     | Medium     |
| 5.3  | Native window vibrancy (macOS)     | Low        |
| 5.4  | Menu bar icon + background mode    | Medium     |
| 5.5  | Local WebSocket relay              | Medium     |
| 5.6  | Playwright subprocess setup        | High       |
| 5.7  | System tray with sync status       | Low        |
| 5.8  | QR code display for phone pairing  | Low        |
| 5.9  | Auto-launch on login (optional)    | Low        |
| 5.10 | macOS notarization + DMG packaging | High       |
| 5.11 | Windows installer                  | Medium     |
| 5.12 | Linux AppImage/Flatpak             | Medium     |
| 5.22 | Auto-updater (tauri-plugin-updater)| Medium     |
| 5.23 | CI/CD release pipeline (GH Actions)| Medium     |
| 5.24 | macOS code signing + notarization  | High       |
| 5.25 | Windows code signing               | Medium     |
| 5.26 | Independent update server domain   | Medium     |
| 5.27 | First-run legal gate and local-only acceptance storage | Medium |
| 5.28 | Provider-specific risk interstitials for social capture | Medium |

---

## Success Criteria

### Desktop

- [x] Desktop app launches with native vibrancy on macOS
- [x] Captures from X, RSS in background (refreshAllFeeds covers both)
- [x] Local WebSocket relay enables instant phone sync (binary protocol)
- [x] QR code pairing works (token-authenticated; local SVG render, no third-party QR API)
- [x] System tray shows sync status
- [x] App runs in background after window close
- [x] Auto-updater checks GitHub Releases and installs updates in-app
- [x] CI/CD release pipeline builds for macOS (ARM + Intel), Windows, Linux on tag push
- [x] App icons generated for all platforms
- [x] macOS DMG builds
- [x] Windows NSIS + MSI installers build
- [x] Linux AppImage, .deb, .rpm all build
- [x] All updater artifacts signed and uploaded to GitHub Releases
- [x] First launch is blocked behind a local-only legal clickwrap gate
- [x] Provider-specific capture flows require additional local risk consent
- [x] Legal acceptance stays outside synced Automerge state
- [x] Desktop E2E test infrastructure bootstrapped (Playwright + VITE_TEST_TAURI=1 mock layer)
- [x] Performance benchmarks: MiniSearch lazy-build fix reduces markAsRead from ~300ms to ~30ms (10x)
- [x] macOS DMG is notarized in CI releases
- [ ] Windows installer is code-signed (requires EV certificate)
- [ ] Update server runs on a Freed-owned domain (not GitHub Releases)

> **Current state:**
> macOS release builds are signed and notarized in GitHub Actions when the
> required Apple secrets are present. The release workflow now fails fast
> instead of silently shipping an unsigned macOS artifact. Windows
> SmartScreen warnings will still appear until an EV certificate is
> obtained or enough installs build reputation. See `RELEASE-SECRETS.md`
> for the full setup checklist.

> **Planned — Independent Update Server (Task 5.26):**
> The auto-updater currently points at GitHub Releases. If the repo is
> taken down, transferred, or GitHub has a prolonged outage, every
> installed copy of Freed loses the ability to update. To ensure project
> continuity, we need a Freed-owned domain (e.g. `updates.freed.wtf`)
> serving the Tauri update manifest and release artifacts. The CI/CD
> pipeline would upload binaries to this endpoint in addition to (or
> instead of) GitHub Releases, and `tauri.conf.json` would point the
> updater at the Freed-controlled URL. A static file host behind
> Cloudflare or a simple S3 bucket is sufficient; no custom server logic
> required.

### Mobile

- [ ] iOS app builds and runs
- [ ] Android app builds and runs
- [ ] Syncs with Desktop when on same network
- [ ] Falls back to cloud sync when away
- [ ] Background refresh works (iOS)
- [ ] Background service works (Android)
- [ ] App Store approved
- [ ] Play Store approved

---

## Deliverable

Native apps for **macOS, Windows, Linux, iOS, and Android** with capture, sync, and reader UI. No CLI or technical setup required.

---

## Dependencies

```toml
# Cargo.toml
[dependencies]
tauri = { version = "2", features = ["macos-private-api"] }
tokio = { version = "1", features = ["full"] }
```

```json
{
  "dependencies": {
    "@freed/shared": "*",
    "@freed/sync": "*",
    "@freed/pwa": "*"
  }
}
```
