/**
 * Instagram authentication via Tauri WebView
 *
 * Instead of manual cookie pasting, the user logs in through a real
 * Instagram login page rendered in a Tauri WebView. The WebView shares
 * cookies with the scraper window, so once logged in, scraping just works.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface IgAuthState {
  isAuthenticated: boolean;
  lastCheckedAt?: number;
}

const IG_AUTH_KEY = "ig_auth_state";

/**
 * Open the Instagram login WebView so the user can authenticate.
 * The window is visible and allows normal Instagram login. Once logged
 * in, the on_navigation handler detects the redirect and hides the window.
 */
export async function showIgLogin(): Promise<void> {
  await invoke("ig_show_login");
}

/**
 * Hide the login WebView (called after successful auth detection).
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
  return new Promise<boolean>((resolve) => {
    let unlisten: UnlistenFn | null = null;
    const timeout = setTimeout(() => {
      unlisten?.();
      resolve(false);
    }, 15_000);

    listen<{ loggedIn: boolean }>("ig-auth-result", (event) => {
      clearTimeout(timeout);
      unlisten?.();
      resolve(event.payload.loggedIn);
    }).then((fn) => {
      unlisten = fn;
    });

    invoke("ig_check_auth").catch(() => {
      clearTimeout(timeout);
      unlisten?.();
      resolve(false);
    });
  });
}

/**
 * Disconnect Instagram by clearing all WebView browsing data.
 */
export async function disconnectIg(): Promise<void> {
  await invoke("ig_disconnect");
  localStorage.removeItem(IG_AUTH_KEY);
}

/**
 * Persist auth state to localStorage for fast startup.
 */
export function storeIgAuthState(state: IgAuthState): void {
  localStorage.setItem(IG_AUTH_KEY, JSON.stringify(state));
}

/**
 * Load persisted auth state. On startup this gives us a quick hint;
 * the real check happens via checkIgAuth().
 */
export function initIgAuth(): IgAuthState {
  const stored = localStorage.getItem(IG_AUTH_KEY);
  if (!stored) return { isAuthenticated: false };
  try {
    const parsed = JSON.parse(stored) as IgAuthState;
    return { isAuthenticated: !!parsed.isAuthenticated, lastCheckedAt: parsed.lastCheckedAt };
  } catch {
    return { isAuthenticated: false };
  }
}
