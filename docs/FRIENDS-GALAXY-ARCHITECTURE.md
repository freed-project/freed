# Friends Galaxy Architecture

Status: Approved for implementation on July 12, 2026.

## Historical Summary

PR 746 replaced the retained Pixi full-scene Friends graph with a summary-backed atlas worker and a theme-aware Three.js starfield. It added Troika billboard labels, capped visible nodes, context-menu linking and pinning, provider nebula and ring variants, prominence depth, touch gestures, diagnostics, and a canvas fallback.

This implementation is a useful prototype, but it is not the final FriendsGraph architecture. The approved direction below supersedes the visual and rendering assumptions in the original implementation while preserving its product workflows and lessons.

## Prototype Findings At Kickoff

- The current layout is fundamentally two-dimensional. Depth is added after the atlas layout, so the scene is layered 2D rather than a true 3D spatial model.
- Zoom and pan scale a scene group instead of moving a camera over a galactic plane.
- Interactive quality gains frames by removing labels, regions, edges, background stars, and most semantic nodes. This makes movement less informative and visually unstable.
- The worker sends rich JavaScript objects and viewport slices instead of a compact renderer-neutral typed scene.
- Region meshes and Troika label objects are destroyed and recreated during synchronization.
- Hit testing ignores projected depth and rebuilds transient lookup structures.
- Whole-library derivation remains too expensive, including repeated account filtering per person and mount-time summary work.
- The same DOM element was used for visual background bleed and pointer interaction. PR 887 had to retract under-sidebar bleed to restore empty-space clicks and control alignment.
- More than twenty graph-specific performance and stability patches before and after PR 746 demonstrate architectural saturation rather than one missing optimization.

## Approved Product Vision

FriendsGraph will become a navigable personal galaxy. It must remain understandable at every zoom level, respond directly to touch, preserve stable geography across sessions, and render a large library without hiding the galaxy whenever the user moves.

The graph occupies a constrained galactic plane. `x` and `y` encode stable semantic geography. `z` encodes importance and prominence, placing important people visually closer to the camera. Depth is deliberate and bounded rather than random.

## Approved Spatial Model

| Signal | Spatial or visual encoding |
|---|---|
| `x/y` | Stable semantic geography on the galactic plane |
| `z` | Prominence, with important people closer to the camera |
| Star size | Relationship tier and identity significance |
| Brightness | Recent activity and current relevance |
| Pulse or corona | Reach-out due state, selection, or new activity |
| Color | Active theme plus consistent semantic and provider roles |
| Local orbit | Accounts and feeds associated with one identity |

- Fam and the most important confirmed friends occupy the core.
- Confirmed friends form the inner disk, arranged by care, activity, and relationship neighborhoods.
- Provisional connection identities occupy the middle disk.
- Each person forms a tight local solar system. Linked accounts orbit nearby with short, bright connectors.
- Unlinked accounts and feeds occupy stable provider sectors on the outer rim.
- Instagram, Facebook, LinkedIn, X, RSS, and future providers receive distinct, theme-compatible constellations.
- Overdue Fam contacts use a reconnect aurora or highlighted sector. Their permanent geography does not jump when due state changes.
- Suggested identities appear as uncertain candidate stars and never auto-promote or auto-link.
- Placement is deterministic. Incremental data changes must not rearrange the galaxy.

## Approved Visual Contract

- Every active Freed theme controls the whole scene. The starfield is not dark-mode-only.
- Stars are large, legible, and meaningful at the initial fitted view.
- The first view exposes important people, major provider geography, and useful labels.
- Labels are billboard text rendered in a batched GPU SDF or MSDF layer, not an HTML cloud or one scene object per label.
- Avatars appear at close zoom for selected or high-priority identities and load after motion settles through a texture atlas.
- Links remain short and visible. Global hairball edges are forbidden.
- Nebula is the default provider-field treatment. Constellation streams and a combined treatment remain switchable in a development comparison control.
- Depth creates restrained, perceptible parallax without sacrificing navigation clarity.
- The visual render layer fills beneath the primary app sidebar, while the pointer interaction lane and controls remain bounded between sidebars.
- Reduced-motion settings disable pulses and settle animation without removing information.

## Approved Interaction Contract

- V1 uses a perspective camera with locked rotation and no camera roll.
- One finger pans. Two fingers pan and pinch around their midpoint. Wheel and trackpad use the same camera model.
- Pinch uses ray-to-plane math so the world point beneath the midpoint remains fixed.
- Tap selects. Double tap focuses. Empty-space tap clears the collapsed detail card.
- Long press or right click opens the node context menu.
- Pinning happens only from the node context menu.
- Account linking opens a searchable person picker from the context menu.
- Promotion to Followed, Friends, or Fam remains explicit.
- Drag never links or pins. Normal drag is navigation.
- Fit All, search focus, reader author links, and Map links focus the same canonical identity.
- Desktop retains the resizable and collapsible detail rail. Mobile retains the separate Details lens.

## Approved Data and Workflow Contract

- Preserve canonical `Person` plus attached `Account` records.
- Preserve Friends and All Content modes.
- Preserve provisional identities, provider sectors, RSS, suggestions, persistent pins, relationship tiers, reach-out history, and selected cross-platform timelines.
- Suggestions remain local, ranked, explainable, dismissible, and confirmation-only.
- Full item arrays load only for the selected identity. The graph consumes incrementally maintained activity summaries.
- Reader, search, Friends, and Map continue to share identity navigation.
- Rendering remains local and adds no provider navigation, requests, scraping, or provider-visible behavior.

## Approved Rendering Direction

- Build an imperative `GraphEngine` with no React scene graph and no per-frame React state.
- Use a renderer-neutral typed scene protocol so the same graph compiler can feed multiple GPU backends.
- Run an engineering bakeoff between raw WebGPU/WGSL and Three.js `WebGPURenderer` with TSL and instanced buffers.
- Use WebGPU as the preferred shared renderer and WebGL2 as the compatibility backend.
- Do not use React Three Fiber or Drei for the core scene. Drei Text wraps Troika and does not solve large batched label rendering.
- Keep native Metal as a benchmark-gated backend option. Add it only if the shared WebGPU implementation cannot meet installed-device budgets.
- Keep every semantic star GPU-resident. LOD applies to labels, avatars, edge detail, picking, and expensive effects, not to the existence of the galaxy during motion.

## Approved Performance Contract

- Keep at least 30,000 semantic graph stars GPU-resident, matching 5,000 people plus 25,000 accounts.
- Support at least 100,000 decorative background stars in one instanced pass.
- First visual frame under 400 ms on Freed Desktop and 800 ms on a conservative supported iPhone.
- First interactive frame under 700 ms on Freed Desktop and 1,200 ms on iPhone.
- Gesture p95 under 16.7 ms on Freed Desktop and 24 ms on iPhone.
- Main-thread gesture work under 3 ms with no React state writes.
- No tasks over 50 ms during pan or pinch.
- Target fewer than 12 steady-state GPU draw calls.
- A 10x increase in feed items must not materially change entry time because graph cost follows summary size.
- Validate installed Freed Desktop and real iPhone Safari, not only headless Chromium.

## Approved Engineering Roadmap

1. Capture the current installed behavior, screenshots, GPU limits, and diagnostic baseline when the machine is available for trustworthy measurement.
2. Build a standalone renderer laboratory with 30,000 semantic nodes and 100,000 background stars. Compare raw WebGPU, Three WebGPU, WebGL2 fallback, and a small Metal proof only if warranted.
3. Replace mount-time item scans with an incrementally maintained graph index and transferable typed arrays.
4. Build the deterministic hierarchical galaxy compiler with semantic zones, local identity systems, bounded prominence depth, stable coordinates, and incremental patches.
5. Build the GPU engine with instanced stars, procedural coronae, short links, provider fields, batched billboard text, texture-atlas avatars, and depth-aware picking.
6. Build the locked camera and native touch plus pointer gesture state machine with transform-only movement.
7. Restore every workflow: selection, details, context menus, linking, pinning, promotion, suggestions, reconnect state, reader links, and Map links.
8. Add the development visual laboratory for nebula, rings, combined fields, plane thickness, prominence curves, and label density.
9. Prove stress behavior, mobile interaction, accessibility, reduced motion, theme coverage, installed diagnostics, and memory budgets.
10. Cut over only after the new engine beats the current graph on usefulness and measured performance, then remove the old renderer.

## Approved Decisions

- Galactic plane with a locked perspective camera.
- Prominence depth dominated by relationship and care, with bounded activity and reconnect boosts.
- Stable provider sectors around the outer rim.
- Reconnect as a transient aurora or filter rather than permanent spatial relocation.
- WebGPU-first shared engine, WebGL2 fallback, Metal behind a benchmark gate.
- All semantic stars remain GPU-resident during movement.
- Full-width visual render layer plus a separate bounded interaction lane.

## Benchmarking Note

As of July 12, 2026, other tasks are running on the development machine. The owner has authorized benchmarking only when a case is repeated enough to establish a consistency range. Single-run timing results are not decision evidence. Correctness checks, builds, deterministic unit tests, and visual architecture work may continue independently.

## Implementation Progress

### Foundation complete

- The current atlas compiles into a versioned renderer-neutral scene protocol backed by typed arrays.
- Semantic depth is care-dominant, with bounded activity and recency contributions.
- Linked accounts remain behind their identity while preserving stable deterministic positions.
- The atlas worker transfers scene buffers instead of making the main thread compile duplicate GPU input.
- Hover and selection update flags, emphasis, and point sizes in place without replacing static positions or indexed edges.
- An imperative `IdentityGalaxyEngine` owns Three.js, the batched glyph label layer, palette resolution, WebGL fallback selection, resize, synchronization, rendering, and disposal.
- `FriendGraph.tsx` now owns React props, worker lifecycle, interaction orchestration, and product callbacks rather than renderer internals.
- Semantic model construction and viewport atlas slicing are separate operations.
- The worker caches the full rich semantic model by source revision.
- The first response for a source revision transfers every semantic star. Later viewport responses retain those node buffers and transfer only capped atlas metadata plus edge indices.
- Resident semantic stars are now distinct from visible interaction detail in diagnostics and regression coverage.

### First native galaxy pass complete

- The graph now uses a locked perspective camera over the galactic plane. Pan and zoom move the camera while preserving the established plane transform and bounded prominence depth.
- Every semantic star is rendered through one instanced WebGL2 quad mesh with procedural cores, coronae, rays, and selection rings. No retained scene object exists per star.
- Settled relationship spokes use one instanced edge mesh with screen-stable width. Gesture quality keeps its stricter edge and interaction caps without evicting semantic stars.
- Projected picking uses the active camera, depth-scaled hit radii, and capped worker candidates.
- Confirmed friends use a deterministic golden-angle disk sized by local system footprint. Sparse linked accounts occupy complete local orbits instead of partial arcs.
- Model compilation builds one account-to-person index and never rescans the full account library for each person.
- The initial camera opens at the first useful semantic tier on Freed Desktop and at a closer exploration tier on iPhone. `Fit all` still reveals the complete provider universe.
- Billboard labels use one instanced glyph draw backed by a theme-font canvas atlas. Screen-space collision runs after settle, and camera movement keeps the accepted label set resident.
- iPhone pan and pinch use native non-passive touch events rather than WebKit pointer capture. Pinch preserves its active midpoint, hands directly to one-finger pan when either touch lifts, recovers after touch cancellation, and leaves browser zoom unchanged. Mouse and pen input remain on Pointer Events.
- Mac Safari trackpad pinch uses native `gesturestart`, `gesturechange`, and `gestureend` events. Gesture scale is mapped into the same midpoint-preserving camera transform used by touch and wheel input.
- Active pan and pinch issue camera renders only. They do not request an interactive atlas, synchronize scene buffers, rebuild edges, reload labels, or write React state on movement.
- The animation frame ID is the sole draw scheduler latch. Effect cleanup cancels and clears that ID so React development verification cannot leave gesture rendering permanently blocked.
- The canvas compatibility renderer caches its decorative star background, avoids per-node blur filters, keeps connectors visible, and draws a capped screen-space label set during motion.
- Mobile regression coverage now includes browser-generated two-finger input in the PWA, pinch-to-pan continuation, and the same touch state path under WebKit's iPhone profile. Linking and pinning remain context-menu-only workflows.
- Neon and Scriptorium visual passes confirm that node cores, background stars, labels, edges, and provider fields follow the active theme.
- Provider sectors now use deterministic logarithmic spiral placement shared by the atlas and renderer. Procedural nebula arms, themed dust, and constellation streams replace simple elliptical region outlines.
- Linked accounts occupy tighter local identity systems, with their person as the stable center and short semantic links available only while that constellation is hovered or selected.
- Billboard labels anchor directly to their parent stars, use a stronger outline, and retain the accepted label set during camera movement.
- Graph utility controls use the shared Freed secondary button surface so their backgrounds remain legible in every active theme.

## Finalization Audit

The July 17, 2026 audit used current `origin/dev` at `b41470d8ec0b5e529d5be7629dbb4feaf2b84884`. The isolated baseline passed all 23 focused galaxy camera, scene, worker protocol, atlas, and activity-summary tests. The first native galaxy pass is functional, but the following gaps remain before production acceptance:

| Area | Current implementation | Production requirement |
|---|---|---|
| GPU backend | One imperative Three.js WebGL2 backend plus canvas fallback | Complete the raw WebGPU versus Three WebGPU laboratory, select the shared WebGPU path, and retain WebGL2 compatibility |
| Semantic stars | The complete typed semantic scene remains GPU-resident | Prove at least 30,000 resident semantic stars without interaction-time eviction |
| Background stars | The WebGL2 pass creates 3,000 to 12,000 decorative points | Sustain at least 100,000 decorative stars in one GPU pass |
| Interaction updates | Hover and selection walk every resident node, rebuild color and highlight arrays, and replace GPU attributes | Patch only changed dynamic indices and keep static buffers permanently bound |
| Provider fields | Region meshes are recreated on scene synchronization | Cache provider geometry and patch only palette or variation changes |
| Labels | One instanced glyph-atlas pass keeps accepted labels resident during movement | Preserve the batched pass across backend changes and prove stable close anchoring at every supported density |
| Avatars | Atlas metadata carries avatar candidates, but renderer diagnostics report zero displayed avatars | Add a settled close-zoom texture atlas for selected and high-priority identities |
| Graph index | `FriendsView` still materializes a feed-item record and derives several whole-library indexes on mount | Maintain activity and identity graph summaries incrementally so entry cost follows summary size rather than item count |
| Source revisions | Canvas dimensions participate in the semantic source revision | Separate layout-source identity from viewport dimensions so resize does not rebuild the complete semantic model |
| Stress proof | The maintained desktop performance fixture uses 1,600 people, 1,920 accounts, and 6,400 items | Add 5,000 people, 25,000 accounts, and a 250,000-item summary-equivalent fixture |
| Device proof | Browser regressions cover camera and touch behavior | Record repeated consistency ranges on installed Freed Desktop and physical iPhone Safari before backend cutover |

### Finalization Slices

1. Make diagnostics backend-neutral. Record draw calls, buffer uploads, resident semantic and decorative counts, sparse interaction writes, label and avatar atlas activity, GPU capability, and fallback reason.
2. Split semantic source revision from viewport revision, then add incremental summary and graph-index patches without changing product workflows.
3. Replace full-scene hover and selection restyling with sparse dynamic-buffer writes. Cache provider resources across ordinary atlas responses.
4. Build the standalone 30,000-semantic-star plus 100,000-background-star renderer laboratory. Compare raw WebGPU, Three WebGPU, and the existing WebGL2 backend under identical typed-scene input.
5. Integrate the selected WebGPU backend behind the imperative engine contract. Keep WebGL2 and canvas fallbacks deterministic and feature-compatible.
6. Add the close-zoom avatar texture atlas and complete theme, reduced-motion, accessibility, and development-variation coverage.
7. Replace the legacy stress fixture with realistic summary-scale data and run repeated installed desktop and physical iPhone consistency baselines.
8. Cut over only after the user accepts the visual result and the selected backend meets the production budgets. Remove superseded code, merge through `dev`, and verify the exact production release.

### Next structural target

When global behavioral custody is released, integrate the selected raw WebGPU backend behind the imperative engine contract and move the proven incremental activity index into the shared document-worker path. Connect the proven bounded avatar admission queue to approved product avatar candidates and the shared settled-detail lifecycle. The current WebGL2 engine and batched glyph layer remain the compatibility backend and functional integration surface until the new runtime passes repeated device performance baselines and complete workflow acceptance.

Benchmarking is authorized only as repeated consistency runs while other machine tasks remain active. Single-run timing results are not decision evidence.

## Renderer Laboratory Checkpoint

The July 17, 2026 runtime-neutral renderer laboratory lives under `packages/ui/labs/friends-galaxy`. It is intentionally detached from PWA and Freed Desktop entry points while the global behavioral product slot remains occupied by stability work.

The laboratory builds one deterministic renderer-neutral fixture and feeds the identical typed positions, sizes, prominence depth, provider assignments, and theme roles to three backends:

| Backend | Semantic field | Decorative field | Submission shape |
|---|---:|---:|---|
| Current production Three.js WebGL2 | 30,000 stars | Existing viewport cap of 7,000 or 12,000 stars | Production engine, draw-call count not yet exposed |
| Three.js WebGPU | 30,000 stars | 100,000 stars | Four overview draws, five while contextual links are active |
| Raw WebGPU and WGSL | 30,000 stars | 100,000 stars | Four overview draws, five while contextual links are active |

The fixture represents 5,000 identities and 25,000 attached or unlinked channels. Identity systems occupy a deterministic six-arm galactic plane. Linked channels remain in short local orbits. Unlinked channels occupy five provider spiral sectors. Each provider uses its stable seed and three-to-five-arm geometry, with bounded angular, radial, and lane-width scatter so the sectors remain organized without looking stamped from one template. Prominence remains bounded on the z axis so camera pan creates restrained parallax without random spatial scattering.

The laboratory includes Scriptorium, Neon, Midas, and Vesper palettes. Light themes reduce background opacity and avoid additive bleaching. Dark themes retain brighter coronae. The raw WebGPU path preserves the Scriptorium palette more faithfully than the Three.js WebGPU path. The control panel uses an opaque theme surface because blurred translucent overlays produced WebGPU compositor artifacts in browser verification.

The raw WebGPU path adds one procedural field batch containing exactly six instances: one identity-core field and one field for each provider sector. The WGSL fragment path uses domain-warped noise and an irregular soft envelope rather than a flat ellipse. Nebula, Star streams, and Cosmic blend remain available through the development control, with Nebula selected by default. Star streams use broken filaments that fade near the core, and every field fades as the camera approaches so close-detail stars, labels, and avatars stay legible. Theme or variation changes rewrite only the six-instance field buffer. Camera movement changes the shared view transform and never rebuilds field geometry.

The raw backend pre-records the procedural fields, 100,000 decorative stars, and 30,000 semantic stars in one static WebGPU render bundle. Each camera frame writes the shared transform uniform, points one reused render-pass attachment at the current canvas texture, executes the bundle, draws only the current contextual overlays, and submits through a reused command-buffer container. This removes repeated world pipeline, bind-group, vertex-buffer, and draw setup from the JavaScript gesture path without freezing buffer contents. Theme, field-style, sparse activity, and sparse interaction writes remain visible through the pre-recorded commands. One activity update rewrites only the affected 32-byte semantic instance, then reapplies its current selection or hover role. Later palette changes rebuild that instance from its retained activity scales before restoring interaction overlays. A live empty-space pan and same-tier zoom left the buffer-upload counter unchanged, while channel selection, its contextual edge, and a Neon-to-Scriptorium palette change remained visible through the same bundle.

Raw WebGPU diagnostics include an exact tracked payload count for resident vertex, uniform, edge, label-atlas, avatar-atlas, and procedural-field data. The count deliberately excludes opaque driver, pipeline, bind-group, swap-chain, and command-buffer overhead, so it remains deterministic and does not pretend to be process memory. The laboratory formats it as locale-aware bytes, KiB, or MiB.

Interaction uses the production locked-camera transform. Pointer pan, wheel zoom, Safari gesture events, and two-pointer pinch all update the transform directly. The pointer-move path uses scalar coordinates and mutates the two resident pointer records, with no per-move arrays or midpoint objects. Pure gesture tests confirm the exact touch-distance scale ratio, moving-midpoint preservation, scale clamping, and centered zoom anchoring. A 390 by 844 browser probe confirmed that a synthetic two-touch expansion changed camera scale by the exact touch-distance ratio while preserving the world point beneath the midpoint.

The focused canvas also supports arrow-key pan, centered plus and minus zoom, Home or zero to fit, and Escape to clear selection. The viewport exposes those shortcuts through accessibility metadata and uses the active theme selection color for its focus ring. A live keyboard probe moved and zoomed the camera without world-buffer uploads, restored fit, selected a channel, and cleared that channel plus its contextual edge. Twinkle animation defaults off when the device requests reduced motion, but the explicit laboratory toggle remains available.

Both WebGPU candidates now use one whole-label canvas atlas and one GPU billboard batch. Labels remain visible throughout active camera movement. The accepted label set changes only after the camera settles and crosses an overview, middle, or close detail boundary. Deterministic screen-density rules retain provider labels, spread identity labels across the viewport, and cap mobile detail more tightly than desktop detail.

Both WebGPU candidates also include one settled close-tier avatar atlas pass. Overview and middle detail carry zero avatar workload. Close detail admits at most twelve identities on desktop and six on compact screens, always retains the selected identity, and resolves a selected linked channel to its parent identity. The label atlas treats avatars as collision obstacles and always retains the selected identity name outside the normal label sample.

The detached lab now proves the decoded-image path without remote media. It encodes deterministic local PNG blobs, decodes at most three images concurrently, admits no more than the close-tier identity cap, keeps at most eighteen source revisions, caches failures by source revision, and closes every evicted or disposed bitmap. A newer gesture, resize, backend switch, or detail transition invalidates the pending application, so a stale completion cannot rebuild the atlas during movement. The raw and Three.js WebGPU backends both accept the resulting image map. Overview reports zero decoded work. Settled desktop close detail admits twelve of twelve images, compact close detail admits six of six, and theme changes preserve the decoded atlas. Product integration must supply approved product avatar candidates through this same bounded contract.

Selection and hover use a compact adjacency index. The engine writes only the previously active and newly active star instances instead of replacing complete color and emphasis buffers. Contextual links contain only the selected or hovered identity system, so the common fixture produces four short local links rather than a global edge field. Click picking projects the resident typed scene only when requested and favors prominent parent identities over nearby channels.

Verification commands:

```bash
npm run typecheck:friends-galaxy-lab
npm run test:friends-galaxy-lab
npm run friends:galaxy-lab -- --port <free-port>
```

Append `?compact=1` to constrain the laboratory renderer to a real 390-pixel canvas. Add `&controls=hidden&animate=0` for an unobstructed static compact visual probe. These parameters change only the detached laboratory shell and activate the same compact label and avatar admission branches used by a narrow product viewport.

The isolated compiler and all thirty-nine deterministic fixture, camera-matrix, gesture-math, provider-field, adjacency, picking, label-density, avatar-image-admission, activity-index, activity-scene-patch, and local-orbit tests pass. Desktop and iPhone-sized browser checks confirm nonblank output, theme switching, backend switching, persistent gesture labels, sparse selection updates, short contextual links, selected avatar naming, distinct provider geometry, camera-scale field fading, bounded decoded-avatar admission, and warning-free WebGPU pipeline creation. During the mobile pinch probe, all eight overview labels remained present on every sampled gesture frame. The settled middle tier then admitted twenty labels. The close tier admits twelve decoded avatars on desktop and six on compact canvases, and keeps the selected name clear of the avatar rim in one additional draw. These are functional checks only. Their frame timing is not benchmark evidence while unrelated machine workloads remain active.

### Laboratory backend decision

Raw WebGPU is selected as the primary shared renderer. It handles semantic stars, decorative stars, one procedural field batch, billboard labels, contextual links, picking, and sparse interaction in four overview draws. It uses a dedicated allocation-free camera matrix instead of a Three.js runtime dependency, preserves light-theme output more faithfully, and gives exact control over buffer writes and shader behavior. The current WebGL2 engine remains the deterministic compatibility fallback for devices without usable WebGPU. Three.js WebGPU remains a maintained laboratory reference until production cutover proves that it no longer provides a required compatibility advantage.

This decision does not authorize a runtime cutover by itself. The remaining gates are production avatar candidate plumbing, product integration behind the imperative engine contract, every approved Friends workflow, repeated installed Freed Desktop consistency ranges, physical iPhone Safari validation, fallback validation, accessibility, and final owner visual acceptance. Native Metal remains unnecessary unless those repeated device results show that the shared WebGPU path cannot meet the approved budgets.

Explicit laboratory switches also admit both compatibility paths. The current WebGL2 backend keeps all 30,000 semantic stars, applies its established bounded decorative field, switches themes, and disables unsupported raw-field controls. The Three.js WebGPU reference accepts the equal 30,000 plus 100,000 workload and also disables raw-only controls. Both initialize without browser warnings. Initialization failure in either WebGPU path routes automatically to the current WebGL2 backend with the failure reason preserved in the status surface.

## Incremental Activity Index Checkpoint

The detached laboratory now includes an exact activity-summary index contract under `packages/ui/labs/friends-galaxy/activity-summary-index.ts`. It deliberately retains state proportional to social and RSS source count rather than feed-item count. Each source bucket holds only total and location counts, the latest three sample candidates, and the latest three distinct avatar candidates.

Normal additions, updates that do not replace a leading candidate, and removals outside the bounded candidates produce key-level summary patches without a library scan. If a destructive mutation removes a leading sample or avatar candidate, the index invalidates only that source. The owning document worker performs one resolver pass over its current authoritative document and rebuilds only the invalidated source buckets. No rebuild, sort, or item traversal occurs on the React thread.

The deterministic stress test represents 250,000 feed items across 25,000 source summaries. A subsequent addition changes one summary patch, reports zero rebuilt sources, and leaves item payloads out of the graph fixture. This is structural correctness evidence, not a timing benchmark.

The detached laboratory also includes an activity-to-scene patch encoder. It binds social external IDs and RSS URLs to stable semantic node indices once, then converts summary changes into sorted `Uint32Array` node indices, item counts, `Float64Array` activity timestamps, deterministic `Float32Array` size and brightness scales, one byte of location, avatar, or removal flags, and at most one avatar URL per affected node. The visual scales use an explicit reference timestamp, bounded count and recency signals, and a small location boost, so worker output is deterministic and testable. A source represented by more than one semantic node fans out deterministically. An unknown source is reported separately so the atlas worker can make a structural decision. No positions, labels, sample item IDs, or feed-item records enter this payload. A 25,000-binding test proves that one changed source produces one encoded node entry. The runnable laboratory executes the same path at startup, applies that one node directly to the raw WebGPU semantic buffer, and reports one summary key, one scene node, one GPU activity node, and zero unknown keys in its diagnostics.

### Production activity protocol

1. Move the pure contribution, summary, delta, patch, and index types into `@freed/shared` so Freed Desktop and PWA use one implementation.
2. Let each Automerge worker own the index. Initial hydration builds it while the worker already traverses the authoritative feed-item document. Full document replacement, merge, reset, and schema recovery rebuild it in the worker.
3. At incremental mutation boundaries, derive previous and next contributions from the immutable document before and after `A.change()`. Attach source-key summary patches and a monotonic summary revision to the existing item-patch response.
4. Keep one derived activity bridge outside React. It applies key patches without cloning the complete 25,000-key snapshot and exposes a revision for subscribers. `FriendsView` subscribes to that revision and compact summary snapshot, never to the complete `items` array for graph or overview entry.
5. Build friend overview rows from persons, account indexes, and summaries. Avatar candidates, captured counts, recent activity, and location flags come from summaries rather than retained item arrays.
6. Add an on-demand worker query for the selected person or account timeline. Only the detail rail receives those full items. Selection changes cancel stale requests, and closing details releases the item array.
7. Precompute the bounded friend-candidate suggestion list in the document worker from content signals and contact overlap. Friends consumes the resulting top suggestions instead of rescoring every item on mount.
8. Give the graph atlas worker one initial compact summary snapshot and later source-key patches. Its source-to-scene encoder turns activity-only changes into sorted node-index typed patches for brightness, size, location, and avatar metadata without rebuilding stable galaxy coordinates or resending the complete semantic scene. Unknown source keys request a structural atlas refresh rather than being silently dropped.

This protocol removes the remaining `FriendsView` mount scans: feed-item record materialization, graph summary construction, source-item indexing, overview item grouping, candidate rescoring, and selected-account filtering. Account-to-person indexes also move off the React render path. Existing `Person` plus `Account` records and every explicit identity workflow remain unchanged.
