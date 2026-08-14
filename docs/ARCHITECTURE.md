# Freed Technical Architecture

Accurate as of 2026-07-23. This document describes the system as shipped, not as aspired to. GitHub Issues carrying the `debt` label are the sole canonical backlog for known defects and program-tracked limitations. Durable stability policy lives in [STABILITY-PROGRAM.md](STABILITY-PROGRAM.md).

## What Freed is

Freed Desktop captures the user's own social feeds (X, Facebook, Instagram, LinkedIn, Substack beta, Medium beta, YouTube, RSS, saved articles) on their machine using their own authenticated sessions, stores everything locally in one Automerge document, and presents a user-controlled unified feed. A companion PWA at `app.freed.wtf` is the mobile reader. There is no Freed content backend: sync rides on a LAN relay inside the desktop app and on the user's own cloud storage (Google Drive, Dropbox). Small serverless endpoints handle narrow operations such as OAuth token exchange without receiving the Automerge document.

Earlier drafts of this document described a browser add-on capture layer and direct peer-to-peer device sync; neither was ever shipped, and nothing here is aspirational.

## Repo layout

npm workspaces monorepo (`packages/*`, `skills/*`, `website`), Node pinned by `.nvmrc`. Boundary rules live in AGENTS.md and are binding:

| Package | Role |
| ------- | ---- |
| `packages/shared` | Pure functions + types, including the Automerge schema (`src/schema.ts`, backward-compatible changes only). Zero runtime deps. No React. |
| `packages/ui` | Platform-agnostic React UI (feed, reader, map via MapLibre, search via MiniSearch, zustand stores). Ships raw `.tsx`; no build step. No platform stores, no Tauri APIs. |
| `packages/sync` | Storage-agnostic sync: IndexedDB and filesystem storage adapters, cloud providers (`cloud/gdrive.ts`, `cloud/dropbox.ts`, `cloud/merge.ts`), LAN relay client (`network/local-relay.ts`). Works in browser and Node. |
| `packages/capture-*` | Isolated provider extraction, parsing, and normalization helpers. Capture packages never import each other. |
| `packages/desktop` | Tauri shell: React renderer plus `src-tauri/src/lib.rs` (~13k lines of Rust). Imports the capture packages used by its native and scheduled providers, plus `@freed/ui`, `@freed/shared`, and `@freed/sync`. |
| `packages/pwa` | Mobile reader app shell (Vite + React + vite-plugin-pwa/Workbox). Never imports Tauri APIs. |
| `website` | Marketing site (Next.js App Router) at `freed.wtf`. Lives on the `www` branch lane. |
| `.agents/skills/`, `automation/`, `scripts/` | Governed agent skills, continuous actor prompts and specifications, evidence schemas, and automation or release tooling. |

## Desktop app

Tauri 2 (Rust backend, WKWebView renderer on macOS). Two runtime halves:

**The React renderer is the orchestrator.** The main window runs the scheduler (`background-runtime-coordinator.ts` job kinds include `rss-poll`, content fetching, cloud upload), the RSS poller, the content fetcher, provider capture drivers (`fb-capture.ts`, `instagram-capture.ts`, `li-capture.ts`, `substack-capture.ts`, `medium-capture.ts`, `youtube-capture.ts`, X via `capture.ts`), provider health tracking, and the Automerge worker host. This is a load-bearing architectural fact: killing the main renderer kills every in-flight background job. Issue #1071 tracks recovery settlement, and issues #1080 and #1081 track scheduler and job settlement.

**Rust (`src-tauri/src/lib.rs`) owns native substrate:** window management including hidden scraper WebViews, the LAN sync relay, the renderer watchdog and memory recovery, `runtime-health.jsonl` telemetry, the dev sync trigger watcher, tray/updater/global-shortcut plumbing, and utility commands such as `fetch_binary_url`.

### Capture strategies per provider

Capture uses provider-specific transports. Anything that would change provider-visible behavior, including loads, navigation, request frequency, cookies, headers, extractor scripts, embeds, or provider API calls, requires the explicit approval lane in AGENTS.md and STABILITY-PROGRAM.md.

- **X:** hidden authenticated WebView calls X's own GraphQL API (`x.com/i/api/graphql`, endpoint definitions in `capture-x/src/endpoints.ts`) and normalizes timeline responses. No DOM scraping.
- **Authenticated websites:** isolated WebView data stores keep each provider session on the user's device. Provider pages are loaded and normalized by the matching `capture-*` package. DOM extractors can change frequently, so the stability program favors diagnostics over speculative hardening.
- **YouTube:** an isolated authenticated session captures the user's subscription roster and saved playlists through the YouTube-specific native bridge and `capture-youtube` normalization package. Playback remains a reader surface, not a background preload loop.
- **Substack and Medium beta:** isolated authenticated WebView sessions capture
  bounded rendered roster, activity, and essay records. Browser-safe capture
  packages normalize records, and one atomic Automerge change reconciles
  follow-roster accounts with visible activity. The graph run rejects browser
  chrome and essay links, and caps itself at 500 unique identities. Missing
  rows never imply an unfollow. Subscriber management and private communication
  surfaces are blocked. Essay excerpts embedded inside restacks, likes, and
  claps are not archived. A dedicated randomized scheduler runs both beta
  providers outside the RSS poll job. The next allowed capture time is stored
  outside auth state so cooldowns survive a restart or disconnect. User-added
  RSS remains the preferred path for full public essay bodies, with canonical
  reconciliation consolidating legacy duplicates without losing user state.
- **RSS:** `rss-poller.ts` on the renderer scheduler; parsing in `capture-rss`.
- **Save-for-later:** URL/clipboard capture through `capture-save` (Readability extraction); also used by the PWA.
- Facebook, Instagram, and LinkedIn social scrapes are currently nested inside
  the `rss-poll` job, which serializes them behind a Rust mutex and causes the
  recurring "job timed out kind=rss-poll" cycle. Issue #1080 tracks un-nesting.
  Substack and Medium use their dedicated scheduler and do not enter that nested
  path.

### Auth state

Session cookies live in the scraper WebViews' data stores. Issue #1077 tracks X 401/403 responses that are treated as transport failures and retried. Issue #1078 tracks logged-out Instagram and LinkedIn sessions that are not classified as authentication failures.

## Data model and sync

One Automerge document holds items, preferences, and social graph data (`packages/shared/src/schema.ts`). Schema changes must be backward compatible: add optional fields, never delete.

The document only stores state whose meaning survives moving to another device. Content, subscriptions, identity relationships, user-authored organization, ranking policy, capture policy, and accessibility preferences belong in Automerge. Window geometry, shell visibility, view modes, sort and filter selections, graph pin coordinates, machine endpoints, connection scheduling, and transient operation status stay in device-local storage. Central mutation guards enforce this boundary before preference, person, account, feed, or Story Wall changes reach Automerge. Legacy schema fields remain optional and deprecated so older documents still load, but current clients neither create nor update them. The synchronized metadata identifies the document itself. Runtime timestamps, presence, and machine-local settings do not belong in the document.

A minimal Freed Desktop registration map is the deliberate exception because its meaning is cross-device coordination. It lets a library detect that more than one Freed Desktop installation has been configured and warn that provider polling may be duplicated. Each opaque installation identifier originates in local native storage. The synced map records only the stable identifier and first registration time. It does not record PWA readers, online presence, last-seen heartbeats, provider credentials, or machine details.

Older documents can still contain full reader HTML and RSS retry fields. Current clients never create or update those fields in Automerge. Reader HTML remains read-only compatibility data so an upgrade cannot delete another device's only reader copy. It stays out of hydrated list state, is fetched from the worker only for the active reader, and is then cached locally. Deprecated synchronized RSS retry, error, and validator fields are ignored so one device's old failure cannot throttle another device.

RSS subscriptions and the last successful content refresh time sync. Retry windows, failure counters, and fetch errors stay local to the polling device. Deprecated synchronized HTTP validator fields are ignored. The current transport does not persist validators. If conditional requests are added later, their validators must stay local too. A failed network request on one machine must not delay another machine's scheduler.

Graph pin coordinates are migrated once from legacy Person and Account fields into a versioned local layout store. Current person and account mutations strip those fields at the store, optimistic projection, and schema boundaries. Rendering removes any stale synchronized coordinates before overlaying the current device's layout.

- **Worker ownership:** each app runs the document inside a dedicated worker (`automerge.worker.ts` in desktop and PWA). Mutations go through worker messages; `STATE_UPDATE` fans hydrated state back to subscribers. Persistence is IndexedDB with incremental appends plus periodic snapshots (`automerge-persistence.ts`, `snapshots.ts`).
- **LAN relay:** the desktop Rust side runs a WebSocket relay (default port 8765, `FREED_SYNC_PORT` override). The PWA pairs via QR code and connects as a client. Today the relay broadcasts desktop state to clients but never merges client pushes into the desktop document, and the PWA pushes only once per connection. Phone-to-desktop convergence over LAN does not exist yet and rides on cloud sync instead. Issue #1072 owns the inbound path.
- **Cloud sync:** full-document snapshots to the user's Google Drive or Dropbox with download, merge, and upload behavior in `sync/src/cloud/`. The shipped Freed Desktop heads guard suppresses merge-back upload echoes while preserving genuine mutations. Issue #1066 owns bounded re-verification, issue #1068 owns the matching PWA damper, issue #1069 owns Google Drive self-write filtering, and issue #1076 owns moving CRDT merge work off the main renderer thread.
- **Transport cost:** every synced mutation ships the whole document binary as a boxed `number[]` through two JavaScript heaps plus JSON Tauri IPC. Issue #1087 owns raw binary transport. Issue #1082 owns unbounded history and cloud-safe eviction.

## Watchdog and recovery

The Rust watchdog supervises the renderer via heartbeats (`renderer-heartbeat.ts` to `renderer_heartbeat` events), native memory samples, and WebKit process telemetry. Runtime health now writes daily files on Unix, keeps a stable `runtime-health.jsonl` symlink for readers, and retains recent history. Non-Unix builds retain the bounded single-file fallback. Recovery actions include renderer restart and scraper-window recycling.

Known limitations are tracked in issues #1089 through #1091, #1071, and #1070. They cover diagnostics under the renderer-health lock, WebKit process attribution, invalid CPU gates, recovery before scrape settlement, and scraper recycling without an active-session check. **Do not tune watchdog thresholds** while those measurement and demand-side issues remain open.

## PWA reader

Vite + React + `vite-plugin-pwa` (Workbox) at `app.freed.wtf` (Vercel). Imports `@freed/ui`, `@freed/shared`, `@freed/sync`, and `@freed/capture-save`. Runs its own Automerge worker and IndexedDB persistence, connects to the Freed Desktop relay over LAN through QR pairing, and can sync against the same cloud snapshot. Issue #1068 tracks its cloud-loop damper, and issue #1086 tracks its full-document save, hydration, and merge work.

## Website

Next.js App Router marketing site at `freed.wtf` (`website/`), deployed to Vercel under the `aubreyfs-projects` scope only. Public roadmap data lives in `website/src/app/roadmap/RoadmapContent.tsx` and mirrors `docs/PHASE-*.md` statuses. Marketing changes ride the `www` branch lane, never `dev`.

## Release lanes and shipping

Three long-lived branches: `dev` (product work, default), `main` (production releases), `www` (public marketing + published changelog). Versioning is CalVer `YY.M.DDBUILD` (AGENTS.md has the encoding). Dev release prep starts from current `origin/dev` and returns through a reviewed PR to `dev`. Production release prep starts from current `origin/main` after any required `dev` promotion and returns through a release-only PR to `main`. `release-publish.sh` tags only the exact merged remote commit. Pushing that tag triggers `.github/workflows/release.yml` for validation, platform builds, updater metadata, publication, and website or PWA deployment. Desktop self-updates via `tauri-plugin-updater`. The full operator flow is the `freed-ship-build` skill.

## Testing and validation

- Desktop e2e: Playwright against plain Chromium with a mocked Tauri layer (`VITE_TEST_TAURI=1`; see AGENTS.md "Desktop E2E Testing" and `packages/desktop/tests/e2e/README.md`), including a perf suite gated in CI against `perf-baselines.json` / `perf-budgets.json`.
- Validation tiers: `npm run validate:feature` (path-scoped, feature branches), `validate:dev` (integration), `validate:release` (release prep). CI is `.github/workflows/ci.yml`.
- Tooling smoke: `npm run test:scripts` covers the automation scripts in `scripts/`.

## Automation substrate

- `scripts/lib/automation-control.mjs` and `scripts/automation-control.mjs`:
  canonical task state, authenticated actor policy, short-lived leases, provider
  approval state, append-only events, pending outcome reservations, and atomic
  lifecycle transitions under `~/.freed/automation/`.
- `automation/specs/` and `automation/prompts/`: checked-in contracts for the
  nightly runner, runtime observer, release verifier, scaffolding maintainer,
  and stability controller. `scripts/validate-automation-specs.mjs` checks the
  repository contract. `scripts/validate-host-automations.mjs` audits the saved
  host actors and their owner-supplied overlays without installing them.
- `scripts/nightly-self-improve.mjs`: planner and executor that turns verified
  soak, canary, triage, CI, and program evidence into ranked work. Strict
  `scripts/doctor.mjs --strict` preflight gates mutation and publishing.
- `scripts/doctor.mjs`: machine preflight for the pinned Node toolchain, GitHub
  CLI, credential helpers, Python, Xcode license state, automation state, and
  optional trusted publisher readiness. Worktree setup may warn, but continuous
  mutation loops stop on strict failures. Missing optional broker provisioning
  is a warning unless the caller explicitly requires that profile.
- `scripts/soak-collect.mjs` and `scripts/soak-assert.mjs`: exclusive installed
  soak collection, raw evidence mirroring, build attribution, source-health
  checks, comparable workload context, and machine-readable verdicts. See
  docs/SOAK-AND-TRIGGERS.md.
- `scripts/canary-context.mjs` and `scripts/canary-summarize.mjs`: rebuild a
  stored soak, preserve runtime and collector sidecars, compare only verified
  historical cohorts, and write portable canary ledger bundles.
- `scripts/build-outcome-verdict.mjs` and `scripts/record-outcome.mjs`: derive
  task effects from raw registered evidence, then commit one authenticated
  outcome transaction to the canonical ledger and control event stream.
- `scripts/triage.mjs`: fold attributable alarms, soak failures, verified
  canary regressions, and CI issues into one immutable ranked candidate
  generation while preserving duplicate event multiplicity.
- `scripts/trusted-publisher-host.swift` and
  `scripts/trusted-worktree-publish.sh`: optional root-provisioned publisher broker,
  one-use scoped capabilities, exact leases, pinned executable identities, and
  final branch and PR rechecks. No reusable publisher secret enters an agent
  process.
- `scripts/lib/provider-visible-paths.mjs`, `.github/CODEOWNERS`, and
  `.github/rulesets/`: canonical provider-risk classification and branch
  governance. Ruleset creation remains an explicit post-merge owner action.
- `scripts/stability-artifact.mjs` and `automation/artifact-schemas/`: versioned,
  content-addressed interchange manifests for evidence capture, memory
  profiles, sync replays, provider reviews, and controller decisions.
- `scripts/dev-sync-trigger.mjs`: terminal-driven provider sync trigger for installed dev builds (same doc).
- `.agents/skills/` contains the governed operational workflows.
  `scripts/validate-skills.mjs` checks safe invocation, referenced commands,
  local links, and agent metadata.
- GitHub Issues carrying the `debt` label are the sole canonical engineering
  debt backlog. Continuous actors reconcile eligible issues through the control
  plane. The active execution manifest references each issue and never becomes
  a parallel backlog.
