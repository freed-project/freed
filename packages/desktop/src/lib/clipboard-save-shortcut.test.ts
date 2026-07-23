import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/tmp/freed",
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  rename: vi.fn(),
  writeTextFile: vi.fn(),
}));

import {
  ClipboardSaveShortcutRegistrationController,
  clearClipboardSaveShortcutConfig,
  createDefaultClipboardSaveShortcutConfig,
  defaultClipboardSaveShortcut,
  formatShortcutForDisplay,
  formatShortcutForDisplayParts,
  loadClipboardSaveShortcutConfig,
  normalizeClipboardUrl,
  persistClipboardSaveShortcutConfig,
  shortcutFromKeyboardEvent,
  type GlobalShortcutEvent,
} from "./clipboard-save-shortcut";

function keyboardEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("clipboard save shortcut", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
        clear: () => {
          storage.clear();
        },
      },
    });
    window.localStorage.clear();
  });

  it("accepts only http and https clipboard URLs", () => {
    expect(normalizeClipboardUrl(" https://example.com/path ")).toBe("https://example.com/path");
    expect(normalizeClipboardUrl("http://example.com/")).toBe("http://example.com/");
    expect(normalizeClipboardUrl("ftp://example.com/file")).toBeNull();
    expect(normalizeClipboardUrl("example.com/path")).toBeNull();
    expect(normalizeClipboardUrl("")).toBeNull();
  });

  it("uses platform-specific defaults and display formatting", () => {
    expect(defaultClipboardSaveShortcut("MacIntel")).toBe("Control+Option+Command+S");
    expect(defaultClipboardSaveShortcut("Win32")).toBe("Control+Alt+S");
    expect(formatShortcutForDisplay("Control+Option+Command+S", "MacIntel")).toBe("⌃⌥⌘S");
    expect(formatShortcutForDisplay("Control+Alt+S", "Win32")).toBe("Control+Alt+S");
    expect(formatShortcutForDisplayParts("Control+Option+Command+S", "MacIntel")).toEqual([
      "⌃",
      "⌥",
      "⌘",
      "S",
    ]);
    expect(formatShortcutForDisplayParts("Control+Alt+S", "Win32")).toEqual([
      "Control",
      "Alt",
      "S",
    ]);
  });

  it("loads defaults and persists device-local config", async () => {
    expect(await loadClipboardSaveShortcutConfig()).toEqual(
      createDefaultClipboardSaveShortcutConfig(),
    );

    await persistClipboardSaveShortcutConfig({
      enabled: false,
      shortcut: "Control+Alt+S",
    });

    expect(await loadClipboardSaveShortcutConfig()).toEqual({
      enabled: false,
      shortcut: "Control+Alt+S",
    });
  });

  it("clears the device shortcut config during factory reset", async () => {
    await persistClipboardSaveShortcutConfig({
      enabled: false,
      shortcut: "Control+Alt+S",
    });

    await clearClipboardSaveShortcutConfig();

    expect(await loadClipboardSaveShortcutConfig()).toEqual(
      createDefaultClipboardSaveShortcutConfig(),
    );
  });

  it("propagates shortcut config removal failures", async () => {
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    await expect(clearClipboardSaveShortcutConfig()).rejects.toThrow(
      "storage unavailable",
    );
  });

  it("records shortcuts from keyboard events", () => {
    expect(shortcutFromKeyboardEvent(
      keyboardEvent({ key: "s", ctrlKey: true, altKey: true }),
      "Win32",
    )).toBe("Control+Alt+S");
    expect(shortcutFromKeyboardEvent(
      keyboardEvent({ key: "s", ctrlKey: true, altKey: true, metaKey: true }),
      "MacIntel",
    )).toBe("Control+Option+Command+S");
    expect(shortcutFromKeyboardEvent(
      keyboardEvent({ key: "Control", ctrlKey: true }),
      "Win32",
    )).toBeNull();
  });

  it("replaces registrations and opens the save dialog with a clipboard URL", async () => {
    const handlers = new Map<string, (event: GlobalShortcutEvent) => void | Promise<void>>();
    const calls: string[] = [];
    const opened: Array<string | undefined> = [];
    let clipboardText = "https://example.com/clip";
    const controller = new ClipboardSaveShortcutRegistrationController({
      register: async (shortcut, handler) => {
        calls.push(`register:${shortcut}`);
        handlers.set(shortcut, handler);
      },
      unregister: async (shortcut) => {
        calls.push(`unregister:${shortcut}`);
        handlers.delete(shortcut);
      },
      isRegistered: async () => false,
      readClipboardText: async () => clipboardText,
      showWindow: async () => {
        calls.push("show_window");
      },
      openSaveContentDialog: (initialUrl) => {
        opened.push(initialUrl);
      },
    });

    expect(await controller.apply({ enabled: true, shortcut: "Control+Alt+S" })).toEqual({
      status: "active",
      shortcut: "Control+Alt+S",
    });
    expect(await controller.apply({ enabled: true, shortcut: "Control+Alt+F" })).toEqual({
      status: "active",
      shortcut: "Control+Alt+F",
    });

    await handlers.get("Control+Alt+F")?.({ shortcut: "Control+Alt+F", state: "Pressed" });
    clipboardText = "not a url";
    await handlers.get("Control+Alt+F")?.({ shortcut: "Control+Alt+F", state: "Pressed" });

    expect(calls).toEqual([
      "register:Control+Alt+S",
      "unregister:Control+Alt+S",
      "register:Control+Alt+F",
      "show_window",
      "show_window",
    ]);
    expect(opened).toEqual(["https://example.com/clip", undefined]);
  });

  it("reports shortcut conflicts from registration failures", async () => {
    const controller = new ClipboardSaveShortcutRegistrationController({
      register: async () => {
        throw new Error("Shortcut already registered");
      },
      unregister: vi.fn(),
      isRegistered: async () => false,
      readClipboardText: async () => "",
      showWindow: async () => {},
      openSaveContentDialog: vi.fn(),
    });

    expect(await controller.apply({ enabled: true, shortcut: "Control+Alt+S" })).toEqual({
      status: "conflict",
      shortcut: "Control+Alt+S",
      message: "That shortcut is already in use. Pick another combination.",
    });
  });
});
