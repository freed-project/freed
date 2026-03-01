/**
 * Sync client for PWA
 *
 * Connects to desktop's WebSocket relay for Automerge document sync.
 * The relay speaks raw binary (Automerge doc bytes) — no JSON envelope.
 */

import { getDocBinary, mergeDoc } from "./automerge";

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
 * Broadcast current document to relay as raw binary
 */
export function broadcastDoc(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const doc = getDocBinary();
    ws.send(doc);
    console.log("[Sync] Broadcast document (%d bytes)", doc.byteLength);
  } catch (error) {
    console.error("[Sync] Failed to broadcast:", error);
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
