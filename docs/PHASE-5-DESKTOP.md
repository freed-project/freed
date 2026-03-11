# Phase 5: Desktop & Mobile App (Tauri)

> **Status:** 🚧 In Progress (v0.2.0 binaries shipping for all platforms, code signing deferred)
> **Dependencies:** Phase 4 (Sync Layer)  
> **Priority:** 🎯 HIGHEST — Universal liberation tool

---

## Overview

The universal liberation tool. Anyone can install this and escape algorithmic manipulation without technical setup. Packages all capture + sync + UI into native apps for **desktop (macOS, Windows, Linux)** and **mobile (iOS, Android)**.

**Key architectural decisions:**

- **TypeScript capture via subprocess** — Existing `capture-x`, `capture-rss` packages run via Node/Bun subprocess, not rewritten in Rust
- **Shared React codebase** — `packages/pwa/` is embedded in WebView AND deployed standalone to app.freed.wtf
- **X authentication via WebView** — User logs into X inside the app; cookies captured from WebView session
- **Ranking runs here** — Desktop computes `priority` scores, syncs to PWA via Automerge
- **Tauri 2.0 for mobile** — Same codebase targets iOS and Android via Tauri's mobile support

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
| Cards             | Dark cards with subtle borders, content-first   |
| Reader pane       | Clean typography, large hero images             |

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

### Mobile (Tauri 2.0)

| Task | Description                      | Complexity |
| ---- | -------------------------------- | ---------- |
| 5.13 | iOS build configuration          | High       |
| 5.14 | Android build configuration      | High       |
| 5.15 | Mobile-responsive UI adjustments | Medium     |
| 5.16 | iOS background refresh           | Medium     |
| 5.17 | Android background service       | Medium     |
| 5.18 | Push notification integration    | Medium     |
| 5.19 | Apple Developer account setup    | Low        |
| 5.20 | App Store submission             | High       |
| 5.21 | Play Store submission            | Medium     |

---

## Mobile Architecture

Tauri 2.0 supports iOS and Android with the same React codebase.

```
packages/desktop/
├── src/                      # Shared React UI
├── src-tauri/
│   ├── src/
│   │   └── mobile.rs        # Mobile-specific Rust code
│   ├── gen/
│   │   ├── apple/           # Xcode project (generated)
│   │   └── android/         # Android Studio project (generated)
│   └── tauri.conf.json      # Mobile targets configured here
```

### Mobile Considerations

| Platform | Consideration                                           |
| -------- | ------------------------------------------------------- |
| iOS      | Background App Refresh for periodic sync                |
| iOS      | No Playwright—relies on Desktop for DOM capture         |
| Android  | Foreground service for background sync                  |
| Android  | No Playwright—relies on Desktop for DOM capture         |
| Both     | Simplified capture (RSS only, no X API without Desktop) |
| Both     | Primary use case: reading, not capturing                |

### Mobile vs Desktop

| Feature             | Desktop        | Mobile                |
| ------------------- | -------------- | --------------------- |
| X capture           | ✓ (API)        | ✗ (sync from Desktop) |
| RSS capture         | ✓              | ✓ (limited)           |
| DOM capture (FB/IG) | ✓ (Playwright) | ✗                     |
| Local relay server  | ✓ (hosts)      | ✗ (connects)          |
| Background sync     | ✓ (always)     | ✓ (periodic)          |
| Offline reading     | ✓              | ✓                     |

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
- [x] macOS DMG builds (notarization deferred)
- [x] Windows NSIS + MSI installers build
- [x] Linux AppImage, .deb, .rpm all build
- [x] All updater artifacts signed and uploaded to GitHub Releases
- [x] Desktop E2E test infrastructure bootstrapped (Playwright + VITE_TEST_TAURI=1 mock layer)
- [x] Performance benchmarks: MiniSearch lazy-build fix reduces markAsRead from ~300ms to ~30ms (10x)
- [ ] macOS DMG is notarized (requires APPLE_CERTIFICATE secret)
- [ ] Windows installer is code-signed (requires EV certificate)
- [ ] Update server runs on a Freed-owned domain (not GitHub Releases)

> **Deferred — Code Signing:**
> macOS notarization and Windows code signing require secrets to be
> configured in GitHub Actions. An Apple Developer certificate has been
> obtained but needs to be exported and added to GitHub secrets before
> Gatekeeper will allow unsigned-download installs. Until then, macOS
> users must bypass Gatekeeper via `xattr -cr Freed.app`.
> Windows SmartScreen warnings will appear until an EV certificate is
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
