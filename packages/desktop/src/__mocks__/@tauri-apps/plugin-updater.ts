/**
 * Mock for @tauri-apps/plugin-updater used when VITE_TEST_TAURI=1.
 *
 * check() always returns null (no update available) by default. Tests that
 * need to exercise the update flow can set window.__TAURI_MOCK_UPDATE__ to a
 * mock Update object before the check runs.
 */

export type UpdateStatus = "PENDING" | "ERROR" | "DONE" | "UPTODATE";

export interface DownloadEvent {
  event: "Started" | "Progress" | "Finished";
  data: { contentLength?: number; chunkLength: number };
}

export interface Update {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
  downloadAndInstall(
    onEvent?: (event: DownloadEvent) => void,
  ): Promise<void>;
}

export async function check(): Promise<Update | null> {
  if (typeof window === "undefined") return null;
  return (
    (
      window as unknown as Record<string, unknown>
    ).__TAURI_MOCK_UPDATE__ as Update | null | undefined
  ) ?? null;
}
