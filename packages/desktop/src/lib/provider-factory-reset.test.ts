import { beforeEach, describe, expect, it, vi } from "vitest";

const { clearPlatformUA, invoke } = vi.hoisted(() => ({
  clearPlatformUA: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./user-agent", () => ({
  clearPlatformUA,
  selectPlatformUA: vi.fn(),
}));

import { disconnectFb } from "./fb-auth";
import { disconnectIg } from "./instagram-auth";
import { disconnectLi } from "./li-auth";

describe("provider factory reset", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearPlatformUA.mockReset();
    invoke.mockReset().mockResolvedValue(undefined);
  });

  it("clears native sessions and persisted provider user agents", async () => {
    await Promise.all([
      disconnectFb(),
      disconnectIg(),
      disconnectLi(),
    ]);

    expect(invoke).toHaveBeenCalledWith("fb_disconnect");
    expect(invoke).toHaveBeenCalledWith("ig_disconnect");
    expect(invoke).toHaveBeenCalledWith("li_disconnect");
    expect(clearPlatformUA).toHaveBeenCalledWith("facebook");
    expect(clearPlatformUA).toHaveBeenCalledWith("instagram");
    expect(clearPlatformUA).toHaveBeenCalledWith("linkedin");
  });

  it("rejects native disconnect failures", async () => {
    const error = new Error("native session store is unavailable");
    invoke.mockRejectedValueOnce(error);

    await expect(disconnectFb()).rejects.toBe(error);
  });
});
