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

import { getDocBinary, initDoc, mergeDoc, subscribe } from "./automerge";
import {
  addDebugEvent,
  recordCloudProviderEvent,
  updateCloudProvider,
  type CloudProviderEventKind,
} from "@freed/ui/lib/debug-store";
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
  if (ws && ws.readyState === WebSocket.OPEN) {
    const socket = ws;
    void getDocBinary().then((doc) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(doc);
      console.log("[Sync] Broadcast document (%d bytes)", doc.byteLength);
      addDebugEvent("sent", undefined, doc.byteLength);
    }).catch((error) => {
      console.error("[Sync] Failed to broadcast:", error);
      addDebugEvent("error", error instanceof Error ? error.message : String(error));
    });
  }

  // Cloud backup — debounced to batch rapid changes.
  const provider = getCloudProvider();
  if (provider) {
    scheduleCloudUpload(provider);
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
  addDebugEvent("connect_attempt", url);

  try {
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer"; // Receive binary as ArrayBuffer

    ws.onopen = () => {
      console.log("[Sync] Connected to relay");
      isRelayConnectedState = true;
      reconnectCount = 0;
      notifyStatus();
      addDebugEvent("connected", url);

      // Send our current doc so the relay stores it and can serve new clients
      setTimeout(() => broadcastDoc(), 100);
    };

    ws.onmessage = async (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      if (bytes.length === 0) return;

      addDebugEvent("received", undefined, bytes.length);

      try {
        await mergeDoc(bytes);
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
      if (currentUrl && reconnectTimer === null) {
        reconnectCount += 1;
        addDebugEvent("reconnecting", `attempt ${reconnectCount} in 5s`);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (currentUrl && !isRelayConnectedState) {
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
const CLOUD_TOKEN_META_KEY = (provider: CloudProvider) => `freed_cloud_token_meta_${provider}`;
const CLOUD_PROVIDER_KEY = "freed_cloud_provider";
const UPLOAD_DEBOUNCE_MS = 2_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const GOOGLE_TOKEN_REFRESH_FALLBACK_TTL_MS = 55 * 60 * 1000;
const AUTH_FAILURE_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

let cloudAbort: AbortController | null = null;
let uploadTimer: ReturnType<typeof setTimeout> | null = null;
const cloudTokenRefreshes = new Map<CloudProvider, Promise<string | null>>();
const cloudAuthFailureRefreshes = new Map<CloudProvider, number>();

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

function readCloudTokenBundle(provider: CloudProvider): CloudTokenBundle | null {
  const meta = localStorage.getItem(CLOUD_TOKEN_META_KEY(provider));
  if (meta) {
    try {
      const parsed = JSON.parse(meta) as Partial<CloudTokenBundle>;
      if (typeof parsed.accessToken === "string" && parsed.accessToken) {
        return {
          accessToken: parsed.accessToken,
          refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
          expiresAt: typeof parsed.expiresAt === "number" && Number.isFinite(parsed.expiresAt)
            ? parsed.expiresAt
            : undefined,
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
  const previous = readCloudTokenBundle(provider);
  const bundle = typeof token === "string" ? { accessToken: token } : token;
  const storedBundle: CloudTokenBundle = {
    ...bundle,
    refreshToken: bundle.refreshToken ?? previous?.refreshToken,
  };
  localStorage.setItem(CLOUD_TOKEN_KEY(provider), storedBundle.accessToken);
  localStorage.setItem(CLOUD_TOKEN_META_KEY(provider), JSON.stringify(storedBundle));
  localStorage.setItem(CLOUD_PROVIDER_KEY, provider);
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
  const existingRefresh = cloudTokenRefreshes.get(provider);
  if (existingRefresh) return existingRefresh;

  const refreshPromise = refreshCloudTokenInner(provider, bundle).finally(() => {
    if (cloudTokenRefreshes.get(provider) === refreshPromise) {
      cloudTokenRefreshes.delete(provider);
    }
  });
  cloudTokenRefreshes.set(provider, refreshPromise);
  return refreshPromise;
}

async function refreshCloudTokenInner(provider: CloudProvider, bundle: CloudTokenBundle): Promise<string | null> {
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
    storeCloudToken(provider, nextBundle);
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

/** Return the configured cloud provider, if any. */
export function getCloudProvider(): CloudProvider | null {
  return localStorage.getItem(CLOUD_PROVIDER_KEY) as CloudProvider | null;
}

/** Clear cloud credentials (e.g. on sign-out or re-pair). */
export function clearCloudSync(provider: CloudProvider): void {
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
  await ensureDocumentReady();
  cloudAbort = new AbortController();
  const { signal } = cloudAbort;
  const resolveToken = async () => (provider === "gdrive" ? (await getValidCloudToken(provider)) ?? token : token);

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
  try {
    markCloudAttempt(provider, "download", "Checking cloud storage for remote changes.");
    let remote: Uint8Array | null;
    try {
      const downloadFn =
        provider === "gdrive" ? gdriveDownloadLatest : dropboxDownloadLatest;
      remote = await downloadFn(await resolveToken(), signal);
    } catch (error) {
      const status = authFailureStatus(error);
      if (provider !== "gdrive" || status !== 401) throw error;
      markCloudAttempt(provider, "auth", "Refreshing Google Drive token after an auth response.");
      const refreshed = await refreshCloudTokenAfterAuthFailure(
        "gdrive",
        readCloudTokenBundle("gdrive") ?? { accessToken: token },
        error,
      );
      if (!refreshed) throw error;
      markCloudAttempt(provider, "download", "Retrying cloud download after token refresh.");
      remote = await gdriveDownloadLatest(refreshed, signal);
    }
    if (remote) {
      markCloudAttempt(provider, "merge", "Merging remote document into the local library.");
      await mergeDoc(remote);
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
    if (!signal.aborted) {
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

  const onRemoteChange = async (binary: Uint8Array) => {
    try {
      markCloudAttempt(provider, "merge");
      await mergeDoc(binary);
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
      console.error("[CloudSync] Failed to merge remote change:", err);
      addDebugEvent("merge_err", `[Cloud/${provider}] remote merge failed: ${describeSyncError(err)}`, binary.length);
      markCloudError(provider, "merge", err);
    }
  };

  if (provider === "gdrive") {
    const runGDrivePollLoop = async () => {
      while (!signal.aborted) {
        const pollToken = await resolveToken();
        try {
          await gdriveStartPollLoop(pollToken, onRemoteChange, signal);
          return;
        } catch (error) {
          if (signal.aborted) return;
          const status = authFailureStatus(error);
          if (status !== 401 && status !== 403) throw error;
          await refreshCloudTokenAfterAuthFailure(
            "gdrive",
            readCloudTokenBundle("gdrive") ?? { accessToken: pollToken },
            error,
          );
        }
      }
    };

    runGDrivePollLoop().catch((err) => {
      if (!signal.aborted) {
        console.error("[CloudSync/GDrive] Poll loop crashed:", err);
        addDebugEvent("error", `[Cloud/gdrive] poll loop crashed: ${describeSyncError(err)}`);
        markCloudError("gdrive", "poll", err);
      }
    });
  } else {
    dropboxStartLongpollLoop(token, onRemoteChange, signal).catch((err) => {
      if (!signal.aborted) {
        console.error("[CloudSync/Dropbox] Longpoll loop crashed:", err);
        addDebugEvent("error", `[Cloud/dropbox] poll loop crashed: ${describeSyncError(err)}`);
        markCloudError("dropbox", "poll", err);
      }
    });
  }

  console.log("[CloudSync] Started (%s)", provider);
  cloudChangeUnsubscribe = subscribe(() => {
    scheduleCloudUpload(provider);
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
  stopCloudSync();
  if (provider === "gdrive") {
    await gdriveDeleteFile(token);
  } else {
    await dropboxDeleteFile(token);
  }
}

/** Stop the active cloud sync loop and cancel any pending upload. */
export function stopCloudSync(): void {
  cloudAbort?.abort();
  cloudAbort = null;
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

async function performCloudUpload(provider: CloudProvider, token?: string): Promise<void> {
  await ensureDocumentReady();
  const binary = await getDocBinary();
  try {
    const uploadToken = token ?? await getValidCloudToken(provider);
    if (!uploadToken) throw new Error("Cloud token missing. Reconnect the provider.");
    markCloudAttempt(provider, "upload", "Uploading local document to cloud storage.");
    if (provider === "gdrive") {
      const result = await gdriveUploadSafe(uploadToken, binary);
      if (result.mergedRemote) {
        markCloudAttempt(provider, "merge", "Merging remote data discovered during upload.");
        await mergeDoc(result.uploadedBinary);
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
    console.error("[CloudSync] Upload failed:", err);
    addDebugEvent("error", `[Cloud/${provider}] upload failed: ${describeSyncError(err)}`);
    markCloudError(provider, "upload", err);
    throw err;
  }
}

/**
 * Schedule a debounced cloud upload.
 * Called from broadcastDoc() so every local change triggers a cloud backup.
 * The upload is debounced to batch rapid changes into a single network round-trip.
 */
export function scheduleCloudUpload(provider: CloudProvider, token?: string): void {
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
    void performCloudUpload(provider, token).catch(() => {});
  }, UPLOAD_DEBOUNCE_MS);
}

async function runInitialCloudDownload(
  provider: CloudProvider,
  signal: AbortSignal,
  resolveToken: () => Promise<string>,
): Promise<void> {
  markCloudAttempt(provider, "download", "Checking cloud storage for remote changes.");
  let remote: Uint8Array | null;
  try {
    const downloadFn =
      provider === "gdrive" ? gdriveDownloadLatest : dropboxDownloadLatest;
    remote = await downloadFn(await resolveToken(), signal);
  } catch (error) {
    const status = authFailureStatus(error);
    if (provider !== "gdrive" || status !== 401) throw error;
    markCloudAttempt(provider, "auth", "Refreshing Google Drive token after an auth response.");
    const refreshed = await refreshCloudTokenAfterAuthFailure(
      "gdrive",
      readCloudTokenBundle("gdrive") ?? { accessToken: await resolveToken() },
      error,
    );
    if (!refreshed) throw error;
    markCloudAttempt(provider, "download", "Retrying cloud download after token refresh.");
    remote = await gdriveDownloadLatest(refreshed, signal);
  }
  if (remote) {
    markCloudAttempt(provider, "merge", "Merging remote document into the local library.");
    await mergeDoc(remote);
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
  await ensureDocumentReady();
  const token = await getValidCloudToken(provider);
  if (!token) throw new Error("Cloud token missing. Reconnect the provider.");

  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = null;
  }

  const activeSignal = cloudAbort?.signal;
  const controller = activeSignal ? null : new AbortController();
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
    await runInitialCloudDownload(provider, signal, async () => {
      const currentToken = provider === "gdrive" ? await getValidCloudToken(provider) : token;
      return currentToken ?? token;
    });
    await performCloudUpload(provider);
  } catch (error) {
    markCloudError(provider, isDestructiveMergeError(error) ? "merge" : "download", error);
    throw error;
  }
}
