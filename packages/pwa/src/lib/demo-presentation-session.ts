// Keep this module dependency-free: it runs before preference consumers hydrate.
const PRESENTATION_KEYS = new Set([
  "freed-theme-legacy-migration-v1",
  "freed-device-display-preferences-v1",
  "freed-feed-card-density",
  "freed.reader.offlineCacheMode",
  "freed-interface-zoom",
  "freed-device-graph-layout-v1",
  "freed.pwa.install.dismissed",
  "freed.demo.last-top-item.v1",
]);

/** Only this display-only choice may bypass synchronized demo preferences. */
export function isDemoFocusPreferenceUpdate(update: unknown): boolean {
  if (!update || typeof update !== "object") return false;
  const root = update as Record<string, unknown>;
  if (Object.keys(root).length !== 1 || !root.display || typeof root.display !== "object") return false;
  const display = root.display as Record<string, unknown>;
  if (Object.keys(display).length !== 1 || !display.reading || typeof display.reading !== "object") return false;
  const reading = display.reading as Record<string, unknown>;
  return Object.keys(reading).length === 1 && typeof reading.focusMode === "boolean";
}

function isPresentationKey(key: string): boolean {
  return PRESENTATION_KEYS.has(key) || [...PRESENTATION_KEYS].some(
    (base) => key.startsWith(`${base}.recovery.`),
  );
}

function sessionStorageView(native: Storage, seed: Record<string, string>): Storage {
  const values = new Map(Object.entries(seed));
  const keys = () => {
    const result = [...values.keys()];
    for (let index = 0; index < native.length; index += 1) {
      const key = native.key(index);
      if (key !== null && !isPresentationKey(key)) result.push(key);
    }
    return result;
  };
  return {
    get length() { return keys().length; },
    key(index: number) { return keys()[index] ?? null; },
    getItem(key: string) {
      return isPresentationKey(key) ? values.get(key) ?? null : native.getItem(key);
    },
    setItem(key: string, value: string) {
      if (isPresentationKey(key)) values.set(key, String(value));
      else native.setItem(key, value);
    },
    removeItem(key: string) {
      if (isPresentationKey(key)) values.delete(key);
      else native.removeItem(key);
    },
    // A demo-wide clear must never erase the real app's credentials or library.
    clear() { values.clear(); },
  };
}

/** Isolate presentation preferences except theme and demo welcome state before importing App. */
export function installDemoPresentationSession(win: Window, demoMode: boolean): void {
  if (!demoMode) return;
  const local = win.localStorage;
  const session = win.sessionStorage;
  Object.defineProperty(win, "localStorage", {
    configurable: true,
    value: sessionStorageView(local, {
      // Prevent legacy synchronized display settings from filling the fresh view.
      "freed-theme-legacy-migration-v1": "complete",
      "freed-device-display-preferences-v1": JSON.stringify({ version: 1, values: {} }),
    }),
  });
  Object.defineProperty(win, "sessionStorage", {
    configurable: true,
    value: sessionStorageView(session, {}),
  });
  win.addEventListener("storage", (event) => {
    if (event.key === null || isPresentationKey(event.key)) event.stopImmediatePropagation();
  }, { capture: true });
}
