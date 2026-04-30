import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type DesktopCapability = {
  windows: string[];
  permissions: string[];
};

function readDefaultDesktopCapability(): DesktopCapability {
  const raw = readFileSync(resolve(process.cwd(), "src-tauri/capabilities/default.json"), "utf8");
  return JSON.parse(raw) as DesktopCapability;
}

describe("desktop Tauri capabilities", () => {
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
});
