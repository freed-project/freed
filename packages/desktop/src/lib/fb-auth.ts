/**
 * Facebook authentication via Tauri WebView
 *
 * Instead of manual cookie pasting, the user logs in through a real
 * Facebook login page rendered in a Tauri WebView. The WebView shares
 * cookies with the scraper window, so once logged in, scraping just works.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { selectPlatformUA, clearPlatformUA } from "./user-agent";

export interface FbAuthState {
  isAuthenticated: boolean;
  /** Timestamp of last successful auth check */
  lastCheckedAt?: number;
  /** Epoch ms of the last completed (successful) scrape */
  lastCapturedAt?: number;
  /** Error message from the last failed scrape; undefined when last scrape succeeded */
  lastCaptureError?: string;
}

const FB_AUTH_KEY = "fb_auth_state";

/**
 * Open the Facebook login WebView so the user can authenticate.
 * The window is visible and allows normal Facebook login. Once logged
 * in, the user closes the window (or we hide it after detecting auth).
 */
export async function showFbLogin(): Promise<void> {
  // Generate and persist a fresh session UA at connect time.
  const userAgent = selectPlatformUA("facebook");
  await invoke("fb_show_login", { userAgent });
}

/**
 * Hide the login WebView (called after successful auth detection).
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
  return new Promise<boolean>((resolve) => {
    let unlisten: UnlistenFn | null = null;
    const timeout = setTimeout(() => {
      unlisten?.();
      resolve(false);
    }, 15_000);

    listen<{ loggedIn: boolean }>("fb-auth-result", (event) => {
      clearTimeout(timeout);
      unlisten?.();
      resolve(event.payload.loggedIn);
    }).then((fn) => {
      unlisten = fn;
    });

    invoke("fb_check_auth").catch(() => {
      clearTimeout(timeout);
      unlisten?.();
      resolve(false);
    });
  });
}

/**
 * Disconnect Facebook by clearing all WebView browsing data.
 */
export async function disconnectFb(): Promise<void> {
  await invoke("fb_disconnect");
  localStorage.removeItem(FB_AUTH_KEY);
  clearPlatformUA("facebook");
}

/**
 * Persist auth state to localStorage for fast startup.
 */
export function storeFbAuthState(state: FbAuthState): void {
  localStorage.setItem(FB_AUTH_KEY, JSON.stringify(state));
}

/**
 * Load persisted auth state. On startup this gives us a quick hint;
 * the real check happens via checkFbAuth().
 */
export function initFbAuth(): FbAuthState {
  const stored = localStorage.getItem(FB_AUTH_KEY);
  if (!stored) return { isAuthenticated: false };
  try {
    const parsed = JSON.parse(stored) as FbAuthState;
    return {
      isAuthenticated: !!parsed.isAuthenticated,
      lastCheckedAt: parsed.lastCheckedAt,
      lastCapturedAt: parsed.lastCapturedAt,
      lastCaptureError: parsed.lastCaptureError,
    };
  } catch {
    return { isAuthenticated: false };
  }
}
