/**
 * Mock for @tauri-apps/plugin-shell used when VITE_TEST_TAURI=1.
 *
 * open() is used to launch external URLs (e.g. OAuth flows, external links).
 * In the test environment we capture the URL so tests can assert it was
 * "opened" without actually navigating the test browser away from the app.
 */

const openedUrls: string[] = [];

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__TAURI_MOCK_OPENED_URLS__ =
    openedUrls;
}

export async function open(url: string): Promise<void> {
  openedUrls.push(url);
}
