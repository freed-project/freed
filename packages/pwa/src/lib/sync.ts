/**
 * Sync client for PWA
 *
 * Connects to desktop's WebSocket relay for Automerge document sync.
 */

import { getDocBinary, mergeDoc } from "./automerge";

// Sync message types
type SyncMessageType = "doc" | "request" | "ping" | "pong";

interface SyncMessage {
  type: SyncMessageType;
  payload?: string; // Base64 encoded for doc messages
}

// Connection state
let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let isConnected = false;
let currentUrl: string | null = null;

// Status listeners
type StatusListener = (connected: boolean) => void;
const statusListeners = new Set<StatusListener>();

/**
 * Encode document for transmission
 */
function encodeDoc(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

/**
 * Decode document from transmission
 */
function decodeDoc(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Handle incoming sync message
 */
async function handleMessage(message: SyncMessage): Promise<void> {
  switch (message.type) {
    case "doc":
      if (message.payload) {
        const doc = decodeDoc(message.payload);
        await mergeDoc(doc);
        console.log("[Sync] Received and merged document");
      }
      break;

    case "request":
      // Send our current document
      broadcastDoc();
      break;

    case "ping":
      // Respond with pong
      send({ type: "pong" });
      break;

    case "pong":
      // Connection is alive
      break;
  }
}

/**
 * Send a message
 */
function send(message: SyncMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Broadcast current document to peers
 */
export function broadcastDoc(): void {
  try {
    const doc = getDocBinary();
    const message: SyncMessage = {
      type: "doc",
      payload: encodeDoc(doc),
    };
    send(message);
    console.log("[Sync] Broadcast document");
  } catch (error) {
    console.error("[Sync] Failed to broadcast:", error);
  }
}

/**
 * Notify status listeners
 */
function notifyStatus(): void {
  for (const listener of statusListeners) {
    listener(isConnected);
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

    ws.onopen = () => {
      console.log("[Sync] Connected to relay");
      isConnected = true;
      notifyStatus();

      // Request current document from peers
      send({ type: "request" });

      // Send our document too
      setTimeout(() => broadcastDoc(), 500);
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data) as SyncMessage;
        await handleMessage(message);
      } catch (error) {
        console.error("[Sync] Failed to handle message:", error);
      }
    };

    ws.onclose = () => {
      console.log("[Sync] Disconnected from relay");
      isConnected = false;
      ws = null;
      notifyStatus();

      // Reconnect after delay
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
