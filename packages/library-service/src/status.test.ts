import { describe, expect, it } from "vitest";

import {
  bindLibraryServiceStatusFile,
  createLibraryServiceStatusRecord,
  readLibraryServiceStatus,
  writeLibraryServiceStatus,
} from "./status.js";
import {
  FakeAclProof,
  FakeIdentity,
  validConfig,
  validConfigFileSystem,
} from "./testing/fakes.js";

describe("Library service local status", () => {
  it("is read-only when no status record exists", async () => {
    const fileSystem = validConfigFileSystem();
    const stateRoot = await fileSystem.openBoundPath("/safe/state");
    const statusFile = await bindLibraryServiceStatusFile(
      validConfig(),
      stateRoot,
      fileSystem,
      new FakeIdentity(),
      new FakeAclProof(),
    );

    await expect(
      readLibraryServiceStatus(statusFile, fileSystem),
    ).resolves.toMatchObject({ status: null });
    expect(fileSystem.writes).toEqual([]);
  });

  it("round trips a private bounded status record", async () => {
    const fileSystem = validConfigFileSystem();
    const config = validConfig();
    const stateRoot = await fileSystem.openBoundPath("/safe/state");
    const statusFile = await bindLibraryServiceStatusFile(
      config,
      stateRoot,
      fileSystem,
      new FakeIdentity(),
      new FakeAclProof(),
    );
    expect(statusFile).not.toBeNull();
    const status = createLibraryServiceStatusRecord({
      phase: "running",
      nowMs: Date.parse("2026-08-19T00:00:00.000Z"),
      startedAt: "2026-08-19T00:00:00.000Z",
      sidecarPid: 4_242,
      reasonCode: null,
    });

    await writeLibraryServiceStatus(statusFile!, fileSystem, status);

    await expect(
      readLibraryServiceStatus(statusFile, fileSystem),
    ).resolves.toEqual({
      schemaVersion: 1,
      service: "freed-library",
      configuredRole: "primary",
      status,
    });
  });

  it("rejects arbitrary reason text that could disclose sidecar output", async () => {
    const fileSystem = validConfigFileSystem();
    fileSystem.addFile(
      "/safe/state/library-service-status.json",
      `${JSON.stringify({
        schemaVersion: 1,
        service: "freed-library",
        role: "primary",
        phase: "failed",
        updatedAt: "2026-08-19T00:00:00.000Z",
        startedAt: null,
        sidecarPid: null,
        reasonCode: "token=must-not-escape",
      })}\n`,
    );
    const stateRoot = await fileSystem.openBoundPath("/safe/state");
    const statusFile = await bindLibraryServiceStatusFile(
      validConfig(),
      stateRoot,
      fileSystem,
      new FakeIdentity(),
      new FakeAclProof(),
    );

    await expect(
      readLibraryServiceStatus(statusFile, fileSystem),
    ).rejects.toMatchObject({ code: "status_invalid" });
  });

  it("fails explicitly when the platform ACL backend cannot prove privacy", async () => {
    const fileSystem = validConfigFileSystem();
    const stateRoot = await fileSystem.openBoundPath("/safe/state");
    await expect(
      bindLibraryServiceStatusFile(
        validConfig(),
        stateRoot,
        fileSystem,
        new FakeIdentity(null),
        new FakeAclProof(),
      ),
    ).rejects.toMatchObject({
      code: "unsupported_secret_store_or_acl_backend",
    });
  });
});
