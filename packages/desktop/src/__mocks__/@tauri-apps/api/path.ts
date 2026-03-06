/**
 * Mock for @tauri-apps/api/path
 *
 * content-cache.ts uses appDataDir() to locate the on-disk cache directory.
 * In test mode we return a fake path; all subsequent FS calls are no-ops.
 */

export async function appDataDir(): Promise<string> {
  return "/mock/app-data";
}
