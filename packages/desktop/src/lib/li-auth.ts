/**
 * LinkedIn authentication via Tauri WebView
 *
 * Instead of manual cookie management, the user logs in through a real
 * LinkedIn login page rendered in a Tauri WebView. The WebView shares
 * cookies with the scraper window, so once logged in, scraping just works.
 */

import { invoke } from "@tauri-apps/api/core";
import { selectPlatformUA, clearPlatformUA } from "./user-agent";
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

export interface LiAuthState {
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

const LI_AUTH_KEY = "li_auth_state";

/**
 * Open the LinkedIn login WebView so the user can authenticate.
 * The window is visible and allows normal LinkedIn login. Once logged
 * in, Freed marks the session connected and the user closes the window.
 */
export async function showLiLogin(): Promise<void> {
  if (!isDesktopProviderAuthAllowed()) return;
  await runDesktopProviderAuthRequest(async () => {
    // Generate and persist a fresh session UA at connect time.
    const userAgent = selectPlatformUA("linkedin");
    await invoke("li_show_login", { userAgent });
  });
}

/**
 * Hide the login WebView after the user is done with provider prompts.
 */
export async function hideLiLogin(): Promise<void> {
  await invoke("li_hide_login");
}

/**
 * Check if the LinkedIn WebView has an active authenticated session.
 * This creates a hidden WebView, loads linkedin.com/feed, and checks
 * for the li_at session cookie. Returns a promise that resolves when
 * the auth result event arrives.
 */
export async function checkLiAuth(): Promise<boolean> {
  if (!isDesktopProviderAuthAllowed()) return false;
  return requestDesktopProviderAuthCheck<{ loggedIn: boolean }>({
    eventName: "li-auth-result",
    command: "li_check_auth",
    timeoutMs: 15_000,
    isLoggedIn: (payload) => payload.loggedIn,
  });
}

/**
 * Disconnect LinkedIn by clearing all WebView browsing data.
 */
export async function disconnectLi(): Promise<void> {
  localStorage.removeItem(LI_AUTH_KEY);
  await invoke("li_disconnect");
  clearPlatformUA("linkedin");
}

/** Clear the native session while preserving request history, pause state, and platform identity. */
export async function disconnectLiForFactoryReset(): Promise<void> {
  persistDisconnectedSocialAuthStateForFactoryReset(LI_AUTH_KEY, "LinkedIn");
  await invoke("li_disconnect");
}

/**
 * Persist only nonsecret auth hints and controlled failure summaries for fast startup.
 */
export function storeLiAuthState(state: LiAuthState): void {
  if (!isDesktopProviderAuthAllowed()) return;
  localStorage.setItem(LI_AUTH_KEY, serializeSocialAuthStateForStorage(state));
}

/**
 * Load persisted auth state. On startup this gives us a quick hint;
 * the real check happens via checkLiAuth().
 */
export function initLiAuth(): LiAuthState {
  const stored = readStoredSocialAuthState<LiAuthState>(LI_AUTH_KEY);
  return stored.status === "supported"
    ? stored.state
    : { isAuthenticated: false };
}
