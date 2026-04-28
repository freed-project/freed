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
import { getDocBinary, mergeDoc, subscribe, setRelayClientCount } from "./automerge";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { log } from "./logger.js";
import { recordProviderHealthEvent } from "./provider-health";

const FALLBACK_SYNC_PORT = import.meta.env.VITE_FREED_SYNC_PORT || "8765";
const RELAY_POLL_TIMEOUT_MS = 5_000;
const RELAY_HEARTBEAT_INTERVAL = 5; // log a heartbeat every N poll ticks (= 10 s)

// Sync status
let isServerRunning = false;
let clientCount = 0;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let changeUnsubscribe: (() => void) | null = null;
let relayPollTick = 0;

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
    // Fallback lacks a token. Any connection using this URL will be
    // rejected by the relay, which is correct (pairing requires a QR scan).
    return `ws://${ip}:${FALLBACK_SYNC_PORT}`;
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
 * Start polling for client count updates.
 *
 * Each tick races against a 5s timeout. If the Tauri command hangs (e.g.
 * after a sleep/wake cycle), the timeout fires, the poller logs a warning
 * and restarts itself rather than accumulating stalled IPC calls.
 */
function startPolling(): void {
  if (pollInterval) return;
  relayPollTick = 0;

  function scheduleNextPoll() {
    if (!pollInterval) return; // stopped

    const handle = setTimeout(async () => {
      if (!pollInterval) return;

      relayPollTick++;
      if (relayPollTick % RELAY_HEARTBEAT_INTERVAL === 0) {
        log.info(`[sync] relay-poll heartbeat clients=${clientCount} tick=${relayPollTick}`);
      }

      let timedOut = false;
      const newCount = await Promise.race([
        getClientCount(),
        new Promise<number>((resolve) =>
          setTimeout(() => {
            timedOut = true;
            resolve(clientCount); // use last known value, don't stall
          }, RELAY_POLL_TIMEOUT_MS),
        ),
      ]);

      if (timedOut) {
        log.warn("[sync] get_sync_client_count TIMEOUT -- relay IPC stalled");
        addDebugEvent("error", "[Sync] relay poll TIMEOUT, restarting poller");
        // Restart the interval so a stalled tick doesn't jam the queue.
        stopPolling();
        pollInterval = true as unknown as ReturnType<typeof setInterval>; // re-arm flag
        scheduleNextPoll();
        return;
      }

      if (newCount !== clientCount) {
        clientCount = newCount;
        setRelayClientCount(newCount);
        await notifyStatus();
      }

      scheduleNextPoll();
    }, 2_000);

    // Store handle so stopPolling() can cancel the pending timer.
    pollInterval = handle as unknown as ReturnType<typeof setInterval>;
  }

  // Arm the first tick.
  pollInterval = true as unknown as ReturnType<typeof setInterval>;
  scheduleNextPoll();
}

/**
 * Stop polling
 */
function stopPolling(): void {
  if (pollInterval) {
    clearTimeout(pollInterval as unknown as ReturnType<typeof setTimeout>);
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

  // Relay broadcast is now handled by the Automerge worker: after every
  // applyChange() the worker posts BROADCAST_REQUEST to the main thread which
  // calls invoke("broadcast_doc") directly. No subscriber needed here.

  const url = await getSyncUrl();
  log.info(`[sync] relay server running at ${url}`);

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
const CLOUD_TOKEN_META_KEY = (p: CloudProvider) => `freed_cloud_token_meta_${p}`;
const UPLOAD_DEBOUNCE_MS = 2_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;

/** Per-provider abort controllers, upload timers, and doc-change unsubscribers. */
const cloudAborts = new Map<CloudProvider, AbortController>();
const uploadTimers = new Map<CloudProvider, ReturnType<typeof setTimeout>>();
const cloudChangeUnsubscribes = new Map<CloudProvider, () => void>();

// Desktop OAuth client IDs. These are public and embedded in the app bundle.
const DEFAULT_GDRIVE_DESKTOP_CLIENT_ID =
  "304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com";
const GDRIVE_CLIENT_ID =
  import.meta.env.VITE_GDRIVE_DESKTOP_CLIENT_ID || DEFAULT_GDRIVE_DESKTOP_CLIENT_ID;
// Only needed when using a "Web application" OAuth client type for GDrive instead
// of the correct "Desktop app" type. Desktop app clients support PKCE without a
// client_secret; web app clients require it.
const GDRIVE_CLIENT_SECRET = import.meta.env.VITE_GDRIVE_CLIENT_SECRET ?? "";
const GDRIVE_TOKEN_PROXY_URL =
  import.meta.env.VITE_GDRIVE_TOKEN_PROXY_URL ?? "https://app.freed.wtf/api/oauth/google";
const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID ?? "";

export interface CloudTokenBundle {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface DesktopOAuthOptions {
  signal?: AbortSignal;
}

interface TokenExchangeResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

function createOAuthCanceledError(): Error {
  const error = new Error("Google connection canceled.");
  error.name = "AbortError";
  return error;
}

export function isOAuthCanceledError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfOAuthCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createOAuthCanceledError();
  }
}

function tokenBundleFromResponse(data: TokenExchangeResponse): CloudTokenBundle {
  if (!data.access_token) throw new Error("Token exchange returned no access_token");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

function readCloudTokenBundle(provider: CloudProvider): CloudTokenBundle | null {
  const meta = localStorage.getItem(CLOUD_TOKEN_META_KEY(provider));
  if (meta) {
    try {
      const parsed = JSON.parse(meta) as Partial<CloudTokenBundle>;
      if (typeof parsed.accessToken === "string" && parsed.accessToken) {
        return {
          accessToken: parsed.accessToken,
          refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
          expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : undefined,
        };
      }
    } catch {
      localStorage.removeItem(CLOUD_TOKEN_META_KEY(provider));
    }
  }

  const legacyToken = localStorage.getItem(CLOUD_TOKEN_KEY(provider));
  return legacyToken ? { accessToken: legacyToken } : null;
}

/** Persist OAuth credentials for a cloud provider. */
export function storeCloudToken(provider: CloudProvider, token: string | CloudTokenBundle): void {
  const bundle = typeof token === "string" ? { accessToken: token } : token;
  localStorage.setItem(CLOUD_TOKEN_KEY(provider), bundle.accessToken);
  localStorage.setItem(CLOUD_TOKEN_META_KEY(provider), JSON.stringify(bundle));
}

/** Retrieve the stored OAuth access token for a cloud provider. */
export function getCloudToken(provider: CloudProvider): string | null {
  return readCloudTokenBundle(provider)?.accessToken ?? null;
}

async function refreshCloudToken(provider: CloudProvider, bundle: CloudTokenBundle): Promise<string | null> {
  if (!bundle.refreshToken) return bundle.accessToken;

  if (provider === "gdrive" && shouldUseGoogleTokenProxy()) {
    return refreshGoogleTokenViaProxy(bundle.refreshToken);
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: bundle.refreshToken,
  });

  let tokenUrl: string;
  if (provider === "gdrive") {
    params.set("client_id", GDRIVE_CLIENT_ID);
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
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  const refreshed = tokenBundleFromResponse((await res.json()) as TokenExchangeResponse);
  const nextBundle = {
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? bundle.refreshToken,
  };
  storeCloudToken(provider, nextBundle);
  return nextBundle.accessToken;
}

function shouldUseGoogleTokenProxy(): boolean {
  return !!GDRIVE_TOKEN_PROXY_URL && !!GDRIVE_CLIENT_ID && !GDRIVE_CLIENT_SECRET;
}

function tokenBundleFromProxyResponse(data: TokenExchangeResponse): CloudTokenBundle {
  return tokenBundleFromResponse(data);
}

async function exchangeGoogleCodeViaProxy(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<CloudTokenBundle> {
  const res = await fetch(GDRIVE_TOKEN_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      verifier: codeVerifier,
      redirectUri,
      clientId: GDRIVE_CLIENT_ID,
    }),
  });

  const data = (await res.json().catch(() => ({ error: "invalid JSON from Google token proxy" }))) as
    TokenExchangeResponse & { error?: string };

  if (!res.ok) {
    throw new Error(`Google token proxy failed (${res.status}): ${data.error ?? "token exchange failed"}`);
  }

  return tokenBundleFromProxyResponse(data);
}

async function refreshGoogleTokenViaProxy(refreshToken: string): Promise<string | null> {
  const res = await fetch(GDRIVE_TOKEN_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "refresh_token",
      refreshToken,
      clientId: GDRIVE_CLIENT_ID,
    }),
  });

  const data = (await res.json().catch(() => ({ error: "invalid JSON from Google token proxy" }))) as
    TokenExchangeResponse & { error?: string };

  if (!res.ok) {
    throw new Error(`Google token proxy refresh failed (${res.status}): ${data.error ?? "token refresh failed"}`);
  }

  const refreshed = tokenBundleFromProxyResponse(data);
  const nextBundle = {
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? refreshToken,
  };
  storeCloudToken("gdrive", nextBundle);
  return nextBundle.accessToken;
}

/** Return a non-expired access token when a refresh token is available. */
export async function getValidCloudToken(provider: CloudProvider): Promise<string | null> {
  const bundle = readCloudTokenBundle(provider);
  if (!bundle) return null;
  if (bundle.expiresAt && bundle.expiresAt - Date.now() <= TOKEN_REFRESH_SKEW_MS) {
    return refreshCloudToken(provider, bundle);
  }
  return bundle.accessToken;
}

/** Return all providers that have a stored access token. */
export function getActiveProviders(): CloudProvider[] {
  const all: CloudProvider[] = ["gdrive", "dropbox"];
  return all.filter((p) => !!getCloudToken(p));
}

/** Clear credentials for a provider and stop its sync loop. */
export function clearCloudProvider(provider: CloudProvider): void {
  localStorage.removeItem(CLOUD_TOKEN_KEY(provider));
  localStorage.removeItem(CLOUD_TOKEN_META_KEY(provider));
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
 * Resolves with OAuth credentials on success.
 */
export async function initiateDesktopOAuth(
  provider: CloudProvider,
  options: DesktopOAuthOptions = {},
): Promise<CloudTokenBundle> {
  const { signal } = options;
  throwIfOAuthCanceled(signal);

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  throwIfOAuthCanceled(signal);

  // Start the localhost server first so the port is known before we build the
  // OAuth URL. The Rust command returns the port and then waits for the callback.
  const port = await invoke<number>("start_oauth_server");
  throwIfOAuthCanceled(signal);
  // Use localhost, not 127.0.0.1. Dropbox and Google only accept the
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
      scope: "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/contacts.readonly",
      include_granted_scopes: "true",
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

  let unlisten: (() => void) | null = null;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  let cleanedUp = false;
  let timer: ReturnType<typeof setTimeout>;
  let handleAbort: () => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const cleanupCodeWait = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", handleAbort);
    unlisten?.();
  };
  timer = setTimeout(() => {
    cleanupCodeWait();
    rejectCode(new Error("OAuth timed out waiting for browser callback"));
  }, 300_000);

  handleAbort = () => {
    cleanupCodeWait();
    rejectCode(createOAuthCanceledError());
  };

  unlisten = await listen<{ code: string; state: string }>("cloud-oauth-code", (event) => {
    cleanupCodeWait();
    if (event.payload.state !== state) {
      rejectCode(new Error("OAuth state mismatch. Please try connecting again."));
      return;
    }
    if (!event.payload.code) {
      rejectCode(new Error("OAuth callback did not include an authorization code."));
      return;
    }
    resolveCode(event.payload.code);
  });
  signal?.addEventListener("abort", handleAbort, { once: true });

  // Register the callback listener before opening the browser so a fast auth
  // redirect cannot beat the frontend subscription.
  let code: string;
  try {
    throwIfOAuthCanceled(signal);
    await shellOpen(authUrl);
    code = await codePromise;
  } catch (error) {
    cleanupCodeWait();
    throw error;
  }

  cleanupCodeWait();
  throwIfOAuthCanceled(signal);

  // Exchange the authorization code for an access token.
  return exchangeCode(provider, code, verifier, redirectUri);
}

async function exchangeCode(
  provider: CloudProvider,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<CloudTokenBundle> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  let tokenUrl: string;
  if (provider === "gdrive") {
    if (shouldUseGoogleTokenProxy()) {
      return exchangeGoogleCodeViaProxy(code, codeVerifier, redirectUri);
    }

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

  return tokenBundleFromResponse((await res.json()) as TokenExchangeResponse);
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
  const resolveToken = async () => (provider === "gdrive" ? (await getValidCloudToken(provider)) ?? token : token);

  // Immediate pull to catch up on any changes since last session.
  try {
    const download = provider === "gdrive" ? gdriveDownloadLatest : dropboxDownloadLatest;
    const remote = await download(await resolveToken(), signal);
    if (remote) {
      await mergeDoc(remote);
      console.log("[CloudSync/%s] Initial merge (%d bytes)", provider, remote.length);
      await recordProviderHealthEvent({
        provider,
        outcome: "success",
        stage: "download",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        bytesMoved: remote.length,
      });
    } else {
      await recordProviderHealthEvent({
        provider,
        outcome: "empty",
        stage: "download",
        reason: "No remote changes",
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
    }
  } catch (err) {
    if (!signal.aborted) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudSync/${provider}] Initial download failed:`, err);
      addDebugEvent("error", `[Cloud/${provider}] initial download failed: ${msg}`);
      await recordProviderHealthEvent({
        provider,
        outcome: "error",
        stage: "download",
        reason: msg,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
    }
  }

  const onRemoteChange = async (binary: Uint8Array) => {
    try {
      await mergeDoc(binary);
      console.log("[CloudSync/%s] Merged remote change (%d bytes)", provider, binary.length);
      await recordProviderHealthEvent({
        provider,
        outcome: "success",
        stage: "merge",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        bytesMoved: binary.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudSync/${provider}] Merge failed:`, err);
      addDebugEvent("merge_err", `[Cloud/${provider}] merge failed: ${msg}`);
      await recordProviderHealthEvent({
        provider,
        outcome: "error",
        stage: "merge",
        reason: msg,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        bytesMoved: binary.length,
      });
    }
  };

  const cloudLog = (level: "info" | "warn" | "error", msg: string) => {
    log[level](msg);
    if (level === "warn" || level === "error") {
      addDebugEvent("error", msg);
    }
  };

  if (provider === "gdrive") {
    const runGDrivePollLoop = async () => {
      while (!signal.aborted) {
        const pollToken = await resolveToken();
        try {
          await gdriveStartPollLoop(pollToken, onRemoteChange, signal, cloudLog);
          return;
        } catch (error) {
          if (signal.aborted) return;
          const status = typeof error === "object" && error !== null && "status" in error
            ? (error as { status?: number }).status
            : undefined;
          if (status !== 401 && status !== 403) throw error;
          await refreshCloudToken("gdrive", readCloudTokenBundle("gdrive") ?? { accessToken: pollToken });
        }
      }
    };

    runGDrivePollLoop().catch(async (err) => {
      if (!signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[cloud/gdrive] poll loop crashed: ${msg}`);
        addDebugEvent("error", `[Cloud/gdrive] poll loop crashed: ${msg}`);
        await recordProviderHealthEvent({
          provider: "gdrive",
          outcome: "error",
          stage: "poll",
          reason: msg,
          startedAt: Date.now(),
          finishedAt: Date.now(),
        });
      }
    });
  } else {
    dropboxStartLongpollLoop(token, onRemoteChange, signal, cloudLog).catch(async (err) => {
      if (!signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[cloud/dropbox] longpoll loop crashed: ${msg}`);
        addDebugEvent("error", `[Cloud/dropbox] longpoll loop crashed: ${msg}`);
        await recordProviderHealthEvent({
          provider: "dropbox",
          outcome: "error",
          stage: "poll",
          reason: msg,
          startedAt: Date.now(),
          finishedAt: Date.now(),
        });
      }
    });
  }

  // Subscribe to local doc changes so every mutation is uploaded back.
  // Debounced by scheduleCloudUpload. Rapid edits coalesce into one upload.
  const unsubscribe = subscribe(() => {
    scheduleCloudUpload(provider);
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
 * Called from the worker-backed document subscription so every local change
 * can trigger a cloud backup. Debouncing prevents a flood of uploads during
 * rapid edits.
 */
export function scheduleCloudUpload(provider: CloudProvider, token?: string): void {
  const existing = uploadTimers.get(provider);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    uploadTimers.delete(provider);
    const binary = await getDocBinary();
    const startedAt = Date.now();
    try {
      const uploadToken = token ?? await getValidCloudToken(provider);
      if (!uploadToken) throw new Error("Cloud token missing. Reconnect the provider.");
      if (provider === "gdrive") {
        await gdriveUploadSafe(uploadToken, binary);
      } else {
        await dropboxUploadSafe(uploadToken, binary);
      }
      console.log("[CloudSync/%s] Uploaded (%d bytes)", provider, binary.byteLength);
      await recordProviderHealthEvent({
        provider,
        outcome: "success",
        stage: "upload",
        startedAt,
        finishedAt: Date.now(),
        bytesMoved: binary.byteLength,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudSync/${provider}] Upload failed:`, err);
      addDebugEvent("error", `[Cloud/${provider}] upload failed: ${msg}`);
      await recordProviderHealthEvent({
        provider,
        outcome: "error",
        stage: "upload",
        reason: msg,
        startedAt,
        finishedAt: Date.now(),
        bytesMoved: binary.byteLength,
      });
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
    const token = await getValidCloudToken(provider);
    if (!token) continue;
    startCloudSync(provider, token).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudSync] Failed to resume ${provider}:`, err);
      addDebugEvent("error", `[Cloud/${provider}] failed to resume on startup: ${msg}`);
    });
  }
}
