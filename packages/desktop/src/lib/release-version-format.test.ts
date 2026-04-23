import { describe, expect, it } from "vitest";
import { formatReleaseVersion } from "@freed/shared";

describe("formatReleaseVersion", () => {
  it("appends the dev suffix for dev channel installs", () => {
    expect(formatReleaseVersion("26.4.1802", "dev")).toBe("26.4.1802-dev");
  });

  it("does not duplicate an existing dev suffix", () => {
    expect(formatReleaseVersion("26.4.1802-dev", "dev")).toBe("26.4.1802-dev");
  });

  it("strips the dev suffix for production display", () => {
    expect(formatReleaseVersion("26.4.1802-dev", "production")).toBe("26.4.1802");
  });

  it("infers the channel from the version when none is provided", () => {
    expect(formatReleaseVersion("26.4.1802-dev")).toBe("26.4.1802-dev");
    expect(formatReleaseVersion("26.4.1802")).toBe("26.4.1802");
  });
});
