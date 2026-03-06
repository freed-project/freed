/**
 * Sync Server Controller for Freed Desktop
 *
 * Desktop runs a WebSocket relay server via Tauri (Rust backend).
 * This module provides TypeScript interface to control and monitor it.
 * PWAs connect to this server to sync their Automerge documents.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { getDocBinary, mergeDoc, subscribe, setRelayClientCount } from "./automerge";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import {
  gdriveUploadSafe,
  gdriveStartPollLoop,
  gdriveDownloadLatest,
  gdriveDeleteFile,
  dropboxUploadSafe,
  dropboxStartLongpollLoop,
  dropboxDownloadLatest,
  dropboxDeleteFile,
  type CloudProvider,
} from "@freed/sync/cloud";

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

export interface NetworkInterface {
  interface: string;
  ip: string;
  url: string;
}

/**
 * Get all non-loopback IPv4 network interfaces with sync URLs.
 * Use this to let the user pick the right IP when a VPN is active.
 */
export async function getAllLocalIPs(): Promise<NetworkInterface[]> {
  try {
    return await invoke<NetworkInterface[]>("get_all_local_ips");
  } catch {
    return [];
  }
}

/**
 * Get the sync relay URL for PWA to connect to.
 * The returned URL includes the pairing token as `?t=<token>`.
 */
export async function getSyncUrl(): Promise<string> {
  try {
    return await invoke<string>("get_sync_url");
  } catch {
    const ip = await getLocalIP();
    // Fallback lacks a token — any connection using this URL will be
    // rejected by the relay, which is correct (pairing requires a QR scan).
    return `ws://${ip}:8765`;
  }
}

/**
 * Rotate the pairing token.
 *
 * The new token is persisted to disk and takes effect immediately for new
 * connections. Devices that are currently connected remain unaffected until
 * they disconnect. Paired phones must rescan the QR code after a reset.
 *
 * Returns the new sync URL (including the rotated token).
 */
export async function resetPairingToken(): Promise<string> {
  await invoke("reset_pairing_token");
  return getSyncUrl();
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
 * Broadcast document to all connected clients.
 *
 * Skips the Array.from(Uint8Array) conversion (O(binary size), can be 50-300 ms
 * for a large doc) when no clients are connected — the common single-device case.
 */
export async function broadcastDoc(): Promise<void> {
  if (clientCount === 0) return;
  try {
    const docBytes = getDocBinary();
    // Convert Uint8Array to a plain array for Tauri JSON serialization.
    await invoke("broadcast_doc", { docBytes: Array.from(docBytes) });
    console.log("[Sync] Broadcast document:", docBytes.length, "bytes");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Sync] Failed to broadcast:", error);
    addDebugEvent("error", `[Sync] broadcast failed: ${msg}`);
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
      // Keep automerge.ts in sync so broadcastToRelay() can skip the expensive
      // Array.from() conversion when no PWA clients are connected.
      setRelayClientCount(newCount);
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

// ─── Cloud sync ───────────────────────────────────────────────────────────────

export type { CloudProvider };

const CLOUD_TOKEN_KEY = (p: CloudProvider) => `freed_cloud_token_${p}`;
const UPLOAD_DEBOUNCE_MS = 2_000;

/** Per-provider abort controllers, upload timers, and doc-change unsubscribers. */
const cloudAborts = new Map<CloudProvider, AbortController>();
const uploadTimers = new Map<CloudProvider, ReturnType<typeof setTimeout>>();
const cloudChangeUnsubscribes = new Map<CloudProvider, () => void>();

// Desktop OAuth client IDs (not secret — embedded in the app bundle).
const GDRIVE_CLIENT_ID = import.meta.env.VITE_GDRIVE_DESKTOP_CLIENT_ID ?? "";
// Only needed when using a "Web application" OAuth client type for GDrive instead
// of the correct "Desktop app" type. Desktop app clients support PKCE without a
// client_secret; web app clients require it.
const GDRIVE_CLIENT_SECRET = import.meta.env.VITE_GDRIVE_CLIENT_SECRET ?? "";
const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID ?? "";

/** Persist an OAuth access token for a cloud provider. */
export function storeCloudToken(provider: CloudProvider, token: string): void {
  localStorage.setItem(CLOUD_TOKEN_KEY(provider), token);
}

/** Retrieve the stored OAuth access token for a cloud provider. */
export function getCloudToken(provider: CloudProvider): string | null {
  return localStorage.getItem(CLOUD_TOKEN_KEY(provider));
}

/** Return all providers that have a stored access token. */
export function getActiveProviders(): CloudProvider[] {
  const all: CloudProvider[] = ["gdrive", "dropbox"];
  return all.filter((p) => !!getCloudToken(p));
}

/** Clear credentials for a provider and stop its sync loop. */
export function clearCloudProvider(provider: CloudProvider): void {
  localStorage.removeItem(CLOUD_TOKEN_KEY(provider));
  stopCloudSync(provider);
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ─── Desktop OAuth flow ───────────────────────────────────────────────────────

/**
 * Start the PKCE OAuth flow for the given provider using the Tauri one-shot
 * localhost server. The system browser is opened, the user authenticates,
 * and the callback is captured without needing a public redirect URI.
 *
 * Resolves with the access token on success.
 */
export async function initiateDesktopOAuth(provider: CloudProvider): Promise<string> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  // Start the localhost server first so the port is known before we build the
  // OAuth URL. The Rust command returns the port and then waits for the callback.
  const port = await invoke<number>("start_oauth_server");
  // Use localhost (not 127.0.0.1) — Dropbox and Google only accept the
  // registered redirect URI prefix, and "http://localhost" is the standard
  // registration for desktop/native PKCE apps on both platforms.
  const redirectUri = `http://localhost:${port}/callback`;
  const state = crypto.randomUUID();

  let authUrl: string;
  if (provider === "gdrive") {
    const params = new URLSearchParams({
      client_id: GDRIVE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.appdata",
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      state,
    });
    authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  } else {
    const params = new URLSearchParams({
      client_id: DROPBOX_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      token_access_type: "offline",
      state,
    });
    authUrl = `https://www.dropbox.com/oauth2/authorize?${params}`;
  }

  // Open system browser and wait for the Tauri backend to emit the code.
  await shellOpen(authUrl);

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      unlisten();
      reject(new Error("OAuth timed out waiting for browser callback"));
    }, 300_000);

    let unlisten: () => void;
    listen<{ code: string; state: string }>("cloud-oauth-code", (event) => {
      clearTimeout(timer);
      unlisten();
      if (event.payload.state !== state) {
        reject(new Error("OAuth state mismatch — possible CSRF"));
        return;
      }
      resolve(event.payload.code);
    }).then((fn) => {
      unlisten = fn;
    });
  });

  // Exchange the authorization code for an access token.
  return exchangeCode(provider, code, verifier, redirectUri);
}

async function exchangeCode(
  provider: CloudProvider,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  let tokenUrl: string;
  if (provider === "gdrive") {
    params.set("client_id", GDRIVE_CLIENT_ID);
    // Desktop app OAuth clients use PKCE without a secret. If the console client
    // is a "Web application" type, VITE_GDRIVE_CLIENT_SECRET must be set or
    // Google returns 400 "client_secret is missing".
    if (GDRIVE_CLIENT_SECRET) {
      params.set("client_secret", GDRIVE_CLIENT_SECRET);
    }
    tokenUrl = "https://oauth2.googleapis.com/token";
  } else {
    params.set("client_id", DROPBOX_CLIENT_ID);
    tokenUrl = "https://api.dropboxapi.com/oauth2/token";
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

// ─── Sync loops ───────────────────────────────────────────────────────────────

/**
 * Start the cloud sync loop for a single provider.
 * Downloads the latest remote state immediately, then runs the appropriate
 * poll/longpoll loop in the background. Also subscribes to local doc changes
 * so every mutation is uploaded back to the cloud (debounced).
 */
export async function startCloudSync(provider: CloudProvider, token: string): Promise<void> {
  stopCloudSync(provider);
  const controller = new AbortController();
  cloudAborts.set(provider, controller);
  const { signal } = controller;

  // Immediate pull to catch up on any changes since last session.
  try {
    const download = provider === "gdrive" ? gdriveDownloadLatest : dropboxDownloadLatest;
    const remote = await download(token, signal);
    if (remote) {
      await mergeDoc(remote);
      console.log("[CloudSync/%s] Initial merge (%d bytes)", provider, remote.length);
    }
  } catch (err) {
    if (!signal.aborted) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudSync/${provider}] Initial download failed:`, err);
      addDebugEvent("error", `[Cloud/${provider}] initial download failed: ${msg}`);
    }
  }

  const onRemoteChange = async (binary: Uint8Array) => {
    try {
      await mergeDoc(binary);
      console.log("[CloudSync/%s] Merged remote change (%d bytes)", provider, binary.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudSync/${provider}] Merge failed:`, err);
      addDebugEvent("merge_err", `[Cloud/${provider}] merge failed: ${msg}`);
    }
  };

  if (provider === "gdrive") {
    gdriveStartPollLoop(token, onRemoteChange, signal).catch((err) => {
      if (!signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[CloudSync/GDrive] Poll loop crashed:", err);
        addDebugEvent("error", `[Cloud/gdrive] poll loop crashed: ${msg}`);
      }
    });
  } else {
    dropboxStartLongpollLoop(token, onRemoteChange, signal).catch((err) => {
      if (!signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[CloudSync/Dropbox] Longpoll loop crashed:", err);
        addDebugEvent("error", `[Cloud/dropbox] longpoll loop crashed: ${msg}`);
      }
    });
  }

  // Subscribe to local doc changes so every mutation is uploaded back.
  // Debounced by scheduleCloudUpload — rapid edits coalesce into one upload.
  const unsubscribe = subscribe(() => {
    scheduleCloudUpload(provider, token);
  });
  cloudChangeUnsubscribes.set(provider, unsubscribe);

  console.log("[CloudSync] Started (%s)", provider);
}

/** Stop the cloud sync loop for a provider. */
export function stopCloudSync(provider: CloudProvider): void {
  cloudAborts.get(provider)?.abort();
  cloudAborts.delete(provider);

  const timer = uploadTimers.get(provider);
  if (timer) {
    clearTimeout(timer);
    uploadTimers.delete(provider);
  }

  cloudChangeUnsubscribes.get(provider)?.();
  cloudChangeUnsubscribes.delete(provider);
}

/** Stop all active cloud sync loops. */
export function stopAllCloudSyncs(): void {
  for (const provider of cloudAborts.keys()) {
    stopCloudSync(provider);
  }
}

/**
 * Delete the cloud sync file for the given provider.
 * Stops the sync loop first to prevent a race with any in-flight upload.
 * Used during factory reset when the user opts to also wipe cloud storage.
 */
export async function deleteCloudFile(provider: CloudProvider, token: string): Promise<void> {
  stopCloudSync(provider);
  if (provider === "gdrive") {
    await gdriveDeleteFile(token);
  } else {
    await dropboxDeleteFile(token);
  }
}

/**
 * Schedule a debounced upload for a provider.
 * Called from `broadcastDoc` so every local document change triggers a cloud
 * backup. Debouncing prevents a flood of uploads during rapid edits.
 */
export function scheduleCloudUpload(provider: CloudProvider, token: string): void {
  const existing = uploadTimers.get(provider);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    uploadTimers.delete(provider);
    const binary = getDocBinary();
    try {
      if (provider === "gdrive") {
        await gdriveUploadSafe(token, binary);
      } else {
        await dropboxUploadSafe(token, binary);
      }
      console.log("[CloudSync/%s] Uploaded (%d bytes)", provider, binary.byteLength);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudSync/${provider}] Upload failed:`, err);
      addDebugEvent("error", `[Cloud/${provider}] upload failed: ${msg}`);
    }
  }, UPLOAD_DEBOUNCE_MS);

  uploadTimers.set(provider, timer);
}

/**
 * Start cloud sync loops for all providers that have stored tokens.
 * Call this on app startup to resume any previously connected providers.
 */
export async function startAllCloudSyncs(): Promise<void> {
  for (const provider of getActiveProviders()) {
    const token = getCloudToken(provider)!;
    startCloudSync(provider, token).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudSync] Failed to resume ${provider}:`, err);
      addDebugEvent("error", `[Cloud/${provider}] failed to resume on startup: ${msg}`);
    });
  }
}

