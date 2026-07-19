# Phase 8: Friends + Social Graph

> **Status:** In Progress, the canonical identity model now uses `Person` plus attached `Account` records, Google Contacts imports create friend persons by default, proxied Google token exchange plus refresh keeps Contacts sync alive after access-token expiry in Freed Desktop, Google Contacts sync now feeds the same top-toolbar background activity monitor as social providers with elapsed active-work timers, the Friends workspace now defaults to `All content`, and the graph surface now uses a worker-built graph atlas with a theme-aware Three.js starfield renderer, one-batch billboard glyph labels, visible-node caps, procedural provider spiral galaxies with Nebula as the default treatment, confirmed friend stars closer to the camera, provisional human identities in the middle field, linked channel satellites packed into tight fields around people with contextual connectors, unlinked provider constellations around the edge, RSS treated as a normal provider island, context-menu linking and pinning, native iPhone and Mac Safari zoom gestures with bounded trackpad pan and pinch inertia, AI-ranked suggestion-only friend candidates from local identity and content signals, Followed, Friends, and Fam relationship controls over the existing care-level model, reader author links that open the matching channel details in Friends, a desktop right-rail toggle with a collapsed-state floating selection card, and a mobile `Details` mode in the shared toolbar while the map uses a persistent lower-left time range slider for historical, current, and future location windows
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

- Renderer: imperative Three.js WebGL2 engine with GPU-resident semantic stars, instanced procedural star, edge, and glyph passes, plus a cached canvas fallback when WebGL is unavailable
- Layout: off-main-thread worker that caches the complete semantic model, transfers typed scene buffers once per source revision, and computes capped label, edge, and hit detail from activity summaries
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

### Next-generation Friends Galaxy

The current atlas starfield remains the shipping compatibility surface while the next renderer is built behind it. The approved replacement uses a constrained 3D galactic plane with stable semantic geography on `x` and `y`, relationship prominence on `z`, tight identity systems, provider sectors on the outer rim, a locked perspective camera, and a renderer-neutral typed scene protocol. The equal-workload renderer laboratory selected raw WebGPU as the preferred shared backend, with WebGL2 as the compatibility backend and native Metal still gated on later device evidence.

The foundation compiles the complete semantic galaxy into compact typed buffers for stable 3D positions, semantic prominence, bounded activity and recency brightness, theme color roles, interaction flags, and indexed edges. The atlas worker caches the rich semantic model by source revision and transfers the full star buffers only when graph source data or layout dimensions change. Pan and zoom retain those star buffers and move only the locked camera. Settled viewport requests return capped label, hit, and edge detail. Hover and selection patch dynamic typed arrays in place without rebuilding positions. An imperative engine owns the locked perspective camera, one instanced procedural star pass, one instanced settled edge pass, one instanced glyph label pass, depth-aware projected picking, theme palette resolution, WebGL fallback selection, resize, scene synchronization, rendering, and disposal. The React shell owns product props, worker lifecycle, interaction orchestration, and product callbacks. The complete approved vision, interaction contract, rendering contract, and staged roadmap live in [FRIENDS-GALAXY-ARCHITECTURE.md](./FRIENDS-GALAXY-ARCHITECTURE.md).

The detached worker stress envelope now contains 5,000 people, 25,000 accounts, 25,000 compact activity summaries representing 250,000 items, 30,000 semantic stars, and 100,000 decorative stars. Summary item counts contribute bounded activity values during worker compilation. No feed-item array enters the fixture or renderer. A paired structural regression increases represented item volume tenfold while preserving the same twenty-one transfer buffers and exact byte lengths, proving transfer size follows semantic and summary cardinality rather than represented item count. This is functional evidence only, not a timing benchmark.

The detached laboratory now starts through a one-shot worker with no main-thread graph compiler fallback. It transfers twenty-one numeric scene, interaction-index, spatial-pick, and direct-upload star buffers, retains all 30,000 semantic stars, and caps rich UI metadata at 192 nodes. Raw WebGPU resolves eleven active-theme colors in a fixed shader uniform block, so theme changes do not traverse or reupload resident stars. The worker-built sparse pick grid keeps pointer hit testing proportional to the camera corridor instead of the semantic star count, even when one pinned star is a distant outlier. WebGPU render density stays capped at 1.5 when settled and drops once at motion entry to 1.0 on compact canvases or 1.25 on wider canvases, without removing labels or stars. Product integration must remove the current `runAtlasOnMainThread` timeout path before cutover. Worker pressure must retain the last-good scene or enter a bounded compatibility state instead of rebuilding the complete galaxy in React.

Before any backend receives a worker result, the detached loader now performs constant-time envelope admission. It verifies the top-level response kind and request id, scene version, source counts, every transferred typed-array class and expected length, scene and pick bounds, sparse adjacency and pick-offset terminals, packed instance sizes, metadata cap, and receipt counts. Invalid messages and structured-clone deserialization failures terminate the one-shot worker immediately. Rejection never invokes a renderer or caller-side compiler. The admission path inspects only fixed metadata and terminal offsets, so it does not traverse resident stars, edges, labels, or feed items on the main thread.

Compact canvases now open at a useful 0.16 exploration scale around the semantic center instead of presenting literal fit-all as an apparently empty field. Wider canvases retain their useful fitted scale. The explicit Fit galaxy command still reveals every provider sector, so overview geography remains one action away without sacrificing first-use legibility.

The locked camera now derives a deep clip reserve from viewport height, perspective field of view, semantic scene depth, and the shared 20,000-unit far clip distance. It separately derives an outer interaction target from the current fitted galaxy bounds. Wheel pinch, Safari gesture events, native touch pinch, and keyboard zoom decelerate asymptotically toward that fitted target without reaching an abrupt stop or the deeper clip reserve. The directional transfer curve begins outward resistance at 1.8 times fitted scale and uses a decisive 0.15-power response as it enters the overview band. Inward input never traverses that compressed curve in reverse. Its first delta applies the ordinary multiplicative ratio used outside the band, so leaving maximum overview has no startup ramp or retained resistance. Native two-touch pinch retains its exact touch-distance ratio. Fit galaxy and resize recompute the same viewport envelope. Midpoint anchoring remains exact throughout both directions.

Shared UI source now owns the bounded Friends Galaxy description, selection and focus announcements, compatibility recovery announcement, and terminal renderer failure announcement. The detached graph consumes that copy through one focusable described region and one polite atomic live region. Renderer canvases are hidden from assistive technology, and the 30,000 semantic stars remain GPU instances with no per-star DOM. Arrow, zoom, fit, details, actions, and clear shortcuts are exposed through accessibility metadata. Programmatic focus selects and announces any semantic identity with its synthesized locale-formatted label, including nodes outside compact worker metadata. Pointer or touch selection, Escape clear, reduced-motion state, bounded clipboard feedback, compatibility recovery, and terminal renderer failure each produce concise announcements. Hover, camera movement, animation, and settle do not write the live region. Product cutover still owns context-menu focus restoration, mobile long press, identity-mode description, and search-to-focus acceptance.

The laboratory now renders into a full-canvas host beneath a separate bounded focus and input region. A retained geometry snapshot translates client input into canvas coordinates and derives camera insets from both rectangles. Backend sizing, fit, focus, keyboard zoom, pointer and touch picking, and Safari gesture anchoring now share those full-canvas coordinates. Desktop proof used a 1,280-pixel canvas with a 924-pixel interaction lane beginning at pixel 356. Fit centered the galaxy at pixel 818, exactly matching the usable-lane center, and offset pointer selection still picked the focused identity. Resizing the focused scene to 390 by 844 pixels preserved selection and reanchored the same galactic-plane point exactly at the new 195 by 422 pixel center while retaining all 30,000 semantic stars. Raw WebGPU, Three.js WebGPU, and WebGL2 retained the same geometry, and simulated Raw WebGPU loss recovered without losing the selected identity or offset. This proves the geometry required for rendering beneath the shared sidebar without allowing the sidebar to compete for graph gestures.

The detached engine now emits renderer-neutral overlay requests for context actions and details. Pointer context requests include the stable node ID, bounded interaction anchor, full-canvas point, and galactic-plane coordinates required by `Pin here`. Shift plus F10 and the Context Menu key project the selected star into the same request. Enter emits the selected node ID for Details. One-touch long press opens the same context request after 480 milliseconds, suppresses camera movement while pending or activated, and cancels on movement beyond four pixels, release, cancellation, or a second touch. The engine never performs link, pin, promotion, or detail mutations itself. Those remain React-shell callbacks, so no drag-to-link or drag-to-pin behavior returns. Browser proof produced one stationary request without changing the camera, then produced no request for threshold movement or two-touch cancellation.

The detached engine now has an explicit resident presentation lifecycle for the mobile `Details` lens. Suspending presentation cancels long press, active contacts, inertia, hover work, settle work, and scheduled frames, makes the graph region inert and hidden from assistive technology, and hides the retained canvas without disposing it. Settled labels and avatars cannot start or commit while suspended. Resuming reuses the exact canvas, backend, camera transform, selection, semantic buffers, and resident-star uploads, then restores bounded settled presentation. Raw WebGPU held its buffer, label-atlas, avatar-atlas, and resident-star upload counters unchanged throughout the suspended interval. Raw WebGPU, Three.js WebGPU, and WebGL2 each resumed with the same canvas object, 30,000 semantic stars, camera, and selected identity.

The proven full-canvas geometry and engine-to-overlay interaction contracts now live in neutral shared UI modules instead of laboratory-only files. The laboratory imports those shared modules directly. The shared imperative handle exposes `fitAll`, stable-ID `focusNode`, and resident `setPresentationVisible`. The shared overlay contract owns bounded context anchors, galactic-plane pin coordinates, details requests, keyboard commands, and the cancellable long-press tracker. Product cutover can delegate the existing `FriendGraph` ref and callbacks to these exact implementations without copying or renaming their behavior.

The allocation-free camera-input primitives now share that same destination. The fixed pointer roster, bounded inertial-pan controller, scalar settle scheduler, and presentation-aware demand-frame predicate live under shared UI source and are imported by the laboratory. The future product engine can use the exact tested state machines for native touch, pointer throws, settle, idle sleep, and mobile Details suspension instead of translating the old React Maps, arrays, timeouts, and frame refs.

The locked perspective camera and gesture mathematics are now shared product primitives too. Clip-safe near and far scale limits, full-canvas inset-aware fitted scale, one derived camera-frame state, compact initial framing, framed transforms, prominence-safe focus, overview, middle, and close detail thresholds, WebGPU view and motion uniforms, directional outward resistance, native-speed inward reversal, midpoint-preserving pinch, focal-point zoom, and Mac wheel normalization all live under shared UI source. The laboratory, raw WebGPU backend, diagnostics, avatar projection, and functional tests import those exact modules. The detached shell no longer composes its own fit or detail tiers, and product cutover does not need a second camera curve.

The bounded observability and renderer-recovery primitives now live under shared UI source as well. The fixed typed sample ring and settled diagnostic refresh gate, passive feature-detected long-task monitor, and first-failure backend health latch are imported directly by the laboratory and both WebGPU backends. Product cutover can report the same bounded renderer evidence and consume an idle device-loss signal without copying laboratory counters, adding a polling timer for long tasks, or rebuilding diagnostics during camera movement.

The renderer scene envelope now lives under shared UI source too. Raw WebGPU, Three.js WebGPU, WebGL2, billboard labels, and avatar admission receive one renderer-neutral object containing the atlas, typed scene, sparse interaction index, direct-upload star instances, decorative background buffers, and locale-independent source counts. Synthetic fixture-only activity and build diagnostics extend that envelope outside the renderer. Product cutover can therefore supply the real worker result without teaching a backend about laboratory metadata.

The complete worker-scene admission contract now shares that boundary. Shared UI source owns the exact twenty-one unique transferable buffers, structural scene receipt, semantic array and bounds validation, adjacency and sparse-pick terminal checks, packed-instance lengths, source-count consistency, rich-metadata cap, and top-level malformed-envelope rejection. The detached fixture protocol adds only its synthetic activity-volume and build fields around that shared validator. Product cutover can therefore admit a real worker response through the same constant-time checks before any renderer initializes, without retaining a laboratory wrapper or a second transfer list.

The complete renderer palette now has the same boundary. Shared UI source owns background, surface, primary text, muted text, friend, connection, account, feed, selection, and fixed provider colors. It also owns the complete Scriptorium, Neon, Midas, and Ember renderer palette map keyed by the existing Freed theme ids. A shared semantic resolver reads only the typed scene kind and provider arrays, so Three.js color buffers and avatar seeds no longer call a laboratory helper. The backend alias accepts the shared scene and palette contracts directly. The laboratory retains only synthetic label metadata.

Settled presentation assembly now lives behind one shared node-presentation resolver too. Product or laboratory code supplies only a label, initials, and priority for a typed scene node. Shared UI source owns visible-person ranking, compact and detail caps, selected-person retention, linked-account parent resolution, depth-aware viewport admission, label collision spacing, avatar exclusion, label and avatar atlas construction, and fixed-capacity interaction-overlay packing. Raw WebGPU and Three.js WebGPU consume this same pipeline. Synthetic identity names stay in the fixture, while no backend imports a laboratory presentation helper.

The same camera contract now derives a prominence-safe maximum scale from viewport height, maximum semantic depth, and a 96-unit near-camera clearance. Compact zoom can no longer pass through the closest friend stars. Programmatic `focusNode` navigation uses the target star's real `z` depth and the bounded usable viewport insets, so Reader, search, Map, and details handoffs can center a star beside the desktop rail or above mobile chrome while the canvas remains full bleed. Focus changes only camera and sparse interaction state. It does not reupload resident stars.

One shared renderer host now owns the active scene, theme palette, dimensions, density, animation preference, camera-motion state, provider-field style, selection, hover, settled detail, camera transform, bounded viewport presentation, and incremental activity patches. Every preferred-backend activation and compatibility recovery receives that complete state before its canvas becomes visible. A settled presentation update replaces only bounded rich nodes, labels, and provider regions, then rebuilds the label and avatar presentation against the retained semantic scene. It does not recreate semantic stars, the sparse interaction index, or the camera. The detached shell routes rendering, picking, palette changes, interaction, simulated loss, and disposal through the host while keeping asynchronous avatar image admission outside it. Product cutover can therefore replace a failed WebGPU canvas without presenting a default theme, stale selection, wrong density, or partially initialized detail tier.

Frame and submission diagnostics now use fixed 240-value typed rings. Active camera motion suppresses diagnostics DOM rebuilding, then refreshes the panel after settle from one bounded snapshot. The detached gesture path no longer shifts diagnostic arrays or performs periodic panel layout while the camera is moving.

Shared UI source now owns one versioned, identity-free diagnostic snapshot and its frame-statistics helper. It accepts structural worker source counts, shared renderer metrics, bounded camera and runtime state, and passive long-task evidence without importing fixture or theme types. Every required text field and optional renderer description is length-bounded, and non-finite optional metrics normalize to null. The detached laboratory exports this schema from an opaque standard control. It includes worker source scale, renderer and adapter state, fallback and recovery state, resident and motion counts, presentation counts, identity-detail opacity and transition state, sparse activity and pick evidence, camera safety, input mode, render density, upload counters, fixed-ring frame summaries, and passive long-task evidence. It excludes names, IDs, URLs, sample items, avatars, and feed payloads. Clipboard failure is contained and leaves the control usable. Product cutover must feed this same shared schema through the installed renderer heartbeat.

With animation disabled, the detached renderer now schedules frames only for dirty GPU work or a pending settle deadline. It stops requesting animation frames when the scene is idle and exposes that state on the viewport. Diagnostics request a frame only when changed data reaches the bounded refresh interval. One persistent low-frequency health poll remains active so an idle WebGPU device loss still recovers without a permanent animation loop.

Motion-density transitions no longer resize the GPU canvas synchronously inside pointer, wheel, or Safari input. Motion state marks one pending resize and requests a frame. The render callback applies the latest density once before drawing. The same callback consumes settle state and restores settled density. Repeated input before that frame cannot trigger duplicate canvas resizing.

Active pointer movement now reuses viewport bounds captured at gesture start and mutates only the two resident touch records. Hover coalescing retains one scalar coordinate pair. Safari trackpad pinch stores the previous cumulative gesture scale and midpoint as scalars. Each `gesturechange` applies only the incremental ratio, so reversing inward responds on the first event instead of repaying cumulative outward gesture movement. While the camera remains inside the compressed overview band, that inward ratio advances at a constant full-speed response and preserves residual input when it crosses back into ordinary zoom. The handler performs no point allocation or viewport geometry read.

The practical outer target now sits two percent beyond the padded fitted overview instead of ten percent beyond it, while resistance begins at 1.8 times fitted scale. The rational ceiling uses a 0.15-power response that keeps the boundary derivative continuous and brakes more decisively deeper in the band. Wheel, touch, Safari, and keyboard zoom use that asymptotic curve only for outward travel. Every inward ratio responds on the first event at ordinary multiplicative speed, including a reversal that begins almost at the outer target. Keyboard and native two-touch inward ratios remain exact.

The detached shell now shares one cached viewport origin across hover, pointer, wheel, and Safari input. It refreshes geometry at pointer entry, gesture start, the first event in a wheel burst, and resize. Every event inside the active interaction uses the cached scalar origin. A diagnostic counter exposes the exact geometry-read count without rebuilding the metrics panel during movement.

Touch state now lives in one fixed-capacity typed pointer roster instead of two Maps. On touch-capable hardware, the detached shell uses non-passive native Touch Events and ignores duplicate touch Pointer Events. Mouse and pen remain on Pointer Events. Touch start writes scalar identity, position, and gesture origin once. Active pan and pinch perform indexed scalar reads and writes without creating a Map iterator or position object. Removing either touch shifts the surviving roster in place and cancels the former pinch deadline, so the interaction hands directly back to one-finger pan without settling underneath the remaining contact. Touch cancellation clears the complete roster before settle so stale contacts cannot block the next gesture.

Mac trackpad input now separates pan from zoom. Ordinary wheel deltas pan the camera and preserve the operating system's continuing momentum events. Control-modified wheel input and Safari gesture events retain midpoint-anchored pinch zoom and feed a separate logarithmic inertial controller. A 72 millisecond scalar release deadline recognizes the end of a control-wheel pinch without allocating a timer per event. The final scale velocity then decays around the last pinch focal point, remains inside the directional outer ceiling, and stops early when the ceiling absorbs visible movement. Pointer and one-finger touch drags use the existing bounded pan controller, so a quick release continues transform-only motion without adding synthetic momentum on top of the trackpad's native pan momentum. Both controllers reuse one result object, cap launch velocity, decay in the demand-driven frame loop, cancel after a stalled frame or any new input, and schedule presentation settle only after motion ends. Reduced-motion preference disables both throws. No star, edge, label, avatar, or GPU buffer rebuild runs during inertia.

Pinch and wheel movement now update one persistent settle deadline instead of canceling and allocating a browser timeout on every event. The animation loop consumes only the latest generation after 140 ms, then restores render density, detail, and bounded avatar admission once.

Settled avatar admission now retains an exact backend, detail, compact-width, and selected-person key. Ordinary close-zoom settles reuse the applied image map without rescanning avatar candidates or rebuilding the atlas. Matching in-flight work advances to the latest settle generation, while stale or superseded completions cannot overwrite a newer backend or selection. Theme changes rebuild presentation from retained images inside the backend and do not restart decoding.

Identity detail icons now fade through a scale-derived opacity band and an elapsed-time controller instead of appearing at the close-detail threshold. Raw WebGPU updates one dedicated four-float opacity uniform while keeping its recorded avatar bundle resident. The Three.js WebGPU reference updates the equivalent TSL uniform. Startup prepares a hidden six- or twelve-icon roster from the worker's bounded atlas metadata, close settle may replace it with the projected visible roster, and a changed roster restarts transparent. Zoom frames do not select candidates, rebuild the atlas, decode images, or touch labels and stars. The demand loop remains active only while the short presentation transition is unfinished. Disabled animation and reduced-motion operation settle the opacity immediately.

Decorative background stars now participate in camera zoom instead of retaining a fixed screen-pixel diameter. One shared bounded curve keeps the existing dust size at the overview-to-middle boundary, makes distant overview dust smaller, and grows close-detail dust without allowing it to compete with semantic identities. Raw WebGPU evaluates the curve in its resident star vertex shader, Three.js WebGPU updates one scalar TSL uniform, and WebGL2 updates one point-material uniform. Camera movement still performs no star-buffer upload, scene rebuild, or main-thread traversal.

The keyed avatar admission state and bounded image admission queue now live under shared UI source and are consumed directly by the detached shell. The shared queue deduplicates source revisions, caps concurrent decoding, caches failures, evicts least-recently-used images with deterministic bitmap cleanup, and resolves queued work during disposal. The shared generation state coalesces matching work and prevents stale backend, detail, viewport-class, or selected-person completions from committing. Product cutover can connect real avatar candidates without cloning this lifecycle into React.

Hover and selection now reuse one scene-index state object, one role map, and one fixed-capacity contextual-edge buffer sized from the worker-reported maximum adjacency degree. The Three.js reference and current WebGL2 fallback retain their touched and changed index sets instead of rebuilding maps, sets, typed views, or edge arrays for each focus change. The Three.js reference also allocates its maximum contextual-edge geometry and sparse attribute-update records once during startup. Renderer startup does not scan the transferred adjacency table.

The transferable interaction-index compiler and the allocation-bounded scene interaction engine now live under shared UI source. Their inputs are only the renderer-neutral typed galaxy scene, its worker-built hash, adjacency, and sparse pick buffers, and a stable selected plus hovered ID pair. The detached fixture no longer enters node lookup, contextual constellation assembly, interaction flag patching, or depth-aware picking. Raw WebGPU, Three.js WebGPU, WebGL2, labels, avatars, and shell focus all consume the same shared stable-ID lookup and sparse scene state that product cutover will use.

The allocation-free perspective projection helper now lives under shared UI source too. It projects a world point into a caller-owned two-value target through the shared view-projection matrix and reports bounded viewport admission without allocating screen vectors. Settled labels, avatars, shell menu anchors, and functional projection tests consume the same helper, so product cutover has one depth-aware screen coordinate contract for presentation and overlay placement.

The billboard compositors now live under shared UI source behind renderer-neutral seed and palette contracts. Product metadata supplies a resolver for label, initials, and priority, while shared presentation assembly chooses which labels and avatars enter the settled tier. The shared label compositor owns avatar exclusion, the stronger theme-background outline, glyph measurement, texture packing, UV generation, and the eleven-float instance stream. The shared avatar compositor owns circular image clipping, initials fallback, selected borders, texture packing, UV generation, and the matching instance stream. Product cutover can replace synthetic metadata with real identities without rewriting candidate ranking, collision, selection retention, or GPU presentation assets.

Raw WebGPU now leaves the 30,000-instance base semantic buffer untouched during interaction. It packs the active identity system into one fixed-capacity overlay stream, uploads that stream once, and selects a pre-recorded world bundle that adds the overlay draw. Clearing interaction selects the base bundle again. Contextual edges remain one separate bounded upload. Hover cost is therefore independent of where linked stars live in the resident buffer and no longer performs one queue write per affected star.

Raw WebGPU now also records contextual edges, avatar billboards, and label billboards as retained render bundles. Each frame executes one ordered bundle list containing the selected world bundle and only the active presentation layers. Camera movement no longer reissues their pipeline, bind group, vertex buffer, or draw commands from JavaScript. Interaction and settle boundaries replace only the affected bundle, while shared uniform and vertex-buffer writes remain visible through the recorded commands.

Raw WebGPU now receives animation and camera-motion state through its imperative backend contract. With animation disabled or the camera moving, one coherent uniform branch skips per-vertex twinkle phase arithmetic and trigonometry and freezes procedural drift. Active star fragments use squared radius and multiply-only falloff instead of square root, exponential, and fractional power. Active motion exits the field shader through one coarse noise sample and a bounded envelope. Only the stream variations add one spiral phase. Settled rendering restores the complete luminous star profile plus seven independent four-octave field samples, domain warping, wisps, and both spiral phases. The sign bit of the existing camera-scale uniform carries motion state, so no uniform block, bind group, pipeline, geometry, label, or resident-star rebuild occurs. Every semantic star and billboard label remains resident and visible in both states.

The former laboratory `Animate` switch is now an accurate shared `Ambient motion` preference. Raw WebGPU, Three.js WebGPU, and the WebGL2 compatibility renderer all use the same settled-only shader time contract for selective stellar scintillation and depth-sensitive decorative dust drift. Raw WebGPU and WebGL2 also animate their provider field geometry. Camera movement freezes those cosmetic shader branches, and reduced-motion preference disables them. The motion path writes only scalar uniforms. It never traverses the scene, updates instance buffers, rebuilds labels or avatars, or changes the locked camera. Diagnostic schema 2 records whether ambient motion is active and names the renderer-specific bounded profile.

Moving Raw WebGPU stars now use a retained regular-octagon triangle strip instead of the settled square strip. The footprint preserves horizontal and vertical star diameter while reducing potential fragment coverage by about 29 percent and clipping only the faint outer edge between axis points. A small alpha cutoff skips negligible outer-halo blending. Settle switches back to the complete square footprint and luminous profile by selecting a pre-recorded world bundle. No geometry rebuild, draw-count mutation, or resident-star change occurs at the motion boundary.

The direct-upload star instance and geometry contracts now live under shared UI source. The product worker and raw backend can share the exact eight-float semantic and decorative instance layout, stable semantic and provider palette roles, four-vertex settled square, eight-vertex motion octagon, and 50,000-star decorative motion cap. The detached fixture compiler, worker envelope admission, interaction overlay encoder, palette uniforms, raw backend, and functional tests all import those shared constants and builders. Product cutover no longer needs to translate worker output into a second GPU star format.

Theme resolution now uses a shared structural star-palette contract too. It defines the eleven semantic and provider roles, fixed uniform offset and length, normalized color conversion, light-surface classification, clear color, and role alpha policy consumed by Raw WebGPU. The laboratory palettes extend that contract directly, while Raw WebGPU, Three.js WebGPU, WebGL2, provider fields, document theming, and tests all use the same color parser. Product cutover can therefore pass active theme tokens into every backend without a laboratory palette adapter or resident-star traversal.

Provider-field compilation now lives under shared UI source as well. It owns the fixed twelve-float instance layout, style codes, close-detail culling threshold, deterministic identity and provider geometry, active-theme colors, and light-versus-dark opacity policy. Geometry scans the bounded person positions once when the scene is admitted. Later theme and field-style changes mutate only the retained six-instance presentation block, so they never rescan people or replace GPU storage. Empty identity scenes produce finite one-by-one core geometry, and unknown provider keys fall back to the account theme role.

Incremental activity indexing and sparse scene patch encoding now live under shared UI source and are consumed directly by the detached laboratory. The index retains only source-level counts, three recent sample IDs, location presence, and three avatar candidates for each social external ID or RSS URL. Normal deltas update affected source keys directly. Removing a retained leading candidate asks the owning document worker to rebuild only that source. The encoder converts those source patches into sorted typed node updates without positions, labels, sample IDs, or feed-item records. Product cutover must connect the existing feed mutation boundary to these modules and delete the current whole-item Friends mount builder. That production path remains intentionally unchanged while global behavioral custody is closed.

Backend selection and recovery now use one renderer-neutral runtime under shared UI source. A replacement renderer initializes on a hidden candidate canvas while the current canvas remains visible, then commits atomically only after scene and interaction state are ready. A newer request invalidates the older generation and removes its candidate surface immediately. Preferred-backend failure falls through to WebGL2, but retains an already healthy WebGL2 instance instead of rebuilding it. Runtime failure recovers once, while compatibility failure latches terminal state and stops the demand loop instead of retrying forever. The bounded diagnostic snapshot now records backend generation, recovery-pending state, terminal state, and the existing bounded reason. Product cutover can supply its real backend factories and callbacks to this same controller without recreating switch state in React.

The renderer interface now lives under shared UI source too. It owns backend IDs, overview, middle, and close detail tiers, the existing shared transform, renderer metrics, palette constraints, interaction updates, activity patches, avatar images, field style, ambient-motion and camera-motion state, picking, rendering, health, simulation hooks, and disposal. Its scene is a generic type parameter, so the detached synthetic fixture and the future product worker envelope can use the same renderer lifecycle without either importing the other. A concrete shared backend type binds the renderer-neutral scene and complete palette. Raw WebGPU, Three.js WebGPU, and WebGL2 implement that type directly and import no laboratory module. The detached shell also imports backend IDs, backend state, interaction, field style, and detail types directly from shared UI source. The former laboratory alias module has been deleted. The motion render-density policy moved with this interface and remains covered by the existing compact and wide viewport tests.

The three concrete renderer implementations now live under shared UI source too. One shared lazy factory resolves the requested renderer ID and injects the node-presentation resolver only into the WebGPU implementations that need settled label and avatar metadata. The detached laboratory imports this factory and owns no renderer class or dynamic renderer path. Product cutover can therefore instantiate Raw WebGPU, Three.js WebGPU, or the WebGL2 compatibility renderer from the real Friends engine without reaching into laboratory source or eagerly adding the large Three.js WebGPU reference chunk to startup.

The moving world bundles draw a deterministic 50,000-star prefix of the 100,000 resident decorative dust stars. Their index-keyed placement keeps that prefix evenly distributed across the galactic field. All 30,000 semantic stars, interaction overlays, labels, avatars, and edges remain complete. Settle returns the full decorative stream without an upload or bundle rebuild.

Provider fields now become degenerate in the vertex shader beyond 1.5 close-detail scale. Their existing camera fade has already reduced them to atmospheric residue by that point. The cutoff prevents six large, effectively invisible field quads from rasterizing or running noise fragments over close-zoom stars, labels, and avatars. Overview and middle detail remain unchanged.

Provider sectors now follow deterministic logarithmic spirals shared by layout and rendering. The default Nebula treatment combines procedural arms and themed dust without per-star scene objects. Linked accounts stay close to their parent identity, billboard labels sit close to their parent star with a stronger outline, and semantic links remain absent until one star in that identity system is hovered or selected.

The approved product cutover now has an exact ownership boundary. `FriendsView` keeps selection, details, promotion, context-menu linking, context-menu pinning, mode, persistence, and mobile Details behavior. A reduced `FriendGraph` shell delegates worker startup, rendering, camera, input, picking, detail tiers, palette, recovery, and diagnostics to the imperative engine. Cutover must delete the main-thread atlas fallback and reuse the detached pointer roster, settle scheduler, demand-driven loop, sparse index, render bundles, labels, avatars, and recovery primitives without duplicating them.

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
- The visible node budget applies to hit, label, avatar, and edge detail. It does not evict semantic stars from GPU residency.
- Motion scope: camera movement, hover, focus, selection, pinning, settle transitions, and optional shader-only ambient cosmic motion. There is no live force simulation during interaction

### Files

- `packages/ui/src/components/friends/FriendsView.tsx` — top-level view shell
- `packages/ui/src/components/friends/FriendGraph.tsx`: graph atlas starfield shell with camera gestures, context menus, worker orchestration, and diagnostics
- `packages/ui/src/lib/identity-graph-model.ts` — derived person, channel, and feed graph model
- `packages/shared/src/friend-suggestions.ts`: pure suggestion-only friend candidate ranking from identity, activity, content signals, and contact overlap
- `packages/ui/src/lib/identity-graph-layout.ts` — stable radial layout plus spatial index helpers
- `packages/ui/src/lib/identity-graph-layout.worker.ts` — worker entrypoint for graph layout
- `packages/ui/src/lib/identity-graph-activity-summary.ts` - summary builder for graph activity counts, latest activity, samples, location presence, and avatar candidates
- `packages/ui/src/lib/identity-graph-atlas.ts` - capped atlas builder with provider clusters, LOD tiers, labels, hit buckets, bounds, and metrics
- `packages/ui/src/lib/identity-graph-atlas.worker.ts` - worker entrypoint for graph atlas slices
- `packages/ui/src/lib/identity-galaxy-scene.ts` - renderer-neutral typed scene compiler for semantic 3D node and edge buffers
- `packages/ui/src/lib/identity-galaxy-camera.ts` - locked perspective camera and plane-to-viewport projection math
- `packages/ui/src/lib/identity-galaxy-worker-protocol.ts` - typed worker request, response, and transferable buffer contract
- `packages/ui/src/lib/identity-galaxy-engine.ts` - imperative rendering engine and current Three.js plus canvas compatibility backends
- `packages/ui/src/lib/identity-galaxy-provider-field.ts` - deterministic provider spiral geometry shared by atlas placement and rendering
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
Trackpad and multitouch pinch zoom are now captured by the Friends graph itself. Mac Safari `GestureEvent` input, Chromium control-wheel input, and native iPhone touch input all map to the same locked camera while browser page zoom stays unchanged.
Panning and pinching no longer request an interactive atlas or rebuild node, edge, region, or label resources. Settled billboard labels remain visible while the camera moves, and collision placement refreshes only after settle.
The graph draw scheduler now uses its animation frame ID as the only pending state. React development effect cleanup clears that ID, which prevents the local preview from becoming stuck at one update every few seconds after its first canceled frame.
Scriptorium also now gives the graph a darker node palette, stronger edges, and real label contrast, so the Friends view reads like an interface instead of a ghost story printed on oatmeal.
The Friends graph viewport now owns its own soft-mask compensation instead of inheriting the primary sidebar offset, which restores the left-edge vignette so all four edges feather consistently like the map view.
The identity graph now builds activity counts in one pass, uses cheaper bucketed overlap resolution in the worker, keeps motion transform-only, and exposes internal timing counters so performance regressions can fail in desktop tests instead of sneaking into a merge.
The Friends graph now uses a graph atlas instead of the previous full-scene Pixi renderer. The worker builds capped viewport slices from activity summaries, the starfield renderer draws only the visible graph tier, provider labels stay visible at overview zoom, and diagnostics report source nodes separately from visible nodes so dense graph tests prove the cap instead of accidentally requiring the old expensive payload.
The Friends graph now renders that atlas as a theme-aware 3D starfield. Prominent friends sit closer to the camera, panning has slight depth parallax, provider zones can switch between nebula clouds, constellation rings, or both in dev, and headless or no-WebGL environments use a canvas starfield fallback while preserving diagnostics.
Graph linking and pinning now live in node context menus. Accounts link through a searchable person picker, and pinning writes the clicked node position without turning normal pan gestures into accidental edits.
Friend captions in the graph now use pill backgrounds and label-aware spacing, so names stay readable instead of collapsing into an overlapping word soup.
The Friends starfield now bleeds under the primary app sidebar like the map background, while fit and focus math use measured viewport insets so graph content stays centered in the visible workspace.
Friend avatars now inherit a theme-authored tint across the Friends graph and map markers, so each theme stays coherent without a stray custom accent fighting the palette.
The Friends graph now defaults to `All content`, keeps confirmed friends as larger center hubs, renders their linked channels as smaller radial satellites with straight connectors, and shows every other captured social account on the periphery inside provider-shaped metaball island regions.
Unlinked accounts can now be promoted to friends or linked to an existing friend directly from the Friends sidebar workflow, while unlinked map markers route into that same account workflow instead of dead-ending.
Map popovers now use a wider card layout and deliberately omit the old MapLibre tail, so place names and actions fit cleanly without the popup looking like a speech bubble from a cheaper app.
Friends and Map now consume the same shared theme tokens, button treatments, shell backgrounds, surface recipes, and theme-native map palettes as the rest of Freed, so Neon, Midas, Ember, and Scriptorium land consistently across the graph, sidebars, popovers, mini-map cards, editor, contact-sync flows, and map basemap itself.
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
| 8.53 | Reconcile partial Substack and Medium follow rosters as accounts and provisional human connections without automatic friend promotion | Medium | Done |
| 8.54 | Rescan provisional identity repair when roster identity details improve in place | Medium | Done |
| 8.55 | Discover and enrich authenticated essay authors atomically when item counts stay unchanged | Medium | Done |
| 8.56 | Define and integrate the renderer-neutral Friends Galaxy typed scene protocol | High | Done |
| 8.57 | Replace the atlas starfield with the approved GPU-resident Friends Galaxy engine, locked camera, batched labels, and depth-aware picking | High | In Progress |
| 8.58 | Transfer typed galaxy scene buffers from the atlas worker and patch interaction state in place | High | Done |
| 8.59 | Move renderer, palette, fallback, and GPU resource ownership out of React into an imperative galaxy engine | High | Done |
| 8.60 | Cache the full semantic galaxy model in the worker and retain every semantic star across viewport atlas updates | High | Done |
| 8.61 | Add the locked perspective camera, world-plane projection, and depth-aware picking | High | Done |
| 8.62 | Render semantic stars and settled relationship spokes through instanced procedural WebGL2 passes | High | Done |
| 8.63 | Replace per-label Troika objects with one instanced glyph-atlas billboard layer | High | Done |
| 8.64 | Route iPhone graph gestures through native non-passive touch events, with browser-generated multitouch and WebKit regression coverage | High | Done |
| 8.65 | Route Mac Safari trackpad gestures through native gesture events while keeping motion transform-only and labels resident | High | Done |
| 8.66 | Add the close-zoom avatar texture atlas for selected and high-priority identities | High | Planned |
| 8.67 | Replace elliptical provider regions with theme-aware spiral nebulae, tighten identity systems and labels, and reveal links only for the active constellation | High | Done |
| 8.68 | Prove the selected raw WebGPU backend, procedural six-field nebula batch, provider-specific arm geometry, compact allocation-free gesture path, tracked GPU payload diagnostics, and equal 30,000 plus 100,000 star workload in the detached renderer laboratory | High | Done |
| 8.69 | Prove source-key activity summaries become proportional typed scene patches and sparse raw WebGPU instance writes without positions or item payloads | High | Done |
| 8.70 | Prove bounded settled avatar image decode, failure caching, stale-completion rejection, compact admission caps, and bitmap disposal in the detached WebGPU laboratory | High | Done |
| 8.71 | Prove runtime WebGPU device-loss reporting and one-shot recovery into the current WebGL2 engine while preserving theme, camera, scene, and interaction state | High | Done |
| 8.72 | Prove worker-only galaxy compilation, transferable scene and interaction indexes, bounded rich metadata, and explicit startup failure without a main-thread graph rebuild | High | Done |
| 8.73 | Prove worker-packed direct-upload star streams and shader-resolved theme palettes without resident-star loops or reuploads | High | Done |
| 8.74 | Prove worker-built transferable sparse spatial picking with exact bounded candidate projection in both WebGPU backends | High | Done |
| 8.75 | Prove bounded settled and motion render density on Retina and compact WebGPU canvases without evicting semantic detail | High | Done |
| 8.76 | Separate useful compact initial framing from explicit fit-all while preserving the locked semantic center | High | Done |
| 8.77 | Remove diagnostic array shifts and DOM refreshes from the active camera path with fixed typed sample rings | High | Done |
| 8.78 | Remove point allocations and repeated viewport geometry reads from pointer, hover, and Safari gesture movement | High | Done |
| 8.79 | Replace per-event settle timeout churn with one animation-loop deadline scheduler | High | Done |
| 8.80 | Reuse interaction roles, contextual-edge storage, sparse update ranges, and changed-index sets across every hover and selection | High | Done |
| 8.81 | Freeze twinkle and reduce procedural nebula octaves during camera motion without removing stars, labels, or GPU buffers | High | Done |
| 8.82 | Replace scattered raw WebGPU interaction writes with one fixed overlay upload and pre-recorded interactive world bundle | High | Done |
| 8.83 | Cache one viewport origin across hover, pointer, wheel, and Safari input so active event bursts perform no repeated geometry reads | High | Done |
| 8.84 | Replace pointer Maps and per-move iterators with one fixed typed roster that preserves two-touch handoff | High | Done |
| 8.85 | Retain keyed avatar admission across close-zoom settles and coalesce matching in-flight decode work | High | Done |
| 8.86 | Replace the permanent idle animation loop with demand-driven frames and a bounded backend-health poll | High | Done |
| 8.87 | Replace the fourteen-noise camera-motion field path with one coherent coarse sample while retaining the complete settled nebula | High | Done |
| 8.88 | Replace moving-star square root, exponential, fractional power, and unused twinkle phase work with coherent multiply-only falloff | High | Done |
| 8.89 | Defer motion-density canvas resizing out of input handlers and coalesce it in the next requested render callback | High | Done |
| 8.90 | Retain raw WebGPU edge, avatar, and label presentation commands in one ordered frame bundle list | High | Done |
| 8.91 | Reduce moving-star raster footprints with retained octagon strips while preserving semantic-star diameter and settled luminosity | High | Done |
| 8.92 | Bound decorative motion density while retaining every semantic star and the full settled dust field | High | Done |
| 8.93 | Cull fully faded provider field primitives before close-detail rasterization | High | Done |
| 8.94 | Define the exact workflow-preserving product cutover and main-thread fallback removal boundary | High | Done |
| 8.95 | Admit settled billboard labels and avatar images from the perspective-projected visible identity roster | High | Done |
| 8.96 | Define the full-canvas render and bounded interaction topology plus the product cutover acceptance matrix | High | Done |
| 8.97 | Expose presentation build counters and remove duplicate selection settle rebuilds | High | Done |
| 8.98 | Define keyboard, assistive-technology, menu-focus, and reduced-motion cutover requirements | High | Done |
| 8.99 | Route detached iPhone pan and pinch through native Touch Events with duplicate-pointer suppression, direct pinch-to-pan handoff, and cancellation recovery | High | Done |
| 8.100 | Reject malformed or mixed-version worker envelopes before GPU admission with constant-time typed-buffer, sparse-offset, bounds, metadata-cap, and receipt validation | High | Done |
| 8.101 | Add native Mac two-finger trackpad pan plus bounded allocation-free pointer and touch inertia with cancellation, reduced-motion, and settle guarantees | High | Done |
| 8.102 | Derive clip-safe camera scale limits, route every continuous zoom path through shared focal-point-preserving math, and keep fit plus resize inside the safe range | High | Done |
| 8.103 | Derive a prominence-safe maximum zoom and prove depth-correct programmatic focus inside desktop and compact full-canvas interaction insets | High | Done |
| 8.104 | Bind 25,000 compact activity summaries representing 250,000 items into the admitted worker stress envelope without item payloads or transfer growth | High | Done |
| 8.105 | Add a bounded identity-free Friends Galaxy diagnostic export with source, renderer, camera, input, recovery, and presentation health | High | Done |
| 8.106 | Add passive bounded long-task evidence with explicit unsupported state and no timer or camera-path work | High | Done |
| 8.107 | Separate fitted outer navigation from the far clip reserve, use asymptotic outward resistance, and restore native inward zoom speed on the first event | High | Done |
| 8.108 | Add one accessible graph region with hidden canvases, synthesized selection labels, reduced-motion description, and bounded selection plus recovery announcements | High | Done |
| 8.109 | Separate the detached full-canvas render host from the bounded interaction lane and prove offset fit, focus, picking, responsive center reanchoring, and compact collapse | High | Done |
| 8.110 | Define stable details and context-action requests with bounded anchors, plane coordinates, keyboard actions, and cancellable one-touch long press | High | Done |
| 8.111 | Add resident presentation suspension for mobile Details with inert accessibility, complete transient-work cancellation, zero hidden frame or atlas work, and exact resource-preserving resume | High | Done |
| 8.112 | Move the proven full-canvas geometry, overlay request, keyboard, long-press, and imperative engine-handle contracts into shared UI modules consumed by the detached laboratory | High | Done |
| 8.113 | Move the fixed pointer roster, bounded inertia, scalar settle scheduler, and presentation-aware demand-frame predicate into shared UI modules consumed by the detached laboratory | High | Done |
| 8.114 | Move the clip-safe locked-camera and directional gesture mathematics into shared UI modules consumed by the laboratory and raw WebGPU backend | High | Done |
| 8.115 | Move the fixed diagnostic ring, passive long-task monitor, and first-failure backend health latch into shared UI modules consumed by the laboratory and WebGPU backends | High | Done |
| 8.116 | Move keyed avatar admission and the bounded image decode, failure-cache, eviction, and disposal queue into shared UI modules consumed by the detached shell | High | Done |
| 8.117 | Move the transferable stable-ID, adjacency, sparse-pick index and allocation-bounded interaction scene state into shared UI modules consumed by every detached backend | High | Done |
| 8.118 | Move allocation-free depth-aware world-to-screen projection and bounded viewport admission into a shared UI module consumed by labels, avatars, and shell overlays | High | Done |
| 8.119 | Split synthetic settled-candidate ranking from shared theme-aware label and avatar billboard compositors with stable texture, UV, and instance contracts | High | Done |
| 8.120 | Move the eight-float direct-upload star stream, palette-role encoding, settled and motion geometry, and decorative motion cap into shared UI modules | High | Done |
| 8.121 | Tighten the fitted outer zoom envelope and convert cumulative Safari gesture scale into incremental ratios with immediate native inward reversal | High | Done |
| 8.122 | Move the structural theme palette, normalized color parser, fixed star-uniform layout, and light-surface role policy into shared UI source | High | Done |
| 8.123 | Strengthen the fitted zoom ceiling and remove compressed-scale startup lag from inward trackpad, wheel, Safari gesture, and keyboard zoom while preserving exact native touch ratios | High | Done |
| 8.124 | Move provider-field geometry, presentation, style, stride, and close-culling contracts into shared UI source without rescanning people on theme changes | High | Done |
| 8.125 | Move the source-key incremental activity index and sparse typed scene patch encoder into shared UI source without connecting the frozen product route | High | Done |
| 8.126 | Move atomic backend activation, stale-candidate disposal, compatibility retention, one-shot recovery, and terminal latching into shared UI source | High | Done |
| 8.127 | Move renderer IDs, detail tiers, transform, metrics, lifecycle methods, and motion render-density policy into one shared generic backend contract | High | Done |
| 8.128 | Move the renderer scene envelope into shared UI source so every backend consumes the same atlas, scene, sparse interaction index, direct-upload stars, background field, and source counts | High | Done |
| 8.129 | Strengthen the asymptotic outer ceiling and give trackpad inward reversal an immediate constant-speed log response with boundary-crossing input preservation | High | Done |
| 8.130 | Move the complete renderer palette and typed-scene semantic color resolver into shared UI source, then remove laboratory scene and palette types from every backend contract | High | Done |
| 8.131 | Move bounded label and avatar selection, selected-parent resolution, atlas assembly, and interaction-overlay packing into shared UI source behind an injected node-presentation resolver | High | Done |
| 8.132 | Bind the renderer-neutral scene and complete palette into one shared concrete backend type, then remove every laboratory import from the three renderer implementations | High | Done |
| 8.133 | Move Raw WebGPU, Three.js WebGPU, and WebGL2 into shared UI source behind one lazy renderer factory consumed by the detached laboratory | High | Done |
| 8.134 | Move the versioned identity-free diagnostic schema, bounded text normalization, structural source receipt, and frame-statistics helper into shared UI source | High | Done |
| 8.135 | Move bounded graph descriptions, selection and focus announcements, compatibility recovery, and terminal renderer failure copy into shared UI source | High | Done |
| 8.136 | Delete the laboratory backend alias layer and type the detached shell directly against shared renderer, interaction, field-style, and detail contracts | High | Done |
| 8.137 | Move inset-aware fitted scale, derived camera-frame state, framed transform, compact initial framing, and view-detail thresholds into shared UI source | High | Done |
| 8.138 | Add one shared renderer host that replays complete scene presentation and interaction state before preferred-backend activation or compatibility recovery becomes visible | High | Done |
| 8.139 | Strengthen outward ceiling compression while making every first inward wheel, Safari, touch, and keyboard ratio bypass resistance at native speed | High | Done |
| 8.140 | Move the exact twenty-one-buffer renderer-scene transfer, receipt, and constant-time malformed-envelope admission contract into shared UI source | High | Done |
| 8.141 | Add focal-point-preserving logarithmic inertia for Mac control-wheel and Safari trackpad pinch zoom with outer-ceiling, cancellation, reduced-motion, and settle guarantees | High | Done |
| 8.142 | Fade retained identity detail icons by elapsed time and camera scale without atlas rebuilds during zoom | High | Done |
| 8.143 | Scale decorative background stars with camera zoom through one bounded GPU-side curve without changing semantic stars or resident buffers | High | Done |
| 8.144 | Replace the misleading animation loop with shared shader-only ambient scintillation, depth drift, nebula flow, reduced-motion behavior, and diagnostic state | High | Done |
| 8.145 | Share deterministic background generation, renderer-scene assembly, and rich-metadata compaction between the laboratory and product worker boundary | High | Done |
| 8.146 | Compile real product atlas models into the resident renderer scene with provider aggregates excluded, selected metadata retained, and structural counts derived in the worker boundary | High | Done |
| 8.147 | Replace laboratory-only theme names with one shared Scriptorium, Neon, Midas, and Ember renderer palette map selected directly by Freed theme id | High | Done |
| 8.148 | Add a bounded settled-presentation atlas lane that refreshes viewport labels and selected metadata without replacing resident semantic stars or camera state | High | Done |

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
- [x] Substack and Medium follower, following, and visible subscription accounts
      enter the identity graph, preserve existing person links and graph
      placement, and create provisional connections only for likely human
      profiles. Identity repair reruns when account details improve without a
      count change. Author accounts are created in the same Automerge change
      when authenticated capture resolves an existing RSS item. Publication-only
      Substack and Medium accounts never become people or friends automatically
- [x] Empty provisional identities are removed automatically when their last linked channel moves away
- [x] The Friends graph uses a Three.js starfield renderer with worker-computed atlas slices instead of the old main-thread canvas stack
- [x] Semantic zoom reveals more labels as the operator zooms in, without crushing the viewport
- [x] Provider island labels stay prominent at low zoom while person labels wait for closer inspection
- [x] Pan and zoom update only the graph transform during active movement instead of rebuilding the full scene every frame
- [x] Optional ambient motion uses scalar shader uniforms for stellar scintillation and depth-sensitive dust drift across Raw WebGPU, Three.js WebGPU, and WebGL2. Raw WebGPU and WebGL2 also animate provider fields, while camera movement and reduced-motion mode freeze every cosmetic branch
- [x] The laboratory and future product atlas worker share one deterministic renderer-scene assembler, background generator, metadata compactor, sparse interaction index, and direct-upload star stream contract
- [x] One shared product-scene compiler derives people, channel, and linked-channel counts from the real atlas model, excludes provider aggregates from semantic GPU residency, and preserves selected identity metadata inside the bounded worker envelope
- [x] The detached renderers and future product shell select the same Scriptorium, Neon, Midas, and Ember renderer palettes directly from the active Freed theme id
- [x] Settled viewport metadata is capped, structurally admitted against stable resident node ids, and replayed across backend recovery without replacing semantic or interaction buffers
- [x] Scriptorium graph colors stay legible instead of washing node fills and labels into the stage
- [x] Graph model construction uses single-pass activity indexing instead of rescanning every captured item per node
- [x] Worker layout uses local bucketed overlap resolution instead of naïve all-pairs nudging
- [x] Active pan and zoom keep the accepted billboard label set resident while deferring label collision refresh until settle
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
- [x] The current renderer consumes a versioned typed scene with stable 3D positions, semantic prominence, theme roles, interaction flags, and indexed edges
- [x] The graph worker transfers typed scene buffers directly, and main-thread interaction updates preserve static position and edge arrays
- [x] The React Friends shell delegates palette, renderer, fallback, GPU resource, resize, scene sync, and disposal ownership to an imperative engine
- [x] The worker caches the full semantic model by source revision, and viewport updates retain every semantic star while capping labels, hit detail, and edges
- [x] The next-generation Friends Galaxy keeps all semantic stars GPU-resident and applies detail limits only to labels, avatars, edges, picking, and expensive effects
- [x] Activity-only updates encode deterministic size and brightness scales and rewrite only the affected raw WebGPU semantic instances while preserving theme and interaction overlays
- [x] The detached laboratory consumes one shared source-key activity index and sparse typed patch encoder whose retained state follows source count and whose updates exclude positions and feed-item payloads
- [x] The detached laboratory and future product shell share one generation-safe backend runtime that keeps the old canvas visible until replacement commit, recovers once, and terminates compatibility failure without a render loop
- [x] Raw WebGPU, Three.js WebGPU, and WebGL2 implement one shared generic renderer contract with no duplicate transform or render-density policy in the laboratory
- [x] Raw WebGPU, Three.js WebGPU, and WebGL2 implement one shared concrete renderer type and import no laboratory module
- [x] The detached laboratory owns no renderer implementation and instantiates all three shared backends through one lazy shared factory
- [x] The detached shell consumes shared backend, renderer ID, interaction, field-style, and detail types directly with no laboratory alias layer
- [x] Every detached backend, billboard compositor, and avatar selector consumes one shared renderer scene envelope without depending on synthetic fixture diagnostics
- [x] The detached worker and future product worker share one exact twenty-one-buffer scene transfer list, structural receipt, and constant-time admission validator before renderer initialization
- [x] Every detached backend consumes one shared complete renderer palette, and semantic star colors resolve from typed scene data without a laboratory helper
- [x] Raw WebGPU and Three.js WebGPU share one renderer-neutral presentation pipeline for bounded visible labels, avatars, selected-parent retention, atlas construction, and interaction-overlay packing
- [x] Settled close-detail avatar decoding is concurrency-limited, revision-cached, compact-capped, stale-safe, and paired with deterministic bitmap cleanup
- [x] Close-detail avatar admission is keyed by renderer, viewport class, and selected person so unchanged settles do not rescan candidates or rebuild the atlas
- [x] Raw and Three.js WebGPU device loss recovers once into WebGL2 without discarding the active theme, camera transform, semantic scene, or interaction state
- [x] Detached startup compiles the complete stress scene and interaction index in a worker, transfers twenty-one numeric buffers, caps rich metadata, and never rebuilds the graph on the main thread
- [x] Detached startup rejects malformed scene versions, typed-buffer lengths, sparse-offset terminals, bounds, metadata counts, and receipts before renderer admission without scanning resident payloads on the main thread
- [x] Detached worker startup represents 250,000 activity items through 25,000 compact summaries while keeping item payloads absent and transfer shape independent of represented item volume
- [x] Raw WebGPU uploads worker-packed resident star streams once and resolves theme changes through a fixed palette uniform without full-star CPU traversal or GPU reupload
- [x] A locked perspective camera produces bounded prominence parallax while preserving intuitive plane navigation
- [x] Outward zoom approaches a fitted viewport target asymptotically while retaining a deeper far-plane reserve, and wheel, Safari, touch, and keyboard input restore native inward speed on the first reverse event
- [x] Inward zoom preserves near-camera clearance, and programmatic focus centers the target's actual prominence depth inside the bounded usable viewport without resident-star uploads
- [x] Semantic stars and settled relationship spokes render through two instanced WebGL2 passes with no per-node or per-edge scene objects
- [x] Projected picking uses a worker-built transferable sparse world grid, preserves exact depth and prominence selection, tolerates distant pinned outliers, and projects only the locked-camera corridor candidates
- [x] WebGPU rendering caps settled Retina density and lowers compact or wide motion density once per gesture without removing resident stars or labels
- [x] Decorative background stars scale smoothly with camera zoom across Raw WebGPU, Three.js WebGPU, and WebGL2 without changing semantic star sizes or uploading resident buffers
- [x] Compact initial framing opens on a legible semantic field while Fit galaxy remains the explicit complete-universe command
- [x] Gesture diagnostics use fixed typed rings and defer panel DOM updates until camera settle
- [x] One-click detached diagnostics and the future installed heartbeat share one versioned bounded schema without identity, URL, avatar, sample-item, or feed payload data, and clipboard rejection remains contained
- [x] Long-task diagnostics use passive observer callbacks when supported, report nullable unsupported state otherwise, and disconnect with the renderer without installing a polling loop
- [x] The detached graph exposes one focusable described region and one polite live region, keeps every canvas and semantic star out of the accessibility tree, and announces focus, selection, clear, reduced motion, clipboard feedback, and recovery without writing during hover or camera motion
- [x] The detached laboratory and future product shell share the same bounded graph description, focus and selection announcements, recovery copy, and terminal renderer failure copy
- [x] Full-canvas rendering and bounded interaction use separate rectangles, one retained geometry snapshot, exact client-to-canvas input translation, usable-lane fit and focus centering, responsive center reanchoring, and compact zero-inset collapse
- [x] The detached engine emits stable context-action and details requests for pointer, keyboard, and long press, while movement, release, cancellation, or a second touch cancels pending long press and scene positions never mutate
- [x] Mobile Details suspends graph presentation without disposing the canvas or GPU scene, performs no hidden frame, settle, label-atlas, or avatar-atlas work, and resumes the same camera, selection, backend, and resident semantic stars
- [x] The detached laboratory and future product shell share one full-canvas geometry contract and one imperative overlay-action contract instead of maintaining translated copies
- [x] The detached laboratory and future product engine share the same fixed pointer roster, bounded inertia, scalar settle scheduler, and presentation-aware demand-frame predicate
- [x] The detached laboratory, raw WebGPU backend, and future product engine share one clip-safe camera, depth-correct focus, directional zoom, wheel, and midpoint-preserving pinch implementation
- [x] The detached laboratory and future product engine share one inset-aware camera-frame state, framed transform, compact initial framing rule, and overview, middle, and close detail thresholds
- [x] The detached laboratory and future product engine share one renderer host that restores theme, dimensions, density, motion, provider fields, interaction, settled view, and activity patches before a backend becomes visible
- [x] The detached laboratory and future product engine share one fixed diagnostic sample ring, passive long-task monitor, and first-failure backend health latch
- [x] The detached laboratory and future product engine share one keyed avatar admission state and bounded source-deduplicating image decode queue with deterministic disposal
- [x] Every detached backend and the future product engine share one worker-transferable stable-ID, adjacency, sparse-pick index and one allocation-bounded interaction scene state
- [x] Labels, avatars, overlays, and the future product engine share one allocation-free depth-aware world-to-screen projection and viewport-admission helper
- [x] The detached backends and future product engine share theme-aware label and avatar billboard compositors while product metadata retains settled-candidate ownership
- [x] The detached worker, raw backend, and future product engine share one direct-upload star instance layout, semantic palette-role encoding, settled geometry, motion geometry, and decorative motion cap
- [x] The fitted zoom ceiling uses a decisive 0.15-power outward approach before the padded overview target, every inward reversal immediately uses the ordinary multiplicative ratio, and native touch retains its exact distance ratio
- [x] Raw WebGPU, Three.js WebGPU, WebGL2, provider fields, and the future product engine share one structural theme palette and normalized color parser, while Raw WebGPU resolves the fixed role block without resident-star rewrites
- [x] Provider-field geometry compiles once from bounded person positions and atlas regions, while theme and style changes rewrite only the fixed presentation instances
- [x] Mac two-finger trackpad deltas pan with native momentum, trackpad pinch coasts around its final focal point in logarithmic scale space, and pointer or one-finger touch throws use bounded allocation-free inertia that cancels for new input and reduced motion
- [x] Animation-disabled scenes stop requesting frames when idle and wake only for renderer work, settle state, diagnostics, or backend health recovery
- [x] Pointer, wheel, and Safari handlers mark motion density without synchronously resizing the GPU canvas
- [x] Active pointer and Safari gesture movement reuses captured bounds and scalar state without per-event point allocation
- [x] Pinch and wheel movement update one scalar settle deadline without allocating or canceling per-event browser timers
- [x] Hover and selection reuse fixed interaction payloads and renderer scratch storage without rebuilding maps, sets, typed views, or edge geometry
- [x] Raw WebGPU keeps semantic stars and labels resident while camera motion uses one coherent coarse field sample and settle restores the complete nebula shader
- [x] Moving Raw WebGPU stars use squared-radius multiply-only falloff while settled stars retain their complete luminous profile
- [x] Moving Raw WebGPU stars use retained octagon strips to reduce raster coverage without shrinking axis diameter or changing resident-star count
- [x] Moving Raw WebGPU frames draw a spatially representative decorative prefix while keeping every semantic star, label, avatar, edge, and resident buffer
- [x] Raw WebGPU culls provider field primitives after their close-detail fade instead of shading invisible full-field fragments
- [x] Raw WebGPU expresses hover and selection through one bounded overlay upload without rewriting scattered resident semantic instances
- [x] Raw WebGPU executes world, contextual edge, avatar, and label presentation through one retained render-bundle list per frame
- [x] Raw WebGPU and Three.js WebGPU keep a bounded identity icon atlas resident and animate its scale-derived opacity without rebuilding presentation during zoom
- [x] Hover, pointer, wheel, and Safari input share one cached viewport origin, with geometry reads bounded to interaction boundaries and resize
- [x] Active pan and pinch mutate one fixed typed pointer roster without per-move Map iterators or point objects
- [x] Linked accounts occupy complete local orbits, and dense people fields reserve enough space for those systems
- [x] Galaxy compilation indexes accounts by person once instead of scanning the full account library for every identity
- [x] Mobile pinch hands directly to one-finger pan when either touch lifts
- [x] iPhone pan and pinch use native non-passive touch events instead of WebKit pointer capture, preserve the pinch midpoint, recover after touch cancellation, and leave browser zoom unchanged
- [x] Billboard labels render through one instanced glyph-atlas draw, avoid screen-space collisions after settle, remain visible during motion, and use active theme colors
- [x] Mac Safari trackpad pinch uses native gesture events, preserves its focal point, leaves browser page zoom unchanged, and does not synchronize the graph scene during movement
- [x] Provider sectors use deterministic spiral placement and theme-aware nebula fields, with Nebula as the default treatment and no idle identity-to-account links
- [x] Identity labels remain close to their parent stars with a stronger outline, and shared utility button surfaces stay legible across active themes
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
