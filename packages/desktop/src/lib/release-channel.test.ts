import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockNativeFiles, mockStoreShouldThrow } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockNativeFiles: new Map<string, string>(),
  mockStoreShouldThrow: { current: false },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "/mock/app-data"),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (path: string) => {
    if (mockStoreShouldThrow.current) {
      throw new Error("store unavailable");
    }
    const value = mockNativeFiles.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }),
  writeTextFile: vi.fn(async (path: string, contents: string) => {
    if (mockStoreShouldThrow.current) {
      throw new Error("store unavailable");
    }
    mockNativeFiles.set(path, contents);
  }),
  rename: vi.fn(async (oldPath: string, newPath: string) => {
    if (mockStoreShouldThrow.current) {
      throw new Error("store unavailable");
    }
    const value = mockNativeFiles.get(oldPath);
    if (value === undefined) throw new Error(`ENOENT: ${oldPath}`);
    mockNativeFiles.set(newPath, value);
    mockNativeFiles.delete(oldPath);
  }),
}));

import {
  buildDesktopUpdateTargets,
  loadDesktopReleaseChannel,
  loadDesktopReleaseChannelState,
  getDesktopUpdateTargets,
  getNativeUpdaterTarget,
  persistDesktopInstalledReleaseChannel,
  persistDesktopReleaseChannel,
} from "./release-channel";

describe("desktop release channel helpers", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockNativeFiles.clear();
    mockStoreShouldThrow.current = false;
    window.localStorage.clear();
  });

  it("reads the native updater target from Tauri", async () => {
    mockInvoke.mockResolvedValue("darwin-aarch64");

    await expect(getNativeUpdaterTarget()).resolves.toBe("darwin-aarch64");
    expect(mockInvoke).toHaveBeenCalledWith("get_updater_target");
  });

  it("checks the selected target first and falls back to production on dev", async () => {
    mockInvoke.mockResolvedValue("darwin-aarch64");

    await expect(getDesktopUpdateTargets("dev")).resolves.toEqual([
      { channel: "dev", target: "dev-darwin-aarch64" },
      { channel: "production", target: "production-darwin-aarch64" },
    ]);
    expect(mockInvoke).toHaveBeenCalledWith("get_updater_target");
  });

  it("only checks production when production is selected", async () => {
    mockInvoke.mockResolvedValue("darwin-aarch64");

    await expect(getDesktopUpdateTargets("production")).resolves.toEqual([
      { channel: "production", target: "production-darwin-aarch64" },
    ]);
    expect(mockInvoke).toHaveBeenCalledWith("get_updater_target");
  });

  it("builds update targets without needing another Tauri call", () => {
    expect(buildDesktopUpdateTargets("dev", "windows-x86_64")).toEqual([
      { channel: "dev", target: "dev-windows-x86_64" },
      { channel: "production", target: "production-windows-x86_64" },
    ]);
  });

  it("loads the desktop channel from native store when browser storage is empty", async () => {
    mockNativeFiles.set("/mock/app-data/release-channel.json", JSON.stringify({ channel: "dev" }));

    await expect(loadDesktopReleaseChannel()).resolves.toBe("dev");
    expect(window.localStorage.getItem("freed-release-channel")).toBe("dev");
  });

  it("seeds native store from browser storage when native store is empty", async () => {
    window.localStorage.setItem("freed-release-channel", "dev");

    await expect(loadDesktopReleaseChannel()).resolves.toBe("dev");
    const stored = JSON.parse(mockNativeFiles.get("/mock/app-data/release-channel.json") ?? "{}");
    expect(stored.channel).toBe("dev");
  });

  it("persists channel changes to native store and browser storage", async () => {
    await persistDesktopReleaseChannel("dev");

    const stored = JSON.parse(mockNativeFiles.get("/mock/app-data/release-channel.json") ?? "{}");
    expect(stored.channel).toBe("dev");
    expect(window.localStorage.getItem("freed-release-channel")).toBe("dev");
  });

  it("tracks installed channel separately from the selected update channel", async () => {
    await persistDesktopReleaseChannel("production");
    await persistDesktopInstalledReleaseChannel("dev");

    await expect(loadDesktopReleaseChannelState()).resolves.toEqual({
      selectedChannel: "production",
      installedChannel: "dev",
    });
  });

  it("keeps using browser storage if native store is unavailable", async () => {
    mockStoreShouldThrow.current = true;
    window.localStorage.setItem("freed-release-channel", "dev");

    await expect(loadDesktopReleaseChannel()).resolves.toBe("dev");
    await expect(persistDesktopReleaseChannel("production")).resolves.toBeUndefined();
    expect(window.localStorage.getItem("freed-release-channel")).toBe("production");
  });
});
