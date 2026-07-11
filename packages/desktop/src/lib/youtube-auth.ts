import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlisten } from "./safe-unlisten";
import { clearTransientLastCaptureError } from "./social-auth-transient-errors";
import { clearYouTubePlaylistState } from "./youtube-playlist";

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
  await invoke("yt_show_login");
}

/** Close the visible login window after the user has finished account prompts. */
export async function hideYouTubeLogin(): Promise<void> {
  await invoke("yt_hide_login");
}

/** Verify the authenticated website session through the native YouTube WebView. */
export async function checkYouTubeAuth(): Promise<boolean> {
  let unlisten: UnlistenFn | null = null;
  let timeout: number | null = null;
  let resolveResult: ((loggedIn: boolean) => void) | null = null;
  const result = new Promise<boolean>((resolve) => {
    resolveResult = resolve;
  });

  try {
    unlisten = await listen<{ loggedIn: boolean }>("yt-auth-result", (event) => {
      resolveResult?.(event.payload.loggedIn);
    });
    timeout = window.setTimeout(() => resolveResult?.(false), 20_000);
    void invoke("yt_check_auth").catch(() => resolveResult?.(false));
    return await result;
  } catch {
    return false;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
    safeUnlisten(unlisten, "yt-auth-result");
  }
}

/** Remove the local YouTube website session without touching the user's account. */
export async function disconnectYouTube(): Promise<void> {
  try {
    await invoke("yt_disconnect");
  } finally {
    localStorage.removeItem(YOUTUBE_AUTH_KEY);
    clearYouTubePlaylistState();
  }
}

export function storeYouTubeAuthState(state: YouTubeAuthState): void {
  localStorage.setItem(
    YOUTUBE_AUTH_KEY,
    JSON.stringify(clearTransientLastCaptureError(state)),
  );
}

export function initYouTubeAuth(): YouTubeAuthState {
  const stored = localStorage.getItem(YOUTUBE_AUTH_KEY);
  if (!stored) return { isAuthenticated: false };

  try {
    const parsed = JSON.parse(stored) as YouTubeAuthState;
    return clearTransientLastCaptureError({
      isAuthenticated: parsed.isAuthenticated === true,
      lastCheckedAt: parsed.lastCheckedAt,
      lastCapturedAt: parsed.lastCapturedAt,
      lastCaptureError: parsed.lastCaptureError,
      pausedUntil: parsed.pausedUntil,
      pauseReason: parsed.pauseReason,
      pauseLevel: parsed.pauseLevel,
    });
  } catch {
    return { isAuthenticated: false };
  }
}
