# Phase 8: Friends + Social Graph

> **Status:** In Progress, the canonical identity model now uses `Person` plus attached `Account` records, Google Contacts imports create friend persons by default, the Friends workspace now defaults to `All content` with confirmed friend hubs plus linked satellites and peripheral account nodes, and the map plus Friends surfaces now share the same unified top toolbar, including header-level identity controls plus current, future, and past map windows with a quieter in-map timeline scrubber docked at the lower left for historical and future playback
> **Dependencies:** Phase 7 (Facebook + Instagram capture provide most social content)

---

## Overview

A people CRM built on a force-directed social graph. Canonical same-human identity now lives in a `Person` record, while every attached social profile or imported contact lives in an `Account` record. Social capture can catalog followed accounts before they are confirmed as the same person, and Google Contacts imports create friend people by default.

Confirmed friends stay at the center of the graph. Their linked social and contact accounts orbit as attached nodes. Unconfirmed followed accounts can stay separate until the operator confirms that they belong to the same person.

The geo map from the original Phase 8 design is retained as sub-phase 8D. It now supports both Friend-linked pins and an `All content` fallback that shows the latest valid location per followed account when no Friend graph exists yet.

This phase also becomes the home for future-aware social planning. Historical post locations still matter, but the map and friend timeline now need to handle future-dated place windows from sources like Mozi, plus derived overlap views when multiple friends are in the same place at the same time.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                  8A: Person + Account Identity Layer              │
│                                                                   │
│  Person record (Automerge doc)                                    │
│  ├── relationshipStatus: "connection" | "friend"                  │
│  └── metadata for the confirmed same-human identity               │
│                                                                   │
│  Account record (Automerge doc)                                   │
│  ├── kind: "social" | "contact"                                   │
│  ├── provider + externalId                                        │
│  └── optional personId when the operator confirms identity        │
│                                                                   │
│  packages/shared/src/friends.ts (pure functions)                  │
│  └── personForAuthor, feedItemsForPerson, isDue, nodeRadius ...   │
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
│  geocoding → cache → MapLibre markers (latest pin per Friend or   │
│  latest valid pin per followed account in All content mode)       │
│  → timeline scrubber → derived overlap views                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 8A: Friends Identity Layer

### Data model

```typescript
// packages/shared/src/types.ts

interface Person {
  id: string;
  name: string;
  relationshipStatus: "connection" | "friend";
  careLevel: 1 | 2 | 3 | 4 | 5;
  reachOutIntervalDays?: number;
  reachOutLog?: ReachOutLog[];
  tags?: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

interface Account {
  id: string;
  personId?: string;
  kind: "social" | "contact";
  provider: AccountProvider;
  externalId: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  phone?: string;
  email?: string;
  address?: string;
  importedAt: number;
  firstSeenAt: number;
  lastSeenAt: number;
  discoveredFrom:
    | "captured_item"
    | "story_author"
    | "contact_import"
    | "manual_entry"
    | "follow_roster";
  createdAt: number;
  updatedAt: number;
}
```

Legacy `Friend`, `FriendSource`, and `DeviceContact` shims still exist for compatibility, but canonical persistence now lives in `persons` and `accounts` inside the Automerge document. Legacy docs hydrate through a migration that splits embedded sources and contact data into standalone account records.

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
- **Google Contacts**: optional People API import in Friends view. Imports create `Person` records as `friend` by default, attach a contact `Account`, and surface suggestion-only merges for matching social accounts

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
FeedItems → extractLocationFromItem() + optional time window → geocode() (Nominatim) → cache → MapLibre markers → Friends mode or All content mode → timeline scrubber → derived overlap views
```

Sources for location: Instagram geo-tags, Facebook check-ins, X geo-tags (rare), text patterns ("📍 Paris"), **and IG/FB story location stickers** (Phase 7.11). Low-confidence story labels are recovered from preserved Instagram location URLs when possible, or dropped when they cannot be trusted. Planned future sources such as Mozi add another class of signal: place windows that may sit in the future instead of the past.

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
- `packages/ui/src/components/map/MapSurface.tsx` — shared themed map surface, glass popups, and fallback renderer
- `packages/ui/src/lib/sample-library-seed.ts` — append-only sample batch seeding for friend-linked map previews
- `packages/ui/src/components/layout/Sidebar.tsx` — live Friends and Map counts in the primary nav
- `packages/ui/src/components/Toast.tsx` — shared success/error feedback for sample refresh and other cross-shell actions

`maplibre-gl` now lives in `@freed/ui` so both PWA and Freed Desktop use the same map runtime. The shared surface now uses theme-native cartography, not a one-size-fits-none filter pass, so each theme gets its own land, water, boundary, and label palette while the avatars stay readable.
Sample data batches now append friend-linked LinkedIn posts too, so repeated populates keep expanding the social graph instead of reseeding the same tiny cast.
Friends and Map now use the same shared content header pattern as the rest of the app, instead of shipping bespoke top bars that wander off into their own little kingdoms.
Map popovers now include the time of each location update and behave like a sane interface, with only one popup open at a time.
Friends now behaves like a proper workspace: the graph settles once and freezes, supports pan and zoom, and uses a permanent resizable right sidebar for reconnect, search, filters, overview, and selected-friend detail.
That Friends detail rail now uses the same floating shell-card treatment and gap-based resize grip as the main app sidebars, so it finally looks like it belongs in the same product.
Trackpad pinch zoom is now captured by the Friends graph itself, so zooming the workspace no longer zooms the whole browser window.
Friend captions in the graph now use pill backgrounds and label-aware spacing, so names stay readable instead of collapsing into an overlapping word soup.
Friend avatars now inherit a theme-authored tint across the Friends graph and map markers, so each theme stays coherent without a stray custom accent fighting the palette.
The Friends graph now defaults to `All content`, keeps confirmed friends as larger center hubs, renders their linked channels as smaller radial satellites with straight connectors, and shows every other captured social account on the periphery inside provider-shaped metaball island regions.
Unlinked accounts can now be promoted to friends or linked to an existing friend directly from the Friends sidebar workflow, while unlinked map markers route into that same account workflow instead of dead-ending.
Map popovers now use a wider card layout and deliberately omit the old MapLibre tail, so place names and actions fit cleanly without the popup looking like a speech bubble from a cheaper app.
Friends and Map now consume the same shared theme tokens, button treatments, shell backgrounds, surface recipes, and theme-native map palettes as the rest of Freed, so themes like Neon, Midas, Vesper, Ember, and Scriptorium land consistently across the graph, sidebars, popovers, mini-map cards, editor, contact-sync flows, and map basemap itself.
The shared map now includes a persisted `Friends` / `All content` toggle. It restores the user's last mode from preferences and defaults to `All content` when the library has geolocatable followed accounts but no friend-linked pins yet.
That same `Friends` / `All content` lens now lives in the shared toolbar for feed surfaces too, so the operator can collapse Freed down to real-world people without leaving the main reading views.
The shared map now also persists a `Current` / `Future` / `Past` time filter. Future-dated `timeRange` windows stay out of the default current map until they start, upcoming travel or event windows can be previewed directly, and expired windows fall into a separate past view without hijacking the current last-seen map.
Map history playback now stays inside the map surface as a lower-left scrubber panel, while the toolbar keeps only the high-level mode switches instead of growing a second floating control row.
Friends and Map now use the shared top toolbar for their identity and time controls, and feed-only bulk actions no longer appear in those workspaces.
Past and future views now expose a timeline scrubber, so the operator can replay historical location posts or step through upcoming travel windows instead of staring at one collapsed "latest" pin and pretending that counts as time.

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
| 8.21 | Add future-aware map filtering for location-bearing items | Medium | Done |
| 8.22 | Add map timeline scrubber for past and future playback | Medium | Done |
| 8.23 | Replace embedded Friend identity with canonical `Person` + `Account` schema and Automerge migration | High | Done |
| 8.24 | Backfill followed-account catalog from captured authors and stories | Medium | Done |
| 8.25 | Google Contacts imports create friend persons with linked contact accounts | Medium | Done |
| 8.26 | Suggestion-only identity review queue for cross-account same-person confirmation | Medium | Done |
| 8.23 | Render derived overlap states in map and Friend detail surfaces | Medium | Not Started |
| 8.24 | Support Mozi-backed friend/location events in identity and map flows | Medium | Not Started |
| 8.25 | Include Google contact sync state in desktop disaster-recovery snapshots | Low | Done |
| 8.26 | Add persisted `Friends` / `All content` map modes with latest-author pins | Medium | Done |
| 8.27 | Friends workspace defaults to `All content` and renders friend hubs, linked satellites, and peripheral captured accounts | High | Done |
| 8.28 | Move Friends and Map identity controls into the shared header and hide feed bulk actions in those views | Medium | Done |
| 8.29 | Promote or link unconfirmed accounts from Friends and Map, including drag-to-friend linking from the graph | High | Done |

---

## Success Criteria

- [x] Canonical Automerge identity graph now persists `persons` plus `accounts`, with backward-compatible migration from legacy `friends`
- [x] Identity resolution supports both `personForAuthor(persons, accounts, platform, authorId)` and legacy `friendForAuthor(...)`
- [x] CRM helpers: `isDue`, `effectiveInterval`, `nodeRadius`, `nodeOpacity`
- [x] Device contact import injected via `PlatformContext`
- [x] Force graph canvas renders friend nodes with recency + care encoding
- [x] Reconnect ring attracts overdue close friends
- [x] Clicking a node opens a cross-platform timeline
- [x] Reach-out can be logged and clears the Reconnect ring
- [x] FriendEditor links social sources and imports contact info
- [x] Friends shown in Sidebar as a live navigation destination
- [x] Google Contacts import creates friend persons by default and suggests same-person matches without auto-linking
- [x] Desktop snapshot restore preserves cached Google contacts and pending match suggestions
- [x] Google Contacts appears as a first-class source in Settings and Friends
- [x] Captured social authors can backfill orphan followed-account records before the operator confirms identity
- [x] Match review is suggestion-only. Contact-to-social and social-to-social merges require explicit confirmation
- [x] Location extraction from geo-tags and text patterns
- [x] Nominatim geocoding with rate limiter
- [x] Geocoding cache with TTL
- [x] MapLibre `FriendMap` component scaffolded
- [x] `maplibre-gl` installed and map view live in PWA and Freed Desktop
- [x] Friend detail panel shows a last-seen mini map card when location history exists
- [x] Shared map surface uses theme-native palettes across live and fallback rendering
- [x] Friends and Map inherit the shared multi-theme design system instead of hardcoded one-off gradients
- [x] Sample data refresh rebuilds a 25-friend social graph with linked profiles and recent map activity
- [x] Sidebar shows live counts for Friends and recent friend location updates on Map
- [x] Map supports persisted `Friends` and `All content` modes
- [x] Feed views share the same persisted `Friends` and `All content` toolbar lens
- [x] Map defaults to `All content` when there are valid author pins but no friend-linked pins
- [x] `All content` mode shows the latest valid location per followed account
- [x] Friends defaults to `All content` and shows peripheral captured accounts before confirmation
- [x] Confirmed friend hubs render linked channel satellites with provider-shaped island backgrounds
- [x] Friends and Map share header-level identity controls, and feed bulk actions stay feed-only
- [x] Unlinked accounts can be promoted or linked from both the Friends workspace and Map popups
- [x] Generic Instagram story labels are recovered from preserved location URLs or excluded from the map
- [ ] macOS native contact picker (CNContactStore)
- [x] Map promoted to live sidebar navigation
- [x] Future-aware map filtering supports past, current, and future location windows
- [x] Timeline scrubbing works across historical posts and future planning items
- [ ] Overlaps render as derived read-time views, not persisted source records
- [ ] Mozi-backed friend/location events appear in Friend identity and map flows

---

## Privacy Considerations

- All location data stays local — never synced to cloud
- Nominatim queries go only to `nominatim.openstreetmap.org` (no Freed servers)
- Device contact import is one-shot; no live OS contacts sync
- `reachOutLog` syncs across user's own devices via the existing Automerge relay
