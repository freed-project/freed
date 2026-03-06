/**
 * Mock for @tauri-apps/plugin-shell
 *
 * open() is called by the sync indicator to launch the QR-code pairing URL.
 * We track the URL in window.__TAURI_MOCK_OPENED_URLS__ for test assertions.
 */

export async function open(url: string): Promise<void> {
  const store = (window as unknown as Record<string, unknown>);
  if (!store.__TAURI_MOCK_OPENED_URLS__) {
    store.__TAURI_MOCK_OPENED_URLS__ = [] as string[];
  }
  (store.__TAURI_MOCK_OPENED_URLS__ as string[]).push(url);
}
