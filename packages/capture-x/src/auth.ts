/**
 * Cookie extraction for X/Twitter authentication
 *
 * Extracts session cookies from browser profiles to authenticate API requests.
 */

import { homedir, platform } from "os";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import type { XCookies } from "./types.js";

// =============================================================================
// Types
// =============================================================================

export type SupportedBrowser = "chrome" | "firefox" | "edge" | "brave";

interface CookieRow {
  name: string;
  value: string;
  encrypted_value?: Buffer;
}

// =============================================================================
// Browser Cookie Paths
// =============================================================================

/**
 * Get the cookie database path for a browser
 */
function getCookiePath(browser: SupportedBrowser): string | null {
  const home = homedir();
  const os = platform();

  const paths: Record<SupportedBrowser, Record<string, string>> = {
    chrome: {
      darwin: join(
        home,
        "Library/Application Support/Google/Chrome/Default/Cookies",
      ),
      linux: join(home, ".config/google-chrome/Default/Cookies"),
      win32: join(
        process.env.LOCALAPPDATA || "",
        "Google/Chrome/User Data/Default/Network/Cookies",
      ),
    },
    firefox: {
      darwin: "", // Firefox uses profile directories, handled separately
      linux: "",
      win32: "",
    },
    edge: {
      darwin: join(
        home,
        "Library/Application Support/Microsoft Edge/Default/Cookies",
      ),
      linux: join(home, ".config/microsoft-edge/Default/Cookies"),
      win32: join(
        process.env.LOCALAPPDATA || "",
        "Microsoft/Edge/User Data/Default/Network/Cookies",
      ),
    },
    brave: {
      darwin: join(
        home,
        "Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies",
      ),
      linux: join(home, ".config/BraveSoftware/Brave-Browser/Default/Cookies"),
      win32: join(
        process.env.LOCALAPPDATA || "",
        "BraveSoftware/Brave-Browser/User Data/Default/Network/Cookies",
      ),
    },
  };

  const browserPaths = paths[browser];
  if (!browserPaths) return null;

  const path = browserPaths[os];
  if (!path) return null;

  return existsSync(path) ? path : null;
}

/**
 * Find Firefox profile directory
 */
function findFirefoxProfilePath(): string | null {
  const home = homedir();
  const os = platform();

  const profilesPath: Record<string, string> = {
    darwin: join(home, "Library/Application Support/Firefox/Profiles"),
    linux: join(home, ".mozilla/firefox"),
    win32: join(process.env.APPDATA || "", "Mozilla/Firefox/Profiles"),
  };

  const basePath = profilesPath[os];
  if (!basePath || !existsSync(basePath)) return null;

  // Look for default profile
  const { readdirSync } = require("fs");
  const profiles = readdirSync(basePath) as string[];
  const defaultProfile = profiles.find(
    (p) =>
      p.endsWith(".default-release") ||
      p.endsWith(".default") ||
      p.includes("default"),
  );

  if (!defaultProfile) return null;

  const cookiePath = join(basePath, defaultProfile, "cookies.sqlite");
  return existsSync(cookiePath) ? cookiePath : null;
}

// =============================================================================
// Chrome Cookie Decryption (macOS)
// =============================================================================

/**
 * Decrypt Chrome cookies on macOS using keychain
 *
 * Note: This requires the 'keychain' to be accessible and may prompt for password.
 * For production use, consider alternatives like asking user to export cookies manually.
 */
async function decryptChromeCookie(
  encryptedValue: Buffer,
): Promise<string | null> {
  // Chrome encrypts cookies with AES-128-CBC using a key derived from the keychain
  // The format is: "v10" + 12-byte nonce + encrypted data + 16-byte tag

  // For now, we'll check if it's encrypted and return null if so
  // Full decryption requires keychain access which is complex

  if (encryptedValue && encryptedValue.length > 0) {
    // Check for v10 prefix (encrypted)
    const prefix = encryptedValue.slice(0, 3).toString();
    if (prefix === "v10" || prefix === "v11") {
      // This is encrypted - would need keychain access to decrypt
      // For now, return null and fall back to unencrypted value
      console.warn("Encrypted cookie found. Manual export may be required.");
      return null;
    }

    // Try to decode as plain text
    return encryptedValue.toString("utf8");
  }

  return null;
}

// =============================================================================
// Cookie Extraction
// =============================================================================

/**
 * Extract X/Twitter cookies from a Chromium-based browser
 */
async function extractChromiumCookies(
  cookiePath: string,
): Promise<XCookies | null> {
  try {
    // Note: Chrome locks the cookie database while running
    // We need to copy it first or use a different approach

    const db = new Database(cookiePath, { readonly: true });

    const query = `
      SELECT name, value, encrypted_value 
      FROM cookies 
      WHERE host_key LIKE '%twitter.com' OR host_key LIKE '%x.com'
    `;

    const rows = db.prepare(query).all() as CookieRow[];
    db.close();

    let ct0: string | null = null;
    let authToken: string | null = null;

    for (const row of rows) {
      if (row.name === "ct0") {
        ct0 = row.value || (await decryptChromeCookie(row.encrypted_value!));
      } else if (row.name === "auth_token") {
        authToken =
          row.value || (await decryptChromeCookie(row.encrypted_value!));
      }
    }

    if (ct0 && authToken) {
      return { ct0, authToken };
    }

    return null;
  } catch (error) {
    console.error("Error extracting Chromium cookies:", error);
    return null;
  }
}

/**
 * Extract X/Twitter cookies from Firefox
 */
async function extractFirefoxCookies(
  cookiePath: string,
): Promise<XCookies | null> {
  try {
    const db = new Database(cookiePath, { readonly: true });

    const query = `
      SELECT name, value 
      FROM moz_cookies 
      WHERE host LIKE '%twitter.com' OR host LIKE '%x.com'
    `;

    const rows = db.prepare(query).all() as CookieRow[];
    db.close();

    let ct0: string | null = null;
    let authToken: string | null = null;

    for (const row of rows) {
      if (row.name === "ct0") {
        ct0 = row.value;
      } else if (row.name === "auth_token") {
        authToken = row.value;
      }
    }

    if (ct0 && authToken) {
      return { ct0, authToken };
    }

    return null;
  } catch (error) {
    console.error("Error extracting Firefox cookies:", error);
    return null;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Extract X/Twitter cookies from the specified browser
 *
 * @param browser - The browser to extract cookies from
 * @returns XCookies if found, null otherwise
 */
export async function extractCookies(
  browser: SupportedBrowser = "chrome",
): Promise<XCookies | null> {
  if (browser === "firefox") {
    const cookiePath = findFirefoxProfilePath();
    if (!cookiePath) {
      console.error("Firefox cookie database not found");
      return null;
    }
    return extractFirefoxCookies(cookiePath);
  }

  const cookiePath = getCookiePath(browser);
  if (!cookiePath) {
    console.error(`${browser} cookie database not found`);
    return null;
  }

  return extractChromiumCookies(cookiePath);
}

/**
 * Try to extract cookies from any available browser
 *
 * @returns XCookies from the first browser that has valid cookies
 */
export async function extractCookiesAuto(): Promise<{
  cookies: XCookies;
  browser: SupportedBrowser;
} | null> {
  const browsers: SupportedBrowser[] = ["chrome", "firefox", "edge", "brave"];

  for (const browser of browsers) {
    const cookies = await extractCookies(browser);
    if (cookies) {
      return { cookies, browser };
    }
  }

  return null;
}

/**
 * Validate that cookies are still valid by making a test request
 *
 * @param cookies - The cookies to validate
 * @returns true if cookies are valid
 */
export async function validateCookies(cookies: XCookies): Promise<boolean> {
  try {
    // Make a lightweight request to check auth
    const response = await fetch(
      "https://api.x.com/1.1/account/verify_credentials.json",
      {
        headers: {
          Authorization:
            "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
          "x-csrf-token": cookies.ct0,
          Cookie: `ct0=${cookies.ct0}; auth_token=${cookies.authToken}`,
        },
      },
    );

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Parse cookies from a string (e.g., copied from browser dev tools)
 *
 * @param cookieString - Cookie string in format "name=value; name2=value2"
 * @returns XCookies if ct0 and auth_token are found
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
