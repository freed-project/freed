/**
 * Sync Server Controller for FREED Desktop
 *
 * Desktop runs a WebSocket relay server via Tauri (Rust backend).
 * This module provides TypeScript interface to control and monitor it.
 * PWAs connect to this server to sync their Automerge documents.
 */

import { invoke } from "@tauri-apps/api/core";
import { getDocBinary, subscribe } from "./automerge";

// Sync status
let isServerRunning = false;
let clientCount = 0;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let changeUnsubscribe: (() => void) | null = null;

// Status callbacks
type StatusCallback = (status: SyncStatus) => void;
const statusCallbacks = new Set<StatusCallback>();

export interface SyncStatus {
  serverRunning: boolean;
  clientCount: number;
  syncUrl: string;
}

/**
 * Get the local IP address
 */
export async function getLocalIP(): Promise<string> {
  try {
    return await invoke<string>("get_local_ip");
  } catch {
    return "localhost";
  }
}

/**
 * Get the sync relay URL for PWA to connect to
 */
export async function getSyncUrl(): Promise<string> {
  try {
    return await invoke<string>("get_sync_url");
  } catch {
    const ip = await getLocalIP();
    return `ws://${ip}:8765`;
  }
}

/**
 * Get number of connected sync clients
 */
export async function getClientCount(): Promise<number> {
  try {
    return await invoke<number>("get_sync_client_count");
  } catch {
    return 0;
  }
}

/**
 * Broadcast document to all connected clients
 */
export async function broadcastDoc(): Promise<void> {
  try {
    const docBytes = getDocBinary();
    // Convert Uint8Array to regular array for Tauri serialization
    await invoke("broadcast_doc", { docBytes: Array.from(docBytes) });
    console.log("[Sync] Broadcast document:", docBytes.length, "bytes");
  } catch (error) {
    console.error("[Sync] Failed to broadcast:", error);
  }
}

/**
 * Check if sync server is running
 */
export function isRelayConnected(): boolean {
  return isServerRunning;
}

/**
 * Get current client count
 */
export function getConnectedClients(): number {
  return clientCount;
}

/**
 * Get current sync status
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  return {
    serverRunning: isServerRunning,
    clientCount: await getClientCount(),
    syncUrl: await getSyncUrl(),
  };
}

/**
 * Subscribe to sync status changes
 */
export function onStatusChange(callback: StatusCallback): () => void {
  statusCallbacks.add(callback);
  
  // Immediately call with current status
  getSyncStatus().then(callback);
  
  return () => {
    statusCallbacks.delete(callback);
  };
}

/**
 * Notify all status listeners
 */
async function notifyStatus(): Promise<void> {
  const status = await getSyncStatus();
  for (const callback of statusCallbacks) {
    callback(status);
  }
}

/**
 * Start polling for client count updates
 */
function startPolling(): void {
  if (pollInterval) return;

  pollInterval = setInterval(async () => {
    const newCount = await getClientCount();
    if (newCount !== clientCount) {
      clientCount = newCount;
      await notifyStatus();
    }
  }, 2000);
}

/**
 * Stop polling
 */
function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * Start sync server
 * The WebSocket server is started automatically by Tauri on app launch.
 * This function sets up the document change subscription to broadcast updates.
 */
export async function startSync(): Promise<void> {
  if (isServerRunning) return;
  
  isServerRunning = true;
  
  // Start polling for client count
  startPolling();

  // Subscribe to local document changes and broadcast to clients
  changeUnsubscribe = subscribe(async () => {
    await broadcastDoc();
  });

  // Log sync URL
  const url = await getSyncUrl();
  console.log("[Sync] Server running at:", url);
  
  await notifyStatus();
}

/**
 * Stop sync (but server keeps running - it's managed by Tauri)
 */
export function stopSync(): void {
  stopPolling();

  if (changeUnsubscribe) {
    changeUnsubscribe();
    changeUnsubscribe = null;
  }

  isServerRunning = false;
  clientCount = 0;
  
  notifyStatus();
}

// Legacy exports for compatibility with existing code
export function connect(): void {
  startSync();
}

export function disconnect(): void {
  stopSync();
}

// For backwards compatibility with old API
export function getLocalIPs(): string[] {
  return ["localhost"]; // Real IP fetched async via getLocalIP()
}

export function getConnectionUrl(): string {
  return "ws://localhost:8765"; // Real URL fetched async via getSyncUrl()
}

export function getSyncStatusSync(): { connected: boolean; serverRunning: boolean; port: number } {
  return {
    connected: isServerRunning,
    serverRunning: isServerRunning,
    port: 8765,
  };
}

export function setServerStarted(started: boolean): void {
  isServerRunning = started;
}
