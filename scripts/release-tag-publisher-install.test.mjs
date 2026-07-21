import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import {
  activateReleaseTagPublisher,
  archiveLegacyReleaseTagPublisher,
  discardReleaseTagPublisherRecovery,
  parseReleaseTagPublisherTextVnodes,
  parseReleaseTagPublisherRetiredAdmission,
  prepareReleaseTagPublisher,
  provisionReleaseTagPublisher,
  revokeReleaseTagPublisher,
  rotateReleaseTagPublisher,
  verifyReleaseTagPublisher,
  verifyLegacyReleaseTagPublisherRebootCutover,
} from "./release-tag-publisher-install.mjs";
import {
  releaseTagPublisherNativePairSha256,
  verifyReleaseTagPublisherBindingShape,
} from "./lib/release-tag-publisher-binding.mjs";

let fixtureRoot;
let privateKey;
let privateKeyPath;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function result(action, extra = {}) {
  return `${JSON.stringify({
    schemaVersion: 2,
    purpose: "freed-release-tag-publisher-keychain-result",
    action,
    service: "freed-release-tag-publisher",
    account: "github-app-private-key",
    host: "/Library/Application Support/Freed/release-tag-publisher",
    ...extra,
  })}\n`;
}

function installationReadiness(overrides = {}) {
  return {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-installation-readiness",
    repo: "freed-project/freed",
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    appName: "Freed Release Publisher",
    appExternalUrl: "https://freed.wtf",
    appOwnerLogin: "freed-project",
    appOwnerType: "Organization",
    appPermissions: { contents: "write", metadata: "read" },
    appEvents: [],
    installationId: 42,
    accountLogin: "freed-project",
    accountType: "Organization",
    repositorySelection: "selected",
    permissions: { contents: "write", metadata: "read" },
    repositories: ["freed-project/freed"],
    ...overrides,
  };
}

function createNativeInstallHarness({
  failTarget = null,
  failureCount = Number.POSITIVE_INFINITY,
} = {}) {
  const root = realpathSync(
    mkdtempSync(path.join(fixtureRoot, "native-install-")),
  );
  const hostPath = path.join(root, "installed", "release-tag-publisher");
  const provisionerPath = path.join(
    root,
    "installed",
    "release-tag-publisher-provision",
  );
  const configPath = path.join(root, "installed", "release-tag-publisher.json");
  const installs = [];
  let failuresRemaining = failureCount;
  const dependencies = {
    repoRoot: fixtureRoot,
    tempRoot: root,
    buildScript: path.join(root, "build.sh"),
    hostPath,
    provisionerPath,
    configPath,
    keychainPresence: () => "missing",
    codeHash: (filePath) =>
      digest(`cdhash:${readFileSync(filePath)}`).slice(0, 40),
    readInstalledConfig: (filePath) =>
      JSON.parse(readFileSync(filePath, "utf8")),
    inspectInstalledHost() {},
    run(executable, args, options) {
      if (executable === "/bin/bash") {
        const hostOutput = args[args.indexOf("--host-output") + 1];
        const provisionerOutput =
          args[args.indexOf("--provisioner-output") + 1];
        writeFileSync(hostOutput, "new-host-generation", { mode: 0o700 });
        writeFileSync(provisionerOutput, "new-provisioner-generation", {
          mode: 0o700,
        });
        return { status: 0, stdout: "", stderr: "" };
      }
      assert.equal(executable, "/usr/bin/sudo");
      assert.equal(args[0], "/usr/bin/install");
      const installArgs = args.slice(1);
      const target = installArgs.at(-1);
      if (installArgs[0] === "-d") {
        mkdirSync(target, { recursive: true, mode: 0o755 });
        installs.push({ target, directory: true });
        return { status: 0, stdout: "", stderr: "" };
      }
      const source = installArgs.at(-2);
      assert.equal(installArgs.includes("-S"), true);
      const mode = Number.parseInt(
        installArgs[installArgs.indexOf("-m") + 1],
        8,
      );
      installs.push({ target, source, directory: false });
      if (
        failuresRemaining > 0 &&
        (target === failTarget ||
          (failTarget === "host" && target === hostPath) ||
          (failTarget === "provisioner" && target === provisionerPath))
      ) {
        failuresRemaining -= 1;
        return { status: 1, stdout: "", stderr: "injected install failure" };
      }
      if (existsSync(target)) chmodSync(target, 0o600);
      copyFileSync(source, target);
      chmodSync(target, mode);
      return { status: 0, stdout: "", stderr: "" };
    },
  };
  return {
    root,
    hostPath,
    provisionerPath,
    configPath,
    installs,
    dependencies,
  };
}

function seedLegacyActiveNativePair(harness) {
  mkdirSync(path.dirname(harness.hostPath), { recursive: true });
  writeFileSync(harness.hostPath, "old-host-generation", { mode: 0o700 });
  writeFileSync(harness.provisionerPath, "old-unsafe-provisioner", {
    mode: 0o700,
  });
  writeFileSync(
    harness.configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        purpose: "freed-release-tag-publisher-binding",
        status: "active",
        repo: "freed-project/freed",
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        publisherPath: harness.hostPath,
        publisherSha256: digest("old-host-generation"),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

const liveLegacyDigests = Object.freeze({
  binding: "f4138e23afff5bd9ac97dcc14ef0e2623f1640ffa91bea45eb5cd0edebe28127",
  publisher: "22d6f6065364d1c7a38baf0f4881cb60f5509dbb4de8d5c55bd2f38e45a38fe9",
  provisioner:
    "fe3057b658cd9e0815f57de9ed5adf2683b3ec2d69560ac9a8a18b1e92073934",
});

function createLegacyArchiveHarness({
  crashAfterChmodRole = null,
  crashAfterMoveRole = null,
  legacyDigestOverrides = {},
} = {}) {
  const root = realpathSync(
    mkdtempSync(path.join(fixtureRoot, "legacy-cutover-")),
  );
  const installed = path.join(root, "Application Support", "Freed");
  mkdirSync(installed, { recursive: true, mode: 0o755 });
  const hostPath = path.join(installed, "release-tag-publisher");
  const provisionerPath = path.join(
    installed,
    "release-tag-publisher-provision",
  );
  const configPath = path.join(installed, "release-tag-publisher.json");
  const archiveDirectory = path.join(
    installed,
    "release-tag-publisher-schema1-archive",
  );
  const archiveManifestPath = path.join(archiveDirectory, "cutover.json");
  writeFileSync(hostPath, "live-schema1-host", { mode: 0o555 });
  writeFileSync(provisionerPath, "live-schema1-provisioner", { mode: 0o555 });
  writeFileSync(
    configPath,
    `${JSON.stringify({
      schemaVersion: 1,
      purpose: "freed-release-tag-publisher-binding",
      status: "active",
      repo: "freed-project/freed",
      appId: 4_296_969,
      appSlug: "freed-release-publisher",
      publisherPath: hostPath,
      publisherSha256: liveLegacyDigests.publisher,
    })}\n`,
    { mode: 0o444 },
  );
  let bootId = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
  let processes = [];
  let presence = "missing";
  let chmodCrashPending = crashAfterChmodRole !== null;
  let moveCrashPending = crashAfterMoveRole !== null;
  let helperSourceVerified = false;
  const calls = [];
  const legacyDigest = (role) =>
    legacyDigestOverrides[role] ?? liveLegacyDigests[role];
  const roleForPath = (filePath) => {
    if (filePath === configPath) return "binding";
    if (filePath === hostPath) return "publisher";
    if (filePath === provisionerPath) return "provisioner";
    if (filePath.endsWith("release-tag-publisher.schema1.json"))
      return "binding";
    if (filePath.endsWith("release-tag-publisher.schema1")) return "publisher";
    if (filePath.endsWith("release-tag-publisher-provision.schema1")) {
      return "provisioner";
    }
    return null;
  };
  const dependencies = {
    repoRoot: root,
    tempRoot: root,
    hostPath,
    provisionerPath,
    configPath,
    archiveDirectory,
    archiveManifestPath,
    authorizeRecovery(request) {
      calls.push({ authorization: request });
    },
    keychainPresence: () => presence,
    publisherTextVnodes: () =>
      processes.map((entry) => {
        if (typeof entry === "object") return { ...entry };
        const liveOrArchivedHost = existsSync(hostPath)
          ? hostPath
          : path.join(
              archiveDirectory,
              "release-tag-publisher.schema1",
            );
        const metadata = statSync(liveOrArchivedHost, { bigint: true });
        return {
          pid: entry,
          device: metadata.dev.toString(),
          inode: metadata.ino.toString(),
          path: "/usr/bin/argv-spoof",
        };
      }),
    bootId: () => bootId,
    pathExists: existsSync,
    archiveDevice: () =>
      statSync(archiveDirectory, { bigint: true }).dev.toString(),
    readInstalledConfig: (filePath) =>
      JSON.parse(readFileSync(filePath, "utf8")),
    readArchiveManifest: (filePath) =>
      JSON.parse(readFileSync(filePath, "utf8")),
    inspectLegacySource(filePath, { executable }) {
      const metadata = statSync(filePath, { bigint: true });
      const expectedMode = executable ? 0o555n : 0o444n;
      if (metadata.nlink !== 1n || (metadata.mode & 0o777n) !== expectedMode) {
        throw new Error("legacy source nlink or mode mismatch");
      }
      return {
        device: metadata.dev.toString(),
        inode: metadata.ino.toString(),
        sha256: legacyDigest(roleForPath(filePath)),
      };
    },
    run(executable, args, options) {
      calls.push({ executable, args: [...args] });
      assert.equal(executable, "/usr/bin/sudo");
      const tool = args[0];
      if (tool === "/usr/bin/install") {
        const installArgs = args.slice(1);
        const target = installArgs.at(-1);
        if (installArgs[0] === "-d") {
          mkdirSync(target, { recursive: true, mode: 0o700 });
          chmodSync(target, 0o700);
          return { status: 0, stdout: "", stderr: "" };
        }
        assert.equal(installArgs.includes("-S"), true);
        const source = installArgs.at(-2);
        const mode = Number.parseInt(
          installArgs[installArgs.indexOf("-m") + 1],
          8,
        );
        const replacement = `${target}.installing`;
        copyFileSync(source, replacement);
        chmodSync(replacement, mode);
        renameSync(replacement, target);
        return { status: 0, stdout: "", stderr: "" };
      }
      if (tool === "/bin/chmod") {
        chmodSync(args[2], Number.parseInt(args[1], 8));
        if (chmodCrashPending && roleForPath(args[2]) === crashAfterChmodRole) {
          chmodCrashPending = false;
          return {
            status: 1,
            stdout: "",
            stderr: "injected chmod response loss",
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      }
      if (tool === "/bin/mv") {
        const role = roleForPath(args[1]);
        renameSync(args[1], args[2]);
        if (moveCrashPending && role === crashAfterMoveRole) {
          moveCrashPending = false;
          return { status: 1, stdout: "", stderr: "injected response loss" };
        }
        return { status: 0, stdout: "", stderr: "" };
      }
      if (tool === "/usr/bin/python3") {
        assert.equal(options.maxBuffer, 64 * 1_024);
        assert.equal(args.length, 9);
        assert.equal(args[1], "-I");
        assert.equal(args[2], "-c");
        assert.equal(typeof args[3], "string");
        assert.equal(args[3].includes(".py"), false);
        assert.equal(args[3].includes('getattr(os, "O_NOFOLLOW", 0)'), false);
        assert.equal(args[3].includes('getattr(os, "O_CLOEXEC", 0)'), false);
        assert.match(args[3], /os\.open\(path, flags\)/);
        assert.match(args[3], /os\.O_NOFOLLOW \| os\.O_CLOEXEC/);
        assert.match(args[3], /os\.fstat\(descriptor\)/);
        assert.match(args[3], /identity\(after\) != identity\(link_after\)/);
        if (!helperSourceVerified) {
          const syntax = spawnSync(
            "/usr/bin/python3",
            [
              "-I",
              "-c",
              "import sys; compile(sys.argv[1], '<retired-admission>', 'exec')",
              args[3],
            ],
            {
              encoding: "utf8",
              env: { HOME: process.env.HOME ?? "", PATH: "/usr/bin:/bin" },
            },
          );
          assert.equal(syntax.status, 0, syntax.stderr);
          helperSourceVerified = true;
        }
        const filePath = args[4];
        const maximumBytes = Number(args[5]);
        const metadata = statSync(filePath, { bigint: true });
        const role = roleForPath(filePath);
        assert.match(filePath, /Application Support/);
        assert.equal(metadata.dev.toString(), args[6]);
        assert.equal(metadata.ino.toString(), args[7]);
        assert.equal(legacyDigest(role), args[8]);
        assert.equal(metadata.nlink, 1n);
        assert.equal(metadata.mode & 0o777n, 0o400n);
        assert.ok(metadata.size > 0n);
        assert.ok(metadata.size <= BigInt(maximumBytes));
        return {
          status: 0,
          stdout: JSON.stringify({
            schemaVersion: 1,
            purpose: "freed-release-tag-publisher-retired-file-admission",
            path: filePath,
            device: metadata.dev.toString(),
            inode: metadata.ino.toString(),
            uid: 0,
            gid: 0,
            mode: 0o400,
            nlink: 1,
            size: Number(metadata.size),
            sha256: legacyDigest(role),
          }),
          stderr: "",
        };
      }
      throw new Error(`unexpected privileged tool ${tool}`);
    },
  };
  return {
    root,
    hostPath,
    provisionerPath,
    configPath,
    archiveDirectory,
    archiveManifestPath,
    calls,
    dependencies,
    setBootId(value) {
      bootId = value;
    },
    setProcesses(value) {
      processes = value;
    },
    setPresence(value) {
      presence = value;
    },
  };
}

function createHarness({
  presence = "missing",
  activationError = null,
  initialDigest = null,
} = {}) {
  const calls = [];
  let storedDigest =
    presence === "present" ? (initialDigest ?? digest(privateKey)) : null;
  let prepared = 0;
  let activated = 0;
  const dependencies = {
    hostPath: "/Library/Application Support/Freed/release-tag-publisher",
    provisionerPath:
      "/Library/Application Support/Freed/release-tag-publisher-provision",
    inspectInstalledHost() {},
    verifyInstalledNativePair() {},
    authorizeRecovery(request) {
      calls.push({ authorization: request });
    },
    keychainPresence: () => (storedDigest === null ? "missing" : "present"),
    prepareReleaseTagPublisher() {
      prepared += 1;
      return { action: "prepare" };
    },
    activateReleaseTagPublisher() {
      activated += 1;
      if (activationError) throw activationError;
      return { action: "activate" };
    },
    run(executable, args, options) {
      const action = args[0];
      calls.push({ executable, args: [...args], stdio: options.stdio });
      const digestIndex = args.indexOf("--expected-sha256");
      const expected = digestIndex === -1 ? null : args[digestIndex + 1];
      if (action === "recover" || action === "rotate") {
        const supplied = readFileSync(options.stdio[0]);
        const suppliedDigest = digest(supplied);
        supplied.fill(0);
        if (suppliedDigest !== expected) {
          return {
            status: 1,
            stdout: "",
            stderr: "the admitted file digest does not match",
          };
        }
        if (action === "recover" && storedDigest !== null) {
          return { status: 1, stdout: "", stderr: "already exists" };
        }
        storedDigest = suppliedDigest;
        return {
          status: 0,
          stdout: result(action, { changed: true }),
          stderr: "",
        };
      }
      if (action === "matches") {
        if (storedDigest !== expected) {
          return { status: 1, stdout: "", stderr: "digest mismatch" };
        }
        return {
          status: 0,
          stdout: result(action, { matched: true }),
          stderr: "",
        };
      }
      if (action === "discard-recovery") {
        if (storedDigest === null) {
          return {
            status: 0,
            stdout: result(action, { changed: false }),
            stderr: "",
          };
        }
        if (storedDigest !== expected) {
          return { status: 1, stdout: "", stderr: "digest mismatch" };
        }
        storedDigest = null;
        return {
          status: 0,
          stdout: result(action, { changed: true }),
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: `unexpected ${action}` };
    },
  };
  return {
    calls,
    dependencies,
    get activated() {
      return activated;
    },
    get prepared() {
      return prepared;
    },
    get storedDigest() {
      return storedDigest;
    },
    clearActivationError() {
      activationError = null;
    },
  };
}

before(() => {
  fixtureRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-release-publisher-install-")),
  );
  chmodSync(fixtureRoot, 0o700);
  ({ privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2_048,
    privateKeyEncoding: { format: "pem", type: "pkcs1" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  }));
  privateKeyPath = path.join(fixtureRoot, "release-app.pem");
  writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
});

after(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

test("native preparation records one recoverable exact pair generation", () => {
  const harness = createNativeInstallHarness();
  const value = prepareReleaseTagPublisher({
    dependencies: harness.dependencies,
  });
  const binding = JSON.parse(readFileSync(harness.configPath, "utf8"));
  assert.equal(binding.schemaVersion, 3);
  assert.equal(binding.status, "prepared");
  assert.equal(binding.publisherSha256, digest("new-host-generation"));
  assert.equal(binding.provisionerSha256, digest("new-provisioner-generation"));
  assert.equal(
    binding.nativePairSha256,
    releaseTagPublisherNativePairSha256(binding),
  );
  assert.deepEqual(
    harness.installs.map(({ target }) => target),
    [
      path.dirname(harness.hostPath),
      harness.provisionerPath,
      harness.configPath,
      harness.hostPath,
      harness.configPath,
    ],
  );
  assert.equal(value.nativePairSha256, binding.nativePairSha256);
});

test("native preparation always refuses schema 1 in-place migration", () => {
  const harness = createNativeInstallHarness();
  seedLegacyActiveNativePair(harness);
  harness.dependencies.keychainPresence = () => "present";
  const legacyBinding = readFileSync(harness.configPath, "utf8");

  assert.throws(
    () => prepareReleaseTagPublisher({ dependencies: harness.dependencies }),
    /never performed in place/,
  );
  assert.deepEqual(harness.installs, []);
  assert.equal(readFileSync(harness.configPath, "utf8"), legacyBinding);
  assert.equal(readFileSync(harness.hostPath, "utf8"), "old-host-generation");
  assert.equal(
    readFileSync(harness.provisionerPath, "utf8"),
    "old-unsafe-provisioner",
  );
});

test("schema 1 cutover preserves each retired inode and proves a later reboot", () => {
  const harness = createLegacyArchiveHarness();
  const archived = archiveLegacyReleaseTagPublisher({
    dependencies: harness.dependencies,
  });
  assert.equal(archived.manifest.status, "archived");
  assert.deepEqual(
    Object.fromEntries(
      archived.manifest.files.map((file) => [file.role, file.sha256]),
    ),
    liveLegacyDigests,
  );
  assert.equal(existsSync(harness.hostPath), false);
  assert.equal(existsSync(harness.provisionerPath), false);
  assert.equal(existsSync(harness.configPath), false);
  for (const file of archived.manifest.files) {
    const metadata = statSync(file.archivePath, { bigint: true });
    assert.equal(metadata.dev.toString(), file.device);
    assert.equal(metadata.ino.toString(), file.inode);
    assert.equal(metadata.nlink, 1n);
    assert.equal(metadata.mode & 0o777n, 0o400n);
  }
  assert.throws(
    () =>
      verifyLegacyReleaseTagPublisherRebootCutover({
        dependencies: harness.dependencies,
      }),
    /requires a verified reboot/,
  );
  harness.setBootId("BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB");
  const verified = verifyLegacyReleaseTagPublisherRebootCutover({
    dependencies: harness.dependencies,
  });
  assert.equal(verified.status, "reboot-verified");
  assert.equal(verified.preBootId, "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA");
  assert.equal(verified.postBootId, "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB");
  harness.setBootId("CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC");
  const laterBoot = verifyLegacyReleaseTagPublisherRebootCutover({
    dependencies: harness.dependencies,
  });
  assert.equal(laterBoot.postBootId, verified.postBootId);
});

test("schema 1 archive refuses a running legacy process or present credential", () => {
  const processHarness = createLegacyArchiveHarness();
  processHarness.setProcesses([4_242]);
  assert.throws(
    () =>
      archiveLegacyReleaseTagPublisher({
        dependencies: processHarness.dependencies,
      }),
    /still running/,
  );
  assert.equal(statSync(processHarness.hostPath).mode & 0o777, 0o555);

  const credentialHarness = createLegacyArchiveHarness();
  credentialHarness.setPresence("present");
  assert.throws(
    () =>
      archiveLegacyReleaseTagPublisher({
        dependencies: credentialHarness.dependencies,
      }),
    /cannot be archived while its Keychain item exists/,
  );
  assert.equal(statSync(credentialHarness.hostPath).mode & 0o777, 0o555);
});

test("schema 1 process fencing uses kernel text vnode identity across argv spoofing and rename", () => {
  const spoofHarness = createLegacyArchiveHarness();
  const hostMetadata = statSync(spoofHarness.hostPath, { bigint: true });
  const deviceHex = `0x${hostMetadata.dev.toString(16)}`;
  const parsed = parseReleaseTagPublisherTextVnodes(
    [
      "p4242",
      "ftxt",
      `D${deviceHex}`,
      `i${hostMetadata.ino}`,
      "n/usr/bin/harmless-looking-process",
      "",
    ].join("\n"),
  );
  assert.deepEqual(parsed, [
    {
      pid: 4_242,
      device: hostMetadata.dev.toString(),
      inode: hostMetadata.ino.toString(),
      path: "/usr/bin/harmless-looking-process",
    },
  ]);
  spoofHarness.setProcesses(parsed);
  assert.throws(
    () =>
      archiveLegacyReleaseTagPublisher({
        dependencies: spoofHarness.dependencies,
      }),
    /still running/,
  );

  const movedHarness = createLegacyArchiveHarness();
  const archived = archiveLegacyReleaseTagPublisher({
    dependencies: movedHarness.dependencies,
  });
  const movedHost = archived.manifest.files.find(
    ({ role }) => role === "publisher",
  );
  movedHarness.setProcesses([
    {
      pid: 7_777,
      device: movedHost.device,
      inode: movedHost.inode,
      path: movedHost.archivePath,
    },
  ]);
  movedHarness.setBootId("BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB");
  assert.throws(
    () =>
      verifyLegacyReleaseTagPublisherRebootCutover({
        dependencies: movedHarness.dependencies,
      }),
    /still running/,
  );
});

test(
  "macOS lsof identifies a running executable after argv spoofing and rename",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-lsof-vnode-")),
    );
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, "mapped-process.c");
    const executable = path.join(root, "mapped-process");
    const renamed = path.join(root, "mapped-process.retired");
    writeFileSync(
      source,
      [
        "#include <fcntl.h>",
        "#include <sys/mman.h>",
        "#include <sys/stat.h>",
        "#include <unistd.h>",
        "int main(int argc, char **argv) {",
        "  if (argc != 2) return 2;",
        "  int fd = open(argv[1], O_RDONLY);",
        "  struct stat metadata;",
        "  if (fd < 0 || fstat(fd, &metadata) != 0) return 3;",
        "  void *mapping = mmap(0, (size_t)metadata.st_size, PROT_READ | PROT_EXEC, MAP_PRIVATE, fd, 0);",
        "  (void)close(fd);",
        "  if (mapping == MAP_FAILED) return 4;",
        "  for (;;) pause();",
        "}",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    execFileSync(
      "/usr/bin/xcrun",
      ["--sdk", "macosx", "clang", source, "-o", executable],
      { cwd: root, stdio: "pipe" },
    );
    const mapped = statSync(executable, { bigint: true });
    renameSync(executable, renamed);
    assert.equal(existsSync(executable), false);
    const renamedMetadata = statSync(renamed, { bigint: true });
    assert.equal(renamedMetadata.dev, mapped.dev);
    assert.equal(renamedMetadata.ino, mapped.ino);
    const child = spawn(renamed, [renamed], {
      argv0: "/usr/bin/harmless-looking-process",
      cwd: root,
      stdio: "ignore",
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    try {
      const waitForMappedIdentity = async () => {
        let lastInventory = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          lastInventory = spawnSync(
            "/usr/sbin/lsof",
            [
              "-nP",
              "-a",
              "-p",
              String(child.pid),
              "-d",
              "txt",
              "-F",
              "pfnDi",
            ],
            { encoding: "utf8", maxBuffer: 32 * 1_024 * 1_024 },
          );
          if (lastInventory.status === 0) {
            const entry = parseReleaseTagPublisherTextVnodes(
              lastInventory.stdout,
            ).find(
              ({ pid, device, inode }) =>
                pid === child.pid &&
                device === mapped.dev.toString() &&
                inode === mapped.ino.toString(),
            );
            if (entry) return entry;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.fail(
          `lsof did not report the mapped executable identity: ${JSON.stringify({
            status: lastInventory?.status,
            stdout: lastInventory?.stdout,
            stderr: lastInventory?.stderr,
            childExitCode: child.exitCode,
            childSignalCode: child.signalCode,
            process: spawnSync(
              "/bin/ps",
              ["-p", String(child.pid), "-o", "command="],
              { encoding: "utf8" },
            ).stdout,
          })}`,
        );
      };
      const processResult = spawnSync(
        "/bin/ps",
        ["-p", String(child.pid), "-o", "command="],
        { encoding: "utf8" },
      );
      assert.equal(processResult.status, 0, processResult.stderr);
      assert.match(
        processResult.stdout.trim(),
        /^\/usr\/bin\/harmless-looking-process(?:\s|$)/,
      );
      const renamedEntry = await waitForMappedIdentity();
      assert.equal(renamedEntry.path, renamed);
    } finally {
      child.kill("SIGKILL");
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise((resolve) => child.once("close", resolve));
      }
    }
  },
);

test("post-reboot cutover rechecks processes and Keychain absence", () => {
  const harness = createLegacyArchiveHarness();
  archiveLegacyReleaseTagPublisher({ dependencies: harness.dependencies });
  harness.setBootId("BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB");
  harness.setProcesses([7_777]);
  assert.throws(
    () =>
      verifyLegacyReleaseTagPublisherRebootCutover({
        dependencies: harness.dependencies,
      }),
    /still running/,
  );
  harness.setProcesses([]);
  harness.setPresence("present");
  assert.throws(
    () =>
      verifyLegacyReleaseTagPublisherRebootCutover({
        dependencies: harness.dependencies,
      }),
    /reappeared after reboot/,
  );
});

for (const crashRole of ["binding", "publisher", "provisioner"]) {
  test(`schema 1 archive recovers response loss after retiring ${crashRole}`, () => {
    const harness = createLegacyArchiveHarness({
      crashAfterChmodRole: crashRole,
    });
    assert.throws(
      () =>
        archiveLegacyReleaseTagPublisher({
          dependencies: harness.dependencies,
        }),
      /injected chmod response loss/,
    );
    const recovered = archiveLegacyReleaseTagPublisher({
      dependencies: harness.dependencies,
    });
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.manifest.status, "archived");
  });

  test(`schema 1 archive recovers response loss after moving ${crashRole}`, () => {
    const harness = createLegacyArchiveHarness({
      crashAfterMoveRole: crashRole,
    });
    assert.throws(
      () =>
        archiveLegacyReleaseTagPublisher({
          dependencies: harness.dependencies,
        }),
      /injected response loss/,
    );
    const recovered = archiveLegacyReleaseTagPublisher({
      dependencies: harness.dependencies,
    });
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.manifest.status, "archived");
    assert.equal(
      recovered.manifest.files.every((file) => existsSync(file.archivePath)),
      true,
    );
  });
}

test("schema 1 archive rejects a multiply linked legacy executable", () => {
  const harness = createLegacyArchiveHarness();
  linkSync(harness.hostPath, `${harness.hostPath}.second-link`);
  assert.throws(
    () =>
      archiveLegacyReleaseTagPublisher({
        dependencies: harness.dependencies,
      }),
    /nlink or mode mismatch/,
  );
});

test("schema 1 archive rejects a different legacy native generation", () => {
  const harness = createLegacyArchiveHarness({
    legacyDigestOverrides: { provisioner: "0".repeat(64) },
  });
  assert.throws(
    () =>
      archiveLegacyReleaseTagPublisher({
        dependencies: harness.dependencies,
      }),
    /do not match the pinned live generation/,
  );
  assert.equal(
    harness.calls.some((call) => call.args?.[0] === "/bin/chmod"),
    false,
  );
});

test("retired descriptor admission preserves the fixed path containing spaces", () => {
  const filePath =
    "/Library/Application Support/Freed/release-tag-publisher-schema1-archive/release-tag-publisher.schema1";
  const file = {
    role: "publisher",
    device: "42",
    inode: "99",
    sha256: liveLegacyDigests.publisher,
  };
  const result = {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-retired-file-admission",
    path: filePath,
    device: file.device,
    inode: file.inode,
    uid: 0,
    gid: 0,
    mode: 0o400,
    nlink: 1,
    size: 4_096,
    sha256: file.sha256,
  };
  assert.deepEqual(
    parseReleaseTagPublisherRetiredAdmission(
      JSON.stringify(result),
      file,
      filePath,
      64 * 1_024 * 1_024,
    ),
    result,
  );
  assert.throws(
    () =>
      parseReleaseTagPublisherRetiredAdmission(
        JSON.stringify({ ...result, path: "/Library/Application" }),
        file,
        filePath,
        64 * 1_024 * 1_024,
      ),
    /admission result is malformed/,
  );
  assert.throws(
    () =>
      parseReleaseTagPublisherRetiredAdmission(
        JSON.stringify({ ...result, unexpected: true }),
        file,
        filePath,
        64 * 1_024 * 1_024,
      ),
    /admission result is malformed/,
  );
  assert.throws(
    () =>
      parseReleaseTagPublisherRetiredAdmission(
        JSON.stringify({ ...result, size: 64 * 1_024 * 1_024 + 1 }),
        file,
        filePath,
        64 * 1_024 * 1_024,
      ),
    /admission result is malformed/,
  );
});

test("native preparation retry recovers a host replacement interruption", () => {
  const harness = createNativeInstallHarness({
    failTarget: "host",
    failureCount: 1,
  });
  assert.throws(
    () => prepareReleaseTagPublisher({ dependencies: harness.dependencies }),
    /host installation failed/,
  );
  assert.equal(
    JSON.parse(readFileSync(harness.configPath, "utf8")).status,
    "preparing",
  );
  const recovered = prepareReleaseTagPublisher({
    dependencies: harness.dependencies,
  });
  const prepared = JSON.parse(readFileSync(harness.configPath, "utf8"));
  assert.equal(prepared.status, "prepared");
  assert.equal(recovered.nativePairSha256, prepared.nativePairSha256);
  assert.equal(
    digest(readFileSync(harness.hostPath)),
    prepared.publisherSha256,
  );
  assert.equal(
    digest(readFileSync(harness.provisionerPath)),
    prepared.provisionerSha256,
  );
});

test("activation promotes only the prepared pair and rejects later generation drift", () => {
  const harness = createNativeInstallHarness();
  prepareReleaseTagPublisher({ dependencies: harness.dependencies });
  const installRun = harness.dependencies.run;
  let hostAttestations = 0;
  let attestationOverrides = {};
  Object.assign(harness.dependencies, {
    authorizeRecovery() {},
    readInstalledConfig(filePath) {
      return JSON.parse(readFileSync(filePath, "utf8"));
    },
    run(executable, args, options) {
      if (executable !== harness.hostPath) {
        return installRun(executable, args, options);
      }
      hostAttestations += 1;
      const binding = JSON.parse(readFileSync(harness.configPath, "utf8"));
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          schemaVersion: 3,
          purpose: "freed-release-tag-publisher-readiness",
          repo: binding.repo,
          appId: binding.appId,
          appSlug: binding.appSlug,
          credentialMode: "short-lived-installation-token",
          operations: ["create-annotated-tag"],
          allowsArbitraryRefs: false,
          allowsUpdates: false,
          allowsDeletions: false,
          publisherSha256: binding.publisherSha256,
          publisherCdHash: binding.publisherCdHash,
          provisionerSha256: binding.provisionerSha256,
          provisionerCdHash: binding.provisionerCdHash,
          nativePairSha256: binding.nativePairSha256,
          ...attestationOverrides,
        }),
      };
    },
  });

  const activated = activateReleaseTagPublisher({
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    dependencies: harness.dependencies,
  });
  assert.equal(activated.recovered, false);
  assert.equal(
    JSON.parse(readFileSync(harness.configPath, "utf8")).status,
    "active",
  );
  assert.equal(hostAttestations, 1);

  const retried = activateReleaseTagPublisher({
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    dependencies: harness.dependencies,
  });
  assert.equal(retried.recovered, true);
  assert.equal(hostAttestations, 2);

  attestationOverrides = { provisionerSha256: "0".repeat(64) };
  assert.throws(
    () =>
      activateReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        dependencies: harness.dependencies,
      }),
    /attestation does not match the pinned short-lived annotated-tag publisher/,
  );
  assert.equal(hostAttestations, 3);
  attestationOverrides = {};

  chmodSync(harness.provisionerPath, 0o700);
  writeFileSync(harness.provisionerPath, "unexpected-provisioner-generation");
  assert.throws(
    () =>
      activateReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        dependencies: harness.dependencies,
      }),
    /native pair is mixed or incomplete/,
  );
  assert.equal(hostAttestations, 3);
});

test("installer verify accepts only a strict installation readiness envelope", () => {
  const base = {
    schemaVersion: 3,
    purpose: "freed-release-tag-publisher-binding",
    status: "active",
    repo: "freed-project/freed",
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    publisherPath:
      "/Library/Application Support/Freed/release-tag-publisher",
    publisherSha256: "a".repeat(64),
    publisherCdHash: "b".repeat(40),
    provisionerPath:
      "/Library/Application Support/Freed/release-tag-publisher-provision",
    provisionerSha256: "c".repeat(64),
    provisionerCdHash: "d".repeat(40),
  };
  const binding = {
    ...base,
    nativePairSha256: releaseTagPublisherNativePairSha256(base),
  };
  let readiness = installationReadiness();
  const dependencies = {
    hostPath: binding.publisherPath,
    provisionerPath: binding.provisionerPath,
    verifyInstalledNativePair: () => binding,
    run(executable, args) {
      if (executable === binding.provisionerPath && args[0] === "verify") {
        return { status: 0, stdout: result("verify"), stderr: "" };
      }
      if (
        executable === binding.publisherPath &&
        args[0] === "verify-installation"
      ) {
        return {
          status: 0,
          stdout: `${JSON.stringify(readiness)}\n`,
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: "unexpected action" };
    },
  };
  assert.deepEqual(
    verifyReleaseTagPublisher({ dependencies }).readiness,
    readiness,
  );
  for (const invalid of [
    installationReadiness({ appId: "4296969" }),
    installationReadiness({ appSlug: "Freed-Release-Publisher" }),
    installationReadiness({ unexpected: true }),
  ]) {
    readiness = invalid;
    assert.throws(
      () => verifyReleaseTagPublisher({ dependencies }),
      /does not match the dedicated selected-repository App contract/,
    );
  }
});

test("recovery admits one stable descriptor and activates after exact matching", () => {
  const harness = createHarness();
  const value = provisionReleaseTagPublisher({
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    privateKeyFile: privateKeyPath,
    dependencies: harness.dependencies,
  });
  assert.equal(value.credentialAction, "recovered");
  assert.equal(harness.prepared, 1);
  assert.equal(harness.activated, 1);
  assert.equal(harness.storedDigest, digest(privateKey));
  assert.deepEqual(
    harness.calls.filter((call) => call.args).map((call) => call.args[0]),
    ["recover", "matches"],
  );
  assert.deepEqual(harness.calls[0].authorization, {
    action: "release-tag-publisher.recover-existing-app",
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    privateKeySha256: digest(privateKey),
  });
  const recover = harness.calls.find((call) => call.args?.[0] === "recover");
  assert.equal(typeof recover.stdio[0], "number");
  assert.equal(
    recover.args[recover.args.indexOf("--expected-sha256") + 1],
    digest(privateKey),
  );
  assert.equal(
    harness.calls.some((call) => call.args?.includes(privateKey)),
    false,
  );
  assert.equal(
    harness.calls.some((call) => call.args?.[0] === "revoke"),
    false,
  );
});

test("installer rejects legacy or inexact provisioner result envelopes", () => {
  for (const mutate of [
    (value) => ({ ...value, schemaVersion: 1 }),
    (value) => ({ ...value, secret: "forbidden" }),
    (value) => ({ ...value, state: "present" }),
  ]) {
    const harness = createHarness();
    harness.dependencies.run = (_executable, args) => {
      const value = {
        schemaVersion: 2,
        purpose: "freed-release-tag-publisher-keychain-result",
        action: args[0],
        service: "freed-release-tag-publisher",
        account: "github-app-private-key",
        host: harness.dependencies.hostPath,
        changed: true,
      };
      return {
        status: 0,
        stdout: `${JSON.stringify(mutate(value))}\n`,
        stderr: "",
      };
    };
    assert.throws(
      () =>
        provisionReleaseTagPublisher({
          appId: 4_296_969,
          appSlug: "freed-release-publisher",
          privateKeyFile: privateKeyPath,
          dependencies: harness.dependencies,
        }),
      /invalid result envelope/,
    );
  }
});

test("recovery stays closed until exact owner confirmation is integrated", () => {
  let touched = false;
  assert.throws(
    () =>
      provisionReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        privateKeyFile: privateKeyPath,
        dependencies: {
          keychainPresence() {
            touched = true;
            return "missing";
          },
          prepareReleaseTagPublisher() {
            touched = true;
          },
          run() {
            touched = true;
            return { status: 1 };
          },
        },
      }),
    /credential mutation is unavailable until one-use kernel-attested owner authorization/,
  );
  assert.equal(touched, false);

  assert.throws(
    () =>
      discardReleaseTagPublisherRecovery({
        expectedSha256: digest(privateKey),
        dependencies: {
          run() {
            touched = true;
            return { status: 1 };
          },
        },
      }),
    /credential mutation is unavailable until one-use kernel-attested owner authorization/,
  );
  assert.equal(touched, false);

  for (const operation of [
    () =>
      rotateReleaseTagPublisher({
        privateKeyFile: privateKeyPath,
        dependencies: {
          run() {
            touched = true;
          },
        },
      }),
    () =>
      revokeReleaseTagPublisher({
        dependencies: {
          run() {
            touched = true;
          },
        },
      }),
    () =>
      activateReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        dependencies: {
          run() {
            touched = true;
          },
        },
      }),
  ]) {
    assert.throws(
      operation,
      /credential mutation is unavailable until one-use kernel-attested owner authorization/,
    );
  }
  assert.equal(touched, false);
});

test("activation failure retains the recovered key and the next run resumes", () => {
  const harness = createHarness({
    activationError: new Error("injected activation failure"),
  });
  assert.throws(
    () =>
      provisionReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        privateKeyFile: privateKeyPath,
        dependencies: harness.dependencies,
      }),
    /injected activation failure/,
  );
  assert.equal(harness.storedDigest, digest(privateKey));
  assert.equal(
    harness.calls.some((call) => call.args?.[0] === "revoke"),
    false,
  );

  harness.clearActivationError();
  const resumed = provisionReleaseTagPublisher({
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    privateKeyFile: privateKeyPath,
    dependencies: harness.dependencies,
  });
  assert.equal(resumed.credentialAction, "resumed");
  assert.equal(harness.prepared, 1);
  assert.equal(harness.activated, 2);
  assert.deepEqual(
    harness.calls.filter((call) => call.args).map((call) => call.args[0]),
    ["recover", "matches", "matches"],
  );
});

test("prepared credential recovery retries through the real binding loader after response loss", () => {
  const harness = createNativeInstallHarness();
  prepareReleaseTagPublisher({ dependencies: harness.dependencies });
  let storedDigest = null;
  let matches = 0;
  const installRun = harness.dependencies.run;
  harness.dependencies.authorizeRecovery = () => {};
  harness.dependencies.keychainPresence = () =>
    storedDigest === null ? "missing" : "present";
  harness.dependencies.run = (executable, args, options) => {
    if (executable === harness.provisionerPath) {
      const action = args[0];
      const digestIndex = args.indexOf("--expected-sha256");
      const expected = digestIndex < 0 ? null : args[digestIndex + 1];
      if (action === "recover") {
        const supplied = readFileSync(options.stdio[0]);
        storedDigest = digest(supplied);
        supplied.fill(0);
        assert.equal(storedDigest, expected);
        return {
          status: 0,
          stdout: result("recover", {
            changed: true,
            host: harness.hostPath,
          }),
          stderr: "",
        };
      }
      if (action === "matches") {
        matches += 1;
        assert.equal(storedDigest, expected);
        return {
          status: 0,
          stdout: result("matches", {
            matched: true,
            host: harness.hostPath,
          }),
          stderr: "",
        };
      }
    }
    if (executable === harness.hostPath && args[0] === "attest") {
      const binding = JSON.parse(readFileSync(harness.configPath, "utf8"));
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          schemaVersion: 3,
          purpose: "freed-release-tag-publisher-readiness",
          repo: binding.repo,
          appId: binding.appId,
          appSlug: binding.appSlug,
          credentialMode: "short-lived-installation-token",
          operations: ["create-annotated-tag"],
          allowsArbitraryRefs: false,
          allowsUpdates: false,
          allowsDeletions: false,
          publisherSha256: binding.publisherSha256,
          publisherCdHash: binding.publisherCdHash,
          provisionerSha256: binding.provisionerSha256,
          provisionerCdHash: binding.provisionerCdHash,
          nativePairSha256: binding.nativePairSha256,
        }),
      };
    }
    return installRun(executable, args, options);
  };
  harness.dependencies.prepareReleaseTagPublisher = () => ({
    action: "already-prepared",
  });
  harness.dependencies.activateReleaseTagPublisher = () => {
    throw new Error("injected activation response loss");
  };

  assert.throws(
    () =>
      provisionReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        privateKeyFile: privateKeyPath,
        dependencies: harness.dependencies,
      }),
    /injected activation response loss/,
  );
  const prepared = JSON.parse(readFileSync(harness.configPath, "utf8"));
  assert.equal(prepared.status, "prepared");
  assert.equal(storedDigest, digest(privateKey));

  delete harness.dependencies.activateReleaseTagPublisher;
  const preparing = { ...prepared, status: "preparing" };
  chmodSync(harness.configPath, 0o600);
  writeFileSync(
    harness.configPath,
    `${JSON.stringify(preparing, null, 2)}\n`,
  );
  chmodSync(harness.configPath, 0o444);
  assert.throws(
    () =>
      provisionReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        privateKeyFile: privateKeyPath,
        dependencies: harness.dependencies,
      }),
    /binding is missing or malformed/,
  );
  assert.equal(matches, 1);

  chmodSync(harness.configPath, 0o600);
  writeFileSync(
    harness.configPath,
    `${JSON.stringify(prepared, null, 2)}\n`,
  );
  chmodSync(harness.configPath, 0o444);
  const recovered = provisionReleaseTagPublisher({
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    privateKeyFile: privateKeyPath,
    dependencies: harness.dependencies,
  });
  assert.equal(recovered.credentialAction, "resumed");
  assert.equal(recovered.activated.binding.status, "active");
  assert.equal(
    JSON.parse(readFileSync(harness.configPath, "utf8")).status,
    "active",
  );
  assert.equal(matches, 2);
});

test("resume rejects a present credential with a different fingerprint", () => {
  const otherDigest = "f".repeat(64);
  const harness = createHarness({
    presence: "present",
    initialDigest: otherDigest,
  });
  assert.throws(
    () =>
      provisionReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        privateKeyFile: privateKeyPath,
        dependencies: harness.dependencies,
      }),
    /failed: digest mismatch/,
  );
  assert.equal(harness.storedDigest, otherDigest);
  assert.equal(harness.prepared, 0);
  assert.equal(harness.activated, 0);
  assert.deepEqual(
    harness.calls.filter((call) => call.args).map((call) => call.args[0]),
    ["matches"],
  );
  assert.equal(
    harness.calls.some((call) =>
      ["revoke", "discard-recovery"].includes(call.args?.[0]),
    ),
    false,
  );
});

test("recovery refuses unsafe file shapes before invoking the provisioner", () => {
  const cases = [];
  const permissive = path.join(fixtureRoot, "permissive.pem");
  writeFileSync(permissive, privateKey, { mode: 0o644 });
  cases.push(permissive);
  const linked = path.join(fixtureRoot, "linked.pem");
  linkSync(privateKeyPath, linked);
  cases.push(privateKeyPath);
  const symbolic = path.join(fixtureRoot, "symbolic.pem");
  symlinkSync(permissive, symbolic);
  cases.push(symbolic);

  for (const candidate of cases) {
    const harness = createHarness();
    assert.throws(
      () =>
        provisionReleaseTagPublisher({
          appId: 4_296_969,
          appSlug: "freed-release-publisher",
          privateKeyFile: candidate,
          dependencies: harness.dependencies,
        }),
      /private key/i,
    );
    assert.equal(harness.calls.filter((call) => call.args).length, 0);
  }
  rmSync(linked);
});

test("recovery rejects a swapped path before any provisioner call", () => {
  const candidate = path.join(fixtureRoot, "swap-source.pem");
  const displaced = path.join(fixtureRoot, "swap-displaced.pem");
  writeFileSync(candidate, privateKey, { mode: 0o600 });
  const harness = createHarness();
  harness.dependencies.keychainPresence = () => {
    renameSync(candidate, displaced);
    writeFileSync(candidate, privateKey, { mode: 0o600 });
    return "missing";
  };
  assert.throws(
    () =>
      provisionReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        privateKeyFile: candidate,
        dependencies: harness.dependencies,
      }),
    /path changed/,
  );
  assert.equal(harness.calls.filter((call) => call.args).length, 0);
  assert.equal(harness.storedDigest, null);
  assert.equal(harness.prepared, 0);
});

test("recovery rejects a FIFO without blocking or invoking the provisioner", () => {
  const fifo = path.join(fixtureRoot, "private-key.fifo");
  execFileSync("/usr/bin/mkfifo", [fifo]);
  chmodSync(fifo, 0o600);
  const installerUrl = new URL(
    "./release-tag-publisher-install.mjs",
    import.meta.url,
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
          import { provisionReleaseTagPublisher } from ${JSON.stringify(installerUrl)};
          try {
            provisionReleaseTagPublisher({
              appId: 4296969,
              appSlug: "freed-release-publisher",
              privateKeyFile: ${JSON.stringify(fifo)},
              dependencies: {
                keychainPresence: () => "missing",
                prepareReleaseTagPublisher: () => { throw new Error("unexpected prepare"); },
                run: () => { throw new Error("unexpected provisioner"); },
              },
            });
            process.exitCode = 2;
          } catch (error) {
            process.stderr.write(String(error?.message ?? error));
          }
        `,
    ],
    { encoding: "utf8", timeout: 5_000 },
  );
  assert.equal(child.error?.code, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stderr, /private key file/i);
  const source = readFileSync(
    new URL("./release-tag-publisher-install.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /constants\.O_NONBLOCK/);
});
