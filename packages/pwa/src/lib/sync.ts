/** PWA Library Core synchronization and OAuth credential lifecycle. */

import type { CloudProvider } from "@freed/sync/cloud/library-core";
import {
  recordCloudProviderEvent,
  updateCloudProvider,
} from "@freed/ui/lib/debug-store";
import {
  beginFactoryResetCloudCleanup,
  clearFactoryResetCloudCleanupBarrier,
  clearStoredCloudProvidersForFactoryReset,
  hasFactoryResetCloudCleanupBarrier,
} from "@freed/ui/lib/factory-reset";
import { registerPwaFactoryResetQuiesceHandler } from "./factory-reset-coordinator";
import { syncPwaLibraryCoreFromGoogleDrive } from "./library-core-runtime";

export type { CloudProvider };

const CLOUD_PROVIDER_KEY = "freed_cloud_provider";
const CLOUD_TOKEN_KEY = (provider: CloudProvider) =>
  `freed_cloud_token_${provider}`;
const CLOUD_TOKEN_META_KEY = (provider: CloudProvider) =>
  `freed_cloud_token_meta_${provider}`;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const GOOGLE_TOKEN_REFRESH_FALLBACK_TTL_MS = 55 * 60 * 1000;
const LIBRARY_CORE_REFRESH_INTERVAL_MS = 60_000;

type StatusListener = (connected: boolean) => void;

export interface CloudTokenBundle {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
}

export interface CloudLifecycleGuard {
  readonly generation: number;
  isCurrent(): boolean;
}

const statusListeners = new Set<StatusListener>();
let cloudConnected = false;
let cloudGeneration = 0;
let cloudAbort: AbortController | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshPromise: Promise<string | null> | null = null;

function notifyStatus(): void {
  for (const listener of statusListeners) listener(cloudConnected);
}

function setCloudConnected(connected: boolean): void {
  cloudConnected = connected;
  notifyStatus();
}

function readCloudTokenBundle(
  provider: CloudProvider,
): CloudTokenBundle | null {
  const metadata = localStorage.getItem(CLOUD_TOKEN_META_KEY(provider));
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata) as Partial<CloudTokenBundle>;
      if (typeof parsed.accessToken === "string" && parsed.accessToken) {
        return parsed as CloudTokenBundle;
      }
    } catch {
      // Fall through to the legacy access-token slot once.
    }
  }
  const accessToken = localStorage.getItem(CLOUD_TOKEN_KEY(provider));
  return accessToken ? { accessToken } : null;
}

function persistCloudToken(
  provider: CloudProvider,
  token: string | CloudTokenBundle,
  selectProvider: boolean,
): void {
  const previous = readCloudTokenBundle(provider);
  const input = typeof token === "string" ? { accessToken: token } : token;
  const bundle: CloudTokenBundle = {
    ...input,
    refreshToken: input.refreshToken ?? previous?.refreshToken,
  };
  localStorage.setItem(CLOUD_TOKEN_KEY(provider), bundle.accessToken);
  localStorage.setItem(CLOUD_TOKEN_META_KEY(provider), JSON.stringify(bundle));
  if (selectProvider) localStorage.setItem(CLOUD_PROVIDER_KEY, provider);
}

async function refreshGoogleToken(
  bundle: CloudTokenBundle,
): Promise<string | null> {
  if (!bundle.refreshToken) return bundle.accessToken;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const response = await fetch("/api/oauth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grantType: "refresh_token",
        refreshToken: bundle.refreshToken,
      }),
    });
    const data = await response
      .json()
      .catch(() => ({ error: "invalid JSON from proxy" }));
    if (!response.ok) {
      throw new Error(
        `Google Drive token refresh failed: ${data.error ?? response.status}`,
      );
    }
    const accessToken = data.access_token as string | undefined;
    if (!accessToken) throw new Error("Google Drive returned no access token");
    persistCloudToken(
      "gdrive",
      {
        accessToken,
        refreshToken:
          (data.refresh_token as string | undefined) ?? bundle.refreshToken,
        expiresAt:
          typeof data.expires_in === "number" && data.expires_in > 0
            ? Date.now() + data.expires_in * 1000
            : Date.now() + GOOGLE_TOKEN_REFRESH_FALLBACK_TTL_MS,
      },
      false,
    );
    return accessToken;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function syncGoogleDriveOnce(
  generation: number,
  signal: AbortSignal,
): Promise<void> {
  const accessToken = await getValidCloudToken("gdrive");
  if (!accessToken || generation !== cloudGeneration || signal.aborted) return;
  updateCloudProvider("gdrive", {
    status: "connecting",
    stage: "download",
    lastAttemptAt: Date.now(),
    statusMessage: "Refreshing the SQLite Library checkpoint.",
    error: undefined,
  });
  await syncPwaLibraryCoreFromGoogleDrive({ accessToken, signal });
  if (generation !== cloudGeneration || signal.aborted) return;
  const now = Date.now();
  updateCloudProvider("gdrive", {
    status: "connected",
    stage: "idle",
    lastSuccessfulAt: now,
    lastSyncAt: now,
    lastDownloadAt: now,
    lastMergeAt: now,
    statusMessage: "SQLite Library checkpoint refreshed.",
    pendingReason: "Waiting for the next immutable Library generation.",
    error: undefined,
  });
  recordCloudProviderEvent("gdrive", {
    kind: "success",
    stage: "idle",
    message: "Refreshed the immutable SQLite Library checkpoint.",
  });
}

function scheduleRefresh(generation: number, signal: AbortSignal): void {
  if (generation !== cloudGeneration || signal.aborted) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void syncGoogleDriveOnce(generation, signal)
      .catch((error) => {
        if (generation !== cloudGeneration || signal.aborted) return;
        updateCloudProvider("gdrive", {
          status: "error",
          stage: "download",
          error: error instanceof Error ? error.message : String(error),
          statusMessage: "SQLite Library refresh failed.",
        });
      })
      .finally(() => scheduleRefresh(generation, signal));
  }, LIBRARY_CORE_REFRESH_INTERVAL_MS);
}

/** Mutable-document broadcasting is retired. */
export function broadcastDoc(): void {}

/** The old LAN relay accepted mutable documents and is no longer available. */
export function connect(url: string): void {
  void url;
  disconnect();
}

export function disconnect(): void {
  notifyStatus();
}

export function isRelayConnected(): boolean {
  return false;
}

export function onStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(cloudConnected);
  return () => statusListeners.delete(listener);
}

export function getStoredRelayUrl(): string | null {
  return null;
}

export function storeRelayUrl(url: string): void {
  void url;
  localStorage.removeItem("freed_relay_url");
}

export function clearStoredRelayUrl(): void {
  localStorage.removeItem("freed_relay_url");
}

export function clearStoredRelayUrlForFactoryReset(): void {
  localStorage.removeItem("freed_relay_url");
}

export function captureCloudLifecycle(): CloudLifecycleGuard {
  const generation = cloudGeneration;
  return {
    generation,
    isCurrent: () => generation === cloudGeneration,
  };
}

export function storeCloudToken(
  provider: CloudProvider,
  token: string | CloudTokenBundle,
): void {
  persistCloudToken(provider, token, true);
  clearFactoryResetCloudCleanupBarrier();
}

export function getCloudToken(provider: CloudProvider): string | null {
  return readCloudTokenBundle(provider)?.accessToken ?? null;
}

export async function getValidCloudToken(
  provider: CloudProvider,
): Promise<string | null> {
  const bundle = readCloudTokenBundle(provider);
  if (!bundle) return null;
  const expiresSoon =
    typeof bundle.expiresAt === "number" &&
    bundle.expiresAt - Date.now() <= TOKEN_REFRESH_SKEW_MS;
  if (provider === "gdrive" && expiresSoon) return refreshGoogleToken(bundle);
  return bundle.accessToken;
}

export function getCloudProvider(): CloudProvider | null {
  const provider = localStorage.getItem(CLOUD_PROVIDER_KEY);
  return provider === "gdrive" || provider === "dropbox" ? provider : null;
}

export function clearCloudSync(provider: CloudProvider): void {
  stopCloudSync();
  localStorage.removeItem(CLOUD_TOKEN_KEY(provider));
  localStorage.removeItem(CLOUD_TOKEN_META_KEY(provider));
  if (getCloudProvider() === provider) localStorage.removeItem(CLOUD_PROVIDER_KEY);
}

export async function startCloudSync(
  provider: CloudProvider,
  token: string,
): Promise<void> {
  if (provider !== "gdrive") {
    throw new Error("The SQLite Library PWA currently requires Google Drive");
  }
  if (hasFactoryResetCloudCleanupBarrier()) return;
  stopCloudSync();
  persistCloudToken(provider, token, true);
  const generation = cloudGeneration;
  const controller = new AbortController();
  cloudAbort = controller;
  setCloudConnected(true);
  try {
    await syncGoogleDriveOnce(generation, controller.signal);
    scheduleRefresh(generation, controller.signal);
  } catch (error) {
    if (generation === cloudGeneration && !controller.signal.aborted) {
      setCloudConnected(false);
    }
    throw error;
  }
}

export function stopCloudSync(): void {
  cloudGeneration += 1;
  cloudAbort?.abort();
  cloudAbort = null;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  setCloudConnected(false);
}

export async function syncCloudProviderNow(
  provider: CloudProvider,
): Promise<void> {
  if (provider !== "gdrive") {
    throw new Error("The SQLite Library PWA currently requires Google Drive");
  }
  const generation = cloudGeneration;
  const controller = cloudAbort ?? new AbortController();
  await syncGoogleDriveOnce(generation, controller.signal);
}

export function scheduleCloudUpload(
  provider: CloudProvider,
  token?: string,
  generation = cloudGeneration,
): void {
  void provider;
  void token;
  void generation;
}

export async function deleteCloudFile(
  provider: CloudProvider,
  token: string,
): Promise<void> {
  void provider;
  void token;
  throw new Error(
    "Deleting an active Library Core cloud authority is not supported by factory reset",
  );
}

export async function clearStoredCloudDataForFactoryReset(
  deleteFromCloud: boolean,
): Promise<void> {
  beginFactoryResetCloudCleanup();
  await clearStoredCloudProvidersForFactoryReset({
    providers: ["gdrive", "dropbox"] as const,
    deleteFromCloud,
    getStoredToken: getCloudToken,
    deleteCloudFile,
    clearStoredCredentials: (provider) => clearCloudSync(provider),
  });
  clearFactoryResetCloudCleanupBarrier();
}

registerPwaFactoryResetQuiesceHandler("sync", stopCloudSync, 10);
