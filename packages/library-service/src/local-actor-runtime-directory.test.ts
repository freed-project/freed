import { describe, expect, it } from "vitest";
import {
  bindLocalActorRuntimeDirectory,
  localActorRuntimeDirectoryName,
} from "./local-actor-runtime-directory.js";
import { createLibraryServiceDefinitionV1 } from "./service-definition.js";
import { FakeAclProof, FakeFileSystem } from "./testing/fakes.js";

const stateRootPath = `/home/freed/${"long-state-root-".repeat(10)}`;
function fixture() {
  const fileSystem = new FakeFileSystem();
  const aclProof = new FakeAclProof();
  const runtime = `/run/${localActorRuntimeDirectoryName(stateRootPath)}`;
  fileSystem.addDirectory("/run", 0, 0o755);
  fileSystem.addDirectory(runtime, 1000, 0o700);
  return { runtime, fileSystem, aclProof, stateRootPath, userId: 1000 };
}

describe("private Linux actor runtime directory", () => {
  it("shares the systemd directory identity and holds descriptors until close", async () => {
    const input = fixture();
    const bound = await bindLocalActorRuntimeDirectory(input);
    expect(bound.endpoint).toBe(`${input.runtime}/actor.sock`);
    expect(Buffer.byteLength(bound.endpoint)).toBeLessThanOrEqual(103);
    expect(bound.descriptorEndpoint).toBe("/proc/self/fd/101/actor.sock");
    expect(input.fileSystem.opened.every((value) => !value.closed)).toBe(true);
    const definition = createLibraryServiceDefinitionV1({
      platform: "linux",
      userId: 1000,
      nodeExecutable: "/opt/freed/node",
      cliExecutable: "/opt/freed/service.js",
      configPath: "/home/freed/config.json",
      dataRoot: "/home/freed/data",
      stateRoot: stateRootPath,
    });
    expect(definition.contents).toContain(
      `RuntimeDirectory=${localActorRuntimeDirectoryName(stateRootPath)}\nRuntimeDirectoryMode=0700`,
    );
    expect(definition.contents).toContain("PrivateTmp=true");
    expect(definition.contents).not.toContain("ReadWritePaths=/tmp");
    await bound.close();
    await bound.close();
    await expect(bound.assertStable()).rejects.toThrow(
      "local_actor_runtime_directory_closed",
    );
    expect(input.fileSystem.opened.every((value) => value.closed)).toBe(true);
  });

  it.each(["missing", "owner", "mode", "ancestor", "acl"])(
    "refuses %s and closes every acquired descriptor",
    async (fault) => {
      const input = fixture();
      if (fault === "missing") input.fileSystem.metadata.delete(input.runtime);
      if (fault === "owner")
        input.fileSystem.addDirectory(input.runtime, 1001, 0o700);
      if (fault === "mode")
        input.fileSystem.addDirectory(input.runtime, 1000, 0o755);
      if (fault === "ancestor") input.fileSystem.addDirectory("/run", 0, 0o777);
      if (fault === "acl") input.aclProof.failure = new Error("acl_present");
      await expect(bindLocalActorRuntimeDirectory(input)).rejects.toThrow();
      expect(input.fileSystem.opened.every((value) => value.closed)).toBe(true);
    },
  );
});
