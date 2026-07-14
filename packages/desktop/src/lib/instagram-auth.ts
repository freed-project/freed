/**
 * Instagram authentication via Tauri WebView
 *
 * Instead of manual cookie pasting, the user logs in through a real
 * Instagram login page rendered in a Tauri WebView. The WebView shares
 * cookies with the scraper window, so once logged in, scraping just works.
 */

import { invoke } from "@tauri-apps/api/core";
import { selectPlatformUA, clearPlatformUA } from "./user-agent";
import {
  clearTransientLastCaptureError,
  persistDisconnectedSocialAuthStateForFactoryReset,
  readStoredSocialAuthState,
} from "./social-auth-transient-errors";
import {
  isDesktopProviderAuthAllowed,
  requestDesktopProviderAuthCheck,
  runDesktopProviderAuthRequest,
} from "./provider-auth-lifecycle";

export interface IgAuthState {
  isAuthenticated: boolean;
  lastCheckedAt?: number;
  /** Epoch ms of the last completed (successful) scrape */
  lastCapturedAt?: number;
  /** Error message from the last failed scrape; undefined when last scrape succeeded */
  lastCaptureError?: string;
  pausedUntil?: number;
  pauseReason?: string;
  pauseLevel?: 1 | 2 | 3;
}

const IG_AUTH_KEY = "ig_auth_state";

/**
 * Open the Instagram login WebView so the user can authenticate.
 * The window is visible and allows normal Instagram login. Once logged
 * in, Freed marks the session connected and the user closes the window.
 */
export async function showIgLogin(): Promise<void> {
  if (!isDesktopProviderAuthAllowed()) return;
  await runDesktopProviderAuthRequest(async () => {
    const userAgent = selectPlatformUA("instagram");
    await invoke("ig_show_login", { userAgent });
  });
}

/**
 * Hide the login WebView after the user is done with provider prompts.
 */
export async function hideIgLogin(): Promise<void> {
  await invoke("ig_hide_login");
}

/**
 * Check if the Instagram WebView has an active authenticated session.
 * This creates a hidden WebView, loads instagram.com, and checks for
 * the sessionid cookie. Returns a promise that resolves when the auth
 * result event arrives.
 */
export async function checkIgAuth(): Promise<boolean> {
  if (!isDesktopProviderAuthAllowed()) return false;
  return requestDesktopProviderAuthCheck<{ loggedIn: boolean }>({
    eventName: "ig-auth-result",
    command: "ig_check_auth",
    timeoutMs: 15_000,
    isLoggedIn: (payload) => payload.loggedIn,
  });
}

/**
 * Disconnect Instagram by clearing all WebView browsing data.
 */
export async function disconnectIg(): Promise<void> {
  localStorage.removeItem(IG_AUTH_KEY);
  await invoke("ig_disconnect");
  clearPlatformUA("instagram");
}

/** Clear the native session while preserving request history, pause state, and platform identity. */
export async function disconnectIgForFactoryReset(): Promise<void> {
  persistDisconnectedSocialAuthStateForFactoryReset(IG_AUTH_KEY, "Instagram");
  await invoke("ig_disconnect");
}

/**
 * Persist auth state to localStorage for fast startup.
 */
export function storeIgAuthState(state: IgAuthState): void {
  if (!isDesktopProviderAuthAllowed()) return;
  localStorage.setItem(IG_AUTH_KEY, JSON.stringify(clearTransientLastCaptureError(state)));
}

/**
 * Load persisted auth state. On startup this gives us a quick hint;
 * the real check happens via checkIgAuth().
 */
export function initIgAuth(): IgAuthState {
  const stored = readStoredSocialAuthState<IgAuthState>(IG_AUTH_KEY);
  return stored.status === "supported"
    ? stored.state
    : { isAuthenticated: false };
}
