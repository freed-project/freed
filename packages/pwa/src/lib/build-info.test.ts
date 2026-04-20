import { describe, expect, it } from "vitest";
import { describeInstalledBuild } from "@freed/ui/lib/build-info";

describe("describeInstalledBuild", () => {
  it("hides extra build details for shipped production releases", () => {
    expect(
      describeInstalledBuild({
        appVersion: "26.4.1802",
        buildKind: "release",
        commitSha: "68baed6f3636bc65c4ddec6738c6209530a5efcb",
        commitRef: "main",
        deployedAt: "2026-04-19T23:31:20.000Z",
      }),
    ).toBeNull();
  });

  it("shows a clean dev release badge for release commits on the dev branch", () => {
    expect(
      describeInstalledBuild({
        appVersion: "26.4.1802",
        buildKind: "release",
        commitSha: "68baed6f3636bc65c4ddec6738c6209530a5efcb",
        commitRef: "dev",
        deployedAt: "2026-04-19T23:31:20.000Z",
      }),
    ).toMatchObject({
      badgeLabel: "Dev release",
    });
  });

  it("shows snapshot provenance for dev branch builds after the latest release", () => {
    expect(
      describeInstalledBuild({
        appVersion: "26.4.1802",
        buildKind: "snapshot",
        commitSha: "68baed6f3636bc65c4ddec6738c6209530a5efcb",
        commitRef: "dev",
        deployedAt: "2026-04-19T23:31:20.000Z",
      }),
    ).toMatchObject({
      badgeLabel: "Dev snapshot",
    });
  });
});
