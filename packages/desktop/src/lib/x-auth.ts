/**
 * X/Twitter authentication state management for the desktop
 *
 * Cookie types, parsing, and string-based validation delegate to
 * @freed/capture-x. This module owns the desktop-specific concerns:
 * localStorage persistence, Zustand-facing state shape, and the manual
 * cookie-entry flow (the desktop UI collects ct0 + auth_token from the user
 * directly rather than extracting from a browser SQLite DB).
 *
 * Note: validateCookies from @freed/capture-x uses fetch() directly and will
 * not work inside the Tauri renderer due to CORS. Cookie validity is instead
 * confirmed lazily on the first real API request via x-capture.ts.
 */

export type { XCookies } from "@freed/capture-x/browser";
import type { XCookies } from "@freed/capture-x/browser";

/**
 * Parse a raw cookie string (e.g. from document.cookie or a browser export)
 * into a typed XCookies object.
 *
 * Inlined from @freed/capture-x/auth — that module uses Node built-ins
 * (os, fs) and cannot be bundled into the Tauri renderer.
 */
export function parseCookieString(cookieString: string): XCookies | null {
  const cookies: Record<string, string> = {};

  for (const cookie of cookieString.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name && valueParts.length > 0) {
      cookies[name.trim()] = valueParts.join("=").trim();
    }
  }

  if (cookies.ct0 && cookies.auth_token) {
    return { ct0: cookies.ct0, authToken: cookies.auth_token };
  }

  return null;
}

export interface XAuthState {
  isAuthenticated: boolean;
  username?: string;
  cookies?: XCookies;
}

const X_COOKIES_KEY = "x_auth_cookies";

/**
 * Persist cookies to localStorage.
 * Consider Tauri's secure storage plugin for production hardening.
 */
export function storeCookies(cookies: XCookies): void {
  localStorage.setItem(X_COOKIES_KEY, JSON.stringify(cookies));
}

/**
 * Load and structurally validate persisted cookies
 */
export function loadStoredCookies(): XCookies | null {
  const stored = localStorage.getItem(X_COOKIES_KEY);
  if (!stored) return null;

  try {
    const cookies = JSON.parse(stored) as XCookies;
    if (cookies.ct0 && cookies.authToken) {
      return cookies;
    }
  } catch {
    // Corrupt stored data — fall through
  }

  return null;
}

/**
 * Remove persisted cookies
 */
export function clearStoredCookies(): void {
  localStorage.removeItem(X_COOKIES_KEY);
}

/**
 * Connect an X account from manual cookie entry (the Sidebar form collects
 * ct0 and auth_token directly from the user).
 */
export function connectX(ct0: string, authToken: string): XCookies | null {
  const ct0Trimmed = ct0.trim();
  const tokenTrimmed = authToken.trim();
  if (!ct0Trimmed || !tokenTrimmed) return null;

  const cookies: XCookies = { ct0: ct0Trimmed, authToken: tokenTrimmed };
  storeCookies(cookies);
  return cookies;
}

/**
 * Initialize X auth state from localStorage on app startup
 */
export async function initXAuth(): Promise<XAuthState> {
  const stored = loadStoredCookies();
  if (!stored) return { isAuthenticated: false };

  // Validation deferred to first API call — validateCookies requires
  // a network request that must go through Tauri's x_api_request IPC.
  return { isAuthenticated: true, cookies: stored };
}

/**
 * Disconnect X account
 */
export function disconnectX(): void {
  clearStoredCookies();
}
