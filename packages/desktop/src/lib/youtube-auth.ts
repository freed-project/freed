import { invoke } from "@tauri-apps/api/core";
import {
  clearTransientLastCaptureError,
  persistDisconnectedSocialAuthStateForFactoryReset,
  readStoredSocialAuthState,
} from "./social-auth-transient-errors";
import { clearYouTubePlaylistState } from "./youtube-playlist";
import {
  isDesktopProviderAuthAllowed,
  requestDesktopProviderAuthCheck,
  runDesktopProviderAuthRequest,
} from "./provider-auth-lifecycle";

export interface YouTubeAuthState {
  isAuthenticated: boolean;
  lastCheckedAt?: number;
  lastCapturedAt?: number;
  lastCaptureError?: string;
  pausedUntil?: number;
  pauseReason?: string;
  pauseLevel?: 1 | 2 | 3;
}

const YOUTUBE_AUTH_KEY = "youtube_auth_state";

/** Open YouTube in the persistent native session used for later capture. */
export async function showYouTubeLogin(): Promise<void> {
  if (!isDesktopProviderAuthAllowed()) return;
  await runDesktopProviderAuthRequest(async () => {
    await invoke("yt_show_login");
  });
}

/** Hide the visible login window while preserving its authenticated session. */
export async function hideYouTubeLogin(): Promise<void> {
  await invoke("yt_hide_login");
}

/** Verify the authenticated website session through the native YouTube WebView. */
export async function checkYouTubeAuth(): Promise<boolean> {
  if (!isDesktopProviderAuthAllowed()) return false;
  return requestDesktopProviderAuthCheck<{ loggedIn: boolean }>({
    eventName: "yt-auth-result",
    command: "yt_check_auth",
    timeoutMs: 20_000,
    isLoggedIn: (payload) => payload.loggedIn,
  });
}

/** Remove the local YouTube website session without touching the user's account. */
export async function disconnectYouTube(): Promise<void> {
  localStorage.removeItem(YOUTUBE_AUTH_KEY);
  clearYouTubePlaylistState();
  await invoke("yt_disconnect");
}

/** Clear the native session while preserving request receipts and playlist progress. */
export async function disconnectYouTubeForFactoryReset(): Promise<void> {
  persistDisconnectedSocialAuthStateForFactoryReset(YOUTUBE_AUTH_KEY, "YouTube");
  await invoke("yt_disconnect");
}

export function storeYouTubeAuthState(state: YouTubeAuthState): void {
  if (!isDesktopProviderAuthAllowed()) return;
  localStorage.setItem(
    YOUTUBE_AUTH_KEY,
    JSON.stringify(clearTransientLastCaptureError(state)),
  );
}

export function initYouTubeAuth(): YouTubeAuthState {
  const stored = readStoredSocialAuthState<YouTubeAuthState>(YOUTUBE_AUTH_KEY);
  return stored.status === "supported"
    ? stored.state
    : { isAuthenticated: false };
}
