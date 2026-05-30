import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA platform capabilities", () => {
  it("does not expose source management through the platform config", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

    expect(appSource).not.toContain("googleContacts:");
    expect(appSource).not.toContain("getValidCloudToken");
    expect(appSource).not.toContain("initiateGDriveOAuth");
    expect(appSource).not.toContain("addRssFeed:");
    expect(appSource).not.toContain("exportFeedsAsOPML");
    expect(appSource).not.toContain("subscribeToFeed");
  });
});
