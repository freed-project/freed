import { describe, expect, it } from "vitest";
import {
  getDesktopDownloadFallbackUrl,
  mapUpdaterTargetToDownloadTarget,
} from "./desktop-updater";

describe("desktop updater helpers", () => {
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
});
