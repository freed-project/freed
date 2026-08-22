import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("./library-core-desktop-role", () => ({
  readLibraryCoreDesktopRole: () => "primary",
}));

vi.mock("./legacy-library-presence", () => ({
  hasLegacyLibraryData: vi.fn(async () => true),
  shouldBlockForLegacyLibrary: vi.fn(() => true),
}));

vi.mock("./library-core-cloud-sync", () => ({
  readPersistedSqliteLibraryCloudIdentity: vi.fn(),
}));

vi.mock("./sqlite-library", async (importOriginal) => {
  const original = await importOriginal<typeof import("./sqlite-library")>();
  return {
    ...original,
    ensureFreshNormalizedDesktopLibrary: vi.fn(async () => false),
    loadSqliteLibraryState: mocks.load,
  };
});

import { initDoc } from "./library-client";

describe("normalized Desktop authority requirement", () => {
  it("fails closed without creating a portable shell when native cutover is unavailable", async () => {
    await expect(initDoc()).rejects.toThrow(/one-time SQLite Library transition/);

    expect(mocks.load).not.toHaveBeenCalled();
  });
});
