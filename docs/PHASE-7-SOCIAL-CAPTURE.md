# Phase 7: Facebook + Instagram Capture

> **Status:** 🚧 In Progress: Facebook and Instagram integrated into Desktop via Tauri WebView scraping, with feed pollution filtering, stricter Instagram story viewer validation, long-text expansion before extraction, silent background media guarding, provider health summaries, smart backoff, shared memory-preflight backoff, transient memory-pressure health recovery, memory-aware scrape pass planning, cloud-sync exclusion while social scrapes are active, Facebook group controls with stored-name repair, ID-tail fallback labels, and single-group leave verification, source-level post and story filtering, preserved Instagram story location metadata for map recovery, linked-account cross-post dedup across IG and FB, Instagram media-key duplicate repair, same-platform social story duplicate repair, explicit reply links with opt-in beta inline hydration for X, Facebook, and Instagram reader posts, captured authors now feeding the Phase 8 account catalog for identity review, post-login sync startup that closes login prompts only after scrape health is confirmed, a local permanent media vault for a user's own Meta media, and a local social scrape optimization loop that ranks safe next actions and post-block memory recovery from runtime logs without adding provider-visible behavior
> **Dependencies:** Phase 5 (Desktop App)

---

## Overview

DOM scraping for Facebook and Instagram feeds using Tauri's native WebView (WKWebView on macOS). Instead of Playwright, posts are captured by injecting extraction scripts into the same WebView that handles authentication, making the traffic indistinguishable from normal browsing.

**Note:** DOM scraping is inherently fragile. These platforms actively fight scrapers and frequently change their DOM structure. This is lower priority than X + RSS.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Desktop App (Tauri)                        │
│                                                                  │
│  ┌────────────────────┐  ┌────────────────────┐                 │
│  │   FB WebView        │  │   IG WebView        │                │
│  │   (fb-scraper)      │  │   (ig-scraper)      │                │
│  │                     │  │                     │                │
│  │  Login: visible     │  │  Login: visible     │                │
│  │  Scrape: hidden,    │  │  Scrape: hidden,    │                │
│  │  injects extract.js │  │  injects extract.js │                │
│  │  emits fb-feed-data │  │  emits ig-feed-data │                │
│  └──────────┬──────────┘  └──────────┬──────────┘                │
│             │                        │                           │
│             └────────────┬───────────┘                           │
│                          ▼                                       │
│                ┌──────────────────┐                              │
│                │  Normalize to    │                              │
│                │  FeedItem[]      │                              │
│                └──────────────────┘                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

```
packages/capture-facebook/
├── src/
│   ├── index.ts          # Playwright-based entry (not used by desktop)
│   ├── browser.ts        # Browser-safe re-exports (types, normalize, selectors)
│   ├── scraper.ts        # DOM scraping logic (Playwright)
│   ├── selectors.ts      # CSS selectors (frequently updated)
│   ├── normalize.ts      # FB post -> FeedItem
│   ├── mbasic-parser.ts  # mbasic.facebook.com HTML parser
│   ├── rate-limit.ts     # Rate limiting state machine
│   └── types.ts          # FB-specific types
├── package.json
└── tsconfig.json

packages/capture-instagram/
├── src/
│   ├── index.ts          # Playwright-based entry (not used by desktop)
│   ├── browser.ts        # Browser-safe re-exports (types, normalize, selectors)
│   ├── scraper.ts        # DOM scraping logic (Playwright)
│   ├── selectors.ts      # CSS selectors
│   ├── normalize.ts      # IG post -> FeedItem
│   ├── rate-limit.ts     # Rate limiting state machine
│   └── types.ts          # IG-specific types
├── package.json
└── tsconfig.json
```

---

## Desktop Integration (Tauri WebView)

### Authentication

Both Facebook and Instagram use the same pattern:

1. `*_show_login` opens a visible WebView to the platform's login page
2. User authenticates through the real login flow (2FA, CAPTCHA, etc.)
3. `on_navigation` handler detects redirect away from login page
4. `*-auth-result` event is emitted while the WebView stays visible
5. Freed marks the source connected and starts sync using the user's selected scraper window mode
6. The login window stays open while the scrape starts so the user can finish platform prompts
7. Freed closes the login window only after the scraper emits a healthy startup event
8. If scrape startup fails, the login window remains open and the user can close it or click Sync Now
9. Cookies persist in the WebView data store for future scraping sessions

### Feed Scraping

1. `*_scrape_feed` creates/shows a WebView navigated to the platform's feed
2. Waits for page load with randomized jitter (12-16s)
3. Injects extraction script (`fb-extract.js` / `ig-extract.js`) at multiple scroll positions
4. Script reads visible posts from the DOM and emits them via Tauri event IPC
5. Native lifecycle events report scrape startup, healthy startup, and startup failure with window mode and interaction-method diagnostics
6. Frontend normalizes raw posts to `FeedItem[]` using `@freed/capture-*/browser`

### Extraction Scripts

Self-contained JavaScript injected into the WebView's execution context. No external dependencies. Each platform has its own script tuned to its DOM structure:

- **Facebook** (`fb-extract.js`): Locates "Feed posts" h3, walks subtrees for post-sized blocks
- **Instagram** (`ig-extract.js`): Queries `<article>` elements, extracts author/caption/media from semantic header/footer structure
- **Long-form text expansion:** Facebook, Instagram, and LinkedIn extractors click common "see more" controls inside candidate post roots before reading text so long captions and essays are preserved in `content.text`.
- **Facebook comments** (`fb-comments-extract.js`): Used only after the user chooses the beta inline replies action. It opens the post URL in the authenticated WebView, expands visible comment controls, and emits inline reader replies with media.
- **Instagram comments** (`ig-comments-extract.js`): Used only after the user chooses the beta inline replies action. It opens post and reel URLs in the authenticated WebView, expands visible comment controls, and emits inline reader replies with media.
- **Facebook stories** (`fb-stories-extract.js`): Injected into the FB story viewer overlay. Extracts author, media, timestamp, location/check-in. Emits via `fb-feed-data` with `postType: "story"`.
- **Instagram stories** (`ig-stories-extract.js`): Injected into the IG story viewer overlay. Extraction now requires a real story URL, dialog, or full-screen story container with controls before emitting, so feed cards cannot fall through as stories. Author detection prefers `/stories/<username>/` and rejects generic handles such as `reels`, `locations`, and `instagram`. Timestamp-like fallback story IDs are replaced with stable content hashes. The normalized `FeedItem.location` now preserves the sticker source plus Instagram `locationUrl`, so later map resolution can recover real place names from generic labels such as `Locations`.

Story scraping is interleaved with feed scraping in each session. A coin flip (~50%) determines whether stories are scraped before or after the initial feed passes. ~15% of sessions skip story scraping entirely (real users don't always check stories). Up to 30 story frames are captured per session.

Story replies are treated differently from post comments. Facebook and Instagram story replies are private inbox conversations, so the reader shows an explicit private-replies state and keeps the Open action for replying on the platform.

Background scrape and auth-check sessions now force provider media elements silent through the injected WebKit mask layer. Audio elements are paused outright, video elements are forced muted, and newly inserted media is re-silenced as the DOM changes.

Social memory preflight now has shared backoff across Facebook, Instagram, and LinkedIn. When one provider cannot start because Freed Desktop memory is high after cleanup, the next providers reuse that deferred result instead of immediately opening more WebKit work. High-memory Freed Desktop installs now get larger adaptive scrape budgets, and low-priority semantic enrichment waits through launch so Facebook and Instagram scraping does not lose the first background window to Automerge maintenance.

Startup memory attribution now primes a nonblocking native sample before document hydration and records one rooted main-renderer process identity. Later deltas require the same PID and native microsecond process start time. Renderer replacement, rapid relaunch, PID reuse, ambiguous WebKit candidates, and late samples are recorded as incomparable instead of being mislabeled as document or provider memory.

Provider health now treats memory-pressure preflight blocks as transient deferrals instead of durable provider failures. The attempts stay in local diagnostics for review, but after the recovery window they stop driving sidebar warnings or stale source-menu copy.

Facebook and Instagram feed scrapes now build a memory-aware pass plan after the WebView has loaded. When memory is healthy they keep the normal randomized session. When Freed Desktop is close to the scrape budget, they skip story collection and reduce scroll passes instead of opening a full story-plus-feed session that is likely to pause or trigger memory recovery. Each plan is written to runtime health diagnostics with the provider, pass range, story decision, margin, and memory budgets.

`npm run social:scrape-loop` reads local runtime health, diagnostics, and provider-health logs, ranks safe local-only next actions, and reports provider-visible decisions that remain blocked pending approval. The loop watches WebKit RSS peaks, renderer recovery attempts, preflights, scrape plans, blocked preflights, cooldowns, extractor failure stages, missing provider coverage, providers that preflight without recording a plan, the lowest later WebKit RSS sample after a provider block, providers that recovered under budget but never recorded a later scrape plan, the latest post-block runtime state, stale provider-health memory errors after recovery, provider-health zero-post attempts, and the provider-health pause plus latest attempt state so stale memory pauses and empty-feed failures are visible without opening provider pages.

### Permanent Media Archive

Facebook and Instagram settings now expose a local-only media archive for the user's own uploaded media. This is not the standard content cache. Files are copied under the Freed Desktop app-data folder in `media-vault/{provider}` and are kept until the user explicitly deletes the archive or removes that provider archive.

The archive writes a local manifest with provider, source URL, post ID, media URL, local path, byte size, content hash, captured time, import source, and restore-planning roster hints. Media files, manifest rows, byte counts, failure records, retry state, and provider archive preferences are intentionally excluded from Automerge and are not synced.

Historical completeness comes from Meta export import. The importer accepts Accounts Center ZIP exports, prefers JSON-backed structures, scans Facebook and Instagram media folders defensively, skips message attachments, records discovered account handles, and copies media into the permanent vault with content-hash dedupe.

Recent coverage is continuous. After Facebook or Instagram sync stores captured items, Freed records roster metadata and attempts to archive recent own-account media when the provider archive is enabled and the user's handle is known. The archive dedupes by content hash, source URL, provider media ID, and normalized media URL, records bounded retry state for failed downloads, and never prunes permanent media.

Profile backfill is user-started and visible in settings. The current implementation backfills media already captured from the user's own provider identity and marks those files with the profile-backfill import source. Direct historical own-profile DOM crawling remains selector-sensitive and should stay slower, resumable, and separately smoke-tested before we claim full coverage beyond Meta export import.

### Story Wall beta

Freed Desktop now has a Story Wall settings section for owner-controlled memory publishing. It sits under a dedicated Beta settings group with AI, and stays out of the primary app sidebar while the feature is still early. The wall starts from existing Freed history, guides the user through Instagram Accounts Center ZIP export before import, can import those exports into the local media vault, and keeps the synced wall config small in `preferences.storyWall`. Media binaries stay in the device-local vault until a publish run writes static assets to the target. The settings section uses shared theme panels, inputs, and buttons, stays gated until the user enables Story Wall, and only previews media-backed memories from real Freed history or imported archives.

On Freed Desktop, Story Wall now obtains its complete visible media candidate set through the authenticated local SQLite generation instead of retaining the full Library item corpus in the renderer. The native query caps the exact candidate set at 250 rows and falls back without truncation when the set is larger or the source changes. Existing year, provider, account, hidden-item, featured-item, preview, and manifest logic remains unchanged, and no publishing or provider behavior changes.

Facebook and Instagram media backup now source visible candidates from source-fenced 64-row SQLite pages. Freed stages only compact local candidate pages, performs no provider request until the final source check succeeds, then streams those pages through the existing user-triggered archive path. YouTube saved-video sync uses compact visible identities in deterministic SQLite order and retains the existing 25-action cap. No automatic provider work or cadence change is introduced.

The first publisher target is GitHub Pages. The desktop publisher creates or reuses a user-owned repo, writes a static site under `/docs`, includes `index.html`, `embed.js`, `data/story-wall.json`, `.nojekyll`, and vault assets, then commits through Git blobs, trees, commits, and refs. Successful destination details sync so another device can find the published wall. In-progress status and error messages remain device-local because they describe one machine's current publish attempt. The UI exposes manual publish now with privacy review copy. GitHub OAuth and automatic settle-window publishing remain follow-up work.

---

## Rate Limiting

```typescript
const RATE_LIMITS = {
  facebook: {
    minInterval: 20 * 60 * 1000,  // 20 minutes between scrapes
    maxPostsPerScrape: 50,
  },
  instagram: {
    minInterval: 20 * 60 * 1000,  // 20 minutes between scrapes
    maxPostsPerScrape: 50,
    cooldownOnError: 60 * 60 * 1000,  // 1 hour cooldown if blocked
  },
};
```

---

## Tasks

| Task | Description                                 | Status      |
| ---- | ------------------------------------------- | ----------- |
| 7.1  | `@freed/capture-facebook` package scaffold  | ✓ Complete  |
| 7.2  | `@freed/capture-instagram` package scaffold | ✓ Complete  |
| 7.3  | Facebook DOM selectors                      | ✓ Complete  |
| 7.4  | Instagram DOM selectors                     | ✓ Complete  |
| 7.5  | Facebook feed scraping (WebView)            | ✓ Complete  |
| 7.6  | Instagram feed scraping (WebView)           | ✓ Complete  |
| 7.7  | WebView-based authentication                | ✓ Complete  |
| 7.8  | Rate limiting to avoid bans                 | ✓ Complete  |
| 7.9  | Selector versioning strategy                | ✓ Complete  |
| 7.10 | Location extraction (for Phase 8)           | ✓ Complete  |
| 7.11 | Stories capture (IG + FB, with map-ready location metadata) | 🚧 In Progress |
| 7.12 | Social engagement write-back (like, seen)   | ✓ Complete  |
| 7.13 | Outbox processor for cross-device sync      | ✓ Complete  |
| 7.14 | Comment links (open on platform)            | ✓ Complete  |
| 7.15 | Cross-platform dedup (IG/FB cross-posts)    | ✓ Complete  |
| 7.16 | Permanent local media vault                 | ✓ Complete  |
| 7.17 | Meta export import for own media            | ✓ Complete  |
| 7.18 | Own-profile backfill crawler                | 🚧 In Progress |
| 7.19 | Reader reply hydration for X posts          | ✓ Complete  |
| 7.20 | Explicit reply links and opt-in beta inline hydration for reader posts | ✓ Complete |
| 7.21 | Shared social memory-preflight backoff      | ✓ Complete  |
| 7.22 | Story Wall grouped settings section and GitHub Pages publisher | 🚧 In Progress |
| 7.23 | Local social scrape optimization loop       | ✓ Complete  |
| 7.24 | Shared safety runtime for authenticated Substack and Medium beta capture | ✓ Complete |
| 7.25 | Process-matched startup memory attribution  | ✓ Complete  |

---

## Success Criteria

- [x] `@freed/capture-facebook` package with full scraper, normalizer, and rate limiting
- [x] `@freed/capture-instagram` package with full scraper, normalizer, and rate limiting
- [x] Location data extracted from Facebook check-ins and Instagram location tags
- [x] Rate limiting prevents account bans (20m minimum between scrapes)
- [x] Selector versioning strategy implemented (SELECTOR_VERSION constant)
- [x] Facebook feed integrated into Desktop via Tauri WebView scraping
- [x] Instagram feed integrated into Desktop via Tauri WebView scraping
- [x] Both platforms integrated into Desktop refreshAllFeeds()
- [x] Settings UI for both platforms (login, check connection, sync, disconnect), with the same provider section also reused inside Debug panel health cards
- [x] Facebook and Instagram login windows stay open after auth so users can finish platform prompts while sync starts, then close only after scrape startup health is confirmed
- [x] Feed pollution filtering blocks promoted X entries and suggested FB/IG posts
- [x] Facebook Settings includes per-group include/exclude controls for joined groups inside a filtered inner scroller that prevents late group loads from shifting the outer Settings view, ID-tail fallback labels for groups whose names are still missing, plus a browser handoff action for leaving a group on Facebook
- [x] Facebook group discovery rejects activity-only labels and numeric ID fallbacks, scrolls the joined-groups directory during explicit refresh, logs group refreshes in the provider activity log, shows row-level progress while a missing-name group is being checked, reads nearby rendered card text and image alt text when group links only expose timestamps, preserves good stored names, repairs missing stored names from already captured group posts or individual group pages, verifies a single group after the leave handoff before removing it locally, remains device-local through factory reset so reconnecting does not repeat discovery, and keeps joined-groups refresh behind explicit provider-risk confirmation
- [x] Desktop Sources settings expose per-source scraper window modes: shown, cloaked, hidden
- [x] Post-login sync uses the user's selected scraper window mode instead of switching modes for the first scrape
- [x] Background FB and IG scraper WebViews force provider media silent during scrape and auth-check flows
- [x] Social providers surface paused/degraded health summaries in settings and the sidebar source surfaces
- [x] Explicit and heuristic rate-limit signals auto-pause social sync, notify the user, and allow manual resume
- [x] Social provider settings switch to reconnect prompts when the last sync error indicates expired or unauthorized auth
- [x] Settings Sources nav shows visible right-edge status dots, while the primary Sources sidebar keeps smaller inline status dots after each social provider name
- [x] Social sync actions show an inline spinner only while that specific provider is actively syncing
- [x] Social provider status dots switch to a live spinner while that provider is actively syncing
- [x] Social provider sections include a filtered line-by-line scrape log so users can see what the scraper is doing in real time without expanding the outer Settings view, and paused or degraded health summaries keep the latest failure reason plus timestamp visible after the live log expires
- [x] Desktop social scraper commands serialize behind a shared native session lock so background WebKit jobs cannot overlap and starve the main renderer
- [x] Social memory preflight blocks fan-out across providers when Freed Desktop memory remains high after cleanup
- [x] Memory-pressure preflight deferrals stay in diagnostics but age out of the current sidebar and source-menu warning state
- [x] Facebook and Instagram feed scrapes now register with the shared background runtime so cloud sync, content fetches, RSS polls, snapshots, outbox drains, and semantic classifiers do not compete with active WebKit scraping
- [x] Social scrape memory preflight uses adaptive high-memory budgets, native hidden-window runtime samples, and launch-delayed semantic enrichment so provider WebKit sessions get priority during long background runs
- [x] Startup memory attribution never blocks initialization and rejects cross-process, recycled-PID, ambiguous, or post-hydration comparisons
- [x] Local social scrape optimization loop ranks runtime-log evidence into safe local next actions and explicit provider-visible risk decisions
- [x] Authenticated Substack and Medium beta capture serializes behind the same
      native social session lock, runs memory preflight before provider loads,
      registers with the background runtime coordinator, records provider
      health and scrape outcomes, and uses bounded randomized pacing
- [x] Facebook, Instagram, and LinkedIn extractors expand common long-text controls before normalization
- [x] Social provider source menus surface a quick status explanation for warning or reconnect states before routing into full settings
- [x] Captured social authors can backfill the Phase 8 account catalog so followed accounts exist before identity confirmation
- [x] Empty states for both platforms in the feed view
- [x] Source indicators in sidebar for both platforms
- [x] Sync indicator panel shows both platforms
- [x] Direct Facebook and Instagram source views expose All, Posts, and Stories filters in the top toolbar
- [x] Facebook and Instagram settings expose `(Beta) Back up my uploaded media`, `Import Meta export`, `Backfill from profile`, `Back up now`, and `Open vault folder`
- [x] Meta export ZIP import copies Facebook and Instagram media into a permanent local vault with a local manifest
- [x] Permanent media archive state stays outside Automerge and is not synced
- [x] Continuous backup archives recent own-account media after provider sync when the account handle is known
- [x] Facebook roster planning keeps group ID, name, and URL in the local archive manifest
- [x] Story Wall beta preferences store selected years, source filters, layout, style, embed, publish target, hidden memories, and featured memories without syncing media binaries
- [x] Story Wall settings section lives under the Beta settings group, stays hidden behind an enable gate, previews media-backed Freed history, applies style controls live, and imports Instagram archive ZIPs through the permanent media vault after an export guidance modal
- [x] Story Wall beta GitHub Pages publisher generates a static destination with `index.html`, `embed.js`, static JSON, `.nojekyll`, and committed vault assets
- [ ] Story Wall beta automatic publishing runs after capture settles with capped randomized backoff
- [ ] Story Wall beta GitHub connector uses a GitHub App or scoped OAuth flow instead of manual token entry
- [ ] Facebook feed posts validated against real account (selector tuning)
- [ ] Instagram feed posts validated against real account (selector tuning)
- [ ] Direct own-profile crawler validated against saved Facebook profile, Instagram grid, reels, albums, and media-page DOM fixtures
- [~] Stories captured, with IG + FB story scraping integrated, stricter Instagram story viewer validation, Instagram story location URLs preserved for map recovery, playable story video rendering in the feed, stable fallback IG story IDs, Instagram media-key duplicate repair, and same-platform story duplicate repair. Selector tuning still needs work.
- [x] Cross-platform dedup (task 7.15): linked Facebook and Instagram stories or posts with similar text now collapse into one item when they land within a few minutes of each other, while preserving saved state, tags, and richer map metadata
- [x] Like button with outbox pattern: intent recorded immediately, synced to platform async
- [x] Two-state like UI: "noted" (amber) vs "memorialized" (red confirmed on platform)
- [x] Seen-sync via WebView navigation (FB/IG) - best-effort, confirmed via seenSyncedAt
- [x] X likes via GraphQL FavoriteTweet/UnfavoriteTweet mutations
- [x] X post reader hydration can fetch reply-thread items with media through the authenticated GraphQL path while online
- [x] Facebook and Instagram reader posts show a native site reply link first, and fetch visible comments with media through authenticated WebView paths only after the user chooses the beta inline replies action while online
- [x] Facebook and Instagram stories show a precise private-replies state in the reader because story replies live in platform inboxes
- [x] Comment links open post URL in system browser (platform-agnostic via PlatformContext.openUrl)
- [x] sourceUrl populated across all normalizers (X, Facebook, Instagram, RSS, Saved)

---

## Risks

| Risk                   | Mitigation                                                    |
| ---------------------- | ------------------------------------------------------------- |
| DOM changes frequently | Version selectors, monitor for breakage, quick update process |
| Account bans           | Conservative rate limiting, human-like scrolling with jitter  |
| Anti-bot detection     | Native WebView, per-session OS-aware UA, Gaussian timing, webkit-mask init script, rquest Chrome TLS fingerprint for X |
| Legal concerns         | User captures their own data, no central server               |

---

## Future Shared Provider Runtime: Obscura

**Status:** Research only. The current Tauri WebView provider runtime remains
the production path. This roadmap entry does not authorize implementation,
live provider traffic, or a cookie-handoff experiment.

The [Obscura](https://github.com/h4ckf0r0day/obscura) project is a small
Rust and V8 browser engine with Chrome DevTools Protocol support. It could give
Freed one provider-scraping runtime across macOS, Windows, and Linux. This
review reflects Obscura v0.2.0 and upstream commit
`28e230cd0b4526df63f5b3b2aa0b458c2dcab443`, reviewed on 2026-08-13.

### Potential rewards

- One DOM, JavaScript, cookie, navigation, and diagnostics implementation
  across all supported Freed Desktop platforms.
- A smaller on-demand browser process than a full Chromium sidecar, if matched
  installed-build measurements confirm the upstream resource claims against
  Freed's actual WebView workloads.
- Process isolation from Freed's main renderer. A failed provider page could
  terminate its own sidecar without taking the library UI with it.
- CDP offers a narrow adapter for navigation, script injection, extraction,
  screenshots, and provider fixtures. Most existing self-contained DOM
  extractors could keep their selectors and replace only the Tauri event
  bridge.
- One provider runtime contract could standardize session locks, bounded
  retries, cooldowns, telemetry, and failure handling without forcing RSS,
  public APIs, or X's native request path through a browser.

These are hypotheses, not measured Freed results. Obscura's public benchmarks
do not establish lower memory than WKWebView, WebView2, or WebKitGTK under the
same provider page, account, runtime window, and extraction workload.

### Primary risk: login and browser identity discontinuity

Copying authenticated cookies from the visible login WebView into Obscura would
transfer credentials, not the browser session that created them. The handoff
would omit or alter several signals a provider can compare:

- TLS, HTTP/2, HTTP/3, header ordering, and connection reuse
- JavaScript engine semantics, browser APIs, error shapes, timers, and event
  ordering
- canvas, WebGL, audio, fonts, text measurement, media codecs, and rendering
  quirks
- local storage outside the cookie jar, including session storage, IndexedDB,
  service workers, caches, and device-bound authentication state
- locale, time zone, screen, input, permissions, WebRTC, and hardware hints
- navigation history, resource graph, interaction timing, retries, and
  challenge history

The mismatch is largest on macOS. The current login surface is WKWebView with a
Safari-shaped identity, while Obscura uses V8 and a Chrome-shaped network and
JavaScript profile. Setting Obscura's user agent, screen size, canvas output,
or navigator fields to the values reported by the login view would not change
its engine, transport, API behavior, or renderer. A Safari label attached to
Chrome-shaped behavior may be easier to identify than an honest new browser.

Windows WebView2 is closer to Obscura's target, but version, Edge runtime,
network behavior, feature support, and rendering can still disagree. Linux
also changes engines. Facebook, Instagram, LinkedIn, Substack, and Medium may
treat the same cookies arriving through that new client as a new device,
challenge the session, expire it, or block later requests.

Obscura's fingerprint controls reduce obvious automation markers, but they do
not turn its engine into the login WebView. Per-session fingerprint rotation is
also the wrong default for Freed. One account repeatedly becoming a new device
is less plausible than one stable installation and provider profile.

### Requirements before implementation

1. Obscura should own the provider session from the first request through
   login, authentication checks, and capture. The visible login surface would
   need to render that same Obscura context and forward keyboard, pointer,
   accessibility, IME, password-manager, two-factor, CAPTCHA, and passkey flows
   without falling back to a second browser engine.
2. If a cookie handoff remains necessary, qualify it separately for Facebook,
   Instagram, LinkedIn, Substack, and Medium. Each provider needs an explicit
   Gate 1 decision describing the browser transition, request graph, timing,
   and bounded exposure before any live test.
3. Use one deterministic profile per installation and provider. Match only
   values Obscura can represent coherently, keep host locale and time zone
   honest, and never rotate profiles between routine captures.
4. Disable tracker blocking, request rewriting, proxy rotation, and unrelated
   stealth behavior for provider sessions. Missing provider subresources are
   part of the observable request graph.
5. Preserve full cookie semantics, including host-only, partitioned, secure,
   HTTP-only, same-site, path, and expiry behavior. Prove storage continuity
   for every non-cookie API the provider uses.
6. Wrap the sidecar in authenticated local IPC. Provider credentials must not
   enter command-line arguments, environment variables, logs, diagnostics, or
   plaintext persistence. The sidecar needs strict file permissions, bounded
   lifetime, crash cleanup, and exact binary identity.
7. Build an offline qualification suite first. Run saved provider fixtures,
   SPA navigation, extraction, storage, and challenge-page compatibility with
   all external traffic blocked. Delete temporary probes before publication.
8. Pilot one provider and one observable change at a time. Use a matched
   installed-build baseline, bounded soak, explicit rollback trigger, and the
   existing WebView path as the immediate rollback.

### Current decision

The transition is deferred because login continuity is unresolved and
Obscura's browser compatibility is still moving. The lowest-profile near-term
work is an offline `ProviderRuntime` adapter that standardizes orchestration,
extractor output, diagnostics, and fixtures around the existing native
WebViews. That work must not add provider requests or change navigation,
cookies, headers, timing, scrolling, clicking, or extraction behavior.

Revisit an Obscura pilot when it can own a usable visible login from the first
provider request, or when the owner approves a provider-specific cookie
handoff after reviewing the exact discontinuity. RSS and public API capture
should remain native. X should remain on its current native request path unless
separate evidence shows a browser runtime would improve its risk and resource
profile.

---

## Future Anti-Detection Improvements

These are documented for future implementation. They were discussed and deferred in the anti-detection hardening PR (feat/anti-detection-hardening).

### Quiet Hours Sync Gating

Gate automatic sync to not run between midnight and 6am (configurable by user). A machine that checks social media at 3am with perfectly regular intervals is a bot signal. The sync scheduler should check the current hour before triggering a background scrape and apply additional random delay at day boundaries.

### Stable Canvas Identity

Do not add per-session canvas noise. A provider can compare canvas output with
WebGL, fonts, text measurement, GPU, browser version, and prior sessions.
Changing one surface on every launch creates a rotating device identity and can
introduce contradictions with the real WebView engine.

Keep the native browser's canvas behavior unchanged. If a future runtime needs
fingerprint controls, use one coherent, deterministic installation and
provider profile across the complete login and capture lifecycle. Treat any
canvas, WebGL, audio, font, or renderer override as a provider-visible behavior
that requires its own Gate 1 review.

### X API via X Login WebView (Option C)

Instead of Rust HTTP + rquest, inject GraphQL `fetch()` calls into the authenticated X login WebView. Since the WebView is already on the `twitter.com` domain after login, these are same-origin requests - the browser attaches cookies automatically, uses the real browser TLS stack (no BoringSSL compile dependency), and sends headers in the browser's native order.

This requires:
- Keeping the X login WebView alive after login (as a hidden window, like the FB/IG pattern)
- Injecting JS that calls `fetch()` against the GraphQL endpoint and returns results via Tauri event IPC
- Significant refactor of the X capture flow

This approach eliminates the need for rquest entirely and is architecturally cleaner. Deserves its own PR.

### TLS JA4H Header Order Analysis

Profile whether the HashMap → Vec ordered header change in x_api_request meaningfully changes Cloudflare's bot score in practice. Set up a test account, capture baseline bot scores before and after the change using Cloudflare's bot score headers (`cf-bot-score`, visible in network logs when testing against a CF-fronted endpoint), and quantify the improvement.

---

## Deliverable

`@freed/capture-facebook` and `@freed/capture-instagram` packages for DOM-based feed capture via Tauri WebView. Location data from these sources feeds into Phase 8 (Friend Map).
