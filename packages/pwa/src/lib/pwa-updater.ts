/**
 * PWA update detection & application.
 *
 * vite-plugin-pwa's `autoUpdate` activates new service workers silently,
 * but the running tab still serves stale JS until reload. This module
 * exposes check/apply functions for Settings and an auto-detected update
 * callback for showing a toast.
 */

type UpdateListener = (available: boolean) => void;

let updateAvailable = false;
const listeners = new Set<UpdateListener>();

/** Called from main.tsx when the SW detects new content. */
export function notifyUpdateAvailable() {
  updateAvailable = true;
  listeners.forEach((fn) => fn(true));
}

/** Subscribe to auto-detected update availability. Returns unsubscribe. */
export function onUpdateAvailable(fn: UpdateListener): () => void {
  listeners.add(fn);
  if (updateAvailable) fn(true);
  return () => listeners.delete(fn);
}

/**
 * Force the service worker to check for a new version.
 * Returns a truthy string if an update was detected, null if up-to-date.
 */
export async function checkForPwaUpdate(): Promise<string | null> {
  if (updateAvailable) return "new version";

  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return null;

  await reg.update();

  // Give the SW a moment to move through installing → waiting/active
  await new Promise((r) => setTimeout(r, 1500));

  if (reg.waiting || reg.installing) {
    notifyUpdateAvailable();
    return "new version";
  }

  return null;
}

/** Reload the page to pick up the new service worker's assets. */
export function applyPwaUpdate() {
  window.location.reload();
}
