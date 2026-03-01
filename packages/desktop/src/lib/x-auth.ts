/**
 * X/Twitter authentication via WebView
 *
 * Opens X login in an in-app window, captures cookies after login.
 */

// Tauri API imports will be used when we implement proper WebView login
// import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

// Cookie types from capture-x
export interface XCookies {
  ct0: string;
  authToken: string;
}

export interface XAuthState {
  isAuthenticated: boolean;
  username?: string;
  cookies?: XCookies;
}

// Storage key for persisted cookies
const X_COOKIES_KEY = "x_auth_cookies";

/**
 * Store cookies in localStorage (consider secure storage for production)
 */
export function storeCookies(cookies: XCookies): void {
  localStorage.setItem(X_COOKIES_KEY, JSON.stringify(cookies));
}

/**
 * Load stored cookies
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
    // Invalid stored data
  }

  return null;
}

/**
 * Clear stored cookies
 */
export function clearStoredCookies(): void {
  localStorage.removeItem(X_COOKIES_KEY);
}

/**
 * Parse cookies from a cookie string
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
    return {
      ct0: cookies.ct0,
      authToken: cookies.auth_token,
    };
  }

  return null;
}

/**
 * Validate cookies by making a test request
 *
 * TODO: Implement via Tauri command when needed
 */
export async function validateCookies(_cookies: XCookies): Promise<boolean> {
  // For now, just return true - validation will happen on first use
  return true;
}

/**
 * Connect X account by storing the provided cookies directly.
 * The UI (Sidebar) collects ct0 and auth_token from the user via an inline form.
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
 * Initialize X auth state
 *
 * Checks for stored cookies and validates them.
 */
export async function initXAuth(): Promise<XAuthState> {
  const stored = loadStoredCookies();

  if (!stored) {
    return { isAuthenticated: false };
  }

  // Skip validation for now to speed up startup
  // In production, we'd validate on first use
  return {
    isAuthenticated: true,
    cookies: stored,
  };
}

/**
 * Disconnect X account
 */
export function disconnectX(): void {
  clearStoredCookies();
}
