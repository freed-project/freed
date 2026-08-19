import { beforeEach, describe, expect, it } from "vitest";
import {
  LibraryCoreFollowerTransportInactiveError,
  readLibraryCoreDesktopRole,
  requirePrimaryLibraryCoreDesktopRole,
  writeLibraryCoreDesktopRole,
} from "./library-core-desktop-role";

describe("Library Core Desktop role", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps existing installations primary by default", () => {
    expect(readLibraryCoreDesktopRole()).toBe("primary");
    expect(() => requirePrimaryLibraryCoreDesktopRole()).not.toThrow();
  });

  it("persists follower mode and fails closed before an authority path", () => {
    writeLibraryCoreDesktopRole("follower");

    expect(readLibraryCoreDesktopRole()).toBe("follower");
    expect(() => requirePrimaryLibraryCoreDesktopRole()).toThrow(
      LibraryCoreFollowerTransportInactiveError,
    );
  });

  it("restores primary mode explicitly", () => {
    writeLibraryCoreDesktopRole("follower");
    writeLibraryCoreDesktopRole("primary");

    expect(readLibraryCoreDesktopRole()).toBe("primary");
    expect(() => requirePrimaryLibraryCoreDesktopRole()).not.toThrow();
  });
});

