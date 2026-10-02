import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCheck, mockInvoke, mockSnapshot, mockLibraryActive } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockInvoke: vi.fn(),
  mockSnapshot: vi.fn(),
  mockLibraryActive: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("./snapshots", () => ({ createSnapshot: mockSnapshot }));
vi.mock("./sqlite-library", () => ({ isSqliteLibraryActive: mockLibraryActive }));

import {
  installPendingDesktopUpdate,
  type PendingDesktopUpdate,
  checkDesktopUpdate,
  getDesktopDownloadFallbackUrl,
  mapUpdaterTargetToDownloadTarget,
} from "./desktop-updater";

describe("desktop updater helpers", () => {
  beforeEach(() => {
    mockSnapshot.mockReset().mockResolvedValue({ id: "snapshot-before-update" });
    mockLibraryActive.mockReset().mockReturnValue(true);
    mockCheck.mockReset();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue("darwin-aarch64");
  });

  function pending(downloadAndInstall = vi.fn().mockResolvedValue(undefined)) {
    return {
      channel: "dev", nativeUpdaterTarget: "darwin-aarch64", fallbackDownloadUrl: "https://dev.freed.wtf/get",
      update: { version: "26.10.200", downloadAndInstall },
    } as unknown as PendingDesktopUpdate;
  }

  it("does not replace the installed build until its Library snapshot completes", async () => {
    let finish!: (value: unknown) => void;
    mockSnapshot.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const update = pending();
    const install = installPendingDesktopUpdate(update);
    expect(mockSnapshot).toHaveBeenCalledWith("manual");
    expect(update.update.downloadAndInstall).not.toHaveBeenCalled();
    finish({ id: "snapshot-before-update" });
    await expect(install).resolves.toBe("26.10.200");
    expect(update.update.downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("refuses installation when snapshot capture fails or the active Library disappears", async () => {
    const update = pending();
    mockSnapshot.mockRejectedValueOnce(new Error("insufficient space"));
    await expect(installPendingDesktopUpdate(update)).rejects.toThrow("insufficient space");
    mockSnapshot.mockResolvedValueOnce(null);
    await expect(installPendingDesktopUpdate(update)).rejects.toThrow("update was not installed");
    expect(update.update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("keeps a repair update possible when startup could not open the Library", async () => {
    mockLibraryActive.mockReturnValue(false);
    const update = pending();
    await expect(installPendingDesktopUpdate(update)).resolves.toBe("26.10.200");
    expect(mockSnapshot).not.toHaveBeenCalled();
    expect(update.update.downloadAndInstall).toHaveBeenCalledOnce();
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
