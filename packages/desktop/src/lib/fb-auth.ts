/**
 * Facebook authentication via Tauri WebView
 *
 * Instead of manual cookie pasting, the user logs in through a real
 * Facebook login page rendered in a Tauri WebView. The WebView shares
 * cookies with the scraper window, so once logged in, scraping just works.
 */

import { invoke } from "@tauri-apps/api/core";
import { selectPlatformUA, clearPlatformUA } from "./user-agent";
import { log } from "./logger";
import {
  persistDisconnectedSocialAuthStateForFactoryReset,
  readStoredSocialAuthState,
  serializeSocialAuthStateForStorage,
} from "./social-auth-transient-errors";
import {
  isDesktopProviderAuthAllowed,
  requestDesktopProviderAuthCheck,
  runDesktopProviderAuthRequest,
} from "./provider-auth-lifecycle";

export interface FbAuthState {
  isAuthenticated: boolean;
  /** Timestamp of last successful auth check */
  lastCheckedAt?: number;
  /** Epoch ms of the last completed (successful) scrape */
  lastCapturedAt?: number;
  /** Error message from the last failed scrape; undefined when last scrape succeeded */
  lastCaptureError?: string;
  pausedUntil?: number;
  pauseReason?: string;
  pauseLevel?: 1 | 2 | 3;
}

const FB_AUTH_KEY = "fb_auth_state";

/**
 * Open the Facebook login WebView so the user can authenticate.
 * The window is visible and allows normal Facebook login. Once logged
 * in, Freed marks the session connected and the user closes the window.
 */
export async function showFbLogin(): Promise<void> {
  if (!isDesktopProviderAuthAllowed()) return;
  await runDesktopProviderAuthRequest(async () => {
    // Generate and persist a fresh session UA at connect time.
    const userAgent = selectPlatformUA("facebook");
    log.info("[FB] show login requested");
    try {
      await invoke("fb_show_login", { userAgent });
      log.info("[FB] show login IPC completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`[FB] show login IPC failed: ${message}`);
      throw error;
    }
  });
}

/**
 * Hide the login WebView after the user is done with provider prompts.
 */
export async function hideFbLogin(): Promise<void> {
  await invoke("fb_hide_login");
}

/**
 * Check if the Facebook WebView has an active authenticated session.
 * This creates a hidden WebView, loads facebook.com, and checks for
 * the c_user cookie. Returns a promise that resolves when the auth
 * result event arrives.
 */
export async function checkFbAuth(): Promise<boolean> {
  if (!isDesktopProviderAuthAllowed()) return false;
  return requestDesktopProviderAuthCheck<{ loggedIn: boolean }>({
    eventName: "fb-auth-result",
    command: "fb_check_auth",
    timeoutMs: 15_000,
    isLoggedIn: (payload) => payload.loggedIn,
  });
}

/**
 * Disconnect Facebook by clearing all WebView browsing data.
 */
export async function disconnectFb(): Promise<void> {
  localStorage.removeItem(FB_AUTH_KEY);
  await invoke("fb_disconnect");
  clearPlatformUA("facebook");
}

/** Clear the native session while preserving request history, pause state, and platform identity. */
export async function disconnectFbForFactoryReset(): Promise<void> {
  persistDisconnectedSocialAuthStateForFactoryReset(FB_AUTH_KEY, "Facebook");
  await invoke("fb_disconnect");
}

/**
 * Persist auth state to localStorage for fast startup.
 */
export function storeFbAuthState(state: FbAuthState): void {
  if (!isDesktopProviderAuthAllowed()) return;
  localStorage.setItem(FB_AUTH_KEY, serializeSocialAuthStateForStorage(state));
}

/**
 * Load persisted auth state. On startup this gives us a quick hint;
 * the real check happens via checkFbAuth().
 */
export function initFbAuth(): FbAuthState {
  const stored = readStoredSocialAuthState<FbAuthState>(FB_AUTH_KEY);
  return stored.status === "supported"
    ? stored.state
    : { isAuthenticated: false };
}
