/**
 * User Agent Management
 *
 * Selects a realistic, OS-appropriate user agent at platform connect time and
 * persists it for the lifetime of that session. The same UA is reused for
 * every scrape until the user disconnects and reconnects, making all requests
 * look like they come from one consistent browser identity.
 *
 * Design notes:
 *  - macOS FB/IG WebViews use Safari UAs (WKWebView IS WebKit/Safari).
 *  - Windows FB/IG WebViews use Chrome/Edge UAs (WebView2 IS Chromium).
 *  - Linux FB/IG WebViews use Chrome UAs (WebKitGTK default is unusual; Chrome is safer).
 *  - X HTTP requests always use Chrome UAs because we impersonate Chrome with rquest.
 *  - Chrome on macOS always reports "Intel Mac OS X 10_15_7" regardless of real OS
 *    version — this is intentional browser privacy behaviour, not a bug.
 */

// =============================================================================
// Types
// =============================================================================

export type Platform = "facebook" | "instagram" | "linkedin" | "x";
export type OSFamily = "mac" | "windows" | "linux";

// =============================================================================
// OS Detection
// =============================================================================

export function detectOSFamily(): OSFamily {
  const p = navigator.platform.toLowerCase();
  if (p.startsWith("mac") || p.includes("darwin")) return "mac";
  if (p.startsWith("win")) return "windows";
  return "linux";
}

// Returns the sec-ch-ua-platform value for the current OS.
export function osPlatformHeader(): string {
  switch (detectOSFamily()) {
    case "mac": return '"macOS"';
    case "windows": return '"Windows"';
    case "linux": return '"Linux"';
  }
}

// =============================================================================
// UA Pools
// =============================================================================

/**
 * Safari on macOS — for FB/IG WKWebView on macOS.
 * Varies: macOS version string + Safari version. WebKit build stays 605.1.15
 * (Safari has frozen this string for compatibility since ~2018).
 * Newer versions weighted more heavily by appearing more often in the list.
 */
const SAFARI_MACOS_POOL: readonly string[] = [
  // macOS 15 Sequoia + Safari 18
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3.1 Safari/605.1.15",
  // macOS 14 Sonoma + Safari 17-18
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  // macOS 13 Ventura + Safari 16-17
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  // macOS 12 Monterey + Safari 15-16
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_7_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  // macOS 11 Big Sur + Safari 15
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_6_8) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15",
  // macOS 10.15 Catalina + Safari 15
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.1 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
];

/**
 * Chrome on macOS — for X HTTP requests on macOS.
 * Chrome intentionally reports "Intel Mac OS X 10_15_7" on all macOS versions
 * for privacy. Only the Chrome major version varies.
 */
const CHROME_MACOS_POOL: readonly string[] = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
];

/**
 * Chrome/Edge on Windows — for all requests on Windows.
 * WebView2 uses a Chromium engine, so Chrome/Edge UAs are natural.
 */
const CHROME_WINDOWS_POOL: readonly string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  // Edge on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0",
];

/**
 * Chrome on Linux — for all requests on Linux.
 * WebKitGTK's native UA is unusual; Chrome on Linux is far more common in the
 * wild and a much safer impersonation target.
 */
const CHROME_LINUX_POOL: readonly string[] = [
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
];

// =============================================================================
// Pool Selection
// =============================================================================

/**
 * Pick the right pool for the current OS and platform type.
 * FB/IG WebViews on macOS should use Safari; everything else uses Chrome.
 */
function pickPool(platform: Platform, os: OSFamily): readonly string[] {
  if ((platform === "facebook" || platform === "instagram" || platform === "linkedin") && os === "mac") {
    return SAFARI_MACOS_POOL;
  }
  if (os === "windows") return CHROME_WINDOWS_POOL;
  if (os === "linux") return CHROME_LINUX_POOL;
  return CHROME_MACOS_POOL;
}

function randomItem<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// =============================================================================
// Persistence
// =============================================================================

const storageKey = (platform: Platform) => `freed_ua_${platform}`;

/**
 * Generate a new UA for the given platform, persist it to localStorage, and
 * return it. Called once at platform connect time.
 */
export function selectPlatformUA(platform: Platform): string {
  const os = detectOSFamily();
  const pool = pickPool(platform, os);
  const ua = randomItem(pool);
  localStorage.setItem(storageKey(platform), ua);
  return ua;
}

/**
 * Return the persisted UA for this platform, generating a new one if none
 * exists yet. Use this everywhere a UA is needed after connect time.
 */
export function getPlatformUA(platform: Platform): string {
  return localStorage.getItem(storageKey(platform)) ?? selectPlatformUA(platform);
}

/**
 * Clear the persisted UA for a platform. Call on disconnect so the next
 * connect starts fresh.
 */
export function clearPlatformUA(platform: Platform): void {
  localStorage.removeItem(storageKey(platform));
}

// =============================================================================
// Chrome Version Extraction
// =============================================================================

/**
 * Extract the Chrome major version number from a Chrome UA string.
 * Returns null for non-Chrome UAs (e.g. Safari).
 *
 * Used to build consistent sec-ch-ua Client Hint headers.
 */
export function extractChromeVersion(ua: string): string | null {
  const m = ua.match(/Chrome\/(\d+)/);
  return m ? m[1] : null;
}
