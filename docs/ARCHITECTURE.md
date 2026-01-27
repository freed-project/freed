# FREED Technical Architecture

## Overview

FREED is a privacy-first, local-first system for capturing social media content and presenting it through a user-controlled unified feed.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CAPTURE LAYER                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                      │
│  │   Chrome    │  │  Safari iOS │  │   Firefox   │                      │
│  │  Extension  │  │  Extension  │  │  Android    │                      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                      │
└─────────┼────────────────┼────────────────┼─────────────────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      PROCESSING LAYER                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │    Location     │  │    Geocoding    │  │    Topic        │          │
│  │   Extraction    │──│   (Nominatim)   │  │   Extraction    │          │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        STORAGE LAYER                                     │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │                    Automerge CRDT Document                   │        │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │        │
│  │  │  FeedItems  │  │ Preferences │  │   Friends   │          │        │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │        │
│  └─────────────────────────────────────────────────────────────┘        │
│                              │                                           │
│              ┌───────────────┼───────────────┐                          │
│              ▼               ▼               ▼                          │
│  ┌─────────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │    IndexedDB    │  │  WebRTC P2P │  │   Cloud     │                  │
│  │    (Local)      │  │    Sync     │  │   Backup    │                  │
│  └─────────────────┘  └─────────────┘  └─────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         READER LAYER                                     │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐       │
│  │      PWA (app.freed.wtf)    │  │    Tauri Mobile (Phase 2)   │       │
│  │  ┌─────────┐  ┌──────────┐  │  │                             │       │
│  │  │  Feed   │  │   Map    │  │  │                             │       │
│  │  │  View   │  │   View   │  │  │                             │       │
│  │  └─────────┘  └──────────┘  │  │                             │       │
│  └─────────────────────────────┘  └─────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Core
- **Language:** TypeScript throughout
- **Runtime:** Bun (package management, scripts)
- **Build:** Vite (all projects)
- **Monorepo:** Bun workspaces

### Browser Extensions
- **Chrome:** Manifest V3
- **Safari iOS:** Safari Web Extension (webextension-polyfill)
- **Firefox Android:** WebExtensions API
- **Build Tool:** Vite + CRXJS plugin

### Storage & Sync
- **Local DB:** IndexedDB via Dexie.js
- **CRDT:** Automerge (conflict-free sync)
- **P2P Sync:** WebRTC
- **Cloud Backup:** User's own storage (Google Drive, iCloud, Dropbox)

### PWA Reader
- **Framework:** React 18
- **Styling:** Tailwind CSS v4
- **Animations:** Framer Motion
- **Maps:** react-maplibre + MapLibre GL JS
- **Offline:** Workbox service worker

### Geocoding
- **Service:** Nominatim (OpenStreetMap)
- **Approach:** Cache-first, rate-limited

### Native Mobile (Phase 2)
- **Framework:** Tauri 2.0
- **Backend:** Rust
- **Frontend:** Shared React components

---

## Data Model

### FeedItem

```typescript
interface FeedItem {
  globalId: string;           // "platform:itemId" e.g., "x:1234567890"
  platform: 'x' | 'facebook' | 'instagram';
  contentType: 'post' | 'story';
  capturedAt: number;         // Unix timestamp
  publishedAt: number;
  storyExpiresAt?: number;    // For stories (publishedAt + 24h)

  author: {
    id: string;
    handle: string;
    displayName: string;
    avatarUrl?: string;
  };

  content: {
    text?: string;
    mediaUrls: string[];      // URLs only, not binary data
    mediaTypes: ('image' | 'video' | 'link')[];
    linkPreview?: {
      url: string;
      title?: string;
      description?: string;
    };
  };

  engagement: {
    likes?: number;
    reposts?: number;
    comments?: number;
  };

  location?: {
    name: string;             // "Blue Bottle Coffee"
    address?: string;
    coordinates?: { lat: number; lng: number };
    placeId?: string;
    source: 'geo_tag' | 'check_in' | 'sticker' | 'text_extraction';
    confidence: number;       // 0-1
  };

  userState: {
    hidden: boolean;
    bookmarked: boolean;
    readAt?: number;
  };

  topics: string[];
}
```

### UserPreferences

```typescript
interface UserPreferences {
  weights: {
    recency: number;                    // 0-100
    platforms: Record<string, number>;  // Platform -> weight
    topics: Record<string, number>;     // Topic -> weight
    authors: Record<string, number>;    // Author -> weight
  };

  ulysses: {
    enabled: boolean;
    blockedPlatforms: string[];
    allowedPaths: Record<string, string[]>;
  };

  sync: {
    cloudProvider?: 'gdrive' | 'icloud' | 'dropbox';
    autoBackup: boolean;
    backupFrequency: 'hourly' | 'daily' | 'manual';
  };

  display: {
    itemsPerPage: number;
    showEngagementCounts: boolean;
    compactMode: boolean;
  };
}
```

### FriendLocation

```typescript
interface FriendLocation {
  authorId: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  
  lastLocation: {
    name: string;
    coordinates: { lat: number; lng: number };
    timestamp: number;
    sourcePostId: string;
  };
  
  locationHistory: Array<{
    name: string;
    coordinates: { lat: number; lng: number };
    timestamp: number;
  }>;
}
```

---

## Platform Capture Strategies

### X (Twitter)

**Difficulty:** Hard (frequent DOM changes, anti-scraping)

**Approach:**
- MutationObserver on feed container
- Target `data-testid` attributes (more stable than classes)
- Fallback to structural XPath
- Extract tweet ID from URL patterns

**Key Selectors:**
```javascript
'article[data-testid="tweet"]'          // Tweet container
'[data-testid="User-Name"]'             // Author info
'[data-testid="tweetText"]'             // Tweet text
```

### Facebook

**Difficulty:** Very Hard (obfuscated classes, aggressive anti-scraping)

**Approach:**
- Navigate via ARIA roles
- XPath-based relative positioning
- Ignore obfuscation spans for text extraction
- ID from timestamp link patterns

**Key Selectors:**
```javascript
'[role="feed"]'                         // Feed container
'[role="article"]'                      // Individual posts
```

### Instagram

**Difficulty:** Medium-Hard (SPA, but predictable structure)

**Approach:**
- Article elements in feed
- Media via standard img/video tags
- Author info in post header
- Works on both feed and individual posts

---

## Stories Capture

Stories are ephemeral (24h lifespan) and appear in carousels.

### Instagram Stories
- Stories tray at top of feed
- Capture during story viewing (MutationObserver on modal)
- Extract: media, author, location stickers, timestamp

### Facebook Stories
- Similar carousel UI
- Capture during viewing
- Location check-ins and stickers

### X/Twitter
- No stories (Fleets discontinued)

---

## Location Extraction Pipeline

### Sources (by confidence)

1. **Explicit Geo-Tags** (1.0) — Platform-provided structured data
2. **Location Stickers** (0.9) — Visual elements on stories
3. **Text Extraction** (0.5-0.8) — Regex patterns

### Text Extraction Patterns

```typescript
const LOCATION_PATTERNS = [
  /(?:at|@)\s+([A-Z][^,.\n]+)/i,           // "at Blue Bottle Coffee"
  /checking in (?:at|to)\s+([^,.\n]+)/i,   // "checking in at..."
  /currently in\s+([A-Z][^,.\n]+)/i,       // "currently in Tokyo"
  /visiting\s+([A-Z][^,.\n]+)/i,           // "visiting San Francisco"
  /📍\s*([^,.\n]+)/,                        // "📍 Brooklyn, NY"
];
```

### Geocoding

```typescript
// Nominatim with caching
const geocodeCache = new Map<string, Coordinates>();

async function geocode(placeName: string): Promise<Coordinates | null> {
  if (geocodeCache.has(placeName)) {
    return geocodeCache.get(placeName);
  }
  
  // Rate limit: 1 req/sec for public Nominatim
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?` +
    `q=${encodeURIComponent(placeName)}&format=json&limit=1`
  );
  const results = await response.json();
  
  if (results.length > 0) {
    const coords = { 
      lat: parseFloat(results[0].lat), 
      lng: parseFloat(results[0].lon) 
    };
    geocodeCache.set(placeName, coords);
    return coords;
  }
  return null;
}
```

---

## Sync Architecture

### Local P2P Sync (Primary)

When devices are discoverable:
1. Each device maintains an Automerge document
2. WebRTC establishes peer connection
3. Automerge sync protocol exchanges changes
4. CRDTs merge automatically

### Cloud Backup (Secondary)

For cross-network sync and disaster recovery:
1. Automerge document serialized to binary
2. Encrypted with user-provided passphrase (AES-256-GCM)
3. Uploaded to user's chosen cloud storage
4. Other devices pull and merge on startup

---

## Feed Ranking Algorithm

```typescript
function calculateWeight(item: FeedItem, prefs: UserPreferences): number {
  let weight = 1.0;

  // Recency decay (exponential)
  const hoursAgo = (Date.now() - item.publishedAt) / (1000 * 60 * 60);
  const recencyFactor = Math.exp(-hoursAgo / 24) * (prefs.weights.recency / 50);
  weight *= recencyFactor;

  // Platform weight
  weight *= (prefs.weights.platforms[item.platform] || 50) / 50;

  // Topic boosting
  for (const topic of item.topics) {
    const topicWeight = prefs.weights.topics[topic];
    if (topicWeight) {
      weight *= topicWeight / 50;
    }
  }

  // Author boosting
  const authorWeight = prefs.weights.authors[item.author.id];
  if (authorWeight) {
    weight *= authorWeight / 50;
  }

  return weight;
}
```

---

## Ulysses Mode

When enabled, content scripts:

1. Detect feed pages via URL patterns
2. Overlay block screen with redirect to FREED PWA
3. Allow escape paths (DMs, notifications, settings)

```typescript
const ULYSSES_ALLOWED_PATHS = {
  x: ['/messages', '/notifications', '/compose', '/settings', '/i/'],
  facebook: ['/messages', '/notifications', '/settings', '/marketplace'],
  instagram: ['/direct', '/accounts', '/explore/tags'],
};
```

---

## Security Considerations

### Data Privacy
- All data stored locally in IndexedDB
- No telemetry or analytics
- Cloud backup is user-initiated and encrypted

### Extension Permissions
- Minimal permissions requested
- Content scripts only on target platforms
- No background network requests to our servers (we have none)

### Legal Posture
- Client-side only (like ad blockers)
- User's own authenticated session
- No access control circumvention
- Open source for transparency

---

## Future: Complete Sovereignty Loop

FREED handles **consumption**. For **publishing**, we plan to integrate with [POSSE Party](https://posseparty.com/).

```
┌─────────────────────────────────────────────────────────────┐
│                    DIGITAL SOVEREIGNTY                       │
│                                                              │
│   YOUR SITE ──POSSE──→ Platforms ──FREED──→ YOUR FEED       │
│      ↑                                          │            │
│      └──────────────── YOU ─────────────────────┘            │
│                                                              │
│   Write once, syndicate everywhere, read on your terms.      │
└─────────────────────────────────────────────────────────────┘
```

**POSSE** = Publish (on your) Own Site, Syndicate Everywhere

This completes the loop:
- **Read** through FREED (your algorithm, your data)
- **Write** through POSSE (your site first, then platforms)
- Your content lives on YOUR domain, not just platform servers
- Full IndieWeb alignment
