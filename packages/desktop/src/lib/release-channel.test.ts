import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import { getDesktopUpdateTargets } from "./release-channel";

describe("desktop release channel helpers", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
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
});
