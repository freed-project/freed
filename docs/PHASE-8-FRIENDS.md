# Phase 8: Friends + Social Graph

> **Status:** In Progress, the canonical identity model now uses `Person` plus attached `Account` records, Google Contacts imports create friend persons by default, proxied Google token exchange plus refresh keeps Contacts sync alive after access-token expiry in Freed Desktop, Google Contacts sync now feeds the same top-toolbar background activity monitor as social providers with elapsed active-work timers, the Friends workspace now defaults to `All content`, and the graph surface now uses a worker-built graph atlas with a theme-aware Three.js starfield renderer, Troika billboard labels, visible-node caps, provider nebula and ring variations, confirmed friend stars closer to the camera, provisional human identities in the middle field, linked channel satellites packed into tight fields around people with short bright connectors, unlinked provider constellations around the edge, RSS treated as a normal provider island, context-menu linking and pinning, semantic zoom labels, AI-ranked suggestion-only friend candidates from local identity and content signals, Followed, Friends, and Fam relationship controls over the existing care-level model, reader author links that open the matching channel details in Friends, a desktop right-rail toggle with a collapsed-state floating selection card, and a mobile `Details` mode in the shared toolbar while the map uses a persistent lower-left time range slider for historical, current, and future location windows
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
│  8B: Identity Graph │    │  8C: Detail + Reach-out   │
│  Three starfield   │    │  Cross-platform timeline  │
│  Atlas worker      │    │  Reach-out log + nudges   │
│  layout + zoom     │    │                           │
└──────────────────┘      └───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│                 8D: Location / Time-Aware Map View               │
│  FeedItems + time windows → location extraction → Nominatim      │
│  geocoding → cache → MapLibre markers (latest pin per Friend or   │
│  latest valid pin per followed account in All content mode)       │
│  → time range slider → derived overlap views                     │
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
  /** @deprecated Legacy synchronized graph placement. */
  graphX?: number;
  /** @deprecated Legacy synchronized graph placement. */
  graphY?: number;
  /** @deprecated Legacy synchronized graph placement. */
  graphPinned?: boolean;
  /** @deprecated Legacy synchronized graph placement. */
  graphUpdatedAt?: number;
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
  /** @deprecated Legacy synchronized graph placement. */
  graphX?: number;
  /** @deprecated Legacy synchronized graph placement. */
  graphY?: number;
  /** @deprecated Legacy synchronized graph placement. */
  graphPinned?: boolean;
  /** @deprecated Legacy synchronized graph placement. */
  graphUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
}
```

Legacy `Friend`, `FriendSource`, and `DeviceContact` shims still exist for compatibility, but canonical persistence now lives in `persons` and `accounts` inside the Automerge document. Legacy docs hydrate through a migration that splits embedded sources and contact data into standalone account records.

Legacy Person and Account types retain optional graph placement fields only so older documents can be read. Current clients migrate valid pins once into a versioned device-local layout store, ignore later stale synchronized coordinates, and keep each viewport's pin positions out of Automerge.

Default nudge intervals by care level:

| Level | Label | Default interval |
|-------|-------|-----------------|
| 5 | Fam | 7 days |
| 4 | High friend | 14 days |
| 3 | Friend | 30 days |
| 2 | Acquaintance | 90 days |
| 1 | Followed | Never |

### Device contact import

`PlatformContext.pickContact?()` is the injection point:

- **Desktop**: Tauri `pick_contact` command (scaffolded, requires `objc2-contacts` crate + `com.apple.security.personal-information.addressbook` entitlement)
- **PWA (iOS/Android)**: Web Contact Picker API (`navigator.contacts.select`)
- **PWA (desktop browser)**: absent, `FriendEditor` falls back to manual form
- **Google Contacts**: optional People API import managed in Freed Desktop. Imports create `Person` records as `friend` by default, attach a contact `Account`, and surface suggestion-only merges for matching social accounts. The PWA shows synced contact status and synced Friends data, but does not start Contacts OAuth or People API sync.

---

## 8B: Friends Graph View

### Renderer and layout

- Renderer: theme-aware Three.js starfield with capped visible graph nodes, Troika billboard labels, and a canvas fallback when WebGL is unavailable
- Layout: off-main-thread worker that computes stable atlas tiers from activity summaries instead of shipping the full graph scene to the main thread
- Tiering:
  - confirmed friends are the largest identity stars near the center and closer to the camera
  - Fam and high-priority friends get the strongest depth and glow
  - provisional human identities sit in the middle field
  - linked social channels pack into tight satellite fields around their linked identity
  - unlinked channels and RSS feeds live in provider constellations around the outer edge
  - RSS is a provider island like Instagram, LinkedIn, X, and Facebook, not a separate content band
  - provider zones can render as nebula clouds, constellation rings, or both through the dev test control
- Interaction:
  - pan and zoom with semantic label reveal
  - click or double-click to focus identity or channel clusters in place without moving the camera
  - right click or long press a node to open graph actions
  - link accounts through a context-menu person picker
  - pin people or accounts from the node context menu
  - keep pin coordinates local to the current viewport while identity and account relationships continue to sync
  - non-selected clusters dim when a person or channel is focused

### Visual encoding

| Signal | Visual |
|---|---|
| Confirmed friend | Bright central star, closer to the camera |
| Provisional human identity | Medium star in middle depth |
| Linked social channel | Readable satellite star with a short bright connector line |
| RSS or unlinked outer channel | Small outer star inside provider constellation |
| Focused selection | Connected cluster stays bright, unrelated nodes dim |
| Higher zoom | More labels appear without shrinking the viewport |

### Scale targets

- Default showcase sample: 250 friends, 1,250 connected social identities, 15 feeds, and 1,445 items
- Stress graph: 1,000 friends plus 5,000 connected social identities
- Model build budget: under 500 ms for summary-backed graph input
- Worker atlas budget: under 250 ms desktop and under 600 ms on older modern iPhone Safari class devices
- Initial scene sync budget: under 40 ms in the desktop seeded fixture
- Hover sync budget: under 40 ms in the desktop seeded fixture
- Selection sync budget: under 60 ms in the desktop seeded fixture
- Pan and zoom sync budget: transform-only on the main thread, under 4 ms of main-thread work per gesture frame
- Visible node budget during interaction: under 300 desktop and under 160 iPhone
- Animation scope: camera movement, hover, focus, selection, pinning, and settle transitions only. There is no live force simulation during interaction

### Files

- `packages/ui/src/components/friends/FriendsView.tsx` — top-level view shell
- `packages/ui/src/components/friends/FriendGraph.tsx`: graph atlas starfield shell with Three.js rendering, Troika labels, context menus, gestures, fallback rendering, and diagnostics
- `packages/ui/src/lib/identity-graph-model.ts` — derived person, channel, and feed graph model
- `packages/shared/src/friend-suggestions.ts`: pure suggestion-only friend candidate ranking from identity, activity, content signals, and contact overlap
- `packages/ui/src/lib/identity-graph-layout.ts` — stable radial layout plus spatial index helpers
- `packages/ui/src/lib/identity-graph-layout.worker.ts` — worker entrypoint for graph layout
- `packages/ui/src/lib/identity-graph-activity-summary.ts` - summary builder for graph activity counts, latest activity, samples, location presence, and avatar candidates
- `packages/ui/src/lib/identity-graph-atlas.ts` - capped atlas builder with provider clusters, LOD tiers, labels, hit buckets, bounds, and metrics
- `packages/ui/src/lib/identity-graph-atlas.worker.ts` - worker entrypoint for graph atlas slices
- `packages/ui/src/components/friends/index.ts` — barrel export

---

## 8C: Friend Detail Panel + Reach-Out Logging

- `FriendDetailPanel.tsx` — slide-in side panel; identity card, cross-platform timeline, reach-out button
- `FriendEditor.tsx` — modal for create/edit; imports device contact, links social sources, sets care level

---

## 8D: Location / Map View

```
FeedItems are passed through extractLocationFromItem() plus optional time windows. geocode() resolves Nominatim results into cache-backed location groups. MapLibre markers then power Friends mode, All content mode, the time range slider, and derived overlap views.
```

Sources for location: Instagram geo-tags, Facebook check-ins, X geo-tags (rare), text patterns ("📍 Paris"), **and IG/FB story location stickers** (Phase 7.11). Low-confidence story labels are recovered from preserved Instagram location URLs when possible, or dropped when they cannot be trusted. Planned future sources such as Mozi add another class of signal: place windows that may sit in the future instead of the past.

> **Note:** Stories cross-posted from Instagram to Facebook (or vice versa) currently create two separate FeedItems with different `globalId` prefixes (`ig:` vs `fb:`), which can produce duplicate map pins for the same location event. Phase 7.15 (cross-platform dedup) will address this by matching items with the same Friend identity + similar text + timestamps within a few minutes.

### Planned time model

- Historical posts still render as point-in-time events
- Future-aware sources can attach a start and optional end time to a location-bearing item
- The map defaults to all available time, with draggable start and end handles for narrowing the visible window
- `all time`, `today`, and `last week` presets sit in the time card header for quick range changes
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
- `packages/ui/src/lib/geocoding.ts`: Nominatim integration with 1 req/s rate limiter, in-memory reuse, and in-flight dedupe
- `packages/ui/src/lib/geocoding-cache.ts` — IndexedDB cache (30-day TTL for hits, 7-day for misses)
- `packages/ui/src/hooks/useResolvedLocations.ts` — shared async location resolution for map and friend detail
- `packages/ui/src/components/map/MapView.tsx` — shared MapLibre map view for PWA and Freed Desktop
- `packages/ui/src/components/map/MiniFriendMapCard.tsx` — friend detail last-seen mini map card
- `packages/ui/src/components/map/MarkerElement.ts` — avatar bubble HTMLElement for MapLibre markers
- `packages/ui/src/components/map/MapSurface.tsx` — shared themed map surface, glass popups, and fallback renderer
- `packages/ui/src/lib/sample-library-seed.ts` - append-only sample batch seeding and fingerprinted sample cleanup for friend-linked map previews
- `packages/ui/src/components/layout/Sidebar.tsx` — live Friends and Map counts in the primary nav
- `packages/ui/src/components/Toast.tsx` — shared success/error feedback for sample refresh and other cross-shell actions

`maplibre-gl` now lives in `@freed/ui` so both PWA and Freed Desktop use the same map runtime. The shared surface now uses theme-native cartography, not a one-size-fits-none filter pass, so each theme gets its own land, water, boundary, and label palette while the avatars stay readable.
Named location resolution now groups identical place labels and streams each resolved group into the map as soon as it returns, so cached pins no longer wait behind slower uncached geocoding requests.
Sample data batches now append friend-linked LinkedIn posts and bounded past, current, and future map location windows, so repeated populates keep expanding the social graph and the map time slider has real temporal bounds to inspect.
New sample data batches now carry an internal cleanup marker on generated feeds, items, people, and accounts, so the app can clear sample records without guessing from names or URLs.
Friends and Map now use the same shared content header pattern as the rest of the app, instead of shipping bespoke top bars that wander off into their own little kingdoms.
Map popovers now include the time of each location update and behave like a sane interface, with only one popup open at a time.
Friends now behaves like a proper workspace: the graph settles once and freezes, supports pan and zoom, and uses a permanent resizable right sidebar for reconnect, search, filters, overview, and selected-friend detail.
That Friends detail rail now uses the same floating shell-card treatment and gap-based resize grip as the main app sidebars, so it finally looks like it belongs in the same product.
That same Friends rail can now be collapsed from a far-right toolbar toggle on larger screens, and narrow screens fold the detail surface into a third `Details` lens instead of stacking the graph and sidebar on top of each other like a punishment.
When that rail is collapsed on desktop, selecting a friend or channel now opens a compact floating detail card instead of springing the full rail back open without consent.
Clicking empty graph space now dismisses that collapsed floating detail card, so the graph behaves like a workspace again instead of trapping the last selection until the operator finds the tiny close button.
Trackpad and multitouch pinch zoom are now captured by the Friends graph itself, with faster graph-native scaling and Safari gesture suppression so zooming the workspace no longer zooms the whole browser window.
Panning the Friends graph no longer rebuilds every node, edge, and label object on each frame. The graph treats active movement as camera work instead of scene reconstruction.
Scriptorium also now gives the graph a darker node palette, stronger edges, and real label contrast, so the Friends view reads like an interface instead of a ghost story printed on oatmeal.
The Friends graph viewport now owns its own soft-mask compensation instead of inheriting the primary sidebar offset, which restores the left-edge vignette so all four edges feather consistently like the map view.
The identity graph now builds activity counts in one pass, uses cheaper bucketed overlap resolution in the worker, drops into an interaction-quality mode while you pan or pinch, and exposes internal timing counters so performance regressions can fail in desktop tests instead of sneaking into a merge.
The Friends graph now uses a graph atlas instead of the previous full-scene Pixi renderer. The worker builds capped viewport slices from activity summaries, the starfield renderer draws only the visible graph tier, provider labels stay visible at overview zoom, and diagnostics report source nodes separately from visible nodes so dense graph tests prove the cap instead of accidentally requiring the old expensive payload.
The Friends graph now renders that atlas as a theme-aware 3D starfield. Prominent friends sit closer to the camera, panning has slight depth parallax, provider zones can switch between nebula clouds, constellation rings, or both in dev, and headless or no-WebGL environments use a canvas starfield fallback while preserving diagnostics.
Graph linking and pinning now live in node context menus. Accounts link through a searchable person picker, and pinning writes the clicked node position without turning normal pan gestures into accidental edits.
Friend captions in the graph now use pill backgrounds and label-aware spacing, so names stay readable instead of collapsing into an overlapping word soup.
The Friends starfield now bleeds under the primary app sidebar like the map background, while fit and focus math use measured viewport insets so graph content stays centered in the visible workspace.
Friend avatars now inherit a theme-authored tint across the Friends graph and map markers, so each theme stays coherent without a stray custom accent fighting the palette.
The Friends graph now defaults to `All content`, keeps confirmed friends as larger center hubs, renders their linked channels as smaller radial satellites with straight connectors, and shows every other captured social account on the periphery inside provider-shaped metaball island regions.
Unlinked accounts can now be promoted to friends or linked to an existing friend directly from the Friends sidebar workflow, while unlinked map markers route into that same account workflow instead of dead-ending.
Map popovers now use a wider card layout and deliberately omit the old MapLibre tail, so place names and actions fit cleanly without the popup looking like a speech bubble from a cheaper app.
Friends and Map now consume the same shared theme tokens, button treatments, shell backgrounds, surface recipes, and theme-native map palettes as the rest of Freed, so themes like Neon, Midas, Vesper, Ember, and Scriptorium land consistently across the graph, sidebars, popovers, mini-map cards, editor, contact-sync flows, and map basemap itself.
The shared map now includes a device-local `Friends` / `All content` toggle. It restores the current device's last mode and defaults to `All content` when the library has geolocatable followed accounts but no friend-linked pins yet.
That same `Friends` / `All content` lens now lives in the shared toolbar for feed surfaces too, so the operator can collapse Freed down to real-world people without leaving the main reading views.
The shared map now exposes a persistent lower-left time range slider. The left handle starts at the earliest location day, the right handle starts at the farthest future location day, and all available time is visible by default. Dragging either handle snaps to whole-day values and narrows the visible location windows without sending the operator back to the toolbar. Handle labels travel underneath the selected start and end points, offset sideways on tight ranges so they stay on one row without overlapping. The card header also exposes `all time`, `today + future`, `today`, and `last week` text presets, with the active range highlighted.
Friends and Map now use the shared top toolbar for identity controls, and feed-only bulk actions no longer appear in those workspaces.
The Friends graph now auto-discovers likely human identities as provisional `connection` people from unlinked social accounts, persists those middle-ring nodes across sessions, and removes empty provisional identities when all linked channels move away.
The Friends graph also now renders followed RSS feeds in the same graph, so the operator can see confirmed people, provisional people, linked channels, stray channels, and feed subscriptions in one zoomable workspace instead of splitting the world across separate mental models.
The graph renderer draws every graph role from theme tokens and uses provider constellations for Instagram, LinkedIn, X, Facebook, RSS, and any future provider.
The graph viewport keeps its soft edge mask on graph content only, while floating controls use opaque theme-aware surfaces and the old node/link debug counter stays out of the user interface.
The layout worker now uses bounded D3 Force ticks for the people field, places confirmed friends in the center by care and activity, leaves provisional identities in the middle field, orbits linked channels around their person, and places every unlinked channel in a provider island around the edge.
Node context menus now handle pinning, relationship promotion, and account linking, so pan and pinch stay clean navigation gestures.
Sample data now defaults to a showcase graph with 250 friends and 1,250 connected social identities, while the stress fixture covers 1,000 friends and 5,000 connected social identities.
Semantic zoom now promotes provider island labels at low zoom while delaying person and channel labels until the operator zooms in, so the graph reads as geography first and detail second.
Suggested friends now appear in the Friends sidebar for both `Friends` and `All content` review flows when existing connection people or unlinked human-looking accounts have enough personal content, recent activity, linked-channel evidence, or Google Contacts overlap. Suggestions are ranked evidence only. Promotion and linking still require explicit operator action.
The Friends sidebar now exposes the relationship model as Followed, Friends, and Fam. Those stops map to care levels 1, 3, and 5 without adding a new schema field, leaving levels 2 and 4 available for later fine tuning. Fam content receives a stronger ranking boost, but it still respects the active feed filters.
Typed social profile search results now expose the same person workflow from the search menu: open the matched profile in Friends, focus them on Map, or promote the linked profile to Friends or Fam without detouring through the graph sidebar.

Reader author names now route directly into the matching Friends channel detail panel, using the existing captured-account workflow so a post can move from reading to identity review in one click.

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
| 8.19 | Google Contacts source, refreshable sync lifecycle, matching, and Friend creation flow | Medium | Done |
| 8.20 | Wire Map to live sidebar navigation | Low | Done |
| 8.21 | Add future-aware map filtering for location-bearing items | Medium | Done |
| 8.22 | Replace map time mode buttons with an always-visible time range slider, non-overlapping handle labels, and quick presets for past, current, today plus future, and all-time playback | Medium | Done |
| 8.23 | Replace embedded Friend identity with canonical `Person` + `Account` schema and Automerge migration | High | Done |
| 8.24 | Backfill followed-account catalog from captured authors and stories | Medium | Done |
| 8.25 | Google Contacts imports create friend persons with linked contact accounts | Medium | Done |
| 8.26 | Suggestion-only identity review queue for cross-account same-person confirmation | Medium | Done |
| 8.27 | Render derived overlap states in map and Friend detail surfaces | Medium | Not Started |
| 8.28 | Support Mozi-backed friend/location events in identity and map flows | Medium | Not Started |
| 8.29 | Include Google contact sync state in desktop disaster-recovery snapshots | Low | Done |
| 8.30 | Add persisted `Friends` / `All content` map modes with latest-author pins | Medium | Done |
| 8.31 | Friends workspace defaults to `All content` and renders friend hubs, linked satellites, and peripheral captured accounts | High | Done |
| 8.32 | Move Friends and Map identity controls into the shared header and hide feed bulk actions in those views | Medium | Done |
| 8.33 | Promote or link unconfirmed accounts from Friends and Map, including context-menu linking from the graph | High | Done |
| 8.34 | Persist provisional human identities from unlinked social accounts and prune empty connection shells after relinks | Medium | Done |
| 8.35 | Replace the Friends canvas renderer with a WebGL Pixi graph plus worker-computed radial layout and spatial indexing | High | Done |
| 8.36 | Add semantic zoom label culling plus seeded desktop graph regressions for drag, zoom, and dense graph visuals | Medium | Done |
| 8.37 | Cache retained Pixi node and label objects so pan and zoom update transforms instead of rebuilding the whole graph every frame | Medium | Done |
| 8.38 | Strengthen Friends graph contrast in Scriptorium so node tiers, labels, and edges stay legible against the parchment stage | Medium | Done |
| 8.39 | Harden graph performance with single-pass activity indexing, bucketed worker overlap resolution, and interactive label degradation plus perf counters | High | Done |
| 8.40 | Keep Pixi while making all graph roles theme-aware across node, edge, label, glow, provider island, hover, drag, and selection states | High | Done |
| 8.41 | Use bounded D3 Force in the worker for the person field while keeping transform-only pan and zoom interaction | High | Done |
| 8.42 | Treat RSS as a normal provider island, with linked RSS accounts orbiting their person like other channels | Medium | Done |
| 8.43 | Persist device-local graph placement and support context-menu pinning and linking | Medium | Done |
| 8.44 | Expand showcase and stress sample graph coverage to 250 friends plus 1,250 identities and 1,000 friends plus 5,000 identities | Medium | Done |
| 8.45 | Add semantic zoom hierarchy so provider island labels dominate low zoom and person labels appear at closer zoom | Medium | Done |
| 8.46 | Search and filter the primary feed by followed social channel names, with profile navigation and promotion commands | Medium | Done |
| 8.47 | Add AI-ranked suggestion-only friend candidates from identity graph, contact, activity, and content signals | Medium | Done |
| 8.48 | Open captured channel details in Friends from the reader author name | Low | Done |
| 8.49 | Replace the retained Pixi full-scene graph with a summary-backed graph atlas worker and capped canvas renderer | High | Done |
| 8.50 | Render the Friends atlas as a theme-aware 3D starfield with context-menu linking and pinning | High | Done |
| 8.51 | Tune the starfield for larger readable stars, tighter linked-channel fields, brighter connectors, and lower zoom render cost | High | Done |
| 8.52 | Let the Friends starfield fill under the primary app sidebar while preserving visible-workspace fit and focus math | Medium | Done |

---

## Success Criteria

- [x] Canonical Automerge identity graph now persists `persons` plus `accounts`, with backward-compatible migration from legacy `friends`
- [x] Identity resolution supports both `personForAuthor(persons, accounts, platform, authorId)` and legacy `friendForAuthor(...)`
- [x] CRM helpers: `isDue`, `effectiveInterval`, `nodeRadius`, `nodeOpacity`
- [x] Device contact import injected via `PlatformContext`
- [x] Force graph canvas renders friend nodes with recency + care encoding
- [x] Reconnect ring attracts overdue Fam contacts
- [x] Clicking a node opens a cross-platform timeline
- [x] Reach-out can be logged and clears the Reconnect ring
- [x] FriendEditor links social sources and imports contact info
- [x] Friends shown in Sidebar as a live navigation destination
- [x] Google Contacts import creates friend persons by default and suggests same-person matches without auto-linking
- [x] Google Contacts sync reuses native, refreshable Google credentials in Freed Desktop, retries once after an API 401 with a forced refresh, streams People API pages into normalized results without retaining duplicate raw page arrays, keeps its incremental token, cached contacts, suggestion decisions, and request history device-local through factory reset, and blocks automatic provider requests when that local ledger is corrupt or from an unsupported version until an explicit sync or reconnect repairs it
- [x] Desktop snapshot restore preserves cached Google contacts and pending match suggestions
- [x] Google Contacts appears as a first-class source in Settings and Friends, with full management in Freed Desktop and status-only visibility in the PWA
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
- [x] Sample data refresh rebuilds a 250-friend showcase graph with 1,250 social identities, recent map activity, and future-dated location windows
- [x] Sample data cleanup removes only records with the internal sample marker
- [x] Sidebar shows live counts for Friends and recent friend location updates on Map
- [x] Map supports persisted `Friends` and `All content` modes
- [x] Feed views share the same persisted `Friends` and `All content` toolbar lens
- [x] Map defaults to `All content` when there are valid author pins but no friend-linked pins
- [x] `All content` mode shows the latest valid location per followed account
- [x] Friends defaults to `All content` and shows peripheral captured accounts before confirmation
- [x] Confirmed friend hubs render linked channel satellites with provider-shaped island backgrounds
- [x] Friends and Map share header-level identity controls, and feed bulk actions stay feed-only
- [x] Map exposes a lower-left draggable time range slider with all available time selected by default
- [x] Unlinked accounts can be promoted or linked from both the Friends workspace and Map popups
- [x] Likely human social accounts can persist as provisional `connection` identities before they are confirmed as friends
- [x] Empty provisional identities are removed automatically when their last linked channel moves away
- [x] The Friends graph uses a Three.js starfield renderer with worker-computed atlas slices instead of the old main-thread canvas stack
- [x] Semantic zoom reveals more labels as the operator zooms in, without crushing the viewport
- [x] Provider island labels stay prominent at low zoom while person labels wait for closer inspection
- [x] Pan and zoom update only the graph transform during active movement instead of rebuilding the full scene every frame
- [x] Scriptorium graph colors stay legible instead of washing node fills and labels into the stage
- [x] Graph model construction uses single-pass activity indexing instead of rescanning every captured item per node
- [x] Worker layout uses local bucketed overlap resolution instead of naïve all-pairs nudging
- [x] Active pan and zoom can temporarily lower graph label work, then restore full quality on settle
- [x] Desktop tests assert graph timing and stress-fixture behavior through internal debug counters
- [x] Followed RSS feeds render as outer graph channels in `All content`
- [x] RSS is treated as a normal provider island, and linked RSS accounts orbit their person like other social channels
- [x] Graph color roles are theme-aware across background, nodes, labels, edges, hover, selection, glow, and provider constellations
- [x] Person and account graph pins persist in a versioned device-local layout, migrate once from legacy synchronized fields, and cannot be replayed by a stale Automerge update
- [x] Node context menus pin graph positions and link accounts through a searchable person picker
- [x] Stress coverage exercises 1,000 friends plus 5,000 connected social identities
- [x] Primary search can find followed social channels by account name or handle, filter the feed to that exact channel, open the profile in Friends or Map, and promote the profile to Friends or Fam
- [x] Friends `All content` shows ranked suggested friends from connection people and unlinked human-looking accounts, with reasons, signal counts, sample item ids, dismissal, and explicit promotion only
- [x] Reader author names open the matching captured channel details in Friends
- [x] Graph benchmarks cover model build time, worker layout time, scene sync time, pan and zoom sync time, selection and hover sync time, visible label count, and quality mode transitions
- [x] Graph atlas diagnostics report canonical source nodes, visible nodes, rendered primitive count, first visible time, frame p95, long tasks, memory estimate, renderer type, and touch input mode
- [x] Headless and no-WebGL environments fall back to a canvas starfield while preserving graph diagnostics
- [x] Dense graph coverage asserts capped visible nodes instead of requiring the full source graph in the renderer payload
- [x] Desktop browser tests cover mixed-tier graph load, context-menu link persistence, semantic zoom label growth, and a seeded dense-graph screenshot
- [x] Generic Instagram story labels are recovered from preserved location URLs or excluded from the map
- [ ] macOS native contact picker (CNContactStore)
- [x] Map promoted to live sidebar navigation
- [x] Future-aware map filtering supports past, current, and future location windows
- [x] Range filtering works across historical posts and future planning items
- [x] Time-card presets, including today plus future, and handle-following labels work across historical posts and future planning items without label collisions
- [ ] Overlaps render as derived read-time views, not persisted source records
- [ ] Mozi-backed friend/location events appear in Friend identity and map flows

---

## Privacy Considerations

- All location data stays local — never synced to cloud
- Friend suggestions use local identity metadata, content signals, item ids, counts, and optional local Integrated AI enrichment only. They do not send social content or contacts to cloud providers.
- Nominatim queries go only to `nominatim.openstreetmap.org` (no Freed servers)
- Device contact import is one-shot; no live OS contacts sync
- `reachOutLog` syncs across user's own devices via the existing Automerge relay
