import { describe, expect, it } from "vitest";
import { getPlatformCapabilities, type PlatformConfig } from "./PlatformContext.js";

describe("Library viewer capabilities", () => {
  it("denies edits while retaining browsing, diagnostics and local graph layout", () => {
    const platform = {
      libraryAccess: "read-only",
      replaceLibraryFriend() {}, assignLibraryAccountToPerson() {},
      upsertLibraryPerson() {}, mutateDeviceGraphLayout() {},
      publishStoryWall() {}, importInstagramStoryWallArchive() {},
    } as unknown as Partial<PlatformConfig>;
    expect(getPlatformCapabilities(platform)).toEqual({
      demo: false, libraryEdits: false, createPerson: false, linkAccounts: false,
      changeCare: false, pinGraph: true, externalLinks: true, liveVideo: true,
      maintenance: false, diagnostics: true, publishStoryWall: false, importStoryWall: false,
    });
  });

  it("keeps showcase restrictions independent of the real Library policy", () => {
    const capabilities = getPlatformCapabilities({ interactionMode: "read-only" });
    expect(capabilities.demo).toBe(true);
    expect(capabilities.libraryEdits).toBe(false);
    expect(capabilities.externalLinks).toBe(false);
    expect(capabilities.liveVideo).toBe(false);
  });
});
