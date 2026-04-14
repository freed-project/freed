/**
 * Mock for @tauri-apps/plugin-updater
 *
 * check() is called on a 30-minute interval to look for app updates.
 * In test mode we return null (no update available) so the update
 * notification never renders and doesn't interfere with benchmarks.
 */

export interface Update {
  version: string;
  body?: string;
  downloadAndInstall: (
    onEvent: (event: { event: string; data: unknown }) => void,
  ) => Promise<void>;
}

export interface CheckOptions {
  target?: string;
}

export async function check(options?: CheckOptions): Promise<Update | null> {
  (
    window as unknown as Record<string, unknown>
  ).__TAURI_MOCK_UPDATE_CHECK_ARGS__ = options ?? null;

  // Honour __TAURI_MOCK_UPDATE__ so specific tests can simulate an update.
  const override = (window as unknown as Record<string, unknown>).__TAURI_MOCK_UPDATE__;
  if (override) {
    return {
      ...(override as Partial<Update>),
      downloadAndInstall: async () => {},
    } as Update;
  }
  return null;
}
