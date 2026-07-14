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
 * protected by optimistic locking — see @freed/sync/cloud for details.
 */

import { compareDoc, getDocBinary, getDocHeads, initDoc, mergeDoc, subscribe } from "./automerge";
import {
  addDebugEvent,
  recordCloudProviderEvent,
  updateCloudProvider,
  type CloudProviderEventKind,
} from "@freed/ui/lib/debug-store";
import {
  beginFactoryResetCloudCleanup,
  clearFactoryResetCloudCleanupBarrier,
  clearStoredCloudProvidersForFactoryReset,
  hasFactoryResetCloudCleanupBarrier,
} from "@freed/ui/lib/factory-reset";
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
import {
  capturePwaRuntimeLifecycle,
  registerPwaFactoryResetQuiesceHandler,
} from "./factory-reset-coordinator";

const syncRuntimeLifecycle = capturePwaRuntimeLifecycle();

// Connection state — WebSocket relay
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isRelayConnectedState = false;
let currentUrl: string | null = null;
let reconnectCount = 0;

// Cloud sync connection state — set by startCloudSync/stopCloudSync so the
// toolbar reflects "Connected" as soon as either channel is active.
let isCloudConnectedState = false;
let cloudChangeUnsubscribe: (() => void) | null = null;

// Status listeners
type StatusListener = (connected: boolean) => void;
const statusListeners = new Set<StatusListener>();

/**
 * Notify status listeners with the combined connection state.
 * Either the WebSocket relay or the cloud sync loop counts as "connected".
 */
function notifyStatus(): void {
  const connected = isRelayConnectedState || isCloudConnectedState;
  for (const listener of statusListeners) {
    listener(connected);
  }
}

/**
 * Broadcast current document to the LAN relay and schedule a cloud backup.
 * Both sync channels fire from the same trigger so they stay in lockstep.
 */
export function broadcastDoc(): void {
  if (!syncRuntimeLifecycle.isCurrent()) return;
  const runtimeLifecycle = capturePwaRuntimeLifecycle();
  if (ws && ws.readyState === WebSocket.OPEN) {
    const socket = ws;
    void getDocBinary().then((doc) => {
      if (socket.readyState !== WebSocket.OPEN || !runtimeLifecycle.isCurrent()) return;
      socket.send(doc);
      console.log("[Sync] Broadcast document (%d bytes)", doc.byteLength);
      addDebugEvent("sent", undefined, doc.byteLength);
    }).catch((error) => {
      console.error("[Sync] Failed to broadcast:", error);
      addDebugEvent("error", error instanceof Error ? error.message : String(error));
    });
  }

  // Cloud backup — debounced to batch rapid changes.
  if (!runtimeLifecycle.isCurrent()) return;
  const provider = getCloudProvider();
  if (provider) {
    scheduleCloudUpload(provider);
  }
}

/**
 * Connect to sync relay
 */
export function connect(url: string): void {
  if (!syncRuntimeLifecycle.isCurrent()) return;
  const runtimeLifecycle = capturePwaRuntimeLifecycle();
  if (ws) {
    ws.close();
  }

  currentUrl = url;
  console.log(`[Sync] Connecting to ${url}...`);
  addDebugEvent("connect_attempt", url);

  try {
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer"; // Receive binary as ArrayBuffer

    ws.onopen = () => {
      if (!runtimeLifecycle.isCurrent()) {
        ws?.close();
        return;
      }
      console.log("[Sync] Connected to relay");
      isRelayConnectedState = true;
      reconnectCount = 0;
      notifyStatus();
      addDebugEvent("connected", url);

      // Send our current doc so the relay stores it and can serve new clients
      setTimeout(() => broadcastDoc(), 100);
    };

    ws.onmessage = async (event) => {
      if (!runtimeLifecycle.isCurrent()) return;
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      if (bytes.length === 0) return;

      addDebugEvent("received", undefined, bytes.length);

      try {
        await mergeDoc(bytes);
        if (!runtimeLifecycle.isCurrent()) return;
        console.log("[Sync] Received and merged document (%d bytes)", bytes.length);
      } catch (error) {
        const message = describeSyncError(error);
        console.error("[Sync] Failed to merge doc:", error);
        addDebugEvent("merge_err", `[Relay] merge failed: ${message}`, bytes.length);
      }
    };

    ws.onclose = () => {
      console.log("[Sync] Disconnected from relay");
      isRelayConnectedState = false;
      ws = null;
      notifyStatus();
      addDebugEvent("disconnected", currentUrl ?? undefined);

      // Auto-reconnect after delay
      if (currentUrl && reconnectTimer === null && runtimeLifecycle.isCurrent()) {
        reconnectCount += 1;
        addDebugEvent("reconnecting", `attempt ${reconnectCount} in 5s`);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (currentUrl && !isRelayConnectedState && runtimeLifecycle.isCurrent()) {
            connect(currentUrl);
          }
        }, 5000);
      }
    };

    ws.onerror = (error) => {
      console.error("[Sync] WebSocket error:", error);
      addDebugEvent("error", "WebSocket error — check browser console for details");
    };
  } catch (error) {
    console.error("[Sync] Failed to connect:", error);
    addDebugEvent("error", error instanceof Error ? error.message : String(error));
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
  isRelayConnectedState = false;
  notifyStatus();
}

/**
 * Check if the WebSocket relay is connected
 */
export function isRelayConnected(): boolean {
  return isRelayConnectedState;
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
  syncRuntimeLifecycle.assertCurrent();
  localStorage.setItem("freed_relay_url", url);
}

/**
 * Clear stored relay URL
 */
export function clearStoredRelayUrl(): void {
  syncRuntimeLifecycle.assertCurrent();
  clearStoredRelayUrlForFactoryReset();
}

/** Factory-reset-only relay cleanup after the runtime generation is tombstoned. */
export function clearStoredRelayUrlForFactoryReset(): void {
  localStorage.removeItem("freed_relay_url");
}

// ─── Cloud sync ───────────────────────────────────────────────────────────────

export type { CloudProvider };

const CLOUD_TOKEN_KEY = (provider: CloudProvider) => `freed_cloud_token_${provider}`;
const CLOUD_TOKEN_META_KEY = (provider: CloudProvider) => `freed_cloud_token_meta_${provider}`;
const CLOUD_PROVIDER_KEY = "freed_cloud_provider";
const UPLOAD_DEBOUNCE_MS = 2_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const GOOGLE_TOKEN_REFRESH_FALLBACK_TTL_MS = 55 * 60 * 1000;
const AUTH_FAILURE_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

let cloudAbort: AbortController | null = null;
let uploadTimer: ReturnType<typeof setTimeout> | null = null;
interface CloudTokenRefreshTask {
  readonly credentialRevision: number;
  readonly promise: Promise<string | null>;
}

const cloudTokenRefreshes = new Map<CloudProvider, CloudTokenRefreshTask>();
const cloudCredentialRevisions = new Map<CloudProvider, number>();
const cloudAuthFailureRefreshes = new Map<CloudProvider, number>();
let cloudGeneration = 0;
let cloudStartupRepairGeneration = -1;
let cloudDeleteInProgressCount = 0;
const cloudInFlightOperations = new Set<Promise<unknown>>();
const cloudInFlightUploads = new Set<Promise<void>>();
const cloudTransientAborts = new Set<AbortController>();

function invalidateCloudGeneration(): number {
  cloudGeneration += 1;
  return cloudGeneration;
}

function isCloudGenerationCurrent(generation: number, signal?: AbortSignal): boolean {
  return syncRuntimeLifecycle.isCurrent()
    && cloudGeneration === generation
    && !signal?.aborted
    && cloudDeleteInProgressCount === 0;
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

export function captureCloudLifecycle(): CloudLifecycleGuard {
  const generation = cloudGeneration;
  const runtimeLifecycle = capturePwaRuntimeLifecycle();
  return {
    isCurrent: () => runtimeLifecycle.isCurrent() && isCloudGenerationCurrent(generation),
  };
}

function trackCloudOperation<T>(operation: Promise<T>): Promise<T> {
  cloudInFlightOperations.add(operation);
  void operation.finally(() => cloudInFlightOperations.delete(operation)).catch(() => {});
  return operation;
}

function trackCloudUpload(upload: Promise<void>): Promise<void> {
  cloudInFlightUploads.add(upload);
  void upload.finally(() => cloudInFlightUploads.delete(upload)).catch(() => {});
  return upload;
}

async function waitForCloudSettlement(): Promise<void> {
  while (
    cloudInFlightOperations.size > 0
    || cloudInFlightUploads.size > 0
    || cloudTokenRefreshes.size > 0
  ) {
    await Promise.allSettled([
      ...cloudInFlightOperations,
      ...cloudInFlightUploads,
      ...[...cloudTokenRefreshes.values()].map((task) => task.promise),
    ]);
  }
}

async function ensureDocumentReady(): Promise<void> {
  await initDoc();
}

function describeSyncError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDestructiveMergeError(error: unknown): boolean {
  return describeSyncError(error).includes("blocked a sync merge");
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
}

function markCloudError(provider: CloudProvider, stage: "auth" | "download" | "merge" | "poll" | "upload", error: unknown): void {
  const message = describeSyncError(error);
  const statusMessage = isDestructiveMergeError(error)
    ? "Merge blocked."
    : `${stage[0].toUpperCase()}${stage.slice(1)} failed.`;
  updateCloudProvider(provider, {
    status: "error",
    stage,
    error: message,
    statusMessage,
    pendingReason: "Resolve this error, then reconnect or run Sync now.",
    lastErrorAt: Date.now(),
  });
  recordCloudStep(provider, "error", stage, message);
}

export interface CloudTokenBundle {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface CloudTokenReadResult {
  bundle: CloudTokenBundle | null;
  hasStoredCredentials: boolean;
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
  return syncRuntimeLifecycle.isCurrent()
    && currentCloudCredentialRevision(provider) === credentialRevision
    && sameCloudTokenStorage(captureCloudTokenStorage(provider), source);
}

function restoreCloudTokenStorageIfStale(
  provider: CloudProvider,
  snapshot: CloudTokenStorageSnapshot,
  resolvedToken: string | null,
  credentialRevision: number,
): void {
  if (!syncRuntimeLifecycle.isCurrent()) return;
  if (currentCloudCredentialRevision(provider) !== credentialRevision) return;
  if (!resolvedToken || getCloudToken(provider) !== resolvedToken) return;
  if (snapshot.accessToken === null) localStorage.removeItem(CLOUD_TOKEN_KEY(provider));
  else localStorage.setItem(CLOUD_TOKEN_KEY(provider), snapshot.accessToken);
  if (snapshot.metadata === null) localStorage.removeItem(CLOUD_TOKEN_META_KEY(provider));
  else localStorage.setItem(CLOUD_TOKEN_META_KEY(provider), snapshot.metadata);
}

function persistCloudToken(
  provider: CloudProvider,
  token: string | CloudTokenBundle,
  selectProvider: boolean,
): void {
  syncRuntimeLifecycle.assertCurrent();
  const previous = readCloudTokenBundle(provider);
  const bundle = typeof token === "string" ? { accessToken: token } : token;
  const storedBundle: CloudTokenBundle = {
    ...bundle,
    refreshToken: bundle.refreshToken ?? previous?.refreshToken,
  };
  localStorage.setItem(CLOUD_TOKEN_KEY(provider), storedBundle.accessToken);
  localStorage.setItem(CLOUD_TOKEN_META_KEY(provider), JSON.stringify(storedBundle));
  if (selectProvider) localStorage.setItem(CLOUD_PROVIDER_KEY, provider);
}

/** Persist OAuth credentials and select the provider for cloud sync. */
export function storeCloudToken(provider: CloudProvider, token: string | CloudTokenBundle): void {
  invalidateCloudCredentials(provider);
  persistCloudToken(provider, token, true);
  clearFactoryResetCloudCleanupBarrier();
}

/** Retrieve the stored OAuth token for a cloud provider. */
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

async function refreshCloudTokenAfterAuthFailure(
  provider: CloudProvider,
  bundle: CloudTokenBundle,
  error: unknown,
): Promise<string | null> {
  const status = authFailureStatus(error);
  if (status !== 401) {
    console.warn(`[CloudSync/${provider}] Auth failure is not refreshable status=${status ?? "unknown"}`, error);
    throw error;
  }
  if (!bundle.refreshToken) {
    console.warn(`[CloudSync/${provider}] Auth failure cannot refresh because no refresh token is stored`);
    throw error;
  }

  const now = Date.now();
  const lastRefreshAt = cloudAuthFailureRefreshes.get(provider);
  if (typeof lastRefreshAt === "number" && now - lastRefreshAt < AUTH_FAILURE_REFRESH_COOLDOWN_MS) {
    console.warn(`[CloudSync/${provider}] Auth failure refresh suppressed age_ms=${(now - lastRefreshAt).toLocaleString()}`);
    throw error;
  }

  cloudAuthFailureRefreshes.set(provider, now);
  const expiresInMs = cloudTokenExpiresInMs(bundle, now);
  console.info(
    `[CloudSync/${provider}] Refreshing token after auth failure status=${status} expires_in_ms=${expiresInMs?.toLocaleString() ?? "unknown"}`,
  );
  return refreshCloudToken(provider, bundle);
}

async function refreshCloudToken(provider: CloudProvider, bundle: CloudTokenBundle): Promise<string | null> {
  if (!bundle.refreshToken) return bundle.accessToken;
  const credentialRevision = currentCloudCredentialRevision(provider);
  const existingRefresh = cloudTokenRefreshes.get(provider);
  if (existingRefresh?.credentialRevision === credentialRevision) return existingRefresh.promise;

  const source = captureCloudTokenStorage(provider);
  const refreshPromise = refreshCloudTokenInner(
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

  if (provider === "gdrive") {
    const res = await fetch("/api/oauth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantType: "refresh_token", refreshToken }),
    });
    const data = await res.json().catch(() => ({ error: "invalid JSON from proxy" }));
    if (!res.ok) throw new Error(`GDrive token refresh failed: ${data.error ?? res.status}`);
    const nextBundle = {
      accessToken: data.access_token as string,
      refreshToken: (data.refresh_token as string | undefined) ?? refreshToken,
      expiresAt: typeof data.expires_in === "number" && Number.isFinite(data.expires_in) && data.expires_in > 0
        ? Date.now() + data.expires_in * 1000
        : Date.now() + GOOGLE_TOKEN_REFRESH_FALLBACK_TTL_MS,
    };
    if (!nextBundle.accessToken) throw new Error("GDrive proxy returned no access_token");
    if (!canCommitCloudTokenRefresh(provider, credentialRevision, source)) return null;
    // Refreshing credentials must not select a provider. A stale Google
    // refresh may settle after the user has already switched to Dropbox.
    persistCloudToken(provider, nextBundle, false);
    return nextBundle.accessToken;
  }

  return bundle.accessToken;
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
  if (!isCloudGenerationCurrent(generation, signal)) {
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

/** Return the configured cloud provider, if any. */
export function getCloudProvider(): CloudProvider | null {
  const provider = localStorage.getItem(CLOUD_PROVIDER_KEY);
  return provider === "gdrive" || provider === "dropbox" ? provider : null;
}

/** Clear cloud credentials (e.g. on sign-out or re-pair). */
export function clearCloudSync(provider: CloudProvider): void {
  syncRuntimeLifecycle.assertCurrent();
  clearCloudSyncForFactoryReset(provider);
}

function clearCloudSyncForFactoryReset(provider: CloudProvider): void {
  invalidateCloudCredentials(provider);
  localStorage.removeItem(CLOUD_TOKEN_KEY(provider));
  localStorage.removeItem(CLOUD_TOKEN_META_KEY(provider));
  localStorage.removeItem(CLOUD_PROVIDER_KEY);
  cloudAuthFailureRefreshes.delete(provider);
  stopCloudSync();
}

/**
 * Start the cloud sync loop for the given provider.
 * On start, immediately download the latest remote state and merge it so the
 * PWA is up-to-date before the user sees content ("just returned from a trip").
 */
export async function startCloudSync(provider: CloudProvider, token: string): Promise<void> {
  stopCloudSync();
  if (hasFactoryResetCloudCleanupBarrier()) return;
  if (!syncRuntimeLifecycle.isCurrent() || cloudDeleteInProgressCount > 0) return;
  const generation = cloudGeneration;
  cloudAbort = new AbortController();
  const { signal } = cloudAbort;
  const resolveToken = () =>
    requireCloudTokenForGeneration(provider, token, generation, signal);
  await ensureDocumentReady();
  if (!isCloudGenerationCurrent(generation, signal)) return;

  // Mark cloud as connected immediately so the toolbar updates before the
  // initial download completes (download can take several seconds).
  isCloudConnectedState = true;
  notifyStatus();
  updateCloudProvider(provider, {
    status: "connecting",
    stage: "download",
    lastAttemptAt: Date.now(),
    statusMessage: "Checking cloud storage for remote changes.",
    pendingReason: undefined,
    error: undefined,
  });

  // Pull latest remote state immediately on connect. The AbortSignal is passed
  // through so stopCloudSync() cancels any in-flight fetch rather than orphaning it.
  let needsStartupRepair = false;
  let startupRepairToken = token;
  try {
    markCloudAttempt(provider, "download", "Checking cloud storage for remote changes.");
    let remote: Uint8Array | null;
    try {
      const downloadFn =
        provider === "gdrive" ? gdriveDownloadLatest : dropboxDownloadLatest;
      const resolvedToken = await resolveToken();
      if (!isCloudGenerationCurrent(generation, signal)) return;
      startupRepairToken = resolvedToken;
      remote = await downloadFn(resolvedToken, signal);
      if (!isCloudGenerationCurrent(generation, signal)) return;
    } catch (error) {
      if (!isCloudGenerationCurrent(generation, signal)) return;
      const status = authFailureStatus(error);
      if (provider !== "gdrive" || status !== 401) throw error;
      markCloudAttempt(provider, "auth", "Refreshing Google Drive token after an auth response.");
      const refreshSnapshot = captureCloudTokenStorage("gdrive");
      const refreshCredentialRevision = currentCloudCredentialRevision("gdrive");
      const authBundle = readCloudTokenBundleForAuthFailure("gdrive", token);
      if (!authBundle) throw createCloudCredentialUnavailableError("gdrive");
      const refreshed = await refreshCloudTokenAfterAuthFailure("gdrive", authBundle, error);
      if (!isCloudGenerationCurrent(generation, signal)) {
        restoreCloudTokenStorageIfStale(
          "gdrive",
          refreshSnapshot,
          refreshed,
          refreshCredentialRevision,
        );
        return;
      }
      if (!refreshed) throw error;
      startupRepairToken = refreshed;
      markCloudAttempt(provider, "download", "Retrying cloud download after token refresh.");
      remote = await gdriveDownloadLatest(refreshed, signal);
      if (!isCloudGenerationCurrent(generation, signal)) return;
    }
    if (remote) {
      const relation = await compareDoc(remote);
      if (!isCloudGenerationCurrent(generation, signal)) return;
      needsStartupRepair = relation === "local-ahead" || relation === "diverged";
      markCloudAttempt(provider, "merge", "Merging remote document into the local library.");
      await mergeDoc(remote);
      if (!isCloudGenerationCurrent(generation, signal)) return;
      console.log("[CloudSync] Initial merge on connect (%d bytes)", remote.length);
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
    } else {
      needsStartupRepair = true;
      markCloudSuccess(provider, {
        stage: "idle",
        lastDownloadAt: Date.now(),
        lastRemoteBytes: 0,
        statusMessage: "No remote changes found.",
        pendingReason: "Waiting for local document changes or Sync now.",
        eventMessage: "Checked cloud storage. No remote changes found.",
      });
    }
  } catch (err) {
    if (isCloudGenerationCurrent(generation, signal)) {
      console.error("[CloudSync] Initial download failed:", err);
      addDebugEvent("error", `[Cloud/${provider}] initial download failed: ${describeSyncError(err)}`);
      const failedStage = isDestructiveMergeError(err) ? "merge" : "download";
      markCloudError(provider, failedStage, err);
      if (failedStage === "merge") {
        recordCloudStep(provider, "waiting", "merge", "Cloud sync paused until merge recovery is resolved.");
        return;
      }
    }
  }

  if (!isCloudGenerationCurrent(generation, signal)) return;
  if (needsStartupRepair && cloudStartupRepairGeneration !== generation) {
    cloudStartupRepairGeneration = generation;
    await performCloudUpload(provider, startupRepairToken, "startup-repair", generation);
    if (!isCloudGenerationCurrent(generation, signal)) return;
  }

  const handleRemoteChange = async (binary: Uint8Array) => {
    if (!isCloudGenerationCurrent(generation, signal)) return;
    try {
      markCloudAttempt(provider, "merge");
      await mergeDoc(binary);
      if (!isCloudGenerationCurrent(generation, signal)) return;
      console.log("[CloudSync] Merged remote change (%d bytes)", binary.length);
      addDebugEvent("received", `[Cloud/${provider}] remote change`, binary.length);
      markCloudSuccess(provider, {
        stage: "idle",
        lastDownloadAt: Date.now(),
        lastMergeAt: Date.now(),
        lastRemoteBytes: binary.length,
        statusMessage: "Remote changes merged.",
        pendingReason: "Waiting for local document changes or Sync now.",
        eventMessage: `Merged remote change with ${binary.length.toLocaleString()} bytes.`,
        eventBytes: binary.length,
      });
    } catch (err) {
      if (!isCloudGenerationCurrent(generation, signal)) return;
      console.error("[CloudSync] Failed to merge remote change:", err);
      addDebugEvent("merge_err", `[Cloud/${provider}] remote merge failed: ${describeSyncError(err)}`, binary.length);
      markCloudError(provider, "merge", err);
    }
  };
  const onRemoteChange = (binary: Uint8Array) =>
    trackCloudOperation(handleRemoteChange(binary));

  const initialPollToken = await resolveToken();
  if (!isCloudGenerationCurrent(generation, signal)) return;
  if (provider === "gdrive") {
    const runGDrivePollLoop = async (firstToken: string) => {
      let pollToken = firstToken;
      while (isCloudGenerationCurrent(generation, signal)) {
        try {
          await gdriveStartPollLoop(pollToken, onRemoteChange, signal);
          return;
        } catch (error) {
          if (!isCloudGenerationCurrent(generation, signal)) return;
          const status = authFailureStatus(error);
          if (status !== 401 && status !== 403) throw error;
          const refreshSnapshot = captureCloudTokenStorage("gdrive");
          const refreshCredentialRevision = currentCloudCredentialRevision("gdrive");
          const authBundle = readCloudTokenBundleForAuthFailure("gdrive", pollToken);
          if (!authBundle) throw createCloudCredentialUnavailableError("gdrive");
          const refreshed = await refreshCloudTokenAfterAuthFailure("gdrive", authBundle, error);
          if (!isCloudGenerationCurrent(generation, signal)) {
            restoreCloudTokenStorageIfStale(
              "gdrive",
              refreshSnapshot,
              refreshed,
              refreshCredentialRevision,
            );
            return;
          }
          pollToken = await resolveToken();
          if (!isCloudGenerationCurrent(generation, signal)) return;
        }
      }
    };

    runGDrivePollLoop(initialPollToken).catch((err) => {
      if (isCloudGenerationCurrent(generation, signal)) {
        console.error("[CloudSync/GDrive] Poll loop crashed:", err);
        addDebugEvent("error", `[Cloud/gdrive] poll loop crashed: ${describeSyncError(err)}`);
        markCloudError("gdrive", "poll", err);
      }
    });
  } else {
    dropboxStartLongpollLoop(initialPollToken, onRemoteChange, signal).catch((err) => {
      if (isCloudGenerationCurrent(generation, signal)) {
        console.error("[CloudSync/Dropbox] Longpoll loop crashed:", err);
        addDebugEvent("error", `[Cloud/dropbox] poll loop crashed: ${describeSyncError(err)}`);
        markCloudError("dropbox", "poll", err);
      }
    });
  }

  console.log("[CloudSync] Started (%s)", provider);
  cloudChangeUnsubscribe = subscribe(() => {
    if (!isCloudGenerationCurrent(generation, signal)) return;
    scheduleCloudUpload(provider, undefined, generation);
  });
  updateCloudProvider(provider, {
    status: "connected",
    stage: "idle",
    statusMessage: "Watching for sync changes.",
    pendingReason: "Next upload starts after a local document change or Sync now.",
  });
  recordCloudStep(provider, "waiting", "idle", "Watching for local document changes.");
}

/**
 * Delete the cloud sync file for the given provider.
 * Stops the sync loop first to prevent a race with any in-flight upload.
 * Used during factory reset when the user opts to also wipe cloud storage.
 */
export async function deleteCloudFile(provider: CloudProvider, token: string): Promise<void> {
  cloudDeleteInProgressCount += 1;
  try {
    stopCloudSync();
    await waitForCloudSettlement();
    if (provider === "gdrive") {
      await gdriveDeleteFile(token);
    } else {
      await dropboxDeleteFile(token);
    }
  } finally {
    cloudDeleteInProgressCount -= 1;
  }
}

/** Delete the selected cloud copy, then clear credentials only after deletion succeeds. */
export async function clearStoredCloudDataForFactoryReset(
  deleteFromCloud: boolean,
): Promise<void> {
  const storedProvider = localStorage.getItem(CLOUD_PROVIDER_KEY);
  const provider = getCloudProvider();
  beginFactoryResetCloudCleanup();
  await clearStoredCloudProvidersForFactoryReset({
    providers: provider ? [provider] : [],
    deleteFromCloud,
    getStoredToken: getCloudToken,
    deleteCloudFile,
    clearStoredCredentials: clearCloudSyncForFactoryReset,
  });
  if (!provider && storedProvider !== null) {
    localStorage.removeItem(CLOUD_PROVIDER_KEY);
  }
}

/** Stop the active cloud sync loop and cancel any pending upload. */
export function stopCloudSync(): void {
  invalidateCloudGeneration();
  cloudAbort?.abort();
  cloudAbort = null;
  for (const controller of cloudTransientAborts) controller.abort();
  cloudTransientAborts.clear();
  cloudChangeUnsubscribe?.();
  cloudChangeUnsubscribe = null;
  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = null;
  }
  isCloudConnectedState = false;
  notifyStatus();
  const provider = getCloudProvider();
  if (provider) {
    updateCloudProvider(provider, {
      status: "idle",
      stage: "idle",
      statusMessage: "Cloud sync stopped.",
      pendingReason: "Reconnect Google Drive to resume cloud sync.",
    });
    recordCloudStep(provider, "waiting", "idle", "Cloud sync stopped.");
  }
}

async function quiescePwaSyncForFactoryReset(): Promise<void> {
  disconnect();
  stopCloudSync();
  await waitForCloudSettlement();
}

registerPwaFactoryResetQuiesceHandler(
  "sync",
  quiescePwaSyncForFactoryReset,
  10,
);

type CloudUploadCause = "subscriber" | "manual" | "poll" | "startup-repair";

/**
 * Heads at the previous upload attempt. An attempt whose heads match is the
 * cloud-loop signature (stability P0-03, F01/F06). Logged to the PWA debug
 * channel with the same field names as the desktop runtime-health event.
 */
let lastUploadHeadsKey: string | null = null;

async function recordCloudUploadAttempt(
  provider: CloudProvider,
  cause: CloudUploadCause,
): Promise<void> {
  try {
    const heads = await getDocHeads();
    const headsKey = heads && heads.length > 0 ? heads.join(",") : null;
    const previousKey = lastUploadHeadsKey;
    if (headsKey !== null) lastUploadHeadsKey = headsKey;
    const headsUnchanged = headsKey !== null && headsKey === previousKey;
    addDebugEvent(
      "change",
      `cloud_upload_attempt ${JSON.stringify({ provider, cause, headsBefore: heads, headsUnchanged })}`,
    );
  } catch {
    // Counters never block or fail an upload.
  }
}

async function runCloudUpload(
  provider: CloudProvider,
  token?: string,
  cause: CloudUploadCause = "subscriber",
  generation = cloudGeneration,
): Promise<void> {
  if (!isCloudGenerationCurrent(generation)) return;
  try {
    await ensureDocumentReady();
    if (!isCloudGenerationCurrent(generation)) return;
    const binary = await getDocBinary();
    if (!isCloudGenerationCurrent(generation)) return;
    await recordCloudUploadAttempt(provider, cause);
    if (!isCloudGenerationCurrent(generation)) return;
    const uploadToken = await requireCloudTokenForGeneration(
      provider,
      token,
      generation,
    );
    if (!isCloudGenerationCurrent(generation)) return;
    markCloudAttempt(provider, "upload", "Uploading local document to cloud storage.");
    if (provider === "gdrive") {
      const result = await gdriveUploadSafe(uploadToken, binary);
      if (!isCloudGenerationCurrent(generation)) return;
      if (result.mergedRemote) {
        markCloudAttempt(provider, "merge", "Merging remote data discovered during upload.");
        await mergeDoc(result.uploadedBinary);
        if (!isCloudGenerationCurrent(generation)) return;
      }
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
      await dropboxUploadSafe(uploadToken, binary);
      if (!isCloudGenerationCurrent(generation)) return;
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
    console.log("[CloudSync] Uploaded (%d bytes)", binary.byteLength);
    addDebugEvent("sent", `[Cloud/${provider}] upload`, binary.byteLength);
  } catch (err) {
    if (!isCloudGenerationCurrent(generation)) return;
    console.error("[CloudSync] Upload failed:", err);
    addDebugEvent("error", `[Cloud/${provider}] upload failed: ${describeSyncError(err)}`);
    markCloudError(provider, "upload", err);
    throw err;
  }
}

function performCloudUpload(
  provider: CloudProvider,
  token?: string,
  cause: CloudUploadCause = "subscriber",
  generation = cloudGeneration,
): Promise<void> {
  return trackCloudUpload(runCloudUpload(provider, token, cause, generation));
}

/**
 * Schedule a debounced cloud upload.
 * Called from broadcastDoc() so every local change triggers a cloud backup.
 * The upload is debounced to batch rapid changes into a single network round-trip.
 */
export function scheduleCloudUpload(
  provider: CloudProvider,
  token?: string,
  generation = cloudGeneration,
): void {
  if (!isCloudGenerationCurrent(generation)) return;
  if (uploadTimer) clearTimeout(uploadTimer);
  updateCloudProvider(provider, {
    status: "connected",
    stage: "idle",
    statusMessage: "Upload queued.",
    pendingReason: `Waiting ${UPLOAD_DEBOUNCE_MS.toLocaleString()} ms for local changes to settle.`,
    error: undefined,
  });
  recordCloudStep(provider, "queued", "upload", "Upload queued after a local document change.");

  uploadTimer = setTimeout(async () => {
    uploadTimer = null;
    if (!isCloudGenerationCurrent(generation)) return;
    void performCloudUpload(provider, token, "subscriber", generation).catch(() => {});
  }, UPLOAD_DEBOUNCE_MS);
}

async function runInitialCloudDownload(
  provider: CloudProvider,
  signal: AbortSignal,
  resolveToken: () => Promise<string>,
  generation: number,
): Promise<void> {
  markCloudAttempt(provider, "download", "Checking cloud storage for remote changes.");
  let remote: Uint8Array | null;
  try {
    const downloadFn =
      provider === "gdrive" ? gdriveDownloadLatest : dropboxDownloadLatest;
    const resolvedToken = await resolveToken();
    if (!isCloudGenerationCurrent(generation, signal)) return;
    remote = await downloadFn(resolvedToken, signal);
    if (!isCloudGenerationCurrent(generation, signal)) return;
  } catch (error) {
    if (!isCloudGenerationCurrent(generation, signal)) return;
    const status = authFailureStatus(error);
    if (provider !== "gdrive" || status !== 401) throw error;
    markCloudAttempt(provider, "auth", "Refreshing Google Drive token after an auth response.");
    const fallbackToken = await resolveToken();
    if (!isCloudGenerationCurrent(generation, signal)) return;
    const refreshSnapshot = captureCloudTokenStorage("gdrive");
    const refreshCredentialRevision = currentCloudCredentialRevision("gdrive");
    const authBundle = readCloudTokenBundleForAuthFailure("gdrive", fallbackToken);
    if (!authBundle) throw createCloudCredentialUnavailableError("gdrive");
    const refreshed = await refreshCloudTokenAfterAuthFailure("gdrive", authBundle, error);
    if (!isCloudGenerationCurrent(generation, signal)) {
      restoreCloudTokenStorageIfStale(
        "gdrive",
        refreshSnapshot,
        refreshed,
        refreshCredentialRevision,
      );
      return;
    }
    if (!refreshed) throw error;
    markCloudAttempt(provider, "download", "Retrying cloud download after token refresh.");
    remote = await gdriveDownloadLatest(refreshed, signal);
    if (!isCloudGenerationCurrent(generation, signal)) return;
  }
  if (remote) {
    markCloudAttempt(provider, "merge", "Merging remote document into the local library.");
    await mergeDoc(remote);
    if (!isCloudGenerationCurrent(generation, signal)) return;
    console.log("[CloudSync] Manual merge (%d bytes)", remote.length);
    addDebugEvent("received", `[Cloud/${provider}] manual download`, remote.length);
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
  } else {
    markCloudSuccess(provider, {
      stage: "idle",
      lastDownloadAt: Date.now(),
      lastRemoteBytes: 0,
      statusMessage: "No remote changes found.",
      pendingReason: "Waiting for local document changes or Sync now.",
      eventMessage: "Checked cloud storage. No remote changes found.",
    });
  }
}

/** Run an immediate cloud sync pass without waiting for the debounce timer. */
export async function syncCloudProviderNow(provider: CloudProvider): Promise<void> {
  const generation = cloudGeneration;
  await ensureDocumentReady();
  if (!isCloudGenerationCurrent(generation)) return;
  const token = await resolveCloudTokenForGeneration(provider, undefined, generation);
  if (!isCloudGenerationCurrent(generation)) return;
  if (!token) throw new Error("Cloud token missing. Reconnect the provider.");

  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = null;
  }

  const activeSignal = cloudAbort?.signal;
  const controller = activeSignal ? null : new AbortController();
  if (controller) cloudTransientAborts.add(controller);
  const signal = activeSignal ?? controller!.signal;
  recordCloudStep(provider, "queued", "idle", "Manual sync requested.");
  updateCloudProvider(provider, {
    status: "connected",
    stage: "idle",
    statusMessage: "Manual sync requested.",
    pendingReason: "Checking cloud storage, then uploading the local document.",
    error: undefined,
  });

  try {
    const download = runInitialCloudDownload(provider, signal, () =>
      requireCloudTokenForGeneration(
        provider,
        token,
        generation,
        signal,
      ), generation);
    await trackCloudOperation(download);
    if (!isCloudGenerationCurrent(generation, signal)) return;
    await performCloudUpload(provider, undefined, "manual", generation);
  } catch (error) {
    if (!isCloudGenerationCurrent(generation, signal)) return;
    markCloudError(provider, isDestructiveMergeError(error) ? "merge" : "download", error);
    throw error;
  } finally {
    if (controller) cloudTransientAborts.delete(controller);
  }
}
