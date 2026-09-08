import { describe, expect, it } from "vitest";
import { installDemoPresentationSession, isDemoFocusPreferenceUpdate } from "./demo-presentation-session";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
  };
}

function documentWindow(localStorage = memoryStorage(), sessionStorage = memoryStorage()) {
  return Object.assign(new EventTarget(), { localStorage, sessionStorage }) as unknown as Window;
}

describe("demo presentation document isolation", () => {
  it("admits only a boolean Focus presentation assignment", () => {
    for (const focusMode of [true, false]) {
      expect(isDemoFocusPreferenceUpdate({ display: { reading: { focusMode } } })).toBe(true);
    }
    for (const update of [null, {}, { display: { reading: { focusMode: "true" } } },
      { display: { reading: { focusMode: true, fontSize: 20 } } },
      { display: { reading: { focusMode: true } }, fbCapture: {} }]) {
      expect(isDemoFocusPreferenceUpdate(update)).toBe(false);
    }
  });
  it("leaves the real app's storage and events unchanged", () => {
    const win = documentWindow();
    const native = win.localStorage;
    native.setItem("freed-theme", "neon");
    installDemoPresentationSession(win, false);
    expect(win.localStorage).toBe(native);
    expect(win.localStorage.getItem("freed-theme")).toBe("neon");
  });

  it("ignores old preferences, keeps new choices in this document, and resets on reload", () => {
    const native = memoryStorage();
    native.setItem("freed-theme", "neon");
    native.setItem("freed-device-display-preferences-v1", "old sidebar and filters");
    const first = documentWindow(native);
    installDemoPresentationSession(first, true);
    expect(first.localStorage.getItem("freed-theme")).toBe("neon");
    expect(first.localStorage.getItem("freed-device-display-preferences-v1"))
      .toBe('{"version":1,"values":{}}');
    first.localStorage.setItem("freed-theme", "parchment");
    expect(first.localStorage.getItem("freed-theme")).toBe("parchment");
    const reload = documentWindow(native);
    installDemoPresentationSession(reload, true);
    expect(reload.localStorage.getItem("freed-theme")).toBe("parchment");
    expect(native.getItem("freed-theme")).toBe("parchment");
    first.localStorage.setItem("freed-device-display-preferences-v1", "session choice");
    expect(reload.localStorage.getItem("freed-device-display-preferences-v1"))
      .toBe('{"version":1,"values":{}}');
  });

  it("isolates all known presentation keys and recovery copies without deleting native values", () => {
    const native = memoryStorage();
    const keys = ["freed-feed-card-density", "freed-interface-zoom",
      "freed-device-graph-layout-v1", "freed.pwa.install.dismissed",
      "freed-device-display-preferences-v1.recovery.old"];
    keys.forEach((key) => native.setItem(key, "saved"));
    const win = documentWindow(native);
    installDemoPresentationSession(win, true);
    for (const key of keys) {
      expect(win.localStorage.getItem(key)).toBeNull();
      win.localStorage.setItem(key, "new");
      win.localStorage.removeItem(key);
      expect(native.getItem(key)).toBe("saved");
    }
    expect(Array.from({ length: win.localStorage.length }, (_, i) => win.localStorage.key(i)))
      .not.toContain("freed-device-display-preferences-v1.recovery.old");
  });

  it("preserves credentials, consent, diagnostics and subscription state even on clear", () => {
    const native = memoryStorage();
    const keys = ["freed_pkce_provider", "cloud-token", "legal-consent", "diagnostic-report",
      "freed-newsletter-subscribed-v1"];
    keys.forEach((key) => native.setItem(key, "saved"));
    const win = documentWindow(native);
    installDemoPresentationSession(win, true);
    keys.forEach((key) => expect(win.localStorage.getItem(key)).toBe("saved"));
    win.localStorage.setItem("cloud-token", "renewed");
    win.localStorage.clear();
    expect(native.getItem("cloud-token")).toBe("renewed");
    expect(native.getItem("legal-consent")).toBe("saved");
  });

  it("isolates retired session presentation while preserving OAuth session records", () => {
    const native = memoryStorage();
    native.setItem("freed.demo.last-top-item.v1", "old");
    native.setItem("freed_pkce_verifier", "secret");
    const win = documentWindow(memoryStorage(), native);
    installDemoPresentationSession(win, true);
    expect(win.sessionStorage.getItem("freed.demo.last-top-item.v1")).toBeNull();
    win.sessionStorage.setItem("freed.demo.last-top-item.v1", "new");
    expect(native.getItem("freed.demo.last-top-item.v1")).toBe("old");
    expect(win.sessionStorage.getItem("freed_pkce_verifier")).toBe("secret");
  });

  it("does not let another tab's presentation storage event rehydrate the demo", () => {
    const win = documentWindow();
    installDemoPresentationSession(win, true);
    const observed: string[] = [];
    win.addEventListener("storage", (event) => observed.push(event.key ?? "clear"));
    for (const key of ["freed-theme", "cloud-token"]) {
      const event = new Event("storage");
      Object.defineProperty(event, "key", { value: key });
      win.dispatchEvent(event);
    }
    expect(observed).toEqual(["freed-theme", "cloud-token"]);
  });
});
