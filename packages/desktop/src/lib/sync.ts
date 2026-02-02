/**
 * Sync client for Automerge document synchronization
 *
 * Desktop hosts a WebSocket server, PWA connects to it.
 * Uses simple document broadcast for sync.
 */

import { getDocBinary, mergeDoc } from "./automerge";
import { useAppStore } from "./store";

// Sync message types
type SyncMessageType = "doc" | "request" | "ping" | "pong";

interface SyncMessage {
  type: SyncMessageType;
  payload?: string; // Base64 encoded for doc messages
}

// Singleton WebSocket connection (client mode - for PWA)
let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let isConnected = false;

// Server mode state
let serverPort = 8765;
let serverStarted = false;

/**
 * Get local IP addresses for QR code display
 */
export function getLocalIPs(): string[] {
  // This would need to be implemented via Tauri command
  // For now, return localhost
  return ["127.0.0.1"];
}

/**
 * Get connection URL for QR code
 */
export function getConnectionUrl(): string {
  const ip = getLocalIPs()[0] || "localhost";
  return `ws://${ip}:${serverPort}`;
}

/**
 * Encode document for transmission
 */
function encodeDoc(data: Uint8Array): string {
  // Convert to base64
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
 * Send a message (client mode only)
 */
function send(message: SyncMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Broadcast current document to all peers
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
 * Connect to sync relay (client mode - for PWA)
 */
export function connect(url: string): void {
  if (ws) {
    ws.close();
  }

  console.log(`[Sync] Connecting to ${url}...`);
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("[Sync] Connected to relay");
    isConnected = true;
    useAppStore.getState().setSyncing(false);

    // Request current document from peers
    send({ type: "request" });
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

    // Reconnect after delay
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (!isConnected) {
        connect(url);
      }
    }, 5000);
  };

  ws.onerror = (error) => {
    console.error("[Sync] WebSocket error:", error);
  };
}

/**
 * Disconnect from sync relay
 */
export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  isConnected = false;
}

/**
 * Check if connected to relay
 */
export function isRelayConnected(): boolean {
  return isConnected;
}

/**
 * Get sync status
 */
export function getSyncStatus(): {
  connected: boolean;
  serverRunning: boolean;
  port: number;
} {
  return {
    connected: isConnected,
    serverRunning: serverStarted,
    port: serverPort,
  };
}

// For desktop: We'll need to start the relay server via Tauri
// This is a placeholder - actual implementation would use Tauri shell to run the Node server
export function setServerStarted(started: boolean, port = 8765): void {
  serverStarted = started;
  serverPort = port;
}
