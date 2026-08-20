import { describe, expect, it } from "vitest";

import { bindLibraryServiceConfig } from "./config.js";
import { LibraryServiceFailure } from "./contracts.js";
import { inspectLibraryServiceReadiness } from "./diagnostics.js";
import {
  FakeAclProof,
  FakeIdentity,
  expectFailureCode,
  validConfigFileSystem,
} from "./testing/fakes.js";

async function loadLibraryServiceConfig(
  configPath: string,
  fileSystem: Parameters<typeof bindLibraryServiceConfig>[1],
  identity: Parameters<typeof bindLibraryServiceConfig>[2],
  aclProof: Parameters<typeof bindLibraryServiceConfig>[3],
) {
  const bound = await bindLibraryServiceConfig(
    configPath,
    fileSystem,
    identity,
    aclProof,
  );
  try {
    return bound.config;
  } finally {
    await bound.close();
  }
}

describe("loadLibraryServiceConfig", () => {
  it("accepts one explicit Primary with private roots and a pinned sidecar", async () => {
    const fileSystem = validConfigFileSystem();

    const config = await loadLibraryServiceConfig(
      "/safe/config.json",
      fileSystem,
      new FakeIdentity(),
      new FakeAclProof(),
    );

    expect(config.role).toBe("primary");
    expect(config.dataRoot).toBe("/safe/data");
    expect(config.stateRoot).toBe("/safe/state");
    expect(config.sidecar.sha256).toBe(
      fileSystem.digests.get("/trusted/sidecar"),
    );
  });

  it("fails closed when the configured role is not Primary", async () => {
    const fileSystem = validConfigFileSystem();
    const raw = JSON.parse(fileSystem.texts.get("/safe/config.json")!);
    raw.role = "follower";
    fileSystem.addFile("/safe/config.json", JSON.stringify(raw));

    await loadLibraryServiceConfig(
      "/safe/config.json",
      fileSystem,
      new FakeIdentity(),
      new FakeAclProof(),
    ).then(
      () => expect.fail("expected role refusal"),
      (error) => expectFailureCode(error, "config_invalid"),
    );
  });

  it("rejects a credential descriptor carrying an unrecognized secret field", async () => {
    const fileSystem = validConfigFileSystem();
    fileSystem.addFile(
      "/safe/state/credentials.json",
      JSON.stringify({
        schemaVersion: 1,
        backend: "os-vault",
        recordId: "freed-library-primary",
        token: "must-not-be-accepted",
      }),
    );

    await loadLibraryServiceConfig(
      "/safe/config.json",
      fileSystem,
      new FakeIdentity(),
      new FakeAclProof(),
    ).then(
      () => expect.fail("expected descriptor refusal"),
      (error) => expectFailureCode(error, "credential_descriptor_invalid"),
    );
  });

  it("rejects a missing admission record before any process can start", async () => {
    const fileSystem = validConfigFileSystem();
    fileSystem.metadata.delete("/safe/state/admission.json");
    fileSystem.texts.delete("/safe/state/admission.json");

    await loadLibraryServiceConfig(
      "/safe/config.json",
      fileSystem,
      new FakeIdentity(),
      new FakeAclProof(),
    ).then(
      () => expect.fail("expected admission refusal"),
      (error) => expectFailureCode(error, "admission_missing"),
    );
  });

  it("rejects a missing credential descriptor before any process can start", async () => {
    const fileSystem = validConfigFileSystem();
    fileSystem.metadata.delete("/safe/state/credentials.json");
    fileSystem.texts.delete("/safe/state/credentials.json");

    await loadLibraryServiceConfig(
      "/safe/config.json",
      fileSystem,
      new FakeIdentity(),
      new FakeAclProof(),
    ).then(
      () => expect.fail("expected credential refusal"),
      (error) => expectFailureCode(error, "credential_descriptor_missing"),
    );
  });

  it("rejects group-writable sidecar hierarchy", async () => {
    const fileSystem = validConfigFileSystem();
    fileSystem.addDirectory("/trusted", 0, 0o775);

    await loadLibraryServiceConfig(
      "/safe/config.json",
      fileSystem,
      new FakeIdentity(),
      new FakeAclProof(),
    ).then(
      () => expect.fail("expected unsafe hierarchy refusal"),
      (error) => expectFailureCode(error, "sidecar_path_unsafe"),
    );
  });

  it("rejects a sidecar reached through a symbolic link", async () => {
    const fileSystem = validConfigFileSystem();
    fileSystem.metadata.set("/trusted/sidecar", {
      kind: "symbolic-link",
      uid: 501,
      mode: 0o777,
      size: 7,
      device: "9",
      inode: "9999",
      links: 1,
    });
    fileSystem.canonical.set("/trusted/sidecar", "/trusted/real-sidecar");

    await loadLibraryServiceConfig(
      "/safe/config.json",
      fileSystem,
      new FakeIdentity(),
      new FakeAclProof(),
    ).then(
      () => expect.fail("expected symbolic-link refusal"),
      (error) => expectFailureCode(error, "sidecar_path_unsafe"),
    );
  });

  it("rejects a sidecar that does not match its exact SHA-256", async () => {
    const fileSystem = validConfigFileSystem();
    fileSystem.replaceFile("/trusted/sidecar", "replaced sidecar", 0, 0o755);

    await loadLibraryServiceConfig(
      "/safe/config.json",
      fileSystem,
      new FakeIdentity(),
      new FakeAclProof(),
    ).then(
      () => expect.fail("expected digest refusal"),
      (error) => expectFailureCode(error, "sidecar_digest_mismatch"),
    );
  });

  it("fails closed when current ownership cannot be verified", async () => {
    await loadLibraryServiceConfig(
      "/safe/config.json",
      validConfigFileSystem(),
      new FakeIdentity(null),
      new FakeAclProof(),
    ).then(
      () => expect.fail("expected ownership refusal"),
      (error) =>
        expectFailureCode(error, "unsupported_secret_store_or_acl_backend"),
    );
  });

  it.each([
    "acl_present",
    "acl_probe_malformed",
    "acl_probe_unavailable",
  ] as const)("fails closed when ACL proof reports %s", async (code) => {
    const aclProof = new FakeAclProof();
    aclProof.failure = new LibraryServiceFailure(code);

    await expect(
      loadLibraryServiceConfig(
        "/safe/config.json",
        validConfigFileSystem(),
        new FakeIdentity(),
        aclProof,
      ),
    ).rejects.toMatchObject({ code });
  });

  it("maps an unavailable or broken ACL backend to a bounded refusal", async () => {
    const aclProof = new FakeAclProof();
    aclProof.failure = new Error("unbounded backend detail must not escape");

    await expect(
      loadLibraryServiceConfig(
        "/safe/config.json",
        validConfigFileSystem(),
        new FakeIdentity(),
        aclProof,
      ),
    ).rejects.toMatchObject({ code: "acl_probe_unavailable" });
  });

  it("rejects a hardlinked admission record before opening authority", async () => {
    const fileSystem = validConfigFileSystem();
    fileSystem.addFile("/safe/data/library-core.sqlite", "sqlite bytes");
    const database = fileSystem.metadata.get("/safe/data/library-core.sqlite")!;
    const admission = fileSystem.metadata.get("/safe/state/admission.json")!;
    admission.device = database.device;
    admission.inode = database.inode;
    admission.links = 2;
    database.links = 2;

    await expect(
      loadLibraryServiceConfig(
        "/safe/config.json",
        fileSystem,
        new FakeIdentity(),
        new FakeAclProof(),
      ),
    ).rejects.toMatchObject({ code: "admission_not_private" });
    expect(fileSystem.opened.map(({ path }) => path)).not.toContain(
      "/safe/data/library-core.sqlite",
    );
  });

  it.each([
    ["config", "/safe/config.json", "config_not_private"],
    [
      "credential",
      "/safe/state/credentials.json",
      "credential_descriptor_not_private",
    ],
    ["sidecar", "/trusted/sidecar", "sidecar_invalid"],
  ] as const)(
    "rejects a hardlinked %s regular file",
    async (_label, filePath, code) => {
      const fileSystem = validConfigFileSystem();
      fileSystem.metadata.get(filePath)!.links = 2;

      await expect(
        loadLibraryServiceConfig(
          "/safe/config.json",
          fileSystem,
          new FakeIdentity(),
          new FakeAclProof(),
        ),
      ).rejects.toMatchObject({ code });
    },
  );

  it("rejects sidecar, config, and input paths inside the data root", async () => {
    const fileSystem = validConfigFileSystem();
    const raw = JSON.parse(fileSystem.texts.get("/safe/config.json")!);
    raw.sidecar.executable = "/safe/data/library-core.sqlite";
    fileSystem.addFile("/safe/config.json", JSON.stringify(raw));

    await expect(
      loadLibraryServiceConfig(
        "/safe/config.json",
        fileSystem,
        new FakeIdentity(),
        new FakeAclProof(),
      ),
    ).rejects.toMatchObject({ code: "config_invalid" });
    expect(fileSystem.opened.map(({ path }) => path)).not.toContain(
      "/safe/data/library-core.sqlite",
    );
  });

  it.each([
    ["sidecar", "sidecar.executable", "/safe/state/authority"],
    ["admission", "admissionFile", "/safe/data/admission.json"],
    ["credential", "credentialDescriptorFile", "/safe/data/credentials.json"],
  ] as const)(
    "rejects a %s path that crosses an authority-root boundary",
    async (_label, field, value) => {
      const fileSystem = validConfigFileSystem();
      const raw = JSON.parse(fileSystem.texts.get("/safe/config.json")!);
      if (field === "sidecar.executable") raw.sidecar.executable = value;
      else raw[field] = value;
      fileSystem.addFile("/safe/config.json", JSON.stringify(raw));

      await expect(
        loadLibraryServiceConfig(
          "/safe/config.json",
          fileSystem,
          new FakeIdentity(),
          new FakeAclProof(),
        ),
      ).rejects.toMatchObject({ code: "config_invalid" });
    },
  );

  it.each(["/safe/data/config.json", "/safe/state/config.json"])(
    "rejects a config path inside a declared authority root: %s",
    async (configPath) => {
      const fileSystem = validConfigFileSystem();
      fileSystem.addFile(
        configPath,
        fileSystem.texts.get("/safe/config.json")!,
      );

      await expect(
        loadLibraryServiceConfig(
          configPath,
          fileSystem,
          new FakeIdentity(),
          new FakeAclProof(),
        ),
      ).rejects.toMatchObject({ code: "config_invalid" });
      expect(fileSystem.opened.map(({ path }) => path)).not.toContain(
        "/safe/data/library-core.sqlite",
      );
    },
  );

  it.each(["admissionFile", "credentialDescriptorFile"] as const)(
    "rejects %s when it aliases the reserved status file",
    async (field) => {
      const fileSystem = validConfigFileSystem();
      const raw = JSON.parse(fileSystem.texts.get("/safe/config.json")!);
      raw[field] = "/safe/state/library-service-status.json";
      fileSystem.addFile("/safe/config.json", JSON.stringify(raw));

      await expect(
        loadLibraryServiceConfig(
          "/safe/config.json",
          fileSystem,
          new FakeIdentity(),
          new FakeAclProof(),
        ),
      ).rejects.toMatchObject({ code: "config_invalid" });
      expect(fileSystem.writes).toEqual([]);
    },
  );

  it("rejects ASCII control characters before any ACL probe", async () => {
    const fileSystem = validConfigFileSystem();
    const raw = JSON.parse(fileSystem.texts.get("/safe/config.json")!);
    raw.sidecar.executable = "/trusted/sidecar\nspoof";
    fileSystem.addFile("/safe/config.json", JSON.stringify(raw));
    const aclProof = new FakeAclProof();

    await expect(
      loadLibraryServiceConfig(
        "/safe/config.json",
        fileSystem,
        new FakeIdentity(),
        aclProof,
      ),
    ).rejects.toMatchObject({ code: "sidecar_invalid" });
    expect(aclProof.calls).toEqual([]);
  });

  it("detects path replacement after descriptors are bound", async () => {
    const fileSystem = validConfigFileSystem();
    let sidecarInspections = 0;
    fileSystem.inspectHook = (filePath) => {
      if (filePath !== "/trusted/sidecar") return;
      sidecarInspections += 1;
      if (sidecarInspections === 3) {
        fileSystem.replaceFile(filePath, "replacement", 0, 0o755);
      }
    };

    await expect(
      bindLibraryServiceConfig(
        "/safe/config.json",
        fileSystem,
        new FakeIdentity(),
        new FakeAclProof(),
      ),
    ).rejects.toMatchObject({ code: "bound_input_changed" });
    expect(fileSystem.opened.every(({ closed }) => closed)).toBe(true);
  });

  it("rehashes bound inputs after doctor binds the status file", async () => {
    const fileSystem = validConfigFileSystem();
    const aclProof = new FakeAclProof();
    aclProof.afterProbe = () => {
      if (aclProof.calls.length !== 2) return;
      const original = fileSystem.texts.get("/safe/config.json")!;
      fileSystem.rewriteFileInPlace(
        "/safe/config.json",
        original.replace('"role":"primary"', '"role":"primarx"'),
      );
    };

    await expect(
      inspectLibraryServiceReadiness(
        "/safe/config.json",
        fileSystem,
        new FakeIdentity(),
        aclProof,
      ),
    ).resolves.toMatchObject({ ok: false, code: "bound_input_changed" });
  });

  it("never opens a file beneath the Library Core data root", async () => {
    const fileSystem = validConfigFileSystem();
    const bound = await bindLibraryServiceConfig(
      "/safe/config.json",
      fileSystem,
      new FakeIdentity(),
      new FakeAclProof(),
    );
    await bound.close();

    expect(
      fileSystem.opened.filter(({ path }) => path.startsWith("/safe/data/")),
    ).toEqual([]);
  });
});
