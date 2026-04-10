/**
 * LinkedIn authentication via Tauri WebView
 *
 * Instead of manual cookie management, the user logs in through a real
 * LinkedIn login page rendered in a Tauri WebView. The WebView shares
 * cookies with the scraper window, so once logged in, scraping just works.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { selectPlatformUA, clearPlatformUA } from "./user-agent";

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
 * in, the user closes the window (or we hide it after detecting auth).
 */
export async function showLiLogin(): Promise<void> {
  // Generate and persist a fresh session UA at connect time.
  const userAgent = selectPlatformUA("linkedin");
  await invoke("li_show_login", { userAgent });
}

/**
 * Hide the login WebView (called after successful auth detection).
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
  return new Promise<boolean>((resolve) => {
    let unlisten: UnlistenFn | null = null;
    const timeout = setTimeout(() => {
      unlisten?.();
      resolve(false);
    }, 15_000);

    listen<{ loggedIn: boolean }>("li-auth-result", (event) => {
      clearTimeout(timeout);
      unlisten?.();
      resolve(event.payload.loggedIn);
    }).then((fn) => {
      unlisten = fn;
    });

    invoke("li_check_auth").catch(() => {
      clearTimeout(timeout);
      unlisten?.();
      resolve(false);
    });
  });
}

/**
 * Disconnect LinkedIn by clearing all WebView browsing data.
 */
export async function disconnectLi(): Promise<void> {
  await invoke("li_disconnect");
  localStorage.removeItem(LI_AUTH_KEY);
  clearPlatformUA("linkedin");
}

/**
 * Persist auth state to localStorage for fast startup.
 */
export function storeLiAuthState(state: LiAuthState): void {
  localStorage.setItem(LI_AUTH_KEY, JSON.stringify(state));
}

/**
 * Load persisted auth state. On startup this gives us a quick hint;
 * the real check happens via checkLiAuth().
 */
export function initLiAuth(): LiAuthState {
  const stored = localStorage.getItem(LI_AUTH_KEY);
  if (!stored) return { isAuthenticated: false };
  try {
    const parsed = JSON.parse(stored) as LiAuthState;
    return {
      isAuthenticated: !!parsed.isAuthenticated,
      lastCheckedAt: parsed.lastCheckedAt,
      lastCapturedAt: parsed.lastCapturedAt,
      lastCaptureError: parsed.lastCaptureError,
      pausedUntil: parsed.pausedUntil,
      pauseReason: parsed.pauseReason,
      pauseLevel: parsed.pauseLevel,
    };
  } catch {
    return { isAuthenticated: false };
  }
}
