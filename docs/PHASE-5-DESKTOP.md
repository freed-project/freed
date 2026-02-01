# Phase 5: Desktop App (Tauri)

> **Status:** Not Started  
> **Dependencies:** Phase 4 (Sync Layer)  
> **Priority:** 🎯 HIGHEST — Universal liberation tool

---

## Overview

The universal liberation tool. Anyone can install this and escape algorithmic manipulation without technical setup. Packages all capture + sync + UI into a native desktop app.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      FREED Desktop (Tauri)                      │
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

| Element | Implementation |
|---------|----------------|
| Window background | Tauri `vibrancy: "under-window"` (native blur) |
| Sidebar | Translucent, CSS `backdrop-filter` on dark base |
| Buttons | CSS glass approximation, SwiftUI later |
| Cards | Dark cards with subtle borders, content-first |
| Reader pane | Clean typography, large hero images |

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
  --accent: #FF6B35;
  --accent-hover: #FF8555;
}
```

---

## Tauri Configuration

```json
// src-tauri/tauri.conf.json
{
  "windows": [{
    "title": "FREED",
    "width": 1200,
    "height": 800,
    "transparent": true,
    "decorations": false,
    "macOSConfig": {
      "vibrancy": "under-window",
      "vibrancyState": "followsWindowActiveState"
    }
  }]
}
```

---

## Playwright Integration

For DOM capture (Facebook, Instagram), use system Chrome via Playwright subprocess:

```typescript
// capture-service/src/dom-capture.ts
import { chromium } from 'playwright-core';

export async function captureDomFeed(
  platform: 'facebook' | 'instagram',
  cookies: Cookie[]
): Promise<FeedItem[]> {
  const browser = await chromium.launch({ 
    channel: 'chrome',  // Use system Chrome
    headless: true 
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

| Task | Description | Complexity |
|------|-------------|------------|
| 5.1 | Tauri 2.0 project scaffold | Medium |
| 5.2 | Embed PWA React app in WebView | Medium |
| 5.3 | Native window vibrancy (macOS) | Low |
| 5.4 | Menu bar icon + background mode | Medium |
| 5.5 | Local WebSocket relay | Medium |
| 5.6 | Playwright subprocess setup | High |
| 5.7 | System tray with sync status | Low |
| 5.8 | QR code display for phone pairing | Low |
| 5.9 | Auto-launch on login (optional) | Low |
| 5.10 | macOS notarization + DMG packaging | High |
| 5.11 | Windows installer | Medium |

---

## Success Criteria

- [ ] Desktop app launches with native vibrancy on macOS
- [ ] Captures from X, RSS in background
- [ ] Local WebSocket relay enables instant phone sync
- [ ] QR code pairing works
- [ ] System tray shows sync status
- [ ] App runs in background after window close
- [ ] macOS DMG is notarized and installable
- [ ] Windows installer works

---

## Deliverable

Native desktop app with capture, sync, and reader UI. No CLI or technical setup required.

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
