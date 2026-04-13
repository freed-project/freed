import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import { getDesktopUpdateTarget } from "./release-channel";

describe("desktop release channel helpers", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("prefixes the native updater target with the selected channel", async () => {
    mockInvoke.mockResolvedValue("darwin-aarch64");

    await expect(getDesktopUpdateTarget("dev")).resolves.toBe(
      "dev-darwin-aarch64",
    );
    expect(mockInvoke).toHaveBeenCalledWith("get_updater_target");
  });
});
