import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type DesktopCapability = {
  windows: string[];
  webviews?: string[];
  local?: boolean;
  permissions: string[];
  remote?: {
    urls: string[];
  };
};

function readDesktopCapability(fileName: string): DesktopCapability {
  const raw = readFileSync(
    resolve(process.cwd(), "src-tauri/capabilities", fileName),
    "utf8",
  );
  return JSON.parse(raw) as DesktopCapability;
}

function readDefaultDesktopCapability(): DesktopCapability {
  return readDesktopCapability("default.json");
}

describe("desktop Tauri capabilities", () => {
  it("allows native logging only from the local main window", () => {
    const capability = readDesktopCapability("main-logging.json");

    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).toEqual(["log:allow-log"]);
    expect(capability.local).toBe(true);
    expect(capability.remote).toBeUndefined();
    expect(capability.webviews).toBeUndefined();

    // Capabilities are additive. Another grant must not expose logging to
    // provider pages or login windows through a broader capability.
    const loggingCapabilities = readdirSync(
      resolve(process.cwd(), "src-tauri/capabilities"),
    )
      .filter((fileName) => fileName.endsWith(".json"))
      .filter((fileName) =>
        readDesktopCapability(fileName).permissions.some(
          (permission) => permission === "log:allow-log" || permission === "log:default",
        ),
      );
    expect(loggingCapabilities).toEqual(["main-logging.json"]);
  });

  it("allows the main window to start native drag gestures", () => {
    const capability = readDefaultDesktopCapability();

    expect(capability.windows).toContain("main");
    expect(capability.permissions).toContain("core:window:allow-start-dragging");
  });

  it("allows app data metadata checks for local AI model storage", () => {
    const capability = readDefaultDesktopCapability();

    expect(capability.permissions).toContain("fs:allow-appdata-read-recursive");
    expect(capability.permissions).toContain("fs:allow-appdata-write-recursive");
    expect(capability.permissions).toContain("fs:allow-appdata-meta-recursive");
  });

  it("grants recovery windows the permissions needed to update or open fallback downloads", () => {
    const capability = readDefaultDesktopCapability();

    expect(capability.windows).toContain("startup-recovery");
    expect(capability.permissions).toContain("shell:allow-open");
    expect(capability.permissions).toContain("updater:default");
    expect(capability.permissions).toContain("process:default");
  });

  it.each([
    {
      fileName: "fb-scraper.json",
      windowLabel: "fb-scraper",
      remoteUrl: "https://*.facebook.com/*",
    },
    {
      fileName: "ig-scraper.json",
      windowLabel: "ig-scraper",
      remoteUrl: "https://*.instagram.com/*",
    },
    {
      fileName: "li-scraper.json",
      windowLabel: "li-scraper",
      remoteUrl: "https://*.linkedin.com/*",
    },
  ])(
    "allows $windowLabel to emit extraction events from its provider",
    ({ fileName, windowLabel, remoteUrl }) => {
      const capability = readDesktopCapability(fileName);

      expect(capability.windows).toContain(windowLabel);
      expect(capability.remote?.urls).toContain(remoteUrl);
      expect(capability.permissions).toContain("core:event:allow-emit");
    },
  );
});
