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
 * Open X login window
 *
 * This creates a new WebView window pointing to X's login page.
 * After login, we'll extract the cookies.
 */
export async function openXLogin(): Promise<XCookies | null> {
  return new Promise((resolve) => {
    // Create a modal dialog for entering cookies manually
    // In a full implementation, we'd open a WebView window

    const cookieString = window.prompt(
      "Freed needs your X/Twitter cookies to capture your timeline.\n\n" +
        "To get them:\n" +
        "1. Open x.com in your browser\n" +
        "2. Log in if needed\n" +
        "3. Open DevTools (F12)\n" +
        "4. Go to Application > Cookies > x.com\n" +
        "5. Copy the values of 'ct0' and 'auth_token'\n\n" +
        "Paste your cookies in format: ct0=xxx; auth_token=xxx"
    );

    if (!cookieString) {
      resolve(null);
      return;
    }

    const cookies = parseCookieString(cookieString);
    if (cookies) {
      storeCookies(cookies);
      resolve(cookies);
    } else {
      alert("Invalid cookie format. Please include both ct0 and auth_token.");
      resolve(null);
    }
  });
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
