#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RELEASE_TAG_PUBLISHER_APP_ID as RELEASE_GITHUB_APP_ID,
  RELEASE_TAG_PUBLISHER_APP_SLUG as RELEASE_GITHUB_APP_SLUG,
  RELEASE_TAG_PUBLISHER_BINDING_PURPOSE,
  RELEASE_TAG_PUBLISHER_BINDING_SCHEMA_VERSION,
  RELEASE_TAG_PUBLISHER_REPO,
  releaseTagPublisherNativePairSha256,
  verifyReleaseTagPublisherBindingShape,
} from "./lib/release-tag-publisher-binding.mjs";
import {
  verifyReleaseTagPublisherInstallationReadiness,
  verifyReleaseTagPublisherReadiness,
} from "./lib/release-tag-publisher.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

export const RELEASE_TAG_PUBLISHER_DIRECTORY =
  "/Library/Application Support/Freed";
export const RELEASE_TAG_PUBLISHER_HOST = path.join(
  RELEASE_TAG_PUBLISHER_DIRECTORY,
  "release-tag-publisher",
);
export const RELEASE_TAG_PUBLISHER_PROVISIONER = path.join(
  RELEASE_TAG_PUBLISHER_DIRECTORY,
  "release-tag-publisher-provision",
);
export const RELEASE_TAG_PUBLISHER_CONFIG = path.join(
  RELEASE_TAG_PUBLISHER_DIRECTORY,
  "release-tag-publisher.json",
);
const RELEASE_TAG_PUBLISHER_LEGACY_ARCHIVE_DIRECTORY = path.join(
  RELEASE_TAG_PUBLISHER_DIRECTORY,
  "release-tag-publisher-schema1-archive",
);
const RELEASE_TAG_PUBLISHER_LEGACY_ARCHIVE_MANIFEST = path.join(
  RELEASE_TAG_PUBLISHER_LEGACY_ARCHIVE_DIRECTORY,
  "cutover.json",
);
const RELEASE_TAG_PUBLISHER_KEYCHAIN_SERVICE = "freed-release-tag-publisher";
const RELEASE_TAG_PUBLISHER_KEYCHAIN_ACCOUNT = "github-app-private-key";
const RELEASE_TAG_PUBLISHER_SCHEMA_ONE_SHA256 = Object.freeze({
  binding: "f4138e23afff5bd9ac97dcc14ef0e2623f1640ffa91bea45eb5cd0edebe28127",
  publisher: "22d6f6065364d1c7a38baf0f4881cb60f5509dbb4de8d5c55bd2f38e45a38fe9",
  provisioner:
    "fe3057b658cd9e0815f57de9ed5adf2683b3ec2d69560ac9a8a18b1e92073934",
});
const MAXIMUM_PRIVATE_KEY_BYTES = 32 * 1_024;
const MAXIMUM_BINDING_BYTES = 64 * 1_024;
const RELEASE_TAG_PUBLISHER_NATIVE_TIMEOUT_MS = 30_000;
const DARWIN_O_CLOEXEC = 0x01000000;
const PRIVILEGED_RETIRED_FILE_ADMISSION = String.raw`
import hashlib
import json
import os
import stat
import sys

path, maximum_text, expected_device, expected_inode, expected_sha256 = sys.argv[1:]
maximum = int(maximum_text)
if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_CLOEXEC"):
    raise RuntimeError("required retired publisher admission flags are unavailable")
flags = os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC
descriptor = os.open(path, flags)

def identity(value):
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_uid,
        value.st_gid,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )

try:
    link_before = os.stat(path, follow_symlinks=False)
    before = os.fstat(descriptor)
    if (
        not stat.S_ISREG(link_before.st_mode)
        or not stat.S_ISREG(before.st_mode)
        or identity(link_before) != identity(before)
        or before.st_uid != 0
        or before.st_gid != 0
        or before.st_nlink != 1
        or stat.S_IMODE(before.st_mode) != 0o400
        or before.st_size <= 0
        or before.st_size > maximum
        or str(before.st_dev) != expected_device
        or str(before.st_ino) != expected_inode
    ):
        raise RuntimeError("retired publisher file metadata mismatch")
    digest = hashlib.sha256()
    remaining = before.st_size
    while remaining > 0:
        chunk = os.read(descriptor, min(65536, remaining))
        if not chunk:
            raise RuntimeError("retired publisher file ended early")
        digest.update(chunk)
        remaining -= len(chunk)
    if os.read(descriptor, 1):
        raise RuntimeError("retired publisher file grew during admission")
    after = os.fstat(descriptor)
    link_after = os.stat(path, follow_symlinks=False)
    actual_sha256 = digest.hexdigest()
    if (
        identity(before) != identity(after)
        or identity(after) != identity(link_after)
        or actual_sha256 != expected_sha256
    ):
        raise RuntimeError("retired publisher file changed during admission")
    print(json.dumps({
        "device": str(after.st_dev),
        "gid": after.st_gid,
        "inode": str(after.st_ino),
        "mode": stat.S_IMODE(after.st_mode),
        "nlink": after.st_nlink,
        "path": path,
        "purpose": "freed-release-tag-publisher-retired-file-admission",
        "schemaVersion": 1,
        "sha256": actual_sha256,
        "size": after.st_size,
        "uid": after.st_uid,
    }, sort_keys=True, separators=(",", ":")))
finally:
    os.close(descriptor)
`;

class InstallerError extends Error {}

function fail(message) {
  throw new InstallerError(message);
}

function defaultDependencies() {
  return {
    repoRoot: REPO_ROOT,
    tempRoot: os.tmpdir(),
    buildScript: path.join(
      REPO_ROOT,
      "scripts",
      "release-tag-publisher-build.sh",
    ),
    hostPath: RELEASE_TAG_PUBLISHER_HOST,
    provisionerPath: RELEASE_TAG_PUBLISHER_PROVISIONER,
    configPath: RELEASE_TAG_PUBLISHER_CONFIG,
    archiveDirectory: RELEASE_TAG_PUBLISHER_LEGACY_ARCHIVE_DIRECTORY,
    archiveManifestPath: RELEASE_TAG_PUBLISHER_LEGACY_ARCHIVE_MANIFEST,
    run: spawnSync,
    readInstalledConfig: inspectInstalledConfig,
    authorizeRecovery() {
      fail(
        "Release Publisher credential mutation is unavailable until one-use kernel-attested owner authorization and staged GitHub identity proof are integrated.",
      );
    },
  };
}

function dependenciesWith(overrides = {}) {
  return { ...defaultDependencies(), ...overrides };
}

function runChecked(dependencies, executable, args, options = {}) {
  const result = dependencies.run(executable, args, {
    cwd: options.cwd ?? dependencies.repoRoot,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio,
    input: options.input,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
    timeout: options.timeout,
    env: {
      HOME: process.env.HOME ?? "",
      PATH: "/usr/bin:/bin",
    },
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr ?? "").trim();
    fail(
      `${options.purpose ?? executable} failed${detail ? `: ${detail}` : "."}`,
    );
  }
  return String(result.stdout ?? "").trim();
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function currentBootId(dependencies) {
  if (typeof dependencies.bootId === "function") {
    const value = dependencies.bootId();
    if (!/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(value)) {
      fail("The injected macOS boot session ID is invalid.");
    }
    return value;
  }
  const value = runChecked(
    dependencies,
    "/usr/sbin/sysctl",
    ["-n", "kern.bootsessionuuid"],
    { purpose: "macOS boot session inspection" },
  );
  if (!/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(value)) {
    fail("The macOS boot session ID is unavailable.");
  }
  return value;
}

export function parseReleaseTagPublisherTextVnodes(output) {
  if (typeof output !== "string" || output.length > 32 * 1_024 * 1_024) {
    fail("The publisher text vnode inventory is invalid.");
  }
  const entries = [];
  let pid = null;
  let text = null;
  const finish = () => {
    if (text === null) return;
    if (
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      text.device === null ||
      text.inode === null
    ) {
      fail("The publisher text vnode inventory is malformed.");
    }
    entries.push({
      pid,
      device: text.device,
      inode: text.inode,
      path: text.path,
    });
    text = null;
  };
  for (const line of output.split("\n")) {
    if (line === "") continue;
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      finish();
      if (!/^[1-9][0-9]{0,9}$/.test(value)) {
        fail("The publisher text vnode inventory contains an invalid PID.");
      }
      pid = Number(value);
      continue;
    }
    if (field === "f") {
      finish();
      if (value !== "txt" || pid === null) {
        fail("The publisher text vnode inventory contains an invalid descriptor.");
      }
      text = { device: null, inode: null, path: null };
      continue;
    }
    if (text === null || !["D", "i", "n"].includes(field)) {
      fail("The publisher text vnode inventory contains an unsupported field.");
    }
    if (field === "D") {
      if (!/^0x[0-9a-f]+$/.test(value) || text.device !== null) {
        fail("The publisher text vnode inventory contains an invalid device.");
      }
      text.device = BigInt(value).toString();
    } else if (field === "i") {
      if (!/^[1-9][0-9]*$/.test(value) || text.inode !== null) {
        fail("The publisher text vnode inventory contains an invalid inode.");
      }
      text.inode = value;
    } else {
      if (text.path !== null || value.includes("\0")) {
        fail("The publisher text vnode inventory contains an invalid path.");
      }
      text.path = value;
    }
  }
  finish();
  return entries;
}

function assertNoLegacyPublisherProcesses(dependencies, files) {
  const executableFiles = files.filter(({ role }) => role !== "binding");
  if (executableFiles.length !== 2) {
    fail("The legacy publisher executable identity set is invalid.");
  }
  let entries;
  if (typeof dependencies.publisherTextVnodes === "function") {
    entries = dependencies.publisherTextVnodes();
    if (
      !Array.isArray(entries) ||
      !entries.every(
        (entry) =>
          entry !== null &&
          typeof entry === "object" &&
          Number.isSafeInteger(entry.pid) &&
          entry.pid > 0 &&
          /^[1-9][0-9]*$/.test(entry.device) &&
          /^[1-9][0-9]*$/.test(entry.inode) &&
          (entry.path === null || typeof entry.path === "string"),
      )
    ) {
      fail("The injected publisher text vnode inventory is invalid.");
    }
  } else {
    const output = runChecked(
      dependencies,
      "/usr/bin/sudo",
      ["/usr/sbin/lsof", "-nP", "-d", "txt", "-F", "pfnDi"],
      {
        purpose: "legacy release publisher kernel text vnode inspection",
        maxBuffer: 32 * 1_024 * 1_024,
      },
    );
    entries = parseReleaseTagPublisherTextVnodes(output);
  }
  const identities = new Set(
    executableFiles.map(({ device, inode }) => `${device}:${inode}`),
  );
  if (entries.some(({ device, inode }) => identities.has(`${device}:${inode}`))) {
    fail("A legacy release publisher process is still running.");
  }
}

function inspectLegacySource(
  dependencies,
  filePath,
  { executable, archived = false },
) {
  if (typeof dependencies.inspectLegacySource === "function") {
    return dependencies.inspectLegacySource(filePath, { executable, archived });
  }
  let descriptor;
  try {
    if (!path.isAbsolute(filePath) || realpathSync(filePath) !== filePath) {
      fail("A legacy publisher source path is not canonical.");
    }
    const link = lstatSync(filePath, { bigint: true });
    descriptor = openSync(
      filePath,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (constants.O_CLOEXEC ?? DARWIN_O_CLOEXEC),
    );
    const before = fstatSync(descriptor, { bigint: true });
    const maximum = BigInt(
      executable ? 64 * 1_024 * 1_024 : MAXIMUM_BINDING_BYTES,
    );
    const expectedMode = archived ? 0o400n : executable ? 0o555n : 0o444n;
    if (
      !link.isFile() ||
      !before.isFile() ||
      link.dev !== before.dev ||
      link.ino !== before.ino ||
      before.uid !== 0n ||
      before.gid !== 0n ||
      before.nlink !== 1n ||
      (before.mode & 0o777n) !== expectedMode ||
      before.size <= 0n ||
      before.size > maximum
    ) {
      fail("A legacy publisher source is not one exact root-owned file.");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mode !== after.mode ||
      before.uid !== after.uid ||
      before.gid !== after.gid ||
      before.nlink !== after.nlink ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      fail("A legacy publisher source changed during admission.");
    }
    return {
      device: before.dev.toString(),
      inode: before.ino.toString(),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (error instanceof InstallerError) throw error;
    fail("A legacy publisher source could not be admitted safely.");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function staticCodeHash(dependencies, filePath) {
  if (typeof dependencies.codeHash === "function") {
    const value = dependencies.codeHash(filePath);
    if (!/^[0-9a-f]{40,64}$/.test(value)) {
      fail("The injected publisher CDHash is invalid.");
    }
    return value;
  }
  const result = dependencies.run(
    "/usr/bin/codesign",
    ["-d", "--verbose=4", filePath],
    {
      cwd: dependencies.repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { HOME: process.env.HOME ?? "", PATH: "/usr/bin:/bin" },
    },
  );
  const matches =
    String(result.stderr ?? "").match(/^CDHash=([0-9a-f]{40,64})$/gm) ?? [];
  if (result.error || result.status !== 0 || matches.length !== 1) {
    fail("The publisher static code CDHash could not be inspected safely.");
  }
  return matches[0].slice("CDHash=".length);
}

function inspectInstalledHost(filePath) {
  if (!path.isAbsolute(filePath) || realpathSync(filePath) !== filePath) {
    fail("The installed publisher host must use a canonical absolute path.");
  }
  const link = lstatSync(filePath);
  const metadata = statSync(filePath);
  if (
    link.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    metadata.uid !== 0 ||
    (metadata.mode & 0o022) !== 0 ||
    (metadata.mode & 0o111) === 0
  ) {
    fail(
      "The installed publisher host is not a root-owned immutable executable.",
    );
  }
  return filePath;
}

function inspectInstalledConfig(filePath) {
  let descriptor;
  let bytes;
  try {
    if (!path.isAbsolute(filePath) || realpathSync(filePath) !== filePath) {
      fail(
        "The installed publisher binding must use a canonical absolute path.",
      );
    }
    const link = lstatSync(filePath, { bigint: true });
    descriptor = openSync(
      filePath,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (constants.O_CLOEXEC ?? DARWIN_O_CLOEXEC),
    );
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !link.isFile() ||
      !before.isFile() ||
      link.dev !== before.dev ||
      link.ino !== before.ino ||
      before.uid !== 0n ||
      before.gid !== 0n ||
      before.nlink !== 1n ||
      (before.mode & 0o777n) !== 0o444n ||
      before.size <= 0n ||
      before.size > BigInt(MAXIMUM_BINDING_BYTES)
    ) {
      fail("The installed publisher binding is not an exact root-owned file.");
    }
    const expectedSize = Number(before.size);
    bytes = Buffer.alloc(expectedSize + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (
      offset !== expectedSize ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mode !== after.mode ||
      before.uid !== after.uid ||
      before.gid !== after.gid ||
      before.nlink !== after.nlink ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      fail("The installed publisher binding changed during admission.");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, expectedSize),
    );
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof InstallerError) throw error;
    fail("The installed publisher binding could not be admitted safely.");
  } finally {
    bytes?.fill(0);
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function withPrivateDirectory(dependencies, operation) {
  const created = mkdtempSync(
    path.join(dependencies.tempRoot, "freed-release-tag-publisher-"),
  );
  const directory = realpathSync(created);
  chmodSync(directory, 0o700);
  try {
    return operation(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function sudoInstall(dependencies, args, purpose) {
  runChecked(dependencies, "/usr/bin/sudo", ["/usr/bin/install", ...args], {
    purpose,
  });
}

function nativePairBinding(
  dependencies,
  {
    status,
    publisherSha256,
    publisherCdHash,
    provisionerSha256,
    provisionerCdHash,
  },
) {
  const binding = {
    schemaVersion: RELEASE_TAG_PUBLISHER_BINDING_SCHEMA_VERSION,
    purpose: RELEASE_TAG_PUBLISHER_BINDING_PURPOSE,
    status,
    repo: RELEASE_TAG_PUBLISHER_REPO,
    appId: RELEASE_GITHUB_APP_ID,
    appSlug: RELEASE_GITHUB_APP_SLUG,
    publisherPath: dependencies.hostPath,
    publisherSha256,
    publisherCdHash,
    provisionerPath: dependencies.provisionerPath,
    provisionerSha256,
    provisionerCdHash,
  };
  return {
    ...binding,
    nativePairSha256: releaseTagPublisherNativePairSha256(binding),
  };
}

function installBinding(dependencies, directory, binding, purpose) {
  const source = path.join(
    directory,
    `release-tag-publisher.${binding.status}.json`,
  );
  writeFileSync(source, `${JSON.stringify(binding, null, 2)}\n`, {
    mode: 0o600,
  });
  sudoInstall(
    dependencies,
    [
      "-S",
      "-o",
      "root",
      "-g",
      "wheel",
      "-m",
      "0444",
      source,
      dependencies.configPath,
    ],
    purpose,
  );
}

function legacyArchivePaths(dependencies) {
  return {
    publisher: path.join(
      dependencies.archiveDirectory,
      "release-tag-publisher.schema1",
    ),
    provisioner: path.join(
      dependencies.archiveDirectory,
      "release-tag-publisher-provision.schema1",
    ),
    binding: path.join(
      dependencies.archiveDirectory,
      "release-tag-publisher.schema1.json",
    ),
  };
}

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function verifyLegacySchemaOneBinding(binding, dependencies) {
  const keys = [
    "appId",
    "appSlug",
    "publisherPath",
    "publisherSha256",
    "purpose",
    "repo",
    "schemaVersion",
    "status",
  ];
  if (
    !hasExactKeys(binding, keys) ||
    binding.schemaVersion !== 1 ||
    binding.purpose !== RELEASE_TAG_PUBLISHER_BINDING_PURPOSE ||
    binding.status !== "active" ||
    binding.repo !== RELEASE_TAG_PUBLISHER_REPO ||
    binding.appId !== RELEASE_GITHUB_APP_ID ||
    binding.appSlug !== RELEASE_GITHUB_APP_SLUG ||
    binding.publisherPath !== dependencies.hostPath ||
    !/^[0-9a-f]{64}$/.test(binding.publisherSha256)
  ) {
    fail(
      "The installed schema 1 release publisher binding is not the exact legacy contract.",
    );
  }
  return binding;
}

function verifyLegacyArchiveManifest(manifest, dependencies) {
  if (
    !hasExactKeys(manifest, [
      "files",
      "postBootId",
      "preBootId",
      "purpose",
      "schemaVersion",
      "status",
    ]) ||
    manifest.schemaVersion !== 1 ||
    manifest.purpose !== "freed-release-tag-publisher-schema1-cutover" ||
    !["planned", "archived", "reboot-verified"].includes(manifest.status) ||
    !/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(manifest.preBootId) ||
    !(
      manifest.postBootId === null ||
      /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(manifest.postBootId)
    ) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 3
  ) {
    fail("The schema 1 publisher cutover record is malformed.");
  }
  const expected = legacyArchivePaths(dependencies);
  const byRole = new Map(manifest.files.map((file) => [file?.role, file]));
  for (const [role, sourcePath, archivePath] of [
    ["binding", dependencies.configPath, expected.binding],
    ["provisioner", dependencies.provisionerPath, expected.provisioner],
    ["publisher", dependencies.hostPath, expected.publisher],
  ]) {
    const file = byRole.get(role);
    if (
      !hasExactKeys(file, [
        "archivePath",
        "device",
        "inode",
        "role",
        "sha256",
        "sourcePath",
      ]) ||
      file.sourcePath !== sourcePath ||
      file.archivePath !== archivePath ||
      !/^[1-9][0-9]*$/.test(file.device) ||
      !/^[1-9][0-9]*$/.test(file.inode) ||
      !/^[0-9a-f]{64}$/.test(file.sha256)
    ) {
      fail("The schema 1 publisher cutover file record is malformed.");
    }
  }
  if (
    ["planned", "archived"].includes(manifest.status) !==
      (manifest.postBootId === null) ||
    (manifest.status === "reboot-verified" &&
      manifest.postBootId === manifest.preBootId)
  ) {
    fail("The schema 1 publisher cutover boot record is inconsistent.");
  }
  return manifest;
}

export function parseReleaseTagPublisherRetiredAdmission(
  output,
  file,
  filePath,
  maximumBytes,
) {
  let value;
  try {
    value = typeof output === "string" ? JSON.parse(output) : output;
  } catch {
    fail("A retired publisher file admission result is malformed.");
  }
  if (
    !hasExactKeys(value, [
      "device",
      "gid",
      "inode",
      "mode",
      "nlink",
      "path",
      "purpose",
      "schemaVersion",
      "sha256",
      "size",
      "uid",
    ]) ||
    value.schemaVersion !== 1 ||
    value.purpose !== "freed-release-tag-publisher-retired-file-admission" ||
    value.path !== filePath ||
    value.device !== file.device ||
    value.inode !== file.inode ||
    value.uid !== 0 ||
    value.gid !== 0 ||
    value.mode !== 0o400 ||
    value.nlink !== 1 ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > maximumBytes ||
    value.sha256 !== file.sha256
  ) {
    fail("A retired publisher file admission result is malformed.");
  }
  return value;
}

function inspectRetiredFile(dependencies, file, filePath) {
  const maximumBytes =
    file.role === "binding" ? MAXIMUM_BINDING_BYTES : 64 * 1_024 * 1_024;
  if (typeof dependencies.inspectRetiredFile === "function") {
    return parseReleaseTagPublisherRetiredAdmission(
      dependencies.inspectRetiredFile(file, filePath, maximumBytes),
      file,
      filePath,
      maximumBytes,
    );
  }
  const output = runChecked(
    dependencies,
    "/usr/bin/sudo",
    [
      "/usr/bin/python3",
      "-I",
      "-c",
      PRIVILEGED_RETIRED_FILE_ADMISSION,
      filePath,
      String(maximumBytes),
      file.device,
      file.inode,
      file.sha256,
    ],
    {
      purpose: "legacy publisher retired file descriptor admission",
      maxBuffer: MAXIMUM_BINDING_BYTES,
    },
  );
  return parseReleaseTagPublisherRetiredAdmission(
    output,
    file,
    filePath,
    maximumBytes,
  );
}

function archiveFilesystemDevice(dependencies) {
  if (typeof dependencies.archiveDevice === "function") {
    const value = dependencies.archiveDevice();
    if (!/^[1-9][0-9]*$/.test(value)) {
      fail("The injected publisher archive filesystem device is invalid.");
    }
    return value;
  }
  const value = runChecked(
    dependencies,
    "/usr/bin/sudo",
    ["/usr/bin/stat", "-f", "%d", dependencies.archiveDirectory],
    { purpose: "legacy publisher archive filesystem verification" },
  );
  if (!/^[1-9][0-9]*$/.test(value)) {
    fail("The publisher archive filesystem device is invalid.");
  }
  return value;
}

function privilegedPathExists(dependencies, filePath) {
  if (typeof dependencies.pathExists === "function") {
    return dependencies.pathExists(filePath);
  }
  const result = dependencies.run(
    "/usr/bin/sudo",
    ["/usr/bin/test", "-e", filePath],
    {
      cwd: dependencies.repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { HOME: process.env.HOME ?? "", PATH: "/usr/bin:/bin" },
    },
  );
  if (!result.error && result.status === 0) return true;
  if (!result.error && result.status === 1) return false;
  fail("A publisher cutover path could not be inspected safely.");
}

function readLegacyArchiveManifest(dependencies) {
  if (typeof dependencies.readArchiveManifest === "function") {
    return verifyLegacyArchiveManifest(
      dependencies.readArchiveManifest(dependencies.archiveManifestPath),
      dependencies,
    );
  }
  const metadata = runChecked(
    dependencies,
    "/usr/bin/sudo",
    ["/usr/bin/stat", "-f", "%u:%g:%Lp:%l", dependencies.archiveManifestPath],
    { purpose: "legacy publisher cutover record metadata admission" },
  );
  if (metadata !== "0:0:400:1") {
    fail("The schema 1 publisher cutover record is not one root-only file.");
  }
  const text = runChecked(
    dependencies,
    "/usr/bin/sudo",
    ["/bin/cat", dependencies.archiveManifestPath],
    {
      purpose: "legacy publisher cutover record admission",
      maxBuffer: MAXIMUM_BINDING_BYTES,
    },
  );
  return verifyLegacyArchiveManifest(JSON.parse(text), dependencies);
}

function installArchiveManifest(dependencies, directory, manifest) {
  const source = path.join(directory, "cutover.json");
  writeFileSync(source, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  sudoInstall(
    dependencies,
    [
      "-S",
      "-o",
      "root",
      "-g",
      "wheel",
      "-m",
      "0400",
      source,
      dependencies.archiveManifestPath,
    ],
    "legacy publisher cutover record installation",
  );
}

export function archiveLegacyReleaseTagPublisher({
  dependencies: overrides,
} = {}) {
  const dependencies = dependenciesWith(overrides);
  dependencies.authorizeRecovery({
    action: "release-tag-publisher.archive-schema1-for-reboot-cutover",
    appId: RELEASE_GITHUB_APP_ID,
    appSlug: RELEASE_GITHUB_APP_SLUG,
    repo: RELEASE_TAG_PUBLISHER_REPO,
  });
  if (inspectKeychainPresence(dependencies) !== "missing") {
    fail(
      "The schema 1 publisher cannot be archived while its Keychain item exists.",
    );
  }
  let manifest;
  const existingManifest = privilegedPathExists(
    dependencies,
    dependencies.archiveManifestPath,
  );
  if (existingManifest) {
    manifest = readLegacyArchiveManifest(dependencies);
  } else {
    const legacy = verifyLegacySchemaOneBinding(
      dependencies.readInstalledConfig(dependencies.configPath),
      dependencies,
    );
    const archive = legacyArchivePaths(dependencies);
    const files = [
      {
        role: "binding",
        sourcePath: dependencies.configPath,
        archivePath: archive.binding,
        ...inspectLegacySource(dependencies, dependencies.configPath, {
          executable: false,
        }),
      },
      {
        role: "provisioner",
        sourcePath: dependencies.provisionerPath,
        archivePath: archive.provisioner,
        ...inspectLegacySource(dependencies, dependencies.provisionerPath, {
          executable: true,
        }),
      },
      {
        role: "publisher",
        sourcePath: dependencies.hostPath,
        archivePath: archive.publisher,
        ...inspectLegacySource(dependencies, dependencies.hostPath, {
          executable: true,
        }),
      },
    ];
    if (
      files.some(
        (file) =>
          file.sha256 !== RELEASE_TAG_PUBLISHER_SCHEMA_ONE_SHA256[file.role],
      )
    ) {
      fail(
        "The installed schema 1 publisher files do not match the pinned live generation.",
      );
    }
    if (
      files.find((file) => file.role === "publisher").sha256 !==
      legacy.publisherSha256
    ) {
      fail(
        "The schema 1 publisher executable does not match its legacy binding.",
      );
    }
    manifest = verifyLegacyArchiveManifest(
      {
        schemaVersion: 1,
        purpose: "freed-release-tag-publisher-schema1-cutover",
        status: "planned",
        preBootId: currentBootId(dependencies),
        postBootId: null,
        files,
      },
      dependencies,
    );
  }
  assertNoLegacyPublisherProcesses(dependencies, manifest.files);
  return withPrivateDirectory(dependencies, (directory) => {
    sudoInstall(
      dependencies,
      [
        "-d",
        "-o",
        "root",
        "-g",
        "wheel",
        "-m",
        "0700",
        dependencies.archiveDirectory,
      ],
      "legacy publisher archive directory installation",
    );
    if (!existingManifest) {
      installArchiveManifest(dependencies, directory, manifest);
    }
    const archiveDevice = archiveFilesystemDevice(dependencies);
    if (!manifest.files.every((file) => file.device === archiveDevice)) {
      fail("The schema 1 publisher archive must be on the same filesystem.");
    }
    for (const file of manifest.files) {
      const sourceExists = privilegedPathExists(dependencies, file.sourcePath);
      const archiveExists = privilegedPathExists(
        dependencies,
        file.archivePath,
      );
      if (sourceExists && archiveExists) {
        fail(
          "A schema 1 publisher inode exists at both live and archive paths.",
        );
      }
      if (sourceExists) {
        runChecked(
          dependencies,
          "/usr/bin/sudo",
          ["/bin/chmod", "0400", file.sourcePath],
          { purpose: `legacy publisher ${file.role} execution retirement` },
        );
        inspectRetiredFile(dependencies, file, file.sourcePath);
        assertNoLegacyPublisherProcesses(dependencies, manifest.files);
        runChecked(
          dependencies,
          "/usr/bin/sudo",
          ["/bin/mv", file.sourcePath, file.archivePath],
          { purpose: `legacy publisher ${file.role} inode archival` },
        );
      } else if (!archiveExists) {
        fail(
          "A schema 1 publisher inode is missing from both live and archive paths.",
        );
      }
      inspectRetiredFile(dependencies, file, file.archivePath);
    }
    assertNoLegacyPublisherProcesses(dependencies, manifest.files);
    const archived =
      manifest.status === "planned"
        ? { ...manifest, status: "archived", postBootId: null }
        : manifest;
    if (manifest.status === "planned") {
      installArchiveManifest(dependencies, directory, archived);
    }
    return {
      action: "archive-schema1",
      recovered: existingManifest,
      manifest: archived,
    };
  });
}

export function verifyLegacyReleaseTagPublisherRebootCutover({
  dependencies: overrides,
} = {}) {
  const dependencies = dependenciesWith(overrides);
  const manifest = readLegacyArchiveManifest(dependencies);
  if (manifest.status === "planned") {
    fail(
      "The schema 1 publisher archive is incomplete and must be recovered before reboot cutover.",
    );
  }
  const bootId = currentBootId(dependencies);
  if (bootId === manifest.preBootId) {
    fail("The schema 1 publisher cutover requires a verified reboot.");
  }
  assertNoLegacyPublisherProcesses(dependencies, manifest.files);
  if (inspectKeychainPresence(dependencies) !== "missing") {
    fail("The release publisher Keychain item reappeared after reboot.");
  }
  if (
    [
      dependencies.configPath,
      dependencies.hostPath,
      dependencies.provisionerPath,
    ].some((filePath) => privilegedPathExists(dependencies, filePath))
  ) {
    fail("A retired schema 1 publisher fixed path reappeared after reboot.");
  }
  for (const file of manifest.files) {
    inspectRetiredFile(dependencies, file, file.archivePath);
  }
  const verified = {
    ...manifest,
    status: "reboot-verified",
    postBootId: manifest.postBootId ?? bootId,
  };
  if (manifest.status === "archived") {
    withPrivateDirectory(dependencies, (directory) => {
      installArchiveManifest(dependencies, directory, verified);
    });
  }
  return verified;
}

export function prepareReleaseTagPublisher({ dependencies: overrides } = {}) {
  const dependencies = dependenciesWith(overrides);
  if (existsSync(dependencies.configPath)) {
    const installed = dependencies.readInstalledConfig(dependencies.configPath);
    if (installed?.schemaVersion === 1) {
      fail(
        "Schema 1 release publisher migration is never performed in place. Run the separately authorized archive-schema1 operation, reboot, then retry preparation.",
      );
    }
    verifyReleaseTagPublisherBindingShape(installed, {
      statuses: ["preparing", "prepared", "active"],
    });
  }
  if (existsSync(dependencies.archiveDirectory)) {
    verifyLegacyReleaseTagPublisherRebootCutover({ dependencies });
  }
  if (inspectKeychainPresence(dependencies) !== "missing") {
    fail(
      "Release publisher native migration requires the credential to be absent; an existing credential needs a separate owner-governed migration.",
    );
  }
  return withPrivateDirectory(dependencies, (directory) => {
    const hostOutput = path.join(directory, "release-tag-publisher");
    const provisionerOutput = path.join(
      directory,
      "release-tag-publisher-provision",
    );
    runChecked(
      dependencies,
      "/bin/bash",
      [
        dependencies.buildScript,
        "--host-output",
        hostOutput,
        "--provisioner-output",
        provisionerOutput,
      ],
      { purpose: "Release tag publisher native build" },
    );
    const publisherSha256 = sha256File(hostOutput);
    const provisionerSha256 = sha256File(provisionerOutput);
    const publisherCdHash = staticCodeHash(dependencies, hostOutput);
    const provisionerCdHash = staticCodeHash(dependencies, provisionerOutput);
    sudoInstall(
      dependencies,
      [
        "-d",
        "-o",
        "root",
        "-g",
        "wheel",
        "-m",
        "0755",
        path.dirname(dependencies.hostPath),
      ],
      "Release tag publisher directory installation",
    );
    sudoInstall(
      dependencies,
      [
        "-S",
        "-o",
        "root",
        "-g",
        "wheel",
        "-m",
        "0555",
        provisionerOutput,
        dependencies.provisionerPath,
      ],
      "Release tag publisher lockdown provisioner installation",
    );
    if (
      sha256File(dependencies.provisionerPath) !== provisionerSha256 ||
      staticCodeHash(dependencies, dependencies.provisionerPath) !==
        provisionerCdHash
    ) {
      fail(
        "The installed lockdown provisioner digest does not match its build.",
      );
    }
    const preparingBinding = nativePairBinding(dependencies, {
      status: "preparing",
      publisherSha256,
      publisherCdHash,
      provisionerSha256,
      provisionerCdHash,
    });
    installBinding(
      dependencies,
      directory,
      preparingBinding,
      "Release tag publisher fail-closed native cutover binding installation",
    );
    sudoInstall(
      dependencies,
      [
        "-S",
        "-o",
        "root",
        "-g",
        "wheel",
        "-m",
        "0555",
        hostOutput,
        dependencies.hostPath,
      ],
      "Release tag publisher host installation",
    );
    if (
      sha256File(dependencies.hostPath) !== publisherSha256 ||
      sha256File(dependencies.provisionerPath) !== provisionerSha256 ||
      staticCodeHash(dependencies, dependencies.hostPath) !== publisherCdHash ||
      staticCodeHash(dependencies, dependencies.provisionerPath) !==
        provisionerCdHash
    ) {
      fail(
        "The installed release publisher native pair is mixed or incomplete.",
      );
    }
    const preparedBinding = {
      ...preparingBinding,
      status: "prepared",
    };
    installBinding(
      dependencies,
      directory,
      preparedBinding,
      "Release tag publisher prepared native pair binding installation",
    );
    return {
      action: "prepare",
      hostPath: dependencies.hostPath,
      provisionerPath: dependencies.provisionerPath,
      publisherSha256,
      publisherCdHash,
      provisionerSha256,
      provisionerCdHash,
      nativePairSha256: preparedBinding.nativePairSha256,
    };
  });
}

function loadInstalledBinding(dependencies, statuses) {
  const binding = dependencies.readInstalledConfig(dependencies.configPath);
  verifyReleaseTagPublisherBindingShape(binding, { statuses });
  if (
    binding.publisherPath !== dependencies.hostPath ||
    binding.provisionerPath !== dependencies.provisionerPath
  ) {
    fail(
      "The installed publisher binding does not use the fixed native paths.",
    );
  }
  return binding;
}

function verifyInstalledNativePair(dependencies, binding) {
  requireInstalledExecutable(dependencies, binding.publisherPath);
  requireInstalledExecutable(dependencies, binding.provisionerPath);
  const publisherSha256 = sha256File(binding.publisherPath);
  const provisionerSha256 = sha256File(binding.provisionerPath);
  const publisherCdHash = staticCodeHash(dependencies, binding.publisherPath);
  const provisionerCdHash = staticCodeHash(
    dependencies,
    binding.provisionerPath,
  );
  if (
    publisherSha256 !== binding.publisherSha256 ||
    provisionerSha256 !== binding.provisionerSha256 ||
    publisherCdHash !== binding.publisherCdHash ||
    provisionerCdHash !== binding.provisionerCdHash
  ) {
    fail("The installed release publisher native pair is mixed or incomplete.");
  }
  return {
    publisherSha256,
    publisherCdHash,
    provisionerSha256,
    provisionerCdHash,
  };
}

function requireBoundNativePair(dependencies, statuses = ["active"]) {
  if (typeof dependencies.verifyInstalledNativePair === "function") {
    return dependencies.verifyInstalledNativePair({ statuses });
  }
  const binding = loadInstalledBinding(dependencies, statuses);
  verifyInstalledNativePair(dependencies, binding);
  return binding;
}

function validateAppIdentity(appId, appSlug) {
  const numericId =
    typeof appId === "number"
      ? appId
      : typeof appId === "string" && /^[1-9][0-9]*$/.test(appId)
        ? Number(appId)
        : Number.NaN;
  if (numericId !== RELEASE_GITHUB_APP_ID) {
    fail("The release GitHub App ID must match the dedicated publisher App.");
  }
  if (appSlug !== RELEASE_GITHUB_APP_SLUG) {
    fail("The release GitHub App slug must match the dedicated publisher App.");
  }
  return { appId: numericId, appSlug };
}

export function activateReleaseTagPublisher({
  appId,
  appSlug,
  dependencies: overrides,
}) {
  const dependencies = dependenciesWith(overrides);
  const identity = validateAppIdentity(appId, appSlug);
  dependencies.authorizeRecovery({
    action: "release-tag-publisher.activate-existing-credential",
    appId: identity.appId,
    appSlug: identity.appSlug,
    repo: "freed-project/freed",
  });
  const prepared = loadInstalledBinding(dependencies, ["prepared", "active"]);
  verifyInstalledNativePair(dependencies, prepared);
  const recovered = prepared.status === "active";
  const binding = recovered ? prepared : { ...prepared, status: "active" };
  if (!recovered) {
    withPrivateDirectory(dependencies, (directory) => {
      installBinding(
        dependencies,
        directory,
        binding,
        "Release tag publisher active native pair binding installation",
      );
    });
  }
  const attestation = JSON.parse(
    runChecked(
      dependencies,
      dependencies.hostPath,
      [
        "attest",
        "--repo",
        binding.repo,
        "--app-id",
        String(binding.appId),
        "--app-slug",
        binding.appSlug,
      ],
      { purpose: "Release tag publisher local attestation" },
    ),
  );
  verifyReleaseTagPublisherReadiness(attestation, {
    repo: binding.repo,
    releaseAppId: binding.appId,
    releaseAppSlug: binding.appSlug,
    publisherDigest: binding.publisherSha256,
    publisherCdHash: binding.publisherCdHash,
    provisionerDigest: binding.provisionerSha256,
    provisionerCdHash: binding.provisionerCdHash,
    nativePairDigest: binding.nativePairSha256,
  });
  return {
    action: "activate",
    recovered,
    binding,
    attestation,
  };
}

function privateKeyMetadataIdentity(metadata) {
  return [
    metadata.dev,
    metadata.ino,
    metadata.mode,
    metadata.uid,
    metadata.gid,
    metadata.nlink,
    metadata.size,
    metadata.mtimeNs,
    metadata.ctimeNs,
  ].join(":");
}

function validatePrivateKeyMetadata(metadata) {
  const currentUser = process.getuid?.();
  if (
    !metadata.isFile() ||
    !Number.isSafeInteger(currentUser) ||
    metadata.uid !== BigInt(currentUser) ||
    (metadata.mode & 0o777n) !== 0o600n ||
    metadata.nlink !== 1n ||
    metadata.size <= 0n ||
    metadata.size > BigInt(MAXIMUM_PRIVATE_KEY_BYTES)
  ) {
    fail(
      "The private key file must be one current-user-owned mode 0600 regular file with exactly one link and a bounded size.",
    );
  }
}

function validatePrivateKeyPathIdentity(filePath, descriptorMetadata) {
  if (!path.isAbsolute(filePath) || realpathSync(filePath) !== filePath) {
    fail("The private key file must use a canonical absolute path.");
  }
  const link = lstatSync(filePath, { bigint: true });
  if (
    link.isSymbolicLink() ||
    link.dev !== descriptorMetadata.dev ||
    link.ino !== descriptorMetadata.ino
  ) {
    fail("The private key path changed while it was being admitted.");
  }
}

function admitPrivateKeyFile(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    fail("The private key file must use a canonical absolute path.");
  }
  let descriptor;
  let bytes;
  let overflow;
  try {
    descriptor = openSync(
      filePath,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (constants.O_CLOEXEC ?? DARWIN_O_CLOEXEC),
    );
    const initial = fstatSync(descriptor, { bigint: true });
    validatePrivateKeyMetadata(initial);
    validatePrivateKeyPathIdentity(filePath, initial);
    bytes = Buffer.alloc(Number(initial.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count === 0) {
        fail("The private key file changed while it was being read.");
      }
      offset += count;
    }
    overflow = Buffer.alloc(1);
    if (readSync(descriptor, overflow, 0, 1, bytes.length) !== 0) {
      fail("The private key file grew while it was being read.");
    }
    overflow.fill(0);
    overflow = undefined;
    const admittedIdentity = privateKeyMetadataIdentity(initial);
    const assertUnchanged = () => {
      const current = fstatSync(descriptor, { bigint: true });
      validatePrivateKeyMetadata(current);
      validatePrivateKeyPathIdentity(filePath, current);
      if (privateKeyMetadataIdentity(current) !== admittedIdentity) {
        fail("The private key file changed after admission.");
      }
    };
    assertUnchanged();
    const digest = createHash("sha256").update(bytes).digest("hex");
    bytes.fill(0);
    bytes = undefined;
    return { descriptor, digest, assertUnchanged };
  } catch (error) {
    bytes?.fill(0);
    overflow?.fill(0);
    if (descriptor !== undefined) closeSync(descriptor);
    if (error instanceof InstallerError) throw error;
    fail("The private key file could not be admitted safely.");
  }
}

function withAdmittedPrivateKey(filePath, operation) {
  const admission = admitPrivateKeyFile(filePath);
  try {
    return operation(admission);
  } finally {
    closeSync(admission.descriptor);
  }
}

function inspectKeychainPresence(dependencies) {
  if (typeof dependencies.keychainPresence === "function") {
    const presence = dependencies.keychainPresence();
    if (!["missing", "present"].includes(presence)) {
      fail("The injected publisher Keychain presence result is invalid.");
    }
    return presence;
  }
  const result = dependencies.run(
    "/usr/bin/security",
    [
      "find-generic-password",
      "-s",
      RELEASE_TAG_PUBLISHER_KEYCHAIN_SERVICE,
      "-a",
      RELEASE_TAG_PUBLISHER_KEYCHAIN_ACCOUNT,
    ],
    {
      cwd: dependencies.repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        HOME: process.env.HOME ?? "",
        PATH: "/usr/bin:/bin",
      },
    },
  );
  if (!result.error && result.status === 0) return "present";
  if (!result.error && result.status === 44) return "missing";
  fail("The release publisher Keychain item could not be inspected safely.");
}

function requireInstalledExecutable(dependencies, filePath) {
  const inspect = dependencies.inspectInstalledHost ?? inspectInstalledHost;
  return inspect(filePath);
}

function invokeProvisioner(
  dependencies,
  action,
  { descriptor = null, expectedSha256 = null } = {},
) {
  const args = [action, "--host", dependencies.hostPath];
  if (expectedSha256 !== null) {
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
      fail("The expected release App key digest is invalid.");
    }
    args.push("--expected-sha256", expectedSha256);
  }
  const output = runChecked(dependencies, dependencies.provisionerPath, args, {
    purpose: `Release tag publisher key ${action}`,
    stdio: [descriptor ?? "ignore", "pipe", "pipe"],
    timeout: RELEASE_TAG_PUBLISHER_NATIVE_TIMEOUT_MS,
  });
  try {
    const result = JSON.parse(output);
    const actionFields = {
      inspect: ["state"],
      matches: ["matched"],
      verify: [],
      provision: ["changed"],
      recover: ["changed"],
      rotate: ["changed"],
      "discard-recovery": ["changed"],
      revoke: ["changed"],
    }[action];
    if (
      !actionFields ||
      !hasExactKeys(result, [
        "account",
        "action",
        "host",
        "purpose",
        "schemaVersion",
        "service",
        ...actionFields,
      ]) ||
      result.schemaVersion !== 2 ||
      result?.purpose !== "freed-release-tag-publisher-keychain-result" ||
      result.action !== action ||
      result.service !== RELEASE_TAG_PUBLISHER_KEYCHAIN_SERVICE ||
      result.account !== RELEASE_TAG_PUBLISHER_KEYCHAIN_ACCOUNT ||
      result.host !== dependencies.hostPath ||
      (actionFields.includes("state") &&
        !["missing", "present"].includes(result.state)) ||
      (actionFields.includes("matched") && result.matched !== true) ||
      (actionFields.includes("changed") && typeof result.changed !== "boolean")
    ) {
      fail("The publisher provisioner returned an invalid result envelope.");
    }
    return result;
  } catch (error) {
    if (error instanceof InstallerError) throw error;
    fail("The publisher provisioner returned invalid JSON.");
  }
}

export function provisionReleaseTagPublisher({
  appId,
  appSlug,
  privateKeyFile,
  dependencies: overrides,
}) {
  const dependencies = dependenciesWith(overrides);
  const identity = validateAppIdentity(appId, appSlug);
  return withAdmittedPrivateKey(privateKeyFile, (admission) => {
    dependencies.authorizeRecovery({
      action: "release-tag-publisher.recover-existing-app",
      appId: identity.appId,
      appSlug: identity.appSlug,
      privateKeySha256: admission.digest,
    });
    admission.assertUnchanged();
    const presence = inspectKeychainPresence(dependencies);
    admission.assertUnchanged();
    let prepared = null;
    let credentialAction = "resumed";
    if (presence === "missing") {
      prepared =
        typeof dependencies.prepareReleaseTagPublisher === "function"
          ? dependencies.prepareReleaseTagPublisher()
          : prepareReleaseTagPublisher({ dependencies });
      admission.assertUnchanged();
      invokeProvisioner(dependencies, "recover", {
        descriptor: admission.descriptor,
        expectedSha256: admission.digest,
      });
      admission.assertUnchanged();
      credentialAction = "recovered";
    } else {
      requireBoundNativePair(dependencies, ["prepared", "active"]);
    }
    admission.assertUnchanged();
    invokeProvisioner(dependencies, "matches", {
      expectedSha256: admission.digest,
    });
    admission.assertUnchanged();
    const activated =
      typeof dependencies.activateReleaseTagPublisher === "function"
        ? dependencies.activateReleaseTagPublisher(identity)
        : activateReleaseTagPublisher({
            ...identity,
            dependencies,
          });
    return {
      action: "provision",
      credentialAction,
      prepared,
      activated,
    };
  });
}

export function verifyReleaseTagPublisher({ dependencies: overrides } = {}) {
  const dependencies = dependenciesWith(overrides);
  const binding = requireBoundNativePair(dependencies);
  invokeProvisioner(dependencies, "verify");
  const readiness = runChecked(
    dependencies,
    dependencies.hostPath,
    [
      "verify-installation",
      "--repo",
      binding.repo,
      "--app-id",
      String(binding.appId),
      "--app-slug",
      binding.appSlug,
    ],
    {
      purpose: "Release tag publisher installation verification",
      timeout: RELEASE_TAG_PUBLISHER_NATIVE_TIMEOUT_MS,
    },
  );
  let attestation;
  try {
    attestation = JSON.parse(readiness);
  } catch {
    fail("Release tag publisher installation verification returned invalid JSON.");
  }
  verifyReleaseTagPublisherInstallationReadiness(attestation, {
    repo: binding.repo,
    releaseAppId: binding.appId,
    releaseAppSlug: binding.appSlug,
  });
  return { action: "verify", readiness: attestation };
}

export function rotateReleaseTagPublisher({
  privateKeyFile,
  dependencies: overrides,
}) {
  const dependencies = dependenciesWith(overrides);
  return withAdmittedPrivateKey(privateKeyFile, (admission) => {
    dependencies.authorizeRecovery({
      action: "release-tag-publisher.rotate-staged-key",
      privateKeySha256: admission.digest,
    });
    requireBoundNativePair(dependencies);
    admission.assertUnchanged();
    invokeProvisioner(dependencies, "rotate", {
      descriptor: admission.descriptor,
      expectedSha256: admission.digest,
    });
    admission.assertUnchanged();
    return { action: "rotate" };
  });
}

export function inspectReleaseTagPublisherCredential({
  dependencies: overrides,
} = {}) {
  const dependencies = dependenciesWith(overrides);
  requireBoundNativePair(dependencies);
  const result = invokeProvisioner(dependencies, "inspect");
  return { action: "inspect", state: result.state };
}

export function discardReleaseTagPublisherRecovery({
  expectedSha256,
  dependencies: overrides,
}) {
  const dependencies = dependenciesWith(overrides);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    fail("The expected release App key digest is invalid.");
  }
  dependencies.authorizeRecovery({
    action: "release-tag-publisher.discard-staged-key",
    privateKeySha256: expectedSha256,
  });
  requireBoundNativePair(dependencies);
  const result = invokeProvisioner(dependencies, "discard-recovery", {
    expectedSha256,
  });
  return { action: "discard-recovery", changed: result.changed };
}

export function revokeReleaseTagPublisher({ dependencies: overrides } = {}) {
  const dependencies = dependenciesWith(overrides);
  dependencies.authorizeRecovery({
    action: "release-tag-publisher.revoke-active-credential",
    appId: RELEASE_GITHUB_APP_ID,
    appSlug: RELEASE_GITHUB_APP_SLUG,
    repo: "freed-project/freed",
  });
  requireBoundNativePair(dependencies);
  invokeProvisioner(dependencies, "revoke");
  runChecked(
    dependencies,
    "/usr/bin/sudo",
    ["/bin/rm", "-f", dependencies.configPath],
    { purpose: "Release tag publisher binding revocation" },
  );
  return { action: "revoke" };
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (
      ![
        "--app-id",
        "--app-slug",
        "--private-key-file",
        "--expected-sha256",
      ].includes(flag)
    ) {
      fail(`Unknown installer option: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || options[flag] !== undefined) {
      fail(`Installer option ${flag} requires one value and may appear once.`);
    }
    options[flag] = value;
    index += 1;
  }
  return options;
}

function requireOptionSet(options, required) {
  const actual = Object.keys(options).sort();
  const expected = [...required].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`This installer action requires exactly: ${expected.join(", ")}.`);
  }
}

function main(argv) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  let result;
  switch (command) {
    case "archive-schema1":
      if (rest.length !== 0) fail("archive-schema1 accepts no options.");
      result = archiveLegacyReleaseTagPublisher();
      break;
    case "prepare":
      if (rest.length !== 0) fail("prepare accepts no options.");
      result = prepareReleaseTagPublisher();
      break;
    case "activate":
      requireOptionSet(options, ["--app-id", "--app-slug"]);
      result = activateReleaseTagPublisher({
        appId: options["--app-id"],
        appSlug: options["--app-slug"],
      });
      break;
    case "provision":
    case "recover":
      requireOptionSet(options, [
        "--app-id",
        "--app-slug",
        "--private-key-file",
      ]);
      result = provisionReleaseTagPublisher({
        appId: options["--app-id"],
        appSlug: options["--app-slug"],
        privateKeyFile: options["--private-key-file"],
      });
      break;
    case "verify":
      if (rest.length !== 0) fail("verify accepts no options.");
      result = verifyReleaseTagPublisher();
      break;
    case "rotate":
      requireOptionSet(options, ["--private-key-file"]);
      result = rotateReleaseTagPublisher({
        privateKeyFile: options["--private-key-file"],
      });
      break;
    case "inspect":
      if (rest.length !== 0) fail("inspect accepts no options.");
      result = inspectReleaseTagPublisherCredential();
      break;
    case "discard-recovery":
      requireOptionSet(options, ["--expected-sha256"]);
      result = discardReleaseTagPublisherRecovery({
        expectedSha256: options["--expected-sha256"],
      });
      break;
    case "revoke":
      if (rest.length !== 0) fail("revoke accepts no options.");
      result = revokeReleaseTagPublisher();
      break;
    default:
      fail(
        "Usage: node scripts/release-tag-publisher-install.mjs <archive-schema1|prepare|activate|provision|recover|inspect|verify|rotate|discard-recovery|revoke> [options]",
      );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] === __filename) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
