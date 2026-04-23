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
  const mockWindow = window as unknown as Record<string, unknown>;
  mockWindow.__TAURI_MOCK_UPDATE_CHECK_ARGS__ = options ?? null;
  const checkCalls = Array.isArray(mockWindow.__TAURI_MOCK_UPDATE_CHECK_CALLS__)
    ? (mockWindow.__TAURI_MOCK_UPDATE_CHECK_CALLS__ as Array<CheckOptions | null>)
    : [];
  checkCalls.push(options ?? null);
  mockWindow.__TAURI_MOCK_UPDATE_CHECK_CALLS__ = checkCalls;

  const targetOverrides = mockWindow.__TAURI_MOCK_UPDATE_BY_TARGET__;
  if (targetOverrides && typeof targetOverrides === "object") {
    const target = options?.target ?? "";
    if (Object.prototype.hasOwnProperty.call(targetOverrides, target)) {
      const override = (targetOverrides as Record<string, unknown>)[target];
      if (!override) {
        return null;
      }
      const downloadAndInstall =
        typeof (override as Partial<Update>).downloadAndInstall === "function"
          ? (override as Partial<Update>).downloadAndInstall
          : async () => {};
      return {
        ...(override as Partial<Update>),
        downloadAndInstall,
      } as Update;
    }
  }

  // Honour __TAURI_MOCK_UPDATE__ so specific tests can simulate an update.
  const override = mockWindow.__TAURI_MOCK_UPDATE__;
  if (override) {
    const downloadAndInstall =
      typeof (override as Partial<Update>).downloadAndInstall === "function"
        ? (override as Partial<Update>).downloadAndInstall
        : async () => {};
    return {
      ...(override as Partial<Update>),
      downloadAndInstall,
    } as Update;
  }
  return null;
}
