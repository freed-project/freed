# Phase 4: Sync Layer

> **Status:** 🚧 In Progress
> **Dependencies:** Phase 1-2 (Capture layers ✓)
>
> Local relay and GDrive/Dropbox cloud sync are working. iCloud sync and several secondary features are not yet complete.

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
| 4.7  | Google Drive sync integration         | ✓      | Medium     |
| 4.8  | Dropbox sync integration              | ✓      | Low        |
| 4.9  | iCloud sync integration               | ☐      | High       |
| 4.10 | Sync status observable                | ✓      | Low        |
| 4.11 | "Last synced" UI indicator            | ☐      | Low        |
| 4.12 | Manual "Sync now" button              | ☐      | Low        |

---

## Success Criteria

- [x] Data persists in IndexedDB (both Desktop WebView and PWA use `@freed/sync` IndexedDBStorage)
- [x] Desktop hosts WebSocket relay on local network (Rust relay on port 8765)
- [x] PWA connects to local relay using binary Automerge protocol (fixed from JSON bug)
- [x] Desktop broadcasts doc changes to connected PWA clients via `broadcast_doc` Tauri command
- [x] QR code or manual pairing connects PWA to Desktop (SyncConnectDialog with QR scanner)
- [x] Sync connection status observable (`onStatusChange` listener in sync.ts)
- [x] PWA falls back to cloud sync when away from home (GDrive + Dropbox PKCE OAuth, Automerge merge-upload)
- [x] At least one cloud provider works — GDrive and Dropbox both confirmed working on app.freed.wtf
- [ ] iCloud sync integration
- [ ] "Last synced" UI indicator
- [ ] Manual "Sync now" button

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

The relay validates a `?t=<base64url>` token on every WebSocket upgrade request using `accept_hdr_async`. Invalid or missing tokens receive HTTP 401 before any document data is exchanged.

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
