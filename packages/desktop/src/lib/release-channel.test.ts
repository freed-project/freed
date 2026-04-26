import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockStoreData, mockStoreShouldThrow } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockStoreData: new Map<string, unknown>(),
  mockStoreShouldThrow: { current: false },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => {
    if (mockStoreShouldThrow.current) {
      throw new Error("store unavailable");
    }

    return {
      get: vi.fn(async (key: string) => mockStoreData.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        mockStoreData.set(key, value);
      }),
    };
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
    mockStoreData.clear();
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
    mockStoreData.set("channel", "dev");

    await expect(loadDesktopReleaseChannel()).resolves.toBe("dev");
    expect(window.localStorage.getItem("freed-release-channel")).toBe("dev");
  });

  it("seeds native store from browser storage when native store is empty", async () => {
    window.localStorage.setItem("freed-release-channel", "dev");

    await expect(loadDesktopReleaseChannel()).resolves.toBe("dev");
    expect(mockStoreData.get("channel")).toBe("dev");
  });

  it("persists channel changes to native store and browser storage", async () => {
    await persistDesktopReleaseChannel("dev");

    expect(mockStoreData.get("channel")).toBe("dev");
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
