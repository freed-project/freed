import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock("./primary-runtime.js", () => ({
  createLibraryServicePrimaryRuntimeV1: () => mocks,
}));
vi.mock("./google-drive-publication.js", () => ({
  createBoundGoogleDrivePublicationStatePortV1: () => ({}),
  createLibraryServiceGoogleDrivePublicationV1: () => ({}),
}));
vi.mock("./node-google-drive-token.js", () => ({
  createNodeGoogleDriveTokenPortV1: () => ({}),
}));
import { createNodeLibraryServicePrimaryCloudPortV1 } from "./primary-cloud-runtime.js";
import { FakeClock, FakeFileSystem } from "./testing/fakes.js";

describe("installed Primary cloud admission", () => {
  it("stops the runtime instead of admitting ownership refusal or failed startup", async () => {
    const port = createNodeLibraryServicePrimaryCloudPortV1();
    const fileSystem = new FakeFileSystem();
    fileSystem.addFile("/state/publication.json", "");
    const stateFile = await fileSystem.openBoundPath("/state/publication.json");
    const input = {
      config: { provider: "google-drive" as const, installationWitness: "a".repeat(64),
        credentialRecordId: "test", publicationStateFile: "/state/publication.json" },
      stateFile, fileSystem, clock: new FakeClock(), native: { execute: vi.fn() },
    };
    try {
      for (const status of ["ownership_required", "unexpected"]) {
        mocks.start.mockResolvedValueOnce({ status });
        await expect(port.start(input)).rejects.toMatchObject({ code: "authority_not_primary" });
      }
      mocks.start.mockRejectedValueOnce(new Error("offline"));
      await expect(port.start(input)).rejects.toThrow("offline");
      expect(mocks.stop).toHaveBeenCalledTimes(3);
      for (const status of ["current", "published"]) {
        mocks.start.mockResolvedValueOnce({ status });
        await expect(port.start(input)).resolves.toBe(mocks);
      }
      expect(mocks.stop).toHaveBeenCalledTimes(3);
    } finally {
      await stateFile.close();
    }
  });
});
