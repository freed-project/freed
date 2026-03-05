/**
 * Mock for @tauri-apps/plugin-process used when VITE_TEST_TAURI=1.
 *
 * relaunch() and exit() are no-ops. Tests can spy on them via
 * window.__TAURI_MOCK_PROCESS_CALLS__ to assert they were triggered.
 */

const calls: { fn: string; args: unknown[] }[] = [];

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__TAURI_MOCK_PROCESS_CALLS__ =
    calls;
}

export async function relaunch(): Promise<void> {
  calls.push({ fn: "relaunch", args: [] });
}

export async function exit(code = 0): Promise<void> {
  calls.push({ fn: "exit", args: [code] });
}
