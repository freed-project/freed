# Phase 9: Browser Extension

> **Status:** Not Started  
> **Dependencies:** Phase 7 (Facebook/Instagram), Phase 8 (Friend Map)

---

## Overview

Supplement to the Desktop App—quick saves and Ulysses mode. Not a primary capture mechanism. Multi-browser support including Chrome, Firefox, and Safari.

---

## Features

1. **One-click save** — Save any page to Freed library
2. **Ulysses mode** — Block social media feeds, allow specific paths
3. **DOM capture fallback** — When Desktop App not running
4. **Multi-browser support** — Chrome, Firefox Desktop, Firefox Android, Safari iOS/macOS

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser Extension (MV3)                       │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Popup     │  │  Content    │  │  Background │             │
│  │   (Save)    │  │  Scripts    │  │  Worker     │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          ▼                                      │
│                  ┌──────────────┐                               │
│                  │ Signed save  │                               │
│                  │    intent    │                               │
│                  └──────────────┘                               │
│                          │                                      │
│              ┌───────────┴───────────┐                          │
│              ▼                       ▼                          │
│       Local Primary             Intent segment                  │
│       (if running)              in user cloud                   │
│              │                       │                          │
│              └───────────┬───────────┘                          │
│                          ▼                                      │
│              Typed mutation into SQLite                        │
└─────────────────────────────────────────────────────────────────┘
```

The extension never owns a Library database and never emits a document patch.
It creates one closed save intent using the shared mutation contract. The
active Primary verifies and commits that intent through the native SQLite core,
either directly or after reading its immutable cloud segment.

---

## Package Structure

```
packages/extension/
├── src/
│   ├── popup/
│   │   ├── Popup.tsx        # Save button UI
│   │   └── popup.html
│   ├── content/
│   │   ├── ulysses.ts       # Feed blocking overlay
│   │   └── dom-capture.ts   # Fallback capture
│   ├── background/
│   │   └── worker.ts        # Background service
│   └── shared/
│       ├── storage.ts       # Chrome storage wrapper
│       └── sync.ts          # Connect to Desktop/Cloud
├── manifest.json
├── package.json
└── vite.config.ts
```

---

## One-Click Save

### Popup UI

```tsx
// packages/extension/src/popup/Popup.tsx
import { useState } from "react";
import { saveCurrentPage } from "../shared/save";

export function Popup() {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  const handleSave = async () => {
    setStatus("saving");

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    await saveCurrentPage(tab.url!, tab.title!);

    setStatus("saved");
    setTimeout(() => window.close(), 1000);
  };

  return (
    <div className="p-4 w-64">
      <h1 className="text-lg font-bold mb-4">Save to Freed</h1>

      <button
        onClick={handleSave}
        disabled={status === "saving"}
        className="w-full py-2 px-4 bg-orange-500 text-white rounded"
      >
        {status === "idle" && "Save Page"}
        {status === "saving" && "Saving..."}
        {status === "saved" && "✓ Saved"}
      </button>
    </div>
  );
}
```

### Save Integration

```typescript
// packages/extension/src/shared/save.ts
export async function saveCurrentPage(
  url: string,
  title: string
): Promise<void> {
  // Try Desktop App first
  const desktopConnected = await tryDesktopConnection();

  if (desktopConnected) {
    await sendToDesktop({ type: "save-url", url, title });
  } else {
    // Fall back to direct capture-save
    const metadata = await extractMetadata(url);
    const item = await createFeedItem(metadata);
    await saveToLocalStorage(item);
    await syncToCloud();
  }
}
```

---

## Ulysses Mode

### Content Script

```typescript
// packages/extension/src/content/ulysses.ts
const BLOCKED_FEEDS = {
  "twitter.com": ["/", "/home"],
  "x.com": ["/", "/home"],
  "facebook.com": ["/", "/home.php"],
  "instagram.com": ["/"],
};

const ALLOWED_PATHS = {
  "twitter.com": ["/messages", "/notifications", "/settings"],
  "x.com": ["/messages", "/notifications", "/settings"],
  "facebook.com": ["/messages", "/marketplace", "/settings"],
  "instagram.com": ["/direct", "/accounts"],
};

export function checkUlyssesMode(): void {
  const { hostname, pathname } = window.location;

  const blocked = BLOCKED_FEEDS[hostname];
  const allowed = ALLOWED_PATHS[hostname];

  if (!blocked) return; // Not a social site

  const isBlockedPath = blocked.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  const isAllowedPath = allowed.some((p) => pathname.startsWith(p));

  if (isBlockedPath && !isAllowedPath) {
    showUlyssesOverlay();
  }
}

function showUlyssesOverlay(): void {
  const overlay = document.createElement("div");
  overlay.id = "freed-ulysses-overlay";
  overlay.innerHTML = `
    <div class="ulysses-content">
      <h1>🧭 Ulysses Mode Active</h1>
      <p>The feed is blocked. What did you come here to do?</p>
      <div class="ulysses-actions">
        <a href="/messages">Messages</a>
        <a href="/notifications">Notifications</a>
        <button id="ulysses-bypass">Bypass (5 min)</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("ulysses-bypass")?.addEventListener("click", () => {
    setBypassTimer(5 * 60 * 1000);
    overlay.remove();
  });
}
```

---

## DOM Capture Fallback

```typescript
// packages/extension/src/content/dom-capture.ts
// When Desktop App isn't running, capture from active tab

export async function captureCurrentFeed(): Promise<FeedItem[]> {
  const { hostname } = window.location;

  switch (hostname) {
    case "twitter.com":
    case "x.com":
      return captureXFeed();
    case "facebook.com":
      return captureFacebookFeed();
    case "instagram.com":
      return captureInstagramFeed();
    default:
      return [];
  }
}

// Limited capture - only what's visible
async function captureXFeed(): Promise<FeedItem[]> {
  const tweets = document.querySelectorAll('[data-testid="tweet"]');
  // ... extract visible tweets
}
```

---

## Manifest

```json
// packages/extension/manifest.json
{
  "manifest_version": 3,
  "name": "Freed",
  "version": "1.0.0",
  "description": "Escape the attention economy",

  "permissions": ["activeTab", "storage", "scripting"],

  "action": {
    "default_popup": "popup.html",
    "default_icon": "icon-48.png"
  },

  "content_scripts": [
    {
      "matches": [
        "*://twitter.com/*",
        "*://x.com/*",
        "*://facebook.com/*",
        "*://instagram.com/*"
      ],
      "js": ["content.js"],
      "css": ["ulysses.css"]
    }
  ],

  "background": {
    "service_worker": "background.js"
  }
}
```

---

## Tasks

| Task | Description                    | Complexity |
| ---- | ------------------------------ | ---------- |
| 9.1  | Chrome MV3 extension scaffold  | Medium     |
| 9.2  | Popup UI for one-click save    | Low        |
| 9.3  | Integration with capture-save  | Medium     |
| 9.4  | Ulysses mode content script    | Medium     |
| 9.5  | Allowed paths configuration    | Low        |
| 9.6  | DOM capture fallback           | High       |
| 9.7  | Sync with Desktop/PWA          | Medium     |
| 9.8  | Firefox Desktop compatibility  | Medium     |
| 9.9  | Firefox Android extension      | Medium     |
| 9.10 | Firefox Add-ons submission     | Low        |
| 9.11 | Safari Web Extension packaging | High       |
| 9.12 | Safari iOS extension           | High       |
| 9.13 | Apple Developer account setup  | Low        |
| 9.14 | Safari App Store submission    | Medium     |
| 9.15 | Mobile browser capture testing | Medium     |

---

## Multi-Browser Support

### Firefox

Firefox uses WebExtensions API (largely compatible with Chrome MV3).

**Desktop:**

- Manifest v3 with minor adjustments
- `browser.*` namespace instead of `chrome.*` (use webextension-polyfill)
- Background scripts instead of service workers (Firefox MV3 limitation)

**Android:**

- Firefox for Android supports extensions (unlike Chrome Android)
- Same codebase as desktop with responsive popup UI
- Critical for mobile users without Safari

**Distribution:**

- Firefox Add-ons (addons.mozilla.org)
- Self-hosted XPI for sideloading

### Safari

Safari requires a native app wrapper for the extension.

**Architecture:**

```
freed-safari/
├── Freed Extension/
│   ├── manifest.json        # WebExtension manifest
│   ├── background.js
│   ├── content.js
│   └── popup/
├── Freed/
│   ├── AppDelegate.swift    # macOS app container
│   └── ViewController.swift
├── Freed iOS/
│   ├── AppDelegate.swift    # iOS app container
│   └── ViewController.swift
└── Freed.xcodeproj
```

**Requirements:**

- Apple Developer Program ($99/year)
- Xcode for building
- Notarization for macOS distribution
- App Store review for iOS

**Safari-Specific Considerations:**

- `browser.` namespace (Safari supports both)
- Limited background script capabilities on iOS
- Content blockers for Ulysses mode (more efficient than content scripts)

---

## Success Criteria

- [ ] Extension installs from Chrome Web Store
- [ ] Extension installs from Firefox Add-ons
- [ ] Extension installs from Safari App Store (macOS + iOS)
- [ ] One-click save captures page to Freed
- [ ] Ulysses mode blocks social feeds
- [ ] Allowed paths (messages, settings) accessible
- [ ] Bypass timer works
- [ ] Syncs with Desktop App when available
- [ ] Falls back to cloud sync when Desktop offline
- [ ] Firefox Android extension works on mobile
- [ ] Safari iOS extension works on iPhone/iPad

---

## Deliverable

Cross-platform browser extension (Chrome, Firefox, Safari) with save button and Ulysses mode.
