# Phase 8: Friends + Social Graph

> **Status:** In Progress
> **Dependencies:** Phase 7 (Facebook + Instagram capture provide most social content)

---

## Overview

A friend CRM built on a force-directed social graph. Unify a person's blog RSS feed, Facebook profile, Instagram account, and any other platform into a single **Friend** identity. Track relationship health, log reach-outs, and get nudged when you've drifted from people you care about.

Clicking a friend zooms in to show a chronological timeline of everything they've posted across all their linked social channels.

The geo map from the original Phase 8 design is retained as sub-phase 8D, now powered by Friend identities so pins cluster by person rather than by platform and render in Freed's dark purple visual language.

This phase also becomes the home for future-aware social planning. Historical post locations still matter, but the map and friend timeline now need to handle future-dated place windows from sources like Mozi, plus derived overlap views when multiple friends are in the same place at the same time.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     8A: Friend Identity Layer                     │
│                                                                   │
│  Friend record (Automerge doc)                                    │
│  ├── sources: FriendSource[]   → matches FeedItem.author.id       │
│  └── contact?: DeviceContact   → imported from address book       │
│                                                                   │
│  packages/shared/src/friends.ts (pure functions)                  │
│  └── friendForAuthor, feedItemsForFriend, isDue, nodeRadius ...   │
└──────────────────────────────────────────────────────────────────┘
           │                         │
           ▼                         ▼
┌──────────────────┐      ┌───────────────────────────┐
│  8B: Force Graph │      │  8C: Detail + Reach-out   │
│  d3-force canvas │      │  Cross-platform timeline  │
│  Reconnect ring  │      │  Reach-out log + nudges   │
└──────────────────┘      └───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│                 8D: Location / Time-Aware Map View               │
│  FeedItems + time windows → location extraction → Nominatim      │
│  geocoding → cache → MapLibre markers (latest pin per Friend)    │
│  → timeline scrubber → derived overlap views                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 8A: Friends Identity Layer

### Data model

```typescript
// packages/shared/src/types.ts

interface FriendSource {
  platform: Platform;
  authorId: string;       // matches FeedItem.author.id
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
}

interface DeviceContact {
  importedFrom: "macos" | "ios" | "android" | "web";
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  nativeId?: string;
  importedAt: number;
}

interface ReachOutLog {
  loggedAt: number;
  channel?: "phone" | "text" | "email" | "in_person" | "other";
  notes?: string;
}

interface Friend {
  id: string;                   // uuid
  name: string;                 // canonical display name
  avatarUrl?: string;           // overrides platform avatars
  bio?: string;
  sources: FriendSource[];
  contact?: DeviceContact;
  careLevel: 1 | 2 | 3 | 4 | 5; // drives reach-out nudge interval
  reachOutIntervalDays?: number;  // override; auto-derived from careLevel if absent
  reachOutLog?: ReachOutLog[];   // most recent first, capped at 20
  tags?: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}
```

Default nudge intervals by care level:

| Level | Label | Default interval |
|-------|-------|-----------------|
| 5 | Closest | 7 days |
| 4 | Close | 14 days |
| 3 | Good friend | 30 days |
| 2 | Acquaintance | 90 days |
| 1 | Peripheral | Never |

### Device contact import

`PlatformContext.pickContact?()` is the injection point:

- **Desktop**: Tauri `pick_contact` command (scaffolded, requires `objc2-contacts` crate + `com.apple.security.personal-information.addressbook` entitlement)
- **PWA (iOS/Android)**: Web Contact Picker API (`navigator.contacts.select`)
- **PWA (desktop browser)**: absent, `FriendEditor` falls back to manual form
- **Google Contacts**: optional People API import in Friends view, with match suggestions, linking, skip, and create-Friend flows

---

## 8B: Friends Graph View

### Force layout

- Engine: `d3-force` (canvas renderer, no SVG, no wrapper lib)
- Node radius: `baseRadius(careLevel) * log2(recentPostCount + 2)`, capped at 48px
- Node opacity: 1.0 → 0.5 as post recency decays (posted today vs. silent for 30+ days)
- Reconnect ring: a gravity zone at the top of the canvas that attracts `isDue && careLevel >= 4` friends

### Visual encoding

| Signal | Visual |
|---|---|
| Posted < 24h | Pulse ring (purple) |
| `isDue && careLevel >= 4` | Amber glow + pulled toward Reconnect zone |
| `careLevel` 1-2 | Smaller base radius |
| Silent 30+ days | 50% opacity |

### Files

- `packages/ui/src/components/friends/FriendsView.tsx` — top-level view shell
- `packages/ui/src/components/friends/FriendGraph.tsx` — d3-force canvas renderer
- `packages/ui/src/components/friends/ReconnectRing.tsx` — HTML overlay label
- `packages/ui/src/components/friends/index.ts` — barrel export

---

## 8C: Friend Detail Panel + Reach-Out Logging

- `FriendDetailPanel.tsx` — slide-in side panel; identity card, cross-platform timeline, reach-out button
- `FriendEditor.tsx` — modal for create/edit; imports device contact, links social sources, sets care level

---

## 8D: Location / Map View

```
FeedItems → extractLocationFromItem() + optional time window → geocode() (Nominatim) → cache → MapLibre markers → timeline scrubber → derived overlap views
```

Sources for location: Instagram geo-tags, Facebook check-ins, X geo-tags (rare), text patterns ("📍 Paris"), **and IG/FB story location stickers** (Phase 7.11). Planned future sources such as Mozi add another class of signal: place windows that may sit in the future instead of the past.

> **Note:** Stories cross-posted from Instagram to Facebook (or vice versa) currently create two separate FeedItems with different `globalId` prefixes (`ig:` vs `fb:`), which can produce duplicate map pins for the same location event. Phase 7.15 (cross-platform dedup) will address this by matching items with the same Friend identity + similar text + timestamps within a few minutes.

### Planned time model

- Historical posts still render as point-in-time events
- Future-aware sources can attach a start and optional end time to a location-bearing item
- The map defaults to `Now` but should be able to scrub backward and forward in time
- Marker visibility is filtered by the selected time or time window, not just by "latest post wins"

### Planned overlap model

- Overlaps are derived at read time when multiple Friend-linked items share a place cluster and intersecting time windows
- Overlaps are not persisted as canonical source content
- Map popups and Friend detail surfaces can render overlaps as computed views on top of captured items

### Planned source expansion

- Mozi is the first explicit planning-oriented source for this phase
- Mozi-backed friend/location events should participate in identity matching the same way Instagram, Facebook, and X items do
- The map and timeline should not special-case Mozi in the long run. They should consume generic location-plus-time signals from any source

### Files

- `packages/shared/src/location.ts` — `GeoLocation` type, `extractLocationFromItem()`
- `packages/ui/src/lib/geocoding.ts` — Nominatim integration with 1 req/s rate limiter
- `packages/ui/src/lib/geocoding-cache.ts` — IndexedDB cache (30-day TTL for hits, 7-day for misses)
- `packages/ui/src/hooks/useResolvedLocations.ts` — shared async location resolution for map and friend detail
- `packages/ui/src/components/map/MapView.tsx` — shared MapLibre map view for PWA and Freed Desktop
- `packages/ui/src/components/map/MiniFriendMapCard.tsx` — friend detail last-seen mini map card
- `packages/ui/src/components/map/MarkerElement.ts` — avatar bubble HTMLElement for MapLibre markers
- `packages/ui/src/components/map/MapSurface.tsx` — shared dark map surface, glass popups, and fallback renderer
- `packages/ui/src/lib/sample-library-seed.ts` — append-only sample batch seeding for friend-linked map previews
- `packages/ui/src/components/layout/Sidebar.tsx` — live Friends and Map counts in the primary nav
- `packages/ui/src/components/Toast.tsx` — shared success/error feedback for sample refresh and other cross-shell actions

`maplibre-gl` now lives in `@freed/ui` so both PWA and Freed Desktop use the same map runtime. The shared surface now uses a dark futuristic visual treatment so the full map and friend mini-map read like the same product.
Sample data batches now append friend-linked LinkedIn posts too, so repeated populates keep expanding the social graph instead of reseeding the same tiny cast.
Friends and Map now use the same shared content header pattern as the rest of the app, instead of shipping bespoke top bars that wander off into their own little kingdoms.
Map popovers now include the time of each location update and behave like a sane interface, with only one popup open at a time.
Friends now behaves like a proper workspace: the graph settles once and freezes, supports pan and zoom, and uses a permanent resizable right sidebar for reconnect, search, filters, overview, and selected-friend detail.
Trackpad pinch zoom is now captured by the Friends graph itself, so zooming the workspace no longer zooms the whole browser window.
Friend captions in the graph now use pill backgrounds and label-aware spacing, so names stay readable instead of collapsing into an overlapping word soup.
Friend avatars now share the same lighter purple tint treatment across the Friends graph and map markers, with a user-configurable tint control in Settings.
Map popovers now use a wider card layout and deliberately omit the old MapLibre tail, so place names and actions fit cleanly without the popup looking like a speech bubble from a cheaper app.

---

## Tasks

| Task | Description | Complexity | Status |
|------|-------------|------------|--------|
| 8.1 | `Friend`, `FriendSource`, `DeviceContact`, `ReachOutLog` types | Low | Done |
| 8.2 | `friends` field in `FreedDoc` schema + mutation helpers | Low | Done |
| 8.3 | `packages/shared/src/friends.ts` — identity resolution + CRM helpers | Medium | Done |
| 8.4 | `PlatformContext.pickContact` — Web API + Tauri scaffold | Medium | Done |
| 8.5 | `FriendGraph.tsx` — d3-force canvas renderer | High | Done |
| 8.6 | `ReconnectRing.tsx` — Reconnect zone overlay | Low | Done |
| 8.7 | `FriendDetailPanel.tsx` — timeline + reach-out | Medium | Done |
| 8.8 | `FriendEditor.tsx` — create/edit modal | Medium | Done |
| 8.9 | `FriendsView.tsx` — top-level view shell | Low | Done |
| 8.10 | Friends + Map added to `comingSoonSources` in Sidebar | Low | Done |
| 8.11 | Location extraction (`shared/src/location.ts`) | Low | Done |
| 8.12 | Nominatim geocoding + rate limiter | Medium | Done |
| 8.13 | Geocoding IndexedDB cache | Low | Done |
| 8.14 | `FriendMap.tsx` — MapLibre component | High | Done |
| 8.15 | `MarkerElement.ts` — avatar markers | Low | Done |
| 8.16 | Install `maplibre-gl` and wire Map nav entry | Low | Done |
| 8.17 | Implement macOS `CNContactStore` Tauri command (objc2-contacts) | High | Not Started |
| 8.18 | Wire Friends to live sidebar navigation | Low | Done |
| 8.19 | Google Contacts source, sync lifecycle, matching, and Friend creation flow | Medium | Done |
| 8.20 | Wire Map to live sidebar navigation | Low | Done |
| 8.21 | Add future-aware map filtering for location-bearing items | Medium | Not Started |
| 8.22 | Add map timeline scrubber for past and future playback | Medium | Not Started |
| 8.23 | Render derived overlap states in map and Friend detail surfaces | Medium | Not Started |
| 8.24 | Support Mozi-backed friend/location events in identity and map flows | Medium | Not Started |
| 8.25 | Include Google contact sync state in desktop disaster-recovery snapshots | Low | Done |

---

## Success Criteria

- [x] `Friend` type with unified identity model in Automerge doc
- [x] Identity resolution: `friendForAuthor(friends, platform, authorId)`
- [x] CRM helpers: `isDue`, `effectiveInterval`, `nodeRadius`, `nodeOpacity`
- [x] Device contact import injected via `PlatformContext`
- [x] Force graph canvas renders friend nodes with recency + care encoding
- [x] Reconnect ring attracts overdue close friends
- [x] Clicking a node opens a cross-platform timeline
- [x] Reach-out can be logged and clears the Reconnect ring
- [x] FriendEditor links social sources and imports contact info
- [x] Friends shown in Sidebar as a live navigation destination
- [x] Google Contacts import suggests matches and can create Friends
- [x] Desktop snapshot restore preserves cached Google contacts and pending match suggestions
- [x] Google Contacts appears as a first-class source in Settings and Friends
- [x] Google Contacts auto-links high-confidence matches and can create Friends from high-confidence unlinked authors
- [x] Location extraction from geo-tags and text patterns
- [x] Nominatim geocoding with rate limiter
- [x] Geocoding cache with TTL
- [x] MapLibre `FriendMap` component scaffolded
- [x] `maplibre-gl` installed and map view live in PWA and Freed Desktop
- [x] Friend detail panel shows a last-seen mini map card when location history exists
- [x] Shared map surface uses a dark futuristic theme across live and fallback rendering
- [x] Sample data refresh rebuilds a 25-friend social graph with linked profiles and recent map activity
- [x] Sidebar shows live counts for Friends and recent friend location updates on Map
- [ ] macOS native contact picker (CNContactStore)
- [x] Map promoted to live sidebar navigation
- [ ] Future-aware map filtering supports past, current, and future location windows
- [ ] Timeline scrubbing works across historical posts and future planning items
- [ ] Overlaps render as derived read-time views, not persisted source records
- [ ] Mozi-backed friend/location events appear in Friend identity and map flows

---

## Privacy Considerations

- All location data stays local — never synced to cloud
- Nominatim queries go only to `nominatim.openstreetmap.org` (no Freed servers)
- Device contact import is one-shot; no live OS contacts sync
- `reachOutLog` syncs across user's own devices via the existing Automerge relay
