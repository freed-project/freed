/** Freed Desktop SQLite Library synchronization and OAuth lifecycle. */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import type { CloudProvider } from "@freed/sync/cloud/library-core";
import type { GoogleDriveFetch } from "@freed/sync/cloud/library-core";
import {
  recordCloudProviderEvent,
  updateCloudProvider,
} from "@freed/ui/lib/debug-store";
import {
  beginFactoryResetCloudCleanup,
  clearFactoryResetCloudCleanupBarrier,
  clearStoredCloudProvidersForFactoryReset,
  hasFactoryResetCloudCleanupBarrier,
  isFactoryResetInProgress,
} from "@freed/ui/lib/factory-reset";
import {
  isSqliteLibraryGoogleDriveSyncEnabled,
  makeThisSqliteLibraryDesktopWriter,
  publishCurrentSqliteLibraryToGoogleDrive,
  startSqliteLibraryGoogleDriveSync,
  stopSqliteLibraryCloudSync,
} from "./library-core-cloud-sync";
import { reloadSqliteLibraryState } from "./library-client";
import { base64ToBytes } from "./google-drive";
import {
  requirePrimaryLibraryCoreDesktopRole,
} from "./library-core-desktop-role";
import { safeUnlisten } from "./safe-unlisten";

export type { CloudProvider };

const CLOUD_TOKEN_KEY = (provider: CloudProvider) =>
  `freed_cloud_token_${provider}`;
const CLOUD_TOKEN_META_KEY = (provider: CloudProvider) =>
  `freed_cloud_token_meta_${provider}`;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const GOOGLE_TOKEN_REFRESH_FALLBACK_TTL_MS = 55 * 60 * 1_000;
const DEFAULT_GDRIVE_DESKTOP_CLIENT_ID =
  "304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com";
const DEFAULT_GDRIVE_TOKEN_PROXY_URL = "https://app.freed.wtf/api/oauth/google";
const GDRIVE_CLIENT_ID =
  import.meta.env.VITE_GDRIVE_DESKTOP_CLIENT_ID ||
  DEFAULT_GDRIVE_DESKTOP_CLIENT_ID;
const GDRIVE_TOKEN_PROXY_URL =
  import.meta.env.VITE_GDRIVE_TOKEN_PROXY_URL || DEFAULT_GDRIVE_TOKEN_PROXY_URL;

let googleDriveFetch: GoogleDriveFetch | undefined;
let acceptingDesktopOAuth = true;
const activeDesktopOAuthControllers = new Set<AbortController>();
const activeDesktopOAuthOperations = new Set<Promise<unknown>>();
const cloudGenerations = new Map<CloudProvider, number>();
const cloudAborts = new Map<CloudProvider, AbortController>();
const tokenRefreshes = new Map<CloudProvider, Promise<string | null>>();

export interface CloudTokenBundle {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
}

export interface DesktopOAuthOptions {
  readonly signal?: AbortSignal;
}

export interface CloudLifecycleGuard {
  isCurrent(): boolean;
}

interface TokenExchangeResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface NativeGoogleOAuthResponse {
  readonly status: number;
  readonly headers: Array<[string, string]>;
  readonly bodyB64: string;
}

export type CloudConflictWinner = "local" | "cloud";

export function setGoogleDriveFetch(
  fetcher: GoogleDriveFetch | undefined,
): void {
  googleDriveFetch = fetcher;
}

function currentGeneration(provider: CloudProvider): number {
  return cloudGenerations.get(provider) ?? 0;
}

function advanceGeneration(provider: CloudProvider): number {
  const next = currentGeneration(provider) + 1;
  cloudGenerations.set(provider, next);
  return next;
}

export function captureCloudLifecycle(
  provider: CloudProvider,
): CloudLifecycleGuard {
  const generation = currentGeneration(provider);
  return { isCurrent: () => generation === currentGeneration(provider) };
}

function decodeTokenMetadata(raw: string): CloudTokenBundle | null {
  try {
    const value = JSON.parse(raw) as Partial<CloudTokenBundle>;
    if (typeof value.accessToken !== "string" || !value.accessToken.trim()) {
      return null;
    }
    if (
      value.refreshToken !== undefined &&
      (typeof value.refreshToken !== "string" || !value.refreshToken.trim())
    ) {
      return null;
    }
    if (
      value.expiresAt !== undefined &&
      (typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt))
    ) {
      return null;
    }
    return value as CloudTokenBundle;
  } catch {
    return null;
  }
}

function readCloudTokenBundle(
  provider: CloudProvider,
): CloudTokenBundle | null {
  const metadata = localStorage.getItem(CLOUD_TOKEN_META_KEY(provider));
  if (metadata !== null) return decodeTokenMetadata(metadata);
  const accessToken = localStorage.getItem(CLOUD_TOKEN_KEY(provider));
  return accessToken?.trim() ? { accessToken } : null;
}

function persistCloudToken(
  provider: CloudProvider,
  token: string | CloudTokenBundle,
): void {
  const previous = readCloudTokenBundle(provider);
  const input = typeof token === "string" ? { accessToken: token } : token;
  const bundle: CloudTokenBundle = {
    ...input,
    refreshToken: input.refreshToken ?? previous?.refreshToken,
  };
  localStorage.setItem(CLOUD_TOKEN_KEY(provider), bundle.accessToken);
  localStorage.setItem(CLOUD_TOKEN_META_KEY(provider), JSON.stringify(bundle));
}

export function storeCloudToken(
  provider: CloudProvider,
  token: string | CloudTokenBundle,
): void {
  if (isFactoryResetInProgress()) throw createOAuthCanceledError();
  persistCloudToken(provider, token);
  clearFactoryResetCloudCleanupBarrier();
}

export function getCloudToken(provider: CloudProvider): string | null {
  return readCloudTokenBundle(provider)?.accessToken ?? null;
}

function tokenBundleFromResponse(
  data: TokenExchangeResponse,
  previousRefreshToken?: string,
): CloudTokenBundle {
  if (!data.access_token) throw new Error("Google returned no access token.");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previousRefreshToken,
    expiresAt:
      typeof data.expires_in === "number" && data.expires_in > 0
        ? Date.now() + data.expires_in * 1_000
        : Date.now() + GOOGLE_TOKEN_REFRESH_FALLBACK_TTL_MS,
  };
}

function decodeNativeBody(bodyB64: string): string {
  return new TextDecoder().decode(base64ToBytes(bodyB64));
}

async function postGoogleTokenProxy(
  payload: Record<string, unknown>,
): Promise<TokenExchangeResponse> {
  const response = await invoke<NativeGoogleOAuthResponse>(
    "google_oauth_proxy_request",
    {
      url: GDRIVE_TOKEN_PROXY_URL,
      body: JSON.stringify(payload),
      contentType: "application/json",
    },
  );
  const body = decodeNativeBody(response.bodyB64);
  if (response.status < 200 || response.status >= 300) {
    let errorCode = "";
    let description = "";
    try {
      const parsed = JSON.parse(body) as {
        readonly error?: unknown;
        readonly error_description?: unknown;
      };
      errorCode = typeof parsed.error === "string" ? parsed.error : "";
      description =
        typeof parsed.error_description === "string"
          ? parsed.error_description
          : "";
    } catch {
      // Provider response bodies can contain secrets. Never surface raw text.
    }
    const reason = description.toLowerCase().includes("client_secret")
      ? "The Google token proxy is missing its configured Google client secret."
      : errorCode === "invalid_scope"
        ? "Google rejected one or more requested permissions."
        : response.status === 401 || response.status === 403
          ? "Reconnect Google Drive and try again."
          : response.status === 429
            ? "Google is temporarily limiting OAuth requests."
            : response.status >= 500
              ? "Google OAuth is temporarily unavailable."
              : "Google rejected the OAuth request.";
    throw new Error(
      reason.startsWith("The Google token proxy")
        ? reason
        : `Google token proxy failed. ${reason}`,
    );
  }
  try {
    return JSON.parse(body || "{}") as TokenExchangeResponse;
  } catch {
    throw new Error("Google OAuth returned an invalid response.");
  }
}

async function refreshGoogleToken(
  bundle: CloudTokenBundle,
): Promise<string | null> {
  if (!bundle.refreshToken) return bundle.accessToken;
  const existing = tokenRefreshes.get("gdrive");
  if (existing) return existing;
  const refresh = (async () => {
    const data = await postGoogleTokenProxy({
      grantType: "refresh_token",
      refreshToken: bundle.refreshToken,
      clientId: GDRIVE_CLIENT_ID,
    });
    const next = tokenBundleFromResponse(data, bundle.refreshToken);
    persistCloudToken("gdrive", next);
    return next.accessToken;
  })().finally(() => tokenRefreshes.delete("gdrive"));
  tokenRefreshes.set("gdrive", refresh);
  return refresh;
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

export async function forceRefreshCloudToken(
  provider: CloudProvider,
): Promise<string | null> {
  const bundle = readCloudTokenBundle(provider);
  if (!bundle) return null;
  return provider === "gdrive"
    ? refreshGoogleToken(bundle)
    : bundle.accessToken;
}

export function getActiveProviders(): CloudProvider[] {
  return getCloudToken("gdrive") ? ["gdrive"] : [];
}

export function clearCloudProvider(provider: CloudProvider): void {
  stopCloudSync(provider);
  localStorage.removeItem(CLOUD_TOKEN_KEY(provider));
  localStorage.removeItem(CLOUD_TOKEN_META_KEY(provider));
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

function generateCodeVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=/gu, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=/gu, "");
}

export function initiateDesktopOAuth(
  provider: CloudProvider,
  options: DesktopOAuthOptions = {},
): Promise<CloudTokenBundle> {
  if (provider !== "gdrive") {
    return Promise.reject(
      new Error("The SQLite Library currently requires Google Drive."),
    );
  }
  if (!acceptingDesktopOAuth || isFactoryResetInProgress()) {
    return Promise.reject(createOAuthCanceledError());
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  activeDesktopOAuthControllers.add(controller);
  let operation!: Promise<CloudTokenBundle>;
  operation = initiateGoogleOAuth(controller.signal).finally(() => {
    options.signal?.removeEventListener("abort", abort);
    activeDesktopOAuthControllers.delete(controller);
    activeDesktopOAuthOperations.delete(operation);
  });
  activeDesktopOAuthOperations.add(operation);
  return operation;
}

async function initiateGoogleOAuth(
  signal: AbortSignal,
): Promise<CloudTokenBundle> {
  throwIfOAuthCanceled(signal);
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const port = await invoke<number>("start_oauth_server");
  throwIfOAuthCanceled(signal);
  const redirectUri = `http://localhost:${port.toLocaleString("en-US", { useGrouping: false })}/callback`;
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: GDRIVE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope:
      "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/contacts.readonly",
    include_granted_scopes: "true",
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  let unlisten: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;
  const code = await new Promise<string>(async (resolve, reject) => {
    const finish = () => {
      if (timer) clearTimeout(timer);
      if (abortHandler) signal.removeEventListener("abort", abortHandler);
      safeUnlisten(unlisten, "cloud-oauth-code");
    };
    abortHandler = () => {
      finish();
      reject(createOAuthCanceledError());
    };
    timer = setTimeout(() => {
      finish();
      reject(new Error("OAuth timed out waiting for the browser callback."));
    }, 300_000);
    unlisten = await listen<{ code: string; state: string }>(
      "cloud-oauth-code",
      (event) => {
        finish();
        if (event.payload.state !== state) {
          reject(
            new Error("OAuth state mismatch. Please try connecting again."),
          );
        } else if (!event.payload.code) {
          reject(new Error("OAuth callback did not include a code."));
        } else {
          resolve(event.payload.code);
        }
      },
    );
    signal.addEventListener("abort", abortHandler, { once: true });
    try {
      throwIfOAuthCanceled(signal);
      await shellOpen(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    } catch (error) {
      finish();
      reject(error);
    }
  });
  throwIfOAuthCanceled(signal);
  const data = await postGoogleTokenProxy({
    code,
    verifier,
    redirectUri,
    clientId: GDRIVE_CLIENT_ID,
  });
  throwIfOAuthCanceled(signal);
  return tokenBundleFromResponse(data);
}

export async function quiesceDesktopOAuthForFactoryReset(): Promise<void> {
  acceptingDesktopOAuth = false;
  for (const controller of activeDesktopOAuthControllers) controller.abort();
  await Promise.allSettled([...activeDesktopOAuthOperations]);
}

function markConnected(published: boolean): void {
  const now = Date.now();
  updateCloudProvider("gdrive", {
    status: "connected",
    stage: "idle",
    lastSuccessfulAt: now,
    lastSyncAt: now,
    lastUploadAt: published ? now : undefined,
    statusMessage: "SQLite Library sync is connected.",
    pendingReason: "Local revisions publish as immutable checkpoint pages.",
    error: undefined,
  });
  recordCloudProviderEvent("gdrive", {
    kind: "success",
    stage: "idle",
    message: published
      ? "Published the current SQLite Library revision."
      : "The SQLite Library checkpoint is current.",
  });
}

export async function startCloudSync(
  provider: CloudProvider,
  token: string,
): Promise<void> {
  if (provider !== "gdrive") {
    throw new Error("The SQLite Library currently requires Google Drive.");
  }
  if (!isSqliteLibraryGoogleDriveSyncEnabled()) {
    throw new Error(
      "SQLite Library cloud sync is disabled on this Freed Desktop.",
    );
  }
  requirePrimaryLibraryCoreDesktopRole();
  if (hasFactoryResetCloudCleanupBarrier()) return;
  stopCloudSync(provider);
  persistCloudToken(provider, token);
  const generation = currentGeneration(provider);
  const controller = new AbortController();
  cloudAborts.set(provider, controller);
  updateCloudProvider(provider, {
    status: "connecting",
    stage: "upload",
    statusMessage: "Publishing the SQLite Library checkpoint.",
    pendingReason: "Building bounded immutable checkpoint pages.",
  });
  let result: Awaited<ReturnType<typeof startSqliteLibraryGoogleDriveSync>>;
  try {
    result = await startSqliteLibraryGoogleDriveSync({
      accessToken: token,
      googleFetch: googleDriveFetch,
      resolveAccessToken: async () => {
        if (
          controller.signal.aborted ||
          generation !== currentGeneration(provider)
        ) {
          throw new Error("SQLite Library sync stopped.");
        }
        const accessToken = await getValidCloudToken(provider);
        if (!accessToken)
          throw new Error("Reconnect Google Drive to resume sync.");
        return accessToken;
      },
    });
  } catch (error) {
    if (
      controller.signal.aborted ||
      generation !== currentGeneration(provider)
    ) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    updateCloudProvider(provider, {
      status: "error",
      stage: "idle",
      error: message,
      statusMessage: "SQLite Library sync needs attention.",
      pendingReason:
        "Try Sync now again. Reconnect Google Drive if the problem continues.",
    });
    recordCloudProviderEvent(provider, {
      kind: "error",
      stage: "idle",
      message,
    });
    throw error;
  }
  if (controller.signal.aborted || generation !== currentGeneration(provider))
    return;
  if (result.status === "ownership_required") {
    updateCloudProvider(provider, {
      status: "error",
      stage: "idle",
      error: "Another Freed Desktop currently owns writes for this Library.",
      statusMessage:
        "This Freed Desktop is read-only until ownership is transferred.",
      pendingReason:
        "Use Make This Freed Desktop the Writer to transfer ownership.",
    });
    return;
  }
  markConnected(result.status === "published");
}

function stopCloudSync(provider: CloudProvider): void {
  advanceGeneration(provider);
  cloudAborts.get(provider)?.abort();
  cloudAborts.delete(provider);
  stopSqliteLibraryCloudSync();
}

export function stopSync(): void {
  stopAllCloudSyncs();
}

export function stopAllCloudSyncs(): void {
  stopCloudSync("gdrive");
}

export async function restartCloudSync(provider: CloudProvider): Promise<void> {
  const token = await getValidCloudToken(provider);
  if (!token || hasFactoryResetCloudCleanupBarrier()) return;
  await startCloudSync(provider, token);
}

export async function startAllCloudSyncs(): Promise<void> {
  await Promise.all(getActiveProviders().map(restartCloudSync));
}

export async function syncCloudProviderNow(
  provider: CloudProvider,
): Promise<void> {
  if (provider !== "gdrive") {
    throw new Error("The SQLite Library currently requires Google Drive.");
  }
  requirePrimaryLibraryCoreDesktopRole();
  const accessToken = await getValidCloudToken(provider);
  if (!accessToken) throw new Error("Reconnect Google Drive to resume sync.");
  const result = await publishCurrentSqliteLibraryToGoogleDrive({
    accessToken,
    googleFetch: googleDriveFetch,
    signal: cloudAborts.get(provider)?.signal,
  });
  if (result.status === "ownership_required") {
    throw new Error(
      "Another Freed Desktop currently owns writes for this Library.",
    );
  }
  markConnected(result.status === "published");
}

export async function transferSqliteLibraryWriterToThisDesktop(): Promise<void> {
  requirePrimaryLibraryCoreDesktopRole();
  const accessToken = await getValidCloudToken("gdrive");
  if (!accessToken)
    throw new Error("Reconnect Google Drive to transfer ownership.");
  const result = await makeThisSqliteLibraryDesktopWriter({
    accessToken,
    googleFetch: googleDriveFetch,
    signal: cloudAborts.get("gdrive")?.signal,
  });
  if (result.status === "bootstrap_required") {
    throw new Error(
      "Download the current cloud Library before taking ownership.",
    );
  }
  if (result.status === "ownership_required") {
    throw new Error(
      "Library ownership changed. Review the current owner and try again.",
    );
  }
  await reloadSqliteLibraryState();
  await startCloudSync("gdrive", accessToken);
}

export async function resolveCloudSyncConflict(
  provider: CloudProvider,
  winner: CloudConflictWinner,
): Promise<void> {
  if (winner === "local") {
    await transferSqliteLibraryWriterToThisDesktop();
  } else {
    await restartCloudSync(provider);
  }
}

export async function deleteCloudFile(
  _provider: CloudProvider,
  _token: string,
): Promise<void> {
  throw new Error(
    "Factory reset cannot delete the active SQLite Library authority.",
  );
}

export async function clearStoredCloudDataForFactoryReset(
  deleteFromCloud: boolean,
): Promise<void> {
  beginFactoryResetCloudCleanup();
  stopAllCloudSyncs();
  await clearStoredCloudProvidersForFactoryReset({
    providers: ["gdrive"] as const,
    deleteFromCloud,
    getStoredToken: getCloudToken,
    deleteCloudFile,
    clearStoredCredentials: clearCloudProvider,
  });
  clearFactoryResetCloudCleanupBarrier();
}
