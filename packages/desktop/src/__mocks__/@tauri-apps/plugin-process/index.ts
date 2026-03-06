/**
 * Mock for @tauri-apps/plugin-process
 *
 * relaunch() is called after an update installs. In test mode we just reload
 * the page, which is close enough for E2E assertions without actually closing
 * the browser window.
 */

export async function relaunch(): Promise<void> {
  window.location.reload();
}

export async function exit(_code?: number): Promise<void> {}
