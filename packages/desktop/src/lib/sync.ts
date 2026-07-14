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
  gdriveUploadReplace,
  gdriveStartPollLoop,
  gdriveDownloadLatest,
  gdriveDeleteFile,
  dropboxUploadSafe,
  dropboxUploadReplace,
  dropboxStartLongpollLoop,
  dropboxDownloadLatest,
  dropboxDeleteFile,
  type CloudProvider,
  type GoogleDriveFetch,
} from "@freed/sync/cloud";
import {
  compareDoc,
  getDocBinary,
  getDocHeads,
  mergeDoc,
  replaceLocalDoc,
  subscribe,
  setRelayClientCount,
} from "./automerge";
import { recordCloudUploadAttempt, recordCloudUploadSkipped, type CloudUploadCause } from "./runtime-health-events";
import {
  addDebugEvent,
  recordCloudProviderEvent,
  updateCloudProvider,
  type CloudProviderEventKind,
} from "@freed/ui/lib/debug-store";
import {
  BACKGROUND_CHANNEL_LABELS,
  finishBackgroundActivity,
  startBackgroundActivity,
} from "@freed/ui/lib/background-activity-store";
import {
  beginFactoryResetCloudCleanup,
  clearFactoryResetCloudCleanupBarrier,
  clearStoredCloudProvidersForFactoryReset,
  hasFactoryResetCloudCleanupBarrier,
  isFactoryResetInProgress,
} from "@freed/ui/lib/factory-reset";
import { log } from "./logger.js";
import { recordProviderHealthEvent } from "./provider-health";
import { scheduleSideEffect } from "./side-effect-scheduler";
import { safeUnlisten } from "./safe-unlisten";
import {
  formatBackgroundRuntimeDeferredReason,
  isBackgroundRuntimeDeferredError,
  runBackgroundJob,
  type BackgroundJobKind,
} from "./background-runtime-coordinator";

let googleDriveFetch: GoogleDriveFetch | undefined;

export function setGoogleDriveFetch(fetcher: GoogleDriveFetch | undefined): void {
  googleDriveFetch = fetcher;
}

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
 * The returned URL includes the pairing token.
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
const UPLOAD_DEFER_BACKOFF_BASE_MS = 10_000;
const UPLOAD_DEFER_BACKOFF_MAX_MS = 120_000;
const UPLOAD_ACTIVE_JOB_WAIT_MS = 30_000;
const UPLOAD_ACTIVE_JOB_RETRY_MS = 5_000;
const UPLOAD_WAIT_FOR_ACTIVE_JOB_KINDS = ["outbox", "social-scrape"] as const satisfies readonly BackgroundJobKind[];
const CONFLICT_RECOVERY_ACTIVE_JOB_WAIT_MS = 120_000;
const INITIAL_DOWNLOAD_DEFER_BACKOFF_BASE_MS = 15_000;
const INITIAL_DOWNLOAD_DEFER_BACKOFF_MAX_MS = 180_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const GOOGLE_TOKEN_REFRESH_FALLBACK_TTL_MS = 55 * 60 * 1000;
const AUTH_FAILURE_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

/** Per-provider abort controllers, upload timers, and doc-change unsubscribers. */
const cloudAborts = new Map<CloudProvider, AbortController>();
const uploadTimers = new Map<CloudProvider, ReturnType<typeof setTimeout>>();
const initialDownloadTimers = new Map<CloudProvider, ReturnType<typeof setTimeout>>();
const cloudChangeUnsubscribes = new Map<CloudProvider, () => void>();
interface CloudTokenRefreshTask {
  readonly credentialRevision: number;
  readonly promise: Promise<string | null>;
}

const cloudTokenRefreshes = new Map<CloudProvider, CloudTokenRefreshTask>();
const cloudCredentialRevisions = new Map<CloudProvider, number>();
const cloudAuthFailureRefreshes = new Map<CloudProvider, number>();
const cloudUploadDeferredAttempts = new Map<CloudProvider, number>();
const cloudInitialDownloadDeferredAttempts = new Map<CloudProvider, number>();
const blockedDestructiveMergeProviders = new Map<CloudProvider, string>();
const cloudGenerations = new Map<CloudProvider, number>();
const cloudStartupRepairGeneration = new Map<CloudProvider, number>();
const cloudInFlightOperations = new Map<CloudProvider, Set<Promise<unknown>>>();
const cloudInFlightUploads = new Map<CloudProvider, Set<Promise<void>>>();
const cloudTransientAborts = new Map<CloudProvider, Set<AbortController>>();
const cloudDeletesInProgress = new Set<CloudProvider>();

function invalidateCloudGeneration(provider: CloudProvider): number {
  const generation = (cloudGenerations.get(provider) ?? 0) + 1;
  cloudGenerations.set(provider, generation);
  return generation;
}

function currentCloudGeneration(provider: CloudProvider): number {
  return cloudGenerations.get(provider) ?? 0;
}

function isCloudGenerationCurrent(
  provider: CloudProvider,
  generation: number,
  signal?: AbortSignal,
): boolean {
  return (
    currentCloudGeneration(provider) === generation
    && !signal?.aborted
    && !cloudDeletesInProgress.has(provider)
  );
}

function currentCloudCredentialRevision(provider: CloudProvider): number {
  return cloudCredentialRevisions.get(provider) ?? 0;
}

function invalidateCloudCredentials(provider: CloudProvider): number {
  const revision = currentCloudCredentialRevision(provider) + 1;
  cloudCredentialRevisions.set(provider, revision);
  return revision;
}

export interface CloudLifecycleGuard {
  isCurrent: () => boolean;
}

export function captureCloudLifecycle(provider: CloudProvider): CloudLifecycleGuard {
  const generation = currentCloudGeneration(provider);
  return {
    isCurrent: () => isCloudGenerationCurrent(provider, generation),
  };
}

function trackCloudOperation<T>(provider: CloudProvider, operation: Promise<T>): Promise<T> {
  let operations = cloudInFlightOperations.get(provider);
  if (!operations) {
    operations = new Set();
    cloudInFlightOperations.set(provider, operations);
  }
  operations.add(operation);
  void operation.finally(() => {
    operations?.delete(operation);
    if (operations?.size === 0) cloudInFlightOperations.delete(provider);
  }).catch(() => {});
  return operation;
}

function trackCloudUpload(provider: CloudProvider, upload: Promise<void>): Promise<void> {
  let uploads = cloudInFlightUploads.get(provider);
  if (!uploads) {
    uploads = new Set();
    cloudInFlightUploads.set(provider, uploads);
  }
  uploads.add(upload);
  void upload.finally(() => {
    uploads?.delete(upload);
    if (uploads?.size === 0) cloudInFlightUploads.delete(provider);
  }).catch(() => {});
  return upload;
}

async function waitForCloudSettlement(provider: CloudProvider): Promise<void> {
  while (true) {
    const pending = [
      ...(cloudInFlightOperations.get(provider) ?? []),
      ...(cloudInFlightUploads.get(provider) ?? []),
    ];
    if (pending.length === 0) return;
    await Promise.allSettled(pending);
  }
}

function addTransientCloudAbort(provider: CloudProvider, controller: AbortController): () => void {
  let controllers = cloudTransientAborts.get(provider);
  if (!controllers) {
    controllers = new Set();
    cloudTransientAborts.set(provider, controllers);
  }
  controllers.add(controller);
  return () => {
    controllers?.delete(controller);
    if (controllers?.size === 0) cloudTransientAborts.delete(provider);
  };
}

function describeSyncError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDestructiveMergeErrorMessage(message: string): boolean {
  return message.includes("blocked a sync merge");
}

function preserveDestructiveMergeBlock(provider: CloudProvider): boolean {
  const message = blockedDestructiveMergeProviders.get(provider);
  if (!message) return false;
  updateCloudProvider(provider, {
    status: "error",
    stage: "idle",
    error: message,
    statusMessage: message,
    pendingReason: "Choose which copy should win before cloud sync retries.",
  });
  return true;
}

type CloudStage = "auth" | "download" | "merge" | "poll" | "upload" | "idle";

function recordCloudStep(
  provider: CloudProvider,
  kind: CloudProviderEventKind,
  stage: CloudStage,
  message: string,
  bytes?: number,
): void {
  recordCloudProviderEvent(provider, { kind, stage, message, bytes });
}

function markCloudAttempt(provider: CloudProvider, stage: Exclude<CloudStage, "idle">, message?: string): void {
  const statusMessage = message ?? `Running ${stage}.`;
  startBackgroundActivity({
    id: `channel:${provider}`,
    kind: "channel",
    channelId: provider,
    label: BACKGROUND_CHANNEL_LABELS[provider],
    message: statusMessage,
    log: false,
  });
  updateCloudProvider(provider, {
    status: "connected",
    stage,
    lastAttemptAt: Date.now(),
    statusMessage,
    pendingReason: undefined,
    error: undefined,
  });
  recordCloudStep(provider, "started", stage, statusMessage);
}

function markCloudSuccess(
  provider: CloudProvider,
  state: {
    stage?: CloudStage;
    lastDownloadAt?: number;
    lastUploadAt?: number;
    lastMergeAt?: number;
    lastRemoteBytes?: number;
    lastUploadedBytes?: number;
    lastLocalBytes?: number;
    statusMessage?: string;
    pendingReason?: string;
    eventKind?: CloudProviderEventKind;
    eventMessage?: string;
    eventBytes?: number;
  } = {},
): void {
  const now = Date.now();
  const stage = state.stage ?? "idle";
  const statusMessage = state.statusMessage ?? (stage === "idle" ? "Sync is idle." : `${stage} complete.`);
  const {
    eventKind,
    eventMessage,
    eventBytes,
    ...debugState
  } = state;
  updateCloudProvider(provider, {
    status: "connected",
    stage,
    lastSuccessfulAt: now,
    lastSyncAt: now,
    statusMessage,
    pendingReason: debugState.pendingReason,
    error: undefined,
    ...debugState,
  });
  recordCloudStep(
    provider,
    eventKind ?? "success",
    stage,
    eventMessage ?? statusMessage,
    eventBytes ?? debugState.lastUploadedBytes ?? debugState.lastRemoteBytes ?? debugState.lastLocalBytes,
  );
  finishBackgroundActivity(
    `channel:${provider}`,
    "success",
    eventMessage ?? statusMessage,
  );
}

function markCloudError(provider: CloudProvider, stage: "auth" | "download" | "merge" | "poll" | "upload", error: unknown): void {
  const message = describeSyncError(error);
  const destructiveMergeBlocked = isDestructiveMergeErrorMessage(message);
  if (destructiveMergeBlocked) {
    blockedDestructiveMergeProviders.set(provider, message);
  }
  updateCloudProvider(provider, {
    status: "error",
    stage: destructiveMergeBlocked ? "idle" : stage,
    error: message,
    statusMessage: message,
    pendingReason: destructiveMergeBlocked
      ? "Choose which copy should win before cloud sync retries."
      : "Resolve this error, then reconnect or run Sync now.",
    lastErrorAt: Date.now(),
  });
  recordCloudStep(provider, "error", stage, message);
  finishBackgroundActivity(`channel:${provider}`, "error", `${BACKGROUND_CHANNEL_LABELS[provider]} failed: ${message}`);
}

// Desktop OAuth client IDs. These are public and embedded in the app bundle.
const DEFAULT_GDRIVE_DESKTOP_CLIENT_ID =
  "304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com";
const DEFAULT_GDRIVE_TOKEN_PROXY_URL = "https://app.freed.wtf/api/oauth/google";
const GDRIVE_CLIENT_ID =
  import.meta.env.VITE_GDRIVE_DESKTOP_CLIENT_ID || DEFAULT_GDRIVE_DESKTOP_CLIENT_ID;
// Only needed when using direct token exchange for a Google OAuth client that
// requires a secret. Prefer the server token proxy by default so the
// secret never ships in the Freed Desktop bundle.
const GDRIVE_CLIENT_SECRET = import.meta.env.VITE_GDRIVE_CLIENT_SECRET ?? "";
const GDRIVE_TOKEN_PROXY_URL =
  import.meta.env.VITE_GDRIVE_TOKEN_PROXY_URL || DEFAULT_GDRIVE_TOKEN_PROXY_URL;
const GDRIVE_FORCE_TOKEN_PROXY = import.meta.env.VITE_GDRIVE_FORCE_TOKEN_PROXY === "1";
const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID ?? "";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
let acceptingDesktopOAuth = true;
const activeDesktopOAuthControllers = new Set<AbortController>();
const activeDesktopOAuthOperations = new Set<Promise<unknown>>();

export interface CloudTokenBundle {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface CloudTokenReadResult {
  bundle: CloudTokenBundle | null;
  hasStoredCredentials: boolean;
}

export interface DesktopOAuthOptions {
  signal?: AbortSignal;
}

interface TokenExchangeResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface NativeGoogleOAuthResponse {
  status: number;
  headers: Array<[string, string]>;
  body: number[];
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
  if (signal?.aborted || !acceptingDesktopOAuth || isFactoryResetInProgress()) {
    throw createOAuthCanceledError();
  }
}

function tokenBundleFromResponse(
  data: TokenExchangeResponse,
  options: { fallbackTtlMs?: number } = {},
): CloudTokenBundle {
  if (!data.access_token) throw new Error("Token exchange returned no access_token");
  const expiresAt = typeof data.expires_in === "number" && Number.isFinite(data.expires_in) && data.expires_in > 0
    ? Date.now() + data.expires_in * 1000
    : options.fallbackTtlMs
      ? Date.now() + options.fallbackTtlMs
      : undefined;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
  };
}

function decodeCloudTokenMetadata(raw: string): CloudTokenBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.accessToken !== "string" || record.accessToken.trim().length === 0) {
    return null;
  }
  if (
    record.refreshToken !== undefined
    && (typeof record.refreshToken !== "string" || record.refreshToken.trim().length === 0)
  ) {
    return null;
  }
  if (
    record.expiresAt !== undefined
    && (typeof record.expiresAt !== "number" || !Number.isFinite(record.expiresAt))
  ) {
    return null;
  }

  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken as string | undefined,
    expiresAt: record.expiresAt as number | undefined,
  };
}

function readCloudTokenState(provider: CloudProvider): CloudTokenReadResult {
  const meta = localStorage.getItem(CLOUD_TOKEN_META_KEY(provider));
  if (meta !== null) {
    return {
      bundle: decodeCloudTokenMetadata(meta),
      hasStoredCredentials: true,
    };
  }

  const legacyToken = localStorage.getItem(CLOUD_TOKEN_KEY(provider));
  return {
    bundle: legacyToken && legacyToken.trim().length > 0
      ? { accessToken: legacyToken }
      : null,
    hasStoredCredentials: legacyToken !== null,
  };
}

function readCloudTokenBundle(provider: CloudProvider): CloudTokenBundle | null {
  return readCloudTokenState(provider).bundle;
}

function readCloudTokenBundleForAuthFailure(
  provider: CloudProvider,
  fallbackToken: string,
): CloudTokenBundle | null {
  const result = readCloudTokenState(provider);
  if (result.bundle) return result.bundle;
  return result.hasStoredCredentials ? null : { accessToken: fallbackToken };
}

interface CloudTokenStorageSnapshot {
  accessToken: string | null;
  metadata: string | null;
}

function captureCloudTokenStorage(provider: CloudProvider): CloudTokenStorageSnapshot {
  return {
    accessToken: localStorage.getItem(CLOUD_TOKEN_KEY(provider)),
    metadata: localStorage.getItem(CLOUD_TOKEN_META_KEY(provider)),
  };
}

function sameCloudTokenStorage(
  left: CloudTokenStorageSnapshot,
  right: CloudTokenStorageSnapshot,
): boolean {
  return left.accessToken === right.accessToken && left.metadata === right.metadata;
}

function canCommitCloudTokenRefresh(
  provider: CloudProvider,
  credentialRevision: number,
  source: CloudTokenStorageSnapshot,
): boolean {
  return currentCloudCredentialRevision(provider) === credentialRevision
    && sameCloudTokenStorage(captureCloudTokenStorage(provider), source);
}

function restoreCloudTokenStorageIfStale(
  provider: CloudProvider,
  snapshot: CloudTokenStorageSnapshot,
  resolvedToken: string | null,
  credentialRevision: number,
): void {
  if (currentCloudCredentialRevision(provider) !== credentialRevision) return;
  if (!resolvedToken || getCloudToken(provider) !== resolvedToken) return;
  if (snapshot.accessToken === null) localStorage.removeItem(CLOUD_TOKEN_KEY(provider));
  else localStorage.setItem(CLOUD_TOKEN_KEY(provider), snapshot.accessToken);
  if (snapshot.metadata === null) localStorage.removeItem(CLOUD_TOKEN_META_KEY(provider));
  else localStorage.setItem(CLOUD_TOKEN_META_KEY(provider), snapshot.metadata);
}

function persistCloudToken(provider: CloudProvider, token: string | CloudTokenBundle): void {
  const previous = readCloudTokenBundle(provider);
  const bundle = typeof token === "string" ? { accessToken: token } : token;
  const storedBundle: CloudTokenBundle = {
    ...bundle,
    refreshToken: bundle.refreshToken ?? previous?.refreshToken,
  };
  localStorage.setItem(CLOUD_TOKEN_KEY(provider), storedBundle.accessToken);
  localStorage.setItem(CLOUD_TOKEN_META_KEY(provider), JSON.stringify(storedBundle));
}

/** Persist OAuth credentials for a cloud provider. */
export function storeCloudToken(provider: CloudProvider, token: string | CloudTokenBundle): void {
  if (isFactoryResetInProgress()) throw createOAuthCanceledError();
  invalidateCloudCredentials(provider);
  persistCloudToken(provider, token);
  clearFactoryResetCloudCleanupBarrier();
}

/** Retrieve the stored OAuth access token for a cloud provider. */
export function getCloudToken(provider: CloudProvider): string | null {
  return readCloudTokenBundle(provider)?.accessToken ?? null;
}

function shouldRefreshCloudToken(bundle: CloudTokenBundle, now = Date.now()): boolean {
  return typeof bundle.expiresAt === "number"
    && Number.isFinite(bundle.expiresAt)
    && bundle.expiresAt - now <= TOKEN_REFRESH_SKEW_MS;
}

function cloudTokenExpiresInMs(bundle: CloudTokenBundle, now = Date.now()): number | null {
  return typeof bundle.expiresAt === "number" && Number.isFinite(bundle.expiresAt)
    ? bundle.expiresAt - now
    : null;
}

function authFailureStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: number }).status
    : undefined;
}

function nextDeferredBackoffMs(
  attempts: Map<CloudProvider, number>,
  provider: CloudProvider,
  baseMs: number,
  maxMs: number,
): number {
  const nextAttempt = (attempts.get(provider) ?? 0) + 1;
  attempts.set(provider, nextAttempt);
  return Math.min(maxMs, baseMs * 2 ** Math.min(nextAttempt - 1, 6));
}

async function refreshCloudTokenAfterAuthFailure(
  provider: CloudProvider,
  bundle: CloudTokenBundle,
  error: unknown,
): Promise<string | null> {
  const status = authFailureStatus(error);
  if (status !== 401) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[cloud/${provider}] auth failure is not refreshable status=${status ?? "unknown"} reason=${message}`);
    throw error;
  }

  if (!bundle.refreshToken) {
    log.warn(`[cloud/${provider}] auth failure cannot refresh because no refresh token is stored`);
    throw error;
  }

  const now = Date.now();
  const lastRefreshAt = cloudAuthFailureRefreshes.get(provider);
  if (typeof lastRefreshAt === "number" && now - lastRefreshAt < AUTH_FAILURE_REFRESH_COOLDOWN_MS) {
    const ageMs = now - lastRefreshAt;
    log.warn(`[cloud/${provider}] auth failure refresh suppressed age_ms=${ageMs.toLocaleString()}`);
    throw error;
  }

  cloudAuthFailureRefreshes.set(provider, now);
  const expiresInMs = cloudTokenExpiresInMs(bundle, now);
  log.info(
    `[cloud/${provider}] refreshing token after auth failure status=${status} expires_in_ms=${expiresInMs?.toLocaleString() ?? "unknown"}`,
  );
  return refreshCloudToken(provider, bundle);
}

async function refreshCloudToken(provider: CloudProvider, bundle: CloudTokenBundle): Promise<string | null> {
  if (!bundle.refreshToken) return bundle.accessToken;
  const credentialRevision = currentCloudCredentialRevision(provider);
  const existingRefresh = cloudTokenRefreshes.get(provider);
  if (existingRefresh?.credentialRevision === credentialRevision) return existingRefresh.promise;

  const source = captureCloudTokenStorage(provider);
  let refreshPromise!: Promise<string | null>;
  refreshPromise = refreshCloudTokenInner(
    provider,
    bundle,
    credentialRevision,
    source,
  ).finally(() => {
    if (cloudTokenRefreshes.get(provider)?.promise === refreshPromise) {
      cloudTokenRefreshes.delete(provider);
    }
  });
  cloudTokenRefreshes.set(provider, { credentialRevision, promise: refreshPromise });
  return refreshPromise;
}

async function refreshCloudTokenInner(
  provider: CloudProvider,
  bundle: CloudTokenBundle,
  credentialRevision: number,
  source: CloudTokenStorageSnapshot,
): Promise<string | null> {
  const refreshToken = bundle.refreshToken;
  if (!refreshToken) return bundle.accessToken;

  if (provider === "gdrive" && shouldUseGoogleTokenProxy()) {
    const nextBundle = await refreshGoogleTokenViaProxy(refreshToken);
    if (!canCommitCloudTokenRefresh(provider, credentialRevision, source)) return null;
    persistCloudToken(provider, nextBundle);
    return nextBundle.accessToken;
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  let tokenUrl: string;
  if (provider === "gdrive") {
    params.set("client_id", GDRIVE_CLIENT_ID);
    if (GDRIVE_CLIENT_SECRET) {
      params.set("client_secret", GDRIVE_CLIENT_SECRET);
    }
    const refreshed = tokenBundleFromResponse(
      await postGoogleToken(params, "Google token refresh failed"),
      { fallbackTtlMs: GOOGLE_TOKEN_REFRESH_FALLBACK_TTL_MS },
    );
    const nextBundle = {
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? bundle.refreshToken,
    };
    if (!canCommitCloudTokenRefresh(provider, credentialRevision, source)) return null;
    persistCloudToken(provider, nextBundle);
    return nextBundle.accessToken;
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
  if (!canCommitCloudTokenRefresh(provider, credentialRevision, source)) return null;
  persistCloudToken(provider, nextBundle);
  return nextBundle.accessToken;
}

function shouldUseGoogleTokenProxy(): boolean {
  return !!GDRIVE_TOKEN_PROXY_URL && !!GDRIVE_CLIENT_ID && (GDRIVE_FORCE_TOKEN_PROXY || !GDRIVE_CLIENT_SECRET);
}

function tokenBundleFromProxyResponse(data: TokenExchangeResponse): CloudTokenBundle {
  return tokenBundleFromResponse(data, { fallbackTtlMs: GOOGLE_TOKEN_REFRESH_FALLBACK_TTL_MS });
}

function decodeNativeBody(body: number[]): string {
  return new TextDecoder().decode(new Uint8Array(body));
}

function googleOAuthError(prefix: string, status: number, body: string): Error {
  const trimmed = body.trim();
  if (!trimmed) return new Error(`${prefix} (${status})`);
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: string;
      error_description?: string;
      message?: string;
    };
    const detail = parsed.error_description ?? parsed.message ?? parsed.error;
    if (detail) {
      if (detail === "client_secret is missing.") {
        if (prefix.includes("proxy")) {
          return new Error(
            `${prefix} (${status}): client_secret is missing. The Google token proxy is missing its configured Google client secret.`,
          );
        }
        return new Error(
          `${prefix} (${status}): client_secret is missing. Freed Desktop is using direct Google token exchange for an OAuth client that requires a secret. Configure the Google token proxy or provide VITE_GDRIVE_CLIENT_SECRET.`,
        );
      }
      return new Error(`${prefix} (${status}): ${detail}`);
    }
  } catch {
    // Use the raw body below.
  }
  return new Error(`${prefix} (${status}): ${trimmed.slice(0, 500)}`);
}

async function postNativeGoogleOAuth(
  url: string,
  requestBody: string,
  contentType: string,
  errorPrefix: string,
): Promise<TokenExchangeResponse> {
  const response = await invoke<NativeGoogleOAuthResponse>("google_oauth_proxy_request", {
    url,
    body: requestBody,
    contentType,
  });
  const body = decodeNativeBody(response.body);
  if (response.status < 200 || response.status >= 300) {
    throw googleOAuthError(errorPrefix, response.status, body);
  }
  let data: TokenExchangeResponse;
  try {
    data = JSON.parse(body || "{}") as TokenExchangeResponse;
  } catch {
    throw new Error(`${errorPrefix}: invalid JSON response.`);
  }
  return data;
}

async function postGoogleTokenProxy(payload: Record<string, unknown>): Promise<TokenExchangeResponse> {
  return postNativeGoogleOAuth(
    GDRIVE_TOKEN_PROXY_URL,
    JSON.stringify(payload),
    "application/json",
    "Google token proxy failed",
  );
}

async function postGoogleToken(params: URLSearchParams, errorPrefix: string): Promise<TokenExchangeResponse> {
  return postNativeGoogleOAuth(
    GOOGLE_TOKEN_URL,
    params.toString(),
    "application/x-www-form-urlencoded",
    errorPrefix,
  );
}

async function exchangeGoogleCodeViaProxy(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<CloudTokenBundle> {
  const data = await postGoogleTokenProxy({
    code,
    verifier: codeVerifier,
    redirectUri,
    clientId: GDRIVE_CLIENT_ID,
  });
  return tokenBundleFromProxyResponse(data);
}

async function refreshGoogleTokenViaProxy(refreshToken: string): Promise<CloudTokenBundle> {
  const data = await postGoogleTokenProxy({
    grantType: "refresh_token",
    refreshToken,
    clientId: GDRIVE_CLIENT_ID,
  });
  const refreshed = tokenBundleFromProxyResponse(data);
  const nextBundle = {
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? refreshToken,
  };
  return nextBundle;
}

/** Return a non-expired access token when a refresh token is available. */
export async function getValidCloudToken(provider: CloudProvider): Promise<string | null> {
  const bundle = readCloudTokenBundle(provider);
  if (!bundle) return null;
  if (shouldRefreshCloudToken(bundle)) {
    return refreshCloudToken(provider, bundle);
  }
  return bundle.accessToken;
}

async function resolveCloudTokenForGeneration(
  provider: CloudProvider,
  fallbackToken: string | undefined,
  generation: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const snapshot = captureCloudTokenStorage(provider);
  const credentialRevision = currentCloudCredentialRevision(provider);
  const resolvedToken = await getValidCloudToken(provider);
  if (!isCloudGenerationCurrent(provider, generation, signal)) {
    restoreCloudTokenStorageIfStale(
      provider,
      snapshot,
      resolvedToken,
      credentialRevision,
    );
    return null;
  }
  const hadStoredCredentials = snapshot.accessToken !== null || snapshot.metadata !== null;
  return resolvedToken ?? (hadStoredCredentials ? null : fallbackToken ?? null);
}

function createCloudCredentialUnavailableError(provider: CloudProvider): Error {
  const providerName = provider === "gdrive" ? "Google Drive" : "Dropbox";
  return new Error(
    `Stored ${providerName} credentials could not be read. Reconnect ${providerName} to resume sync.`,
  );
}

async function requireCloudTokenForGeneration(
  provider: CloudProvider,
  fallbackToken: string | undefined,
  generation: number,
  signal?: AbortSignal,
): Promise<string> {
  const token = await resolveCloudTokenForGeneration(
    provider,
    fallbackToken,
    generation,
    signal,
  );
  if (!token) throw createCloudCredentialUnavailableError(provider);
  return token;
}

/** Refresh a provider token even when its stored expiry still looks valid. */
export async function forceRefreshCloudToken(provider: CloudProvider): Promise<string | null> {
  const bundle = readCloudTokenBundle(provider);
  if (!bundle) return null;
  if (!bundle.refreshToken) return bundle.accessToken;
  const generation = currentCloudGeneration(provider);
  const snapshot = captureCloudTokenStorage(provider);
  const credentialRevision = currentCloudCredentialRevision(provider);
  const refreshed = await refreshCloudToken(provider, bundle);
  if (!isCloudGenerationCurrent(provider, generation)) {
    restoreCloudTokenStorageIfStale(
      provider,
      snapshot,
      refreshed,
      credentialRevision,
    );
    return null;
  }
  return refreshed;
}

/** Return all supported providers that have a stored access token. */
export function getActiveProviders(): CloudProvider[] {
  const all: CloudProvider[] = ["gdrive"];
  return all.filter((p) => !!getCloudToken(p));
}

/** Clear credentials for a provider and stop its sync loop. */
export function clearCloudProvider(provider: CloudProvider): void {
  invalidateCloudCredentials(provider);
  localStorage.removeItem(CLOUD_TOKEN_KEY(provider));
  localStorage.removeItem(CLOUD_TOKEN_META_KEY(provider));
  cloudAuthFailureRefreshes.delete(provider);
  blockedDestructiveMergeProviders.delete(provider);
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
export function initiateDesktopOAuth(
  provider: CloudProvider,
  options: DesktopOAuthOptions = {},
): Promise<CloudTokenBundle> {
  if (!acceptingDesktopOAuth || isFactoryResetInProgress()) {
    return Promise.reject(createOAuthCanceledError());
  }

  const controller = new AbortController();
  const handleCallerAbort = () => controller.abort();
  options.signal?.addEventListener("abort", handleCallerAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  activeDesktopOAuthControllers.add(controller);

  let tracked: Promise<CloudTokenBundle>;
  tracked = initiateDesktopOAuthInternal(provider, controller.signal).finally(() => {
    options.signal?.removeEventListener("abort", handleCallerAbort);
    activeDesktopOAuthControllers.delete(controller);
    activeDesktopOAuthOperations.delete(tracked);
  });
  activeDesktopOAuthOperations.add(tracked);
  return tracked;
}

/** Abort browser callbacks and wait for issued token requests before destructive reset phases. */
export async function quiesceDesktopOAuthForFactoryReset(): Promise<void> {
  acceptingDesktopOAuth = false;
  for (const controller of activeDesktopOAuthControllers) controller.abort();
  await Promise.allSettled([...activeDesktopOAuthOperations]);
}

async function initiateDesktopOAuthInternal(
  provider: CloudProvider,
  signal: AbortSignal,
): Promise<CloudTokenBundle> {
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
    safeUnlisten(unlisten, "cloud-oauth-code");
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
  return exchangeCode(provider, code, verifier, redirectUri, signal);
}

async function exchangeCode(
  provider: CloudProvider,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  signal: AbortSignal,
): Promise<CloudTokenBundle> {
  throwIfOAuthCanceled(signal);
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  let tokenUrl: string;
  if (provider === "gdrive") {
    if (shouldUseGoogleTokenProxy()) {
      const bundle = await exchangeGoogleCodeViaProxy(code, codeVerifier, redirectUri);
      throwIfOAuthCanceled(signal);
      return bundle;
    }

    params.set("client_id", GDRIVE_CLIENT_ID);
    // Direct token exchange only works without a secret for native desktop
    // OAuth clients. Web clients must use the server token proxy or include the
    // secret in the build environment.
    if (GDRIVE_CLIENT_SECRET) {
      params.set("client_secret", GDRIVE_CLIENT_SECRET);
    }
    const bundle = tokenBundleFromResponse(
      await postGoogleToken(params, "Google token exchange failed"),
    );
    throwIfOAuthCanceled(signal);
    return bundle;
  } else {
    params.set("client_id", DROPBOX_CLIENT_ID);
    tokenUrl = "https://api.dropboxapi.com/oauth2/token";
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal,
  });
  throwIfOAuthCanceled(signal);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  const bundle = tokenBundleFromResponse((await res.json()) as TokenExchangeResponse);
  throwIfOAuthCanceled(signal);
  return bundle;
}

// ─── Sync loops ───────────────────────────────────────────────────────────────

async function runInitialCloudDownload(
  provider: CloudProvider,
  signal: AbortSignal,
  resolveToken: () => Promise<string>,
  generation: number,
): Promise<{ needsStartupRepair: boolean; uploadToken: string } | null> {
  const startedAt = Date.now();
  markCloudAttempt(provider, "download", "Checking cloud storage for remote changes.");
  let remote: Uint8Array | null;
  let uploadToken: string;
  try {
    const resolvedToken = await resolveToken();
    if (!isCloudGenerationCurrent(provider, generation, signal)) return null;
    uploadToken = resolvedToken;
    remote = provider === "gdrive"
      ? await gdriveDownloadLatest(resolvedToken, signal, googleDriveFetch)
      : await dropboxDownloadLatest(resolvedToken, signal);
    if (!isCloudGenerationCurrent(provider, generation, signal)) return null;
  } catch (error) {
    if (!isCloudGenerationCurrent(provider, generation, signal)) return null;
    const status = authFailureStatus(error);
    if (provider !== "gdrive" || status !== 401) throw error;
    markCloudAttempt(provider, "auth", "Refreshing Google Drive token after an auth response.");
    const fallbackToken = await resolveToken();
    if (!isCloudGenerationCurrent(provider, generation, signal)) return null;
    const refreshSnapshot = captureCloudTokenStorage("gdrive");
    const refreshCredentialRevision = currentCloudCredentialRevision("gdrive");
    const authBundle = readCloudTokenBundleForAuthFailure("gdrive", fallbackToken);
    if (!authBundle) throw createCloudCredentialUnavailableError("gdrive");
    const refreshed = await refreshCloudTokenAfterAuthFailure("gdrive", authBundle, error);
    if (!isCloudGenerationCurrent(provider, generation, signal)) {
      restoreCloudTokenStorageIfStale(
        "gdrive",
        refreshSnapshot,
        refreshed,
        refreshCredentialRevision,
      );
      return null;
    }
    if (!refreshed) throw error;
    uploadToken = refreshed;
    markCloudAttempt(provider, "download", "Retrying cloud download after token refresh.");
    remote = await gdriveDownloadLatest(refreshed, signal, googleDriveFetch);
    if (!isCloudGenerationCurrent(provider, generation, signal)) return null;
  }
  if (remote) {
    const relation = await compareDoc(remote);
    if (!isCloudGenerationCurrent(provider, generation, signal)) return null;
    const needsStartupRepair = relation === "local-ahead" || relation === "diverged";
    markCloudAttempt(provider, "merge", "Merging remote document into the local library.");
    await mergeDoc(remote);
    if (!isCloudGenerationCurrent(provider, generation, signal)) return null;
    cloudInitialDownloadDeferredAttempts.delete(provider);
    console.log("[CloudSync/%s] Initial merge (%d bytes)", provider, remote.length);
    addDebugEvent("received", `[Cloud/${provider}] initial download`, remote.length);
    markCloudSuccess(provider, {
      stage: "idle",
      lastDownloadAt: Date.now(),
      lastMergeAt: Date.now(),
      lastRemoteBytes: remote.length,
      statusMessage: "Remote changes merged.",
      pendingReason: "Waiting for local document changes or Sync now.",
      eventMessage: `Downloaded and merged ${remote.length.toLocaleString()} bytes.`,
      eventBytes: remote.length,
    });
    await recordProviderHealthEvent({
      provider,
      outcome: "success",
      stage: "download",
      startedAt,
      finishedAt: Date.now(),
      bytesMoved: remote.length,
    });
    return { needsStartupRepair, uploadToken };
  } else {
    cloudInitialDownloadDeferredAttempts.delete(provider);
    // Empty cloud: whatever heads we recorded from an earlier connection are
    // not what the cloud holds. Clear them so the P1-01 guard cannot skip the
    // first upload of this connection.
    lastSuccessfulUploadHeadsByProvider.delete(provider);
    markCloudSuccess(provider, {
      stage: "idle",
      lastDownloadAt: Date.now(),
      lastRemoteBytes: 0,
      statusMessage: "No remote changes found.",
      pendingReason: "Waiting for local document changes or Sync now.",
      eventMessage: "Checked cloud storage. No remote changes found.",
    });
    await recordProviderHealthEvent({
      provider,
      outcome: "empty",
      stage: "download",
      reason: "No remote changes",
      startedAt,
      finishedAt: Date.now(),
    });
    return { needsStartupRepair: true, uploadToken };
  }
}

async function runStartupCloudReconciliation(
  provider: CloudProvider,
  signal: AbortSignal,
  resolveToken: () => Promise<string>,
  generation: number,
): Promise<void> {
  const result = await runInitialCloudDownload(provider, signal, resolveToken, generation);
  if (
    !result?.needsStartupRepair
    || !isCloudGenerationCurrent(provider, generation, signal)
    || cloudStartupRepairGeneration.get(provider) === generation
  ) {
    return;
  }

  cloudStartupRepairGeneration.set(provider, generation);
  await performCloudUpload(provider, result.uploadToken, {
    cause: "startup-repair",
    generation,
  });
}

function scheduleInitialCloudDownloadRetry(
  provider: CloudProvider,
  token: string,
  reason: string,
  generation: number,
): void {
  const delayMs = nextDeferredBackoffMs(
    cloudInitialDownloadDeferredAttempts,
    provider,
    INITIAL_DOWNLOAD_DEFER_BACKOFF_BASE_MS,
    INITIAL_DOWNLOAD_DEFER_BACKOFF_MAX_MS,
  );
  const displayReason = formatBackgroundRuntimeDeferredReason(reason);
  addDebugEvent(
    "change",
    `[Cloud/${provider}] initial download deferred: ${displayReason} Retry in ${delayMs.toLocaleString()} ms.`,
  );
  const existing = initialDownloadTimers.get(provider);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    initialDownloadTimers.delete(provider);
    const controller = cloudAborts.get(provider);
    if (!controller || !isCloudGenerationCurrent(provider, generation, controller.signal)) return;
    const deferredAttempts = cloudInitialDownloadDeferredAttempts.get(provider);
    const restart = startCloudSync(provider, token);
    if (deferredAttempts !== undefined) {
      cloudInitialDownloadDeferredAttempts.set(provider, deferredAttempts);
    }
    void restart.catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      addDebugEvent("error", `[Cloud/${provider}] initial download retry failed: ${msg}`);
    });
  }, delayMs);
  initialDownloadTimers.set(provider, timer);
}

function isActiveRuntimeReason(reason: string): boolean {
  return reason.startsWith("active:");
}

function nextUploadRetryMs(provider: CloudProvider, reason: string): number {
  if (isActiveRuntimeReason(reason)) {
    return UPLOAD_ACTIVE_JOB_RETRY_MS;
  }
  return nextDeferredBackoffMs(
    cloudUploadDeferredAttempts,
    provider,
    UPLOAD_DEFER_BACKOFF_BASE_MS,
    UPLOAD_DEFER_BACKOFF_MAX_MS,
  );
}

/**
 * Start the cloud sync loop for a single provider.
 * Downloads the latest remote state immediately, then runs the appropriate
 * poll/longpoll loop in the background. Also subscribes to local doc changes
 * so every mutation is uploaded back to the cloud (debounced).
 */
export async function startCloudSync(provider: CloudProvider, token: string): Promise<void> {
  stopCloudSync(provider);
  if (hasFactoryResetCloudCleanupBarrier()) return;
  if (cloudDeletesInProgress.has(provider)) return;
  const generation = currentCloudGeneration(provider);
  const controller = new AbortController();
  cloudAborts.set(provider, controller);
  const { signal } = controller;
  const resolveToken = () =>
    requireCloudTokenForGeneration(provider, token, generation, signal);

  // Immediate pull to catch up on any changes since last session.
  try {
    const reconciliation = runBackgroundJob({
      kind: "cloud-sync",
      source: `cloud:${provider}:initial-download`,
      timeoutMs: 180_000,
      run: () => runStartupCloudReconciliation(provider, signal, resolveToken, generation),
    });
    await trackCloudOperation(provider, reconciliation);
  } catch (err) {
    if (!signal.aborted && isBackgroundRuntimeDeferredError(err)) {
      scheduleInitialCloudDownloadRetry(provider, token, err.reason, generation);
      return;
    } else if (!signal.aborted) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudSync/${provider}] Initial download failed:`, err);
      addDebugEvent("error", `[Cloud/${provider}] initial download failed: ${msg}`);
      markCloudError(provider, "download", err);
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

  if (signal.aborted) return;
  if (preserveDestructiveMergeBlock(provider)) return;

  const handleRemoteChange = async (binary: Uint8Array) => {
    if (!isCloudGenerationCurrent(provider, generation, signal)) return;
    try {
      markCloudAttempt(provider, "merge");
      await mergeDoc(binary);
      if (!isCloudGenerationCurrent(provider, generation, signal)) return;
      console.log("[CloudSync/%s] Merged remote change (%d bytes)", provider, binary.length);
      addDebugEvent("received", `[Cloud/${provider}] remote change`, binary.length);
      markCloudSuccess(provider, {
        stage: "idle",
        lastDownloadAt: Date.now(),
        lastMergeAt: Date.now(),
        lastRemoteBytes: binary.length,
      });
      await recordProviderHealthEvent({
        provider,
        outcome: "success",
        stage: "merge",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        bytesMoved: binary.length,
      });
    } catch (err) {
      if (!isCloudGenerationCurrent(provider, generation, signal)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudSync/${provider}] Merge failed:`, err);
      addDebugEvent("merge_err", `[Cloud/${provider}] merge failed: ${msg}`);
      markCloudError(provider, "merge", err);
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
  const onRemoteChange = (binary: Uint8Array) =>
    trackCloudOperation(provider, handleRemoteChange(binary));

  const cloudLog = (level: "info" | "warn" | "error", msg: string) => {
    log[level](msg);
    if (level === "warn" || level === "error") {
      addDebugEvent("error", msg);
    }
  };

  const initialPollToken = await resolveToken();
  if (!isCloudGenerationCurrent(provider, generation, signal)) return;
  if (provider === "gdrive") {
    const runGDrivePollLoop = async (firstToken: string) => {
      let pollToken = firstToken;
      while (isCloudGenerationCurrent(provider, generation, signal)) {
        try {
          await gdriveStartPollLoop(pollToken, onRemoteChange, signal, cloudLog, googleDriveFetch);
          return;
        } catch (error) {
          if (!isCloudGenerationCurrent(provider, generation, signal)) return;
          const status = authFailureStatus(error);
          if (status !== 401 && status !== 403) throw error;
          const refreshSnapshot = captureCloudTokenStorage("gdrive");
          const refreshCredentialRevision = currentCloudCredentialRevision("gdrive");
          const authBundle = readCloudTokenBundleForAuthFailure("gdrive", pollToken);
          if (!authBundle) throw createCloudCredentialUnavailableError("gdrive");
          const refreshed = await refreshCloudTokenAfterAuthFailure("gdrive", authBundle, error);
          if (!isCloudGenerationCurrent(provider, generation, signal)) {
            restoreCloudTokenStorageIfStale(
              "gdrive",
              refreshSnapshot,
              refreshed,
              refreshCredentialRevision,
            );
            return;
          }
          pollToken = await resolveToken();
          if (!isCloudGenerationCurrent(provider, generation, signal)) return;
        }
      }
    };

    runGDrivePollLoop(initialPollToken).catch(async (err) => {
      if (isCloudGenerationCurrent(provider, generation, signal)) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[cloud/gdrive] poll loop crashed: ${msg}`);
        addDebugEvent("error", `[Cloud/gdrive] poll loop crashed: ${msg}`);
        markCloudError("gdrive", "poll", err);
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
    dropboxStartLongpollLoop(initialPollToken, onRemoteChange, signal, cloudLog).catch(async (err) => {
      if (isCloudGenerationCurrent(provider, generation, signal)) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[cloud/dropbox] longpoll loop crashed: ${msg}`);
        addDebugEvent("error", `[Cloud/dropbox] longpoll loop crashed: ${msg}`);
        markCloudError("dropbox", "poll", err);
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
  //
  // P1-01 damper (F01/F06): MERGE_DOC/REPLACE_DOC events are cloud- or
  // relay-sourced, not user edits. Scheduling unconditionally on them is the
  // self-sustaining loop — after every safe upload the merge-back emits a
  // STATE_UPDATE tagged MERGE_DOC, which re-scheduled the next upload
  // forever. Those events only upload when the heads actually moved past the
  // last successful upload; every other mutation schedules as before.
  const unsubscribe = subscribe((_state, event) => {
    if (!isCloudGenerationCurrent(provider, generation, signal)) return;
    if (event.mutation === "MERGE_DOC" || event.mutation === "REPLACE_DOC") {
      void scheduleCloudUploadIfHeadsMoved(provider, generation);
      return;
    }
    scheduleCloudUpload(provider, undefined, generation);
  });
  cloudChangeUnsubscribes.set(provider, unsubscribe);
  updateCloudProvider(provider, {
    status: "connected",
    stage: "idle",
    statusMessage: "Watching for sync changes.",
    pendingReason: "Next upload starts after a local document change or Sync now.",
  });
  recordCloudStep(provider, "waiting", "idle", "Watching for local document changes.");

  console.log("[CloudSync] Started (%s)", provider);
}

/** Stop the cloud sync loop for a provider. */
export function stopCloudSync(provider: CloudProvider): void {
  invalidateCloudGeneration(provider);
  cloudAborts.get(provider)?.abort();
  cloudAborts.delete(provider);
  for (const controller of cloudTransientAborts.get(provider) ?? []) {
    controller.abort();
  }
  cloudTransientAborts.delete(provider);
  updateCloudProvider(provider, {
    status: "idle",
    stage: "idle",
    statusMessage: "Cloud sync stopped.",
    pendingReason: "Reconnect Google Drive to resume cloud sync.",
  });
  recordCloudStep(provider, "waiting", "idle", "Cloud sync stopped.");

  const timer = uploadTimers.get(provider);
  if (timer) {
    clearTimeout(timer);
    uploadTimers.delete(provider);
  }

  const initialTimer = initialDownloadTimers.get(provider);
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialDownloadTimers.delete(provider);
  }

  cloudUploadDeferredAttempts.delete(provider);
  cloudInitialDownloadDeferredAttempts.delete(provider);
  cloudChangeUnsubscribes.get(provider)?.();
  cloudChangeUnsubscribes.delete(provider);
}

/** Stop all active cloud sync loops. */
export function stopAllCloudSyncs(): void {
  for (const provider of ["gdrive", "dropbox"] as const) {
    stopCloudSync(provider);
  }
}

/**
 * Delete the cloud sync file for the given provider.
 * Stops the sync loop first to prevent a race with any in-flight upload.
 * Used during factory reset when the user opts to also wipe cloud storage.
 */
export async function deleteCloudFile(provider: CloudProvider, token: string): Promise<void> {
  cloudDeletesInProgress.add(provider);
  try {
    stopCloudSync(provider);
    await waitForCloudSettlement(provider);
    if (provider === "gdrive") {
      await gdriveDeleteFile(token, googleDriveFetch);
    } else {
      await dropboxDeleteFile(token);
    }
    // The cloud no longer holds the recorded state; the P1-01 heads guard must
    // not suppress the next upload after a reconnect.
    lastSuccessfulUploadHeadsByProvider.delete(provider);
  } finally {
    cloudDeletesInProgress.delete(provider);
  }
}

/** Delete the active cloud copies, then clear credentials only after all deletions succeed. */
export async function clearStoredCloudDataForFactoryReset(
  deleteFromCloud: boolean,
): Promise<void> {
  beginFactoryResetCloudCleanup();
  await clearStoredCloudProvidersForFactoryReset({
    providers: getActiveProviders(),
    deleteFromCloud,
    getStoredToken: getCloudToken,
    deleteCloudFile,
    clearStoredCredentials: clearCloudProvider,
  });
}

export type CloudConflictWinner = "local" | "cloud";

/**
 * Resolve a blocked destructive merge by making one document authoritative.
 * Local wins deletes the cloud file first, then uploads this device's current
 * Automerge binary. Cloud wins downloads the cloud binary and replaces this
 * device's local document instead of merging it.
 */
export async function resolveCloudSyncConflict(
  provider: CloudProvider,
  winner: CloudConflictWinner,
): Promise<void> {
  const lifecycle = captureCloudLifecycle(provider);
  const generationBeforeToken = currentCloudGeneration(provider);
  const token = await resolveCloudTokenForGeneration(provider, undefined, generationBeforeToken);
  if (!lifecycle.isCurrent()) return;
  if (!token) throw new Error("Cloud token missing. Reconnect the provider.");

  const blockedMergeMessage = blockedDestructiveMergeProviders.get(provider);
  blockedDestructiveMergeProviders.delete(provider);
  stopCloudSync(provider);
  const generation = currentCloudGeneration(provider);
  updateCloudProvider(provider, {
    status: "connected",
    stage: winner === "local" ? "upload" : "download",
    statusMessage: winner === "local"
      ? "Replacing the cloud backup with this device."
      : "Replacing this device with the cloud backup.",
    pendingReason: "Applying the selected sync recovery path.",
    error: undefined,
  });
  recordCloudStep(
    provider,
    "queued",
    winner === "local" ? "upload" : "download",
    winner === "local"
      ? "Sync recovery requested. This device will replace the cloud backup."
      : "Sync recovery requested. The cloud backup will replace this device.",
  );

  try {
    if (winner === "local") {
      await runBackgroundJob({
        kind: "cloud-sync",
        source: `cloud:${provider}:conflict-local-wins`,
        timeoutMs: 180_000,
        waitForActiveJobMs: CONFLICT_RECOVERY_ACTIVE_JOB_WAIT_MS,
        run: async () => {
          await performCloudUpload(provider, token, {
            authoritativeReplace: true,
            cause: "manual",
            generation,
          });
        },
      });
      if (!isCloudGenerationCurrent(provider, generation)) return;
      await startCloudSync(provider, token);
      updateCloudProvider(provider, {
        status: "connected",
        stage: "idle",
        statusMessage: "This device replaced the cloud backup.",
        pendingReason: "Waiting for local document changes or Sync now.",
        error: undefined,
      });
      recordCloudStep(provider, "success", "idle", "This device replaced the cloud backup.");
      return;
    }

    const controller = new AbortController();
    const removeTransientAbort = addTransientCloudAbort(provider, controller);
    const recovery = runBackgroundJob({
      kind: "cloud-sync",
      source: `cloud:${provider}:conflict-cloud-wins`,
      timeoutMs: 180_000,
      waitForActiveJobMs: CONFLICT_RECOVERY_ACTIVE_JOB_WAIT_MS,
      run: async () => {
        const remote = provider === "gdrive"
          ? await gdriveDownloadLatest(token, controller.signal, googleDriveFetch)
          : await dropboxDownloadLatest(token, controller.signal);
        if (!isCloudGenerationCurrent(provider, generation, controller.signal)) return;
        if (!remote) throw new Error("No cloud backup found.");
        await replaceLocalDoc(remote);
      },
    });
    try {
      await trackCloudOperation(provider, recovery);
    } finally {
      removeTransientAbort();
    }
    if (!isCloudGenerationCurrent(provider, generation)) return;
    await startCloudSync(provider, token);
    updateCloudProvider(provider, {
      status: "connected",
      stage: "idle",
      statusMessage: "This device now uses the cloud backup.",
      pendingReason: "Waiting for local document changes or Sync now.",
      error: undefined,
    });
    recordCloudStep(provider, "success", "idle", "This device now uses the cloud backup.");
  } catch (error) {
    if (!isCloudGenerationCurrent(provider, generation)) return;
    if (isBackgroundRuntimeDeferredError(error) && blockedMergeMessage) {
      const pendingReason = formatBackgroundRuntimeDeferredReason(error.reason);
      blockedDestructiveMergeProviders.set(provider, blockedMergeMessage);
      updateCloudProvider(provider, {
        status: "error",
        stage: "idle",
        error: blockedMergeMessage,
        statusMessage: blockedMergeMessage,
        pendingReason,
        lastErrorAt: Date.now(),
      });
      recordCloudStep(provider, "deferred", "idle", `Sync recovery deferred: ${pendingReason}`);
      throw error;
    }
    markCloudError(provider, winner === "local" ? "upload" : "download", error);
    throw error;
  }
}

/**
 * Heads at the previous upload attempt, per provider. An attempt whose heads
 * match is the cloud-loop signature counted by cloud_upload_attempt (F01/F06).
 */
const lastUploadHeadsByProvider = new Map<CloudProvider, string>();

/**
 * Heads represented by the local binary supplied to the last successful
 * upload, per provider. These must come from the same stable snapshot as the
 * bytes. Reading live heads after the request can mislabel an edit made while
 * the upload was in flight as already backed up.
 *
 * Distinct from lastUploadHeadsByProvider above, which is attempt-time
 * telemetry for the cloud_upload_attempt counter and must keep measuring
 * attempts as they happen.
 */
const lastSuccessfulUploadHeadsByProvider = new Map<CloudProvider, string>();

const CLOUD_DOCUMENT_SNAPSHOT_MAX_ATTEMPTS = 3;

interface CloudDocumentSnapshot {
  binary: Uint8Array;
  representedHeads: string[] | null;
  representedHeadsKey: string | null;
}

function headsKey(heads: string[] | null): string | null {
  return heads && heads.length > 0 ? heads.join(",") : null;
}

/** Current doc heads as a comparable key, or null when unavailable. */
async function currentHeadsKey(): Promise<string | null> {
  return headsKey(await getDocHeads());
}

/**
 * Capture bytes with the heads they represent. The worker serializes these
 * requests, so equal heads immediately before and after getDocBinary prove
 * that no document change crossed the binary read. If the document keeps
 * moving, return the latest bytes without represented heads. That makes the
 * upload damper fail open and prevents a newer edit from being marked as
 * already uploaded.
 */
async function captureCloudDocumentSnapshot(): Promise<CloudDocumentSnapshot> {
  let latestBinary: Uint8Array | null = null;

  for (let attempt = 0; attempt < CLOUD_DOCUMENT_SNAPSHOT_MAX_ATTEMPTS; attempt += 1) {
    let headsBefore: string[] | null;
    try {
      headsBefore = await getDocHeads();
    } catch {
      return {
        binary: await getDocBinary(),
        representedHeads: null,
        representedHeadsKey: null,
      };
    }

    latestBinary = await getDocBinary();

    let headsAfter: string[] | null;
    try {
      headsAfter = await getDocHeads();
    } catch {
      return {
        binary: latestBinary,
        representedHeads: null,
        representedHeadsKey: null,
      };
    }

    const beforeKey = headsKey(headsBefore);
    const afterKey = headsKey(headsAfter);
    if (beforeKey !== null && beforeKey === afterKey) {
      return {
        binary: latestBinary,
        representedHeads: headsAfter,
        representedHeadsKey: afterKey,
      };
    }
  }

  return {
    binary: latestBinary ?? await getDocBinary(),
    representedHeads: null,
    representedHeadsKey: null,
  };
}

/**
 * P1-01 belt-and-suspenders (F01/F06): called for MERGE_DOC/REPLACE_DOC
 * subscriber events instead of scheduling unconditionally. Schedules only
 * when the doc heads moved past the last successful upload. A genuine merge
 * that changed local state still uploads. A safe-upload merge-back with
 * unchanged heads does not. A merge-back that adds remote heads gets one
 * conservative follow-up upload.
 */
async function scheduleCloudUploadIfHeadsMoved(
  provider: CloudProvider,
  generation = currentCloudGeneration(provider),
): Promise<void> {
  if (!isCloudGenerationCurrent(provider, generation)) return;
  try {
    const headsKey = await currentHeadsKey();
    if (!isCloudGenerationCurrent(provider, generation)) return;
    const lastUploaded = lastSuccessfulUploadHeadsByProvider.get(provider) ?? null;
    if (headsKey !== null && headsKey === lastUploaded) {
      recordCloudUploadSkipped({ provider, cause: "subscriber", reason: "merge_heads_unchanged" });
      return;
    }
  } catch {
    // Heads unavailable: prefer a redundant upload over a missed one.
  }
  scheduleCloudUpload(provider, undefined, generation);
}

/** Record only the heads proven to be represented by the uploaded bytes. */
function recordSuccessfulUploadSnapshot(
  provider: CloudProvider,
  snapshot: CloudDocumentSnapshot,
): void {
  if (snapshot.representedHeadsKey === null) {
    // An unproven snapshot must clear any older marker. A redundant upload is
    // safe, while suppressing an upload for unrepresented edits is not.
    lastSuccessfulUploadHeadsByProvider.delete(provider);
    return;
  }
  lastSuccessfulUploadHeadsByProvider.set(provider, snapshot.representedHeadsKey);
}

async function recordCloudUploadAttemptCounters(
  provider: CloudProvider,
  cause: CloudUploadCause,
  snapshot: CloudDocumentSnapshot,
): Promise<void> {
  try {
    const attemptHeadsKey = snapshot.representedHeadsKey;
    const previousKey = lastUploadHeadsByProvider.get(provider) ?? null;
    if (attemptHeadsKey !== null) {
      lastUploadHeadsByProvider.set(provider, attemptHeadsKey);
    }
    recordCloudUploadAttempt({
      provider,
      cause,
      headsBefore: snapshot.representedHeads,
      headsUnchanged: attemptHeadsKey !== null && attemptHeadsKey === previousKey,
    });
  } catch {
    // Counters never block or fail an upload.
  }
}

async function runCloudUpload(
  provider: CloudProvider,
  token: string | undefined,
  options: {
    authoritativeReplace?: boolean;
    cause?: CloudUploadCause;
    generation: number;
  },
): Promise<void> {
  const startedAt = Date.now();
  let byteLength = 0;
  try {
    if (!isCloudGenerationCurrent(provider, options.generation)) return;
    const cause = options.cause ?? "subscriber";
    // P1-01 damper, execution-time check: the debounced timer may have been
    // armed by a merge-back event that raced ahead of the post-upload heads
    // record. Re-check at fire time and skip when nothing moved since the
    // last successful upload. Manual "Sync now" and authoritative replaces
    // always upload.
    if (cause === "subscriber" && !options.authoritativeReplace) {
      try {
        const headsKey = await currentHeadsKey();
        if (!isCloudGenerationCurrent(provider, options.generation)) return;
        if (headsKey !== null && headsKey === lastSuccessfulUploadHeadsByProvider.get(provider)) {
          recordCloudUploadSkipped({ provider, cause, reason: "execution_heads_unchanged" });
          updateCloudProvider(provider, {
            status: "connected",
            stage: "idle",
            statusMessage: "Nothing new to upload.",
            pendingReason: "Waiting for local document changes or Sync now.",
          });
          recordCloudStep(provider, "waiting", "idle", "Skipped upload: no changes since the last upload.");
          return;
        }
      } catch {
        // Heads unavailable: fall through and upload (redundant beats missed).
      }
    }
    const snapshot = await captureCloudDocumentSnapshot();
    if (!isCloudGenerationCurrent(provider, options.generation)) return;
    const { binary } = snapshot;
    byteLength = binary.byteLength;
    await recordCloudUploadAttemptCounters(provider, cause, snapshot);
    if (!isCloudGenerationCurrent(provider, options.generation)) return;
    const uploadToken = await requireCloudTokenForGeneration(
      provider,
      token,
      options.generation,
    );
    if (!isCloudGenerationCurrent(provider, options.generation)) return;
    markCloudAttempt(provider, "upload", "Uploading local document to cloud storage.");
    if (provider === "gdrive") {
      const result = options.authoritativeReplace
        ? await gdriveUploadReplace(uploadToken, binary, googleDriveFetch)
        : await gdriveUploadSafe(uploadToken, binary, googleDriveFetch);
      if (!isCloudGenerationCurrent(provider, options.generation)) return;
      if (result.mergedRemote) {
        markCloudAttempt(provider, "merge", "Merging remote data discovered during upload.");
        await mergeDoc(result.uploadedBinary);
        if (!isCloudGenerationCurrent(provider, options.generation)) return;
      }
      // Record the heads represented by the bytes supplied to this request.
      // A merge-back or local edit that moved beyond that snapshot schedules
      // one follow-up upload instead of being mistaken for backed-up state.
      recordSuccessfulUploadSnapshot(provider, snapshot);
      if (!isCloudGenerationCurrent(provider, options.generation)) return;
      markCloudSuccess(provider, {
        stage: "idle",
        lastUploadAt: Date.now(),
        lastMergeAt: result.mergedRemote ? Date.now() : undefined,
        lastRemoteBytes: result.remoteBytes,
        lastUploadedBytes: result.uploadedBytes,
        lastLocalBytes: binary.byteLength,
        statusMessage: "Upload complete.",
        pendingReason: "Waiting for local document changes or Sync now.",
        eventMessage: `Uploaded ${result.uploadedBytes.toLocaleString()} bytes.`,
        eventBytes: result.uploadedBytes,
      });
    } else {
      if (options.authoritativeReplace) {
        await dropboxUploadReplace(uploadToken, binary);
      } else {
        await dropboxUploadSafe(uploadToken, binary);
      }
      if (!isCloudGenerationCurrent(provider, options.generation)) return;
      recordSuccessfulUploadSnapshot(provider, snapshot);
      if (!isCloudGenerationCurrent(provider, options.generation)) return;
      markCloudSuccess(provider, {
        stage: "idle",
        lastUploadAt: Date.now(),
        lastUploadedBytes: binary.byteLength,
        lastLocalBytes: binary.byteLength,
        statusMessage: "Upload complete.",
        pendingReason: "Waiting for local document changes or Sync now.",
        eventMessage: `Uploaded ${binary.byteLength.toLocaleString()} bytes.`,
        eventBytes: binary.byteLength,
      });
    }
    cloudUploadDeferredAttempts.delete(provider);
    console.log("[CloudSync/%s] Uploaded (%d bytes)", provider, binary.byteLength);
    addDebugEvent("sent", `[Cloud/${provider}] upload`, binary.byteLength);
    await recordProviderHealthEvent({
      provider,
      outcome: "success",
      stage: "upload",
      startedAt,
      finishedAt: Date.now(),
      bytesMoved: byteLength,
    });
  } catch (err) {
    if (!isCloudGenerationCurrent(provider, options.generation)) return;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[CloudSync/${provider}] Upload failed:`, err);
    addDebugEvent("error", `[Cloud/${provider}] upload failed: ${msg}`);
    markCloudError(provider, "upload", err);
    await recordProviderHealthEvent({
      provider,
      outcome: "error",
      stage: "upload",
      reason: msg,
      startedAt,
      finishedAt: Date.now(),
      bytesMoved: byteLength,
    });
    throw err;
  }
}

function performCloudUpload(
  provider: CloudProvider,
  token?: string,
  options: {
    authoritativeReplace?: boolean;
    cause?: CloudUploadCause;
    generation?: number;
  } = {},
): Promise<void> {
  const generation = options.generation ?? currentCloudGeneration(provider);
  return trackCloudUpload(
    provider,
    runCloudUpload(provider, token, { ...options, generation }),
  );
}

/**
 * Schedule a debounced upload for a provider.
 * Called from the worker-backed document subscription so every local change
 * can trigger a cloud backup. Debouncing prevents a flood of uploads during
 * rapid edits.
 */
export function scheduleCloudUpload(
  provider: CloudProvider,
  token?: string,
  generation = currentCloudGeneration(provider),
): void {
  if (!isCloudGenerationCurrent(provider, generation)) return;
  if (preserveDestructiveMergeBlock(provider)) return;

  const existing = uploadTimers.get(provider);
  if (existing) clearTimeout(existing);
  updateCloudProvider(provider, {
    status: "connected",
    stage: "idle",
    statusMessage: "Upload queued.",
    pendingReason: `Waiting ${UPLOAD_DEBOUNCE_MS.toLocaleString()} ms for local changes to settle.`,
    error: undefined,
  });
  recordCloudStep(provider, "queued", "upload", "Upload queued after a local document change.");

  const timer = setTimeout(async () => {
    uploadTimers.delete(provider);
    if (!isCloudGenerationCurrent(provider, generation)) return;
    void scheduleSideEffect({
      queue: "sync",
      source: `cloud:${provider}`,
      kind: "upload",
      timeoutMs: 180_000,
      slowMs: 2_000,
      run: () =>
        runBackgroundJob({
          kind: "cloud-sync",
          source: `cloud:${provider}`,
          timeoutMs: 180_000,
          waitForActiveJobMs: UPLOAD_ACTIVE_JOB_WAIT_MS,
          waitForActiveJobKinds: UPLOAD_WAIT_FOR_ACTIVE_JOB_KINDS,
          run: () => performCloudUpload(provider, token, { generation }),
        }).catch((error) => {
          if (!isCloudGenerationCurrent(provider, generation)) return;
          if (isBackgroundRuntimeDeferredError(error)) {
            const delayMs = nextUploadRetryMs(provider, error.reason);
            const displayReason = formatBackgroundRuntimeDeferredReason(error.reason);
            addDebugEvent(
              "change",
              `[Cloud/${provider}] upload deferred: ${displayReason} Retry in ${delayMs.toLocaleString()} ms.`,
            );
            updateCloudProvider(provider, {
              status: "connected",
              stage: "idle",
              statusMessage: "Upload deferred.",
              pendingReason: `${displayReason} Retrying in ${delayMs.toLocaleString()} ms.`,
            });
            recordCloudStep(
              provider,
              "deferred",
              "upload",
              `Upload deferred: ${displayReason} Retrying in ${delayMs.toLocaleString()} ms.`,
            );
            const retryTimer = setTimeout(() => {
              uploadTimers.delete(provider);
              if (!isCloudGenerationCurrent(provider, generation)) return;
              scheduleCloudUpload(provider, token, generation);
            }, delayMs);
            uploadTimers.set(provider, retryTimer);
            return;
          }
          throw error;
        }),
    });
  }, UPLOAD_DEBOUNCE_MS);

  uploadTimers.set(provider, timer);
}

/** Run an immediate cloud sync pass without waiting for the debounce timer. */
export async function syncCloudProviderNow(provider: CloudProvider): Promise<void> {
  if (preserveDestructiveMergeBlock(provider)) {
    throw new Error("Choose which copy should win before cloud sync retries.");
  }

  const generation = currentCloudGeneration(provider);
  const token = await resolveCloudTokenForGeneration(provider, undefined, generation);
  if (!isCloudGenerationCurrent(provider, generation)) return;
  if (!token) throw new Error("Cloud token missing. Reconnect the provider.");

  const existingTimer = uploadTimers.get(provider);
  if (existingTimer) {
    clearTimeout(existingTimer);
    uploadTimers.delete(provider);
  }

  const activeController = cloudAborts.get(provider);
  const controller = activeController ?? new AbortController();
  const removeTransientAbort = activeController
    ? () => {}
    : addTransientCloudAbort(provider, controller);
  const signal = controller.signal;
  recordCloudStep(provider, "queued", "idle", "Manual sync requested.");
  updateCloudProvider(provider, {
    status: "connected",
    stage: "idle",
    statusMessage: "Manual sync requested.",
    pendingReason: "Checking cloud storage, then uploading the local document.",
    error: undefined,
  });

  try {
    const download = runBackgroundJob({
      kind: "cloud-sync",
      source: `cloud:${provider}:manual-download`,
      timeoutMs: 180_000,
      waitForActiveJobMs: UPLOAD_ACTIVE_JOB_WAIT_MS,
      waitForActiveJobKinds: UPLOAD_WAIT_FOR_ACTIVE_JOB_KINDS,
      run: () => runInitialCloudDownload(provider, signal, () =>
        requireCloudTokenForGeneration(
          provider,
          token,
          generation,
          signal,
        ), generation),
    });
    await trackCloudOperation(provider, download);
    if (!isCloudGenerationCurrent(provider, generation, signal)) return;
    await runBackgroundJob({
      kind: "cloud-sync",
      source: `cloud:${provider}:manual-upload`,
      timeoutMs: 180_000,
      waitForActiveJobMs: UPLOAD_ACTIVE_JOB_WAIT_MS,
      waitForActiveJobKinds: UPLOAD_WAIT_FOR_ACTIVE_JOB_KINDS,
      run: () => performCloudUpload(provider, undefined, { cause: "manual", generation }),
    });
  } catch (error) {
    if (!isCloudGenerationCurrent(provider, generation, signal)) return;
    if (isBackgroundRuntimeDeferredError(error)) {
      const displayReason = formatBackgroundRuntimeDeferredReason(error.reason);
      updateCloudProvider(provider, {
        status: "connected",
        stage: "idle",
        statusMessage: "Manual sync deferred.",
        pendingReason: displayReason,
      });
      recordCloudStep(provider, "deferred", "idle", `Manual sync deferred: ${displayReason}`);
    }
    throw error;
  } finally {
    removeTransientAbort();
  }
}

/**
 * Start cloud sync loops for all providers that have stored tokens.
 * Call this on app startup to resume any previously connected providers.
 */
export async function restartCloudSync(provider: CloudProvider): Promise<void> {
  stopCloudSync(provider);
  if (hasFactoryResetCloudCleanupBarrier()) return;
  if (cloudDeletesInProgress.has(provider)) return;
  const generation = currentCloudGeneration(provider);
  const controller = new AbortController();
  cloudAborts.set(provider, controller);

  let token: string | null = null;
  try {
    token = await resolveCloudTokenForGeneration(
      provider,
      undefined,
      generation,
      controller.signal,
    );
  } catch (err) {
    if (!isCloudGenerationCurrent(provider, generation, controller.signal)) return;
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[CloudSync] Failed to refresh ${provider} on startup: ${msg}`);
    addDebugEvent("error", `[Cloud/${provider}] failed to refresh on startup: ${msg}`);
    void recordProviderHealthEvent({
      provider,
      outcome: "error",
      stage: "auth",
      reason: msg,
      finishedAt: Date.now(),
    });
    return;
  }

  if (!token || !isCloudGenerationCurrent(provider, generation, controller.signal)) return;
  await startCloudSync(provider, token);
}

export async function startAllCloudSyncs(): Promise<void> {
  if (hasFactoryResetCloudCleanupBarrier()) return;
  await Promise.all(getActiveProviders().map(async (provider) => {
    await restartCloudSync(provider).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudSync] Failed to resume ${provider}:`, err);
      addDebugEvent("error", `[Cloud/${provider}] failed to resume on startup: ${msg}`);
    });
  }));
}
