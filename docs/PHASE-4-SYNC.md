# Phase 4: Sync Layer

> **Status:** 🚧 In Progress
> **Dependencies:** Phase 1-2 (Capture layers ✓)
>
> Local relay, Google Drive cloud sync, desktop local snapshot rotation, "Sync Now" button, "Last synced" indicator, proxied Google token exchange for Freed Desktop with a built-in production proxy default, durable Google OAuth refresh, recoverable Google Contacts token-refresh failures, a production callback relay for dev and preview PWA Google OAuth, appDataFolder Drive polling, cloud sync health diagnostics, visible Drive transfer diagnostics in Settings, manual Drive sync from Desktop and PWA Settings, cloud sync activity timelines, global background activity visibility for Desktop cloud work, initial Drive download auth-refresh recovery, merged-upload local convergence, destructive Automerge merge blocking, pinned explicit local wins and cloud wins recovery actions, PWA local-change cloud uploads, PWA document-init-gated cloud startup, runtime-gated cloud upload waits, mobile-safe Drive upload bodies, the multi-Desktop request warning, the no-cloud-sync launch banner, revision-fenced IndexedDB v2 persistence, stale worker retirement, and a dormant revision-fenced native SQLite projection engine with crash-safe derived batch receipts are implemented. The SQLite engine remains dark and does not change the active Automerge writer or satisfy Gate B by itself. Dropbox remains behind a coming-soon gate while its provider work is finished. iCloud is the remaining core document-sync item. Large offline media uses a separate future transport plan.

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
| 4.23 | Dormant native SQLite projection engine with one canonical schema, atomic revisioned batches, and bounded keyset pages | ✓ | Medium |
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

---

## Success Criteria

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
- [x] The dormant native SQLite projection engine compiles bundled SQLite into Freed Desktop, consumes one versioned canonical schema shared with the TypeScript contract, applies row upserts and deletions with one projection revision in one transaction, reopens committed disk rows, rejects stale page cursors and out-of-contract page sizes, pins its smallest memory tier, and serves the default feed through an index-backed bounded keyset query without opening a production database or changing durable authority
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
