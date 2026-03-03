/**
 * Sync client for PWA
 *
 * Two independent sync modes:
 *   1. LAN WebSocket relay — instant (<100ms), same network only.
 *   2. Cloud file sync (GDrive or Dropbox) — ~2–9s, any network.
 *
 * Both modes run simultaneously when configured. Automerge CRDT handles
 * any divergence; no conflict logic is needed at this layer.
 *
 * Cloud uploads are debounced and always use a download→merge→upload cycle
 * protected by optimistic locking — see cloudSync.ts for details.
 */

import { getDocBinary, mergeDoc } from "./automerge";
import {
  gdriveUploadSafe,
  gdriveStartPollLoop,
  gdriveDownloadLatest,
  dropboxUploadSafe,
  dropboxStartLongpollLoop,
  dropboxDownloadLatest,
  type CloudProvider,
} from "./cloudSync";

// Connection state
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isConnected = false;
let currentUrl: string | null = null;

// Status listeners
type StatusListener = (connected: boolean) => void;
const statusListeners = new Set<StatusListener>();

/**
 * Notify status listeners
 */
function notifyStatus(): void {
  for (const listener of statusListeners) {
    listener(isConnected);
  }
}

/**
 * Broadcast current document to the LAN relay and schedule a cloud backup.
 * Both sync channels fire from the same trigger so they stay in lockstep.
 */
export function broadcastDoc(): void {
  // LAN relay broadcast.
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      const doc = getDocBinary();
      ws.send(doc);
      console.log("[Sync] Broadcast document (%d bytes)", doc.byteLength);
    } catch (error) {
      console.error("[Sync] Failed to broadcast:", error);
    }
  }

  // Cloud backup — debounced to batch rapid changes.
  const provider = getCloudProvider();
  if (provider) {
    const token = getCloudToken(provider);
    if (token) scheduleCloudUpload(provider, token);
  }
}

/**
 * Connect to sync relay
 */
export function connect(url: string): void {
  if (ws) {
    ws.close();
  }

  currentUrl = url;
  console.log(`[Sync] Connecting to ${url}...`);

  try {
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer"; // Receive binary as ArrayBuffer

    ws.onopen = () => {
      console.log("[Sync] Connected to relay");
      isConnected = true;
      notifyStatus();

      // Send our current doc so the relay stores it and can serve new clients
      setTimeout(() => broadcastDoc(), 100);
    };

    ws.onmessage = async (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      if (bytes.length === 0) return;

      try {
        await mergeDoc(bytes);
        console.log("[Sync] Received and merged document (%d bytes)", bytes.length);
      } catch (error) {
        console.error("[Sync] Failed to merge doc:", error);
      }
    };

    ws.onclose = () => {
      console.log("[Sync] Disconnected from relay");
      isConnected = false;
      ws = null;
      notifyStatus();

      // Auto-reconnect after delay
      if (currentUrl && reconnectTimer === null) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (currentUrl && !isConnected) {
            connect(currentUrl);
          }
        }, 5000);
      }
    };

    ws.onerror = (error) => {
      console.error("[Sync] WebSocket error:", error);
    };
  } catch (error) {
    console.error("[Sync] Failed to connect:", error);
  }
}

/**
 * Disconnect from sync relay
 */
export function disconnect(): void {
  currentUrl = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  isConnected = false;
  notifyStatus();
}

/**
 * Check if connected to relay
 */
export function isRelayConnected(): boolean {
  return isConnected;
}

/**
 * Subscribe to connection status changes
 */
export function onStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/**
 * Get stored relay URL from localStorage
 */
export function getStoredRelayUrl(): string | null {
  return localStorage.getItem("freed_relay_url");
}

/**
 * Store relay URL to localStorage
 */
export function storeRelayUrl(url: string): void {
  localStorage.setItem("freed_relay_url", url);
}

/**
 * Clear stored relay URL
 */
export function clearStoredRelayUrl(): void {
  localStorage.removeItem("freed_relay_url");
}

// ─── Cloud sync ───────────────────────────────────────────────────────────────

export type { CloudProvider };

const CLOUD_TOKEN_KEY = (provider: CloudProvider) => `freed_cloud_token_${provider}`;
const CLOUD_PROVIDER_KEY = "freed_cloud_provider";
const UPLOAD_DEBOUNCE_MS = 2_000;

let cloudAbort: AbortController | null = null;
let uploadTimer: ReturnType<typeof setTimeout> | null = null;

/** Persist the OAuth token for a cloud provider. */
export function storeCloudToken(provider: CloudProvider, token: string): void {
  localStorage.setItem(CLOUD_TOKEN_KEY(provider), token);
  localStorage.setItem(CLOUD_PROVIDER_KEY, provider);
}

/** Retrieve the stored OAuth token for a cloud provider. */
export function getCloudToken(provider: CloudProvider): string | null {
  return localStorage.getItem(CLOUD_TOKEN_KEY(provider));
}

/** Return the configured cloud provider, if any. */
export function getCloudProvider(): CloudProvider | null {
  return localStorage.getItem(CLOUD_PROVIDER_KEY) as CloudProvider | null;
}

/** Clear cloud credentials (e.g. on sign-out or re-pair). */
export function clearCloudSync(provider: CloudProvider): void {
  localStorage.removeItem(CLOUD_TOKEN_KEY(provider));
  localStorage.removeItem(CLOUD_PROVIDER_KEY);
  stopCloudSync();
}

/**
 * Start the cloud sync loop for the given provider.
 * On start, immediately download the latest remote state and merge it so the
 * PWA is up-to-date before the user sees content ("just returned from a trip").
 */
export async function startCloudSync(provider: CloudProvider, token: string): Promise<void> {
  stopCloudSync();
  cloudAbort = new AbortController();
  const { signal } = cloudAbort;

  // Pull latest remote state immediately on connect. The AbortSignal is passed
  // through so stopCloudSync() cancels any in-flight fetch rather than orphaning it.
  try {
    const downloadFn =
      provider === "gdrive" ? gdriveDownloadLatest : dropboxDownloadLatest;
    const remote = await downloadFn(token, signal);
    if (remote) {
      await mergeDoc(remote);
      console.log("[CloudSync] Initial merge on connect (%d bytes)", remote.length);
    }
  } catch (err) {
    if (!signal.aborted) console.error("[CloudSync] Initial download failed:", err);
  }

  const onRemoteChange = async (binary: Uint8Array) => {
    try {
      await mergeDoc(binary);
      console.log("[CloudSync] Merged remote change (%d bytes)", binary.length);
    } catch (err) {
      console.error("[CloudSync] Failed to merge remote change:", err);
    }
  };

  if (provider === "gdrive") {
    gdriveStartPollLoop(token, onRemoteChange, signal).catch((err) => {
      if (!signal.aborted) console.error("[CloudSync/GDrive] Poll loop crashed:", err);
    });
  } else {
    dropboxStartLongpollLoop(token, onRemoteChange, signal).catch((err) => {
      if (!signal.aborted) console.error("[CloudSync/Dropbox] Longpoll loop crashed:", err);
    });
  }

  console.log("[CloudSync] Started (%s)", provider);
}

/** Stop the active cloud sync loop and cancel any pending upload. */
export function stopCloudSync(): void {
  cloudAbort?.abort();
  cloudAbort = null;
  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = null;
  }
}

/**
 * Schedule a debounced cloud upload.
 * Called from broadcastDoc() so every local change triggers a cloud backup.
 * The upload is debounced to batch rapid changes into a single network round-trip.
 */
export function scheduleCloudUpload(provider: CloudProvider, token: string): void {
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = setTimeout(async () => {
    uploadTimer = null;
    const binary = getDocBinary();
    try {
      if (provider === "gdrive") {
        await gdriveUploadSafe(token, binary);
      } else {
        await dropboxUploadSafe(token, binary);
      }
      console.log("[CloudSync] Uploaded (%d bytes)", binary.byteLength);
    } catch (err) {
      console.error("[CloudSync] Upload failed:", err);
    }
  }, UPLOAD_DEBOUNCE_MS);
}
