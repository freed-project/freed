# Phase 4: Sync Layer

> **Status:** 🚧 In Progress
> **Dependencies:** Phase 1-2 (Capture layers ✓)
>
> Local relay, Google Drive cloud sync, desktop local snapshot rotation, "Sync Now" button, "Last synced" indicator, proxied Google token exchange for Freed Desktop with a built-in production proxy default, durable Google OAuth refresh, recoverable Google Contacts token-refresh failures, a production callback relay for dev and preview PWA Google OAuth, appDataFolder Drive polling, cloud sync health diagnostics, visible Drive transfer diagnostics in Settings, manual Drive sync from Desktop and PWA Settings, cloud sync activity timelines, global background activity visibility for Desktop cloud work, initial Drive download auth-refresh recovery, merged-upload local convergence, destructive Automerge merge blocking, pinned explicit local wins and cloud wins recovery actions, PWA local-change cloud uploads, PWA document-init-gated cloud startup, runtime-gated cloud upload waits, mobile-safe Drive upload bodies, the multi-Desktop request warning, the no-cloud-sync launch banner, revision-fenced IndexedDB v2 persistence, stale worker retirement, a production-located compatibility bridge that writes exact Automerge revisions into crash-safe immutable SQLite shadow generations, a receipt-bound external decode path through graph staging, FeedItem reconstruction, lossless row projection, bounded shadow-generation population, and the first source-fenced product read from SQLite are implemented. Automerge remains the sole authority and full renderer corpus. Before the first Automerge decode, Freed Desktop can resume an admitted canonical legacy revision into a native spool, reconstruct it through disk-backed SQLite, and select one verified immutable derived generation. The all-content Freed Desktop feed, when it is not searching, using Friends-only filtering, or applying the saved-content sort, can now materialize and select an exact query-specific generation and page compact cards from SQLite. Its materializer reuses the one plain renderer snapshot already produced at startup, preserves exact source enumeration across incremental item patches, and sends only 128-row pages to SQLite instead of walking the Automerge proxy corpus a second time. The reader pins at most two authenticated immutable generations for at most 60 seconds, caps each SQLite cache at 2 MiB, releases exhausted, cancelled, failed, or replaced sessions, and returns source-bound canonical cursors through the closed protocol. Source changes fail closed to the existing Automerge path. A device-local rollback switch disables the reader before projection work. Append-style legacy source decoding, search, Friends-only views, saved-content sorting, PWA reads, exhaustive product-reader conversion, renderer-corpus eviction, elected migration authority, and source admission fencing remain blocked. This is the first Gate D SQL read transition, not the final memory cutover: the current renderer still loads the full Automerge corpus until the remaining consumers move and the legacy worker can be evicted. Dropbox remains behind a coming-soon gate while its provider work is finished. iCloud is the remaining core document-sync item. Large offline media uses a separate future transport plan.

---

## Overview

Device-to-device sync via Automerge CRDT. Two sync modes, zero external infrastructure.

```
┌─────────────────────────────────────────────────────────────────┐
│                           SYNC LAYER                            │
│                                                                 │
│  HOME NETWORK (instant sync):                                   │
│  ┌─────────────┐    WebSocket    ┌─────────────┐               │
│  │   Desktop   │◄──────────────►│  Phone PWA  │               │
│  │   :8765     │    (<100ms)     │             │               │
│  └──────┬──────┘                 └─────────────┘               │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │ Cloud Sync  │  (GDrive / iCloud / Dropbox)                  │
│  │  (backup)   │  User's own account                           │
│  └─────────────┘                                                │
│                                                                 │
│  AWAY FROM HOME (5-30s sync):                                   │
│  ┌─────────────┐    Cloud File    ┌─────────────┐              │
│  │   Desktop   │◄────────────────►│  Phone PWA  │              │
│  └─────────────┘                  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Architecture

**Key decisions:**

- No relay server we operate (reduces legal attack surface)
- Desktop App / OpenClaw is the source of truth + runs ranking algorithm
- Cloud storage = backup + away-from-home sync
- Images cached locally per device (not synced via cloud)

---

## Package Structure

```
packages/sync/
├── src/
│   ├── index.ts              # Public API
│   ├── repo.ts               # automerge-repo wrapper
│   ├── storage/
│   │   ├── indexeddb.ts      # Browser storage adapter
│   │   └── filesystem.ts     # Node/Bun storage adapter
│   ├── network/
│   │   ├── local-relay.ts    # WebSocket server
│   │   └── cloud.ts          # Cloud storage sync
│   └── status.ts             # Sync status observables
├── package.json
└── tsconfig.json
```

---

## Core Implementation

### Local WebSocket Relay

```typescript
// packages/sync/src/network/local-relay.ts
import { WebSocketServer } from "ws";
import { Repo } from "@automerge/automerge-repo";
import { NodeWSServerAdapter } from "@automerge/automerge-repo-network-websocket";

const DEFAULT_PORT = 8765;

/**
 * Start local WebSocket relay
 * PWA connects via ws://192.168.x.x:8765 or ws://desktop.local:8765
 */
export function startLocalRelay(repo: Repo, port = DEFAULT_PORT): void {
  const wss = new WebSocketServer({ port });
  const adapter = new NodeWSServerAdapter(wss);
  repo.networkSubsystem.addNetworkAdapter(adapter);

  console.log(`Freed sync relay running on ws://localhost:${port}`);
}
```

### PWA Client Connection

```typescript
// packages/sync/src/network/client.ts
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";

export async function connectToLocalRelay(
  repo: Repo,
  host: string,
  port = 8765
): Promise<boolean> {
  const url = `ws://${host}:${port}`;

  try {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      setTimeout(reject, 2000);
    });
    ws.close();

    const adapter = new BrowserWebSocketClientAdapter(url);
    repo.networkSubsystem.addNetworkAdapter(adapter);
    return true;
  } catch {
    return false; // Fall back to cloud sync
  }
}
```

### Cloud Storage Sync

```typescript
// packages/sync/src/network/cloud.ts
import * as A from "@automerge/automerge";

interface CloudConfig {
  provider: "gdrive" | "icloud" | "dropbox";
  credentials: OAuthCredentials;
}

export async function syncToCloud(
  doc: A.Doc<unknown>,
  config: CloudConfig
): Promise<void> {
  const binary = A.save(doc);

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

export async function syncFromCloud(
  localDoc: A.Doc<unknown>,
  config: CloudConfig
): Promise<A.Doc<unknown>> {
  const remoteBinary = await fetchFromCloud(config);
  if (!remoteBinary) return localDoc;

  const remoteDoc = A.load(remoteBinary);
  return A.merge(localDoc, remoteDoc);
}
```

### Sync Status API

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
    async sync(): Promise<void> {
      if (await this.tryLocalRelay()) return;
      await this.syncCloud();
    },
    subscribe(listener: (status: SyncStatus) => void): () => void {
      /* ... */
    },
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

---

## Sync Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        PWA OPENS                                 │
│                            │                                     │
│              ┌─────────────┴─────────────┐                      │
│              ▼                           ▼                      │
│     Try local relay              Load from IndexedDB            │
│     (ws://desktop:8765)              │                          │
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

---

## Device Pairing

1. **QR code** — Desktop displays QR with local IP + pairing token, phone scans
2. **Manual entry** — User copies full URL (including `?t=<token>`) from desktop settings
3. **mDNS discovery** — PWA auto-discovers `desktop.local` (not yet implemented)

### Pairing Security

The relay requires a 256-bit token in the WebSocket upgrade URI (`?t=<base64url>`).

- Token is generated on first launch, persisted to the app data directory, and re-used across restarts so paired devices auto-reconnect.
- QR code is rendered locally via `react-qr-code` — the user's LAN IP and token are never sent to a third party.
- "Reset Pairing Token" button (desktop Settings → Mobile Sync) rotates the token and persists the new value; connected devices remain unaffected until they disconnect and attempt to reconnect.
- Factory reset rotates the token, disconnects active relay clients, clears relay-held document bytes, and requires existing PWA readers to scan the current QR code again.
- New devices must scan the current QR code to obtain a valid token.

---

## Cloud Provider Strategy

**All three providers supported from day one:**

| Provider     | Complexity | Notes                                           |
| ------------ | ---------- | ----------------------------------------------- |
| Google Drive | Medium     | Well-documented APIs, OAuth works from browser  |
| Dropbox      | Low        | Simple OAuth, good cross-platform support       |
| iCloud       | High       | Best for Apple users, web API access is limited |

Each provider stores a single Automerge binary file. CRDT handles merge conflicts automatically.

### Future Large Media Transfer

Automerge and the current document relay are not media pipes. Future offline
audio and video packages must stay outside the Freed document, snapshots, logs,
and bug reports.

The planned transfer order is a dedicated authenticated LAN endpoint, then
chunk-encrypted objects in the user's configured cloud when Freed Desktop is
unreachable. The PWA verifies and stores each package in device-local media
storage. A Freed-hosted relay requires a separate owner decision after the
device-owned paths have been measured for reliability, privacy, provider
visibility, bandwidth, and cost.

See [YouTube Focus and Offline Integration](YOUTUBE-INTEGRATION.md) for the
first audio-oriented use case, security model, iPhone constraints, failure
recovery, telemetry, milestones, and acceptance tests.

---

## Tasks

| Task | Description                           | Status | Complexity |
| ---- | ------------------------------------- | ------ | ---------- |
| 4.1  | Create `@freed/sync` package scaffold | ✓      | Low        |
| 4.2  | Implement IndexedDB storage adapter   | ✓      | Medium     |
| 4.3  | Implement Filesystem storage adapter  | ✓      | Medium     |
| 4.4  | WebSocket relay server                | ✓      | Medium     |
| 4.5  | PWA WebSocket client + auto-connect   | ✓      | Medium     |
| 4.6  | QR code pairing flow                  | ✓      | Low        |
| 4.7  | Google Drive sync integration with durable OAuth and appDataFolder polling | ✓ | Medium |
| 4.8  | Dropbox sync integration              | ✓      | Low        |
| 4.9  | iCloud sync integration               | ☐      | High       |
| 4.10 | Sync status observable                | ✓      | Low        |
| 4.11 | "Last synced" UI indicator            | ✓      | Low        |
| 4.12 | Manual "Sync now" button              | ✓      | Low        |
| 4.13 | Cloud sync health diagnostics         | ✓      | Medium     |
| 4.14 | Desktop local rotating snapshots + restore UI | ✓ | Medium |
| 4.15 | Visible cloud transfer diagnostics, manual sync, and initial Drive download recovery | ✓ | Medium |
| 4.16 | Destructive Automerge merge guard     | ✓      | Medium     |
| 4.17 | Desktop cloud sync activity in the global background monitor | ✓ | Low |
| 4.18 | Dedicated large-media transfer lane, LAN first with encrypted user-cloud fallback | ☐ | High |
| 4.19 | Synced Freed Desktop registration and duplicate provider request warning | ✓ | Low |
| 4.20 | Dormant Library Core schema, mutation, query, worker-message, and local-authority census | ✓ | Medium |
| 4.21 | Closed dormant legacy epoch bootstrap record, bounded scan, prepared journal, local control, receipt, and TOFU adopter state contract | ✓ | Medium |
| 4.22 | Revision-fenced IndexedDB v2 storage and repeatable Automerge persistence primitive | ✓ | Medium |
| 4.23 | Dormant native SQLite projection engine with one canonical schema, atomic revisioned batches, and row-, byte-, field-, and nested-bounded keyset feed pages | ✓ | Medium |
| 4.24 | Crash-safe, idempotent derived SQLite projection batch receipts with exact response-loss recovery | ✓ | Medium |
| 4.25 | Bounded cross-runtime canonical operation construction codec and domain-separated input vectors | ✓ | Medium |
| 4.26 | Bounded duplicate-preserving shared and native canonical-value decoders with exact byte rejection vectors | ✓ | Medium |
| 4.27 | Shared exact protocol scalar predicates, including bounded entity IDs, reused by legacy bootstrap and future closed-schema validators | ✓ | Low |
| 4.28 | Closed immutable `feed_item_read_assignment` payload syntax without materializer, provider action, or runtime activation | ✓ | Low |
| 4.29 | Typed entity-ID blocker for every dormant operation and exact v1 entity-key binding for `feed_item_read_assignment` | ✓ | Low |
| 4.30 | Exact `feed_item_read_assignment` touched-field binding without claiming merge algebra or write authority | ✓ | Low |
| 4.31 | Executable minimum-present `readAt` merge algebra shared by the operation and field registries | ✓ | Low |
| 4.32 | Crash-safe column-local SQLite read-assignment projection with exact derived receipt retry and no runtime caller | ✓ | Medium |
| 4.33 | Closed immutable read-assignment transaction-member construction with bounded causal frontier and exact payload/member digest derivation | ✓ | Medium |
| 4.34 | Bounded read-assignment transaction aggregation with contiguous actor-chain and signing-body digest derivation | ✓ | Medium |
| 4.35 | Exact Ed25519 wire scalars and bounded all-or-nothing operation-envelope finalization without persistence or runtime activation | ✓ | Medium |
| 4.36 | Shared Web Crypto and native Ring Ed25519 verification against one RFC 8032 vector without key generation or runtime activation | ✓ | Medium |
| 4.37 | Canonical complete-operation verification against an exact accepted actor tip before authoritative journaling | ✓ | Medium |
| 4.38 | Self-reference-free actor enrollment identity and body derivation with a closed observed-frontier contract | ✓ | Medium |
| 4.39 | Domain-separated actor possession proof and authority certificate construction with deterministic actor-chain genesis | ✓ | Medium |
| 4.40 | Canonical actor enrollment certificate verification against exact accepted authority state without commit authority | ✓ | Medium |
| 4.41 | FULL-durability SQLite journal, contiguous ingest sequence, actor-tip compare-and-swap, receipt, read materialization, and replication outbox in one transaction | ✓ | High |
| 4.42 | Native canonical transaction reconstruction, Ed25519 verification, exact retry, and stale-fork admission feeding the sealed authoritative SQLite journal input | ✓ | High |
| 4.43 | Native canonical actor-possession and authority-certificate verification producing only a sealed enrollment input | ✓ | High |
| 4.44 | Immutable SQLite authority-epoch history with same-transaction stale-epoch fences for enrollment and operation commits | ✓ | High |
| 4.45 | Shared and native epoch-transition digest, authority signature, and target-key possession domain prefixes | ✓ | Medium |
| 4.46 | Bounded indexed enrollment and operation replication-outbox keyset pages joined to one immutable canonical payload source | ✓ | Medium |
| 4.47 | Exact authoritative SQLite live-catalog verification against the checked-in schema before database acceptance | ✓ | Medium |
| 4.48 | Fixed SQLite application identity verified with the physical version and schema catalog before database acceptance | ✓ | Low |
| 4.49 | Defensive untrusted-schema SQLite connections with B-tree cell validation on every page read | ✓ | Low |
| 4.50 | Private-cache literal authoritative SQLite opens that reject final-component symbolic links and URI parameters | ✓ | Low |
| 4.51 | Per-connection SQLite parser, row, attachment, variable, trigger, and worker limits aligned with bounded Library Core payloads and fixed SQL | ✓ | Low |
| 4.52 | macOS `F_FULLFSYNC` barriers for authoritative SQLite commits and WAL checkpoints | ✓ | Low |
| 4.53 | Strict SQLite identifier and string quoting for authoritative schema and data statements | ✓ | Low |
| 4.54 | Read-only identity and schema preflight before an existing authoritative SQLite file receives writable access | ✓ | Low |
| 4.55 | Dormant bounded Automerge-to-derived-SQL projection probe with exact durable-source identity, response-loss replay, and idle document release | ✓ | Medium |
| 4.56 | Crash-resumable native derived-shadow rebuild with exact source identity, atomic row and receipt progress, and unreadable partial generations | ✓ | Medium |
| 4.57 | Durable immutable derived-shadow generation publication with WAL closure, no-replace atomic publication, parent durability, and exact readback | ✓ | Medium |
| 4.58 | Content-addressed derived-shadow generation registration with exact replay, integrity preflight, atomic reader selection, and one-step rollback | ✓ | Medium |
| 4.59 | Dormant generation-pinned SQLite reader with read-only registry authentication, content and receipt verification, physical file pinning, and bounded feed pages | ✓ | Medium |
| 4.60 | Dormant replay-safe projection coordinator composing bounded rebuild batches, immutable publication, exact generation selection, and generation-pinned reads | ✓ | Medium |
| 4.61 | Production-located compatibility bridge that debounces document changes, obeys the shared renderer-health and memory-pressure background gate, streams one exact bounded worker projection into SQLite, resumes durable batches after response loss, and atomically selects an immutable shadow generation while Automerge remains authoritative | ✓ | Medium |
| 4.62 | Revision-fenced external snapshot export with no second adapter-sized copy, 1 MiB transferred chunks, exact retry, and no Automerge decode | ✓ | Medium |
| 4.63 | Dormant crash-resumable native snapshot spool with exclusive no-follow files, Unix privacy enforcement, data-before-receipt durability, exact retry, tail recovery, and streaming source verification | ✓ | Medium |
| 4.64 | Dormant bounded Automerge 2.2 framing verifier with canonical ULEB128 lengths, streamed plain and compressed checksums, admitted decompression limits, and deterministic append-only chunk indexes | ✓ | Medium |
| 4.65 | Dormant external-memory Automerge document-layout decoder with bounded actors, heads, column directories, exact absolute ranges, and deterministic append-only layout indexes | ✓ | Medium |
| 4.66 | Dormant bounded Automerge primitive-column decoder with streamed raw-DEFLATE, canonical signed and unsigned LEB128, bounded RLE expansion, and deterministic token runs | ✓ | Medium |
| 4.67 | Dormant bounded Automerge scalar-value joiner with exact metadata contracts, streamed raw-DEFLATE payloads, canonical numeric values, and deterministic payload spools | ✓ | Medium |
| 4.68 | Dormant bounded Automerge change-row reconstruction with verified token receipts, fixed-width dependency spooling, exact source-column contracts, and deterministic row runs | ✓ | Medium |
| 4.69 | Receipt-bound Automerge document-layout reader with bounded metadata, exact scratch-run verification, and provenance-branded change-column selection | ✓ | Medium |
| 4.70 | Dormant bounded Automerge operation-row reconstruction with receipt-bound column selection, spec-correct omitted deletes, fixed-width successor spooling, and deterministic value references | ✓ | Medium |
| 4.71 | Two-pass receipt-bound Automerge change and operation row readers with complete companion-spool verification before consumption | ✓ | Medium |
| 4.72 | Exact-range external row payload readers with fixed 64 KiB transfer buffers and post-consumption spool verification | ✓ | Low |
| 4.73 | Atomic scratch SQLite change and operation staging with incremental payload blobs, exact schema verification, and response-loss receipts | ✓ | Medium |
| 4.74 | Foreign-key-closed scratch migration graph with exact actor, dependency, object, element-key, successor, and head resolution | ✓ | High |
| 4.75 | Bounded complete-graph seal with contiguous actor intervals, exact operation coverage, streamed payload hashing, and same-count tamper rejection | ✓ | High |
| 4.76 | Spec-correct omitted-delete reconstruction with target consistency, Lamport successor validation, and delete-inclusive actor intervals | ✓ | High |
| 4.77 | Immutable current-operation materialization with omitted-delete removal, counter-increment visibility, conflict preservation, graph-bound receipts, and exact replay | ✓ | High |
| 4.78 | Bounded immutable value resolution with conflict preservation, disk-spilled Lamport winner selection, exact counter arithmetic, and receipt-bound replay | ✓ | High |
| 4.79 | Bounded immutable list and text order with deleted-anchor retention, disk-backed iterative traversal, and receipt-bound exact replay | ✓ | High |
| 4.80 | Bounded FeedItem topology reconstruction with deleted-entity omission, visible-sequence renumbering, depth admission, and receipt-bound exact replay | ✓ | High |
| 4.81 | Bounded lossless FeedItem JSON reconstruction with exact map, list, text, scalar, entity-identity, and replay receipts | ✓ | High |
| 4.82 | Lossless native FeedItem row projection with safe-integer columns, canonical cross-runtime JSON, exact absence and raw escapes, one-document memory bounds, and receipt-bound replay | ✓ | High |
| 4.83 | Bounded receipt-pinned scratch-row population into a resumable immutable SQLite generation | ✓ | High |
| 4.84 | Closed default `feed_page_v1` request, response, source, cursor, compact projection, nested bounds, and fail-closed parser contract | ✓ | Medium |
| 4.85 | Dormant Freed Desktop `feed_page_v1` runtime with authenticated generation pinning, canonical cross-runtime cursors, two-session and 60-second snapshot bounds, 2 MiB per-connection cache, cancellation, expiry, and cursor-exhaustion release | ✓ | Medium |
| 4.86 | Dormant PWA row-oriented IndexedDB `feed_page_v1` runtime with bounded resumable generation batches, atomic selection, keyset reads, two-session and 60-second bounds, exact cancellation, restart recovery, and worker transport registration | ✓ | Medium |
| 4.87 | Dormant authenticated PWA feed materializer with committed-head source identity, one-item projection, 128-row staging bounds, exact replay, visibility parity, and no product caller | ✓ | Medium |
| 4.88 | Canonical normalized feed-filter contract shared by the current renderer and future bounded adapters, with exact archived, hidden, source, author, feed, post/story, saved, tag, and signal semantics | ✓ | Medium |
| 4.89 | Canonical recommendation-order contract shared by both current workers, preserving priority, published-time, and source-enumeration tie semantics for future bounded adapters | ✓ | Medium |
| 4.90 | Dormant query-specific PWA browse projection with normalized filter and ranking-clock source identity, exact recommendation-order index keys, 128-row staging bounds, IndexedDB v1 upgrade preservation, and no product caller | ✓ | Medium |
| 4.91 | Closed dormant `feed_browse_page_v1` protocol and PWA reader with canonical filter and ranking-clock binding, full physical keyset cursor, shared two-session and 60-second lifecycle bounds, exact worker transport, and no product caller | ✓ | Medium |
| 4.92 | Crash-resumable native SQLite browse generation with exact filter, ranking-clock, and source binding, 128-row and 2 MiB staging bounds, replay receipts, index-backed physical keyset order, and no runtime caller | ✓ | Medium |
| 4.93 | Dormant Freed Desktop browse-generation writer transport with one session-bound active generation, exact progress recovery after response loss, replay-safe bounded pages, explicit cancellation, factory-reset quiescence, and no worker or product caller | ✓ | Medium |
| 4.94 | Dormant Freed Desktop browse materializer with exact durable Automerge source authentication, normalized filter and ranking-clock generation identity, closed feed-card validation, iterator-backed 128-row pages, native receipt recovery, and no product caller | ✓ | Medium |
| 4.95 | Immutable native browse-generation seal with complete WAL checkpoint, DELETE journal transition, integrity verification, stable file digest and length receipt, and read-only completed replay | ✓ | Medium |
| 4.96 | Dedicated native browse-generation registry with exact logical query and physical file identity, replay-safe registration, atomic selection, bounded selected-plus-rollback retention, and no product reader | ✓ | Medium |
| 4.97 | Registry-pinned native browse reader with exact file digest and inode verification, bounded read-only SQLite cache, selection-race rejection, bounded keyset pages, and no product caller | ✓ | Medium |
| 4.98 | Startup external migration bridge with revision-stable durable spool identity, disk-backed Automerge reconstruction, verified immutable SQLite publication, response-loss replay, two-generation retention, confirmed staging cleanup, exact rollback, and no product reader or authority cutover | ✓ | High |
| 4.99 | First Gate D Freed Desktop feed read from an exact source-fenced, registry-selected, bounded SQLite browse generation, with paged virtual-list loading, failure fallback, session cleanup, and a device-local rollback switch while Automerge remains authoritative | ✓ | High |
| 4.100 | Gate D browse materialization from the existing plain renderer snapshot with exact source-order patch maintenance, 128-row SQLite pages, source fencing, and no second full Automerge proxy traversal | ✓ | High |
| 4.101 | Dormant Google Drive immutable-object adapter with private flat-object identity, bounded multipart upload and readback, exact file-ID verification, and ETag control compare-and-swap | ✓ | High |
| 4.102 | Bounded adapter-neutral logical-checkpoint page importer with exact stored-byte verification, strict cross-page identity order, and resumable PWA IndexedDB feed projection | ✓ | High |
| 4.103 | Exact control-pointer binding to the verified checkpoint-manifest descriptor and provider object ID, constructed only after manifest upload and preserved through response-loss readback | ✓ | High |
| 4.104 | Closed exact checkpoint manifest with dataset, frontier, counts, identity ranges, immutable page receipts, manifest-derived PWA source identity, and bounded IndexedDB import | ✓ | High |

---

## Success Criteria

Items 4.62 through 4.82 record the isolated dormant boundary at which each
external decoder layer was first completed. Item 4.98 now composes those layers
into the production startup bridge. Their historical "dormant" wording does
not mean those internal stages remain unreachable.

- [x] Data persists in IndexedDB (both Desktop WebView and PWA use `@freed/sync` IndexedDBStorage)
- [x] Desktop hosts WebSocket relay on local network (Rust relay on port 8765)
- [x] PWA connects to local relay using binary Automerge protocol (fixed from JSON bug)
- [x] Desktop broadcasts doc changes to connected PWA clients via `broadcast_doc` Tauri command
- [x] QR code or manual pairing connects PWA to Desktop (SyncConnectDialog with QR scanner)
- [x] Sync connection status observable (`onStatusChange` listener in sync.ts)
- [x] PWA falls back to cloud sync when away from home (Google Drive PKCE OAuth, production callback relay for dev and preview app origins, local-change upload subscriptions, Automerge merge-upload)
- [x] Google Drive uses the server token proxy in Freed Desktop so the Google client secret stays out of the app bundle, watches appDataFolder changes, refreshes stored OAuth credentials before Drive or Contacts calls, and retries Contacts once after a 401 with a forced token refresh
- [x] Freed Desktop falls back to the production Google token proxy when the build omits `VITE_GDRIVE_TOKEN_PROXY_URL`, so local and dev builds do not silently use direct Google token exchange
- [x] Google Contacts token lookup and forced refresh failures remain recoverable in sync state instead of opening the fatal recovery screen, while corrupt or unsupported local sync ledgers preserve their raw evidence and block automatic provider requests until explicit repair
- [x] PWA and Desktop retry the initial Google Drive document download after a 401 token refresh before starting from a fresh Drive changes cursor, so existing remote libraries are not skipped after reconnect
- [x] PWA cloud sync waits for Automerge worker initialization before Drive downloads, merges, uploads, OAuth callback sync starts, or LAN relay resume can touch the local document
- [x] Google Drive upload returns the merged local plus remote Automerge binary to the uploading device, so a client that discovers remote changes during upload also converges locally
- [x] Desktop, PWA, and cloud upload merges block delete-heavy Automerge histories before they can replace a much larger document
- [x] Desktop Settings turns a blocked destructive cloud merge into explicit recovery actions: keep this device by replacing the cloud backup, or keep the cloud copy by replacing this device. Automatic cloud upload retries pause while the destructive conflict is unresolved, so the recovery card stays clickable until the user chooses a winner.
- [x] PWA and Desktop Settings show local item count, local document size, cloud stage, last download, last merge, last upload, remote bytes, uploaded bytes, and cloud errors
- [x] Desktop and PWA Settings explain why `Last upload` is blank, expose a manual Drive `Sync now` action, and show a recent cloud activity timeline for queued, started, deferred, completed, waiting, and failed sync work
- [x] Freed Desktop cloud sync attempts also feed the top-toolbar background activity monitor so Drive work appears beside provider syncs and runtime jobs with elapsed timers while using the existing sync cadence
- [x] Google Drive startup downloads and uploads wait behind runtime health, memory pressure, outbox, and social-scrape gates, then retry with bounded backoff instead of repeatedly copying the Automerge document while the app is under pressure
- [x] At least one cloud provider works: Google Drive is the active cloud sync provider while Dropbox remains disabled behind a coming-soon control
- [x] Desktop surfaces cloud sync health with retry/reconnect actions, recent failures, and debug charts
- [x] Desktop no-cloud-sync launch banner self-dismisses after 15 seconds with a gentle countdown ring
- [x] Desktop writes rotating local snapshots and can restore an older Automerge copy from Settings
- [x] Each Freed Desktop installation keeps its opaque identity locally, registers durable topology metadata after document initialization and merges, and warns in Sync setup when another Freed Desktop could duplicate RSS or authenticated provider requests. PWA readers do not count toward the warning.
- [x] The dormant Library Core census makes current synchronized fields, shared store surfaces, Desktop and PWA worker messages, planned operations and queries, and retained local authorities reviewable without changing the active Automerge writer or claiming Gate A activation
- [x] The dormant legacy epoch bootstrap contract closes the exact digest-addressed in-document record occurrence, complete bounded current and historical reserved-root scan with deleted-root rejection, source-descended prepared owner operation, local control, completion receipt, identity codecs, current-frontier tracking, creator and TOFU read-only adopter states, response-loss readback, partial-transaction rejection, conflict behavior, and the activation block on value-only Automerge history rebuilds without adding provider objects or requests, generating authority keys, writing storage, choosing a creator at startup, or activating Library Core
- [x] IndexedDB v2 preserves v1 Automerge bytes at revision zero, returns an exact generation and save revision with every load, rejects stale saves and clears through one atomic compare-and-swap, closes on version change, blocks unsafe upgrades, and exposes repeatable `saveSince` persistence that advances committed bytes and heads only after storage commit. Failed decodes retain the exact loaded revision, distinguish corruption from memory exhaustion, and cannot clear a newer concurrent save. Worker integration remains a separate activation step.
- [x] The dormant native SQLite projection engine compiles bundled SQLite into Freed Desktop, consumes one versioned canonical schema shared with the TypeScript contract, applies row upserts and deletions with one projection revision in one transaction, reopens committed disk rows, rejects stale page cursors and out-of-contract page sizes, pins its smallest memory tier, and serves the default feed through an index-backed keyset query. Feed pages expose only compact card fields, independently bound media and tag collections, omit full and preserved bodies plus unmodelled row data, and enforce both the registered 128-row ceiling and a 2 MiB serialized response ceiling without opening a production database or changing durable authority
- [x] Every dormant native SQLite projection batch binds one stable batch ID, canonical input digest, expected prior revision, and ceilings of 1,000 items and 4 MiB of projected input to rows, deletions, the next revision, and a durable derived receipt in one transaction. Exact retry after response loss returns the original receipt after process restart. Changed replay tuples, oversized batches, conflicting migrations, and partial receipt failures fail closed without advancing rows or revision. These receipts do not replace signed Library Core operation receipts or grant mutation authority
- [x] Shared TypeScript and native Rust construction encoders produce identical bounded RFC 8785 bytes and operation domain inputs for safe integers, UTF-16 object-key ordering, Unicode, nested arrays and objects, and registered fractional wrappers. They reject unsupported JavaScript values, non-plain or behavior-bearing objects, negative zero, fractions, unsafe integers, excessive bytes, more than 65,536 nodes, and more than 128 nesting levels. The construction path remains dark and cannot verify inbound bytes until a duplicate-preserving decoder and closed envelope validator land
- [x] Dormant operation finalization accepts only provenance-branded transaction assemblies, preflights the complete 4 MiB envelope budget before signing, signs the exact domain-separated signing-body digest input, accepts only lowercase 32-byte Ed25519 public-key and 64-byte signature encodings, and returns immutable envelopes only after every signature and envelope digest succeeds. It does not implement key storage, enrollment, inbound verification, journaling, materialization, replication, provider behavior, or runtime authority
- [x] Shared Web Crypto and native Rust verify the same bounded lowercase Ed25519 public keys, signatures, and immutable message snapshots against one checked-in RFC 8032 vector. The native path reuses the Ring dependency already present through TLS instead of adding a second Curve25519 implementation. Malformed encodings, invalid keys, altered messages, altered signatures, and oversized inputs fail closed. The verifier remains dark and does not generate or store keys, enroll actors, validate complete operation envelopes, persist data, contact providers, or grant runtime authority
- [x] Dormant operation verification accepts only a dense bounded complete set of duplicate-preserving canonical envelopes, reconstructs every closed member and aggregate transaction, requires exact actor, epoch, predecessor, sequence, transaction, payload, and actor-chain derivation against one immutable accepted actor tip, then verifies every Ed25519 actor signature before returning exact canonical journal text and derived digests. It does not prove causal-frontier tips against current storage, atomically recheck the actor tip, resolve retries or conflicts, persist, materialize, replicate, contact providers, or grant runtime writer authority
- [x] Dormant actor enrollment construction derives the public-key fingerprint, actor ID, and enrollment-body digest through the registered domain-separated inputs from one closed immutable body. It binds the exact library, epoch, authority key, installation incarnation, random actor nonce, Ed25519 public key, and sorted bounded observed frontier. Shared and native canonical encoders agree on the new actor-domain bytes. This slice does not generate keys, prove possession, sign or verify an enrollment certificate, enroll an actor, persist state, contact providers, or grant writer authority
- [x] Dormant actor enrollment certificate construction signs the exact enrollment-body digest as the actor possession proof, digests the closed certificate body, signs that digest through the authority domain, and derives the actor-chain genesis commitment from the certificate, actor, and epoch. Shared and native canonical encoders agree on all registered enrollment digest and signature prefixes. The constructor rejects malformed signer and digest results and returns one immutable all-or-nothing result, but it does not verify either signature, enroll an actor, read or mutate authority state, store keys, persist data, contact providers, or grant writer authority
- [x] Dormant actor enrollment verification accepts only duplicate-preserving canonical certificate bytes, recomputes the authority key ID, actor public-key fingerprint, actor ID, enrollment body and certificate digests, verifies actor possession before the active-authority signature, and requires exact library, epoch, epoch ID, authority key ID, schema, algorithm, and observed-frontier equality with accepted authority state. It returns one immutable verified certificate and actor-chain genesis commitment, but it does not commit enrollment, resolve idempotent retries or identity conflicts, allocate actor sequence, persist state, contact providers, or grant writer authority
- [x] The dormant authoritative SQLite kernel uses WAL with `synchronous=FULL`, a closed versioned STRICT schema, module-private commit inputs, exact actor-enrollment and transaction retry receipts, immutable enrollment-certificate retention, reference-only enrollment and operation replication outboxes that do not duplicate canonical payload bytes, contiguous per-operation ingest sequence, an inline materializer frontier, an epoch-scoped actor-tip compare-and-swap, causal-tip existence checks, the immutable operation journal, monotone earliest-read materialization, and projection revision in immediate transactions. Actor sequence can restart at one in a new epoch without colliding with the same stable actor's prior epoch. Exact retry after reopen returns the original ingest and projection receipt. Fault injection after actor-tip movement proves that a later metadata failure leaves no partial authority, journal, materialized field, receipt, ingest sequence, revision, outbox, or actor-tip movement. The module has no command registration or production opener, and native canonical plus signature verification must construct its sealed input before activation
- [x] The dormant native operation verifier parses the exact bounded duplicate-preserving canonical envelope bytes inside Rust, reconstructs every payload, member, transaction, claimed actor-chain, signing-body, and envelope digest against the immutable enrolled actor identity and public key, and verifies every Ed25519 signature before it can construct the journal's private commit input. The immediate authoritative commit returns an exact stored receipt for a verified response-loss retry, admits a fresh transaction only when its claimed predecessor matches the current actor tip, rejects every stale fork, and rechecks every exact causal tip. Neither the shared verifier nor renderer-supplied derived fields can grant commit authority, and no command, opener, provider behavior, or runtime activation exists
- [x] The dormant native enrollment verifier accepts only one bounded duplicate-preserving canonical certificate, recomputes authority-key, actor-key, actor-ID, enrollment-body, certificate, and chain-genesis digests, matches the exact private authority snapshot and observed frontier, verifies actor possession before the authority signature, and only then constructs the private SQLite enrollment input. Tests prove both signatures before actor and outbox persistence and prove tampering leaves both tables empty. No runtime-reachable verify-and-enroll path exists until the signed authority epoch is stored and rechecked inside the same enrollment transaction. No authority key generation, renderer command, active database opener, provider request, or writer activation was added
- [x] The dormant authoritative schema stores immutable accepted authority epochs and their exact ordered causal frontiers separately from one active-authority pointer. SQLite foreign keys bind actors to an exact stored authority epoch and transactions to an actor in that same epoch. Actor enrollment rechecks the complete accepted authority snapshot after beginning its immediate SQLite transaction, while ordinary operation commits recheck the exact active library, epoch, and epoch ID. A verified but uncommitted enrollment or operation from an epoch that changes before commit fails closed without an actor, outbox, operation, materialized row, receipt, or revision write. An exact retry of an enrollment that already committed returns the existing actor state without creating a second row, even after a later epoch advance. The only epoch installer remains test-only until the complete transition certificate verifier constructs its sealed input. No runtime authority, provider traffic, key generation, command registration, or production database opener was added
- [x] Shared TypeScript and native Rust canonical codecs register identical domain-separated inputs for the epoch-transition certificate digest, its applicable authority signature, and the target authority key-possession proof. Exact byte assertions pin all three prefixes across runtimes. This closes only the cryptographic input namespace. It does not construct or verify a transition body, accept an epoch, generate or store a key, mutate the authority pointer, contact a provider, or activate a writer
- [x] The dormant native authoritative journal reads pending enrollment and operation replication entries through keyset pages capped at 256 entries and 4 MiB of canonical payload. Operation pages advance by contiguous ingest sequence. Enrollment pages use an exact timestamp plus operation-ID cursor, so equal timestamps cannot skip actors. Both queries join their immutable canonical payload from the sole actor or operation row, and query-plan tests reject hidden temporary sorts. This adds no acknowledgment, deletion, network caller, provider request, runtime command, or active replication authority
- [x] Every dormant authoritative SQLite open compares the complete live non-internal table, index, trigger, and view catalog against a fresh reference generated from the checked-in v1 schema after confirming the physical version. A database with the correct `user_version` but a missing or unregistered object fails closed before commit. This catalog identity check does not replace future page-level integrity inspection, open a production database, register a command, contact a provider, or activate authority
- [x] The dormant authoritative SQLite schema writes the fixed `FREE` application identity into SQLite's header and every open verifies it alongside the physical schema version before accepting the exact live catalog. A wrong nonzero identity on an empty file and a missing or changed identity on a versioned file fail closed instead of being claimed as Library Core storage. This identity marker is not an integrity check, a production opener, a provider action, or runtime authority
- [x] Every dormant authoritative SQLite connection enables defensive mode, disables trusted-schema behavior, and enables `cell_size_check`. Dangerous configuration writes are rejected, schema text cannot invoke privileged application functions, and SQLite validates each B-tree cell when its page is read instead of waiting for a full database scan. This catches malformed cell structure on accessed pages with bounded incremental work. It does not claim that unread pages, cross-page relationships, or application semantics are healthy, and it does not add a startup scan, runtime opener, provider action, or writer authority
- [x] Every dormant authoritative SQLite file open treats the configured path literally and enables private-cache, extended-result-code, and `SQLITE_OPEN_NOFOLLOW` flags, so it cannot join a process-global shared cache and SQLite URI parameters or final-component symbolic links cannot redirect the accepted database. Parent-directory identity remains an explicit production-opener requirement. This adds no runtime opener, provider action, or writer authority
- [x] Every dormant authoritative SQLite connection lowers the engine's general-purpose run-time limits before compiling schema or query SQL. Strings and rows remain above the 4 MiB canonical payload ceiling while SQL text, columns, expression depth, compound selects, function arguments, attached databases, pattern bytes, variable indexes, trigger depth, and auxiliary worker threads are capped to the checked-in schema and fixed query surface. These limits bound parser and row allocations from malformed files or accidental future queries without replacing canonical payload validation, bounded result paging, database-size policy, a production file locator, provider controls, or activation authority
- [x] On macOS, every dormant authoritative SQLite connection pairs `synchronous=FULL` with `fullfsync=ON`, so successful journal commits and WAL checkpoints request `F_FULLFSYNC` instead of relying on ordinary `fsync` while the drive may still hold volatile or reordered writes. The later activation gate must measure the stronger barrier's commit latency on supported storage. This adds no runtime opener, provider action, or writer authority
- [x] Every dormant authoritative SQLite connection disables the legacy double-quoted string-literal fallback for schema and data statements. Checked-in SQL uses standard quoting, so a misspelled double-quoted identifier fails during statement preparation instead of silently becoming a string literal with different semantics. This adds no runtime opener, provider action, or writer authority
- [x] Before an existing dormant authoritative SQLite file receives writable access, a no-follow private-cache read-only preflight verifies its application identity, physical version, and exact live catalog. The exact read-write handle repeats that verification before receiving WAL or durability configuration, so foreign, future, unversioned, changed, and path-replaced files fail without changing their database bytes. SQLite may still create ephemeral coordination sidecars while reading a WAL-mode database. This does not replace the later authenticated storage-root handle and root-identity contract. It adds no runtime opener, provider action, or writer authority
- [x] The dormant Desktop Automerge worker can bind one derived-shadow projection probe to the exact durable document ID, sorted-head digest, head count, storage generation, and save revision, then return deterministic feed rows in batches capped at 1,000 rows and 4 MiB. The session retains at most 250,000 bounded entity IDs totaling at most 16 MiB plus one replayable batch, releases the decoded Automerge document whenever the worker queue drains, rechecks the complete source identity before every new batch, and invalidates on any document commit. This temporary compatibility probe still decodes the current Automerge document and therefore cannot satisfy the external-memory Gate C migration contract, produce an authoritative candidate, or authorize cutover. No main-thread adapter invokes it yet, and it does not open SQLite, contact a provider, or change the active Automerge writer
- [x] Native shadow schema version 3 binds one fresh staging database to the exact source document, head digest and count, storage generation, save revision, and declared row count. Every sequential rebuild batch commits rows, its derived projection receipt, batch mapping, revision, cumulative row count, and completion state atomically. Exact retry and process restart resume from durable state, partial generations reject all bounded reads, and the final batch closes only when declared, projected, and actual row counts agree. This does not atomically publish the file, activate a reader, change the Automerge writer, contact a provider, or satisfy the external-memory Gate C migration contract
- [x] The dormant native derived-shadow publisher accepts only one complete exact-source staging database and one unused same-directory destination. It checkpoints and removes WAL mode, runs SQLite `quick_check`, closes and syncs the staging bytes, publishes without any replace race, and reopens the destination read-only with no-follow semantics to recover the exact publication after response loss. Unix uses an exclusive hard-link publication point with parent-directory sync before and after removing the staging name. Windows uses a write-through no-replace move. It does not select the generation for a reader, authenticate the production storage root, remove abandoned files, activate SQLite, change the Automerge writer, or contact a provider
- [x] The dormant native projection-generation registry streams one SHA-256 identity from the exact sealed generation file, binds that content to the complete publication receipt, and registers it once with exact response-loss replay. Existing registries receive read-only page-integrity, foreign-key, application, version, and complete schema-catalog preflight before writable configuration. New registry creation syncs the parent directory. Reader selection and rollback reject malformed state, require an exact expected current generation, and commit the new current pointer, retained rollback pointer, monotone sequence, and deterministic transition receipt in one FULL-durability transaction. The registry has no production opener, reader adapter, cleanup authority, provider action, Automerge writer change, or activation path
- [x] The dormant native projection reader opens the registry twice through read-only no-follow handles, authenticates its complete identity and selected-generation row, rejects selection changes during open, and binds one session to the exact content-addressed file and transition sequence. It rejects symbolic generation roots, changed or replaced files, digest or byte-length mismatches, foreign-key damage, schema-catalog drift, incomplete rebuilds, and mismatched source or projection receipts before serving an existing row-, byte-, and cursor-bounded feed page. The exact generation file remains open for the reader lifetime so a later pathname replacement cannot retarget the session. No command, production locator, cleanup authority, Automerge writer change, provider action, or activation path exists
- [x] The dormant native projection coordinator composes exact rebuild resumption, bounded sequential batches, immutable publication, idempotent generation registration, atomic selection, and a generation-pinned bounded reader without adding another persistence contract. Exact batch replay returns the committed rebuild state, and exact finalization replay recovers from a missing staging pathname plus an authenticated immutable destination after response loss. A simultaneous staging and destination file fails closed as ambiguous. The coordinator has no command, production storage locator, cleanup authority, Automerge decoder, provider action, writer change, or activation path
- [x] Freed Desktop can debounce a settled Automerge revision, wait behind the shared renderer-health, memory-pressure, and active-background-work gate, pin its exact document, heads, and storage identity in the existing bounded worker probe, replay batches through one serialized native runtime, and select a complete content-addressed SQLite generation beneath one private application-data root. Process restart resumes the exact staging receipts or recognizes the already selected generation. Native admission recomputes the encoded byte ceiling instead of trusting renderer metadata. Empty libraries finalize without an invalid empty batch, changed batch replay fails closed, the prior generation remains the rollback pointer, and factory reset quiescence stops pending projection work before clearing storage without following a replacement link. This compatibility bridge writes only derived shadow data. Automerge remains the sole writer and renderer read source, and the external-memory Gate C decoder, bounded SQLite read cutover, renderer corpus eviction, release activation receipt, and installed memory proof remain pending.
- [x] Before Automerge initialization, the Desktop worker can hold one exact IndexedDB source revision and export it through independently transferred chunks capped at 1 MiB. The IndexedDB structured clone remains one source-sized allocation, but the storage adapter makes no second source-sized copy. Every begin replay, chunk read, and final confirmation rechecks the exact generation and save revision. A concurrent write invalidates the session, and an active export blocks Automerge initialization and every document mutation until explicit cancellation or quiescence releases the bytes. Exact chunk retry is offset-addressed and byte-identical. This transport does not decode Automerge, contact a provider, change the active writer, satisfy Gate C, or assign a product reader
- [x] The native migration spool binds one process-exclusive canonical staging pair to the exact source generation, save revision, and byte length. Unix requires a same-owner `0700` root and same-owner single-link `0600` no-follow files; Windows denies sharing and opens reparse points literally, while authenticated Windows root-ACL admission remains a production-locator requirement. Fixed chunks of at most 1 MiB reach durable data before their append-only receipt is synced. Exact retries verify both the receipt digest and durable bytes. Restart recovery ignores a partial journal tail, truncates unacknowledged data, revalidates every acknowledged chunk from disk, and streams the completed source through a 1 MiB digest buffer before finalizing. A second writer, symbolic links, non-private Unix roots or files, source changes, overlaps, gaps, changed retries, malformed journals, and premature finalization fail closed. The startup bridge now invokes this spool before native external decoding. It does not contact a provider, change the active writer, satisfy elected Gate C authority, or assign a product reader
- [x] The dormant native external decoder first proves the exact finalized source length and SHA-256, then scans concatenated Automerge 2.2 chunks with fixed buffers. It rejects invalid magic, unknown chunk types, noncanonical or overflowing ULEB128 lengths, truncation, checksum mismatches, deflate streams with trailing bytes, excessive chunk counts, and compressed changes above the admitted decoded-length ceiling. Plain chunks stream directly into their checksum. Compressed changes use two bounded passes so the uncompressed length precedes the body in Automerge's checksum without allocating that body. The decoder emits one deterministic JSONL descriptor at a time and writes a terminal summary only after the entire source verifies. It does not reconstruct changes or objects, populate SQLite, register a command, contact a provider, change the active writer, or activate Library Core
- [x] The dormant native document-layout decoder rechecks the complete immutable source and exact verified document descriptor, then scans actors, heads, change-column metadata, operation-column metadata, data ranges, and optional head indices without loading the chunk. Actor bytes, actor counts, heads, columns, and aggregate metadata are independently bounded. Canonical ULEB128 values, normalized column ordering, range arithmetic, exact suffix consumption, and source identity before and after output fail closed. It emits deterministic JSONL records with absolute source ranges so later bounded column decoders can resume without reparsing or retaining a complete directory. It does not decompress document columns, reconstruct changes or objects, populate SQLite, register a command, contact a provider, change the active writer, or activate Library Core
- [x] The dormant native primitive-column decoder verifies one immutable source before and after a bounded multi-column session, reads each exact absolute range through buffered plain bytes or raw-DEFLATE, and emits bounded deterministic JSONL tokens for unsigned, delta, boolean, and UTF-8 string columns. The two corpus-sized digest passes cover the complete session rather than multiplying by column count, and no output may publish unless final verification succeeds. Every run summary binds the exact byte length and SHA-256 of its begin and token prefix so a later join cannot accept altered scratch bytes. Signed and unsigned LEB128 values must be canonical. RLE run expansion, token count, decompressed bytes, individual strings, delta arithmetic, compressed input consumption, and source ranges are admitted before output can publish. Raw value columns remain blocked until their paired value-metadata stream is decoded. This layer does not join document columns into changes or operations, reconstruct objects, populate SQLite, register a command, contact a provider, change the active writer, or activate Library Core
- [x] The dormant native scalar-value joiner consumes only a complete source-bound value-metadata token run with a verified prefix receipt inside the same verified multi-column session, then streams its paired adjacent plain or raw-DEFLATE value column. Nulls, booleans, canonical unsigned and signed integers, counters, timestamps, exact little-endian float bits, UTF-8 strings, bytes, and unknown scalar types become deterministic JSONL descriptors. String, byte, and unknown payloads move into a separately hashed bounded spool instead of being retained or expanded into JSON. The complete begin-and-value prefix carries its own byte-length and SHA-256 receipt, and the shared reader verifies both that receipt and the exact payload spool before a higher join consumes either. Value counts, metadata records and lines, decoded raw bytes, strings, raw-column consumption, token order, scalar lengths, and numeric encodings fail closed. Empty payloads need no raw column. No output may publish before the enclosing final source verification succeeds. This layer does not join complete change or operation rows, reconstruct objects, populate SQLite, register a command, contact a provider, change the active writer, or activate Library Core
- [x] The dormant native change-row reconstructor joins source-bound actor, sequence, maximum-operation, timestamp, optional message, dependency, and extra-value token runs inside one verified source session. Mandatory row counts agree exactly. Actor indices, nonnegative sequences and operation maxima, signed timestamps, message bytes, per-row and total dependency counts, topological dependency indices, extra byte values, run sizes, and line sizes fail closed. Dependencies stream into a fixed-width little-endian spool with an exact digest instead of forming a resident graph. Scalar descriptors verify their complete token prefix and exact payload-spool bytes before use, and the deterministic row run carries its own prefix receipt. Every specification, type, compression bit, offset, and length now comes from the exact receipt-bound document-layout catalog instead of caller input. It does not reconstruct operation rows or objects, populate SQLite, register a command, contact a provider, change the active writer, or activate Library Core
- [x] The external document-layout run now carries an exact begin-through-index byte-length and SHA-256 receipt. Its bounded reader independently verifies source and chunk identity, every actor and head encoding, contiguous record indexes, normalized column metadata and source ranges, aggregate counts and bytes, the complete prefix receipt, and absence of trailing records before returning a provenance-branded catalog. Change-row reconstruction derives its complete required and optional column schema from that catalog, rejects unknown or ambiguous change columns, and no longer accepts caller-invented specifications, types, offsets, lengths, or compression flags. The catalog retains only explicitly bounded metadata and does not reconstruct operation rows or objects, populate SQLite, register a command, contact a provider, change the active writer, or activate Library Core
- [x] The dormant native operation-row reconstructor resolves both plain and deflated columns by normalized receipt-bound specification, then joins object IDs, string or sequence keys, operation IDs, insertion flags, actions, scalar descriptors, successor groups, expansion flags, and mark names inside one verified source session. Every operation ID, actor reference, object pair, key representation, action, value row, optional-column presence, row count, key length, mark-name length, successor count, and complete token-run receipt fails closed. It accepts a missing key-actor column only for the list or text HEAD sentinel, rejects positive element counters without an actor, and rejects explicitly encoded delete rows because Automerge document chunks represent delete IDs only through predecessor successor lists. Real map and list deletion fixtures prove those omitted IDs remain in the fixed-width successor spool. Successors remain strictly Lamport-sorted and stream into that spool with an exact digest. Large value payloads remain in their independently verified scalar spool and operation rows retain only bounded descriptors. This layer does not materialize objects, populate SQLite, register a command, contact a provider, change the active writer, or activate Library Core
- [x] The dormant native row-run readers verify the complete change or operation JSONL prefix and terminal receipt, exact source and actor catalog, contiguous row order, row and per-row limits, dependency or successor semantics, and every fixed-width and payload spool digest before the first row reaches a consumer. They then repeat the row pass and recheck companion spools before success, so an enclosing SQLite transaction can stage bounded rows and commit only after the exact run remains unchanged. Change receipts now bind the extra-value payload spool instead of leaving its row references unauthenticated. This layer does not materialize objects, populate SQLite, register a command, contact a provider, change the active writer, or activate Library Core
- [x] Each verified change or operation row can expose only its exact receipt-bound payload range through a fixed 64 KiB transfer buffer. Consumers cannot seek elsewhere in the spool or receive one source-sized allocation. The complete payload spool is rehashed after consumption, so an enclosing SQLite transaction commits only after every streamed byte still matches the original receipt. This layer does not interpret values, materialize objects, populate SQLite, register a command, contact a provider, change the active writer, or activate Library Core
- [x] The dormant SQLite stage pins the bounded actor and head catalog, then copies every verified Automerge change, operation, dependency, successor, scalar descriptor, and exact payload through private scratch transactions. Unsigned counters remain fixed-width sortable bytes, payloads stream into preallocated SQLite blobs, and each complete source and run receipt commits with its rows only after post-consumption verification succeeds. Foreign keys close every actor, dependency, object, and element-key reference. Successors resolve to either exact staged operations or reconstructed omitted-delete identities with one exact target, and the change receipt requires every head to resolve to a staged change. Change and operation receipts in one stage must bind the same exact source. The stage compares its exact schema catalog before reuse, returns an original receipt after response loss only while layout, receipted counts, and graph closure remain complete, and rejects changed sources, changed layout entries, mixed sources, changed summaries, missing or unreceipted rows, dangling references, schema drift, tampered companion spools, and injected mid-stage failure without committing partial state. It does not reconstruct objects, populate the published shadow generation, register a command, contact a provider, change the active writer, or activate Library Core
- [x] The dormant scratch graph seals only after actor and head indexes are dense, each actor's change sequence is contiguous, maximum operation counters never regress, and operation IDs cover one through the final maximum without gaps. Its canonical SHA-256 projection covers every source and row receipt, metadata row, relationship, and payload byte, with SQLite blobs streamed through a fixed 64 KiB buffer. Exact seal replay recomputes the projection and rejects same-count metadata or payload tampering, incomplete actor intervals, and receipt drift. The seal has no production opener, materializer, command, provider action, writer change, or activation path
- [x] The dormant external materializer selects every immutable current operation from the sealed scratch graph, preserves concurrent values, resolves counters without hiding their base value, reconstructs bounded map, list, and text topology, emits one lossless FeedItem document and row at a time, and copies receipt-pinned row pages into the existing resumable SQLite generation. Replay rechecks the source graph, reconstructed documents, projected rows, and destination row count before accepting prior work. The path retains no corpus-sized native value set, registers no production caller, assigns no reader, contacts no provider, changes no writer, and does not activate Library Core
- [x] The dormant `feed_page_v1` protocol closes one exact package-internal request, response, source identity, compact feed-card projection, nested collection bounds, and canonical opaque keyset cursor for the existing default SQLite feed page. Its fail-closed parsers reject accessors, decorated arrays, unsafe or negative numbers, invalid UTF-8 identities, oversized fields, stale source-bound cursors, and responses above 128 rows or 2 MiB while snapshotting every retained value and measuring serialized bytes one bounded row at a time. The query remains `planned_blocked` on PWA adapter proof, complete product semantics, renderer integration, and cross-platform runtime completion. It does not yet claim active product filters, recommendation-order compatibility, provider traffic, a reader cutover, or Library Core authority
- [x] The dormant Freed Desktop `feed_page_v1` runtime resolves only an already-created private shadow root, authenticates and physically pins the selected immutable generation, and serves the exact closed request and response without assigning a product caller. One shared pool admits at most two sessions, fixes each SQLite page cache at 2 MiB, expires snapshots after 60 seconds, and releases them on exact cancellation or cursor exhaustion. Canonical cursor bytes have one shared TypeScript and Rust vector. Cursor generation, transition, projection revision, order, operation identity, row count, and complete serialized response bounds fail closed. Filter and recommendation-order execution, the renderer cache, and product read cutover remain blocked, so Automerge stays authoritative and no provider behavior changes
- [x] The dormant PWA `feed_page_v1` runtime stores compact feed rows individually in IndexedDB and registers dedicated bounded materialization, read, cancellation, and response kinds in the existing Automerge worker transport. The worker derives generation identity only from the exact committed Automerge heads and storage revision. It scans one immutable item at a time, reproduces the native visibility and compact projection rules, and stages unsorted pages of at most 128 rows with SHA-256 replay receipts, unique generation-plus-entity identity, contiguous batch indexes, exact source identity, and durable row counts. IndexedDB's compound key provides final keyset order without a corpus-sized renderer sort. Final selection is one transaction and cannot expose an incomplete generation; restart resumes staged work, exact materialization and finalization replay are idempotent, and later selections retain at most one rollback generation. Reads share the closed TypeScript protocol, admit at most two 60-second logical sessions, reject expired or replaced cursors, bind exact cancellation identity, and release exhausted sessions. No product surface calls the materializer or reader, no authoritative operation is written, Automerge remains the PWA writer and renderer source, and provider behavior is unchanged
- [x] The current renderer and future bounded Library Core adapters share one allocation-free feed-filter predicate and one canonical normalized filter record. Exact strings remain byte-for-byte significant, set-like tags and signals are deduplicated and binary-sorted for stable cursor binding, and the contract pins hidden, archived, RSS identity, platform, author, feed URL, post/story, saved, tag, and content-signal behavior. The active renderer now normalizes once per browse pass instead of once per item. Native and IndexedDB filter and recommendation-order execution, bounded archived generations, renderer-cache eviction, and product caller proof remain pending, so this contract does not activate a Library Core reader
- [x] Both current Automerge workers use one canonical recommendation-order contract that preserves the existing stable published-time pass, stable priority pass, and source-map enumeration tie behavior. A deterministic corpus regression proves exact equivalence with the prior worker composition. Future bounded adapters must compute priority from one generation-bound clock, retain source enumeration sequence, execute the complete order in storage, and bind the order version and clock identity to their cursors. This semantic definition does not activate a Library Core reader
- [x] The dormant PWA `feed_browse_page_v1` reader consumes only the selected query-specific IndexedDB generation. Its closed request snapshots one bounded canonical filter, one ranking clock, and recommendation-order schema version. Its cursor binds the authenticated generation plus priority, published time, source sequence, and binary entity identity, so page boundaries reproduce the physical compound-key order without a renderer sort. It shares the two-session, 60-second, cancellation, exhaustion, and stale-selection lifecycle with the default reader and is registered in the existing worker transport. No product caller exists, Automerge remains authoritative, and native query execution is still required before cross-platform cutover
- [x] The dormant native browse store accepts one immutable generation bound to the declared source transition and projection revisions, canonical filter JSON, ranking clock, recommendation-order schema, and exact row count. Pages are capped at 128 rows and 2 MiB of compact-card input, receive SHA-256 replay receipts, and become readable only after both logical and physical row counts match. SQLite owns the complete priority, published-time, source-sequence, and binary-identity order through one checked index, and cursor reads prove that no temporary sort is introduced. The store rejects a foreign existing file through a read-only identity preflight before writable configuration, then uses a private no-follow connection, a 4 MiB page cache, disabled mmap, and file-backed temporary work. The later worker adapter must authenticate the source and validate the closed feed-card DTO. Automerge remains the sole product reader and writer
- [x] Freed Desktop exposes that store through a dormant session-bound writer transport. Begin, append, finalize, and cancel return exact durable progress, changed bindings and cross-session writes fail closed, exact retries recover after response loss, and factory reset quiesces the active connection before deleting derived files. The transport does not select a generation, serve a native browse reader, assign a product caller, contact a provider, or change authority. Automerge remains the sole product reader and writer
- [x] The dormant Freed Desktop browse materializer binds one worker session to the exact durable document ID, sorted-head digest and count, storage generation, save revision, normalized filter, safe ranking clock, and recommendation-order version, and the native SQLite generation stores that complete provenance instead of trusting an opaque generation digest alone. It counts through one iterator, retains a second iterator plus one replayable page instead of a corpus-sized ID or row array, validates every shared closed feed-card DTO, and emits at most 128 rows per page. The main-thread adapter replays pages from zero against native receipts after restart, recovers committed append and finalization responses without guessing, and quiesces before factory reset. No selected-generation registry, native browse reader, renderer caller, provider action, or authority change exists. Automerge remains the sole product reader and writer
- [x] A completed native browse generation now checkpoints every WAL frame, transitions the database to DELETE journal mode, verifies SQLite integrity, closes and flushes the file, rejects surviving WAL or shared-memory sidecars, and returns a stable SHA-256 plus byte-length receipt from a no-follow file handle whose identity is checked before and after hashing. Exact completed replay inspects and digests that sealed file read-only without reopening writable SQLite or changing its bytes. A lost response between logical completion and physical sealing resumes the seal safely. Selection, native reading, product callers, provider traffic, and authority remain absent
- [x] The native browse registry accepts only a sealed generation whose logical source, filter, ranking clock, recommendation-order version, row count, physical SHA-256, byte length, and file name match a fresh read-only inspection. Registration is idempotent only for the complete identical receipt and rejects changed logical or physical identity. One immediate SQLite transaction selects the current generation, retains exactly one rollback generation, records a request-digest-bound transition receipt, rejects stale expected state, and replays a lost response without advancing twice. The startup migration reaches the registry through the private shadow runtime, which prunes every generation except the selected and exact rollback files plus the latest replayable derived transition. The registry has a distinct schema identity and exact catalog check, never blesses an existing foreign or empty file, and exposes no direct Tauri command, product reader, provider action, writer change, or Library Core activation
- [x] A dormant native browse reader now authenticates the exact selected registry row, canonical generation root, regular-file identity, byte length, physical SHA-256, sealed SQLite binding, complete row count, DELETE journal state, and absent sidecars before serving the existing bounded keyset page contract. It holds the exact file inode and read-only SQLite connection for the reader lifetime, uses a 2 MiB private cache with mmap disabled and file-backed temporary storage, and rereads the registry after opening so a concurrent selection cannot create a mixed-generation session. New readers observe an exact rollback selection. No Tauri command, renderer caller, provider action, writer change, or Library Core activation exists
- [x] Freed Desktop now attempts one startup migration before Automerge decoding. It resumes the native spool by the exact legacy storage generation, save revision, and byte length, validates every 1 MiB transfer receipt, reconstructs the source through disk-backed native stages, and publishes or replays one verified immutable SQLite generation. A failure releases live worker and native handles, preserves durable retry evidence, records rollback telemetry, and continues with Automerge as the sole authority and product reader. Once native publication and worker confirmation both succeed, an idempotent completion step removes that revision's spool and scratch graph. Interrupted cleanup starts from a clean copy without trusting a one-file tail. Generation selection retains only the selected and exact rollback files plus the latest replayable derived transition. Factory reset refuses to race an active migration and clears only quiescent migration files. The local rollback switch disables the attempt without deleting either the Automerge source or a prior verified generation. Because IndexedDB still returns one source-sized structured clone and every product reader still uses Automerge, this is a production-derived shadow bridge rather than Gate C or Gate D activation
- [x] The Freed Desktop all-content feed now opens one source-fenced query-specific SQLite generation when search, Friends-only filtering, and saved-content sorting are inactive. The worker exposes only its exact durable document, heads, generation, and save revision for the source comparison. Native selection authenticates the sealed generation and the product session pages at most 128 compact cards at a time through a 2 MiB read cache. Source movement before or after selection, projection failure, page failure, session replacement, unmount, an empty nonterminal page, and growth beyond the temporary 512-card React window all close the native reader and return the view to the existing Automerge path. The virtual list requests another page only near its tail. The device-local `freed.libraryCore.feedBrowseReaderV1.disabled=1` switch rejects before projection work and is the immediate rollback. This append-only Gate D declaration does not make SQLite authoritative, remove the full Automerge renderer corpus, supply reverse paging, convert search, Friends, PWA, content detail, provider action derivation, export, backup, diagnostics, or sync readers, or claim the final memory reduction
- [x] Gate D browse generation now reuses the exact plain `DocState` snapshot already required by the legacy renderer instead of traversing the Automerge proxy map again. The state carries the exact source-map enumeration independently from its ranked visible items, and patch responses identify additions and removals so that tie-break order remains exact without a corpus rescan. One immutable state and source revision feed replayable pages capped at 128 rows; any movement fails closed. This removes the observed duplicate multi-gigabyte projection pass, but the initial full renderer hydration and native decoding of append-style legacy change chunks remain pending before Gate C and complete Gate D can be claimed
- [x] The dormant replacement-replication foundation now closes one flat package-internal object namespace for epoch and enrollment JSON, operation segments, checkpoint manifests and logical pages, search manifests, shards and deltas, PWA intent and result segments, blobs, and backup manifests. Mutable control, intent-head, and result-head names are explicit and cannot pass immutable-object validation. Active sync has no SQLite checkpoint object. Its control pointer permits exactly one non-expiring writer epoch and one active Google Drive or future Dropbox transport, binds the manifest to the exact library, epoch, and generation, and rejects live SQLite artifacts, nested paths, heartbeat, expiry, dual authority, and unknown transports. It performs no cloud I/O, changes no Google request cadence, grants no PWA canonical authority, and leaves Automerge as replication authority
- [x] The dormant replacement-replication publication coordinator streams at most 4,096 staged dependency descriptors through one injected transport adapter, requires exact remote digest and size verification before manifest construction, provides verified provider object IDs to that construction, verifies the manifest, and compare-and-swaps one canonical control pointer against the exact starting revision and tuple. A stale preflight performs no upload, a final race returns the exact current tuple, and response loss succeeds only after exact pointer readback. Control records are capped at 64 KiB and ordinary publication cannot change the writer epoch or active transport. No Google or Dropbox adapter, credential, request, cadence change, writer activation, provider action, or Automerge authority change is present
- [x] The replacement wire-object codec uses a versioned family frame of length-prefixed canonical UTF-8 JSON records followed by gzip. It caps one record at 1 MiB, one frame at 4,096 records and 32 MiB decoded, and one stored object below 5 MB. Construction and incremental receipt reject future versions, wrong families, reserved bits, truncation, trailing bytes, count drift, oversize records, noncanonical JSON, and duplicate identities. Flat locators use `.json`, `.fseg.gz`, `.fpage.gz`, and `.fidx.gz`; SHA-256 binds exact stored bytes. No CBOR or live SQLite file enters active replication
- [x] The dormant one-button writer-reassignment transaction starts from one exact existing control revision and pointer, requires a new writer identity and storage epoch plus an exact library-and-epoch-bound immutable certificate, verifies every staged object, preserves the active transport and exact causal frontier, and compare-and-swaps generation zero of the new epoch as the sole authority commit. Stale preflight uploads nothing, a lost race returns the actual current tuple, certificate or frontier mismatch cannot publish authority, and response loss recovers only from exact readback. It has no Google or Dropbox adapter, product caller, provider action, heartbeat, lease, old-computer ceremony, automatic failover, or Automerge authority change
- [x] The dormant Google Drive Library Core adapter discovers one existing control by private protocol, library-digest, and object-kind properties, rejects duplicate controls, and never uses filenames as authority. It publishes ordinary immutable objects below 5 MB with one multipart upload, verifies exact file ID, metadata, bounded byte length, and SHA-256 by readback, collapses exact retries only after every matching object verifies, conditionally updates control with the exact Drive ETag, and classifies `412` as a race with exact current readback. Control bootstrap, resumable media blobs, OAuth acquisition, scheduling, product callers, request-cadence changes, writer activation, provider actions, and Automerge authority changes remain absent
- [x] The dormant logical-checkpoint importer reads each immutable page through its exact provider object ID, rechecks the descriptor's library, epoch, generation, page index, stored byte length, and SHA-256, then incrementally decompresses and parses no more than 128 canonical records or 2 MiB per page. Page indexes and record identities must be strictly ordered across the complete declared count, so duplicate, missing, corrupt, reordered, oversized, truncated, or cross-generation pages fail closed while retaining only one page and one prior identity. The PWA bridge feeds verified compact-card projections into the existing resumable IndexedDB generation writer and selects only after every page commits. A completed generation performs no download. This is a disposable reader projection, not the complete logical checkpoint schema, a product caller, provider traffic, writer authority, or Automerge retirement
- [x] The dormant control pointer now binds the checkpoint manifest's exact verified descriptor and provider object ID. Publication can construct that pointer only from the manifest upload receipt after exact remote verification, rejects a substituted transport locator, and includes the locator in canonical response-loss readback equality. This closes the authority gap between a content digest and the exact immutable provider object without adding cloud traffic, a product caller, writer activation, or Automerge retirement
- [x] The dormant checkpoint consumer now authenticates one exact canonical manifest receipt before any page can reach IndexedDB. The closed manifest binds its library, epoch, generation, causal frontier, registered feed-card projection schema, complete record count, contiguous page indexes, per-page counts, binary identity ranges, immutable descriptors, and exact provider object IDs. Each downloaded page must match that declaration after stored-byte verification and bounded canonical decoding. The PWA derives its generation source from the exact manifest stored-byte digest, manifest generation, and schema version, so callers cannot reattribute verified rows. A completed generation still authenticates the manifest but downloads no pages. The current dataset remains a disposable feed-card projection, not a complete portable authoritative checkpoint, product caller, provider request, writer activation, or Automerge retirement
- [ ] iCloud sync integration
- [ ] Large media packages transfer outside Automerge through an authenticated,
      resumable, integrity-checked path with explicit storage and deletion rules

---

## Dependencies

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

---

## Implemented: Pairing Token Authentication

**Status: ✅ Complete** (branch `feat/secure-pairing-token`)

The relay validates the pairing token on every WebSocket upgrade request using `accept_hdr_async`. Invalid, missing, or reset-stale tokens receive HTTP 401 before any document data is exchanged. An in-process connection generation also rejects sockets that authenticated before a factory reset.

Key files:
- `packages/desktop/src-tauri/src/lib.rs` — token generation, persistence, relay auth gate
- `packages/desktop/src/components/MobileSyncTab.tsx` — local QR render, Reset Pairing button
- `packages/pwa/src/components/SyncConnectDialog.tsx` — token presence validation before connect

---

## Optional Enhancement: Client-Side Encryption

For privacy-conscious users (journalists, activists, researchers). **Not required for v1.**

**Rationale for making it optional:**

- Most synced content is publicly available (tweets, RSS)
- Cloud providers already encrypt at rest
- Key management adds UX complexity (lose passphrase = lose data)
- The paranoid users who need it will find the setting

**Implementation (future):**

```typescript
// packages/sync/src/encryption.ts
import { scrypt } from "@noble/hashes/scrypt";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";

interface EncryptionConfig {
  enabled: boolean;
  // Derived from user passphrase, never stored
  key?: Uint8Array;
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  return scrypt(passphrase, salt, { N: 2 ** 17, r: 8, p: 1, dkLen: 32 });
}

export function encryptDoc(data: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const cipher = xchacha20poly1305(key, nonce);
  const encrypted = cipher.encrypt(data);
  // Prepend nonce to ciphertext
  return new Uint8Array([...nonce, ...encrypted]);
}

export function decryptDoc(data: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = data.slice(0, 24);
  const ciphertext = data.slice(24);
  const cipher = xchacha20poly1305(key, nonce);
  return cipher.decrypt(ciphertext);
}
```

**User flow:**

1. User enables encryption in settings
2. User enters passphrase (we derive key, discard passphrase)
3. All cloud syncs encrypt before upload, decrypt after download
4. Local relay sync remains unencrypted (same network = trusted)

**If passphrase lost:** Data unrecoverable. Cloud backup becomes useless. User must start fresh.
