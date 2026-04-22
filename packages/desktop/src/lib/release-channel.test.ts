import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import {
  buildDesktopUpdateTargets,
  getDesktopUpdateTargets,
  getNativeUpdaterTarget,
} from "./release-channel";

describe("desktop release channel helpers", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
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
});
