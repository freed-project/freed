# Phase 4-5 Execution Plan

> **Scope:** Sync Layer (Phase 4) + PWA Reader (Phase 5)  
> **Prepared:** 2026-01-30  
> **Dependencies:** Phase 1-2 (Capture layers ✓), Phase 3 (Save for Later)

---

## Overview

Phase 4 establishes device-to-device sync via Automerge CRDT. Phase 5 delivers the reader interface—a timeline-focused PWA.

```
┌─────────────────────────────────────────────────────────────────┐
│                         PHASE 3: SYNC                           │
│                                                                 │
│  HOME NETWORK (instant sync):                                   │
│  ┌─────────────┐    WebSocket    ┌─────────────┐               │
│  │   OpenClaw  │◄──────────────►│  Phone PWA  │               │
│  │   :8765     │    (<100ms)     │             │               │
│  └──────┬──────┘                 └─────────────┘               │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │ Cloud Sync  │  (GDrive / iCloud / Dropbox)                  │
│  │  (backup)   │  User's own account, encrypted                │
│  └─────────────┘                                                │
│                                                                 │
│  AWAY FROM HOME (5-30s sync):                                   │
│  ┌─────────────┐    Cloud File    ┌─────────────┐              │
│  │   OpenClaw  │◄────────────────►│  Phone PWA  │              │
│  └─────────────┘                  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       PHASE 4: PWA READER                       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Timeline-Focused UI                    │   │
│  │  ┌─────────┐  ┌─────────────────────────────────────┐   │   │
│  │  │ Sources │  │         Unified Timeline            │   │   │
│  │  │ ─────── │  │  ┌─────────────────────────────┐    │   │   │
│  │  │ All     │  │  │ Article / Post / Video      │    │   │   │
│  │  │ X       │  │  │ Content with enhancements   │    │   │   │
│  │  │ RSS     │  │  └─────────────────────────────┘    │   │   │
│  │  │ YouTube │  │  ┌─────────────────────────────┐    │   │   │
│  │  │ Tags    │  │  │ Next item...                │    │   │   │
│  │  └─────────┘  │  └─────────────────────────────┘    │   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 4: Sync Layer

### 4.1 Architecture Overview

**Two sync modes, zero external infrastructure:**

1. **Home network (instant):** OpenClaw hosts WebSocket server, PWA connects directly
2. **Away from home (5-30s):** Cloud storage sync via user's GDrive/iCloud/Dropbox

**Key decisions:**

- No relay server we operate (reduces legal attack surface)
- OpenClaw is the source of truth + runs ranking algorithm
- Cloud storage = backup + away-from-home sync
- Images cached locally per device (not synced via cloud)

### 4.2 Create `@freed/sync` Package

**New package:** `packages/sync/`

```
packages/sync/
├── src/
│   ├── index.ts              # Public API
│   ├── repo.ts               # automerge-repo wrapper
│   ├── storage/
│   │   ├── indexeddb.ts      # Browser storage adapter
│   │   └── filesystem.ts     # Node/Bun storage adapter
│   ├── network/
│   │   ├── local-relay.ts    # OpenClaw WebSocket server
│   │   └── cloud.ts          # Cloud storage sync
│   └── status.ts             # Sync status observables
├── package.json
└── tsconfig.json
```

**Dependencies:**

```json
{
  "dependencies": {
    "@automerge/automerge": "^2.2.0",
    "@automerge/automerge-repo": "^1.0.0",
    "@automerge/automerge-repo-storage-indexeddb": "^1.0.0",
    "@automerge/automerge-repo-network-websocket": "^1.0.0"
  }
}
```

### 4.3 OpenClaw Local Relay

OpenClaw hosts a WebSocket server on the local network. PWA connects for instant sync when at home.

```typescript
// packages/sync/src/network/local-relay.ts
import { WebSocketServer } from "ws";
import { Repo } from "@automerge/automerge-repo";
import { NodeWSServerAdapter } from "@automerge/automerge-repo-network-websocket";

const DEFAULT_PORT = 8765;

/**
 * Start local WebSocket relay on OpenClaw
 * PWA connects via ws://192.168.x.x:8765 or ws://openclaw.local:8765
 */
export function startLocalRelay(repo: Repo, port = DEFAULT_PORT): void {
  const wss = new WebSocketServer({ port });
  const adapter = new NodeWSServerAdapter(wss);
  repo.networkSubsystem.addNetworkAdapter(adapter);

  console.log(`FREED sync relay running on ws://localhost:${port}`);

  // Optional: Advertise via mDNS for auto-discovery
  // advertiseMdns('_freed._tcp', port);
}
```

```typescript
// PWA connects to local relay when available
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";

export async function connectToLocalRelay(
  repo: Repo,
  host: string,
  port = 8765,
): Promise<boolean> {
  const url = `ws://${host}:${port}`;

  try {
    // Test if reachable
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      setTimeout(reject, 2000);
    });
    ws.close();

    // Connect automerge-repo
    const adapter = new BrowserWebSocketClientAdapter(url);
    repo.networkSubsystem.addNetworkAdapter(adapter);
    return true;
  } catch {
    return false; // Fall back to cloud sync
  }
}
```

**Device pairing options:**

1. **QR code** — OpenClaw displays QR with local IP, phone scans
2. **Manual entry** — User enters IP in PWA settings
3. **mDNS discovery** — PWA auto-discovers `openclaw.local` (requires mDNS support)

### 4.4 Cloud Storage Sync

For when PWA is away from home network. User's own cloud account—we never see the data.

```typescript
// packages/sync/src/network/cloud.ts
import * as A from "@automerge/automerge";

interface CloudConfig {
  provider: "gdrive" | "icloud" | "dropbox";
  credentials: OAuthCredentials;
}

/**
 * Sync Automerge doc to cloud storage
 * Called periodically by OpenClaw and on PWA app open
 */
export async function syncToCloud(
  doc: A.Doc<unknown>,
  config: CloudConfig,
): Promise<void> {
  const binary = A.save(doc);

  // Optionally encrypt with user passphrase
  // const encrypted = await encrypt(binary, passphrase);

  switch (config.provider) {
    case "gdrive":
      await syncToGoogleDrive(binary, config.credentials);
      break;
    case "icloud":
      await syncToICloud(binary, config.credentials);
      break;
    case "dropbox":
      await syncToDropbox(binary, config.credentials);
      break;
  }
}

/**
 * Fetch and merge cloud doc with local doc
 */
export async function syncFromCloud(
  localDoc: A.Doc<unknown>,
  config: CloudConfig,
): Promise<A.Doc<unknown>> {
  const remoteBinary = await fetchFromCloud(config);
  if (!remoteBinary) return localDoc;

  const remoteDoc = A.load(remoteBinary);
  return A.merge(localDoc, remoteDoc);
}

// Google Drive: store in app-specific folder
async function syncToGoogleDrive(
  data: Uint8Array,
  creds: OAuthCredentials,
): Promise<void> {
  // Use Google Drive API v3
  // File: /FREED/feed.automerge
  // Overwrites existing file (Automerge handles merge on read)
}
```

### 4.5 Sync Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        PWA OPENS                                 │
│                            │                                     │
│              ┌─────────────┴─────────────┐                      │
│              ▼                           ▼                      │
│     Try local relay              Load from IndexedDB            │
│     (ws://openclaw:8765)              │                         │
│              │                        │                         │
│      ┌───────┴───────┐                │                         │
│      ▼               ▼                │                         │
│   Success         Fail                │                         │
│   (instant)       │                   │                         │
│      │            ▼                   │                         │
│      │     Try cloud sync             │                         │
│      │     (5-30s)                    │                         │
│      │            │                   │                         │
│      └────────────┼───────────────────┘                         │
│                   ▼                                             │
│            Merge & display                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 4.6 Sync Status API

```typescript
// packages/sync/src/status.ts
export interface SyncStatus {
  mode: "local" | "cloud" | "offline";
  state: "idle" | "syncing" | "error";
  lastSyncAt: number | null;
  localRelayConnected: boolean;
  cloudProvider?: "gdrive" | "icloud" | "dropbox";
  error?: string;
}

export function createSyncManager(repo: Repo): SyncManager {
  return {
    // Try local first, fall back to cloud
    async sync(): Promise<void> {
      if (await this.tryLocalRelay()) return;
      await this.syncCloud();
    },

    // Status observable for UI
    subscribe(listener: (status: SyncStatus) => void): () => void {
      /* ... */
    },

    // Manual controls
    async tryLocalRelay(): Promise<boolean> {
      /* ... */
    },
    async syncCloud(): Promise<void> {
      /* ... */
    },

    getStatus(): SyncStatus {
      /* ... */
    },
  };
}
```

### 4.7 Phase 4 Tasks

| Task  | Description                           | Est. Complexity |
| ----- | ------------------------------------- | --------------- |
| 3.1.1 | Create `@freed/sync` package scaffold | Low             |
| 3.1.2 | Implement IndexedDB storage adapter   | Medium          |
| 3.1.3 | Implement Filesystem storage adapter  | Medium          |
| 3.2.1 | OpenClaw WebSocket relay server       | Medium          |
| 3.2.2 | PWA WebSocket client + auto-connect   | Medium          |
| 3.2.3 | QR code pairing flow                  | Low             |
| 3.3.1 | Google Drive sync integration         | High            |
| 3.3.2 | iCloud sync integration               | High            |
| 3.3.3 | Dropbox sync integration              | Medium          |
| 3.4.1 | Sync status observable                | Low             |
| 3.4.2 | "Last synced" UI indicator            | Low             |
| 3.4.3 | Manual "Sync now" button              | Low             |

**Phase 4 Deliverable:** `@freed/sync` package with instant local sync (OpenClaw relay) and cloud backup (GDrive/iCloud/Dropbox). No external servers.

---

## Phase 5: PWA Reader

### 5.1 Design Philosophy

**Core Principles:**

1. **Timeline by default, unread tracking opt-in** — Ephemeral content (tweets) flows by; important sources (newsletters) can track unread
2. **Unified content types** — RSS, videos, podcasts, social in one view
3. **Clean, minimal chrome** — Content-first design
4. **Seamless sync** — Automerge CRDT for cross-device

**Key Features:**

1. **Per-source unread tracking** — Enable for newsletters and priority sources
2. **Reading enhancements** — Focus mode, font options, theming
3. **Custom ranking** — User-controlled weights, not engagement
4. **Source filtering** — View by platform, author, or topic

> **Note:** Save for Later is implemented as a separate capture layer (`@freed/capture-save`) in Phase 3, following the same architecture as `capture-x` and `capture-rss`. The PWA displays saved items but doesn't implement the capture logic.

### 5.2 Create `@freed/pwa` Package

**New package:** `packages/pwa/`

```
packages/pwa/
├── public/
│   ├── favicon.svg
│   └── manifest.json
├── src/
│   ├── main.tsx                    # Entry point
│   ├── App.tsx                     # Root component
│   ├── index.css                   # Tailwind + custom styles
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx        # Main layout wrapper
│   │   │   ├── Sidebar.tsx         # Source list (desktop)
│   │   │   ├── BottomNav.tsx       # Mobile navigation
│   │   │   └── Header.tsx          # Top bar with sync status
│   │   │
│   │   ├── feed/
│   │   │   ├── FeedList.tsx        # Virtual scrolling list
│   │   │   ├── FeedItem.tsx        # Individual item card
│   │   │   ├── FeedItemExpanded.tsx # Full article view
│   │   │   ├── ArticleContent.tsx  # Rendered content
│   │   │   └── FocusText.tsx       # Focus mode text renderer
│   │   │
│   │   ├── sources/
│   │   │   ├── SourceList.tsx      # All sources sidebar
│   │   │   ├── SourceGroup.tsx     # Platform grouping
│   │   │   └── AddSourceModal.tsx  # Add RSS/manage sources
│   │   │
│   │   ├── settings/
│   │   │   ├── SettingsPanel.tsx   # Settings drawer
│   │   │   ├── WeightSliders.tsx   # Ranking weights
│   │   │   ├── DisplaySettings.tsx # Theme, reading options
│   │   │   └── SyncSettings.tsx    # Cloud backup config
│   │   │
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Toggle.tsx
│   │       ├── Slider.tsx
│   │       └── Modal.tsx
│   │
│   ├── hooks/
│   │   ├── useFreedDoc.ts          # Automerge document hook
│   │   ├── useFeed.ts              # Filtered/sorted feed
│   │   ├── useSyncStatus.ts        # Sync state
│   │   ├── usePreferences.ts       # User preferences
│   │   └── useReadingEnhancements.ts # Reading enhancement hooks
│   │
│   ├── lib/
│   │   ├── ranking.ts              # Feed ranking algorithm
│   │   ├── focus-text.ts           # Focus mode text transform
│   │   ├── filters.ts              # Feed filtering logic
│   │   └── formatters.ts           # Date, text formatting
│   │
│   └── types/
│       └── index.ts                # PWA-specific types
│
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.ts
```

**Dependencies:**

```json
{
  "dependencies": {
    "@freed/shared": "*",
    "@freed/sync": "*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.22.0",
    "@tanstack/react-virtual": "^3.0.0",
    "framer-motion": "^11.0.0",
    "zustand": "^4.5.0",
    "date-fns": "^3.3.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "tailwindcss": "^4.0.0",
    "vite": "^5.1.0",
    "vite-plugin-pwa": "^0.18.0"
  }
}
```

### 5.3 Reading Enhancements

Optional reading enhancements to improve focus and comfort:

- **Focus Mode**: Bolds word beginnings to create fixation points
- **Font Options**: Serif/sans-serif, size, line height
- **Theme**: Light/dark/auto, custom accent colors
- **Reduced Motion**: Disable animations for accessibility

```typescript
// packages/pwa/src/lib/focus-text.ts

export interface FocusOptions {
  enabled: boolean;
  intensity: "light" | "normal" | "strong";
}

export interface TextSegment {
  text: string;
  emphasis: boolean;
}

export function applyFocusMode(
  text: string,
  options: FocusOptions,
): TextSegment[] {
  if (!options.enabled) {
    return [{ text, emphasis: false }];
  }

  const segments: TextSegment[] = [];
  const words = text.split(/(\s+)/);

  for (const word of words) {
    if (/^\s+$/.test(word)) {
      segments.push({ text: word, emphasis: false });
    } else if (/^[a-zA-Z]+$/.test(word)) {
      const count = getEmphasisCount(word.length, options.intensity);
      segments.push({ text: word.slice(0, count), emphasis: true });
      if (word.length > count) {
        segments.push({ text: word.slice(count), emphasis: false });
      }
    } else {
      segments.push({ text: word, emphasis: false });
    }
  }

  return segments;
}

function getEmphasisCount(
  len: number,
  intensity: FocusOptions["intensity"],
): number {
  const m = intensity === "light" ? 0.8 : intensity === "strong" ? 1.2 : 1.0;
  if (len <= 3) return Math.ceil(1 * m);
  if (len <= 5) return Math.ceil(2 * m);
  if (len <= 8) return Math.ceil(3 * m);
  return Math.ceil(4 * m);
}
```

### 5.4 Feed Ranking Algorithm

```typescript
// packages/pwa/src/lib/ranking.ts
import type { FeedItem, UserPreferences } from "@freed/shared";

export function rankFeedItems(
  items: FeedItem[],
  preferences: UserPreferences,
): FeedItem[] {
  const { weights } = preferences;

  return items
    .map((item) => ({
      item,
      score: calculateScore(item, weights),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

function calculateScore(
  item: FeedItem,
  weights: UserPreferences["weights"],
): number {
  let score = 0;

  // Recency (0-100 scale, decays over time)
  const ageHours = (Date.now() - item.publishedAt) / (1000 * 60 * 60);
  const recencyScore = Math.max(0, 100 - ageHours * 2); // Decay: -2 per hour
  score += recencyScore * (weights.recency / 100);

  // Platform weight
  const platformWeight = weights.platforms[item.platform] ?? 50;
  score += platformWeight * 0.3;

  // Author weight (if set)
  const authorWeight = weights.authors[item.author.id] ?? 50;
  score += authorWeight * 0.3;

  // Topic weights
  for (const topic of item.topics) {
    const topicWeight = weights.topics[topic] ?? 50;
    score += topicWeight * 0.1;
  }

  return score;
}

// Filter functions
export function filterByPlatform(
  items: FeedItem[],
  platform: string | null,
): FeedItem[] {
  if (!platform) return items;
  return items.filter((item) => item.platform === platform);
}

export function filterByAuthor(
  items: FeedItem[],
  authorId: string | null,
): FeedItem[] {
  if (!authorId) return items;
  return items.filter((item) => item.author.id === authorId);
}

export function filterByContentType(
  items: FeedItem[],
  types: string[],
): FeedItem[] {
  if (types.length === 0) return items;
  return items.filter((item) => types.includes(item.contentType));
}
```

### 5.5 Core Components

#### App Shell (sidebar + timeline layout)

```tsx
// packages/pwa/src/components/layout/AppShell.tsx
import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { Header } from "./Header";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header - minimal, shows sync status */}
      <Header onMenuClick={() => setSidebarOpen(true)} />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - desktop always visible, mobile slide-out */}
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main content */}
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>

      {/* Bottom nav - mobile only */}
      <BottomNav className="md:hidden" />
    </div>
  );
}
```

#### Feed List (Virtual scrolling)

```tsx
// packages/pwa/src/components/feed/FeedList.tsx
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { FeedItem as FeedItemType } from "@freed/shared";
import { FeedItem } from "./FeedItem";

interface FeedListProps {
  items: FeedItemType[];
  onItemClick: (item: FeedItemType) => void;
}

export function FeedList({ items, onItemClick }: FeedListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120, // Estimated item height
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];
          return (
            <div
              key={item.globalId}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <FeedItem item={item} onClick={() => onItemClick(item)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

#### Feed Item Card

```tsx
// packages/pwa/src/components/feed/FeedItem.tsx
import { FeedItem as FeedItemType } from "@freed/shared";
import { FocusText } from "./FocusText";
import { usePreferences } from "../../hooks/usePreferences";
import { formatDistanceToNow } from "date-fns";

interface FeedItemProps {
  item: FeedItemType;
  onClick: () => void;
}

export function FeedItem({ item, onClick }: FeedItemProps) {
  const { reading } = usePreferences();

  const platformIcon = getPlatformIcon(item.platform);
  const timeAgo = formatDistanceToNow(item.publishedAt, { addSuffix: true });

  return (
    <article
      onClick={onClick}
      className="p-4 border-b border-zinc-800 hover:bg-zinc-900/50 
                 cursor-pointer transition-colors"
    >
      {/* Author row */}
      <div className="flex items-center gap-3 mb-2">
        {item.author.avatarUrl && (
          <img
            src={item.author.avatarUrl}
            alt=""
            className="w-8 h-8 rounded-full"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">
              {item.author.displayName}
            </span>
            <span className="text-zinc-500 text-sm">@{item.author.handle}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>{platformIcon}</span>
            <span>{timeAgo}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      {item.content.text && (
        <div className="text-zinc-200 line-clamp-3">
          <FocusText options={reading}>{item.content.text}</FocusText>
        </div>
      )}

      {/* Media preview */}
      {item.content.mediaUrls.length > 0 && (
        <div className="mt-3 rounded-lg overflow-hidden">
          <img
            src={item.content.mediaUrls[0]}
            alt=""
            className="w-full h-48 object-cover"
          />
        </div>
      )}

      {/* Link preview */}
      {item.content.linkPreview && (
        <div className="mt-3 p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="text-sm font-medium truncate">
            {item.content.linkPreview.title}
          </div>
          <div className="text-xs text-zinc-500 truncate">
            {item.content.linkPreview.url}
          </div>
        </div>
      )}
    </article>
  );
}

function getPlatformIcon(platform: string): string {
  const icons: Record<string, string> = {
    x: "𝕏",
    rss: "📰",
    youtube: "▶️",
    reddit: "🔴",
    mastodon: "🐘",
    github: "🐙",
  };
  return icons[platform] ?? "📄";
}
```

### 5.6 Settings Panel

```tsx
// packages/pwa/src/components/settings/DisplaySettings.tsx
import { Toggle } from "../ui/Toggle";
import { usePreferences } from "../../hooks/usePreferences";

export function DisplaySettings() {
  const {
    reading,
    setFocusMode,
    setFocusIntensity,
    compactMode,
    setCompactMode,
  } = usePreferences();

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">Display</h3>

      {/* Compact Mode */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">Compact Mode</div>
          <div className="text-sm text-zinc-500">
            Show more items with less padding
          </div>
        </div>
        <Toggle checked={compactMode} onChange={setCompactMode} />
      </div>

      {/* Reading Enhancements */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-zinc-400">Reading</h4>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Focus Mode</div>
            <div className="text-sm text-zinc-500">
              Bold word beginnings to aid reading
            </div>
          </div>
          <Toggle checked={reading.focusMode} onChange={setFocusMode} />
        </div>

        {reading.focusMode && (
          <div className="pl-4 border-l border-zinc-700">
            <label className="text-sm text-zinc-400">Intensity</label>
            <div className="flex gap-2 mt-2">
              {(["light", "normal", "strong"] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setFocusIntensity(level)}
                  className={`px-3 py-1 rounded text-sm capitalize ${
                    reading.focusIntensity === level
                      ? "bg-violet-600 text-white"
                      : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

### 5.7 PWA Configuration

```typescript
// packages/pwa/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "FREED",
        short_name: "FREED",
        description: "Your feed, your algorithm, your data",
        theme_color: "#7c3aed",
        background_color: "#09090b",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.(png|jpg|jpeg|gif|webp)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 1 week
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: "dist",
  },
});
```

### 5.8 Phase 5 Tasks

| Task  | Description                               | Est. Complexity |
| ----- | ----------------------------------------- | --------------- |
| 4.1.1 | Create `@freed/pwa` package scaffold      | Low             |
| 4.1.2 | Configure Vite + React + Tailwind         | Low             |
| 4.1.3 | Configure PWA manifest + service worker   | Medium          |
| 4.2.1 | Implement AppShell layout                 | Medium          |
| 4.2.2 | Implement Sidebar (sources list)          | Medium          |
| 4.2.3 | Implement Header with sync status         | Low             |
| 4.2.4 | Implement BottomNav (mobile)              | Low             |
| 4.3.1 | Implement reading enhancements            | Medium          |
| 4.3.2 | Create FocusText component                | Low             |
| 4.3.3 | Add reading settings UI                   | Low             |
| 4.4.1 | Implement ranking algorithm               | Medium          |
| 4.4.2 | Implement filter functions                | Low             |
| 4.4.3 | Create useFeed hook                       | Medium          |
| 4.4.4 | Per-source unread tracking                | Medium          |
| 4.5.1 | Implement FeedList with virtual scrolling | Medium          |
| 4.5.2 | Implement FeedItem card                   | Medium          |
| 4.5.3 | Implement FeedItemExpanded view           | Medium          |
| 4.5.4 | Implement ArticleContent renderer         | Medium          |
| 4.6.1 | Implement SettingsPanel                   | Medium          |
| 4.6.2 | Implement WeightSliders                   | Medium          |
| 4.6.3 | Implement DisplaySettings                 | Low             |
| 4.6.4 | Implement SyncSettings                    | Medium          |
| 4.7.1 | Create AddSourceModal (RSS)               | Medium          |
| 4.7.2 | Implement source management               | Medium          |
| 4.8.1 | Connect to @freed/sync                    | High            |
| 4.8.2 | Implement useFreedDoc hook                | Medium          |
| 4.9.1 | Mobile responsive polish                  | Medium          |
| 4.9.2 | Add to homescreen flow                    | Low             |
| 4.9.3 | Offline indicator                         | Low             |

**Phase 5 Deliverable:** Mobile-first PWA at freed.wtf/app with per-source unread tracking and unified feed.

> **Note:** Save for Later (`capture-save`) is Phase 3—a separate capture layer with its own package and execution plan.

---

## Execution Order

### Recommended Sequence

```
Phase 4: Sync Layer
├── 3.1 Package scaffold + IndexedDB adapter
├── 3.2 Filesystem adapter
├── 3.3 BroadcastChannel (tab sync)
├── 3.4 Sync status observable
├── 3.5 Cloud backup encryption utilities
└── 3.6 Google Drive integration

Phase 5: PWA Reader (can start after 4.1-4.4)
├── 4.1 Package scaffold + Vite config
├── 4.2 AppShell + basic layout
├── 4.3 Reading enhancements
├── 4.4 Feed components (list, item, expanded)
├── 4.5 Ranking + filtering
├── 4.6 Settings panel
├── 4.7 Source management
├── 4.8 Connect to sync layer
└── 4.9 Mobile polish + PWA install flow
```

### Parallelization Opportunities

- **4.2 + 4.3**: Local relay and cloud sync can be developed in parallel
- **5.3 + 5.4**: Reading enhancements and Feed components are independent
- **5.6 + 5.7**: Settings and Source management are independent

---

## Design Notes

### Sync Architecture

| Mode        | Speed  | When                           |
| ----------- | ------ | ------------------------------ |
| Local relay | <100ms | Home network, OpenClaw running |
| Cloud sync  | 5-30s  | Away from home                 |
| Offline     | N/A    | No network, uses cached data   |

**No external servers.** OpenClaw is the local relay. Cloud uses user's own account.

### Image Caching

Images are NOT synced via cloud (too large). Each device caches independently:

```typescript
// PWA service worker caches images as viewed
self.addEventListener("fetch", (event) => {
  if (isImageRequest(event.request)) {
    event.respondWith(cacheFirst(event.request));
  }
});

// Optional: Pre-cache high-priority items for offline
async function preCacheForOffline(items: FeedItem[], limit = 50) {
  const topItems = items
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
  const cache = await caches.open("offline-images");
  for (const item of topItems) {
    for (const url of item.content.mediaUrls) {
      if (!(await cache.match(url))) {
        cache.put(url, await fetch(url));
      }
    }
  }
}
```

### Visual Design

**Layout:** Three-column (sources | feed | reader) on desktop, single column with bottom nav on mobile.

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌─────────┐  ┌─────────────────────────────────────────────┐  │
│  │ Sources │  │         Feed Timeline                       │  │
│  │ ─────── │  │  ┌─────────────────────────────────────┐    │  │
│  │ All     │  │  │ ◉ Source Name              2h ago │    │  │
│  │ X       │  │  │ Article headline with enough      │    │  │
│  │ RSS     │  │  │ text to show the first few lines  │    │  │
│  │ Saved   │  │  │ ┌───────────────────────────────┐ │    │  │
│  │         │  │  │ │      [Hero Image]             │ │    │  │
│  │ Folders │  │  │ └───────────────────────────────┘ │    │  │
│  │ ─────── │  │  └─────────────────────────────────────┘    │  │
│  │ Friends │  │                                              │  │
│  │ Tech    │  │  ┌─────────────────────────────────────┐    │  │
│  │ News    │  │  │ Next item...                       │    │  │
│  └─────────┘  │  └─────────────────────────────────────┘    │  │
└─────────────────────────────────────────────────────────────────┘
```

**Design Tokens:**

```css
/* packages/pwa/src/index.css */

:root {
  /* Dark glass theme - adapts to native vibrancy on desktop */
  --bg-primary: rgba(18, 18, 18, 0.85);
  --bg-sidebar: rgba(28, 28, 30, 0.7);
  --bg-card: rgba(44, 44, 46, 0.9);
  --bg-card-hover: rgba(58, 58, 60, 0.9);
  --bg-input: rgba(38, 38, 40, 0.8);

  /* Glass borders */
  --border-glass: rgba(255, 255, 255, 0.08);
  --border-glass-strong: rgba(255, 255, 255, 0.15);

  /* Text */
  --text-primary: rgba(255, 255, 255, 0.92);
  --text-secondary: rgba(255, 255, 255, 0.55);
  --text-tertiary: rgba(255, 255, 255, 0.35);

  /* Accent */
  --accent: #ff6b35;
  --accent-hover: #ff8555;
  --accent-muted: rgba(255, 107, 53, 0.15);

  /* Spacing */
  --sidebar-width: 240px;
  --card-radius: 12px;
  --button-radius: 8px;

  /* Typography */
  --font-sans:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "SF Mono", Menlo, monospace;
}
```

**Glass Button Component:**

```css
/* CSS approximation of Liquid Glass buttons */
.glass-button {
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.12) 0%,
    rgba(255, 255, 255, 0.05) 100%
  );
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--border-glass);
  border-radius: var(--button-radius);
  color: var(--text-primary);
  padding: 8px 16px;
  font-weight: 500;
  transition: all 0.15s ease;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.glass-button:hover {
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.18) 0%,
    rgba(255, 255, 255, 0.08) 100%
  );
  border-color: var(--border-glass-strong);
  transform: translateY(-1px);
}

.glass-button:active {
  transform: translateY(0);
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
```

**Feed Card Component:**

```css
.feed-card {
  background: var(--bg-card);
  border: 1px solid var(--border-glass);
  border-radius: var(--card-radius);
  padding: 16px;
  transition: all 0.15s ease;
}

.feed-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-glass-strong);
}

.feed-card .source-name {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
}

.feed-card .headline {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  margin: 4px 0;
}

.feed-card .excerpt {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
}

.feed-card .timestamp {
  color: var(--text-tertiary);
  font-size: 12px;
}
```

**Desktop App Native Vibrancy (Tauri):**

```json
// packages/desktop/src-tauri/tauri.conf.json
{
  "windows": [
    {
      "title": "FREED",
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

The PWA uses the same CSS. On desktop, native vibrancy shows through transparent areas. On web/mobile, the glass effects are CSS-only but still look cohesive.

### Focus Mode

One of several reading enhancements:

- **Light**: Subtle emphasis on word beginnings
- **Normal**: Standard fixation points
- **Strong**: More pronounced emphasis
- **Toggle**: Easily switch on/off from settings

---

## Success Criteria

### Phase 4 Complete When:

- [ ] Data persists in IndexedDB (browser) and filesystem (OpenClaw)
- [ ] OpenClaw hosts WebSocket relay on local network
- [ ] PWA connects to local relay when available (<100ms sync)
- [ ] PWA falls back to cloud sync when away from home
- [ ] At least one cloud provider works (GDrive recommended)
- [ ] QR code or manual pairing connects PWA to OpenClaw
- [ ] Sync status UI shows "Local" vs "Cloud" vs "Offline"

### Phase 5 Complete When:

- [ ] PWA loads at freed.wtf/app
- [ ] Feed displays items from Automerge document
- [ ] Per-source unread tracking works for opted-in feeds
- [ ] Virtual scrolling handles 1000+ items smoothly
- [ ] Reading enhancements work correctly
- [ ] Ranking weights affect item order
- [ ] Platform/author filters work
- [ ] RSS subscription management functional
- [ ] PWA installable on mobile (add to homescreen)
- [ ] Offline access works (service worker + image cache)
- [ ] "Offline mode" pre-caches top N items with images

---

_"What we attend to becomes our life. Choose wisely."_
