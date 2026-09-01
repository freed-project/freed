/**
 * PWA update detection & application.
 *
 * Production workers activate immediately so a stale shell cannot keep
 * requesting deleted hashed assets before React can show an update prompt.
 * This module retains the manual check and status hooks for diagnostics and
 * runs a background interval so long-running sessions still check promptly.
 */

import { registerSW } from "virtual:pwa-register";
import { recordBugReportEvent } from "@freed/ui/lib/bug-report";

const POLL_INTERVAL_MS = 60 * 60 * 1_000; // 1 hour

type UpdateListener = (available: boolean) => void;

let updateAvailable = false;
const listeners = new Set<UpdateListener>();
let updaterInitialized = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

// Injected by main.tsx after registerSW(); used to send SKIP_WAITING + reload.
let updateSWFn: ((reload: boolean) => void) | null = null;

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
 * A completed `registration.update()` is the authoritative no-update result.
 * When it starts an installing worker, wait for that worker to finish instead.
 * The deadline remains only for a browser call that never settles.
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
    let settled = false;
    let installingWorker: ServiceWorker | null = null;

    const onInstallingStateChange = () => {
      if (installingWorker?.state === "installed") {
        finish("new version");
      } else if (installingWorker?.state === "redundant") {
        finish(null);
      }
    };

    const stopWatching = () => {
      clearTimeout(timer);
      reg.removeEventListener("updatefound", onUpdateFound);
      installingWorker?.removeEventListener("statechange", onInstallingStateChange);
    };

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      stopWatching();
      if (value) notifyUpdateAvailable();
      resolve(value);
    };

    const watchInstallingWorker = (
      registration: ServiceWorkerRegistration = reg,
    ): boolean => {
      const worker = registration.installing ?? reg.installing;
      if (!worker) return false;

      if (worker !== installingWorker) {
        installingWorker?.removeEventListener("statechange", onInstallingStateChange);
        installingWorker = worker;
        installingWorker.addEventListener("statechange", onInstallingStateChange);
      }
      onInstallingStateChange();
      return true;
    };

    const onUpdateFound = () => {
      watchInstallingWorker();
    };

    reg.addEventListener("updatefound", onUpdateFound);
    const timer = setTimeout(() => finish(null), 10_000);

    Promise.resolve()
      .then(() => reg.update())
      .then(
        (checkedRegistration) => {
          if (settled) return;
          if (checkedRegistration.waiting || reg.waiting) {
            finish("new version");
            return;
          }
          if (!watchInstallingWorker(checkedRegistration)) {
            finish(null);
          }
        },
        () => {
          recordBugReportEvent("pwa:updater", "warn", "Manual update check failed");
          finish(null);
        },
      );
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

/**
 * Start a background interval that calls `checkForPwaUpdate()` every hour.
 *
 * This ensures long-running PWA sessions (e.g. the app pinned to a phone's
 * Home Screen and left open all day) detect new deployments and surface the
 * update toast without requiring any manual action from the user.
 *
 * Call once from main.tsx. Fire-and-forget: errors are swallowed so a
 * failed network check never propagates to the app.
 */
export function initPwaUpdater(): () => void {
  if (!updaterInitialized) {
    updaterInitialized = true;
    const updateSW = registerSW({
      onNeedRefresh() {
        notifyUpdateAvailable();
      },
      onOfflineReady() {
        console.log("[PWA] App ready for offline use");
      },
    });
    setUpdateSwCallback(updateSW);
  }

  if (!intervalId) {
    intervalId = setInterval(() => {
      checkForPwaUpdate().catch(() => {
        recordBugReportEvent("pwa:updater", "warn", "Background update check failed");
      });
    }, POLL_INTERVAL_MS);
  }

  return () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}
