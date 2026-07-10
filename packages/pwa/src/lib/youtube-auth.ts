import { getGoogleOAuthClientId, initiateGoogleOAuth } from "./cloud-oauth";
import {
  YOUTUBE_PLAYLIST_WRITE_SCOPE,
  YOUTUBE_READONLY_SCOPE,
} from "@freed/capture-youtube";

const YOUTUBE_TOKEN_STORAGE_KEY = "freed_youtube_oauth_token_v1";
const TOKEN_REFRESH_SKEW_MS = 60_000;
const GOOGLE_TOKEN_FALLBACK_TTL_MS = 55 * 60_000;

export const YOUTUBE_OAUTH_SUCCESS_PATH = "/?youtube_oauth=connected";

export type YouTubeOAuthAccess = "readonly" | "playlist";

export interface YouTubeTokenBundle {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  clientId?: string;
  requiresReconnect?: boolean;
}

let activeRefresh: Promise<string | null> | null = null;

/** Start a Google OAuth grant for YouTube reading or private playlist access. */
export async function initiateYouTubeOAuth(
  access: YouTubeOAuthAccess = "readonly",
): Promise<void> {
  const scope = access === "playlist" ? YOUTUBE_PLAYLIST_WRITE_SCOPE : YOUTUBE_READONLY_SCOPE;
  await initiateGoogleOAuth("youtube", [scope]);
}

/** Persist YouTube credentials only on this device. */
export function storeYouTubeToken(token: YouTubeTokenBundle): void {
  const stored: YouTubeTokenBundle = {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    scope: token.scope,
    clientId: token.clientId ?? getGoogleOAuthClientId("youtube"),
  };
  localStorage.setItem(YOUTUBE_TOKEN_STORAGE_KEY, JSON.stringify(stored));
}

/** Read the device-local YouTube credential bundle. */
export function getStoredYouTubeToken(): YouTubeTokenBundle | null {
  const raw = localStorage.getItem(YOUTUBE_TOKEN_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<YouTubeTokenBundle>;
    if (typeof parsed.accessToken !== "string" || !parsed.accessToken) {
      throw new Error("Stored YouTube token has no access token");
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" && parsed.refreshToken
        ? parsed.refreshToken
        : undefined,
      expiresAt: typeof parsed.expiresAt === "number" && Number.isFinite(parsed.expiresAt)
        ? parsed.expiresAt
        : undefined,
      scope: typeof parsed.scope === "string" && parsed.scope ? parsed.scope : undefined,
      clientId: typeof parsed.clientId === "string" && parsed.clientId
        ? parsed.clientId
        : undefined,
      requiresReconnect: parsed.requiresReconnect === true || undefined,
    };
  } catch {
    localStorage.removeItem(YOUTUBE_TOKEN_STORAGE_KEY);
    return null;
  }
}

/** Remove YouTube credentials from this device without changing cloud sync. */
export function clearYouTubeAuth(): void {
  localStorage.removeItem(YOUTUBE_TOKEN_STORAGE_KEY);
  activeRefresh = null;
}

/** Whether the current Google grant permits private playlist writes. */
export function hasYouTubePlaylistAccess(
  bundle: YouTubeTokenBundle | null = getStoredYouTubeToken(),
): boolean {
  return bundle?.scope?.split(/\s+/).includes(YOUTUBE_PLAYLIST_WRITE_SCOPE) ?? false;
}

/** Whether Google has rejected the stored grant and the user must authorize again. */
export function needsYouTubeReconnect(
  bundle: YouTubeTokenBundle | null = getStoredYouTubeToken(),
): boolean {
  return bundle?.requiresReconnect === true;
}

/** Return a usable YouTube access token, refreshing shortly before expiry. */
export async function getValidYouTubeAccessToken(forceRefresh = false): Promise<string | null> {
  const bundle = getStoredYouTubeToken();
  if (!bundle) return null;
  if (bundle.requiresReconnect) {
    throw new Error("YouTube authorization expired. Reconnect YouTube in Settings and try again.");
  }

  const expiresSoon = typeof bundle.expiresAt === "number"
    && bundle.expiresAt - Date.now() <= TOKEN_REFRESH_SKEW_MS;
  if (!forceRefresh && !expiresSoon) return bundle.accessToken;
  if (!bundle.refreshToken) return bundle.accessToken;

  if (activeRefresh) return activeRefresh;
  const refresh = refreshYouTubeToken(bundle).finally(() => {
    if (activeRefresh === refresh) activeRefresh = null;
  });
  activeRefresh = refresh;
  return refresh;
}

/** Fetch a YouTube API resource and retry once after a 401 token refresh. */
export async function fetchYouTubeWithAuth(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getValidYouTubeAccessToken();
  if (!token) throw new Error("YouTube is not connected on this device.");

  let response = await fetch(input, withBearerToken(init, token));
  if (response.status !== 401 || !getStoredYouTubeToken()?.refreshToken) {
    if (response.status === 401) markYouTubeReconnectRequired();
    return response;
  }

  const refreshedToken = await getValidYouTubeAccessToken(true);
  if (!refreshedToken) return response;
  response = await fetch(input, withBearerToken(init, refreshedToken));
  if (response.status === 401) markYouTubeReconnectRequired();
  return response;
}

async function refreshYouTubeToken(bundle: YouTubeTokenBundle): Promise<string> {
  const response = await fetch("/api/oauth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "refresh_token",
      refreshToken: bundle.refreshToken,
      clientId: bundle.clientId ?? getGoogleOAuthClientId("youtube"),
    }),
  });
  const data = await response.json().catch(() => ({ error: "invalid JSON from proxy" })) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  if (!response.ok) {
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      markYouTubeReconnectRequired();
    }
    throw new Error(`YouTube token refresh failed: ${data.error ?? response.status}`);
  }
  if (!data.access_token) {
    markYouTubeReconnectRequired();
    throw new Error("YouTube token proxy returned no access token.");
  }

  storeYouTubeToken({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? bundle.refreshToken,
    expiresAt: typeof data.expires_in === "number" && data.expires_in > 0
      ? Date.now() + data.expires_in * 1000
      : Date.now() + GOOGLE_TOKEN_FALLBACK_TTL_MS,
    scope: data.scope ?? bundle.scope,
    clientId: bundle.clientId ?? getGoogleOAuthClientId("youtube"),
  });
  return data.access_token;
}

function markYouTubeReconnectRequired(): void {
  const token = getStoredYouTubeToken();
  if (!token || token.requiresReconnect) return;
  localStorage.setItem(YOUTUBE_TOKEN_STORAGE_KEY, JSON.stringify({
    ...token,
    requiresReconnect: true,
  }));
}

function withBearerToken(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}
