import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeDesktopClientWarning,
  clearDesktopClientWarningAcknowledgement,
  desktopClientWarningSignature,
  isDesktopClientWarningAcknowledged,
} from "./desktop-client-warning";

describe("desktop client warning acknowledgement", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("is local, signature specific, and cleared by a device reset", () => {
    const first = desktopClientWarningSignature(["desktop-b", "desktop-a"]);
    const second = desktopClientWarningSignature(["desktop-a", "desktop-c"]);

    acknowledgeDesktopClientWarning(first);
    expect(isDesktopClientWarningAcknowledged(first)).toBe(true);
    expect(isDesktopClientWarningAcknowledged(second)).toBe(false);

    clearDesktopClientWarningAcknowledgement();
    expect(isDesktopClientWarningAcknowledged(first)).toBe(false);
  });

  it("cannot collide when registration IDs contain separators", () => {
    expect(desktopClientWarningSignature(["a", "b|c"]))
      .not.toBe(desktopClientWarningSignature(["a|b", "c"]));
  });

  it("propagates acknowledgement removal failures during reset", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => clearDesktopClientWarningAcknowledgement()).toThrow(
      "storage unavailable",
    );
  });
});
