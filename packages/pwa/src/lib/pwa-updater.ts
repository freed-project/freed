/**
 * PWA update detection & application.
 *
 * vite-plugin-pwa's `prompt` mode parks new service workers in the `waiting`
 * state and fires `onNeedRefresh` so the user can choose when to reload.
 * This module bridges that signal to React components via pub/sub, and
 * provides an imperative `checkForPwaUpdate()` for the Settings button.
 */

type UpdateListener = (available: boolean) => void;

let updateAvailable = false;
const listeners = new Set<UpdateListener>();

// Injected by main.tsx after registerSW(); used to send SKIP_WAITING + reload.
let updateSWFn: ((reload: boolean) => void) | null = null;

/** Called from main.tsx to store the updateSW handle returned by registerSW(). */
export function setUpdateSwCallback(fn: (reload: boolean) => void) {
  updateSWFn = fn;
}

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
 *
 * Uses event-based detection rather than a fixed sleep: we listen for
 * `updatefound` on the registration and then watch the installing SW's
 * `statechange` until it reaches `installed` (i.e. parked in `waiting`).
 */
export async function checkForPwaUpdate(): Promise<string | null> {
  if (updateAvailable) return "new version";

  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return null;

  // A SW is already waiting (e.g. user opens Settings after auto-detection)
  if (reg.waiting) {
    notifyUpdateAvailable();
    return "new version";
  }

  return new Promise<string | null>((resolve) => {
    // Give the network request up to 10 seconds before giving up
    const timer = setTimeout(() => resolve(null), 10_000);

    reg.addEventListener(
      "updatefound",
      () => {
        const sw = reg.installing;
        if (!sw) {
          clearTimeout(timer);
          resolve(null);
          return;
        }
        sw.addEventListener("statechange", () => {
          // `installed` means the SW finished installing and is now waiting
          if (sw.state === "installed" && reg.waiting) {
            clearTimeout(timer);
            notifyUpdateAvailable();
            resolve("new version");
          }
        });
      },
      { once: true },
    );

    reg.update().catch(() => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/**
 * Activate the waiting service worker and reload the page.
 *
 * Prefers the `updateSW` handle from vite-plugin-pwa (which sends
 * SKIP_WAITING then reloads) over a bare `window.location.reload()`.
 */
export function applyPwaUpdate() {
  if (updateSWFn) {
    updateSWFn(true);
  } else {
    window.location.reload();
  }
}
