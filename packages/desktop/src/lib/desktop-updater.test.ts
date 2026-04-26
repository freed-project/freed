import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCheck, mockInvoke } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import {
  checkDesktopUpdate,
  getDesktopDownloadFallbackUrl,
  mapUpdaterTargetToDownloadTarget,
} from "./desktop-updater";

describe("desktop updater helpers", () => {
  beforeEach(() => {
    mockCheck.mockReset();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue("darwin-aarch64");
  });

  it("maps supported updater targets to website download targets", () => {
    expect(mapUpdaterTargetToDownloadTarget("darwin-aarch64")).toBe("mac-arm");
    expect(mapUpdaterTargetToDownloadTarget("darwin-x86_64")).toBe("mac-intel");
    expect(mapUpdaterTargetToDownloadTarget("windows-x86_64")).toBe("windows");
    expect(mapUpdaterTargetToDownloadTarget("linux-x86_64")).toBe("linux");
  });

  it("falls back cleanly when the updater target is unsupported", () => {
    expect(mapUpdaterTargetToDownloadTarget("linux-aarch64")).toBeNull();
  });

  it("builds a production fallback download URL", () => {
    expect(
      getDesktopDownloadFallbackUrl("production", "darwin-aarch64"),
    ).toBe("https://freed.wtf/api/downloads/mac-arm");
  });

  it("builds a dev fallback download URL", () => {
    expect(
      getDesktopDownloadFallbackUrl("dev", "windows-x86_64"),
    ).toBe("https://dev.freed.wtf/api/downloads/windows");
  });

  it("falls back to the channel get page for unsupported targets", () => {
    expect(
      getDesktopDownloadFallbackUrl("dev", "linux-aarch64"),
    ).toBe("https://dev.freed.wtf/get");
  });

  it("chooses a newer production release while keeping dev selected", async () => {
    mockCheck.mockImplementation(async ({ target }: { target?: string }) => {
      if (target === "dev-darwin-aarch64") {
        return { version: "26.4.2604", downloadAndInstall: async () => {} };
      }
      if (target === "production-darwin-aarch64") {
        return { version: "26.4.2605", downloadAndInstall: async () => {} };
      }
      return null;
    });

    await expect(checkDesktopUpdate("dev")).resolves.toMatchObject({
      channel: "production",
      fallbackDownloadUrl: "https://dev.freed.wtf/api/downloads/mac-arm",
      update: { version: "26.4.2605" },
    });
    expect(mockCheck).toHaveBeenNthCalledWith(1, { target: "dev-darwin-aarch64" });
    expect(mockCheck).toHaveBeenNthCalledWith(2, {
      target: "production-darwin-aarch64",
    });
  });

  it("keeps a newer dev release ahead of production fallback", async () => {
    mockCheck.mockImplementation(async ({ target }: { target?: string }) => {
      if (target === "dev-darwin-aarch64") {
        return { version: "26.4.2606-dev", downloadAndInstall: async () => {} };
      }
      if (target === "production-darwin-aarch64") {
        return { version: "26.4.2605", downloadAndInstall: async () => {} };
      }
      return null;
    });

    await expect(checkDesktopUpdate("dev")).resolves.toMatchObject({
      channel: "dev",
      update: { version: "26.4.2606-dev" },
    });
  });
});
