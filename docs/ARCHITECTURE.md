# Freed Technical Architecture

Accurate as of 2026-07-10 (dev @ v26.7.900). This document describes the system as shipped, not as aspired to. Known defects and program-tracked limitations cite finding IDs from [stability-findings.json](stability-findings.json); the remediation plan is [STABILITY-PROGRAM.md](STABILITY-PROGRAM.md).

## What Freed is

Freed Desktop captures the user's own social feeds (X, Facebook, Instagram, LinkedIn, RSS, saved articles) on their machine using their own authenticated sessions, stores everything locally in one Automerge document, and presents a user-controlled unified feed. A companion PWA at `app.freed.wtf` is the mobile reader and owns the first authenticated YouTube connection. There is no Freed content backend: sync rides on a LAN relay inside the desktop app and on the user's own cloud storage (Google Drive, Dropbox). Small serverless endpoints handle operations such as Google OAuth token exchange without receiving the Automerge document or YouTube media.

Earlier drafts of this document described a browser add-on capture layer and direct peer-to-peer device sync; neither was ever shipped, and nothing here is aspirational.

## Repo layout

npm workspaces monorepo (`packages/*`, `skills/*`, `website`), Node pinned by `.nvmrc`. Boundary rules live in AGENTS.md and are binding:

| Package | Role |
| ------- | ---- |
| `packages/shared` | Pure functions + types, including the Automerge schema (`src/schema.ts`, backward-compatible changes only). Zero runtime deps. No React. |
| `packages/ui` | Platform-agnostic React UI (feed, reader, map via MapLibre, search via MiniSearch, zustand stores). Ships raw `.tsx`; no build step. No platform stores, no Tauri APIs. |
| `packages/sync` | Storage-agnostic sync: IndexedDB and filesystem storage adapters, cloud providers (`cloud/gdrive.ts`, `cloud/dropbox.ts`, `cloud/merge.ts`), LAN relay client (`network/local-relay.ts`). Works in browser and Node. |
| `packages/capture-x` | X GraphQL response types, endpoint definitions (`https://x.com/i/api/graphql`), and normalizers. |
| `packages/capture-facebook` / `capture-instagram` / `capture-linkedin` | Per-provider extraction and normalization helpers. Capture packages never import each other. |
| `packages/capture-rss` | RSS/Atom parsing (rss-parser, fast-xml-parser). |
| `packages/capture-youtube` | Typed YouTube Data API client, subscription and upload normalization, private playlist creation, and membership-checked playlist insertion. |
| `packages/capture-save` | Save-for-later article capture (Readability, zip import/export). |
| `packages/desktop` | Tauri shell: React renderer plus `src-tauri/src/lib.rs` (~13k lines of Rust). Imports the capture packages used by its native and scheduled providers, plus `@freed/ui`, `@freed/shared`, and `@freed/sync`. YouTube API transport currently belongs to the PWA. |
| `packages/pwa` | Mobile reader app shell (Vite + React + vite-plugin-pwa/Workbox). Never imports Tauri APIs. |
| `website` | Marketing site (Next.js App Router) at `freed.wtf`. Lives on the `www` branch lane. |
| `skills/`, `scripts/` | Agent skills and the automation/release tooling (see AGENTS.md and docs/NIGHTLY-SELF-IMPROVE.md). |

## Desktop app

Tauri 2 (Rust backend, WKWebView renderer on macOS). Two runtime halves:

**The React renderer is the orchestrator.** The main window runs the scheduler (`background-runtime-coordinator.ts` job kinds include `rss-poll`, content fetching, cloud upload), the RSS poller, the content fetcher, provider capture drivers (`fb-capture.ts`, `instagram-capture.ts`, `li-capture.ts`, X via `capture.ts`), provider health tracking, and the Automerge worker host. This is a load-bearing architectural fact: killing the main renderer kills every in-flight background job (finding F03; Wave 6 of the stability program moves orchestration into Rust).

**Rust (`src-tauri/src/lib.rs`) owns native substrate:** window management including hidden scraper WebViews, the LAN sync relay, the renderer watchdog and memory recovery, `runtime-health.jsonl` telemetry, the dev sync trigger watcher, tray/updater/global-shortcut plumbing, and utility commands such as `fetch_binary_url`.

### Capture strategies per provider

Capture uses several provider-specific transports. X, Facebook, Instagram, and LinkedIn use the user's authenticated sessions in app-managed WebViews. RSS uses scheduled public feed requests. Save-for-later fetches an explicit URL. YouTube uses PWA OAuth and the official Data API. Anything that would change provider-visible behavior, including loads, navigation, request frequency, cookies, headers, extractor scripts, embeds, or provider API calls, requires the explicit approval lane in AGENTS.md and STABILITY-PROGRAM.md.

- **X:** hidden authenticated WebView calls X's own GraphQL API (`x.com/i/api/graphql`, endpoint definitions in `capture-x/src/endpoints.ts`) and normalizes timeline responses. No DOM scraping.
- **Facebook / Instagram / LinkedIn:** hidden scraper windows (labels `fb-scraper`, `ig-scraper`, `li-scraper`, each with an isolated WebKit data store) load the provider feed and run DOM extract scripts (`fb-extract-dom`, `instagram-extract-script`, `li-extract-dom`, plus stories and FB groups variants). Results are normalized by the matching `capture-*` package. Facebook extractors have a measured ~2-day half-life against DOM churn; the program forbids hardening passes and prescribes diagnostics (canary classification) instead.
- **RSS:** `rss-poller.ts` on the renderer scheduler; parsing in `capture-rss`.
- **YouTube:** the PWA uses OAuth and the official Data API after an explicit user action. It stores the complete channel roster before attempting up to five recent uploads per channel, so optional enrichment failures cannot discard follows. Each active roster channel becomes an ordinary RSS source, so Freed Desktop can continue through the existing RSS poller after sync. Roster-inactive channels stop polling without overwriting the user's local `enabled` preference. The PWA does not import YouTube Home, Watch Later, history, or Shorts recommendations.
- **Save-for-later:** URL/clipboard capture through `capture-save` (Readability extraction); also used by the PWA.
- Social scrapes are currently nested inside the `rss-poll` job, which serializes them behind a Rust mutex and causes the recurring "job timed out kind=rss-poll" cycle (F17; un-nesting is Wave 4).

### Auth state

Session cookies live in the scraper WebViews' data stores. Known misclassifications tracked by the program: X 401/403 is treated as transport and retried forever (F15); logged-out IG/LI sessions are never classified as auth failures and keep spinning full scrapes (F16). Wave 4 addresses both.

## Data model and sync

One Automerge document holds items, preferences, and social graph data (`packages/shared/src/schema.ts`). Schema changes must be backward compatible: add optional fields, never delete.

- **Worker ownership:** each app runs the document inside a dedicated worker (`automerge.worker.ts` in desktop and PWA). Mutations go through worker messages; `STATE_UPDATE` fans hydrated state back to subscribers. Persistence is IndexedDB with incremental appends plus periodic snapshots (`automerge-persistence.ts`, `snapshots.ts`).
- **LAN relay:** the desktop Rust side runs a WebSocket relay (default port 8765, `FREED_SYNC_PORT` override). The PWA pairs via QR code and connects as a client. Today the relay broadcasts desktop state to clients but never merges client pushes into the desktop document, and the PWA pushes only once per connection. Phone-to-desktop convergence over LAN does not exist yet and rides on cloud sync instead (F02/F23; Wave 3 builds the inbound path).
- **Cloud sync:** full-document snapshots to the user's Google Drive or Dropbox with download-merge-upload (`sync/src/cloud/`). Program-tracked defects: every upload re-merges the remote and re-triggers itself through an unfiltered doc-change subscriber, forming a self-sustaining idle upload loop on desktop and PWA (F01/F06); the GDrive changes poll has no self-write filter (F12 lists more); the CRDT merge runs on the main renderer thread (F14). Wave 2 dampers (P1-01..P1-03) break these loops.
- **Transport cost:** every synced mutation ships the whole document binary as a boxed `number[]` through two JS heaps plus JSON Tauri IPC (~16-20x document size transient, F07/F10), history grows without bound (F08), and archive pruning, the only automatic eviction, is disabled whenever cloud credentials exist (F09). Wave 5 is the demand-side fix (raw-bytes transport, worker lifecycle, eviction re-enable).

## Watchdog and recovery

The Rust watchdog supervises the renderer via heartbeats (`renderer-heartbeat.ts` → `renderer_heartbeat` events), native memory samples, and WebKit process telemetry, appending structured events to `runtime-health.jsonl` in the app data dir (currently halved at a 5 MiB cap; P0-04 replaces this with daily rotation). Recovery actions include renderer restart and scraper-window recycling.

Known limitations (verified, frozen by program rule until Wave 6): WebKit process attribution is a heuristic that cannot distinguish the main renderer from scrapers. WebKit XPC processes are children of launchd, not the app (F27); `cpu_usage` is always 0.0 so CPU-gated recovery paths are dead code (F28); diagnostics run un-timed subprocesses under the renderer-health write lock (F25); post-scrape recovery can destroy the renderer before a scrape invoke returns (F03/F26); the memory preflight recycles scraper windows without an active-session check (F04/F30). **Do not tune watchdog thresholds**; every threshold change re-opens the fix treadmill the stability program exists to stop.

## PWA reader

Vite + React + `vite-plugin-pwa` (Workbox) at `app.freed.wtf` (Vercel). Imports `@freed/ui`, `@freed/shared`, `@freed/sync`, `@freed/capture-save`, and `@freed/capture-youtube`. Runs its own Automerge worker and IndexedDB persistence, connects to the desktop relay over LAN (QR pairing), and can sync against the same cloud snapshot. It shares the cloud-loop defect with the desktop (F06/F22).

### YouTube focus and offline boundary

The PWA stores a separate device-local YouTube OAuth bundle. It never reuses the Google Drive cloud-token key and never writes provider credentials into Automerge. Read-only authorization imports subscriptions. A later incremental `youtube.force-ssl` grant enables one private `Freed Offline` playlist. Each insert first checks membership, so retrying does not intentionally duplicate a video. Playlist IDs and sync counters are device-local in the initial implementation.

The shared reader recognizes strict YouTube video URLs. It skips article hydration, keeps the YouTube iframe unloaded until `Watch here in Focus Mode`, disables autoplay and playlist loading, and removes the iframe after the ended event. `Play in YouTube` uses a direct canonical watch URL in the user's tap, which gives iOS Universal Links the best chance to open the exact video. The private playlist link similarly opens YouTube, where Premium owns background playback and encrypted device downloads.

Freed does not fetch, proxy, decrypt, cache, or redistribute YouTube media. It cannot query Premium status or YouTube's device-download state. The relay, native Screen Time companion, direct-media, quota, native WebView, and privacy findings are recorded in [YouTube Focus and Offline Integration](YOUTUBE-INTEGRATION.md).

## Website

Next.js App Router marketing site at `freed.wtf` (`website/`), deployed to Vercel under the `aubreyfs-projects` scope only. Public roadmap data lives in `website/src/app/roadmap/RoadmapContent.tsx` and mirrors `docs/PHASE-*.md` statuses. Marketing changes ride the `www` branch lane, never `dev`.

## Release lanes and shipping

Three long-lived branches: `dev` (product work, default), `main` (production releases), `www` (public marketing + published changelog). Versioning is CalVer `YY.M.DDBUILD` (AGENTS.md has the encoding). The ship flow is `release.sh` (version + draft notes) → manual note approval → `release-publish.sh` (tag) → tag push triggers `.github/workflows/release.yml` (validation, four-platform build matrix, updater manifest `latest.json`, publish, website/PWA deploys). Desktop self-updates via `tauri-plugin-updater`. The full operator flow is the `freed-ship-build` skill.

## Testing and validation

- Desktop e2e: Playwright against plain Chromium with a mocked Tauri layer (`VITE_TEST_TAURI=1`; see AGENTS.md "Desktop E2E Testing" and `packages/desktop/tests/e2e/README.md`), including a perf suite gated in CI against `perf-baselines.json` / `perf-budgets.json`.
- Validation tiers: `npm run validate:feature` (path-scoped, feature branches), `validate:dev` (integration), `validate:release` (release prep). CI is `.github/workflows/ci.yml`.
- Tooling smoke: `npm run test:scripts` covers the automation scripts in `scripts/`.

## Automation substrate

- `scripts/nightly-self-improve.mjs`: nightly planner that turns soak/scan evidence into ranked overnight tasks (docs/NIGHTLY-SELF-IMPROVE.md). Learning state lives in `~/.freed/automation/`.
- `scripts/doctor.mjs`: machine preflight (pinned Node toolchain, gh, credential helpers, python3) run warn-only by the worktree helpers.
- `scripts/soak-collect.mjs` / `scripts/soak-assert.mjs`: installed-soak evidence collection and machine-readable verdicts (docs/SOAK-AND-TRIGGERS.md is the canonical soak contract).
- `scripts/dev-sync-trigger.mjs`: terminal-driven provider sync trigger for installed dev builds (same doc).
- The stability program (docs/STABILITY-PROGRAM.md) is the active engineering queue; agents pick tasks from its wave tables under its binding rules.
