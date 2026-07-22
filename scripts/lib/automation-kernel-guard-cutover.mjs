import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import {
  AutomationControlError,
  framePinnedLeaseArchiveHelperInvocation,
  ownerGovernanceIntentDigest,
  processStartIdentity,
  readPinnedLeaseArchiveHelperSource,
  validateCurrentTaskOwnerConfirmation,
  withKernelFileGuard,
} from "./automation-control.mjs";
import {
  AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
  AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
  AUTOMATION_KERNEL_GUARD_MARKER_DIGEST,
  AUTOMATION_KERNEL_GUARD_NAMES,
  automationKernelGuardSnapshotNativeTreeDigest,
  automationKernelGuardCutoverPaths,
  automationKernelGuardMarkerBytes,
  canonicalAutomationKernelGuardReceiptBytes,
  inspectAutomationKernelGuardCanonicalTaskSource,
  inspectAutomationKernelGuardFilesystemPaths,
  inspectAutomationKernelGuardCutover,
} from "./automation-kernel-guard-contract.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CUTOVER_SCHEMA_VERSION = 1;
const CUTOVER_ACTION = "automation-guard.cutover";
const CUTOVER_PLAN_KIND = "automation-kernel-guard-cutover-plan";
const CUTOVER_TRANSACTION_KIND = "automation-kernel-guard-cutover-transaction";
const CUTOVER_SUPERSEDE_ACTION = "automation-guard.cutover.supersede";
const CUTOVER_SUPERSEDE_PLAN_KIND =
  "automation-kernel-guard-cutover-supersede-plan";
const CUTOVER_SUPERSEDE_RECEIPT_KIND =
  "automation-kernel-guard-cutover-superseded-receipt";
const CUTOVER_CLAIM_PROTOCOL = "freed-kernel-guard-cutover-claim-v1";
const CUTOVER_WRITE_AHEAD_KIND = "automation-kernel-guard-cutover-write-ahead";
const CUTOVER_WRITE_AHEAD_MAX_BYTES =
  AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES;
const CUTOVER_MAX_CLAIM_GENERATIONS = 64;
const CUTOVER_MAX_AUTHORIZATIONS = 64;
const CUTOVER_TRANSACTION_MAX_BYTES = 8 * 1024 * 1024;
const CUTOVER_SNAPSHOT_MAX_ENTRIES = 4_096;
const CUTOVER_SNAPSHOT_MAX_DEPTH = 64;
const CUTOVER_SNAPSHOT_MAX_AGGREGATE_BYTES =
  AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES;
const CUTOVER_NATIVE_MOVE_HELPER_SHA256 =
  "d23a65379acad43c7fb601d65fc150c29f1d214796121362f2a44c7e6c305a3e";
const CUTOVER_NATIVE_MOVE_PYTHON = "/usr/bin/python3";
const LEASE_TRANSACTION_DIRECTORY = ".transactions";
const LEASE_TRANSACTION_RECEIPT_DIRECTORY = ".transaction-receipts";
const LEASE_STATE_QUARANTINE_DIRECTORY = ".lease-state-quarantine";
const LEASE_CLEANUP_QUARANTINE_DIRECTORY = ".lease-cleanup-quarantine";
const CUTOVER_PRIVATE_FILE_CREATE_HELPER_SOURCE = String.raw`
import hashlib
import json
import os
import stat
import sys

PROTOCOL = "freed-kernel-guard-private-file-create-v1"

def fail(message):
    sys.stderr.write("kernel-guard-private-file-create: " + message + "\n")
    raise SystemExit(1)

def integer(value, label):
    try:
        parsed = int(value, 10)
    except ValueError:
        fail(label + " is not an integer")
    if parsed < 0:
        fail(label + " is negative")
    return parsed

def digest(descriptor, size):
    value = hashlib.sha256()
    offset = 0
    while offset < size:
        chunk = os.pread(descriptor, min(65536, size - offset), offset)
        if not chunk:
            fail("source changed size")
        value.update(chunk)
        offset += len(chunk)
    if os.pread(descriptor, 1, size):
        fail("source grew")
    return value.hexdigest()

def require_directory(expected_device, expected_inode):
    value = os.fstat(3)
    if (
        not stat.S_ISDIR(value.st_mode)
        or value.st_dev != expected_device
        or value.st_ino != expected_inode
        or value.st_uid != os.getuid()
        or stat.S_IMODE(value.st_mode) != 0o700
    ):
        fail("destination directory changed generation")
    return value

def require_source(expected_device, expected_inode, expected_size, expected_digest):
    value = os.fstat(4)
    if (
        not stat.S_ISREG(value.st_mode)
        or value.st_dev != expected_device
        or value.st_ino != expected_inode
        or value.st_uid != os.getuid()
        or stat.S_IMODE(value.st_mode) != 0o600
        or value.st_nlink != 2
        or value.st_size != expected_size
        or digest(4, expected_size) != expected_digest
    ):
        fail("source file changed generation")
    return value

def require_destination(descriptor, name, source_size):
    opened = os.fstat(descriptor)
    try:
        named = os.stat(name, dir_fd=3, follow_symlinks=False)
    except OSError as error:
        fail("replacement pathname cannot be inspected: " + error.strerror)
    if (
        not stat.S_ISREG(opened.st_mode)
        or opened.st_dev != named.st_dev
        or opened.st_ino != named.st_ino
        or opened.st_uid != os.getuid()
        or stat.S_IMODE(opened.st_mode) != 0o600
        or opened.st_nlink != 1
        or opened.st_size < 0
        or opened.st_size > source_size
    ):
        fail("replacement changed generation")
    current = os.pread(descriptor, opened.st_size + 1, 0)
    expected = os.pread(4, opened.st_size, 0)
    if len(current) != opened.st_size or current != expected:
        fail("replacement is not an exact source prefix")
    return opened

def pause(checkpoint, name):
    if os.environ.get("FREED_REPAIR_MOVE_TEST_PAUSE") != checkpoint:
        return
    operation = os.environ.get("FREED_REPAIR_MOVE_TEST_OPERATION")
    destination = os.environ.get("FREED_REPAIR_MOVE_TEST_DESTINATION")
    if operation and operation != "create-private-durable":
        return
    if destination and destination != name:
        return
    os.write(7, (checkpoint + "\n").encode("ascii"))
    if os.read(6, 1) != b"1":
        fail("test pause was not released")

if len(sys.argv) != 8:
    fail("expected one destination and six generation fields")
name = sys.argv[1]
if not name or name in (".", "..") or "/" in name or "\x00" in name:
    fail("destination is not one entry")
directory_device = integer(sys.argv[2], "directory device")
directory_inode = integer(sys.argv[3], "directory inode")
source_device = integer(sys.argv[4], "source device")
source_inode = integer(sys.argv[5], "source inode")
source_size = integer(sys.argv[6], "source size")
source_digest = sys.argv[7]
if len(source_digest) != 64 or any(value not in "0123456789abcdef" for value in source_digest):
    fail("source digest is invalid")
require_directory(directory_device, directory_inode)
require_source(source_device, source_inode, source_size, source_digest)
pause("before-create-syscall", name)
require_directory(directory_device, directory_inode)
require_source(source_device, source_inode, source_size, source_digest)
descriptor = None
try:
    try:
        descriptor = os.open(
            name,
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=3,
        )
    except FileExistsError:
        descriptor = os.open(
            name,
            os.O_RDWR | os.O_NOFOLLOW,
            dir_fd=3,
        )
    opened = require_destination(descriptor, name, source_size)
    pause("after-create-before-copy", name)
    require_directory(directory_device, directory_inode)
    require_source(source_device, source_inode, source_size, source_digest)
    opened = require_destination(descriptor, name, source_size)
    offset = opened.st_size
    copy_paused = False
    while offset < source_size:
        chunk = os.pread(4, min(4096, source_size - offset), offset)
        if not chunk:
            fail("source changed while copying")
        written = 0
        while written < len(chunk):
            count = os.pwrite(descriptor, chunk[written:], offset + written)
            if count <= 0:
                fail("replacement write did not progress")
            written += count
        offset += len(chunk)
        require_destination(descriptor, name, source_size)
        if not copy_paused:
            pause("during-copy", name)
            copy_paused = True
            require_directory(directory_device, directory_inode)
            require_source(source_device, source_inode, source_size, source_digest)
            require_destination(descriptor, name, source_size)
    os.fchmod(descriptor, 0o600)
    pause("after-copy-before-file-sync", name)
    require_directory(directory_device, directory_inode)
    require_source(source_device, source_inode, source_size, source_digest)
    require_destination(descriptor, name, source_size)
    os.fsync(descriptor)
    pause("after-file-sync-before-directory-sync", name)
    require_directory(directory_device, directory_inode)
    require_source(source_device, source_inode, source_size, source_digest)
    opened = require_destination(descriptor, name, source_size)
    if (
        opened.st_size != source_size
        or digest(descriptor, source_size) != source_digest
    ):
        fail("replacement changed before durability")
    pause("before-directory-sync", name)
    require_directory(directory_device, directory_inode)
    require_destination(descriptor, name, source_size)
    os.fsync(3)
    pause("after-directory-sync", name)
    require_directory(directory_device, directory_inode)
    durable = require_destination(descriptor, name, source_size)
    if durable.st_dev != opened.st_dev or durable.st_ino != opened.st_ino:
        fail("replacement pathname changed")
    sys.stdout.write(json.dumps({
        "protocol": PROTOCOL,
        "device": str(opened.st_dev),
        "inode": str(opened.st_ino),
        "size": str(opened.st_size),
        "digest": source_digest,
    }, sort_keys=True, separators=(",", ":")))
finally:
    if descriptor is not None:
        os.close(descriptor)
`;
const CUTOVER_AUTHORIZATION_KEYS = Object.freeze(
  [
    "actor",
    "confirmationArtifact",
    "confirmationBytesBase64",
    "confirmationDigest",
    "confirmationId",
    "confirmationPath",
    "confirmationRawDigest",
    "intentDigest",
    "validatedAt",
  ].sort(),
);
const CUTOVER_MAX_FILE_BYTES = 128 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ACTOR_IDS = Object.freeze([
  "freed-runtime-observer",
  "freed-stability-controller",
  "freed-scaffolding-maintainer",
  "freed-nightly-runner",
  "freed-release-verifier",
]);
const CONTROL_PROCESS_PATTERNS = Object.freeze([
  "scripts/automation-control.mjs",
  "scripts/automation-actors.mjs",
  "scripts/nightly-self-improve.mjs",
  "scripts/outcome-ledger-repair.mjs",
  "scripts/record-outcome.mjs",
]);
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });

function fail(code, message, details = undefined) {
  throw new AutomationControlError(code, message, details);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${stableJson(value)}\n`, "utf8");
}

function deepFreezeJson(value) {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

function immutableCanonicalJsonValue(value, code, message) {
  try {
    return deepFreezeJson(
      JSON.parse(fatalDecoder.decode(canonicalJsonBytes(value))),
    );
  } catch (error) {
    if (error instanceof AutomationControlError) throw error;
    fail(code, message);
  }
}

function prettyJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function assertAutomationKernelGuardCutoverPlanSize(
  bytes,
  maxBytes = AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
) {
  if (
    !Buffer.isBuffer(bytes) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES ||
    bytes.length > maxBytes
  ) {
    fail(
      "cutover_plan_too_large",
      `Kernel guard cutover plan exceeds the ${AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES.toLocaleString()} byte aggregate limit.`,
    );
  }
  return bytes;
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string") return false;
  const timestampMs = Date.parse(value);
  return (
    Number.isFinite(timestampMs) &&
    new Date(timestampMs).toISOString() === value
  );
}

function currentUid(stats = undefined) {
  return typeof process.getuid === "function"
    ? process.getuid()
    : (stats?.uid ?? 0);
}

function syncDirectory(directoryPath) {
  let descriptor;
  try {
    descriptor = openSync(directoryPath, constants.O_RDONLY);
    fsyncSync(descriptor);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function syncPinnedDirectoryDescriptor(descriptor) {
  try {
    fsyncSync(descriptor);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) throw error;
  }
}

function requirePrivateDirectory(directoryPath, label) {
  let stats;
  try {
    stats = lstatSync(directoryPath);
  } catch (error) {
    fail(
      "cutover_state_invalid",
      `${label} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid(stats) ||
    (stats.mode & 0o7777) !== 0o700 ||
    realpathSync(directoryPath) !== path.resolve(directoryPath)
  ) {
    fail(
      "cutover_state_invalid",
      `${label} must be a private canonical mode 0700 directory owned by the current user.`,
    );
  }
  return stats;
}

function ensurePrivateDirectory(
  directoryPath,
  beforeMutation = () => undefined,
) {
  if (existsSync(directoryPath)) {
    requirePrivateDirectory(directoryPath, directoryPath);
    syncDirectory(path.dirname(directoryPath));
    return;
  }
  const parent = path.dirname(directoryPath);
  if (parent !== directoryPath && !existsSync(parent)) {
    ensurePrivateDirectory(parent, beforeMutation);
  }
  const pinnedParent = openPinnedPrivateDirectoryPath(
    parent,
    `Private directory parent ${parent}`,
  );
  try {
    beforeMutation();
    requirePinnedPrivateDirectoryPath(
      parent,
      pinnedParent,
      `Private directory parent ${parent}`,
    );
    const receipt = runCutoverNativeHelper(
      "mkdir",
      [
        path.basename(directoryPath),
        String(pinnedParent.identity.dev),
        String(pinnedParent.identity.ino),
      ],
      [pinnedParent.descriptor],
    );
    requirePinnedPrivateDirectoryPath(
      parent,
      pinnedParent,
      `Private directory parent ${parent}`,
    );
    syncPinnedDirectoryDescriptor(pinnedParent.descriptor);
    const pinnedDirectory = openPinnedPrivateDirectoryPath(
      directoryPath,
      directoryPath,
    );
    try {
      if (
        ![true, false].includes(receipt.created) ||
        receipt.device !== String(pinnedDirectory.identity.dev) ||
        receipt.inode !== String(pinnedDirectory.identity.ino)
      ) {
        fail(
          "cutover_conflict",
          `Private directory creation receipt changed: ${directoryPath}`,
        );
      }
    } finally {
      closeSync(pinnedDirectory.descriptor);
    }
  } finally {
    closeSync(pinnedParent.descriptor);
  }
}

function readBoundedRegularFile(
  filePath,
  maxBytes = CUTOVER_MAX_FILE_BYTES,
  allowedLinkCounts = new Set([1]),
  allowedModes = new Set([0o600, 0o640, 0o644]),
  admissionCheckpoint = () => undefined,
) {
  if (
    typeof constants.O_NOFOLLOW !== "number" ||
    typeof constants.O_NONBLOCK !== "number"
  ) {
    fail(
      "cutover_state_invalid",
      "Safe cutover file admission is unavailable.",
    );
  }
  let descriptor;
  try {
    const before = lstatSync(filePath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.uid !== currentUid(before) ||
      !allowedModes.has(before.mode & 0o7777) ||
      !allowedLinkCounts.has(before.nlink) ||
      before.size < 0 ||
      before.size > maxBytes ||
      realpathSync(filePath) !== path.resolve(filePath)
    ) {
      fail(
        "cutover_state_invalid",
        `Cutover source file is unsafe: ${filePath}`,
      );
    }
    descriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.uid !== before.uid ||
      opened.mode !== before.mode ||
      opened.size !== before.size ||
      !allowedLinkCounts.has(opened.nlink)
    ) {
      fail("cutover_state_invalid", `Cutover source file changed: ${filePath}`);
    }
    admissionCheckpoint({ filePath, descriptor, opened });
    const bytes = Buffer.alloc(opened.size + 1);
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
    const afterOpened = fstatSync(descriptor);
    const after = lstatSync(filePath);
    if (
      offset !== opened.size ||
      afterOpened.dev !== opened.dev ||
      afterOpened.ino !== opened.ino ||
      afterOpened.uid !== opened.uid ||
      afterOpened.mode !== opened.mode ||
      afterOpened.size !== opened.size ||
      !allowedLinkCounts.has(afterOpened.nlink) ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.uid !== opened.uid ||
      after.mode !== opened.mode ||
      !allowedLinkCounts.has(after.nlink) ||
      realpathSync(filePath) !== path.resolve(filePath)
    ) {
      fail("cutover_state_invalid", `Cutover source file changed: ${filePath}`);
    }
    return bytes.subarray(0, offset);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readPrivateMode600File(
  filePath,
  maxBytes = CUTOVER_MAX_FILE_BYTES,
  allowedLinkCounts = new Set([1]),
  admissionCheckpoint = () => undefined,
) {
  return readBoundedRegularFile(
    filePath,
    maxBytes,
    allowedLinkCounts,
    new Set([0o600]),
    admissionCheckpoint,
  );
}

function pinnedFileIdentity(stats) {
  return {
    dev: stats.dev,
    ino: stats.ino,
    uid: stats.uid,
    mode: stats.mode & 0o7777,
  };
}

function pinnedFileIdentityMatches(stats, identity) {
  return (
    stats.dev === identity.dev &&
    stats.ino === identity.ino &&
    stats.uid === identity.uid &&
    (stats.mode & 0o7777) === identity.mode
  );
}

function readExactDescriptorBytes(descriptor, stats, maxBytes, label) {
  if (stats.size < 0 || stats.size > maxBytes) {
    fail("cutover_conflict", `${label} exceeds its bounded size.`);
  }
  const bytes = Buffer.alloc(stats.size + 1);
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
  if (offset !== stats.size) {
    fail("cutover_conflict", `${label} changed while being read.`);
  }
  return bytes.subarray(0, stats.size);
}

function openPinnedPrivateFile(
  filePath,
  {
    maxBytes = CUTOVER_MAX_FILE_BYTES,
    expectedBytes = undefined,
    allowedLinkCounts = new Set([1]),
  } = {},
) {
  let descriptor;
  try {
    const before = lstatSync(filePath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.uid !== currentUid(before) ||
      (before.mode & 0o7777) !== 0o600 ||
      !allowedLinkCounts.has(before.nlink) ||
      realpathSync(filePath) !== path.resolve(filePath)
    ) {
      fail("cutover_conflict", `Cutover private path is unsafe: ${filePath}`);
    }
    descriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const opened = fstatSync(descriptor);
    const identity = pinnedFileIdentity(opened);
    if (
      !opened.isFile() ||
      !pinnedFileIdentityMatches(before, identity) ||
      !allowedLinkCounts.has(opened.nlink)
    ) {
      fail("cutover_conflict", `Cutover private path changed: ${filePath}`);
    }
    const bytes = readExactDescriptorBytes(
      descriptor,
      opened,
      maxBytes,
      `Cutover private path ${filePath}`,
    );
    if (expectedBytes !== undefined && !bytes.equals(expectedBytes)) {
      fail("cutover_conflict", `Cutover private bytes conflict: ${filePath}`);
    }
    requirePinnedPrivateFile(
      filePath,
      descriptor,
      identity,
      bytes,
      allowedLinkCounts,
    );
    return { descriptor, identity, bytes };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function requirePinnedPrivateFile(
  filePath,
  descriptor,
  identity,
  expectedBytes,
  allowedLinkCounts = new Set([1]),
  allowedModes = new Set([0o600]),
) {
  let pathStats;
  try {
    pathStats = lstatSync(filePath);
  } catch {
    fail("cutover_conflict", `Cutover private path disappeared: ${filePath}`);
  }
  const opened = fstatSync(descriptor);
  if (
    !opened.isFile() ||
    !pathStats.isFile() ||
    pathStats.isSymbolicLink() ||
    !pinnedFileIdentityMatches(opened, identity) ||
    !pinnedFileIdentityMatches(pathStats, identity) ||
    !allowedModes.has(opened.mode & 0o7777) ||
    !allowedModes.has(pathStats.mode & 0o7777) ||
    opened.size !== expectedBytes.length ||
    pathStats.size !== expectedBytes.length ||
    !allowedLinkCounts.has(opened.nlink) ||
    !allowedLinkCounts.has(pathStats.nlink) ||
    realpathSync(filePath) !== path.resolve(filePath) ||
    !readExactDescriptorBytes(
      descriptor,
      opened,
      Math.max(expectedBytes.length, 1),
      `Cutover private path ${filePath}`,
    ).equals(expectedBytes)
  ) {
    fail("cutover_conflict", `Cutover private path changed: ${filePath}`);
  }
  const afterOpened = fstatSync(descriptor);
  const afterPath = lstatSync(filePath);
  if (
    !pinnedFileIdentityMatches(afterOpened, identity) ||
    !pinnedFileIdentityMatches(afterPath, identity) ||
    !allowedModes.has(afterOpened.mode & 0o7777) ||
    !allowedModes.has(afterPath.mode & 0o7777) ||
    afterOpened.size !== expectedBytes.length ||
    afterPath.size !== expectedBytes.length ||
    !allowedLinkCounts.has(afterOpened.nlink) ||
    !allowedLinkCounts.has(afterPath.nlink)
  ) {
    fail("cutover_conflict", `Cutover private path changed: ${filePath}`);
  }
  return pathStats;
}

function requirePinnedPathAbsentOrUnchanged(filePath, pinned) {
  if (pinned === null) {
    if (existsSync(filePath)) {
      fail(
        "cutover_conflict",
        `Cutover destination appeared before publication: ${filePath}`,
      );
    }
    return;
  }
  requirePinnedPrivateFile(
    filePath,
    pinned.descriptor,
    pinned.identity,
    pinned.bytes,
  );
}

function openPinnedPrivateDirectoryPath(directoryPath, label) {
  const before = requirePrivateDirectory(directoryPath, label);
  const descriptor = openSync(
    directoryPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const opened = fstatSync(descriptor);
    const identity = pinnedFileIdentity(opened);
    if (
      !opened.isDirectory() ||
      !pinnedFileIdentityMatches(before, identity)
    ) {
      fail("cutover_conflict", `${label} generation changed.`);
    }
    return { descriptor, identity };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function requirePinnedPrivateDirectoryPath(directoryPath, pinned, label) {
  const current = requirePrivateDirectory(directoryPath, label);
  const opened = fstatSync(pinned.descriptor);
  if (
    !opened.isDirectory() ||
    !pinnedFileIdentityMatches(opened, pinned.identity) ||
    !pinnedFileIdentityMatches(current, pinned.identity)
  ) {
    fail("cutover_conflict", `${label} generation changed.`);
  }
}

function requirePinnedSnapshotDirectoryPath(directoryPath, pinned, label) {
  let current;
  try {
    current = lstatSync(directoryPath);
  } catch (error) {
    fail(
      "cutover_conflict",
      `${label} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const opened = fstatSync(pinned.descriptor);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    !opened.isDirectory() ||
    current.uid !== currentUid(current) ||
    opened.uid !== currentUid(opened) ||
    ![0o700, 0o755].includes(current.mode & 0o7777) ||
    ![0o700, 0o755].includes(opened.mode & 0o7777) ||
    !pinnedFileIdentityMatches(current, pinned.identity) ||
    !pinnedFileIdentityMatches(opened, pinned.identity) ||
    realpathSync(directoryPath) !== path.resolve(directoryPath)
  ) {
    fail("cutover_conflict", `${label} generation changed.`);
  }
  return current;
}

function openPinnedSnapshotDirectoryPath(directoryPath, label) {
  let descriptor;
  try {
    const before = lstatSync(directoryPath);
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      before.uid !== currentUid(before) ||
      ![0o700, 0o755].includes(before.mode & 0o7777) ||
      realpathSync(directoryPath) !== path.resolve(directoryPath)
    ) {
      fail(
        "cutover_state_invalid",
        `${label} must be a canonical mode 0700 or 0755 directory owned by the current user.`,
      );
    }
    descriptor = openSync(
      directoryPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const opened = fstatSync(descriptor);
    const pinned = { descriptor, identity: pinnedFileIdentity(opened) };
    if (
      !opened.isDirectory() ||
      !pinnedFileIdentityMatches(before, pinned.identity)
    ) {
      fail("cutover_conflict", `${label} generation changed.`);
    }
    requirePinnedSnapshotDirectoryPath(directoryPath, pinned, label);
    return pinned;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function setPinnedDirectoryMode(
  directoryPath,
  targetMode,
  {
    beforeMutation = () => undefined,
    checkpoint = () => undefined,
    checkpointName = "directory-before-mode-change",
  } = {},
) {
  if (![0o700, 0o755].includes(targetMode)) {
    fail(
      "cutover_state_invalid",
      `Cutover directory mode is unsupported: ${directoryPath}`,
    );
  }
  const parentPath = path.dirname(directoryPath);
  const parent = openPinnedPrivateDirectoryPath(
    parentPath,
    "Cutover directory mode parent",
  );
  let directory;
  try {
    directory = openPinnedSnapshotDirectoryPath(
      directoryPath,
      "Cutover directory mode target",
    );
    if (directory.identity.mode === targetMode) return;
    checkpoint(checkpointName, { directoryPath, targetMode });
    beforeMutation({ directoryPath, targetMode });
    requirePinnedPrivateDirectoryPath(
      parentPath,
      parent,
      "Cutover directory mode parent",
    );
    requirePinnedSnapshotDirectoryPath(
      directoryPath,
      directory,
      "Cutover directory mode target",
    );
    fchmodSync(directory.descriptor, targetMode);
    directory.identity.mode = targetMode;
    syncPinnedDirectoryDescriptor(directory.descriptor);
    syncPinnedDirectoryDescriptor(parent.descriptor);
    requirePinnedPrivateDirectoryPath(
      parentPath,
      parent,
      "Cutover directory mode parent",
    );
    requirePinnedSnapshotDirectoryPath(
      directoryPath,
      directory,
      "Cutover directory mode target",
    );
  } finally {
    if (directory !== undefined) closeSync(directory.descriptor);
    closeSync(parent.descriptor);
  }
}

function runCutoverNativeHelperBytes(
  operation,
  args,
  descriptors,
  { maxBuffer = 1024 * 1024 } = {},
) {
  const helperSource = readPinnedLeaseArchiveHelperSource(undefined, {
    expectedDigest: CUTOVER_NATIVE_MOVE_HELPER_SHA256,
  });
  const framed = framePinnedLeaseArchiveHelperInvocation(
    helperSource,
    operation,
    args,
    { expectedDigest: CUTOVER_NATIVE_MOVE_HELPER_SHA256 },
  );
  const pauseCheckpoint =
    process.env.FREED_CUTOVER_MOVE_TEST_PAUSE ?? "";
  const useTestDescriptors =
    pauseCheckpoint !== "" &&
    process.env.FREED_CUTOVER_MOVE_TEST_FDS === "3,4";
  const testReleaseDescriptor = 3 + descriptors.length;
  const testSignalDescriptor = testReleaseDescriptor + 1;
  let stdout;
  try {
    stdout = execFileSync(
      CUTOVER_NATIVE_MOVE_PYTHON,
      framed.argv,
      {
        env: {
          HOME: process.env.HOME ?? "",
          LANG: "C",
          LC_ALL: "C",
          PATH: "/usr/bin:/bin",
          ...(useTestDescriptors
            ? {
                FREED_REPAIR_MOVE_TEST_PAUSE: pauseCheckpoint,
                FREED_REPAIR_MOVE_TEST_OPERATION:
                  process.env.FREED_CUTOVER_MOVE_TEST_OPERATION ?? "",
                FREED_REPAIR_MOVE_TEST_SOURCE:
                  process.env.FREED_CUTOVER_MOVE_TEST_SOURCE ?? "",
                FREED_REPAIR_MOVE_TEST_DESTINATION:
                  process.env.FREED_CUTOVER_MOVE_TEST_DESTINATION ?? "",
                FREED_REPAIR_MOVE_TEST_CONTROL_FDS:
                  `${testReleaseDescriptor},${testSignalDescriptor}`,
              }
            : {}),
        },
        maxBuffer,
        input: framed.input,
        stdio: [
          "pipe",
          "pipe",
          "pipe",
          ...descriptors,
          ...(useTestDescriptors ? [3, 4] : []),
        ],
      },
    );
  } catch (error) {
    const stderr = String(error?.stderr ?? "").trim();
    const unavailable = /(?:unavailable|unsupported)/i.test(stderr);
    fail(
      unavailable ? "cutover_filesystem_unsupported" : "cutover_conflict",
      `Kernel guard cutover ${operation} failed${stderr ? `: ${stderr}` : "."}`,
    );
  }
  return Buffer.from(stdout ?? Buffer.alloc(0));
}

function runCutoverNativeHelper(operation, args, descriptors, options = {}) {
  const stdout = runCutoverNativeHelperBytes(
    operation,
    args,
    descriptors,
    options,
  );
  let receipt;
  try {
    receipt = JSON.parse(String(stdout));
  } catch {
    fail(
      "cutover_conflict",
      `Kernel guard cutover ${operation} returned an invalid receipt.`,
    );
  }
  if (receipt?.protocol !== "freed-lease-archive-move-v1") {
    fail(
      "cutover_conflict",
      `Kernel guard cutover ${operation} changed its protocol.`,
    );
  }
  return receipt;
}

function cutoverDirectoryDurabilityTestPause(checkpoint) {
  if (
    process.env.FREED_CUTOVER_DIRECTORY_TEST_PAUSE !== checkpoint ||
    process.env.FREED_CUTOVER_MOVE_TEST_FDS !== "3,4"
  ) {
    return;
  }
  writeSync(4, Buffer.from(`${checkpoint}\n`, "ascii"));
  const release = Buffer.alloc(1);
  if (readSync(3, release, 0, 1, null) !== 1 || release[0] !== 0x31) {
    fail(
      "cutover_conflict",
      `Cutover directory durability test pause was not released at ${checkpoint}.`,
    );
  }
}

function ensurePinnedPrivateDirectoryChain(
  anchorDirectory,
  targetDirectory,
  beforeMutation = () => undefined,
) {
  const relative = path.relative(anchorDirectory, targetDirectory);
  const names = relative.split(path.sep).filter(Boolean);
  if (
    !path.isAbsolute(anchorDirectory) ||
    !path.isAbsolute(targetDirectory) ||
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    names.some((name) => name === "." || name === "..")
  ) {
    fail(
      "cutover_conflict",
      `Cutover retained directory is outside its admitted anchor: ${targetDirectory}`,
    );
  }
  let currentPath = anchorDirectory;
  let current = openPinnedPrivateDirectoryPath(
    currentPath,
    "Cutover retained directory anchor",
  );
  try {
    for (const name of names) {
      beforeMutation();
      requirePinnedPrivateDirectoryPath(
        currentPath,
        current,
        "Cutover retained directory parent",
      );
      const receipt = runCutoverNativeHelper(
        "mkdir",
        [
          name,
          String(current.identity.dev),
          String(current.identity.ino),
        ],
        [current.descriptor],
      );
      requirePinnedPrivateDirectoryPath(
        currentPath,
        current,
        "Cutover retained directory parent",
      );
      cutoverDirectoryDurabilityTestPause(
        "retained-directory-created-before-parent-sync",
      );
      requirePinnedPrivateDirectoryPath(
        currentPath,
        current,
        "Cutover retained directory parent",
      );
      fsyncSync(current.descriptor);
      cutoverDirectoryDurabilityTestPause(
        "retained-directory-parent-synced",
      );
      requirePinnedPrivateDirectoryPath(
        currentPath,
        current,
        "Cutover retained directory parent",
      );
      const childPath = path.join(currentPath, name);
      const child = openPinnedPrivateDirectoryPath(
        childPath,
        "Cutover retained directory child",
      );
      try {
        if (
          receipt.device !== String(child.identity.dev) ||
          receipt.inode !== String(child.identity.ino)
        ) {
          fail(
            "cutover_conflict",
            `Cutover retained directory receipt changed at ${childPath}.`,
          );
        }
        requirePinnedPrivateDirectoryPath(
          currentPath,
          current,
          "Cutover retained directory parent",
        );
        requirePinnedPrivateDirectoryPath(
          childPath,
          child,
          "Cutover retained directory child",
        );
      } catch (error) {
        closeSync(child.descriptor);
        throw error;
      }
      closeSync(current.descriptor);
      current = child;
      currentPath = childPath;
    }
    return current;
  } catch (error) {
    closeSync(current.descriptor);
    throw error;
  }
}

function createPrivateFileRelativeToPinnedDirectory(
  directoryPath,
  pinnedDirectory,
  filePath,
  sourcePath,
  pinnedSource,
) {
  const pauseCheckpoint =
    process.env.FREED_CUTOVER_MOVE_TEST_PAUSE ?? "";
  const useTestDescriptors =
    pauseCheckpoint !== "" &&
    process.env.FREED_CUTOVER_MOVE_TEST_FDS === "3,4";
  requirePinnedPrivateDirectoryPath(
    directoryPath,
    pinnedDirectory,
    "Cutover replacement directory",
  );
  const source = fstatSync(pinnedSource.descriptor);
  requirePinnedPrivateFile(
    sourcePath,
    pinnedSource.descriptor,
    pinnedSource.identity,
    pinnedSource.bytes,
    new Set([2]),
  );
  let stdout;
  try {
    stdout = execFileSync(
      CUTOVER_NATIVE_MOVE_PYTHON,
      [
        "-E",
        "-I",
        "-S",
        "-c",
        CUTOVER_PRIVATE_FILE_CREATE_HELPER_SOURCE,
        path.basename(filePath),
        String(pinnedDirectory.identity.dev),
        String(pinnedDirectory.identity.ino),
        String(source.dev),
        String(source.ino),
        String(pinnedSource.bytes.length),
        sha256(pinnedSource.bytes),
      ],
      {
        env: {
          HOME: process.env.HOME ?? "",
          LANG: "C",
          LC_ALL: "C",
          PATH: "/usr/bin:/bin",
          ...(useTestDescriptors
            ? {
                FREED_REPAIR_MOVE_TEST_PAUSE: pauseCheckpoint,
                FREED_REPAIR_MOVE_TEST_OPERATION:
                  process.env.FREED_CUTOVER_MOVE_TEST_OPERATION ?? "",
                FREED_REPAIR_MOVE_TEST_DESTINATION:
                  process.env.FREED_CUTOVER_MOVE_TEST_DESTINATION ?? "",
              }
            : {}),
        },
        maxBuffer: 1024 * 1024,
        stdio: [
          "ignore",
          "pipe",
          "pipe",
          pinnedDirectory.descriptor,
          pinnedSource.descriptor,
          "ignore",
          ...(useTestDescriptors ? [3, 4] : []),
        ],
      },
    );
  } catch (error) {
    const stderr = String(error?.stderr ?? "").trim();
    fail(
      "cutover_conflict",
      `Kernel guard cutover create-private-durable failed${stderr ? `: ${stderr}` : "."}`,
    );
  }
  requirePinnedPrivateDirectoryPath(
    directoryPath,
    pinnedDirectory,
    "Cutover replacement directory",
  );
  let receipt;
  try {
    receipt = JSON.parse(String(stdout));
  } catch {
    fail(
      "cutover_conflict",
      "Kernel guard cutover create-private-durable returned an invalid receipt.",
    );
  }
  if (
    receipt?.protocol !== "freed-kernel-guard-private-file-create-v1" ||
    receipt.size !== String(pinnedSource.bytes.length) ||
    receipt.digest !== sha256(pinnedSource.bytes)
  ) {
    fail(
      "cutover_conflict",
      "Kernel guard cutover create-private-durable receipt changed.",
    );
  }
  const pinned = openPinnedPrivateFile(filePath, {
    maxBytes: pinnedSource.bytes.length,
    expectedBytes: pinnedSource.bytes,
  });
  try {
    if (
      receipt.device !== String(pinned.identity.dev) ||
      receipt.inode !== String(pinned.identity.ino)
    ) {
      fail(
        "cutover_conflict",
        "Kernel guard cutover replacement generation changed.",
      );
    }
    requirePinnedPrivateDirectoryPath(
      directoryPath,
      pinnedDirectory,
      "Cutover replacement directory",
    );
    return pinned;
  } catch (error) {
    closeSync(pinned.descriptor);
    throw error;
  }
}

function runDurablePrivateFileMove(
  sourcePath,
  destinationPath,
  pinnedSource,
  {
    allowedLinkCounts = new Set([1]),
    allowedModes = new Set([0o600]),
    heldSourceDirectory = undefined,
    heldDestinationDirectory = undefined,
  } = {},
) {
  let sourceDirectory;
  let destinationDirectory;
  let closeSourceDirectory = false;
  let closeDestinationDirectory = false;
  try {
    sourceDirectory =
      heldSourceDirectory ??
      openPinnedPrivateDirectoryPath(
        path.dirname(sourcePath),
        "Cutover native move source directory",
      );
    destinationDirectory =
      heldDestinationDirectory ??
      openPinnedPrivateDirectoryPath(
        path.dirname(destinationPath),
        "Cutover native move destination directory",
      );
    closeSourceDirectory = heldSourceDirectory === undefined;
    closeDestinationDirectory = heldDestinationDirectory === undefined;
    requirePinnedPrivateFile(
      sourcePath,
      pinnedSource.descriptor,
      pinnedSource.identity,
      pinnedSource.bytes,
      allowedLinkCounts,
      allowedModes,
    );
    requirePinnedPrivateDirectoryPath(
      path.dirname(sourcePath),
      sourceDirectory,
      "Cutover native move source directory",
    );
    requirePinnedPrivateDirectoryPath(
      path.dirname(destinationPath),
      destinationDirectory,
      "Cutover native move destination directory",
    );
    if (existsSync(destinationPath)) {
      fail(
        "cutover_conflict",
        `Cutover native move destination already exists: ${destinationPath}`,
      );
    }
    const source = fstatSync(pinnedSource.descriptor);
    const receipt = runCutoverNativeHelper(
      "rename-durable",
      [
        path.basename(sourcePath),
        path.basename(destinationPath),
        String(source.dev),
        String(source.ino),
        String(source.mode & 0o7777),
        String(source.nlink),
        String(pinnedSource.bytes.length),
        sha256(pinnedSource.bytes),
        String(sourceDirectory.identity.dev),
        String(sourceDirectory.identity.ino),
        String(destinationDirectory.identity.dev),
        String(destinationDirectory.identity.ino),
      ],
      [
        sourceDirectory.descriptor,
        destinationDirectory.descriptor,
        pinnedSource.descriptor,
      ],
    );
    if (
      receipt.device !== String(source.dev) ||
      receipt.inode !== String(source.ino) ||
      receipt.size !== String(pinnedSource.bytes.length) ||
      receipt.digest !== sha256(pinnedSource.bytes)
    ) {
      fail("cutover_conflict", "Cutover native move receipt changed.");
    }
    if (existsSync(sourcePath)) {
      fail(
        "cutover_conflict",
        `Cutover native move source survived: ${sourcePath}`,
      );
    }
    requirePinnedPrivateFile(
      destinationPath,
      pinnedSource.descriptor,
      pinnedSource.identity,
      pinnedSource.bytes,
      allowedLinkCounts,
      allowedModes,
    );
  } finally {
    if (closeDestinationDirectory && destinationDirectory !== undefined) {
      closeSync(destinationDirectory.descriptor);
    }
    if (closeSourceDirectory && sourceDirectory !== undefined) {
      closeSync(sourceDirectory.descriptor);
    }
  }
}

function runDurablePrivateFileExchange(
  sourcePath,
  destinationPath,
  pinnedSource,
  pinnedDestination,
  {
    sourceAllowedLinkCounts = new Set([1]),
    destinationAllowedLinkCounts = new Set([1]),
    heldSourceDirectory = undefined,
    heldDestinationDirectory = undefined,
  } = {},
) {
  let sourceDirectory;
  let destinationDirectory;
  let closeSourceDirectory = false;
  let closeDestinationDirectory = false;
  try {
    sourceDirectory =
      heldSourceDirectory ??
      openPinnedPrivateDirectoryPath(
        path.dirname(sourcePath),
        "Cutover native exchange source directory",
      );
    destinationDirectory =
      heldDestinationDirectory ??
      openPinnedPrivateDirectoryPath(
        path.dirname(destinationPath),
        "Cutover native exchange destination directory",
      );
    closeSourceDirectory = heldSourceDirectory === undefined;
    closeDestinationDirectory = heldDestinationDirectory === undefined;
    requirePinnedPrivateFile(
      sourcePath,
      pinnedSource.descriptor,
      pinnedSource.identity,
      pinnedSource.bytes,
      sourceAllowedLinkCounts,
    );
    requirePinnedPrivateFile(
      destinationPath,
      pinnedDestination.descriptor,
      pinnedDestination.identity,
      pinnedDestination.bytes,
      destinationAllowedLinkCounts,
    );
    const source = fstatSync(pinnedSource.descriptor);
    const destination = fstatSync(pinnedDestination.descriptor);
    const receipt = runCutoverNativeHelper(
      "exchange-durable",
      [
        path.basename(sourcePath),
        path.basename(destinationPath),
        String(source.dev),
        String(source.ino),
        String(source.mode & 0o7777),
        String(source.nlink),
        String(pinnedSource.bytes.length),
        sha256(pinnedSource.bytes),
        String(destination.dev),
        String(destination.ino),
        String(destination.mode & 0o7777),
        String(destination.nlink),
        String(pinnedDestination.bytes.length),
        sha256(pinnedDestination.bytes),
        String(sourceDirectory.identity.dev),
        String(sourceDirectory.identity.ino),
        String(destinationDirectory.identity.dev),
        String(destinationDirectory.identity.ino),
      ],
      [
        sourceDirectory.descriptor,
        destinationDirectory.descriptor,
        pinnedSource.descriptor,
      ],
    );
    if (
      receipt.sourceDevice !== String(source.dev) ||
      receipt.sourceInode !== String(source.ino) ||
      receipt.sourceDigest !== sha256(pinnedSource.bytes) ||
      receipt.destinationDevice !== String(destination.dev) ||
      receipt.destinationInode !== String(destination.ino) ||
      receipt.destinationDigest !== sha256(pinnedDestination.bytes)
    ) {
      fail("cutover_conflict", "Cutover native exchange receipt changed.");
    }
    requirePinnedPrivateFile(
      destinationPath,
      pinnedSource.descriptor,
      pinnedSource.identity,
      pinnedSource.bytes,
      sourceAllowedLinkCounts,
    );
    requirePinnedPrivateFile(
      sourcePath,
      pinnedDestination.descriptor,
      pinnedDestination.identity,
      pinnedDestination.bytes,
      destinationAllowedLinkCounts,
    );
  } finally {
    if (closeDestinationDirectory && destinationDirectory !== undefined) {
      closeSync(destinationDirectory.descriptor);
    }
    if (closeSourceDirectory && sourceDirectory !== undefined) {
      closeSync(sourceDirectory.descriptor);
    }
  }
}

function requirePinnedRemovalDirectoryGeneration(
  directoryPath,
  pinned,
  label,
) {
  const current = lstatSync(directoryPath);
  const opened = fstatSync(pinned.descriptor);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    !opened.isDirectory() ||
    !pinnedFileIdentityMatches(current, pinned.identity) ||
    !pinnedFileIdentityMatches(opened, pinned.identity) ||
    ![0o700, 0o755].includes(current.mode & 0o7777) ||
    realpathSync(directoryPath) !== path.resolve(directoryPath)
  ) {
    fail("cutover_source_drift", `${label} generation changed.`);
  }
}

function runDurablePrivateDirectoryMove(
  sourcePath,
  destinationPath,
  pinnedSource,
  {
    expectedTreeDigest,
    maxFileBytes = CUTOVER_MAX_FILE_BYTES,
    maxEntries = CUTOVER_SNAPSHOT_MAX_ENTRIES,
    maxDepth = CUTOVER_SNAPSHOT_MAX_DEPTH,
    maxAggregateBytes = CUTOVER_SNAPSHOT_MAX_AGGREGATE_BYTES,
  },
) {
  if (
    !SHA256_PATTERN.test(String(expectedTreeDigest ?? "")) ||
    !Number.isSafeInteger(maxFileBytes) ||
    maxFileBytes < 0 ||
    maxFileBytes > CUTOVER_MAX_FILE_BYTES ||
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > CUTOVER_SNAPSHOT_MAX_ENTRIES ||
    !Number.isSafeInteger(maxDepth) ||
    maxDepth < 0 ||
    maxDepth > CUTOVER_SNAPSHOT_MAX_DEPTH ||
    !Number.isSafeInteger(maxAggregateBytes) ||
    maxAggregateBytes < 0 ||
    maxAggregateBytes > CUTOVER_SNAPSHOT_MAX_AGGREGATE_BYTES
  ) {
    fail(
      "cutover_state_invalid",
      "Cutover directory retirement snapshot contract is invalid.",
    );
  }
  let sourceDirectory;
  let destinationDirectory;
  try {
    sourceDirectory = openPinnedPrivateDirectoryPath(
      path.dirname(sourcePath),
      "Cutover directory retirement source parent",
    );
    destinationDirectory = openPinnedPrivateDirectoryPath(
      path.dirname(destinationPath),
      "Cutover directory retirement destination parent",
    );
    requirePinnedRemovalDirectoryGeneration(
      sourcePath,
      pinnedSource,
      "Cutover directory retirement source",
    );
    if (existsSync(destinationPath)) {
      fail(
        "cutover_conflict",
        `Cutover directory retirement destination already exists: ${destinationPath}`,
      );
    }
    const source = fstatSync(pinnedSource.descriptor);
    const receipt = runCutoverNativeHelper(
      "retire-directory-durable",
      [
        path.basename(sourcePath),
        path.basename(destinationPath),
        String(source.dev),
        String(source.ino),
        String(source.mode & 0o7777),
        String(source.uid),
        String(sourceDirectory.identity.dev),
        String(sourceDirectory.identity.ino),
        String(destinationDirectory.identity.dev),
        String(destinationDirectory.identity.ino),
        expectedTreeDigest,
        String(maxFileBytes),
        String(maxEntries),
        String(maxDepth),
        String(maxAggregateBytes),
      ],
      [
        sourceDirectory.descriptor,
        destinationDirectory.descriptor,
        pinnedSource.descriptor,
      ],
    );
    if (
      receipt.device !== String(source.dev) ||
      receipt.inode !== String(source.ino) ||
      receipt.mode !== String(source.mode & 0o7777) ||
      receipt.uid !== String(source.uid) ||
      receipt.treeDigest !== expectedTreeDigest
    ) {
      fail(
        "cutover_conflict",
        "Cutover directory retirement receipt changed.",
      );
    }
    if (existsSync(sourcePath)) {
      fail(
        "cutover_conflict",
        `Cutover directory retirement source survived: ${sourcePath}`,
      );
    }
    requirePinnedRemovalDirectoryGeneration(
      destinationPath,
      pinnedSource,
      "Cutover retired directory",
    );
  } finally {
    if (destinationDirectory !== undefined) {
      closeSync(destinationDirectory.descriptor);
    }
    if (sourceDirectory !== undefined) closeSync(sourceDirectory.descriptor);
  }
}

function retirementArchivePath(retirementDirectory, filePath, identity, bytes) {
  return path.join(
    retirementDirectory,
    `${sha256(
      canonicalJsonBytes({
        filePath,
        device: String(identity.dev),
        inode: String(identity.ino),
        digest: sha256(bytes),
      }),
    )}.archive`,
  );
}

function retirePinnedPrivateFile(
  filePath,
  pinned,
  {
    retirementDirectory,
    beforeMutation = () => undefined,
    checkpoint = () => undefined,
    checkpointName = "private-file-before-retirement",
    mutationDetails = undefined,
  },
) {
  ensurePrivateDirectory(retirementDirectory, beforeMutation);
  const archivePath = retirementArchivePath(
    retirementDirectory,
    filePath,
    pinned.identity,
    pinned.bytes,
  );
  checkpoint(checkpointName, { filePath, archivePath });
  requirePinnedPrivateFile(
    filePath,
    pinned.descriptor,
    pinned.identity,
    pinned.bytes,
  );
  beforeMutation(mutationDetails ?? { filePath, archivePath });
  requirePinnedPrivateFile(
    filePath,
    pinned.descriptor,
    pinned.identity,
    pinned.bytes,
  );
  runDurablePrivateFileMove(filePath, archivePath, pinned);
  return archivePath;
}

function retainedHardLinkPaths(retirementDirectory, filePath, bytes) {
  const generation = sha256(
    canonicalJsonBytes({
      kind: "automation-kernel-guard-retained-hard-link-generation",
      filePath,
      digest: sha256(bytes),
    }),
  );
  return {
    temporaryArchive: path.join(
      retirementDirectory,
      `${generation}.temporary.archive`,
    ),
    canonicalArchive: path.join(
      retirementDirectory,
      `${generation}.canonical.archive`,
    ),
    replacement: path.join(
      retirementDirectory,
      `${generation}.replacement.tmp`,
    ),
  };
}

function samePinnedIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.mode === right.mode
  );
}

function openRetainedHardLink(pathname, bytes) {
  return openPinnedPrivateFile(pathname, {
    maxBytes: bytes.length,
    expectedBytes: bytes,
    allowedLinkCounts: new Set([2]),
  });
}

function requireRetainedHardLink(
  pathname,
  pinned,
  bytes,
) {
  requirePinnedPrivateFile(
    pathname,
    pinned.descriptor,
    pinned.identity,
    bytes,
    new Set([2]),
  );
}

function inspectRetainedHardLinkPublication(
  filePath,
  temporaryPath,
  bytes,
  retirementDirectory,
) {
  const retained = retainedHardLinkPaths(
    retirementDirectory,
    filePath,
    bytes,
  );
  const hasRetainedState = Object.values(retained).some((candidatePath) =>
    existsSync(candidatePath),
  );
  if (!hasRetainedState) return { relevant: false, retained };
  if (existsSync(temporaryPath) || !existsSync(retained.temporaryArchive)) {
    fail(
      "cutover_conflict",
      `Retained hard-link publication conflicts at ${filePath}.`,
    );
  }
  const original = openRetainedHardLink(retained.temporaryArchive, bytes);
  let live;
  let replacement;
  try {
    live = openPinnedPrivateFile(filePath, {
      maxBytes: bytes.length,
      expectedBytes: bytes,
      allowedLinkCounts: new Set([1, 2]),
    });
    const liveIsOriginal = samePinnedIdentity(
      live.identity,
      original.identity,
    );
    const canonicalRetired = existsSync(retained.canonicalArchive);
    const replacementExists = existsSync(retained.replacement);
    if (canonicalRetired) {
      if (replacementExists || liveIsOriginal) {
        fail(
          "cutover_conflict",
          `Completed retained hard-link publication conflicts at ${filePath}.`,
        );
      }
      requirePinnedPrivateFile(
        filePath,
        live.descriptor,
        live.identity,
        bytes,
      );
      requireRetainedHardLink(
        retained.canonicalArchive,
        original,
        bytes,
      );
      requireRetainedHardLink(
        retained.temporaryArchive,
        original,
        bytes,
      );
      return { relevant: true, phase: "complete", retained };
    }
    if (liveIsOriginal) {
      requirePinnedPrivateFile(
        filePath,
        original.descriptor,
        original.identity,
        bytes,
        new Set([2]),
      );
      if (!replacementExists) {
        return { relevant: true, phase: "temporary-retired", retained };
      }
      replacement = openPinnedPrivateFile(retained.replacement, {
        maxBytes: bytes.length,
      });
      if (samePinnedIdentity(replacement.identity, original.identity)) {
        fail(
          "cutover_conflict",
          `Retained hard-link replacement conflicts at ${filePath}.`,
        );
      }
      if (
        !bytes
          .subarray(0, replacement.bytes.length)
          .equals(replacement.bytes)
      ) {
        fail(
          "cutover_conflict",
          `Retained hard-link replacement prefix conflicts at ${filePath}.`,
        );
      }
      return {
        relevant: true,
        phase: replacement.bytes.equals(bytes)
          ? "replacement-durable"
          : "replacement-prefix",
        retained,
      };
    }
    requirePinnedPrivateFile(
      filePath,
      live.descriptor,
      live.identity,
      bytes,
    );
    if (!replacementExists) {
      fail(
        "cutover_conflict",
        `Retained hard-link displaced generation is missing at ${filePath}.`,
      );
    }
    requireRetainedHardLink(retained.replacement, original, bytes);
    return { relevant: true, phase: "canonical-exchanged", retained };
  } finally {
    if (replacement !== undefined) closeSync(replacement.descriptor);
    if (live !== undefined) closeSync(live.descriptor);
    closeSync(original.descriptor);
  }
}

function createRetainedHardLinkReplacement(
  retirementDirectory,
  pinnedRetirementDirectory,
  replacementPath,
  sourcePath,
  pinnedSource,
  beforeMutation,
) {
  beforeMutation();
  requirePinnedPrivateDirectoryPath(
    retirementDirectory,
    pinnedRetirementDirectory,
    "Cutover retained hard-link directory",
  );
  requireRetainedHardLink(sourcePath, pinnedSource, pinnedSource.bytes);
  return createPrivateFileRelativeToPinnedDirectory(
    retirementDirectory,
    pinnedRetirementDirectory,
    replacementPath,
    sourcePath,
    pinnedSource,
  );
}

function retirePublishedHardLinks(
  filePath,
  temporaryPath,
  bytes,
  {
    retirementDirectory,
    beforeMutation = () => undefined,
  },
) {
  let state = inspectRetainedHardLinkPublication(
    filePath,
    temporaryPath,
    bytes,
    retirementDirectory,
  );
  if (
    !state.relevant &&
    (!existsSync(filePath) || !existsSync(temporaryPath))
  ) {
    return false;
  }
  const liveDirectoryPath = path.dirname(filePath);
  const retirementAnchor = path.dirname(
    path.dirname(path.dirname(retirementDirectory)),
  );
  const liveDirectory = openPinnedPrivateDirectoryPath(
    liveDirectoryPath,
    "Cutover retained hard-link live directory",
  );
  let pinnedRetirementDirectory;
  const requireDirectories = () => {
    requirePinnedPrivateDirectoryPath(
      liveDirectoryPath,
      liveDirectory,
      "Cutover retained hard-link live directory",
    );
    requirePinnedPrivateDirectoryPath(
      retirementDirectory,
      pinnedRetirementDirectory,
      "Cutover retained hard-link directory",
    );
  };
  try {
    pinnedRetirementDirectory = ensurePinnedPrivateDirectoryChain(
      retirementAnchor,
      retirementDirectory,
      beforeMutation,
    );
    requireDirectories();
    state = inspectRetainedHardLinkPublication(
      filePath,
      temporaryPath,
      bytes,
      retirementDirectory,
    );
    requireDirectories();
    if (!state.relevant) {
      const original = openPinnedPrivateFile(temporaryPath, {
        maxBytes: bytes.length,
        expectedBytes: bytes,
        allowedLinkCounts: new Set([2]),
      });
      try {
        requirePinnedPrivateFile(
          filePath,
          original.descriptor,
          original.identity,
          bytes,
          new Set([2]),
        );
        const retained = retainedHardLinkPaths(
          retirementDirectory,
          filePath,
          bytes,
        );
        beforeMutation();
        requireDirectories();
        requirePinnedPrivateFile(
          filePath,
          original.descriptor,
          original.identity,
          bytes,
          new Set([2]),
        );
        requirePinnedPrivateFile(
          temporaryPath,
          original.descriptor,
          original.identity,
          bytes,
          new Set([2]),
        );
        runDurablePrivateFileMove(
          temporaryPath,
          retained.temporaryArchive,
          original,
          {
            allowedLinkCounts: new Set([2]),
            heldSourceDirectory: liveDirectory,
            heldDestinationDirectory: pinnedRetirementDirectory,
          },
        );
        requireDirectories();
      } finally {
        closeSync(original.descriptor);
      }
      state = inspectRetainedHardLinkPublication(
        filePath,
        temporaryPath,
        bytes,
        retirementDirectory,
      );
      requireDirectories();
    }
    if (state.phase === "complete") return true;
    if (
      state.phase === "temporary-retired" ||
      state.phase === "replacement-prefix"
    ) {
      const original = openRetainedHardLink(
        state.retained.temporaryArchive,
        bytes,
      );
      try {
        const replacement = createRetainedHardLinkReplacement(
          retirementDirectory,
          pinnedRetirementDirectory,
          state.retained.replacement,
          state.retained.temporaryArchive,
          original,
          beforeMutation,
        );
        closeSync(replacement.descriptor);
        requireDirectories();
      } finally {
        closeSync(original.descriptor);
      }
      state = inspectRetainedHardLinkPublication(
        filePath,
        temporaryPath,
        bytes,
        retirementDirectory,
      );
      requireDirectories();
    }
    if (state.phase === "replacement-durable") {
      const original = openRetainedHardLink(
        state.retained.temporaryArchive,
        bytes,
      );
      const replacement = openPinnedPrivateFile(state.retained.replacement, {
        maxBytes: bytes.length,
        expectedBytes: bytes,
      });
      try {
        beforeMutation();
        requireDirectories();
        requireRetainedHardLink(
          state.retained.temporaryArchive,
          original,
          bytes,
        );
        requirePinnedPrivateFile(
          filePath,
          original.descriptor,
          original.identity,
          bytes,
          new Set([2]),
        );
        requirePinnedPrivateFile(
          state.retained.replacement,
          replacement.descriptor,
          replacement.identity,
          bytes,
        );
        runDurablePrivateFileExchange(
          state.retained.replacement,
          filePath,
          replacement,
          original,
          {
            destinationAllowedLinkCounts: new Set([2]),
            heldSourceDirectory: pinnedRetirementDirectory,
            heldDestinationDirectory: liveDirectory,
          },
        );
        requireDirectories();
      } finally {
        closeSync(replacement.descriptor);
        closeSync(original.descriptor);
      }
      state = inspectRetainedHardLinkPublication(
        filePath,
        temporaryPath,
        bytes,
        retirementDirectory,
      );
      requireDirectories();
    }
    if (state.phase === "canonical-exchanged") {
      const original = openRetainedHardLink(
        state.retained.temporaryArchive,
        bytes,
      );
      try {
        requireRetainedHardLink(state.retained.replacement, original, bytes);
        beforeMutation();
        requireDirectories();
        requireRetainedHardLink(
          state.retained.temporaryArchive,
          original,
          bytes,
        );
        requireRetainedHardLink(state.retained.replacement, original, bytes);
        runDurablePrivateFileMove(
          state.retained.replacement,
          state.retained.canonicalArchive,
          original,
          {
            allowedLinkCounts: new Set([2]),
            heldSourceDirectory: pinnedRetirementDirectory,
            heldDestinationDirectory: pinnedRetirementDirectory,
          },
        );
        requireDirectories();
      } finally {
        closeSync(original.descriptor);
      }
      state = inspectRetainedHardLinkPublication(
        filePath,
        temporaryPath,
        bytes,
        retirementDirectory,
      );
      requireDirectories();
    }
    if (state.phase !== "complete") {
      fail(
        "cutover_conflict",
        `Retained hard-link publication did not complete at ${filePath}.`,
      );
    }
    return true;
  } finally {
    if (pinnedRetirementDirectory !== undefined) {
      closeSync(pinnedRetirementDirectory.descriptor);
    }
    closeSync(liveDirectory.descriptor);
  }
}

function removePrivateTemporaryFile(
  filePath,
  expectedByteOptions,
  {
    retirementDirectory,
    beforeMutation = () => undefined,
    beforeUnlink = () => undefined,
  },
) {
  if (!existsSync(filePath)) return;
  const pinned = openPinnedPrivateFile(filePath);
  try {
    if (
      !Array.isArray(expectedByteOptions) ||
      !expectedByteOptions.some((option) => pinned.bytes.equals(option))
    ) {
      fail(
        "cutover_conflict",
        `Cutover temporary bytes conflict: ${filePath}`,
      );
    }
    beforeUnlink({ filePath });
    requirePinnedPrivateFile(
      filePath,
      pinned.descriptor,
      pinned.identity,
      pinned.bytes,
    );
    beforeMutation();
    requirePinnedPrivateFile(
      filePath,
      pinned.descriptor,
      pinned.identity,
      pinned.bytes,
    );
    retirePinnedPrivateFile(filePath, pinned, {
      retirementDirectory,
      beforeMutation,
    });
    if (existsSync(filePath)) {
      fail(
        "cutover_conflict",
        `Cutover temporary path survived exact retirement: ${filePath}`,
      );
    }
  } finally {
    closeSync(pinned.descriptor);
  }
}

function writeAtomic(
  filePath,
  bytes,
  beforeMutation = () => undefined,
  temporaryDurable = () => undefined,
) {
  ensurePrivateDirectory(path.dirname(filePath), beforeMutation);
  const temporaryPath = `${filePath}.cutover.tmp`;
  let temporaryPinned = null;
  let destinationPinned = null;
  const retirementDirectory = path.join(
    path.dirname(filePath),
    ".kernel-guard-cutover-retired",
    "atomic",
  );
  ensurePrivateDirectory(retirementDirectory, beforeMutation);
  try {
    if (existsSync(filePath)) {
      destinationPinned = openPinnedPrivateFile(filePath);
    }
    if (existsSync(temporaryPath)) {
      temporaryPinned = openPinnedPrivateFile(temporaryPath);
    }
    const destinationAlreadyPublished = destinationPinned?.bytes.equals(bytes);
    if (
      temporaryPinned !== null &&
      !temporaryPinned.bytes.equals(bytes) &&
      !destinationAlreadyPublished
    ) {
      temporaryDurable({ filePath, temporaryPath, cleanup: true });
      requirePinnedPathAbsentOrUnchanged(filePath, destinationPinned);
      retirePinnedPrivateFile(temporaryPath, temporaryPinned, {
        retirementDirectory,
        beforeMutation,
        mutationDetails: { filePath, temporaryPath },
      });
      closeSync(temporaryPinned.descriptor);
      temporaryPinned = null;
    }
    if (destinationAlreadyPublished) {
      if (temporaryPinned !== null) {
        temporaryDurable({ filePath, temporaryPath, cleanup: true });
        requirePinnedPathAbsentOrUnchanged(filePath, destinationPinned);
        retirePinnedPrivateFile(temporaryPath, temporaryPinned, {
          retirementDirectory,
          beforeMutation,
          mutationDetails: { filePath, temporaryPath },
        });
      }
      requirePinnedPrivateFile(
        filePath,
        destinationPinned.descriptor,
        destinationPinned.identity,
        bytes,
      );
      return;
    }
    if (temporaryPinned === null) {
      beforeMutation();
      const descriptor = openSync(
        temporaryPath,
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(descriptor, bytes);
      fchmodSync(descriptor, 0o600);
      fsyncSync(descriptor);
      temporaryPinned = {
        descriptor,
        identity: pinnedFileIdentity(fstatSync(descriptor)),
        bytes,
      };
    }
    syncDirectory(path.dirname(temporaryPath));
    temporaryDurable({ filePath, temporaryPath, cleanup: false });
    requirePinnedPrivateFile(
      temporaryPath,
      temporaryPinned.descriptor,
      temporaryPinned.identity,
      bytes,
    );
    requirePinnedPathAbsentOrUnchanged(filePath, destinationPinned);
    beforeMutation({ filePath, temporaryPath });
    requirePinnedPrivateFile(
      temporaryPath,
      temporaryPinned.descriptor,
      temporaryPinned.identity,
      bytes,
    );
    requirePinnedPathAbsentOrUnchanged(filePath, destinationPinned);
    if (destinationPinned === null) {
      runDurablePrivateFileMove(temporaryPath, filePath, temporaryPinned);
    } else {
      runDurablePrivateFileExchange(
        temporaryPath,
        filePath,
        temporaryPinned,
        destinationPinned,
      );
      retirePinnedPrivateFile(temporaryPath, destinationPinned, {
        retirementDirectory,
        beforeMutation,
        mutationDetails: { filePath, temporaryPath },
      });
    }
    requirePinnedPrivateFile(
      filePath,
      temporaryPinned.descriptor,
      temporaryPinned.identity,
      bytes,
    );
  } finally {
    if (temporaryPinned !== null) closeSync(temporaryPinned.descriptor);
    if (destinationPinned !== null) closeSync(destinationPinned.descriptor);
  }
}

function cutoverWriteAheadPath(plan) {
  return path.join(
    automationKernelGuardCutoverPaths(plan.parameters.stateRoot).controlRoot,
    "kernel-guard-cutover.write-ahead.json",
  );
}

function cutoverQuarantineRoot(plan) {
  return path.join(artifactDirectory(plan), ".recovery-quarantine");
}

function cutoverRetirementRoot(plan) {
  return path.join(
    automationKernelGuardCutoverPaths(plan.parameters.stateRoot).controlRoot,
    ".kernel-guard-cutover-retired",
    plan.parameters.cutoverId,
  );
}

function cutoverRetirementDirectory(plan, category) {
  return path.join(cutoverRetirementRoot(plan), category);
}

function writeCutoverImmutable(plan, filePath, bytes, options = {}) {
  return writeImmutable(filePath, bytes, {
    ...options,
    retirementDirectory: cutoverRetirementDirectory(
      plan,
      "immutable-hard-links",
    ),
  });
}

function requireCutoverImmutableTargetPreflight(plan, filePath, bytes) {
  return requireImmutableTargetPreflight(
    filePath,
    bytes,
    cutoverRetirementDirectory(plan, "immutable-hard-links"),
  );
}

function writeAheadIdentity(record) {
  return {
    schemaVersion: record.schemaVersion,
    kind: record.kind,
    operation: record.operation,
    scope: record.scope,
    scopeId: record.scopeId,
    scopePlanDigest: record.scopePlanDigest,
    cutoverId: record.cutoverId,
    operationName: record.operationName,
    filePath: record.filePath,
    quarantinePath: record.quarantinePath,
    sourceDev: record.sourceDev,
    sourceIno: record.sourceIno,
    sourceMode: record.sourceMode,
    targetMode: record.targetMode,
    sourceSize: record.sourceSize,
    sourceDigest: record.sourceDigest,
    sourceBytesBase64: record.sourceBytesBase64,
    targetSize: record.targetSize,
    targetDigest: record.targetDigest,
    targetBytesBase64: record.targetBytesBase64,
    sourceSnapshot: record.sourceSnapshot,
  };
}

function writeAheadOperationId(record) {
  return sha256(canonicalJsonBytes(writeAheadIdentity(record)));
}

function removalQuarantineId(record) {
  return sha256(
    canonicalJsonBytes({
      cutoverId: record.cutoverId,
      scope: record.scope,
      scopeId: record.scopeId,
      operationName: record.operationName,
      filePath: record.filePath,
      sourceDev: record.sourceDev,
      sourceIno: record.sourceIno,
      sourceDigest: record.sourceDigest,
    }),
  );
}

function exactWriteAheadKeys() {
  return [
    "cutoverId",
    "filePath",
    "kind",
    "operation",
    "operationId",
    "operationName",
    "phase",
    "preparedAt",
    "quarantinePath",
    "schemaVersion",
    "scope",
    "scopeId",
    "scopePlanDigest",
    "sourceBytesBase64",
    "sourceDev",
    "sourceDigest",
    "sourceIno",
    "sourceMode",
    "sourceSize",
    "sourceSnapshot",
    "targetBytesBase64",
    "targetDigest",
    "targetMode",
    "targetSize",
    "writtenAt",
  ].sort();
}

function writeAheadScope(plan, supersedePlan = undefined) {
  return supersedePlan === undefined
    ? {
        scope: "apply",
        scopeId: plan.parameters.cutoverId,
        scopePlanDigest: sha256(canonicalJsonBytes(plan)),
      }
    : {
        scope: "supersede",
        scopeId: supersedePlan.parameters.supersedeId,
        scopePlanDigest: sha256(canonicalJsonBytes(supersedePlan)),
      };
}

function allowedRewritePaths(plan) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  return new Set([
    paths.writerLock,
    ...AUTOMATION_KERNEL_GUARD_NAMES.map((name) => paths.guards[name].owner),
  ]);
}

function pathIsStateDescendant(plan, candidatePath) {
  const stateRoot = plan.parameters.stateRoot;
  const relative = path.relative(stateRoot, candidatePath);
  return (
    path.isAbsolute(candidatePath) &&
    path.resolve(candidatePath) === candidatePath &&
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function validateWriteAheadRecord(plan, record, supersedePlan = undefined) {
  const expectedScope = writeAheadScope(plan, supersedePlan);
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const preparedAtMs = Date.parse(String(record?.preparedAt ?? ""));
  const writtenAtMs = Date.parse(String(record?.writtenAt ?? ""));
  if (record?.operation === "remove") {
    assertSnapshotTreeAdmission([record.sourceSnapshot], {
      code: "cutover_write_ahead_invalid",
      message:
        "Kernel guard cutover removal snapshot exceeds its bounded admission.",
    });
  }
  if (
    record === null ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    Object.keys(record).sort().join("\n") !==
      exactWriteAheadKeys().join("\n") ||
    record.schemaVersion !== 1 ||
    record.kind !== CUTOVER_WRITE_AHEAD_KIND ||
    !["rewrite", "remove"].includes(record.operation) ||
    record.scope !== expectedScope.scope ||
    record.scopeId !== expectedScope.scopeId ||
    record.scopePlanDigest !== expectedScope.scopePlanDigest ||
    record.cutoverId !== plan.parameters.cutoverId ||
    !IDENTIFIER_PATTERN.test(String(record.operationName ?? "")) ||
    !SHA256_PATTERN.test(String(record.operationId ?? "")) ||
    writeAheadOperationId(record) !== record.operationId ||
    !pathIsStateDescendant(plan, record.filePath) ||
    !/^\d+$/.test(String(record.sourceDev ?? "")) ||
    !/^\d+$/.test(String(record.sourceIno ?? "")) ||
    ![0o600, 0o640, 0o644, 0o700, 0o755].includes(record.sourceMode) ||
    !Number.isSafeInteger(record.sourceSize) ||
    record.sourceSize < 0 ||
    !SHA256_PATTERN.test(String(record.sourceDigest ?? "")) ||
    !Number.isSafeInteger(record.targetSize) ||
    record.targetSize < 0 ||
    !SHA256_PATTERN.test(String(record.targetDigest ?? "")) ||
    !["prepared", "written"].includes(record.phase) ||
    !isCanonicalTimestamp(record.preparedAt) ||
    (record.phase === "prepared" && record.writtenAt !== null) ||
    (record.phase === "written" &&
      (!isCanonicalTimestamp(record.writtenAt) || writtenAtMs < preparedAtMs))
  ) {
    fail(
      "cutover_write_ahead_invalid",
      "Kernel guard cutover write-ahead record conflicts.",
    );
  }
  if (record.operation === "rewrite") {
    if (
      !allowedRewritePaths(plan).has(record.filePath) ||
      record.quarantinePath !== null ||
      record.sourceSnapshot !== null ||
      ![0o600, 0o640, 0o644].includes(record.targetMode) ||
      typeof record.sourceBytesBase64 !== "string" ||
      typeof record.targetBytesBase64 !== "string"
    ) {
      fail(
        "cutover_write_ahead_invalid",
        "Kernel guard rewrite record has an unsafe target.",
      );
    }
    const sourceBytes = Buffer.from(record.sourceBytesBase64, "base64");
    const targetBytes = Buffer.from(record.targetBytesBase64, "base64");
    if (
      sourceBytes.toString("base64") !== record.sourceBytesBase64 ||
      targetBytes.toString("base64") !== record.targetBytesBase64 ||
      sourceBytes.length !== record.sourceSize ||
      targetBytes.length !== record.targetSize ||
      sha256(sourceBytes) !== record.sourceDigest ||
      sha256(targetBytes) !== record.targetDigest
    ) {
      fail(
        "cutover_write_ahead_invalid",
        "Kernel guard rewrite bytes are not exact.",
      );
    }
  } else {
    const expectedQuarantine = path.join(
      cutoverRetirementDirectory(plan, "removals"),
      `${removalQuarantineId(record)}.archive`,
    );
    if (
      record.targetMode !== null ||
      record.sourceBytesBase64 !== null ||
      record.targetBytesBase64 !== null ||
      record.targetSize !== 0 ||
      record.targetDigest !== sha256(Buffer.alloc(0)) ||
      record.sourceSnapshot === null ||
      typeof record.sourceSnapshot !== "object" ||
      record.sourceSnapshot.path !== record.filePath ||
      sha256(canonicalJsonBytes(record.sourceSnapshot)) !==
        record.sourceDigest ||
      record.sourceSize !== canonicalJsonBytes(record.sourceSnapshot).length ||
      record.quarantinePath !== expectedQuarantine ||
      !pathIsStateDescendant(plan, record.quarantinePath) ||
      !(
        record.filePath === paths.writerLock ||
        record.filePath === paths.transaction ||
        record.filePath.startsWith(`${paths.guardsRoot}${path.sep}`)
      )
    ) {
      fail(
        "cutover_write_ahead_invalid",
        "Kernel guard removal record has an unsafe target.",
      );
    }
  }
  return record;
}

function readWriteAheadRecord(plan, supersedePlan = undefined) {
  const filePath = cutoverWriteAheadPath(plan);
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [filePath, `${filePath}.cutover.tmp`],
  });
  if (!existsSync(filePath)) {
    syncDirectory(path.dirname(filePath));
    return null;
  }
  let bytes;
  let record;
  try {
    bytes = readPrivateMode600File(filePath, CUTOVER_WRITE_AHEAD_MAX_BYTES);
    record = JSON.parse(fatalDecoder.decode(bytes));
  } catch (error) {
    if (error instanceof AutomationControlError) throw error;
    fail(
      "cutover_write_ahead_invalid",
      "Kernel guard cutover write-ahead record is malformed.",
    );
  }
  const validated = validateWriteAheadRecord(
    plan,
    record,
    supersedePlan !== undefined && record?.scope === "supersede"
      ? supersedePlan
      : undefined,
  );
  if (!bytes.equals(prettyJsonBytes(validated))) {
    fail(
      "cutover_write_ahead_invalid",
      "Kernel guard cutover write-ahead bytes are not canonical.",
    );
  }
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [
      validated.filePath,
      ...(validated.quarantinePath === null ? [] : [validated.quarantinePath]),
    ],
  });
  return validated;
}

function requireSupersedeWriteAheadScope(record) {
  if (record?.scope === "apply") {
    fail(
      "cutover_supersede_conflict",
      "Pending cutover application recovery must resume under its original plan before supersession.",
    );
  }
  return record;
}

function writeAheadFilesystemPaths(record) {
  if (record === null) return [];
  return [
    record.filePath,
    ...(record.quarantinePath === null ? [] : [record.quarantinePath]),
  ];
}

function writeWriteAheadRecord(
  plan,
  record,
  supersedePlan = undefined,
  beforeMutation = () => undefined,
  checkpoint = () => undefined,
) {
  validateWriteAheadRecord(plan, record, supersedePlan);
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [
      cutoverWriteAheadPath(plan),
      record.filePath,
      ...(record.quarantinePath === null ? [] : [record.quarantinePath]),
    ],
  });
  const bytes = prettyJsonBytes(record);
  if (bytes.length > CUTOVER_WRITE_AHEAD_MAX_BYTES) {
    fail(
      "cutover_write_ahead_invalid",
      "Kernel guard cutover write-ahead record exceeds its private size boundary.",
    );
  }
  writeAtomic(
    cutoverWriteAheadPath(plan),
    bytes,
    beforeMutation,
    ({ filePath, temporaryPath, cleanup = false }) =>
      checkpoint("write-ahead-temporary-durable", {
        filePath,
        temporaryPath,
        cleanup,
        operationId: record.operationId,
        operationName: record.operationName,
        phase: record.phase,
        scope: record.scope,
      }),
  );
}

function clearWriteAheadRecord(
  plan,
  checkpoint,
  checkpointName,
  details = {},
  beforeMutation = () => undefined,
  expectedRecord = undefined,
  beforeUnlinkCheckpointName = "",
) {
  const filePath = cutoverWriteAheadPath(plan);
  if (existsSync(filePath)) {
    const expectedBytes =
      expectedRecord === undefined
        ? readPrivateMode600File(filePath, CUTOVER_WRITE_AHEAD_MAX_BYTES)
        : prettyJsonBytes(expectedRecord);
    const pinned = openPinnedPrivateFile(filePath, {
      maxBytes: CUTOVER_WRITE_AHEAD_MAX_BYTES,
      expectedBytes,
    });
    try {
      if (beforeUnlinkCheckpointName !== "") {
        checkpoint(beforeUnlinkCheckpointName, {
          ...details,
          writeAheadPath: filePath,
        });
        requirePinnedPrivateFile(
          filePath,
          pinned.descriptor,
          pinned.identity,
          expectedBytes,
        );
      }
      beforeMutation();
      requirePinnedPrivateFile(
        filePath,
        pinned.descriptor,
        pinned.identity,
        expectedBytes,
      );
      retirePinnedPrivateFile(filePath, pinned, {
        retirementDirectory: cutoverRetirementDirectory(
          plan,
          "write-ahead",
        ),
        beforeMutation,
      });
      checkpoint(checkpointName, { ...details, writeAheadPath: filePath });
      if (existsSync(filePath)) {
        fail(
          "cutover_write_ahead_conflict",
          "Kernel guard write-ahead path survived exact retirement.",
        );
      }
    } finally {
      closeSync(pinned.descriptor);
    }
  }
  syncDirectory(path.dirname(filePath));
}

function writeImmutable(
  filePath,
  bytes,
  {
    checkpoint = () => undefined,
    linkedCheckpointName = "",
    beforeMutation = () => undefined,
    beforeFinalize = () => undefined,
    retirementDirectory,
  } = {},
) {
  if (
    typeof retirementDirectory !== "string" ||
    !path.isAbsolute(retirementDirectory)
  ) {
    fail(
      "cutover_conflict",
      `Cutover immutable retirement directory is unavailable for ${filePath}.`,
    );
  }
  ensurePrivateDirectory(path.dirname(filePath), beforeMutation);
  const temporaryPath = `${filePath}.cutover.tmp`;
  if (existsSync(filePath)) {
    const retainedState = inspectRetainedHardLinkPublication(
      filePath,
      temporaryPath,
      bytes,
      retirementDirectory,
    );
    if (retainedState.relevant) {
      retirePublishedHardLinks(filePath, temporaryPath, bytes, {
        retirementDirectory,
        beforeMutation,
      });
      const existing = readPrivateMode600File(filePath, bytes.length);
      if (!existing.equals(bytes)) {
        fail("cutover_conflict", `Cutover artifact conflicts at ${filePath}.`);
      }
      syncDirectory(path.dirname(filePath));
      return;
    }
    if (existsSync(temporaryPath)) {
      let pinned;
      try {
        pinned = openPinnedPrivateFile(temporaryPath, {
          maxBytes: bytes.length,
          expectedBytes: bytes,
          allowedLinkCounts: new Set([2]),
        });
        requirePinnedPrivateFile(
          filePath,
          pinned.descriptor,
          pinned.identity,
          bytes,
          new Set([2]),
        );
        beforeFinalize();
        requirePinnedPrivateFile(
          filePath,
          pinned.descriptor,
          pinned.identity,
          bytes,
          new Set([2]),
        );
        requirePinnedPrivateFile(
          temporaryPath,
          pinned.descriptor,
          pinned.identity,
          bytes,
          new Set([2]),
        );
        beforeMutation();
        requirePinnedPrivateFile(
          filePath,
          pinned.descriptor,
          pinned.identity,
          bytes,
          new Set([2]),
        );
        requirePinnedPrivateFile(
          temporaryPath,
          pinned.descriptor,
          pinned.identity,
          bytes,
          new Set([2]),
        );
        retirePublishedHardLinks(filePath, temporaryPath, bytes, {
          retirementDirectory,
          beforeMutation,
        });
        syncDirectory(path.dirname(filePath));
      } catch (error) {
        if (error instanceof AutomationControlError) throw error;
        fail(
          "cutover_conflict",
          `Cutover artifact recovery conflicts at ${filePath}.`,
        );
      } finally {
        if (pinned !== undefined) closeSync(pinned.descriptor);
      }
    }
    const existing = readPrivateMode600File(filePath, bytes.length);
    if (!existing.equals(bytes)) {
      fail("cutover_conflict", `Cutover artifact conflicts at ${filePath}.`);
    }
    syncDirectory(path.dirname(filePath));
    return;
  }
  let descriptor;
  let pinned;
  try {
    if (existsSync(temporaryPath)) {
      pinned = openPinnedPrivateFile(temporaryPath, {
        maxBytes: bytes.length,
        expectedBytes: bytes,
      });
    }
    if (!existsSync(temporaryPath)) {
      beforeMutation();
      descriptor = openSync(
        temporaryPath,
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(descriptor, bytes);
      fchmodSync(descriptor, 0o600);
      fsyncSync(descriptor);
      pinned = {
        descriptor,
        identity: pinnedFileIdentity(fstatSync(descriptor)),
        bytes,
      };
    }
    try {
      beforeMutation();
      requirePinnedPrivateFile(
        temporaryPath,
        pinned.descriptor,
        pinned.identity,
        bytes,
      );
      if (existsSync(filePath)) {
        fail("cutover_conflict", `Cutover artifact conflicts at ${filePath}.`);
      }
      linkSync(temporaryPath, filePath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readPrivateMode600File(
        filePath,
        bytes.length,
        new Set([1, 2]),
      );
      if (!existing.equals(bytes)) {
        fail("cutover_conflict", `Cutover artifact conflicts at ${filePath}.`);
      }
    }
    requirePinnedPrivateFile(
      filePath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    requirePinnedPrivateFile(
      temporaryPath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    if (linkedCheckpointName !== "") {
      checkpoint(linkedCheckpointName, { filePath, temporaryPath });
      requirePinnedPrivateFile(
        filePath,
        pinned.descriptor,
        pinned.identity,
        bytes,
        new Set([2]),
      );
      requirePinnedPrivateFile(
        temporaryPath,
        pinned.descriptor,
        pinned.identity,
        bytes,
        new Set([2]),
      );
    }
    beforeFinalize();
    requirePinnedPrivateFile(
      filePath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    requirePinnedPrivateFile(
      temporaryPath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    beforeMutation();
    requirePinnedPrivateFile(
      filePath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    requirePinnedPrivateFile(
      temporaryPath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    retirePublishedHardLinks(filePath, temporaryPath, bytes, {
      retirementDirectory,
      beforeMutation,
    });
    syncDirectory(path.dirname(filePath));
  } finally {
    if (pinned !== undefined) closeSync(pinned.descriptor);
    else if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requireImmutableTargetPreflight(
  filePath,
  bytes,
  retirementDirectory,
) {
  const temporaryPath = `${filePath}.cutover.tmp`;
  const retainedState = inspectRetainedHardLinkPublication(
    filePath,
    temporaryPath,
    bytes,
    retirementDirectory,
  );
  if (retainedState.relevant) return;
  const finalExists = existsSync(filePath);
  const temporaryExists = existsSync(temporaryPath);
  if (!finalExists && !temporaryExists) return;
  if (finalExists && temporaryExists) {
    const finalStats = lstatSync(filePath);
    const temporaryStats = lstatSync(temporaryPath);
    if (
      !finalStats.isFile() ||
      !temporaryStats.isFile() ||
      finalStats.isSymbolicLink() ||
      temporaryStats.isSymbolicLink() ||
      finalStats.dev !== temporaryStats.dev ||
      finalStats.ino !== temporaryStats.ino ||
      finalStats.nlink !== 2 ||
      temporaryStats.nlink !== 2 ||
      !readPrivateMode600File(filePath, bytes.length, new Set([2])).equals(
        bytes,
      )
    ) {
      fail(
        "cutover_conflict",
        `Cutover artifact recovery conflicts at ${filePath}.`,
      );
    }
    return;
  }
  if (finalExists) {
    if (!readPrivateMode600File(filePath, bytes.length).equals(bytes)) {
      fail("cutover_conflict", `Cutover artifact conflicts at ${filePath}.`);
    }
    return;
  }
  if (!readPrivateMode600File(temporaryPath, bytes.length).equals(bytes)) {
    fail(
      "cutover_conflict",
      `Cutover artifact temporary bytes conflict at ${filePath}.`,
    );
  }
}

function requireIdentifier(value, label) {
  if (!IDENTIFIER_PATTERN.test(String(value ?? ""))) {
    fail("cutover_argument_invalid", `${label} is invalid.`);
  }
  return String(value);
}

function requireSha(value, label) {
  if (!SHA256_PATTERN.test(String(value ?? ""))) {
    fail("cutover_argument_invalid", `${label} must be one SHA-256 digest.`);
  }
  return String(value);
}

function archivedEvidencePaths(entry, targetPath) {
  const paths = [];
  const pending = [{ entry, targetPath, depth: 0 }];
  let admittedEntries = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    admittedEntries += 1;
    if (
      admittedEntries > CUTOVER_SNAPSHOT_MAX_ENTRIES ||
      current.depth > CUTOVER_SNAPSHOT_MAX_DEPTH
    ) {
      fail(
        "cutover_plan_invalid",
        "Kernel guard cutover evidence expansion exceeds its snapshot boundary.",
      );
    }
    paths.push(current.targetPath);
    if (current.entry?.kind === "file") {
      paths.push(`${current.targetPath}.cutover.tmp`);
      continue;
    }
    if (current.entry?.kind === "missing") continue;
    if (
      current.entry?.kind !== "directory" ||
      !Array.isArray(current.entry.entries)
    ) {
      fail(
        "cutover_plan_invalid",
        "Kernel guard cutover evidence snapshot has an invalid entry.",
      );
    }
    if (
      admittedEntries + current.entry.entries.length >
      CUTOVER_SNAPSHOT_MAX_ENTRIES
    ) {
      fail(
        "cutover_plan_invalid",
        "Kernel guard cutover evidence expansion exceeds its snapshot boundary.",
      );
    }
    for (let index = current.entry.entries.length - 1; index >= 0; index -= 1) {
      const child = current.entry.entries[index];
      if (typeof child?.path !== "string") {
        fail(
          "cutover_plan_invalid",
          "Kernel guard cutover evidence snapshot has an invalid child path.",
        );
      }
      pending.push({
        entry: child,
        targetPath: path.join(
          current.targetPath,
          path.basename(child.path),
        ),
        depth: current.depth + 1,
      });
    }
  }
  return paths;
}

function exactCutoverEvidenceFilesystemPaths(
  plan,
  { supersedePlan = undefined, transaction = undefined } = {},
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const directory = artifactDirectory(plan);
  const legacyRoot = path.join(directory, "legacy-paths");
  const authorizations = path.join(directory, "authorizations");
  const candidates = [
    directory,
    path.join(directory, "plan.json"),
    path.join(directory, "source-snapshot.json"),
    path.join(directory, "legacy-locks.json"),
    legacyRoot,
    path.join(directory, "receipt.json"),
    authorizations,
    path.join(authorizations, "prepared-authorization.json"),
    cutoverQuarantineRoot(plan),
    cutoverRetirementRoot(plan),
    cutoverRetirementDirectory(plan, "immutable-hard-links"),
    ...archivedEvidencePaths(
      sourceEntry(plan, paths.writerLock),
      path.join(legacyRoot, "outcomes.jsonl.writer-lock"),
    ),
    ...archivedEvidencePaths(
      sourceEntry(plan, paths.guardsRoot),
      path.join(legacyRoot, "guards"),
    ),
  ];
  if (Array.isArray(transaction?.authorizations)) {
    candidates.push(
      ...transaction.authorizations
        .map((authorization) => authorization?.confirmationArtifact)
        .filter((filePath) => typeof filePath === "string"),
    );
  }
  if (supersedePlan !== undefined) {
    const evidence = supersedeEvidencePaths(plan, supersedePlan);
    candidates.push(
      path.dirname(evidence.directory),
      evidence.directory,
      evidence.plan,
      evidence.transaction,
      evidence.receipt,
    );
  }
  return candidates.flatMap((filePath) => [
    filePath,
    `${filePath}.cutover.tmp`,
  ]);
}

function inspectAutomationKernelGuardCutoverFilesystemAdmission(
  {
    stateRoot,
    plan = undefined,
    supersedePlan = undefined,
    transaction = undefined,
    extraPaths = [],
  },
  { resolveFilesystemType = undefined } = {},
) {
  const paths = automationKernelGuardCutoverPaths(stateRoot);
  return inspectAutomationKernelGuardFilesystemPaths(
    paths.stateRoot,
    [
      paths.stateRoot,
      paths.controlRoot,
      paths.guardsRoot,
      paths.globalReceipt,
      `${paths.globalReceipt}.cutover.tmp`,
      paths.transaction,
      `${paths.transaction}.cutover.tmp`,
      paths.writeAhead,
      `${paths.writeAhead}.cutover.tmp`,
      paths.bootstrapLock,
      `${paths.bootstrapLock}.cutover.tmp`,
      paths.writerLock,
      `${paths.writerLock}.cutover.tmp`,
      `${paths.writerLock}.cutover-claim.tmp`,
      path.dirname(paths.artifactRoot),
      paths.artifactRoot,
      ...AUTOMATION_KERNEL_GUARD_NAMES.flatMap((name) => {
        const guard = paths.guards[name];
        return [
          guard.directory,
          guard.owner,
          `${guard.owner}.cutover.tmp`,
          `${guard.owner}.cutover-claim.tmp`,
          guard.inner,
          `${guard.inner}.cutover.tmp`,
        ];
      }),
      ...(plan === undefined
        ? []
        : exactCutoverEvidenceFilesystemPaths(plan, {
            supersedePlan,
            transaction,
          })),
      ...extraPaths,
    ],
    { resolveFilesystemType },
  );
}

export function assertAutomationKernelGuardCutoverFilesystemAdmission(
  {
    stateRoot,
    plan = undefined,
    supersedePlan = undefined,
    transaction = undefined,
    extraPaths = [],
  },
  options = {},
) {
  const inspection = inspectAutomationKernelGuardCutoverFilesystemAdmission(
    { stateRoot, plan, supersedePlan, transaction, extraPaths },
    options,
  );
  if (!inspection.ready) {
    fail(
      "cutover_filesystem_unsupported",
      `Kernel guard cutover requires one admitted local filesystem: ${inspection.problems.join("; ")}`,
    );
  }
  return inspection;
}

function requireLocalFilesystem(
  stateRoot,
  {
    plan = undefined,
    supersedePlan = undefined,
    transaction = undefined,
    extraPaths = [],
  } = {},
) {
  return assertAutomationKernelGuardCutoverFilesystemAdmission({
    stateRoot,
    plan,
    supersedePlan,
    transaction,
    extraPaths,
  });
}

function gitOutput(repoRoot, args) {
  return execFileSync("/usr/bin/git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  }).trim();
}

function exactDevIdentity(repoRoot) {
  const canonicalRepoRoot = realpathSync(repoRoot);
  if (
    gitOutput(canonicalRepoRoot, ["rev-parse", "--show-toplevel"]) !==
    canonicalRepoRoot
  ) {
    fail("cutover_repo_invalid", "Cutover repo root is not canonical.");
  }
  if (
    gitOutput(canonicalRepoRoot, [
      "status",
      "--porcelain",
      "--untracked-files=all",
    ]) !== ""
  ) {
    fail(
      "cutover_repo_dirty",
      "Kernel guard cutover requires a clean exact dev worktree.",
    );
  }
  const headSha = gitOutput(canonicalRepoRoot, ["rev-parse", "HEAD"]);
  const devSha = gitOutput(canonicalRepoRoot, ["rev-parse", "origin/dev"]);
  if (headSha !== devSha) {
    fail(
      "cutover_repo_stale",
      "Kernel guard cutover requires HEAD to equal origin/dev.",
    );
  }
  return { repoRoot: canonicalRepoRoot, sourceCodeSha: headSha };
}

function automationTomlPaths(codexHome) {
  return Object.fromEntries(
    ACTOR_IDS.map((actor) => [
      actor,
      path.join(codexHome, "automations", actor, "automation.toml"),
    ]),
  );
}

function requirePausedActors(codexHome) {
  const result = {};
  for (const [actor, automationPath] of Object.entries(
    automationTomlPaths(codexHome),
  )) {
    const bytes = readBoundedRegularFile(automationPath, 1024 * 1024);
    let text;
    try {
      text = fatalDecoder.decode(bytes);
    } catch {
      fail("cutover_actor_invalid", `Saved actor ${actor} is not fatal UTF-8.`);
    }
    const matches = [...text.matchAll(/^status\s*=\s*"([^"]+)"\s*$/gm)];
    if (matches.length !== 1 || matches[0][1] !== "PAUSED") {
      fail(
        "cutover_actor_active",
        `Saved actor ${actor} must be exactly PAUSED before cutover.`,
      );
    }
    result[actor] = { path: automationPath, digest: sha256(bytes) };
  }
  return result;
}

function newSnapshotBudget() {
  return { entries: 0, aggregateBytes: 0 };
}

function parseNativeSnapshotCount(value, label, maximum) {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(value)
  ) {
    fail("cutover_state_invalid", `${label} is not a canonical count.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    fail("cutover_state_invalid", `${label} exceeds its boundary.`);
  }
  return parsed;
}

function requireNativeSnapshotName(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\0") ||
    Buffer.from(value, "utf8").toString("utf8") !== value
  ) {
    fail("cutover_state_invalid", `${label} is not one canonical entry name.`);
  }
  return value;
}

function nativeSnapshotEntryKeys(entry) {
  return Object.keys(entry).sort().join("\0");
}

function convertNativeSnapshotEntry(
  entry,
  targetPath,
  { includeBytes, depth = 0 },
) {
  if (
    entry === null ||
    typeof entry !== "object" ||
    Array.isArray(entry) ||
    depth > CUTOVER_SNAPSHOT_MAX_DEPTH
  ) {
    fail("cutover_state_invalid", `Cutover snapshot receipt is invalid: ${targetPath}`);
  }
  const name = requireNativeSnapshotName(entry.name, "Cutover snapshot name");
  if (name !== path.basename(targetPath)) {
    fail("cutover_state_invalid", `Cutover snapshot receipt changed its target: ${targetPath}`);
  }
  if (entry.kind === "missing") {
    if (nativeSnapshotEntryKeys(entry) !== "kind\0name") {
      fail("cutover_state_invalid", `Cutover missing snapshot receipt is invalid: ${targetPath}`);
    }
    return { entry: { path: targetPath, kind: "missing" }, entries: 1, bytes: 0 };
  }
  if (entry.kind === "file") {
    const expectedKeys = includeBytes
      ? "bytesBase64\0digest\0kind\0mode\0name\0size"
      : "digest\0kind\0mode\0name\0size";
    if (
      nativeSnapshotEntryKeys(entry) !== expectedKeys ||
      ![0o600, 0o640, 0o644].includes(entry.mode) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > CUTOVER_MAX_FILE_BYTES ||
      !SHA256_PATTERN.test(String(entry.digest ?? ""))
    ) {
      fail("cutover_state_invalid", `Cutover file snapshot receipt is invalid: ${targetPath}`);
    }
    if (includeBytes) {
      if (typeof entry.bytesBase64 !== "string") {
        fail("cutover_state_invalid", `Cutover file snapshot bytes are invalid: ${targetPath}`);
      }
      const decoded = Buffer.from(entry.bytesBase64, "base64");
      if (
        decoded.length !== entry.size ||
        decoded.toString("base64") !== entry.bytesBase64 ||
        sha256(decoded) !== entry.digest
      ) {
        fail("cutover_state_invalid", `Cutover file snapshot bytes are invalid: ${targetPath}`);
      }
    }
    return {
      entry: {
        path: targetPath,
        kind: "file",
        mode: entry.mode,
        size: entry.size,
        digest: entry.digest,
        ...(includeBytes ? { bytesBase64: entry.bytesBase64 } : {}),
      },
      entries: 1,
      bytes: entry.size,
    };
  }
  if (
    entry.kind !== "directory" ||
    nativeSnapshotEntryKeys(entry) !== "entries\0kind\0mode\0name" ||
    ![0o700, 0o755].includes(entry.mode) ||
    !Array.isArray(entry.entries)
  ) {
    fail("cutover_state_invalid", `Cutover directory snapshot receipt is invalid: ${targetPath}`);
  }
  const convertedEntries = [];
  let admittedEntries = 1;
  let aggregateBytes = 0;
  let priorNameBytes = null;
  for (const child of entry.entries) {
    const childName = requireNativeSnapshotName(
      child?.name,
      "Cutover snapshot child name",
    );
    const nameBytes = Buffer.from(childName, "utf8");
    if (priorNameBytes !== null && Buffer.compare(priorNameBytes, nameBytes) >= 0) {
      fail("cutover_state_invalid", `Cutover snapshot entries are not canonical: ${targetPath}`);
    }
    priorNameBytes = nameBytes;
    const converted = convertNativeSnapshotEntry(
      child,
      path.join(targetPath, childName),
      { includeBytes, depth: depth + 1 },
    );
    admittedEntries += converted.entries;
    aggregateBytes += converted.bytes;
    if (
      !Number.isSafeInteger(admittedEntries) ||
      admittedEntries > CUTOVER_SNAPSHOT_MAX_ENTRIES ||
      !Number.isSafeInteger(aggregateBytes) ||
      aggregateBytes > CUTOVER_SNAPSHOT_MAX_AGGREGATE_BYTES
    ) {
      fail("cutover_state_invalid", `Cutover snapshot receipt exceeds its boundary: ${targetPath}`);
    }
    convertedEntries.push(converted.entry);
  }
  const converted = {
    path: targetPath,
    kind: "directory",
    mode: entry.mode,
    entries: convertedEntries,
  };
  converted.nativeTreeDigest =
    automationKernelGuardSnapshotNativeTreeDigest(converted);
  return { entry: converted, entries: admittedEntries, bytes: aggregateBytes };
}

function assertSnapshotTreeAdmission(
  entries,
  {
    code = "cutover_plan_invalid",
    message = "Kernel guard cutover snapshot exceeds its bounded admission.",
  } = {},
) {
  if (!Array.isArray(entries)) fail(code, message);
  const pending = entries.map((entry) => ({ entry, depth: 0 }));
  const admittedDirectories = [];
  let admittedEntries = 0;
  let aggregateBytes = 0;
  while (pending.length > 0) {
    const { entry, depth } = pending.pop();
    admittedEntries += 1;
    if (
      admittedEntries > CUTOVER_SNAPSHOT_MAX_ENTRIES ||
      depth > CUTOVER_SNAPSHOT_MAX_DEPTH ||
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.path !== "string"
    ) {
      fail(code, message);
    }
    if (entry.kind === "file") {
      if (
        ![0o600, 0o640, 0o644].includes(entry.mode) ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0 ||
        entry.size > CUTOVER_MAX_FILE_BYTES ||
        !SHA256_PATTERN.test(String(entry.digest ?? ""))
      ) {
        fail(code, message);
      }
      aggregateBytes += entry.size;
      if (
        !Number.isSafeInteger(aggregateBytes) ||
        aggregateBytes > CUTOVER_SNAPSHOT_MAX_AGGREGATE_BYTES
      ) {
        fail(code, message);
      }
      if (Object.hasOwn(entry, "bytesBase64")) {
        if (typeof entry.bytesBase64 !== "string") fail(code, message);
        const decodedBytes = Buffer.from(entry.bytesBase64, "base64");
        if (
          decodedBytes.toString("base64") !== entry.bytesBase64 ||
          decodedBytes.length !== entry.size ||
          sha256(decodedBytes) !== entry.digest
        ) {
          fail(code, message);
        }
      }
      continue;
    }
    if (entry.kind === "missing") continue;
    if (
      entry.kind !== "directory" ||
      ![0o700, 0o755].includes(entry.mode) ||
      !Array.isArray(entry.entries) ||
      !SHA256_PATTERN.test(String(entry.nativeTreeDigest ?? ""))
    ) {
      fail(code, message);
    }
    admittedDirectories.push(entry);
    if (admittedEntries + entry.entries.length > CUTOVER_SNAPSHOT_MAX_ENTRIES) {
      fail(code, message);
    }
    let priorNameBytes = null;
    for (const child of entry.entries) {
      if (
        child === null ||
        typeof child !== "object" ||
        Array.isArray(child) ||
        typeof child.path !== "string" ||
        path.dirname(child.path) !== entry.path
      ) {
        fail(code, message);
      }
      const childName = path.basename(child.path);
      try {
        requireNativeSnapshotName(childName, "Cutover snapshot child name");
      } catch {
        fail(code, message);
      }
      const nameBytes = Buffer.from(childName, "utf8");
      if (priorNameBytes !== null && Buffer.compare(priorNameBytes, nameBytes) >= 0) {
        fail(code, message);
      }
      priorNameBytes = nameBytes;
      pending.push({ entry: child, depth: depth + 1 });
    }
  }
  for (const directory of admittedDirectories) {
    if (
      automationKernelGuardSnapshotNativeTreeDigest(directory) !==
      directory.nativeTreeDigest
    ) {
      fail(code, message);
    }
  }
  return { entries: admittedEntries, aggregateBytes };
}

function snapshotPath(
  targetPath,
  {
    includeBytes = true,
    maxBytes = CUTOVER_MAX_FILE_BYTES,
    budget = newSnapshotBudget(),
    depth = 0,
  } = {},
) {
  if (
    budget === null ||
    typeof budget !== "object" ||
    !Number.isSafeInteger(budget.entries) ||
    budget.entries < 0 ||
    budget.entries > CUTOVER_SNAPSHOT_MAX_ENTRIES ||
    !Number.isSafeInteger(budget.aggregateBytes) ||
    budget.aggregateBytes < 0 ||
    budget.aggregateBytes > CUTOVER_SNAPSHOT_MAX_AGGREGATE_BYTES ||
    !Number.isSafeInteger(depth) ||
    depth < 0 ||
    depth > CUTOVER_SNAPSHOT_MAX_DEPTH ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > CUTOVER_MAX_FILE_BYTES
  ) {
    fail(
      "cutover_state_invalid",
      `Cutover source exceeds its bounded snapshot admission: ${targetPath}`,
    );
  }
  const absoluteTarget = path.resolve(targetPath);
  const parentPath = path.dirname(absoluteTarget);
  const targetName = path.basename(absoluteTarget);
  requireNativeSnapshotName(targetName, "Cutover snapshot target name");
  const pinnedParent = openPinnedSnapshotDirectoryPath(
    parentPath,
    "Cutover snapshot parent",
  );
  try {
    const remainingEntries = CUTOVER_SNAPSHOT_MAX_ENTRIES - budget.entries;
    const remainingBytes =
      CUTOVER_SNAPSHOT_MAX_AGGREGATE_BYTES - budget.aggregateBytes;
    let receipt;
    try {
      receipt = runCutoverNativeHelper(
        "snapshot-tree",
        [
          targetName,
          includeBytes ? "1" : "0",
          String(maxBytes),
          String(remainingEntries),
          String(CUTOVER_SNAPSHOT_MAX_DEPTH - depth),
          String(remainingBytes),
          String(CUTOVER_SNAPSHOT_MAX_AGGREGATE_BYTES),
          String(pinnedParent.identity.dev),
          String(pinnedParent.identity.ino),
          String(pinnedParent.identity.mode),
        ],
        [pinnedParent.descriptor],
        { maxBuffer: CUTOVER_SNAPSHOT_MAX_AGGREGATE_BYTES },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/depth boundary/.test(detail)) {
        fail(
          "cutover_state_invalid",
          `Cutover source exceeds the ${CUTOVER_SNAPSHOT_MAX_DEPTH.toLocaleString()} level snapshot depth limit: ${targetPath}`,
        );
      }
      if (/entry boundary/.test(detail)) {
        fail(
          "cutover_state_invalid",
          `Cutover source exceeds the ${CUTOVER_SNAPSHOT_MAX_ENTRIES.toLocaleString()} entry snapshot limit: ${targetPath}`,
        );
      }
      if (/aggregate byte boundary/.test(detail)) {
        fail(
          "cutover_state_invalid",
          `Cutover source exceeds the ${CUTOVER_SNAPSHOT_MAX_AGGREGATE_BYTES.toLocaleString()} byte aggregate snapshot limit: ${targetPath}`,
        );
      }
      throw error;
    }
    requirePinnedSnapshotDirectoryPath(
      parentPath,
      pinnedParent,
      "Cutover snapshot parent",
    );
    if (
      receipt.operation !== "snapshot-tree" ||
      receipt.parentDevice !== String(pinnedParent.identity.dev) ||
      receipt.parentInode !== String(pinnedParent.identity.ino) ||
      receipt.parentMode !== String(pinnedParent.identity.mode)
    ) {
      fail("cutover_state_invalid", `Cutover snapshot receipt changed: ${targetPath}`);
    }
    const converted = convertNativeSnapshotEntry(receipt.entry, absoluteTarget, {
      includeBytes,
      depth,
    });
    const entryCount = parseNativeSnapshotCount(
      receipt.entryCount,
      "Cutover snapshot entry count",
      remainingEntries,
    );
    const aggregateBytes = parseNativeSnapshotCount(
      receipt.aggregateBytes,
      "Cutover snapshot aggregate bytes",
      remainingBytes,
    );
    const expectedTreeDigest =
      converted.entry.kind === "directory"
        ? converted.entry.nativeTreeDigest
        : null;
    if (
      entryCount !== converted.entries ||
      aggregateBytes !== converted.bytes ||
      receipt.treeDigest !== expectedTreeDigest
    ) {
      fail("cutover_state_invalid", `Cutover snapshot receipt is inconsistent: ${targetPath}`);
    }
    budget.entries += entryCount;
    budget.aggregateBytes += aggregateBytes;
    return converted.entry;
  } finally {
    closeSync(pinnedParent.descriptor);
  }
}

function requireLegacySourceShape(paths, entries) {
  const writer = entries.find((entry) => entry.path === paths.writerLock);
  if (!writer || !["missing", "file"].includes(writer.kind)) {
    fail(
      "cutover_state_invalid",
      "The legacy outcome writer path has an unsupported shape.",
    );
  }
  const guards = entries.find((entry) => entry.path === paths.guardsRoot);
  if (guards?.kind !== "directory") {
    fail("cutover_state_invalid", "The legacy guard root is unavailable.");
  }
  const canonicalNames = new Set(
    AUTOMATION_KERNEL_GUARD_NAMES.map((name) => `${name}.lock`),
  );
  for (const entry of guards.entries) {
    const name = path.basename(entry.path);
    const abandonedBase = [...canonicalNames].find((candidate) =>
      name.startsWith(`${candidate}.abandoned.`),
    );
    if (
      entry.kind !== "directory" ||
      (!canonicalNames.has(name) && abandonedBase === undefined)
    ) {
      fail(
        "cutover_state_invalid",
        `Legacy guard entry has an unsupported shape: ${entry.path}`,
      );
    }
  }
}

function snapshotCutoverSource({ stateRoot, codexHome, repoRoot }) {
  const paths = automationKernelGuardCutoverPaths(stateRoot);
  requirePrivateDirectory(paths.stateRoot, "Automation state root");
  requirePrivateDirectory(paths.controlRoot, "Automation control root");
  requirePrivateDirectory(paths.guardsRoot, "Automation guard root");
  const repo = exactDevIdentity(repoRoot);
  const actors = requirePausedActors(codexHome);
  const budget = newSnapshotBudget();
  const entries = [
    snapshotPath(path.join(paths.controlRoot, "current-tasks.json"), {
      budget,
    }),
    snapshotPath(path.join(paths.controlRoot, "events.jsonl"), {
      includeBytes: false,
      budget,
    }),
    snapshotPath(path.join(paths.stateRoot, "outcomes.jsonl"), {
      includeBytes: false,
      maxBytes: 16 * 1024 * 1024,
      budget,
    }),
    snapshotPath(path.join(paths.controlRoot, "leases"), { budget }),
    snapshotPath(paths.guardsRoot, { budget }),
    snapshotPath(paths.writerLock, { budget }),
    ...Object.values(actors).map((actor) =>
      snapshotPath(actor.path, { budget }),
    ),
  ];
  requireLegacySourceShape(paths, entries);
  const legacyEntries = entries.filter(
    (entry) =>
      entry.path === paths.writerLock || entry.path === paths.guardsRoot,
  );
  const snapshot = {
    schemaVersion: 1,
    stateRoot: paths.stateRoot,
    codexHome,
    repoRoot: repo.repoRoot,
    sourceCodeSha: repo.sourceCodeSha,
    actors,
    entries,
  };
  return {
    snapshot,
    snapshotDigest: sha256(canonicalJsonBytes(snapshot)),
    archiveManifestDigest: sha256(
      canonicalJsonBytes({ schemaVersion: 1, entries: legacyEntries }),
    ),
  };
}

function requireCanonicalTask(snapshot, taskId) {
  const manifestEntry = snapshot.entries.find((entry) =>
    entry.path.endsWith("/control/current-tasks.json"),
  );
  const inspection = inspectAutomationKernelGuardCanonicalTaskSource(
    manifestEntry,
    taskId,
  );
  if (!inspection.ready) {
    const missing = inspection.problems.some((problem) =>
      problem.includes(`Canonical task ${taskId} does not exist`),
    );
    fail(
      missing ? "cutover_task_missing" : "cutover_task_invalid",
      `Canonical task admission failed: ${inspection.problems.join("; ")}`,
    );
  }
}

function cutoverParameters({
  stateRoot,
  codexHome,
  repoRoot,
  sourceCodeSha,
  sourceSnapshotDigest,
  archiveManifestDigest,
  cutoverId,
}) {
  return {
    schemaVersion: 1,
    policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
    stateRoot,
    codexHome,
    repoRoot,
    sourceCodeSha,
    sourceSnapshotDigest,
    archiveManifestDigest,
    cutoverId,
    markerDigest: AUTOMATION_KERNEL_GUARD_MARKER_DIGEST,
    guardNames: [...AUTOMATION_KERNEL_GUARD_NAMES],
  };
}

function cutoverIdFor({
  taskId,
  sourceSnapshotDigest,
  archiveManifestDigest,
  sourceCodeSha,
}) {
  return sha256(
    canonicalJsonBytes({
      policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
      taskId,
      sourceSnapshotDigest,
      archiveManifestDigest,
      sourceCodeSha,
    }),
  );
}

export function planAutomationKernelGuardCutover({
  stateRoot,
  taskId,
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  repoRoot = REPO_ROOT,
  nowMs = Date.now(),
}) {
  const canonicalStateRoot = realpathSync(stateRoot);
  const canonicalCodexHome = realpathSync(codexHome);
  requireLocalFilesystem(canonicalStateRoot);
  const normalizedTaskId = requireIdentifier(taskId, "taskId");
  const source = snapshotCutoverSource({
    stateRoot: canonicalStateRoot,
    codexHome: canonicalCodexHome,
    repoRoot,
  });
  requireCanonicalTask(source.snapshot, normalizedTaskId);
  const cutoverId = cutoverIdFor({
    taskId: normalizedTaskId,
    sourceSnapshotDigest: source.snapshotDigest,
    archiveManifestDigest: source.archiveManifestDigest,
    sourceCodeSha: source.snapshot.sourceCodeSha,
  });
  const parameters = cutoverParameters({
    stateRoot: canonicalStateRoot,
    codexHome: canonicalCodexHome,
    repoRoot: source.snapshot.repoRoot,
    sourceCodeSha: source.snapshot.sourceCodeSha,
    sourceSnapshotDigest: source.snapshotDigest,
    archiveManifestDigest: source.archiveManifestDigest,
    cutoverId,
  });
  const intent = {
    schemaVersion: 1,
    action: CUTOVER_ACTION,
    taskId: normalizedTaskId,
    parameters,
  };
  const plan = normalizePlan({
    schemaVersion: CUTOVER_SCHEMA_VERSION,
    kind: CUTOVER_PLAN_KIND,
    action: "automation-guard.cutover.plan",
    createdAt: new Date(nowMs).toISOString(),
    taskId: normalizedTaskId,
    parameters,
    sourceSnapshot: source.snapshot,
    intent,
    intentDigest: ownerGovernanceIntentDigest(intent),
  });
  requireLocalFilesystem(canonicalStateRoot, { plan });
  return plan;
}

function normalizePlan(rawPlan) {
  const plan = immutableCanonicalJsonValue(
    rawPlan,
    "cutover_plan_invalid",
    "Kernel guard cutover plan is invalid.",
  );
  assertAutomationKernelGuardCutoverPlanSize(prettyJsonBytes(plan));
  assertSnapshotTreeAdmission(plan?.sourceSnapshot?.entries);
  if (
    plan?.schemaVersion !== CUTOVER_SCHEMA_VERSION ||
    plan?.kind !== CUTOVER_PLAN_KIND ||
    plan?.action !== "automation-guard.cutover.plan" ||
    !IDENTIFIER_PATTERN.test(String(plan?.taskId ?? "")) ||
    plan?.intent?.action !== CUTOVER_ACTION ||
    plan.intent.taskId !== plan.taskId ||
    stableJson(plan.intent.parameters) !== stableJson(plan.parameters) ||
    ownerGovernanceIntentDigest(plan.intent) !== plan.intentDigest ||
    plan.parameters?.policy !== AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY ||
    !SHA256_PATTERN.test(String(plan.parameters?.cutoverId ?? "")) ||
    plan.parameters?.markerDigest !== AUTOMATION_KERNEL_GUARD_MARKER_DIGEST ||
    !Array.isArray(plan.parameters?.guardNames) ||
    plan.parameters.guardNames.join("\n") !==
      AUTOMATION_KERNEL_GUARD_NAMES.join("\n") ||
    !SHA256_PATTERN.test(String(plan.parameters?.sourceSnapshotDigest ?? "")) ||
    !SHA256_PATTERN.test(
      String(plan.parameters?.archiveManifestDigest ?? ""),
    ) ||
    !GIT_OBJECT_ID_PATTERN.test(String(plan.parameters?.sourceCodeSha ?? "")) ||
    sha256(canonicalJsonBytes(plan.sourceSnapshot)) !==
      plan.parameters.sourceSnapshotDigest
  ) {
    fail("cutover_plan_invalid", "Kernel guard cutover plan is invalid.");
  }
  const expectedPlanKeys = [
    "action",
    "createdAt",
    "intent",
    "intentDigest",
    "kind",
    "parameters",
    "schemaVersion",
    "sourceSnapshot",
    "taskId",
  ].sort();
  const expectedParameterKeys = [
    "archiveManifestDigest",
    "codexHome",
    "cutoverId",
    "guardNames",
    "markerDigest",
    "policy",
    "repoRoot",
    "schemaVersion",
    "sourceCodeSha",
    "sourceSnapshotDigest",
    "stateRoot",
  ].sort();
  const expectedIntentKeys = [
    "action",
    "parameters",
    "schemaVersion",
    "taskId",
  ].sort();
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const expectedArchiveDigest = sha256(
    canonicalJsonBytes(legacyManifest(plan)),
  );
  const expectedCutoverId = cutoverIdFor({
    taskId: plan.taskId,
    sourceSnapshotDigest: plan.parameters.sourceSnapshotDigest,
    archiveManifestDigest: plan.parameters.archiveManifestDigest,
    sourceCodeSha: plan.parameters.sourceCodeSha,
  });
  if (
    Object.keys(plan).sort().join("\n") !== expectedPlanKeys.join("\n") ||
    Object.keys(plan.parameters).sort().join("\n") !==
      expectedParameterKeys.join("\n") ||
    Object.keys(plan.intent).sort().join("\n") !==
      expectedIntentKeys.join("\n") ||
    plan.parameters.schemaVersion !== 1 ||
    plan.intent.schemaVersion !== 1 ||
    !isCanonicalTimestamp(plan.createdAt) ||
    plan.parameters.stateRoot !== paths.stateRoot ||
    plan.sourceSnapshot?.stateRoot !== plan.parameters.stateRoot ||
    plan.sourceSnapshot?.codexHome !== plan.parameters.codexHome ||
    plan.sourceSnapshot?.repoRoot !== plan.parameters.repoRoot ||
    plan.sourceSnapshot?.sourceCodeSha !== plan.parameters.sourceCodeSha ||
    expectedArchiveDigest !== plan.parameters.archiveManifestDigest ||
    expectedCutoverId !== plan.parameters.cutoverId
  ) {
    fail(
      "cutover_plan_invalid",
      "Kernel guard cutover plan is cross-bound inconsistently.",
    );
  }
  requireCanonicalTask(plan.sourceSnapshot, plan.taskId);
  return plan;
}

function currentCanonicalTask(plan) {
  const manifestPath = path.join(
    plan.parameters.stateRoot,
    "control",
    "current-tasks.json",
  );
  let manifest;
  let manifestBytes;
  try {
    manifestBytes = readBoundedRegularFile(manifestPath, 16 * 1024 * 1024);
    manifest = JSON.parse(fatalDecoder.decode(manifestBytes));
  } catch {
    fail(
      "cutover_task_missing",
      "Canonical task manifest is unavailable for cutover supersession.",
    );
  }
  requireCanonicalTask(
    {
      entries: [
        {
          path: manifestPath,
          kind: "file",
          bytesBase64: manifestBytes.toString("base64"),
        },
      ],
    },
    plan.taskId,
  );
  const matches = Array.isArray(manifest?.tasks)
    ? manifest.tasks.filter((task) => task?.taskId === plan.taskId)
    : [];
  if (matches.length !== 1) {
    fail(
      "cutover_task_missing",
      `Canonical task ${plan.taskId} is not uniquely present.`,
    );
  }
  return matches[0];
}

function exactTransactionRecord(plan) {
  const transaction = readTransaction(plan);
  if (transaction === null) return null;
  const bytes = readPrivateMode600File(
    transactionPath(plan),
    CUTOVER_TRANSACTION_MAX_BYTES,
  );
  if (!bytes.equals(prettyJsonBytes(transaction))) {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover transaction bytes are not canonical.",
    );
  }
  return { transaction, bytes };
}

function supersedeIdFor(parameters) {
  return sha256(
    canonicalJsonBytes({
      action: CUTOVER_SUPERSEDE_ACTION,
      archiveManifestDigest: parameters.archiveManifestDigest,
      claimGenerationsDigest: parameters.claimGenerationsDigest,
      currentTaskDigest: parameters.currentTaskDigest,
      cutoverId: parameters.cutoverId,
      oldPlanDigest: parameters.oldPlanDigest,
      sourceSnapshotDigest: parameters.sourceSnapshotDigest,
      stateRoot: parameters.stateRoot,
      taskId: parameters.taskId,
      transactionDigest: parameters.transactionDigest,
      transactionPhase: parameters.transactionPhase,
    }),
  );
}

function normalizeSupersedePlan(rawPlan, oldPlan) {
  const plan = immutableCanonicalJsonValue(
    rawPlan,
    "cutover_supersede_plan_invalid",
    "Kernel guard cutover supersede plan is invalid or inconsistently bound.",
  );
  assertAutomationKernelGuardCutoverPlanSize(prettyJsonBytes(plan));
  const expectedPlanKeys = [
    "action",
    "createdAt",
    "currentTask",
    "intent",
    "intentDigest",
    "kind",
    "parameters",
    "schemaVersion",
    "taskId",
  ].sort();
  const expectedParameterKeys = [
    "archiveManifestDigest",
    "claimGenerationsDigest",
    "currentTaskDigest",
    "cutoverId",
    "oldPlanDigest",
    "policy",
    "schemaVersion",
    "sourceSnapshotDigest",
    "stateRoot",
    "supersedeId",
    "taskId",
    "transactionDigest",
    "transactionPhase",
  ].sort();
  const expectedIntentKeys = [
    "action",
    "parameters",
    "schemaVersion",
    "taskId",
  ].sort();
  const oldPlanDigest = sha256(canonicalJsonBytes(oldPlan));
  const expectedSupersedeId = supersedeIdFor(plan?.parameters ?? {});
  if (
    plan?.schemaVersion !== 1 ||
    plan?.kind !== CUTOVER_SUPERSEDE_PLAN_KIND ||
    plan?.action !== "automation-guard.cutover.supersede.plan" ||
    plan?.taskId !== oldPlan.taskId ||
    !isCanonicalTimestamp(plan?.createdAt) ||
    Object.keys(plan).sort().join("\n") !== expectedPlanKeys.join("\n") ||
    Object.keys(plan?.parameters ?? {})
      .sort()
      .join("\n") !== expectedParameterKeys.join("\n") ||
    Object.keys(plan?.intent ?? {})
      .sort()
      .join("\n") !== expectedIntentKeys.join("\n") ||
    plan.parameters.schemaVersion !== 1 ||
    plan.parameters.policy !== AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY ||
    plan.parameters.taskId !== plan.taskId ||
    plan.parameters.stateRoot !== oldPlan.parameters.stateRoot ||
    plan.parameters.cutoverId !== oldPlan.parameters.cutoverId ||
    plan.parameters.oldPlanDigest !== oldPlanDigest ||
    plan.parameters.sourceSnapshotDigest !==
      oldPlan.parameters.sourceSnapshotDigest ||
    plan.parameters.archiveManifestDigest !==
      oldPlan.parameters.archiveManifestDigest ||
    !["prepared", "claims-installed"].includes(
      plan.parameters.transactionPhase,
    ) ||
    !SHA256_PATTERN.test(String(plan.parameters.transactionDigest ?? "")) ||
    !SHA256_PATTERN.test(
      String(plan.parameters.claimGenerationsDigest ?? ""),
    ) ||
    !SHA256_PATTERN.test(String(plan.parameters.currentTaskDigest ?? "")) ||
    plan.parameters.supersedeId !== expectedSupersedeId ||
    sha256(canonicalJsonBytes(plan.currentTask)) !==
      plan.parameters.currentTaskDigest ||
    plan.currentTask?.taskId !== plan.taskId ||
    plan.intent?.schemaVersion !== 1 ||
    plan.intent.action !== CUTOVER_SUPERSEDE_ACTION ||
    plan.intent.taskId !== plan.taskId ||
    stableJson(plan.intent.parameters) !== stableJson(plan.parameters) ||
    ownerGovernanceIntentDigest(plan.intent) !== plan.intentDigest
  ) {
    fail(
      "cutover_supersede_plan_invalid",
      "Kernel guard cutover supersede plan is invalid or inconsistently bound.",
    );
  }
  return plan;
}

function permanentTargetMarkerPaths(oldPlan) {
  const paths = automationKernelGuardCutoverPaths(oldPlan.parameters.stateRoot);
  return [
    paths.writerLock,
    ...AUTOMATION_KERNEL_GUARD_NAMES.flatMap((name) => {
      const guard = paths.guards[name];
      return [guard.owner, guard.inner];
    }),
  ];
}

function fileContainsMarker(filePath) {
  if (!existsSync(filePath)) return false;
  try {
    return readBoundedRegularFile(
      filePath,
      automationKernelGuardMarkerBytes().length,
      new Set([1, 2]),
    ).equals(automationKernelGuardMarkerBytes());
  } catch {
    return false;
  }
}

function requireSupersedeStillPreMarker(oldPlan) {
  const paths = automationKernelGuardCutoverPaths(oldPlan.parameters.stateRoot);
  if (existsSync(paths.globalReceipt)) {
    fail(
      "cutover_supersede_too_late",
      "An activated kernel guard cutover cannot be superseded.",
    );
  }
  const markerPath = permanentTargetMarkerPaths(oldPlan).find(
    (filePath) =>
      fileContainsMarker(filePath) ||
      fileContainsMarker(`${filePath}.cutover.tmp`),
  );
  if (markerPath !== undefined) {
    fail(
      "cutover_supersede_too_late",
      `Kernel guard conversion already published a permanent marker at ${markerPath}.`,
    );
  }
}

export function planAutomationKernelGuardCutoverSupersede({
  plan: rawOldPlan,
  nowMs = Date.now(),
}) {
  const oldPlan = normalizePlan(rawOldPlan);
  requireLocalFilesystem(oldPlan.parameters.stateRoot, { plan: oldPlan });
  requireNoAmbiguousSupersedeTemporaries(oldPlan);
  requireSupersedeStillPreMarker(oldPlan);
  if (existsSync(cutoverWriteAheadPath(oldPlan))) {
    requireSupersedeWriteAheadScope(readWriteAheadRecord(oldPlan));
  }
  const transactionRecord = exactTransactionRecord(oldPlan);
  requireNoAmbiguousSupersedeTemporaries(oldPlan);
  if (
    transactionRecord === null ||
    !["prepared", "claims-installed"].includes(
      transactionRecord.transaction.phase,
    )
  ) {
    fail(
      "cutover_supersede_too_late",
      "Only a prepared or claims-installed cutover can be superseded.",
    );
  }
  const currentTask = currentCanonicalTask(oldPlan);
  const parameters = {
    schemaVersion: 1,
    policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
    taskId: oldPlan.taskId,
    stateRoot: oldPlan.parameters.stateRoot,
    cutoverId: oldPlan.parameters.cutoverId,
    oldPlanDigest: sha256(canonicalJsonBytes(oldPlan)),
    transactionDigest: sha256(transactionRecord.bytes),
    transactionPhase: transactionRecord.transaction.phase,
    claimGenerationsDigest: sha256(
      canonicalJsonBytes(transactionRecord.transaction.claimGenerations),
    ),
    sourceSnapshotDigest: oldPlan.parameters.sourceSnapshotDigest,
    archiveManifestDigest: oldPlan.parameters.archiveManifestDigest,
    currentTaskDigest: sha256(canonicalJsonBytes(currentTask)),
  };
  parameters.supersedeId = supersedeIdFor(parameters);
  const intent = {
    schemaVersion: 1,
    action: CUTOVER_SUPERSEDE_ACTION,
    taskId: oldPlan.taskId,
    parameters,
  };
  const supersedePlan = normalizeSupersedePlan(
    {
      schemaVersion: 1,
      kind: CUTOVER_SUPERSEDE_PLAN_KIND,
      action: "automation-guard.cutover.supersede.plan",
      createdAt: new Date(nowMs).toISOString(),
      taskId: oldPlan.taskId,
      parameters,
      currentTask,
      intent,
      intentDigest: ownerGovernanceIntentDigest(intent),
    },
    oldPlan,
  );
  requireLocalFilesystem(oldPlan.parameters.stateRoot, {
    plan: oldPlan,
    supersedePlan,
    transaction: transactionRecord.transaction,
  });
  requireNoAmbiguousSupersedeTemporaries(oldPlan);
  return supersedePlan;
}

function snapshotComparisonValue(entry, rootPath = entry?.path) {
  const relativePath =
    typeof entry?.path === "string" && typeof rootPath === "string"
      ? path.relative(rootPath, entry.path)
      : null;
  if (entry?.kind === "directory") {
    return {
      relativePath,
      kind: entry.kind,
      mode: entry.mode,
      nativeTreeDigest: entry.nativeTreeDigest,
      entries: entry.entries.map((child) =>
        snapshotComparisonValue(child, rootPath),
      ),
    };
  }
  if (entry?.kind === "file") {
    return {
      relativePath,
      kind: entry.kind,
      mode: entry.mode,
      size: entry.size,
      digest: entry.digest,
      bytesBase64: entry.bytesBase64,
    };
  }
  return { relativePath, kind: entry?.kind };
}

function snapshotIncludesBytes(entry) {
  if (entry?.kind === "file") return Object.hasOwn(entry, "bytesBase64");
  return Boolean(entry?.entries?.some(snapshotIncludesBytes));
}

function requireSnapshotMatch(expected, actualPath, label) {
  let actual;
  try {
    actual = snapshotPath(actualPath, {
      includeBytes: snapshotIncludesBytes(expected),
      maxBytes:
        expected?.kind === "file" && Number.isSafeInteger(expected.size)
          ? expected.size + 1
          : CUTOVER_MAX_FILE_BYTES,
    });
  } catch (error) {
    fail(
      "cutover_source_drift",
      `${label} cannot be revalidated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    stableJson(snapshotComparisonValue(actual)) !==
    stableJson(snapshotComparisonValue(expected))
  ) {
    fail("cutover_source_drift", `${label} changed after planning.`);
  }
}

function sourceEntry(plan, targetPath) {
  const direct = plan.sourceSnapshot.entries.find(
    (entry) => entry.path === targetPath,
  );
  if (direct) return direct;
  const guardsRoot = automationKernelGuardCutoverPaths(
    plan.parameters.stateRoot,
  ).guardsRoot;
  const guardRootEntry = plan.sourceSnapshot.entries.find(
    (entry) => entry.path === guardsRoot,
  );
  return guardRootEntry?.entries?.find((entry) => entry.path === targetPath);
}

function validateUnmigratedSource(plan) {
  const current = snapshotCutoverSource({
    stateRoot: plan.parameters.stateRoot,
    codexHome: plan.parameters.codexHome,
    repoRoot: plan.parameters.repoRoot,
  });
  requireCanonicalTask(current.snapshot, plan.taskId);
  if (
    current.snapshotDigest !== plan.parameters.sourceSnapshotDigest ||
    current.archiveManifestDigest !== plan.parameters.archiveManifestDigest
  ) {
    fail(
      "cutover_source_drift",
      "Kernel guard cutover source changed after planning.",
    );
  }
}

function validateStaticSource(
  plan,
  {
    allowLeaseRuntimeStorage = false,
    requireCompleteLeaseRuntimeStorage = false,
  } = {},
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const leasesRoot = path.join(paths.controlRoot, "leases");
  for (const expected of plan.sourceSnapshot.entries) {
    if (
      expected.path === paths.writerLock ||
      expected.path === paths.guardsRoot
    ) {
      continue;
    }
    if (allowLeaseRuntimeStorage && expected.path === leasesRoot) {
      if (
        !(
          expected.kind === "missing" ||
          (expected.kind === "directory" &&
            expected.mode === 0o700 &&
            expected.entries.length === 0)
        )
      ) {
        fail(
          "cutover_source_drift",
          "The planned lease root was not empty before terminal runtime initialization.",
        );
      }
      requireTerminalLeaseRuntimeStorage(plan.parameters.stateRoot, {
        requireComplete: requireCompleteLeaseRuntimeStorage,
      });
      continue;
    }
    requireSnapshotMatch(
      expected,
      expected.path,
      `Cutover source ${expected.path}`,
    );
  }
  requireCanonicalTask(plan.sourceSnapshot, plan.taskId);
  requirePausedActors(plan.parameters.codexHome);
  const repo = exactDevIdentity(plan.parameters.repoRoot);
  if (repo.sourceCodeSha !== plan.parameters.sourceCodeSha) {
    fail("cutover_source_drift", "Exact dev identity changed after planning.");
  }
}

function leaseRuntimeStorageLayout(stateRoot) {
  const leases = path.join(stateRoot, "control", "leases");
  const transactions = path.join(leases, LEASE_TRANSACTION_DIRECTORY);
  const receipts = path.join(
    leases,
    LEASE_TRANSACTION_RECEIPT_DIRECTORY,
  );
  const transactionArchive = path.join(
    transactions,
    LEASE_CLEANUP_QUARANTINE_DIRECTORY,
  );
  const receiptArchive = path.join(
    receipts,
    LEASE_CLEANUP_QUARANTINE_DIRECTORY,
  );
  const stateArchive = path.join(leases, LEASE_STATE_QUARANTINE_DIRECTORY);
  return {
    leases,
    transactions,
    receipts,
    transactionArchive,
    receiptArchive,
    stateArchive,
    requiredDirectories: [
      leases,
      transactions,
      receipts,
      stateArchive,
      transactionArchive,
      receiptArchive,
    ],
  };
}

function listPinnedPrivateDirectoryEntries(
  directoryPath,
  pinned,
  { maxEntries, maxEncodedBytes, label },
) {
  let bytes;
  try {
    bytes = runCutoverNativeHelperBytes(
      "list-bounded",
      [
        String(maxEntries),
        String(maxEncodedBytes),
        String(pinned.identity.dev),
        String(pinned.identity.ino),
      ],
      [pinned.descriptor],
      { maxBuffer: maxEncodedBytes + 1 },
    );
  } catch (error) {
    if (
      /listing exceeds the (?:entry|encoded byte) boundary/.test(
        error?.message ?? "",
      )
    ) {
      fail(
        "cutover_lease_live",
        `${label} contains entries outside the terminal lease runtime scaffold.`,
      );
    }
    throw error;
  }
  requirePinnedPrivateDirectoryPath(directoryPath, pinned, label);
  if (bytes.length === 0) return [];
  let entries;
  try {
    entries = fatalDecoder.decode(bytes).split("\0");
  } catch {
    fail(
      "cutover_lease_live",
      `${label} has an invalid terminal lease runtime inventory.`,
    );
  }
  if (
    entries.length > maxEntries ||
    entries.some(
      (entry) =>
        entry.length === 0 ||
        entry === "." ||
        entry === ".." ||
        entry.includes(path.sep) ||
        entry.includes("\0"),
    )
  ) {
    fail(
      "cutover_lease_live",
      `${label} has an invalid terminal lease runtime inventory.`,
    );
  }
  return entries;
}

function requireTerminalLeaseRuntimeStorage(
  stateRoot,
  { requireComplete = false } = {},
) {
  const layout = leaseRuntimeStorageLayout(stateRoot);
  if (!existsSync(layout.leases)) {
    if (requireComplete) {
      fail(
        "cutover_state_invalid",
        "The terminal lease runtime directory scaffold is incomplete.",
      );
    }
    return;
  }
  const leases = openPinnedPrivateDirectoryPath(
    layout.leases,
    "Automation lease root",
  );
  try {
    const allowedTopLevel = new Set([
      LEASE_TRANSACTION_DIRECTORY,
      LEASE_TRANSACTION_RECEIPT_DIRECTORY,
      LEASE_STATE_QUARANTINE_DIRECTORY,
    ]);
    const entries = listPinnedPrivateDirectoryEntries(layout.leases, leases, {
      maxEntries: allowedTopLevel.size,
      maxEncodedBytes: 128,
      label: "Automation lease root",
    });
    if (entries.some((entry) => !allowedTopLevel.has(entry))) {
      fail(
        "cutover_lease_live",
        "Every canonical lease must be absent before cutover activation.",
      );
    }
  } finally {
    closeSync(leases.descriptor);
  }

  for (const [directoryPath, allowedEntries] of [
    [layout.transactions, new Set([LEASE_CLEANUP_QUARANTINE_DIRECTORY])],
    [layout.receipts, new Set([LEASE_CLEANUP_QUARANTINE_DIRECTORY])],
    [layout.stateArchive, new Set()],
  ]) {
    if (!existsSync(directoryPath)) {
      if (requireComplete) {
        fail(
          "cutover_state_invalid",
          "The terminal lease runtime directory scaffold is incomplete.",
        );
      }
      continue;
    }
    const pinned = openPinnedPrivateDirectoryPath(
      directoryPath,
      `Lease runtime directory ${directoryPath}`,
    );
    try {
      const entries = listPinnedPrivateDirectoryEntries(
        directoryPath,
        pinned,
        {
          maxEntries: Math.max(1, allowedEntries.size),
          maxEncodedBytes: 64,
          label: `Lease runtime directory ${directoryPath}`,
        },
      );
      if (entries.some((entry) => !allowedEntries.has(entry))) {
        fail(
          "cutover_lease_live",
          "Every canonical lease and lease transaction must be absent before cutover activation.",
        );
      }
    } finally {
      closeSync(pinned.descriptor);
    }
  }

  for (const directoryPath of [
    layout.transactionArchive,
    layout.receiptArchive,
  ]) {
    if (!existsSync(directoryPath)) {
      if (requireComplete) {
        fail(
          "cutover_state_invalid",
          "The terminal lease runtime directory scaffold is incomplete.",
        );
      }
      continue;
    }
    const pinned = openPinnedPrivateDirectoryPath(
      directoryPath,
      `Lease runtime archive ${directoryPath}`,
    );
    try {
      const entries = listPinnedPrivateDirectoryEntries(
        directoryPath,
        pinned,
        {
          maxEntries: 1,
          maxEncodedBytes: 255,
          label: `Lease runtime archive ${directoryPath}`,
        },
      );
      if (entries.length !== 0) {
        fail(
          "cutover_lease_live",
          "Lease cleanup archives must be empty before cutover activation.",
        );
      }
    } finally {
      closeSync(pinned.descriptor);
    }
  }

  if (requireComplete) {
    for (const directoryPath of layout.requiredDirectories) {
      requirePrivateDirectory(
        directoryPath,
        `Lease runtime directory ${directoryPath}`,
      );
    }
  }
}

function requireLeaseRuntimeDirectoryScaffold(stateRoot) {
  const layout = leaseRuntimeStorageLayout(stateRoot);
  for (const directoryPath of layout.requiredDirectories) {
    requirePrivateDirectory(
      directoryPath,
      `Lease runtime directory ${directoryPath}`,
    );
  }
}

function leaseRuntimeDirectoryScaffoldReady(stateRoot) {
  try {
    requireLeaseRuntimeDirectoryScaffold(stateRoot);
    return true;
  } catch (error) {
    if (error?.code === "cutover_state_invalid") return false;
    throw error;
  }
}

function ensureLeaseRuntimeDirectoryScaffold(
  plan,
  checkpoint = () => undefined,
) {
  const layout = leaseRuntimeStorageLayout(plan.parameters.stateRoot);
  for (const directoryPath of layout.requiredDirectories) {
    const existed = existsSync(directoryPath);
    ensurePrivateDirectory(directoryPath);
    checkpoint("lease-runtime-directory-durable", {
      directoryPath,
      created: !existed,
    });
  }
}

function requireNoLeases(
  stateRoot,
  { allowLeaseRuntimeStorage = false } = {},
) {
  if (allowLeaseRuntimeStorage) {
    requireTerminalLeaseRuntimeStorage(stateRoot);
    return;
  }
  const leases = path.join(stateRoot, "control", "leases");
  if (!existsSync(leases)) return;
  const pinned = openPinnedPrivateDirectoryPath(
    leases,
    "Automation lease root",
  );
  try {
    let entries;
    try {
      entries = runCutoverNativeHelperBytes(
        "list-bounded",
        [
          "1",
          "255",
          String(pinned.identity.dev),
          String(pinned.identity.ino),
        ],
        [pinned.descriptor],
        { maxBuffer: 256 },
      );
    } catch (error) {
      if (/listing exceeds the (?:entry|encoded byte) boundary/.test(error?.message ?? "")) {
        fail(
          "cutover_lease_live",
          "Every canonical lease must be absent before cutover.",
        );
      }
      throw error;
    }
    requirePinnedPrivateDirectoryPath(
      leases,
      pinned,
      "Automation lease root",
    );
    if (entries.length === 0) return;
    fail(
      "cutover_lease_live",
      "Every canonical lease must be absent before cutover.",
    );
  } finally {
    closeSync(pinned.descriptor);
  }
}

function requireNoOldControlProcess() {
  const output = execFileSync("/bin/ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match || Number(match[1]) === process.pid) continue;
    if (
      CONTROL_PROCESS_PATTERNS.some((pattern) => match[2].includes(pattern))
    ) {
      fail(
        "cutover_process_live",
        `Older control-plane process ${Number(match[1]).toLocaleString()} is still running.`,
      );
    }
  }
}

function processIsLive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function legacyOwnerIsLive(owner) {
  if (
    owner?.schemaVersion !== 1 ||
    !Number.isSafeInteger(owner?.pid) ||
    owner.pid <= 0 ||
    !Object.hasOwn(owner, "processStartIdentity") ||
    !(
      owner.processStartIdentity === null ||
      typeof owner.processStartIdentity === "string"
    )
  ) {
    return false;
  }
  const identity = processStartIdentity(owner.pid);
  if (typeof owner.processStartIdentity === "string" && identity !== null) {
    return identity === owner.processStartIdentity;
  }
  return processIsLive(owner.pid);
}

function readLegacyOwner(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(
      fatalDecoder.decode(readBoundedRegularFile(filePath, 64 * 1024)),
    );
  } catch {
    return null;
  }
}

function lsofPath() {
  if (process.platform === "darwin") return "/usr/sbin/lsof";
  if (process.platform === "linux") return "/usr/bin/lsof";
  return "";
}

function requireNoOpenStateDescriptor(stateRoot) {
  const command = lsofPath();
  if (command === "" || !existsSync(command)) {
    fail(
      "cutover_lsof_missing",
      "Kernel guard cutover requires the platform lsof tool for quiescence proof.",
    );
  }
  try {
    const output = execFileSync(command, ["-F", "pn", "+D", stateRoot], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
    const pids = [...output.matchAll(/^p(\d+)$/gm)]
      .map((match) => Number(match[1]))
      .filter((pid) => pid !== process.pid);
    if (pids.length > 0) {
      fail(
        "cutover_descriptor_live",
        `Automation state still has open descriptors from process ${pids[0].toLocaleString()}.`,
      );
    }
  } catch (error) {
    if (error instanceof AutomationControlError) throw error;
    if (error?.status !== 1 || String(error?.stderr ?? "").trim() !== "") {
      throw error;
    }
  }
}

function requireQuiescence(
  plan,
  { allowLeaseRuntimeStorage = false } = {},
) {
  requirePausedActors(plan.parameters.codexHome);
  requireNoLeases(plan.parameters.stateRoot, { allowLeaseRuntimeStorage });
  requireNoOldControlProcess();
  requireNoOpenStateDescriptor(plan.parameters.stateRoot);
}

function transactionPath(plan) {
  return automationKernelGuardCutoverPaths(plan.parameters.stateRoot)
    .transaction;
}

function ambiguousSupersedeTemporaryPaths(
  plan,
  {
    supersedePlan = undefined,
    includeBootstrap = false,
    includeCompletedEvidence = false,
    activeAtomicMutation = undefined,
    deferSupersedeWriteAheadTemporary = false,
  } = {},
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const candidates = [
    `${paths.transaction}.cutover.tmp`,
    `${paths.writeAhead}.cutover.tmp`,
    `${paths.globalReceipt}.cutover.tmp`,
  ];
  if (includeBootstrap) {
    candidates.push(`${paths.bootstrapLock}.cutover.tmp`);
  }
  if (includeCompletedEvidence) {
    candidates.push(
      ...exactCutoverEvidenceFilesystemPaths(plan, { supersedePlan }).filter(
        (filePath) => filePath.endsWith(".cutover.tmp"),
      ),
    );
  }
  const allowedTemporaryPaths = new Set();
  if (
    activeAtomicMutation?.filePath === paths.writeAhead &&
    activeAtomicMutation?.temporaryPath === `${paths.writeAhead}.cutover.tmp`
  ) {
    allowedTemporaryPaths.add(activeAtomicMutation.temporaryPath);
  }
  if (deferSupersedeWriteAheadTemporary) {
    allowedTemporaryPaths.add(`${paths.writeAhead}.cutover.tmp`);
  }
  return [...new Set(candidates)].filter(
    (temporaryPath) => !allowedTemporaryPaths.has(temporaryPath),
  );
}

function requireNoAmbiguousSupersedeTemporaries(plan, options = undefined) {
  const temporaryPath = ambiguousSupersedeTemporaryPaths(plan, options).find(
    existsSync,
  );
  if (temporaryPath !== undefined) {
    fail(
      "cutover_supersede_conflict",
      `Kernel guard cutover has ambiguous temporary residue at ${temporaryPath}.`,
    );
  }
}

function writeAheadRecordsEqual(left, right) {
  return canonicalJsonBytes(left).equals(canonicalJsonBytes(right));
}

function recoverableSupersedeWriteAheadGeneration(current, temporary) {
  if (current === null) return temporary.phase === "prepared";
  if (
    current.operationId !== temporary.operationId ||
    current.scope !== "supersede" ||
    temporary.scope !== "supersede"
  ) {
    return false;
  }
  if (writeAheadRecordsEqual(current, temporary)) return true;
  return (
    current.phase === "prepared" &&
    temporary.phase === "written" &&
    writeAheadRecordsEqual(current, {
      ...temporary,
      phase: "prepared",
      writtenAt: null,
    })
  );
}

function readRecoverableSupersedeWriteAheadTemporary(plan, supersedePlan) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const temporaryPath = `${paths.writeAhead}.cutover.tmp`;
  if (!existsSync(temporaryPath)) return null;
  const evidence = supersedeEvidencePaths(plan, supersedePlan);
  if (
    !exactPrivateFileBytes(evidence.plan, prettyJsonBytes(supersedePlan))
  ) {
    fail(
      "cutover_supersede_conflict",
      "Supersede write-ahead recovery has no exact prepared plan artifact.",
    );
  }
  let bytes;
  let record;
  try {
    bytes = readPrivateMode600File(
      temporaryPath,
      CUTOVER_WRITE_AHEAD_MAX_BYTES,
    );
    record = validateWriteAheadRecord(
      plan,
      JSON.parse(fatalDecoder.decode(bytes)),
      supersedePlan,
    );
    if (!bytes.equals(prettyJsonBytes(record))) {
      throw new Error("noncanonical supersede write-ahead temporary");
    }
  } catch {
    fail(
      "cutover_supersede_conflict",
      `Kernel guard cutover has ambiguous temporary residue at ${temporaryPath}.`,
    );
  }
  const current = readWriteAheadRecord(plan, supersedePlan);
  requireSupersedeWriteAheadScope(current);
  if (!recoverableSupersedeWriteAheadGeneration(current, record)) {
    fail(
      "cutover_supersede_conflict",
      `Kernel guard cutover has ambiguous temporary residue at ${temporaryPath}.`,
    );
  }
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [
      paths.writeAhead,
      temporaryPath,
      record.filePath,
      ...(record.quarantinePath === null ? [] : [record.quarantinePath]),
    ],
  });
  return Object.freeze({ bytes, current, record, temporaryPath });
}

function recoverSupersedeWriteAheadTemporary(
  plan,
  supersedePlan,
  {
    checkpoint = () => undefined,
    beforeMutation = () => undefined,
  } = {},
) {
  const recovery = readRecoverableSupersedeWriteAheadTemporary(
    plan,
    supersedePlan,
  );
  if (recovery === null) return null;
  const writeAheadPath = cutoverWriteAheadPath(plan);
  const temporaryPinned = openPinnedPrivateFile(recovery.temporaryPath, {
    maxBytes: CUTOVER_WRITE_AHEAD_MAX_BYTES,
    expectedBytes: recovery.bytes,
  });
  const currentBytes =
    recovery.current === null ? null : prettyJsonBytes(recovery.current);
  const currentPinned =
    currentBytes === null
      ? null
      : openPinnedPrivateFile(writeAheadPath, {
          maxBytes: CUTOVER_WRITE_AHEAD_MAX_BYTES,
          expectedBytes: currentBytes,
        });
  try {
    checkpoint("supersede-write-ahead-temporary-recovery-before-mutation", {
      filePath: writeAheadPath,
      temporaryPath: recovery.temporaryPath,
      operationId: recovery.record.operationId,
      operationName: recovery.record.operationName,
      phase: recovery.record.phase,
      predecessorPreserved: recovery.current !== null,
    });
    requirePinnedPrivateFile(
      recovery.temporaryPath,
      temporaryPinned.descriptor,
      temporaryPinned.identity,
      recovery.bytes,
    );
    requirePinnedPathAbsentOrUnchanged(writeAheadPath, currentPinned);
    beforeMutation({
      filePath: writeAheadPath,
      temporaryPath: recovery.temporaryPath,
    });
    requirePinnedPrivateFile(
      recovery.temporaryPath,
      temporaryPinned.descriptor,
      temporaryPinned.identity,
      recovery.bytes,
    );
    requirePinnedPathAbsentOrUnchanged(writeAheadPath, currentPinned);
    if (recovery.current === null) {
      runDurablePrivateFileMove(
        recovery.temporaryPath,
        writeAheadPath,
        temporaryPinned,
      );
      requirePinnedPrivateFile(
        writeAheadPath,
        temporaryPinned.descriptor,
        temporaryPinned.identity,
        recovery.bytes,
      );
    } else {
      retirePinnedPrivateFile(recovery.temporaryPath, temporaryPinned, {
        retirementDirectory: cutoverRetirementDirectory(
          plan,
          "supersede-write-ahead-temporaries",
        ),
        beforeMutation,
      });
      if (existsSync(recovery.temporaryPath)) {
        fail(
          "cutover_supersede_conflict",
          `Supersede write-ahead temporary survived exact retirement at ${recovery.temporaryPath}.`,
        );
      }
      requirePinnedPrivateFile(
        writeAheadPath,
        currentPinned.descriptor,
        currentPinned.identity,
        currentBytes,
      );
    }
    syncDirectory(path.dirname(writeAheadPath));
  } finally {
    closeSync(temporaryPinned.descriptor);
    if (currentPinned !== null) closeSync(currentPinned.descriptor);
  }
  checkpoint("supersede-write-ahead-temporary-recovered", {
    filePath: writeAheadPath,
    operationId: recovery.record.operationId,
    operationName: recovery.record.operationName,
    phase: recovery.record.phase,
  });
  const recovered = readWriteAheadRecord(plan, supersedePlan);
  const expected = recovery.current ?? recovery.record;
  if (recovered === null || !writeAheadRecordsEqual(recovered, expected)) {
    fail(
      "cutover_supersede_conflict",
      "Recovered supersede write-ahead state changed before admission.",
    );
  }
  return recovered;
}

function readTransaction(
  plan,
  checkpoint = () => undefined,
  { allowIncompleteAuthorizationEvidence = false } = {},
) {
  const filePath = transactionPath(plan);
  if (!existsSync(filePath)) return null;
  let transaction;
  try {
    transaction = JSON.parse(
      fatalDecoder.decode(
        readPrivateMode600File(
          filePath,
          CUTOVER_TRANSACTION_MAX_BYTES,
          new Set([1]),
          () => checkpoint("transaction-private-file-opened", { filePath }),
        ),
      ),
    );
  } catch {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover transaction is malformed.",
    );
  }
  const planDigest = sha256(canonicalJsonBytes(plan));
  const expectedKeys = [
    "authorizations",
    "claimGenerations",
    "cutoverId",
    "kind",
    "phase",
    "planDigest",
    "preparedAt",
    "schemaVersion",
    ...(transaction?.phase === "receipt-prepared" ? ["completedAt"] : []),
  ].sort();
  const claimGenerationKeys = [
    "claimToken",
    "claimedAt",
    "pid",
    "processStartIdentity",
  ].sort();
  const preparedAtMs = Date.parse(String(transaction?.preparedAt ?? ""));
  const completedAtMs = Date.parse(String(transaction?.completedAt ?? ""));
  const authorizationIdentities = Array.isArray(transaction?.authorizations)
    ? transaction.authorizations.map(
        (authorization) =>
          `${authorization?.confirmationId ?? ""}:${authorization?.confirmationDigest ?? ""}:${authorization?.validatedAt ?? ""}`,
      )
    : [];
  const finalAuthorization = Array.isArray(transaction?.authorizations)
    ? transaction.authorizations.at(-1)
    : undefined;
  const finalAuthorizationValidatedAtMs = Date.parse(
    String(finalAuthorization?.validatedAt ?? ""),
  );
  const finalAuthorizationExpiresAtMs =
    finalAuthorization === undefined
      ? Number.NaN
      : storedConfirmationExpiryMs(finalAuthorization);
  const claimTokens = Array.isArray(transaction?.claimGenerations)
    ? transaction.claimGenerations.map((generation) => generation?.claimToken)
    : [];
  if (
    transaction?.schemaVersion !== 1 ||
    transaction?.kind !== CUTOVER_TRANSACTION_KIND ||
    transaction?.cutoverId !== plan.parameters.cutoverId ||
    transaction?.planDigest !== planDigest ||
    ![
      "prepared",
      "claims-installed",
      "markers-installed",
      "receipt-prepared",
    ].includes(transaction?.phase) ||
    Object.keys(transaction).sort().join("\n") !== expectedKeys.join("\n") ||
    !isCanonicalTimestamp(transaction.preparedAt) ||
    Date.parse(plan.createdAt) > preparedAtMs ||
    (transaction.phase === "receipt-prepared" &&
      (!isCanonicalTimestamp(transaction.completedAt) ||
        completedAtMs < preparedAtMs ||
        !Number.isFinite(finalAuthorizationValidatedAtMs) ||
        !Number.isFinite(finalAuthorizationExpiresAtMs) ||
        completedAtMs !== finalAuthorizationValidatedAtMs ||
        completedAtMs >= finalAuthorizationExpiresAtMs)) ||
    !Array.isArray(transaction.authorizations) ||
    transaction.authorizations.length === 0 ||
    transaction.authorizations.length > CUTOVER_MAX_AUTHORIZATIONS ||
    new Set(authorizationIdentities).size !== authorizationIdentities.length ||
    !Array.isArray(transaction.claimGenerations) ||
    transaction.claimGenerations.length > CUTOVER_MAX_CLAIM_GENERATIONS ||
    new Set(claimTokens).size !== claimTokens.length ||
    transaction.claimGenerations.some(
      (generation) =>
        generation === null ||
        typeof generation !== "object" ||
        Array.isArray(generation) ||
        Object.keys(generation).sort().join("\n") !==
          claimGenerationKeys.join("\n") ||
        !SHA256_PATTERN.test(String(generation.claimToken ?? "")) ||
        !Number.isSafeInteger(generation.pid) ||
        generation.pid <= 0 ||
        typeof generation.processStartIdentity !== "string" ||
        generation.processStartIdentity.length === 0 ||
        !isCanonicalTimestamp(generation.claimedAt) ||
        Date.parse(generation.claimedAt) < preparedAtMs ||
        (transaction.phase === "receipt-prepared" &&
          Date.parse(generation.claimedAt) > completedAtMs),
    ) ||
    transaction.authorizations.some(
      (authorization, index) =>
        !authorizationRecordIsValid(plan, authorization) ||
        Date.parse(authorization.validatedAt) < preparedAtMs ||
        (index > 0 &&
          Date.parse(authorization.validatedAt) <=
            Date.parse(transaction.authorizations[index - 1].validatedAt)) ||
        (transaction.phase === "receipt-prepared" &&
          Date.parse(authorization.validatedAt) > completedAtMs),
    )
  ) {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover transaction conflicts.",
    );
  }
  for (const authorization of transaction.authorizations) {
    const evidenceTemporaryPath = `${authorization.confirmationArtifact}.cutover.tmp`;
    if (
      allowIncompleteAuthorizationEvidence &&
      !existsSync(authorization.confirmationArtifact) &&
      !existsSync(evidenceTemporaryPath)
    ) {
      continue;
    }
    if (allowIncompleteAuthorizationEvidence) {
      requireCutoverImmutableTargetPreflight(
        plan,
        authorization.confirmationArtifact,
        Buffer.from(authorization.confirmationBytesBase64, "base64"),
      );
      continue;
    }
    const evidence = readPrivateMode600File(
      authorization.confirmationArtifact,
      64 * 1024,
    );
    if (
      sha256(evidence) !== authorization.confirmationRawDigest ||
      evidence.toString("base64") !== authorization.confirmationBytesBase64
    ) {
      fail(
        "cutover_transaction_invalid",
        "Kernel guard cutover authorization evidence conflicts.",
      );
    }
  }
  const preparedAuthorizationPath = preparedAuthorizationArtifactPath(plan);
  const preparedAuthorizationTemporaryPath = `${preparedAuthorizationPath}.cutover.tmp`;
  if (
    allowIncompleteAuthorizationEvidence &&
    !existsSync(preparedAuthorizationPath) &&
    !existsSync(preparedAuthorizationTemporaryPath)
  ) {
    return transaction;
  }
  if (allowIncompleteAuthorizationEvidence) {
    requireCutoverImmutableTargetPreflight(
      plan,
      preparedAuthorizationPath,
      prettyJsonBytes(transaction.authorizations[0]),
    );
    return transaction;
  }
  const preparedAuthorization = readPrivateMode600File(
    preparedAuthorizationPath,
    128 * 1024,
  );
  if (
    !preparedAuthorization.equals(
      prettyJsonBytes(transaction.authorizations[0]),
    )
  ) {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover first authorization evidence conflicts.",
    );
  }
  return transaction;
}

function authorizationArtifactPath(plan, authorization) {
  return path.join(
    artifactDirectory(plan),
    "authorizations",
    `${authorization.confirmationDigest}-${authorization.confirmationRawDigest}.json`,
  );
}

function preparedAuthorizationArtifactPath(plan) {
  return path.join(
    artifactDirectory(plan),
    "authorizations",
    "prepared-authorization.json",
  );
}

function authorizationRecordIsValid(plan, authorization) {
  return (
    authorization !== null &&
    typeof authorization === "object" &&
    !Array.isArray(authorization) &&
    Object.keys(authorization).sort().join("\n") ===
      CUTOVER_AUTHORIZATION_KEYS.join("\n") &&
    authorization.actor === "freed-owner" &&
    IDENTIFIER_PATTERN.test(String(authorization.confirmationId ?? "")) &&
    SHA256_PATTERN.test(String(authorization.confirmationDigest ?? "")) &&
    SHA256_PATTERN.test(String(authorization.confirmationRawDigest ?? "")) &&
    authorization.intentDigest === plan.intentDigest &&
    storedConfirmationEvidenceIsValid(plan, authorization) &&
    isCanonicalTimestamp(authorization.validatedAt)
  );
}

function storedConfirmationEvidenceIsValid(plan, authorization) {
  let bytes;
  let confirmation;
  let confirmationDigest;
  let embeddedIntentDigest;
  try {
    bytes = Buffer.from(authorization.confirmationBytesBase64, "base64");
    if (
      bytes.toString("base64") !== authorization.confirmationBytesBase64 ||
      sha256(bytes) !== authorization.confirmationRawDigest
    ) {
      return false;
    }
    confirmation = JSON.parse(fatalDecoder.decode(bytes));
    confirmationDigest = ownerGovernanceIntentDigest(confirmation);
    embeddedIntentDigest = ownerGovernanceIntentDigest(confirmation?.intent);
  } catch {
    return false;
  }
  const requiredKeys = [
    "approvalSource",
    "approvedAt",
    "approvedBy",
    "confirmationId",
    "expiresAt",
    "intent",
    "intentDigest",
    "kind",
    "ownerApprovalReference",
    "schemaVersion",
    "taskId",
  ].sort();
  const source = confirmation?.approvalSource;
  const approvedAtMs = Date.parse(String(confirmation?.approvedAt ?? ""));
  const expiresAtMs = Date.parse(String(confirmation?.expiresAt ?? ""));
  const validatedAtMs = Date.parse(String(authorization?.validatedAt ?? ""));
  return (
    confirmation?.schemaVersion === 1 &&
    confirmation?.kind === "owner-confirmation" &&
    Object.keys(confirmation).sort().join("\n") === requiredKeys.join("\n") &&
    confirmation.confirmationId === authorization.confirmationId &&
    confirmation.approvedBy === "AubreyF" &&
    typeof confirmation.ownerApprovalReference === "string" &&
    confirmation.ownerApprovalReference.trim() !== "" &&
    source !== null &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    Object.keys(source).sort().join("\n") === "kind\nreference" &&
    source.kind === "current-task" &&
    typeof source.reference === "string" &&
    source.reference.trim() !== "" &&
    confirmation.taskId === plan.taskId &&
    confirmation.intent?.taskId === plan.taskId &&
    confirmation.intent?.action === CUTOVER_ACTION &&
    confirmation.intentDigest === plan.intentDigest &&
    embeddedIntentDigest === plan.intentDigest &&
    confirmationDigest === authorization.confirmationDigest &&
    isCanonicalTimestamp(confirmation.approvedAt) &&
    isCanonicalTimestamp(confirmation.expiresAt) &&
    expiresAtMs > approvedAtMs &&
    Number.isFinite(validatedAtMs) &&
    validatedAtMs >= approvedAtMs &&
    validatedAtMs < expiresAtMs &&
    path.isAbsolute(authorization.confirmationPath) &&
    path.resolve(authorization.confirmationPath) ===
      authorization.confirmationPath &&
    authorization.confirmationArtifact ===
      authorizationArtifactPath(plan, authorization)
  );
}

function storedConfirmationExpiryMs(authorization) {
  try {
    const bytes = Buffer.from(authorization.confirmationBytesBase64, "base64");
    const confirmation = JSON.parse(fatalDecoder.decode(bytes));
    return Date.parse(String(confirmation.expiresAt ?? ""));
  } catch {
    return Number.NaN;
  }
}

function writeAuthorizationEvidence(
  plan,
  authorization,
  beforeMutation = () => undefined,
  checkpoint = () => undefined,
  linkedCheckpointName = "",
) {
  if (!storedConfirmationEvidenceIsValid(plan, authorization)) {
    fail(
      "cutover_authorization_invalid",
      "Cutover authorization evidence conflicts.",
    );
  }
  writeCutoverImmutable(
    plan,
    authorization.confirmationArtifact,
    Buffer.from(authorization.confirmationBytesBase64, "base64"),
    { beforeMutation, checkpoint, linkedCheckpointName },
  );
}

function writePreparedAuthorizationEvidence(
  plan,
  authorization,
  beforeMutation = () => undefined,
  checkpoint = () => undefined,
  linkedCheckpointName = "",
) {
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    extraPaths: [preparedAuthorizationArtifactPath(plan)],
  });
  writeCutoverImmutable(
    plan,
    preparedAuthorizationArtifactPath(plan),
    prettyJsonBytes(authorization),
    { beforeMutation, checkpoint, linkedCheckpointName },
  );
}

function readCanonicalAuthorizationRecord(plan, filePath, label) {
  let bytes;
  let record;
  try {
    bytes = readPrivateMode600File(filePath, 128 * 1024);
    record = JSON.parse(fatalDecoder.decode(bytes));
  } catch {
    fail("cutover_authorization_invalid", `${label} is malformed or unsafe.`);
  }
  if (
    !authorizationRecordIsValid(plan, record) ||
    !bytes.equals(prettyJsonBytes(record))
  ) {
    fail("cutover_authorization_invalid", `${label} conflicts.`);
  }
  return record;
}

function recoverPreparedAuthorizationRecord(
  plan,
  checkpoint,
  beforeMutation = () => undefined,
) {
  const filePath = preparedAuthorizationArtifactPath(plan);
  const temporaryPath = `${filePath}.cutover.tmp`;
  const readablePath = existsSync(filePath) ? filePath : temporaryPath;
  let bytes;
  let record;
  try {
    bytes = readPrivateMode600File(readablePath, 128 * 1024, new Set([1, 2]));
    record = JSON.parse(fatalDecoder.decode(bytes));
  } catch {
    fail(
      "cutover_authorization_invalid",
      "Kernel guard cutover prepared authorization record is malformed or unsafe.",
    );
  }
  if (
    !authorizationRecordIsValid(plan, record) ||
    !bytes.equals(prettyJsonBytes(record))
  ) {
    fail(
      "cutover_authorization_invalid",
      "Kernel guard cutover prepared authorization record conflicts.",
    );
  }
  requireCutoverImmutableTargetPreflight(plan, filePath, bytes);
  writeCutoverImmutable(plan, filePath, bytes, {
    beforeMutation,
    checkpoint,
    linkedCheckpointName: "prepared-authorization-recovery-linked",
  });
  return record;
}

function transactionAuthorizationRecord(
  plan,
  authorization,
  minimumValidatedAtMs = undefined,
) {
  const confirmationBytes = readPrivateMode600File(
    authorization.confirmationFile,
    64 * 1024,
  );
  let parsed;
  try {
    parsed = JSON.parse(fatalDecoder.decode(confirmationBytes));
  } catch {
    fail(
      "cutover_authorization_invalid",
      "Validated owner confirmation bytes changed.",
    );
  }
  if (
    ownerGovernanceIntentDigest(parsed) !== authorization.digest ||
    parsed.confirmationId !== authorization.confirmation.confirmationId ||
    parsed.taskId !== plan.taskId ||
    parsed.intentDigest !== plan.intentDigest
  ) {
    fail(
      "cutover_authorization_invalid",
      "Validated owner confirmation bytes changed.",
    );
  }
  const validatedAtMs = Math.max(
    Date.now(),
    Number.isFinite(minimumValidatedAtMs)
      ? minimumValidatedAtMs + 1
      : Number.NEGATIVE_INFINITY,
  );
  const expiresAtMs = Date.parse(String(parsed.expiresAt ?? ""));
  if (!Number.isFinite(expiresAtMs) || validatedAtMs >= expiresAtMs) {
    fail(
      "cutover_authorization_invalid",
      "Owner confirmation expired before its durable authorization record.",
    );
  }
  const record = {
    actor: "freed-owner",
    confirmationId: authorization.confirmation.confirmationId,
    confirmationDigest: authorization.digest,
    confirmationPath: authorization.confirmationFile,
    confirmationBytesBase64: confirmationBytes.toString("base64"),
    confirmationRawDigest: sha256(confirmationBytes),
    confirmationArtifact: "",
    intentDigest: authorization.confirmation.intentDigest,
    validatedAt: new Date(validatedAtMs).toISOString(),
  };
  record.confirmationArtifact = authorizationArtifactPath(plan, record);
  return record;
}

function sameTransactionAuthorizationSource(left, right) {
  return (
    left.actor === right.actor &&
    left.confirmationId === right.confirmationId &&
    left.confirmationDigest === right.confirmationDigest &&
    left.confirmationPath === right.confirmationPath &&
    left.confirmationBytesBase64 === right.confirmationBytesBase64 &&
    left.confirmationRawDigest === right.confirmationRawDigest &&
    left.confirmationArtifact === right.confirmationArtifact &&
    left.intentDigest === right.intentDigest
  );
}

function transactionAuthorizationFilesystemPaths(record) {
  return [
    record.confirmationArtifact,
    `${record.confirmationArtifact}.cutover.tmp`,
  ];
}

function recoverPreparedAuthorizationTransaction(
  plan,
  checkpoint,
  beforeMutation = () => undefined,
) {
  const preparedPath = preparedAuthorizationArtifactPath(plan);
  if (!existsSync(preparedPath)) return null;
  const authorization = recoverPreparedAuthorizationRecord(
    plan,
    checkpoint,
    beforeMutation,
  );
  if (Date.parse(authorization.validatedAt) < Date.parse(plan.createdAt)) {
    fail(
      "cutover_authorization_invalid",
      "Kernel guard cutover prepared authorization predates its plan.",
    );
  }
  writeAuthorizationEvidence(
    plan,
    authorization,
    beforeMutation,
    checkpoint,
    "prepared-authorization-recovery-evidence-linked",
  );
  const transaction = {
    schemaVersion: 1,
    kind: CUTOVER_TRANSACTION_KIND,
    cutoverId: plan.parameters.cutoverId,
    planDigest: sha256(canonicalJsonBytes(plan)),
    phase: "prepared",
    preparedAt: authorization.validatedAt,
    authorizations: [authorization],
    claimGenerations: [],
  };
  writeTransaction(plan, transaction, beforeMutation, checkpoint);
  checkpoint("transaction-prepared-recovered", {
    cutoverId: plan.parameters.cutoverId,
  });
  return transaction;
}

function repairTransactionAuthorizationEvidence(
  plan,
  transaction,
  checkpoint,
  beforeMutation = () => undefined,
) {
  for (const authorization of transaction.authorizations) {
    const recoveryNeeded =
      !existsSync(authorization.confirmationArtifact) ||
      existsSync(`${authorization.confirmationArtifact}.cutover.tmp`);
    writeAuthorizationEvidence(
      plan,
      authorization,
      beforeMutation,
      checkpoint,
      "transaction-authorization-evidence-recovery-linked",
    );
    if (recoveryNeeded) {
      checkpoint("transaction-authorization-evidence-recovered", {
        confirmationId: authorization.confirmationId,
        filePath: authorization.confirmationArtifact,
      });
    }
  }
  const preparedPath = preparedAuthorizationArtifactPath(plan);
  const preparedRecoveryNeeded =
    !existsSync(preparedPath) || existsSync(`${preparedPath}.cutover.tmp`);
  writePreparedAuthorizationEvidence(
    plan,
    transaction.authorizations[0],
    beforeMutation,
    checkpoint,
    "prepared-authorization-evidence-recovery-linked",
  );
  if (preparedRecoveryNeeded) {
    checkpoint("prepared-authorization-evidence-recovered", {
      confirmationId: transaction.authorizations[0].confirmationId,
      filePath: preparedPath,
    });
  }
  return readTransaction(plan);
}

function recordTransactionAuthorization(
  plan,
  transaction,
  authorization,
  expectedSource = undefined,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  if (transaction.phase === "receipt-prepared") {
    fail(
      "cutover_authorization_conflict",
      "Cutover receipt preparation already binds its final owner confirmation.",
    );
  }
  if (transaction.authorizations.length >= CUTOVER_MAX_AUTHORIZATIONS) {
    fail(
      "cutover_authorization_exhausted",
      "Kernel guard cutover exceeded its bounded retry authorizations.",
    );
  }
  const nextAuthorization = transactionAuthorizationRecord(
    plan,
    authorization,
    Date.parse(transaction.authorizations.at(-1).validatedAt),
  );
  if (
    expectedSource !== undefined &&
    !sameTransactionAuthorizationSource(nextAuthorization, expectedSource)
  ) {
    fail(
      "cutover_authorization_invalid",
      "Validated owner confirmation changed after filesystem admission.",
    );
  }
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    transaction,
    extraPaths: transactionAuthorizationFilesystemPaths(nextAuthorization),
  });
  const updated = {
    ...transaction,
    authorizations: [...transaction.authorizations, nextAuthorization],
    ...(transaction.phase === "receipt-prepared"
      ? { completedAt: nextAuthorization.validatedAt }
      : {}),
  };
  writeTransaction(plan, updated, beforeMutation, checkpoint);
  checkpoint("retry-authorization-transaction-durable", {
    confirmationId: nextAuthorization.confirmationId,
  });
  writeAuthorizationEvidence(
    plan,
    nextAuthorization,
    beforeMutation,
    checkpoint,
    "retry-authorization-evidence-linked",
  );
  checkpoint("retry-authorization-evidence-durable", {
    confirmationId: nextAuthorization.confirmationId,
    filePath: nextAuthorization.confirmationArtifact,
  });
  return updated;
}

function currentClaimGeneration(
  plan,
  transaction,
  beforeMutation = () => undefined,
  checkpoint = () => undefined,
) {
  const identity = processStartIdentity(process.pid);
  if (typeof identity !== "string" || identity.length === 0) {
    fail(
      "cutover_claim_unavailable",
      "Kernel guard cutover cannot bind the current process identity.",
    );
  }
  const current = transaction.claimGenerations.at(-1);
  if (
    current?.pid === process.pid &&
    current.processStartIdentity === identity
  ) {
    return { transaction, generation: current };
  }
  if (transaction.claimGenerations.length >= CUTOVER_MAX_CLAIM_GENERATIONS) {
    fail(
      "cutover_claim_exhausted",
      "Kernel guard cutover exceeded its bounded claim recovery generations.",
    );
  }
  const generation = {
    claimToken: randomBytes(32).toString("hex"),
    claimedAt: new Date().toISOString(),
    pid: process.pid,
    processStartIdentity: identity,
  };
  const updated = {
    ...transaction,
    claimGenerations: [...transaction.claimGenerations, generation],
  };
  writeTransaction(plan, updated, beforeMutation, checkpoint);
  return { transaction: updated, generation };
}

function cutoverClaimRecord(plan, generation, target) {
  return {
    schemaVersion: 1,
    owner: `kernel-cutover:${plan.parameters.cutoverId}:${target}:${generation.claimToken}`,
    token: generation.claimToken,
    pid: generation.pid,
    processStartIdentity: generation.processStartIdentity,
    acquiredAt: generation.claimedAt,
    lockProtocol: CUTOVER_CLAIM_PROTOCOL,
    cutoverId: plan.parameters.cutoverId,
    planDigest: sha256(canonicalJsonBytes(plan)),
    claimToken: generation.claimToken,
    target,
  };
}

function cutoverClaimBytes(plan, generation, target) {
  return prettyJsonBytes(cutoverClaimRecord(plan, generation, target));
}

function writeTransaction(
  plan,
  transaction,
  beforeMutation = () => undefined,
  checkpoint = () => undefined,
) {
  const bytes = prettyJsonBytes(transaction);
  if (bytes.length > CUTOVER_TRANSACTION_MAX_BYTES) {
    fail(
      "cutover_transaction_invalid",
      `Kernel guard cutover transaction exceeds the ${CUTOVER_TRANSACTION_MAX_BYTES.toLocaleString()} byte private boundary.`,
    );
  }
  writeAtomic(
    transactionPath(plan),
    bytes,
    beforeMutation,
    ({ filePath, temporaryPath, cleanup = false }) =>
      checkpoint("transaction-temporary-durable", {
        filePath,
        temporaryPath,
        cleanup,
        phase: transaction.phase,
      }),
  );
}

function artifactDirectory(plan) {
  return path.join(
    automationKernelGuardCutoverPaths(plan.parameters.stateRoot).artifactRoot,
    plan.parameters.cutoverId,
  );
}

function legacyManifest(plan) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  return {
    schemaVersion: 1,
    entries: plan.sourceSnapshot.entries.filter(
      (entry) =>
        entry.path === paths.writerLock || entry.path === paths.guardsRoot,
    ),
  };
}

function exactMarkerFile(filePath) {
  if (!existsSync(filePath)) return false;
  try {
    const stats = lstatSync(filePath);
    return (
      stats.isFile() &&
      !stats.isSymbolicLink() &&
      stats.uid === currentUid(stats) &&
      (stats.mode & 0o7777) === 0o600 &&
      stats.nlink === 1 &&
      realpathSync(filePath) === path.resolve(filePath) &&
      readPrivateMode600File(
        filePath,
        automationKernelGuardMarkerBytes().length,
      ).equals(automationKernelGuardMarkerBytes())
    );
  } catch {
    return false;
  }
}

function exactPrivateFileBytes(
  filePath,
  expectedBytes,
  allowedLinkCounts = new Set([1]),
) {
  if (!existsSync(filePath)) return false;
  try {
    return readPrivateMode600File(
      filePath,
      expectedBytes.length,
      allowedLinkCounts,
    ).equals(expectedBytes);
  } catch {
    return false;
  }
}

function exactClaimFile(filePath, plan, generation, target) {
  return exactPrivateFileBytes(
    filePath,
    cutoverClaimBytes(plan, generation, target),
  );
}

function claimGenerationForFile(filePath, plan, transaction, target) {
  return transaction.claimGenerations.findLast((generation) =>
    exactClaimFile(filePath, plan, generation, target),
  );
}

function exactMarkerDirectory(guard) {
  if (!existsSync(guard.directory)) return false;
  try {
    requirePrivateDirectory(guard.directory, guard.directory);
    const names = readdirSync(guard.directory).sort();
    return (
      names.join("\n") === "kernel.lock\nowner.json" &&
      exactMarkerFile(guard.owner) &&
      exactMarkerFile(guard.inner)
    );
  } catch {
    return false;
  }
}

function recoverNoReplaceLink(
  filePath,
  temporaryPath,
  bytes,
  {
    beforeMutation = () => undefined,
    beforeUnlink = () => undefined,
    retirementDirectory,
  } = {},
) {
  const retainedState = inspectRetainedHardLinkPublication(
    filePath,
    temporaryPath,
    bytes,
    retirementDirectory,
  );
  if (retainedState.relevant) {
    retirePublishedHardLinks(filePath, temporaryPath, bytes, {
      retirementDirectory,
      beforeMutation,
    });
    return true;
  }
  if (!existsSync(filePath) || !existsSync(temporaryPath)) return false;
  const current = lstatSync(filePath);
  const temporary = lstatSync(temporaryPath);
  if (
    !current.isFile() ||
    !temporary.isFile() ||
    current.dev !== temporary.dev ||
    current.ino !== temporary.ino ||
    current.nlink !== 2 ||
    temporary.nlink !== 2 ||
    !exactPrivateFileBytes(filePath, bytes, new Set([2]))
  ) {
    return false;
  }
  const pinned = openPinnedPrivateFile(temporaryPath, {
    maxBytes: bytes.length,
    expectedBytes: bytes,
    allowedLinkCounts: new Set([2]),
  });
  try {
    requirePinnedPrivateFile(
      filePath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    beforeUnlink();
    requirePinnedPrivateFile(
      filePath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    requirePinnedPrivateFile(
      temporaryPath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    beforeMutation();
    requirePinnedPrivateFile(
      filePath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    requirePinnedPrivateFile(
      temporaryPath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    retirePublishedHardLinks(filePath, temporaryPath, bytes, {
      retirementDirectory,
      beforeMutation,
    });
    syncDirectory(path.dirname(filePath));
    return true;
  } finally {
    closeSync(pinned.descriptor);
  }
}

function recoverAnyClaimLink(
  filePath,
  plan,
  transaction,
  target,
  beforeMutation = () => undefined,
) {
  const temporaryPath = `${filePath}.cutover-claim.tmp`;
  if (!existsSync(temporaryPath)) return;
  for (const generation of transaction.claimGenerations) {
    if (
      recoverNoReplaceLink(
        filePath,
        temporaryPath,
        cutoverClaimBytes(plan, generation, target),
        {
          beforeMutation,
          retirementDirectory: cutoverRetirementDirectory(
            plan,
            "immutable-hard-links",
          ),
        },
      )
    ) {
      return;
    }
  }
}

function recoverPermanentMarkerLink(
  plan,
  filePath,
  beforeMutation = () => undefined,
  checkpoint = () => undefined,
  checkpointName = "permanent-marker-linked",
) {
  const temporaryPath = `${filePath}.cutover.tmp`;
  recoverNoReplaceLink(
    filePath,
    temporaryPath,
    automationKernelGuardMarkerBytes(),
    {
      beforeMutation,
      retirementDirectory: cutoverRetirementDirectory(
        plan,
        "immutable-hard-links",
      ),
      beforeUnlink() {
        checkpoint(`${checkpointName}-recovery-before-unlink`, {
          filePath,
          temporaryPath,
        });
      },
    },
  );
}

function installNoReplaceExactBytes(
  filePath,
  bytes,
  {
    checkpoint = () => undefined,
    checkpointName,
    temporarySuffix,
    beforeMutation = () => undefined,
    recoveryCheckpointName = "",
    retirementDirectory,
  },
) {
  const temporaryPath = `${filePath}.${temporarySuffix}.tmp`;
  recoverNoReplaceLink(filePath, temporaryPath, bytes, {
    beforeMutation,
    retirementDirectory,
    beforeUnlink() {
      if (recoveryCheckpointName !== "") {
        checkpoint(`${recoveryCheckpointName}-recovery-before-unlink`, {
          filePath,
          temporaryPath,
        });
      }
    },
  });
  if (exactPrivateFileBytes(filePath, bytes)) {
    if (existsSync(temporaryPath)) {
      fail(
        "cutover_conflict",
        `Cutover claim temporary path conflicts: ${temporaryPath}`,
      );
    }
    syncDirectory(path.dirname(filePath));
    return;
  }
  if (existsSync(filePath)) {
    fail("cutover_conflict", `Cutover claim path is occupied: ${filePath}`);
  }
  let pinned;
  if (!existsSync(temporaryPath)) {
    let descriptor;
    try {
      beforeMutation();
      descriptor = openSync(
        temporaryPath,
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(descriptor, bytes);
      fchmodSync(descriptor, 0o600);
      fsyncSync(descriptor);
      pinned = {
        descriptor,
        identity: pinnedFileIdentity(fstatSync(descriptor)),
        bytes,
      };
    } finally {
      if (pinned === undefined && descriptor !== undefined) {
        closeSync(descriptor);
      }
    }
  } else {
    pinned = openPinnedPrivateFile(temporaryPath, {
      maxBytes: bytes.length,
      expectedBytes: bytes,
    });
  }
  try {
    try {
      beforeMutation();
      requirePinnedPrivateFile(
        temporaryPath,
        pinned.descriptor,
        pinned.identity,
        bytes,
      );
      if (existsSync(filePath)) {
        fail("cutover_conflict", `Cutover claim path is occupied: ${filePath}`);
      }
      linkSync(temporaryPath, filePath);
    } catch (error) {
      if (error?.code !== "EEXIST" || !exactPrivateFileBytes(filePath, bytes)) {
        throw error;
      }
    }
    requirePinnedPrivateFile(
      filePath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    requirePinnedPrivateFile(
      temporaryPath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    checkpoint(checkpointName, { filePath, temporaryPath });
    requirePinnedPrivateFile(
      filePath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    requirePinnedPrivateFile(
      temporaryPath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    beforeMutation();
    requirePinnedPrivateFile(
      filePath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    requirePinnedPrivateFile(
      temporaryPath,
      pinned.descriptor,
      pinned.identity,
      bytes,
      new Set([2]),
    );
    retirePublishedHardLinks(filePath, temporaryPath, bytes, {
      retirementDirectory,
      beforeMutation,
    });
    syncDirectory(path.dirname(filePath));
  } finally {
    closeSync(pinned.descriptor);
  }
  if (!exactPrivateFileBytes(filePath, bytes)) {
    fail("cutover_conflict", `Cutover claim did not verify: ${filePath}`);
  }
}

function possiblePrefixRewriteState(currentBytes, sourceBytes, targetBytes) {
  if (currentBytes.equals(sourceBytes) || currentBytes.equals(targetBytes)) {
    return true;
  }
  for (let offset = 1; offset <= targetBytes.length; offset += 1) {
    const expectedLength = Math.max(sourceBytes.length, offset);
    if (currentBytes.length !== expectedLength) continue;
    if (
      !currentBytes.subarray(0, offset).equals(targetBytes.subarray(0, offset))
    ) {
      continue;
    }
    if (
      offset >= sourceBytes.length ||
      currentBytes.subarray(offset).equals(sourceBytes.subarray(offset))
    ) {
      return true;
    }
  }
  return false;
}

function requirePinnedRewritePath(
  filePath,
  descriptor,
  identity,
  sourceBytes,
  targetBytes,
  targetMode,
) {
  const maxBytes = Math.max(sourceBytes.length, targetBytes.length);
  let current;
  try {
    current = lstatSync(filePath);
  } catch {
    fail(
      "cutover_source_drift",
      `Legacy claim generation disappeared at ${filePath}.`,
    );
  }
  const opened = fstatSync(descriptor);
  if (
    !opened.isFile() ||
    !current.isFile() ||
    current.isSymbolicLink() ||
    opened.dev !== identity.dev ||
    opened.ino !== identity.ino ||
    opened.uid !== identity.uid ||
    current.dev !== identity.dev ||
    current.ino !== identity.ino ||
    current.uid !== identity.uid ||
    !Number.isSafeInteger(opened.size) ||
    opened.size < 0 ||
    opened.size > maxBytes ||
    current.size !== opened.size ||
    !new Set([identity.mode, targetMode]).has(opened.mode & 0o7777) ||
    !new Set([identity.mode, targetMode]).has(current.mode & 0o7777) ||
    opened.nlink !== 1 ||
    current.nlink !== 1 ||
    realpathSync(filePath) !== path.resolve(filePath)
  ) {
    fail(
      "cutover_source_drift",
      `Legacy claim generation changed at ${filePath}.`,
    );
  }
  const currentBytes = readOpenedBytes(descriptor, opened, maxBytes);
  if (!possiblePrefixRewriteState(currentBytes, sourceBytes, targetBytes)) {
    fail("cutover_source_drift", `Legacy claim source changed at ${filePath}.`);
  }
  return { bytes: currentBytes, stats: opened };
}

function preparedRewriteRecord(
  plan,
  filePath,
  currentByteOptions,
  targetBytes,
  {
    operationName,
    supersedePlan = undefined,
    allowedModes,
    targetMode,
    checkpoint,
    checkpointName,
    beforeMutation = () => undefined,
  },
) {
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [filePath],
  });
  const existing = readWriteAheadRecord(plan, supersedePlan);
  const scope = writeAheadScope(plan, supersedePlan);
  if (existing !== null) {
    if (
      existing.operation !== "rewrite" ||
      existing.operationName !== operationName ||
      existing.filePath !== filePath ||
      existing.targetMode !== targetMode ||
      existing.targetDigest !== sha256(targetBytes) ||
      !currentByteOptions.some(
        (option) =>
          sha256(option) === existing.sourceDigest &&
          option.length === existing.sourceSize,
      )
    ) {
      fail(
        "cutover_write_ahead_conflict",
        "A different cutover rewrite is already pending.",
      );
    }
    return existing;
  }
  const before = lstatSync(filePath);
  const maxBytes = Math.max(
    targetBytes.length,
    ...currentByteOptions.map((option) => option.length),
  );
  const currentBytes = readBoundedRegularFile(
    filePath,
    maxBytes,
    new Set([1]),
    allowedModes,
  );
  const after = lstatSync(filePath);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.uid !== currentUid(before) ||
    !allowedModes.has(before.mode & 0o7777)
  ) {
    fail(
      "cutover_source_drift",
      `Legacy claim generation changed at ${filePath}.`,
    );
  }
  const sourceBytes = currentByteOptions.find((option) =>
    currentBytes.equals(option),
  );
  if (sourceBytes === undefined) {
    fail("cutover_source_drift", `Legacy claim source changed at ${filePath}.`);
  }
  const preparedAt = new Date().toISOString();
  const record = {
    schemaVersion: 1,
    kind: CUTOVER_WRITE_AHEAD_KIND,
    operation: "rewrite",
    scope: scope.scope,
    scopeId: scope.scopeId,
    scopePlanDigest: scope.scopePlanDigest,
    cutoverId: plan.parameters.cutoverId,
    operationName,
    filePath,
    quarantinePath: null,
    sourceDev: String(before.dev),
    sourceIno: String(before.ino),
    sourceMode: before.mode & 0o7777,
    targetMode,
    sourceSize: sourceBytes.length,
    sourceDigest: sha256(sourceBytes),
    sourceBytesBase64: sourceBytes.toString("base64"),
    targetSize: targetBytes.length,
    targetDigest: sha256(targetBytes),
    targetBytesBase64: targetBytes.toString("base64"),
    sourceSnapshot: null,
    phase: "prepared",
    preparedAt,
    writtenAt: null,
  };
  record.operationId = writeAheadOperationId(record);
  checkpoint(`${checkpointName}-before-journal`, {
    filePath,
    operationId: record.operationId,
  });
  writeWriteAheadRecord(
    plan,
    record,
    supersedePlan,
    beforeMutation,
    checkpoint,
  );
  checkpoint(`${checkpointName}-journal-durable`, {
    filePath,
    operationId: record.operationId,
  });
  return record;
}

function completePreparedRewrite(
  plan,
  record,
  {
    supersedePlan = undefined,
    checkpoint = () => undefined,
    checkpointName = "rewrite",
    beforeMutation = () => undefined,
  } = {},
) {
  const sourceBytes = Buffer.from(record.sourceBytesBase64, "base64");
  const targetBytes = Buffer.from(record.targetBytesBase64, "base64");
  const rewriteMaxBytes = Math.max(sourceBytes.length, targetBytes.length);
  let descriptor;
  try {
    const before = lstatSync(record.filePath);
    descriptor = openSync(
      record.filePath,
      constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const opened = fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      String(opened.dev) !== record.sourceDev ||
      String(opened.ino) !== record.sourceIno ||
      opened.uid !== currentUid(opened) ||
      opened.nlink !== 1 ||
      !Number.isSafeInteger(opened.size) ||
      opened.size < 0 ||
      opened.size > rewriteMaxBytes ||
      before.size !== opened.size ||
      !new Set([record.sourceMode, record.targetMode]).has(
        opened.mode & 0o7777,
      ) ||
      realpathSync(record.filePath) !== path.resolve(record.filePath)
    ) {
      fail(
        "cutover_source_drift",
        `Legacy claim source changed at ${record.filePath}.`,
      );
    }
    const currentBytes = readOpenedBytes(
      descriptor,
      opened,
      rewriteMaxBytes,
    );
    if (!possiblePrefixRewriteState(currentBytes, sourceBytes, targetBytes)) {
      fail(
        "cutover_source_drift",
        `Legacy claim source changed at ${record.filePath}.`,
      );
    }
    const immediatelyBeforeWrite = lstatSync(record.filePath);
    if (
      immediatelyBeforeWrite.dev !== opened.dev ||
      immediatelyBeforeWrite.ino !== opened.ino
    ) {
      fail(
        "cutover_source_drift",
        `Legacy claim generation changed at ${record.filePath}.`,
      );
    }
    const identity = pinnedFileIdentity(opened);
    checkpoint(checkpointName, { filePath: record.filePath });
    requirePinnedRewritePath(
      record.filePath,
      descriptor,
      identity,
      sourceBytes,
      targetBytes,
      record.targetMode,
    );
    beforeMutation();
    requirePinnedRewritePath(
      record.filePath,
      descriptor,
      identity,
      sourceBytes,
      targetBytes,
      record.targetMode,
    );
    if (!currentBytes.equals(targetBytes)) {
      const firstBoundary = Math.max(1, Math.floor(targetBytes.length / 2));
      let offset = 0;
      while (offset < targetBytes.length) {
        const requested =
          offset === 0
            ? Math.min(firstBoundary, targetBytes.length)
            : targetBytes.length - offset;
        const count = writeSync(
          descriptor,
          targetBytes,
          offset,
          requested,
          offset,
        );
        if (count <= 0) {
          fail(
            "cutover_conflict",
            `Cutover claim write was incomplete: ${record.filePath}`,
          );
        }
        offset += count;
        if (offset === count) {
          checkpoint(`${checkpointName}-after-first-write`, {
            filePath: record.filePath,
            operationId: record.operationId,
          });
          requirePinnedRewritePath(
            record.filePath,
            descriptor,
            identity,
            sourceBytes,
            targetBytes,
            record.targetMode,
          );
          beforeMutation();
          requirePinnedRewritePath(
            record.filePath,
            descriptor,
            identity,
            sourceBytes,
            targetBytes,
            record.targetMode,
          );
        }
      }
      ftruncateSync(descriptor, targetBytes.length);
      checkpoint(`${checkpointName}-after-truncate`, {
        filePath: record.filePath,
        operationId: record.operationId,
      });
      requirePinnedRewritePath(
        record.filePath,
        descriptor,
        identity,
        sourceBytes,
        targetBytes,
        record.targetMode,
      );
      beforeMutation();
      requirePinnedRewritePath(
        record.filePath,
        descriptor,
        identity,
        sourceBytes,
        targetBytes,
        record.targetMode,
      );
      fchmodSync(descriptor, record.targetMode);
      checkpoint(`${checkpointName}-before-fsync`, {
        filePath: record.filePath,
        operationId: record.operationId,
      });
      requirePinnedRewritePath(
        record.filePath,
        descriptor,
        identity,
        sourceBytes,
        targetBytes,
        record.targetMode,
      );
      beforeMutation();
      requirePinnedRewritePath(
        record.filePath,
        descriptor,
        identity,
        sourceBytes,
        targetBytes,
        record.targetMode,
      );
      fsyncSync(descriptor);
      checkpoint(`${checkpointName}-after-fsync`, {
        filePath: record.filePath,
        operationId: record.operationId,
      });
      const afterFsync = requirePinnedRewritePath(
        record.filePath,
        descriptor,
        identity,
        sourceBytes,
        targetBytes,
        record.targetMode,
      );
      if (
        (afterFsync.stats.mode & 0o7777) !== record.targetMode ||
        !afterFsync.bytes.equals(targetBytes)
      ) {
        fail(
          "cutover_source_drift",
          `Legacy claim generation changed at ${record.filePath}.`,
        );
      }
    }
    const afterOpened = fstatSync(descriptor);
    const after = lstatSync(record.filePath);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      afterOpened.dev !== opened.dev ||
      afterOpened.ino !== opened.ino ||
      afterOpened.nlink !== 1 ||
      (afterOpened.mode & 0o7777) !== record.targetMode ||
      !readOpenedBytes(descriptor, afterOpened, targetBytes.length).equals(
        targetBytes,
      )
    ) {
      fail(
        "cutover_source_drift",
        `Legacy claim generation changed at ${record.filePath}.`,
      );
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  syncDirectory(path.dirname(record.filePath));
  const finalStats = lstatSync(record.filePath);
  if (
    (finalStats.mode & 0o7777) !== record.targetMode ||
    String(finalStats.dev) !== record.sourceDev ||
    String(finalStats.ino) !== record.sourceIno ||
    !readBoundedRegularFile(
      record.filePath,
      targetBytes.length,
      new Set([1]),
      new Set([record.targetMode]),
    ).equals(targetBytes)
  ) {
    fail(
      "cutover_conflict",
      `Cutover claim did not verify: ${record.filePath}`,
    );
  }
  const written =
    record.phase === "written"
      ? record
      : { ...record, phase: "written", writtenAt: new Date().toISOString() };
  writeWriteAheadRecord(
    plan,
    written,
    supersedePlan,
    beforeMutation,
    checkpoint,
  );
  clearWriteAheadRecord(
    plan,
    checkpoint,
    `${checkpointName}-journal-unlinked`,
    { filePath: record.filePath, operationId: record.operationId },
    beforeMutation,
    written,
    `${checkpointName}-journal-written`,
  );
}

function rewritePrivateFileInPlace(
  plan,
  filePath,
  currentByteOptions,
  targetBytes,
  {
    checkpoint = () => undefined,
    checkpointName,
    operationName,
    supersedePlan = undefined,
    allowedModes = new Set([0o600, 0o640, 0o644]),
    targetMode = 0o600,
    beforeMutation = () => undefined,
  },
) {
  beforeMutation();
  const record = preparedRewriteRecord(
    plan,
    filePath,
    currentByteOptions,
    targetBytes,
    {
      operationName,
      supersedePlan,
      allowedModes,
      targetMode,
      checkpoint,
      checkpointName,
      beforeMutation,
    },
  );
  completePreparedRewrite(plan, record, {
    supersedePlan,
    checkpoint,
    checkpointName,
    beforeMutation,
  });
}

function preparedRemovalRecord(
  plan,
  filePath,
  sourceSnapshot,
  {
    operationName,
    supersedePlan = undefined,
    checkpoint = () => undefined,
    checkpointName,
    beforeMutation = () => undefined,
  },
) {
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [filePath],
  });
  const existing = readWriteAheadRecord(plan, supersedePlan);
  if (existing !== null) {
    if (
      existing.operation !== "remove" ||
      existing.operationName !== operationName ||
      existing.filePath !== filePath ||
      existing.sourceDigest !== sha256(canonicalJsonBytes(sourceSnapshot))
    ) {
      fail(
        "cutover_write_ahead_conflict",
        "A different cutover removal is already pending.",
      );
    }
    return existing;
  }
  if (!existsSync(filePath)) {
    syncDirectory(path.dirname(filePath));
    return null;
  }
  requireSnapshotMatch(sourceSnapshot, filePath, `Removal source ${filePath}`);
  const stats = lstatSync(filePath);
  if (
    (!stats.isFile() && !stats.isDirectory()) ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid(stats) ||
    realpathSync(filePath) !== path.resolve(filePath)
  ) {
    fail("cutover_source_drift", `Removal source is unsafe: ${filePath}`);
  }
  const scope = writeAheadScope(plan, supersedePlan);
  const snapshotBytes = canonicalJsonBytes(sourceSnapshot);
  const record = {
    schemaVersion: 1,
    kind: CUTOVER_WRITE_AHEAD_KIND,
    operation: "remove",
    scope: scope.scope,
    scopeId: scope.scopeId,
    scopePlanDigest: scope.scopePlanDigest,
    cutoverId: plan.parameters.cutoverId,
    operationName,
    filePath,
    quarantinePath: "",
    sourceDev: String(stats.dev),
    sourceIno: String(stats.ino),
    sourceMode: stats.mode & 0o7777,
    targetMode: null,
    sourceSize: snapshotBytes.length,
    sourceDigest: sha256(snapshotBytes),
    sourceBytesBase64: null,
    targetSize: 0,
    targetDigest: sha256(Buffer.alloc(0)),
    targetBytesBase64: null,
    sourceSnapshot,
    phase: "prepared",
    preparedAt: new Date().toISOString(),
    writtenAt: null,
  };
  record.quarantinePath = path.join(
    cutoverRetirementDirectory(plan, "removals"),
    `${removalQuarantineId(record)}.archive`,
  );
  record.operationId = writeAheadOperationId(record);
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    supersedePlan,
    extraPaths: [filePath, record.quarantinePath],
  });
  ensurePrivateDirectory(path.dirname(record.quarantinePath), beforeMutation);
  checkpoint(`${checkpointName}-before-journal`, {
    filePath,
    operationId: record.operationId,
  });
  writeWriteAheadRecord(
    plan,
    record,
    supersedePlan,
    beforeMutation,
    checkpoint,
  );
  checkpoint(`${checkpointName}-journal-durable`, {
    filePath,
    operationId: record.operationId,
  });
  return record;
}

function openPinnedRemovalPath(record, filePath, label) {
  let descriptor;
  try {
    const before = lstatSync(filePath);
    descriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const opened = fstatSync(descriptor);
    const identity = pinnedFileIdentity(opened);
    if (
      (!before.isFile() && !before.isDirectory()) ||
      before.isSymbolicLink() ||
      !pinnedFileIdentityMatches(before, identity) ||
      String(opened.dev) !== record.sourceDev ||
      String(opened.ino) !== record.sourceIno ||
      identity.mode !== record.sourceMode ||
      realpathSync(filePath) !== path.resolve(filePath)
    ) {
      fail("cutover_source_drift", `${label} generation changed.`);
    }
    requireSnapshotMatch(record.sourceSnapshot, filePath, label);
    requirePinnedRemovalPath(record, filePath, descriptor, identity, label);
    return { descriptor, identity };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function requirePinnedRemovalPath(
  record,
  filePath,
  descriptor,
  identity,
  label,
) {
  let current;
  try {
    current = lstatSync(filePath);
  } catch {
    fail("cutover_source_drift", `${label} generation disappeared.`);
  }
  const opened = fstatSync(descriptor);
  if (
    (!opened.isFile() && !opened.isDirectory()) ||
    (!current.isFile() && !current.isDirectory()) ||
    current.isSymbolicLink() ||
    !pinnedFileIdentityMatches(opened, identity) ||
    !pinnedFileIdentityMatches(current, identity) ||
    String(opened.dev) !== record.sourceDev ||
    String(opened.ino) !== record.sourceIno ||
    realpathSync(filePath) !== path.resolve(filePath)
  ) {
    fail("cutover_source_drift", `${label} generation changed.`);
  }
  requireSnapshotMatch(record.sourceSnapshot, filePath, label);
}

function requireRetiredRemoval(record) {
  if (existsSync(record.filePath) || !existsSync(record.quarantinePath)) {
    fail(
      "cutover_write_ahead_conflict",
      "Cutover removal did not retain one exact retired generation.",
    );
  }
  const pinned = openPinnedRemovalPath(
    record,
    record.quarantinePath,
    "Cutover retired removal",
  );
  closeSync(pinned.descriptor);
}

function movePinnedRemovalToRetirement(record, pinned) {
  const opened = fstatSync(pinned.descriptor);
  if (opened.isFile()) {
    const bytes = readExactDescriptorBytes(
      pinned.descriptor,
      opened,
      CUTOVER_MAX_FILE_BYTES,
      "Cutover removal source",
    );
    runDurablePrivateFileMove(record.filePath, record.quarantinePath, {
      ...pinned,
      bytes,
    }, {
      allowedModes: new Set([opened.mode & 0o7777]),
    });
    return;
  }
  if (opened.isDirectory()) {
    runDurablePrivateDirectoryMove(
      record.filePath,
      record.quarantinePath,
      pinned,
      {
        expectedTreeDigest: record.sourceSnapshot.nativeTreeDigest,
      },
    );
    return;
  }
  fail(
    "cutover_source_drift",
    `Cutover removal source has an unsupported type: ${record.filePath}`,
  );
}

function requirePinnedEmptyDirectoryInventory(directoryPath, pinned) {
  requirePinnedPrivateDirectoryPath(
    directoryPath,
    pinned,
    "Cutover recovery directory",
  );
  const bytes = runCutoverNativeHelperBytes(
    "list-bounded",
    [
      "1",
      "255",
      String(pinned.identity.dev),
      String(pinned.identity.ino),
    ],
    [pinned.descriptor],
    { maxBuffer: 256 },
  );
  requirePinnedPrivateDirectoryPath(
    directoryPath,
    pinned,
    "Cutover recovery directory",
  );
  if (bytes.length !== 0) {
    fail(
      "cutover_write_ahead_conflict",
      `Cutover recovery directory is not empty: ${directoryPath}`,
    );
  }
}

function openPinnedEmptyPrivateDirectory(directoryPath) {
  const before = requirePrivateDirectory(directoryPath, directoryPath);
  const descriptor = openSync(
    directoryPath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  const opened = fstatSync(descriptor);
  if (
    !opened.isDirectory() ||
    opened.dev !== before.dev ||
    opened.ino !== before.ino ||
    opened.uid !== before.uid ||
    opened.mode !== before.mode
  ) {
    closeSync(descriptor);
    fail(
      "cutover_write_ahead_conflict",
      `Cutover recovery directory changed: ${directoryPath}`,
    );
  }
  const pinned = { descriptor, identity: pinnedFileIdentity(opened) };
  try {
    requirePinnedEmptyDirectoryInventory(directoryPath, pinned);
    return pinned;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function requirePinnedEmptyPrivateDirectory(directoryPath, pinned) {
  const current = requirePrivateDirectory(directoryPath, directoryPath);
  const opened = fstatSync(pinned.descriptor);
  if (
    !opened.isDirectory() ||
    !pinnedFileIdentityMatches(opened, pinned.identity) ||
    !pinnedFileIdentityMatches(current, pinned.identity)
  ) {
    fail(
      "cutover_write_ahead_conflict",
      `Cutover recovery directory changed: ${directoryPath}`,
    );
  }
  requirePinnedEmptyDirectoryInventory(directoryPath, pinned);
}

function retirePinnedEmptyPrivateDirectory(
  directoryPath,
  pinned,
  retirementDirectory,
  beforeMutation = () => undefined,
) {
  ensurePrivateDirectory(retirementDirectory, beforeMutation);
  const archivePath = path.join(
    retirementDirectory,
    `${sha256(
      canonicalJsonBytes({
        directoryPath,
        device: String(pinned.identity.dev),
        inode: String(pinned.identity.ino),
      }),
    )}.archive`,
  );
  beforeMutation({ directoryPath, archivePath });
  requirePinnedEmptyPrivateDirectory(directoryPath, pinned);
  runDurablePrivateDirectoryMove(directoryPath, archivePath, pinned, {
    expectedTreeDigest: automationKernelGuardSnapshotNativeTreeDigest({
      path: directoryPath,
      kind: "directory",
      mode: pinned.identity.mode,
      entries: [],
    }),
    maxEntries: 1,
    maxDepth: 0,
    maxAggregateBytes: 0,
  });
  return archivePath;
}

function completePreparedRemoval(
  plan,
  record,
  {
    supersedePlan = undefined,
    checkpoint = () => undefined,
    checkpointName = "remove",
    beforeMutation = () => undefined,
  } = {},
) {
  const sourceExists = existsSync(record.filePath);
  const quarantineExists = existsSync(record.quarantinePath);
  if (sourceExists && quarantineExists) {
    fail(
      "cutover_write_ahead_conflict",
      "Cutover removal exists at both canonical and quarantine paths.",
    );
  }
  let occurrencePinned = null;
  try {
    if (sourceExists) {
      occurrencePinned = openPinnedRemovalPath(
        record,
        record.filePath,
        "Cutover removal source",
      );
      beforeMutation();
      requirePinnedRemovalPath(
        record,
        record.filePath,
        occurrencePinned.descriptor,
        occurrencePinned.identity,
        "Cutover removal source",
      );
      if (existsSync(record.quarantinePath)) {
        fail(
          "cutover_write_ahead_conflict",
          "Cutover removal quarantine appeared before publication.",
        );
      }
      movePinnedRemovalToRetirement(record, occurrencePinned);
      if (existsSync(record.filePath)) {
        fail(
          "cutover_write_ahead_conflict",
          "Cutover removal source was replaced during quarantine publication.",
        );
      }
      requirePinnedRemovalPath(
        record,
        record.quarantinePath,
        occurrencePinned.descriptor,
        occurrencePinned.identity,
        "Cutover quarantine occurrence",
      );
      checkpoint(`${checkpointName}-after-rename`, {
        filePath: record.filePath,
        quarantinePath: record.quarantinePath,
        operationId: record.operationId,
      });
      requirePinnedRemovalPath(
        record,
        record.quarantinePath,
        occurrencePinned.descriptor,
        occurrencePinned.identity,
        "Cutover quarantine occurrence",
      );
      if (existsSync(record.filePath)) {
        fail(
          "cutover_write_ahead_conflict",
          "Cutover removal source was replaced after quarantine publication.",
        );
      }
    }
    if (existsSync(record.quarantinePath)) {
      if (occurrencePinned === null) {
        occurrencePinned = openPinnedRemovalPath(
          record,
          record.quarantinePath,
          "Cutover quarantine occurrence",
        );
      }
      requirePinnedRemovalPath(
        record,
        record.quarantinePath,
        occurrencePinned.descriptor,
        occurrencePinned.identity,
        "Cutover quarantine occurrence",
      );
      if (existsSync(record.filePath)) {
        fail(
          "cutover_write_ahead_conflict",
          "Cutover removal source was replaced after retirement.",
        );
      }
      checkpoint(`${checkpointName}-after-quarantine-remove`, {
        quarantinePath: record.quarantinePath,
        operationId: record.operationId,
        retained: true,
      });
      requirePinnedRemovalPath(
        record,
        record.quarantinePath,
        occurrencePinned.descriptor,
        occurrencePinned.identity,
        "Cutover retired removal",
      );
    }
  } finally {
    if (occurrencePinned !== null) closeSync(occurrencePinned.descriptor);
  }
  syncDirectory(path.dirname(record.filePath));
  syncDirectory(path.dirname(record.quarantinePath));
  const written =
    record.phase === "written"
      ? record
      : { ...record, phase: "written", writtenAt: new Date().toISOString() };
  const requireRemovalState = (...args) => {
    beforeMutation(...args);
    requireRetiredRemoval(record);
  };
  const removalCheckpoint = (name, details) => {
    checkpoint(name, details);
    requireRetiredRemoval(record);
  };
  writeWriteAheadRecord(
    plan,
    written,
    supersedePlan,
    requireRemovalState,
    removalCheckpoint,
  );
  clearWriteAheadRecord(
    plan,
    removalCheckpoint,
    `${checkpointName}-journal-unlinked`,
    { filePath: record.filePath, operationId: record.operationId },
    requireRemovalState,
    written,
    `${checkpointName}-journal-written`,
  );
  requireRetiredRemoval(record);
}

function removePathRecoverably(plan, filePath, sourceSnapshot, options) {
  const record = preparedRemovalRecord(plan, filePath, sourceSnapshot, options);
  if (record === null) return;
  completePreparedRemoval(plan, record, options);
}

function recoverPendingWriteAhead(
  plan,
  {
    supersedePlan = undefined,
    checkpoint = () => undefined,
    beforeMutation = () => undefined,
  } = {},
) {
  const record = readWriteAheadRecord(plan, supersedePlan);
  if (record === null) {
    const quarantineRoot = cutoverQuarantineRoot(plan);
    if (existsSync(quarantineRoot)) {
      const pinned = openPinnedEmptyPrivateDirectory(quarantineRoot);
      try {
        retirePinnedEmptyPrivateDirectory(
          quarantineRoot,
          pinned,
          cutoverRetirementDirectory(plan, "legacy-quarantine-roots"),
          beforeMutation,
        );
      } finally {
        closeSync(pinned.descriptor);
      }
    }
    return;
  }
  const options = {
    supersedePlan: record.scope === "supersede" ? supersedePlan : undefined,
    checkpoint,
    checkpointName: record.operationName,
    beforeMutation,
  };
  if (record.operation === "rewrite") {
    completePreparedRewrite(plan, record, options);
  } else {
    completePreparedRemoval(plan, record, options);
  }
}

function installNoReplacePermanentMarker(
  plan,
  filePath,
  checkpoint = () => undefined,
  checkpointName = "permanent-marker-linked",
  beforeMutation = () => undefined,
) {
  const bytes = automationKernelGuardMarkerBytes();
  installNoReplaceExactBytes(filePath, bytes, {
    checkpoint,
    checkpointName,
    temporarySuffix: "cutover",
    beforeMutation,
    recoveryCheckpointName: checkpointName,
    retirementDirectory: cutoverRetirementDirectory(
      plan,
      "immutable-hard-links",
    ),
  });
  if (!exactMarkerFile(filePath)) {
    fail("cutover_conflict", `Cutover marker did not verify: ${filePath}`);
  }
}

function readOpenedBytes(descriptor, opened, maxBytes) {
  if (
    !Number.isSafeInteger(opened.size) ||
    opened.size < 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    opened.size > maxBytes
  ) {
    fail(
      "cutover_source_drift",
      "Legacy marker source exceeds its bounded rewrite size.",
    );
  }
  const bytes = Buffer.alloc(opened.size);
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
  if (offset !== bytes.length) {
    fail(
      "cutover_source_drift",
      "Legacy marker source changed while being read.",
    );
  }
  return bytes;
}

function writeSnapshotArchive(
  plan,
  expected,
  targetPath,
  beforeMutation = () => undefined,
) {
  if (expected.kind === "missing") {
    if (existsSync(targetPath)) {
      fail(
        "cutover_conflict",
        `Unexpected cutover archive entry: ${targetPath}`,
      );
    }
    return;
  }
  if (expected.kind === "file") {
    writeCutoverImmutable(
      plan,
      targetPath,
      Buffer.from(expected.bytesBase64, "base64"),
      { beforeMutation },
    );
    return;
  }
  ensurePrivateDirectory(targetPath, beforeMutation);
  const expectedNames = expected.entries
    .map((entry) => path.basename(entry.path))
    .sort();
  const actualNames = readdirSync(targetPath).sort();
  const unexpected = actualNames.find((name) => !expectedNames.includes(name));
  if (unexpected !== undefined) {
    fail(
      "cutover_conflict",
      `Unexpected cutover archive entry: ${path.join(targetPath, unexpected)}`,
    );
  }
  for (const child of expected.entries) {
    writeSnapshotArchive(
      plan,
      child,
      path.join(targetPath, path.basename(child.path)),
      beforeMutation,
    );
  }
}

function verifySnapshotArchive(expected, targetPath) {
  if (expected.kind === "missing") {
    if (existsSync(targetPath)) {
      fail(
        "cutover_conflict",
        `Unexpected cutover archive entry: ${targetPath}`,
      );
    }
    return;
  }
  if (expected.kind === "file") {
    const bytes = readPrivateMode600File(targetPath, expected.size);
    if (
      bytes.length !== expected.size ||
      sha256(bytes) !== expected.digest ||
      bytes.toString("base64") !== expected.bytesBase64
    ) {
      fail("cutover_conflict", `Cutover archive bytes changed: ${targetPath}`);
    }
    return;
  }
  requirePrivateDirectory(targetPath, `Cutover archive ${targetPath}`);
  const expectedNames = expected.entries
    .map((entry) => path.basename(entry.path))
    .sort();
  const actualNames = readdirSync(targetPath).sort();
  if (actualNames.join("\n") !== expectedNames.join("\n")) {
    fail(
      "cutover_conflict",
      `Cutover archive directory changed: ${targetPath}`,
    );
  }
  for (const child of expected.entries) {
    verifySnapshotArchive(
      child,
      path.join(targetPath, path.basename(child.path)),
    );
  }
}

function archiveLegacySources(plan, beforeMutation = () => undefined) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const directory = artifactDirectory(plan);
  const movedRoot = path.join(directory, "legacy-paths");
  ensurePrivateDirectory(movedRoot, beforeMutation);
  const writer = sourceEntry(plan, paths.writerLock);
  const guards = sourceEntry(plan, paths.guardsRoot);
  writeSnapshotArchive(
    plan,
    writer,
    path.join(movedRoot, "outcomes.jsonl.writer-lock"),
    beforeMutation,
  );
  writeSnapshotArchive(
    plan,
    guards,
    path.join(movedRoot, "guards"),
    beforeMutation,
  );
  verifySnapshotArchive(
    writer,
    path.join(movedRoot, "outcomes.jsonl.writer-lock"),
  );
  verifySnapshotArchive(guards, path.join(movedRoot, "guards"));
  syncDirectory(movedRoot);
}

function verifyLegacyArchive(plan) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const movedRoot = path.join(artifactDirectory(plan), "legacy-paths");
  verifySnapshotArchive(
    sourceEntry(plan, paths.writerLock),
    path.join(movedRoot, "outcomes.jsonl.writer-lock"),
  );
  verifySnapshotArchive(
    sourceEntry(plan, paths.guardsRoot),
    path.join(movedRoot, "guards"),
  );
}

function removeUnlinkedClaimTemporary(
  filePath,
  plan,
  transaction,
  target,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  const temporaryPath = `${filePath}.cutover-claim.tmp`;
  if (!existsSync(temporaryPath)) return;
  const expectedByteOptions = transaction.claimGenerations.map((generation) =>
    cutoverClaimBytes(plan, generation, target),
  );
  removePrivateTemporaryFile(
    temporaryPath,
    expectedByteOptions,
    {
      retirementDirectory: cutoverRetirementDirectory(
        plan,
        "claim-temporaries",
      ),
      beforeMutation,
      beforeUnlink: () =>
        checkpoint("supersede-claim-temporary-before-remove", {
          filePath,
          temporaryPath,
          target,
        }),
    },
  );
}

function restoreWriterClaim(
  plan,
  transaction,
  supersedePlan,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const expected = sourceEntry(plan, paths.writerLock);
  const target = "writer";
  recoverAnyClaimLink(
    paths.writerLock,
    plan,
    transaction,
    target,
    beforeMutation,
  );
  removeUnlinkedClaimTemporary(
    paths.writerLock,
    plan,
    transaction,
    target,
    checkpoint,
    beforeMutation,
  );
  if (expected.kind === "missing") {
    if (!existsSync(paths.writerLock)) return;
    if (
      claimGenerationForFile(paths.writerLock, plan, transaction, target) ===
      undefined
    ) {
      fail(
        "cutover_supersede_conflict",
        "Outcome writer claim changed before supersession.",
      );
    }
    removePathRecoverably(
      plan,
      paths.writerLock,
      snapshotPath(paths.writerLock),
      {
        operationName: "supersede-writer-remove",
        supersedePlan,
        checkpoint,
        checkpointName: "supersede-writer-remove",
        beforeMutation,
      },
    );
    return;
  }
  const expectedBytes = expectedFileBytes(expected);
  try {
    requireSnapshotMatch(expected, paths.writerLock, "Restored outcome writer");
    return;
  } catch (error) {
    if (error?.code !== "cutover_source_drift") throw error;
  }
  if (
    claimGenerationForFile(paths.writerLock, plan, transaction, target) ===
    undefined
  ) {
    fail(
      "cutover_supersede_conflict",
      "Outcome writer claim changed before supersession.",
    );
  }
  rewritePrivateFileInPlace(
    plan,
    paths.writerLock,
    priorClaimByteOptions(plan, transaction, target),
    expectedBytes,
    {
      checkpointName: "supersede-writer-before-restore",
      operationName: "supersede-writer-restore",
      supersedePlan,
      checkpoint,
      allowedModes: new Set([0o600]),
      targetMode: expected.mode,
      beforeMutation,
    },
  );
  requireSnapshotMatch(expected, paths.writerLock, "Restored outcome writer");
}

function guardExpectedOwner(expected) {
  return expected.kind === "directory"
    ? expected.entries.find(
        (entry) => path.basename(entry.path) === "owner.json",
      )
    : undefined;
}

function restoreGuardClaim(
  plan,
  transaction,
  supersedePlan,
  name,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const guard = paths.guards[name];
  const expected = plannedGuardEntry(plan, guard.directory);
  const target = `guard:${name}`;
  recoverAnyClaimLink(guard.owner, plan, transaction, target, beforeMutation);
  removeUnlinkedClaimTemporary(
    guard.owner,
    plan,
    transaction,
    target,
    checkpoint,
    beforeMutation,
  );
  if (expected.kind === "missing") {
    if (!existsSync(guard.directory)) return;
    requireClaimDirectory(
      guard.directory,
      `Claim-created guard ${guard.directory}`,
    );
    const entries = readdirSync(guard.directory);
    if (
      entries.length !== 1 ||
      entries[0] !== "owner.json" ||
      claimGenerationForFile(guard.owner, plan, transaction, target) ===
        undefined
    ) {
      fail(
        "cutover_supersede_conflict",
        `Claim-created guard changed before supersession: ${guard.directory}`,
      );
    }
    removePathRecoverably(
      plan,
      guard.directory,
      snapshotPath(guard.directory),
      {
        operationName: `supersede-guard-${name}-remove`,
        supersedePlan,
        checkpoint,
        checkpointName: `supersede-guard-${name}-remove`,
        beforeMutation,
      },
    );
    return;
  }

  requireClaimDirectory(guard.directory, `Claimed guard ${guard.directory}`);
  if (existsSync(guard.inner)) {
    fail(
      "cutover_supersede_too_late",
      `Guard conversion already created ${guard.inner}.`,
    );
  }
  const expectedOwner = guardExpectedOwner(expected);
  if (expectedOwner === undefined) {
    if (existsSync(guard.owner)) {
      if (
        claimGenerationForFile(guard.owner, plan, transaction, target) ===
        undefined
      ) {
        fail(
          "cutover_supersede_conflict",
          `Guard claim changed before supersession: ${guard.owner}`,
        );
      }
      removePathRecoverably(plan, guard.owner, snapshotPath(guard.owner), {
        operationName: `supersede-guard-${name}-owner-remove`,
        supersedePlan,
        checkpoint,
        checkpointName: `supersede-guard-${name}-owner-remove`,
        beforeMutation,
      });
    }
  } else {
    try {
      requireSnapshotMatch(expectedOwner, guard.owner, "Restored guard owner");
    } catch (error) {
      if (error?.code !== "cutover_source_drift") throw error;
      if (
        claimGenerationForFile(guard.owner, plan, transaction, target) ===
        undefined
      ) {
        fail(
          "cutover_supersede_conflict",
          `Guard claim changed before supersession: ${guard.owner}`,
        );
      }
      rewritePrivateFileInPlace(
        plan,
        guard.owner,
        priorClaimByteOptions(plan, transaction, target),
        expectedFileBytes(expectedOwner),
        {
          checkpointName: "supersede-guard-before-restore",
          operationName: `supersede-guard-${name}-restore`,
          supersedePlan,
          checkpoint,
          allowedModes: new Set([0o600]),
          targetMode: expectedOwner.mode,
          beforeMutation,
        },
      );
    }
  }
  if ((lstatSync(guard.directory).mode & 0o7777) !== expected.mode) {
    setPinnedDirectoryMode(guard.directory, expected.mode, {
      beforeMutation,
      checkpoint,
      checkpointName: `supersede-guard-${name}-before-mode-restore`,
    });
  }
  requireSnapshotMatch(expected, guard.directory, `Restored guard ${name}`);
}

function restoreCutoverClaims(
  plan,
  transaction,
  supersedePlan,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  requireSupersedeStillPreMarker(plan);
  restoreWriterClaim(
    plan,
    transaction,
    supersedePlan,
    checkpoint,
    beforeMutation,
  );
  for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
    restoreGuardClaim(
      plan,
      transaction,
      supersedePlan,
      name,
      checkpoint,
      beforeMutation,
    );
  }
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  requireSnapshotMatch(
    sourceEntry(plan, paths.writerLock),
    paths.writerLock,
    "Restored outcome writer source",
  );
  requireSnapshotMatch(
    sourceEntry(plan, paths.guardsRoot),
    paths.guardsRoot,
    "Restored guard root source",
  );
}

function plannedGuardEntry(plan, guardPath) {
  return sourceEntry(plan, guardPath) ?? { path: guardPath, kind: "missing" };
}

function requireClaimDirectory(directoryPath, label) {
  let stats;
  try {
    stats = lstatSync(directoryPath);
  } catch (error) {
    fail(
      "cutover_source_drift",
      `${label} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid(stats) ||
    ![0o700, 0o755].includes(stats.mode & 0o7777) ||
    realpathSync(directoryPath) !== path.resolve(directoryPath)
  ) {
    fail("cutover_source_drift", `${label} changed after planning.`);
  }
  return stats;
}

function expectedFileBytes(expected) {
  return expected?.kind === "file"
    ? Buffer.from(expected.bytesBase64, "base64")
    : null;
}

function priorClaimByteOptions(plan, transaction, target) {
  return transaction.claimGenerations.map((generation) =>
    cutoverClaimBytes(plan, generation, target),
  );
}

function installWriterClaim(
  plan,
  transaction,
  generation,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const filePath = paths.writerLock;
  const target = "writer";
  const targetBytes = cutoverClaimBytes(plan, generation, target);
  recoverAnyClaimLink(filePath, plan, transaction, target, beforeMutation);
  recoverPermanentMarkerLink(
    plan,
    filePath,
    beforeMutation,
    checkpoint,
    "writer-marker-linked",
  );
  if (
    exactMarkerFile(filePath) ||
    exactPrivateFileBytes(filePath, targetBytes)
  ) {
    syncDirectory(path.dirname(filePath));
    return;
  }
  const expected = sourceEntry(plan, filePath) ?? {
    path: filePath,
    kind: "missing",
  };
  if (!existsSync(filePath)) {
    if (expected.kind !== "missing") {
      fail(
        "cutover_source_drift",
        "Legacy outcome writer disappeared before claim.",
      );
    }
    installNoReplaceExactBytes(filePath, targetBytes, {
      checkpoint,
      checkpointName: "writer-claim-linked",
      temporarySuffix: "cutover-claim",
      beforeMutation,
      retirementDirectory: cutoverRetirementDirectory(
        plan,
        "immutable-hard-links",
      ),
    });
    checkpoint("writer-claim-durable", { filePath });
    return;
  }
  const priorClaims = priorClaimByteOptions(plan, transaction, target);
  const expectedBytes = expectedFileBytes(expected);
  const previousClaim = claimGenerationForFile(
    filePath,
    plan,
    transaction,
    target,
  );
  if (
    previousClaim === undefined &&
    legacyOwnerIsLive(readLegacyOwner(filePath))
  ) {
    fail(
      "cutover_old_guard_busy",
      "An older outcome writer still owns its lock.",
    );
  }
  const allowedBytes = [
    ...priorClaims,
    ...(expectedBytes === null ? [] : [expectedBytes]),
  ];
  if (allowedBytes.length === 0) {
    fail(
      "cutover_source_drift",
      "Unexpected outcome writer appeared before claim.",
    );
  }
  rewritePrivateFileInPlace(plan, filePath, allowedBytes, targetBytes, {
    checkpoint,
    checkpointName: "writer-claim-before-write",
    operationName: "writer-claim",
    allowedModes: new Set([
      0o600,
      ...(expected?.kind === "file" ? [expected.mode] : []),
    ]),
    beforeMutation,
  });
  checkpoint("writer-claim-durable", { filePath });
}

function validateGuardClaimProgress(
  plan,
  transaction,
  guard,
  expected,
  target,
) {
  requireClaimDirectory(guard.directory, `Legacy guard ${guard.directory}`);
  const expectedByName = new Map(
    expected.kind === "directory"
      ? expected.entries.map((entry) => [path.basename(entry.path), entry])
      : [],
  );
  const allowedNames = new Set([
    ...expectedByName.keys(),
    "owner.json",
    "kernel.lock",
  ]);
  for (const name of readdirSync(guard.directory)) {
    const currentPath = path.join(guard.directory, name);
    if (!allowedNames.has(name)) {
      fail(
        "cutover_source_drift",
        `Unexpected legacy guard entry appeared: ${currentPath}`,
      );
    }
    if (
      name === "owner.json" &&
      (exactMarkerFile(currentPath) ||
        claimGenerationForFile(currentPath, plan, transaction, target) !==
          undefined)
    ) {
      continue;
    }
    if (name === "owner.json" && !expectedByName.has(name)) {
      continue;
    }
    if (name === "kernel.lock" && exactMarkerFile(currentPath)) continue;
    const expectedEntry = expectedByName.get(name);
    if (expectedEntry === undefined) {
      fail(
        "cutover_source_drift",
        `Unexpected legacy guard entry appeared: ${currentPath}`,
      );
    }
    requireSnapshotMatch(
      expectedEntry,
      currentPath,
      `Legacy guard entry ${currentPath}`,
    );
  }
  for (const [name] of expectedByName) {
    if (!existsSync(path.join(guard.directory, name))) {
      fail(
        "cutover_source_drift",
        `Planned legacy guard entry disappeared: ${path.join(guard.directory, name)}`,
      );
    }
  }
}

function installGuardClaim(
  plan,
  transaction,
  generation,
  name,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const guard = paths.guards[name];
  const expected = plannedGuardEntry(plan, guard.directory);
  const target = `guard:${name}`;
  const targetBytes = cutoverClaimBytes(plan, generation, target);
  recoverAnyClaimLink(guard.owner, plan, transaction, target, beforeMutation);
  recoverPermanentMarkerLink(
    plan,
    guard.owner,
    beforeMutation,
    checkpoint,
    "guard-owner-marker-linked",
  );
  recoverPermanentMarkerLink(
    plan,
    guard.inner,
    beforeMutation,
    checkpoint,
    "guard-inner-marker-linked",
  );
  if (exactMarkerDirectory(guard)) return;
  if (!existsSync(guard.directory)) {
    if (expected.kind !== "missing") {
      fail(
        "cutover_source_drift",
        `Legacy guard path disappeared: ${guard.directory}`,
      );
    }
    checkpoint("guard-claim-before-mkdir", {
      guardName: name,
      directory: guard.directory,
    });
    try {
      ensurePrivateDirectory(guard.directory, beforeMutation);
      checkpoint("guard-claim-directory-durable", {
        guardName: name,
        directory: guard.directory,
      });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  validateGuardClaimProgress(plan, transaction, guard, expected, target);
  if (exactMarkerFile(guard.owner)) return;
  if (!existsSync(guard.owner)) {
    try {
      installNoReplaceExactBytes(guard.owner, targetBytes, {
        checkpoint,
        checkpointName: "guard-claim-linked",
        temporarySuffix: "cutover-claim",
        beforeMutation,
        retirementDirectory: cutoverRetirementDirectory(
          plan,
          "immutable-hard-links",
        ),
      });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = readLegacyOwner(guard.owner);
      if (legacyOwnerIsLive(owner)) {
        fail(
          "cutover_old_guard_busy",
          `An older guard owns ${guard.directory}.`,
        );
      }
      fail(
        "cutover_source_drift",
        `Unexpected guard owner appeared: ${guard.owner}`,
      );
    }
  } else if (!exactPrivateFileBytes(guard.owner, targetBytes)) {
    const previousClaim = claimGenerationForFile(
      guard.owner,
      plan,
      transaction,
      target,
    );
    const expectedOwner =
      expected.kind === "directory"
        ? expected.entries.find(
            (entry) => path.basename(entry.path) === "owner.json",
          )
        : undefined;
    if (
      previousClaim === undefined &&
      legacyOwnerIsLive(readLegacyOwner(guard.owner))
    ) {
      fail("cutover_old_guard_busy", `An older guard owns ${guard.directory}.`);
    }
    const expectedOwnerBytes = expectedFileBytes(expectedOwner);
    const allowedBytes = [
      ...priorClaimByteOptions(plan, transaction, target),
      ...(expectedOwnerBytes === null ? [] : [expectedOwnerBytes]),
    ];
    if (allowedBytes.length === 0) {
      fail(
        "cutover_source_drift",
        `Unexpected guard owner appeared: ${guard.owner}`,
      );
    }
    rewritePrivateFileInPlace(plan, guard.owner, allowedBytes, targetBytes, {
      checkpoint,
      checkpointName: "guard-claim-before-write",
      operationName: `guard-${name}-claim`,
      allowedModes: new Set([
        0o600,
        ...(expectedOwner?.kind === "file" ? [expectedOwner.mode] : []),
      ]),
      beforeMutation,
    });
  }
  checkpoint("guard-claim-durable", {
    guardName: name,
    directory: guard.directory,
  });
  validateGuardClaimProgress(plan, transaction, guard, expected, target);
  if (!exactPrivateFileBytes(guard.owner, targetBytes)) {
    fail(
      "cutover_conflict",
      `Cutover guard claim did not verify: ${guard.directory}`,
    );
  }
}

function installCutoverClaims(
  plan,
  transaction,
  generation,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  installWriterClaim(plan, transaction, generation, checkpoint, beforeMutation);
  for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
    installGuardClaim(
      plan,
      transaction,
      generation,
      name,
      checkpoint,
      beforeMutation,
    );
  }
}

function validateCutoverClaims(plan, transaction, generation) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  if (
    !exactMarkerFile(paths.writerLock) &&
    !exactClaimFile(paths.writerLock, plan, generation, "writer")
  ) {
    fail(
      "cutover_claim_conflict",
      "Outcome writer claim changed before activation.",
    );
  }
  for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
    const guard = paths.guards[name];
    const expected = plannedGuardEntry(plan, guard.directory);
    if (exactMarkerDirectory(guard)) continue;
    const target = `guard:${name}`;
    validateGuardClaimProgress(plan, transaction, guard, expected, target);
    if (
      !exactMarkerFile(guard.owner) &&
      !exactClaimFile(guard.owner, plan, generation, target)
    ) {
      fail(
        "cutover_claim_conflict",
        `Guard claim changed before activation: ${name}`,
      );
    }
  }
}

function installPermanentTargets(
  plan,
  transaction,
  generation,
  checkpoint = () => undefined,
  beforeMutation = () => undefined,
) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  if (!exactMarkerFile(paths.writerLock)) {
    const claimBytes = cutoverClaimBytes(plan, generation, "writer");
    rewritePrivateFileInPlace(
      plan,
      paths.writerLock,
      [claimBytes],
      automationKernelGuardMarkerBytes(),
      {
        checkpoint,
        checkpointName: "writer-marker-before-write",
        operationName: "writer-marker",
        allowedModes: new Set([0o600]),
        beforeMutation,
      },
    );
    checkpoint("writer-marker-durable", { filePath: paths.writerLock });
  } else {
    syncDirectory(path.dirname(paths.writerLock));
  }
  for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
    const guard = paths.guards[name];
    const expected = plannedGuardEntry(plan, guard.directory);
    const target = `guard:${name}`;
    if (!exactMarkerFile(guard.owner)) {
      rewritePrivateFileInPlace(
        plan,
        guard.owner,
        [cutoverClaimBytes(plan, generation, target)],
        automationKernelGuardMarkerBytes(),
        {
          checkpoint,
          checkpointName: "guard-owner-marker-before-write",
          operationName: `guard-${name}-owner-marker`,
          allowedModes: new Set([0o600]),
          beforeMutation,
        },
      );
      checkpoint("guard-owner-marker-durable", {
        guardName: name,
        filePath: guard.owner,
      });
    }
    if (!exactMarkerFile(guard.inner)) {
      installNoReplacePermanentMarker(
        plan,
        guard.inner,
        checkpoint,
        "guard-inner-marker-linked",
        beforeMutation,
      );
      checkpoint("guard-inner-marker-durable", {
        guardName: name,
        filePath: guard.inner,
      });
    }
    if ((lstatSync(guard.directory).mode & 0o7777) !== 0o700) {
      setPinnedDirectoryMode(guard.directory, 0o700, {
        beforeMutation,
        checkpoint,
        checkpointName: `guard-${name}-before-private-mode`,
      });
    }
    const expectedByName = new Map(
      expected.kind === "directory"
        ? expected.entries.map((entry) => [path.basename(entry.path), entry])
        : [],
    );
    for (const entryName of readdirSync(guard.directory)) {
      if (entryName === "owner.json" || entryName === "kernel.lock") continue;
      const currentPath = path.join(guard.directory, entryName);
      const expectedEntry = expectedByName.get(entryName);
      if (expectedEntry === undefined) {
        fail(
          "cutover_source_drift",
          `Unexpected legacy guard entry appeared: ${currentPath}`,
        );
      }
    }
    for (const [entryName, expectedEntry] of expectedByName) {
      if (entryName === "owner.json" || entryName === "kernel.lock") continue;
      const currentPath = path.join(guard.directory, entryName);
      if (!existsSync(currentPath)) {
        syncDirectory(guard.directory);
        continue;
      }
      removePathRecoverably(plan, currentPath, expectedEntry, {
        operationName: `guard-${name}-remove-${sha256(Buffer.from(entryName)).slice(0, 16)}`,
        checkpoint,
        checkpointName: `guard-${name}-legacy-remove`,
        beforeMutation,
      });
    }
    syncDirectory(guard.directory);
    if (!exactMarkerDirectory(guard)) {
      fail(
        "cutover_conflict",
        `Cutover guard did not verify: ${guard.directory}`,
      );
    }
  }
  const plannedGuards = sourceEntry(plan, paths.guardsRoot);
  const canonicalNames = new Set(
    AUTOMATION_KERNEL_GUARD_NAMES.map((name) => `${name}.lock`),
  );
  for (const entry of plannedGuards.entries) {
    const name = path.basename(entry.path);
    if (canonicalNames.has(name)) continue;
    if (!existsSync(entry.path)) {
      const permanentSetReady =
        exactMarkerFile(paths.writerLock) &&
        AUTOMATION_KERNEL_GUARD_NAMES.every((guardName) =>
          exactMarkerDirectory(paths.guards[guardName]),
        );
      if (!permanentSetReady) {
        fail(
          "cutover_source_drift",
          `Planned abandoned guard disappeared early: ${entry.path}`,
        );
      }
      continue;
    }
    removePathRecoverably(plan, entry.path, entry, {
      operationName: `abandoned-guard-remove-${sha256(Buffer.from(entry.path)).slice(0, 16)}`,
      checkpoint,
      checkpointName: "abandoned-guard-remove",
      beforeMutation,
    });
  }
  syncDirectory(paths.guardsRoot);
  validatePermanentTargets(plan);
}

function validatePermanentTargets(plan) {
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const expectedNames = AUTOMATION_KERNEL_GUARD_NAMES.map(
    (name) => `${name}.lock`,
  ).sort();
  const actualNames = readdirSync(paths.guardsRoot).sort();
  if (actualNames.join("\n") !== expectedNames.join("\n")) {
    fail(
      "cutover_conflict",
      "Permanent guard root contains unexpected entries.",
    );
  }
  if (!exactMarkerFile(paths.writerLock)) {
    fail("cutover_conflict", "Permanent outcome writer marker did not verify.");
  }
  if (!exactMarkerFile(paths.bootstrapLock)) {
    fail("cutover_conflict", "Permanent bootstrap marker did not verify.");
  }
  for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
    if (!exactMarkerDirectory(paths.guards[name])) {
      fail("cutover_conflict", `Permanent guard ${name} did not verify.`);
    }
  }
}

function buildReceipt(plan, transaction) {
  if (
    transaction.phase !== "receipt-prepared" ||
    !Number.isFinite(Date.parse(String(transaction.completedAt ?? "")))
  ) {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover receipt is not durably prepared.",
    );
  }
  const expectedTransactionBytes = prettyJsonBytes(transaction);
  const transactionBytes = readPrivateMode600File(
    transactionPath(plan),
    expectedTransactionBytes.length,
  );
  if (!transactionBytes.equals(expectedTransactionBytes)) {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover transaction bytes are not canonical.",
    );
  }
  const receiptAuthorization = transaction.authorizations.at(-1);
  const core = {
    schemaVersion: 1,
    policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
    cutoverId: plan.parameters.cutoverId,
    stateRoot: plan.parameters.stateRoot,
    markerDigest: AUTOMATION_KERNEL_GUARD_MARKER_DIGEST,
    guardNames: [...AUTOMATION_KERNEL_GUARD_NAMES],
    sourceSnapshotDigest: plan.parameters.sourceSnapshotDigest,
    archiveManifestDigest: plan.parameters.archiveManifestDigest,
    transactionDigest: sha256(transactionBytes),
    intentDigest: plan.intentDigest,
    confirmationId: receiptAuthorization.confirmationId,
    confirmationDigest: receiptAuthorization.confirmationDigest,
    completedAt: transaction.completedAt,
  };
  const artifactBytes = canonicalAutomationKernelGuardReceiptBytes(core);
  const artifactReceipt = path.join(artifactDirectory(plan), "receipt.json");
  return {
    core,
    artifactBytes,
    artifactReceipt,
    global: {
      ...core,
      artifactReceipt,
      artifactReceiptDigest: sha256(artifactBytes),
    },
  };
}

function requireExactPrivateBytes(filePath, expectedBytes, label) {
  const actual = readPrivateMode600File(filePath, expectedBytes.length);
  if (!actual.equals(expectedBytes)) {
    fail("cutover_conflict", `${label} changed after it was prepared.`);
  }
}

function verifyPreparedArtifacts(
  plan,
  transaction,
  { requireReceipt = true } = {},
) {
  const directory = artifactDirectory(plan);
  requirePrivateDirectory(directory, "Kernel guard cutover artifact directory");
  const authorizationDirectory = path.join(directory, "authorizations");
  requirePrivateDirectory(
    authorizationDirectory,
    "Kernel guard cutover authorization directory",
  );
  const expectedAuthorizationNames = [
    "prepared-authorization.json",
    ...new Set(
      transaction.authorizations.map((authorization) =>
        path.basename(authorization.confirmationArtifact),
      ),
    ),
  ].sort();
  const actualAuthorizationNames = readdirSync(authorizationDirectory).sort();
  if (
    actualAuthorizationNames.join("\n") !==
    expectedAuthorizationNames.join("\n")
  ) {
    fail(
      "cutover_conflict",
      "Cutover authorization evidence set changed after preparation.",
    );
  }
  const receiptPath = path.join(directory, "receipt.json");
  const receiptTemporaryPath = `${receiptPath}.cutover.tmp`;
  const receiptExists = existsSync(receiptPath);
  const receiptTemporaryExists = existsSync(receiptTemporaryPath);
  const expectedArtifactNames = [
    "authorizations",
    "legacy-locks.json",
    "legacy-paths",
    "plan.json",
    "source-snapshot.json",
    ...(receiptExists || requireReceipt ? ["receipt.json"] : []),
    ...(!requireReceipt && receiptTemporaryExists
      ? ["receipt.json.cutover.tmp"]
      : []),
  ].sort();
  const actualArtifactNames = readdirSync(directory).sort();
  if (actualArtifactNames.join("\n") !== expectedArtifactNames.join("\n")) {
    fail(
      "cutover_conflict",
      "Cutover prepared artifact set changed before activation.",
    );
  }
  requireExactPrivateBytes(
    path.join(directory, "plan.json"),
    prettyJsonBytes(plan),
    "Cutover plan artifact",
  );
  requireExactPrivateBytes(
    path.join(directory, "source-snapshot.json"),
    canonicalJsonBytes(plan.sourceSnapshot),
    "Cutover source snapshot artifact",
  );
  requireExactPrivateBytes(
    path.join(directory, "legacy-locks.json"),
    canonicalJsonBytes(legacyManifest(plan)),
    "Cutover legacy manifest artifact",
  );
  verifyLegacyArchive(plan);
  if (transaction.phase === "receipt-prepared") {
    const receipt = buildReceipt(plan, transaction);
    if (!requireReceipt && (receiptExists || receiptTemporaryExists)) {
      requireCutoverImmutableTargetPreflight(
        plan,
        receipt.artifactReceipt,
        receipt.artifactBytes,
      );
    } else if (receiptExists) {
      requireExactPrivateBytes(
        receipt.artifactReceipt,
        receipt.artifactBytes,
        "Cutover receipt artifact",
      );
    } else if (requireReceipt) {
      fail(
        "cutover_conflict",
        "Cutover receipt artifact is missing after terminal preparation.",
      );
    }
  }
}

function prepareBootstrapLock(plan, beforeMutation = () => undefined) {
  const lockPath = path.join(
    plan.parameters.stateRoot,
    "control",
    "kernel-guard-cutover.bootstrap.lock",
  );
  installNoReplacePermanentMarker(
    plan,
    lockPath,
    () => undefined,
    "bootstrap-marker-linked",
    beforeMutation,
  );
  return lockPath;
}

function validateReceiptPreparedActivation(
  plan,
  transaction,
  { requireReceipt, requireCompleteLeaseRuntimeStorage = false },
) {
  requireQuiescence(plan, { allowLeaseRuntimeStorage: true });
  validateStaticSource(plan, {
    allowLeaseRuntimeStorage: true,
    requireCompleteLeaseRuntimeStorage,
  });
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    transaction,
    extraPaths: leaseRuntimeStorageLayout(plan.parameters.stateRoot)
      .requiredDirectories,
  });
  if (readWriteAheadRecord(plan) !== null) {
    fail(
      "cutover_write_ahead_invalid",
      "Terminal cutover recovery has a pending filesystem mutation.",
    );
  }
  if (existsSync(cutoverQuarantineRoot(plan))) {
    fail(
      "cutover_write_ahead_invalid",
      "Terminal cutover recovery has quarantine residue.",
    );
  }
  validatePermanentTargets(plan);
  verifyPreparedArtifacts(plan, transaction, { requireReceipt });
}

function finishReceiptPreparedCutover(
  plan,
  transaction,
  checkpoint = () => undefined,
) {
  if (transaction.phase !== "receipt-prepared") {
    fail(
      "cutover_transaction_invalid",
      "Kernel guard cutover is not durably prepared for activation.",
    );
  }
  validateReceiptPreparedActivation(plan, transaction, {
    requireReceipt: false,
  });
  ensureLeaseRuntimeDirectoryScaffold(plan, checkpoint);
  validateReceiptPreparedActivation(plan, transaction, {
    requireReceipt: false,
    requireCompleteLeaseRuntimeStorage: true,
  });
  const receipt = buildReceipt(plan, transaction);
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  requireCutoverImmutableTargetPreflight(
    plan,
    receipt.artifactReceipt,
    receipt.artifactBytes,
  );
  requireCutoverImmutableTargetPreflight(
    plan,
    paths.globalReceipt,
    prettyJsonBytes(receipt.global),
  );
  writeCutoverImmutable(plan, receipt.artifactReceipt, receipt.artifactBytes, {
    checkpoint,
    linkedCheckpointName: "receipt-artifact-linked",
    beforeFinalize() {
      validateReceiptPreparedActivation(plan, transaction, {
        requireReceipt: false,
        requireCompleteLeaseRuntimeStorage: true,
      });
    },
  });
  checkpoint("receipt-artifact-durable", {
    filePath: receipt.artifactReceipt,
  });
  validateReceiptPreparedActivation(plan, transaction, {
    requireReceipt: true,
    requireCompleteLeaseRuntimeStorage: true,
  });
  writeCutoverImmutable(plan, paths.globalReceipt, prettyJsonBytes(receipt.global), {
    checkpoint,
    linkedCheckpointName: "global-receipt-linked",
    beforeFinalize() {
      validateReceiptPreparedActivation(plan, transaction, {
        requireReceipt: true,
        requireCompleteLeaseRuntimeStorage: true,
      });
    },
  });
  checkpoint("global-receipt-durable", {
    filePath: paths.globalReceipt,
  });
  validateReceiptPreparedActivation(plan, transaction, {
    requireReceipt: true,
    requireCompleteLeaseRuntimeStorage: true,
  });
  const inspection = inspectAutomationKernelGuardCutover(
    plan.parameters.stateRoot,
  );
  if (!inspection.ready) {
    fail(
      "cutover_verification_failed",
      "Completed kernel guard cutover did not verify.",
      { problems: inspection.problems },
    );
  }
  return inspection.receipt;
}

function supersedeEvidencePaths(oldPlan, supersedePlan) {
  const directory = path.join(
    artifactDirectory(oldPlan),
    "superseded",
    supersedePlan.parameters.supersedeId,
  );
  return {
    directory,
    plan: path.join(directory, "supersede-plan.json"),
    transaction: path.join(directory, "superseded-transaction.json"),
    receipt: path.join(directory, "receipt.json"),
  };
}

function supersedeReceiptKeys() {
  return [
    "archiveManifestDigest",
    "claimGenerationsDigest",
    "confirmationBytesBase64",
    "confirmationDigest",
    "confirmationId",
    "confirmationPath",
    "confirmationRawDigest",
    "confirmationValidatedAt",
    "currentTaskDigest",
    "cutoverId",
    "intentDigest",
    "kind",
    "oldPlanDigest",
    "policy",
    "schemaVersion",
    "sourceSnapshotDigest",
    "stateRoot",
    "supersedeId",
    "supersedePlanDigest",
    "supersededAt",
    "taskId",
    "transactionDigest",
    "transactionPhase",
  ].sort();
}

function supersedeAuthorizationFields(supersedePlan, authorization) {
  const confirmationBytes = readPrivateMode600File(
    authorization.confirmationFile,
    64 * 1024,
  );
  let confirmation;
  try {
    confirmation = JSON.parse(fatalDecoder.decode(confirmationBytes));
  } catch {
    fail(
      "cutover_authorization_invalid",
      "Validated supersede owner confirmation bytes changed.",
    );
  }
  if (
    ownerGovernanceIntentDigest(confirmation) !== authorization.digest ||
    confirmation.confirmationId !== authorization.confirmation.confirmationId ||
    confirmation.taskId !== supersedePlan.taskId ||
    confirmation.intent?.action !== CUTOVER_SUPERSEDE_ACTION ||
    confirmation.intentDigest !== supersedePlan.intentDigest ||
    ownerGovernanceIntentDigest(confirmation.intent) !==
      supersedePlan.intentDigest
  ) {
    fail(
      "cutover_authorization_invalid",
      "Validated supersede owner confirmation bytes changed.",
    );
  }
  return {
    confirmationId: confirmation.confirmationId,
    confirmationDigest: authorization.digest,
    confirmationPath: authorization.confirmationFile,
    confirmationBytesBase64: confirmationBytes.toString("base64"),
    confirmationRawDigest: sha256(confirmationBytes),
    confirmationValidatedAt: new Date().toISOString(),
  };
}

function supersedeReceiptAuthorizationIsValid(receipt, supersedePlan) {
  let bytes;
  let confirmation;
  try {
    bytes = Buffer.from(receipt.confirmationBytesBase64, "base64");
    if (
      bytes.toString("base64") !== receipt.confirmationBytesBase64 ||
      sha256(bytes) !== receipt.confirmationRawDigest
    ) {
      return false;
    }
    confirmation = JSON.parse(fatalDecoder.decode(bytes));
  } catch {
    return false;
  }
  const requiredKeys = [
    "approvalSource",
    "approvedAt",
    "approvedBy",
    "confirmationId",
    "expiresAt",
    "intent",
    "intentDigest",
    "kind",
    "ownerApprovalReference",
    "schemaVersion",
    "taskId",
  ].sort();
  const source = confirmation?.approvalSource;
  const approvedAtMs = Date.parse(String(confirmation?.approvedAt ?? ""));
  const expiresAtMs = Date.parse(String(confirmation?.expiresAt ?? ""));
  const validatedAtMs = Date.parse(
    String(receipt.confirmationValidatedAt ?? ""),
  );
  const supersededAtMs = Date.parse(String(receipt.supersededAt ?? ""));
  return (
    confirmation?.schemaVersion === 1 &&
    confirmation?.kind === "owner-confirmation" &&
    Object.keys(confirmation).sort().join("\n") === requiredKeys.join("\n") &&
    confirmation.confirmationId === receipt.confirmationId &&
    confirmation.approvedBy === "AubreyF" &&
    typeof confirmation.ownerApprovalReference === "string" &&
    confirmation.ownerApprovalReference.trim() !== "" &&
    source !== null &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    Object.keys(source).sort().join("\n") === "kind\nreference" &&
    source.kind === "current-task" &&
    typeof source.reference === "string" &&
    source.reference.trim() !== "" &&
    confirmation.taskId === supersedePlan.taskId &&
    confirmation.intent?.taskId === supersedePlan.taskId &&
    confirmation.intent?.action === CUTOVER_SUPERSEDE_ACTION &&
    confirmation.intentDigest === supersedePlan.intentDigest &&
    ownerGovernanceIntentDigest(confirmation.intent) ===
      supersedePlan.intentDigest &&
    ownerGovernanceIntentDigest(confirmation) === receipt.confirmationDigest &&
    path.isAbsolute(receipt.confirmationPath) &&
    path.resolve(receipt.confirmationPath) === receipt.confirmationPath &&
    isCanonicalTimestamp(confirmation.approvedAt) &&
    isCanonicalTimestamp(confirmation.expiresAt) &&
    isCanonicalTimestamp(receipt.confirmationValidatedAt) &&
    Number.isFinite(approvedAtMs) &&
    Number.isFinite(expiresAtMs) &&
    Number.isFinite(validatedAtMs) &&
    Number.isFinite(supersededAtMs) &&
    expiresAtMs > approvedAtMs &&
    validatedAtMs >= approvedAtMs &&
    validatedAtMs < expiresAtMs &&
    supersededAtMs >= validatedAtMs &&
    supersededAtMs < expiresAtMs
  );
}

function validateSupersedeReceipt(receipt, supersedePlan) {
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    Object.keys(receipt).sort().join("\n") !==
      supersedeReceiptKeys().join("\n") ||
    receipt.schemaVersion !== 1 ||
    receipt.kind !== CUTOVER_SUPERSEDE_RECEIPT_KIND ||
    receipt.policy !== AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY ||
    receipt.taskId !== supersedePlan.taskId ||
    receipt.stateRoot !== supersedePlan.parameters.stateRoot ||
    receipt.cutoverId !== supersedePlan.parameters.cutoverId ||
    receipt.supersedeId !== supersedePlan.parameters.supersedeId ||
    receipt.oldPlanDigest !== supersedePlan.parameters.oldPlanDigest ||
    receipt.transactionDigest !== supersedePlan.parameters.transactionDigest ||
    receipt.transactionPhase !== supersedePlan.parameters.transactionPhase ||
    receipt.claimGenerationsDigest !==
      supersedePlan.parameters.claimGenerationsDigest ||
    receipt.sourceSnapshotDigest !==
      supersedePlan.parameters.sourceSnapshotDigest ||
    receipt.archiveManifestDigest !==
      supersedePlan.parameters.archiveManifestDigest ||
    receipt.currentTaskDigest !== supersedePlan.parameters.currentTaskDigest ||
    receipt.intentDigest !== supersedePlan.intentDigest ||
    receipt.supersedePlanDigest !== sha256(canonicalJsonBytes(supersedePlan)) ||
    !IDENTIFIER_PATTERN.test(String(receipt.confirmationId ?? "")) ||
    !SHA256_PATTERN.test(String(receipt.confirmationDigest ?? "")) ||
    !SHA256_PATTERN.test(String(receipt.confirmationRawDigest ?? "")) ||
    !supersedeReceiptAuthorizationIsValid(receipt, supersedePlan) ||
    !isCanonicalTimestamp(receipt.supersededAt)
  ) {
    fail(
      "cutover_supersede_conflict",
      "Kernel guard cutover supersede receipt conflicts.",
    );
  }
  return receipt;
}

function readSupersedeReceipt(oldPlan, supersedePlan) {
  const evidence = supersedeEvidencePaths(oldPlan, supersedePlan);
  if (!existsSync(evidence.receipt)) return null;
  let receipt;
  const bytes = readPrivateMode600File(
    evidence.receipt,
    1024 * 1024,
    new Set([1, 2]),
  );
  requireCutoverImmutableTargetPreflight(oldPlan, evidence.receipt, bytes);
  try {
    receipt = JSON.parse(fatalDecoder.decode(bytes));
  } catch {
    fail(
      "cutover_supersede_conflict",
      "Kernel guard cutover supersede receipt is malformed.",
    );
  }
  validateSupersedeReceipt(receipt, supersedePlan);
  if (!bytes.equals(prettyJsonBytes(receipt))) {
    fail(
      "cutover_supersede_conflict",
      "Kernel guard cutover supersede receipt bytes are not canonical.",
    );
  }
  return receipt;
}

function writeSupersedePreparedEvidence(
  oldPlan,
  supersedePlan,
  transactionBytes,
  beforeMutation = () => undefined,
) {
  const directory = artifactDirectory(oldPlan);
  ensurePrivateDirectory(directory, beforeMutation);
  writeCutoverImmutable(oldPlan, path.join(directory, "plan.json"), prettyJsonBytes(oldPlan), {
    beforeMutation,
  });
  writeCutoverImmutable(
    oldPlan,
    path.join(directory, "source-snapshot.json"),
    canonicalJsonBytes(oldPlan.sourceSnapshot),
    { beforeMutation },
  );
  writeCutoverImmutable(
    oldPlan,
    path.join(directory, "legacy-locks.json"),
    canonicalJsonBytes(legacyManifest(oldPlan)),
    { beforeMutation },
  );
  archiveLegacySources(oldPlan, beforeMutation);
  verifyLegacyArchive(oldPlan);
  const evidence = supersedeEvidencePaths(oldPlan, supersedePlan);
  ensurePrivateDirectory(evidence.directory, beforeMutation);
  writeCutoverImmutable(oldPlan, evidence.plan, prettyJsonBytes(supersedePlan), {
    beforeMutation,
  });
  writeCutoverImmutable(oldPlan, evidence.transaction, transactionBytes, {
    beforeMutation,
  });
  return evidence;
}

function verifySupersedeEvidence(oldPlan, supersedePlan, transactionBytes) {
  const oldDirectory = artifactDirectory(oldPlan);
  requireExactPrivateBytes(
    path.join(oldDirectory, "plan.json"),
    prettyJsonBytes(oldPlan),
    "Superseded cutover plan artifact",
  );
  requireExactPrivateBytes(
    path.join(oldDirectory, "source-snapshot.json"),
    canonicalJsonBytes(oldPlan.sourceSnapshot),
    "Superseded cutover source artifact",
  );
  requireExactPrivateBytes(
    path.join(oldDirectory, "legacy-locks.json"),
    canonicalJsonBytes(legacyManifest(oldPlan)),
    "Superseded cutover archive manifest",
  );
  verifyLegacyArchive(oldPlan);
  const evidence = supersedeEvidencePaths(oldPlan, supersedePlan);
  requireExactPrivateBytes(
    evidence.plan,
    prettyJsonBytes(supersedePlan),
    "Cutover supersede plan artifact",
  );
  requireExactPrivateBytes(
    evidence.transaction,
    transactionBytes,
    "Cutover superseded transaction artifact",
  );
  return readSupersedeReceipt(oldPlan, supersedePlan);
}

function buildSupersedeReceipt(supersedePlan, authorization) {
  const authorizationFields = supersedeAuthorizationFields(
    supersedePlan,
    authorization,
  );
  return {
    schemaVersion: 1,
    kind: CUTOVER_SUPERSEDE_RECEIPT_KIND,
    policy: AUTOMATION_KERNEL_GUARD_CUTOVER_POLICY,
    taskId: supersedePlan.taskId,
    stateRoot: supersedePlan.parameters.stateRoot,
    cutoverId: supersedePlan.parameters.cutoverId,
    supersedeId: supersedePlan.parameters.supersedeId,
    oldPlanDigest: supersedePlan.parameters.oldPlanDigest,
    transactionDigest: supersedePlan.parameters.transactionDigest,
    transactionPhase: supersedePlan.parameters.transactionPhase,
    claimGenerationsDigest: supersedePlan.parameters.claimGenerationsDigest,
    sourceSnapshotDigest: supersedePlan.parameters.sourceSnapshotDigest,
    archiveManifestDigest: supersedePlan.parameters.archiveManifestDigest,
    currentTaskDigest: supersedePlan.parameters.currentTaskDigest,
    intentDigest: supersedePlan.intentDigest,
    supersedePlanDigest: sha256(canonicalJsonBytes(supersedePlan)),
    ...authorizationFields,
    supersededAt: new Date().toISOString(),
  };
}

function requireCurrentSupersedeReceiptAuthorization(
  supersedePlan,
  receipt,
  authorize,
) {
  const currentAuthorization = authorize();
  const currentFields = supersedeAuthorizationFields(
    supersedePlan,
    currentAuthorization,
  );
  for (const key of [
    "confirmationBytesBase64",
    "confirmationDigest",
    "confirmationId",
    "confirmationPath",
    "confirmationRawDigest",
  ]) {
    if (currentFields[key] !== receipt[key]) {
      fail(
        "cutover_authorization_invalid",
        "The supersede receipt authorization changed before publication.",
      );
    }
  }
  return currentAuthorization;
}

function requireSupersedeCurrentTask(oldPlan, supersedePlan) {
  const currentTask = currentCanonicalTask(oldPlan);
  if (
    stableJson(currentTask) !== stableJson(supersedePlan.currentTask) ||
    sha256(canonicalJsonBytes(currentTask)) !==
      supersedePlan.parameters.currentTaskDigest
  ) {
    fail(
      "cutover_supersede_source_drift",
      "Canonical task changed after cutover supersede planning.",
    );
  }
}

function completedSupersedeResult(oldPlan, supersedePlan) {
  const paths = automationKernelGuardCutoverPaths(oldPlan.parameters.stateRoot);
  const evidence = supersedeEvidencePaths(oldPlan, supersedePlan);
  requireNoAmbiguousSupersedeTemporaries(oldPlan, {
    supersedePlan,
    includeBootstrap: true,
    includeCompletedEvidence: true,
  });
  if (!existsSync(evidence.transaction)) {
    fail(
      "cutover_supersede_conflict",
      "No preserved transaction can authenticate completed supersession.",
    );
  }
  const archivedTransactionBytes = readPrivateMode600File(
    evidence.transaction,
    CUTOVER_TRANSACTION_MAX_BYTES,
  );
  if (
    sha256(archivedTransactionBytes) !==
    supersedePlan.parameters.transactionDigest
  ) {
    fail(
      "cutover_supersede_conflict",
      "Preserved superseded transaction conflicts.",
    );
  }
  const receipt = verifySupersedeEvidence(
    oldPlan,
    supersedePlan,
    archivedTransactionBytes,
  );
  if (receipt === null) {
    fail(
      "cutover_supersede_conflict",
      "Retired cutover transaction has no supersede receipt.",
    );
  }
  requireSnapshotMatch(
    sourceEntry(oldPlan, paths.writerLock),
    paths.writerLock,
    "Superseded outcome writer source",
  );
  requireSnapshotMatch(
    sourceEntry(oldPlan, paths.guardsRoot),
    paths.guardsRoot,
    "Superseded guard root source",
  );
  return {
    changed: false,
    action: CUTOVER_SUPERSEDE_ACTION,
    taskId: supersedePlan.taskId,
    intentDigest: supersedePlan.intentDigest,
    receipt,
  };
}

function recoverCompletedSupersede(oldPlan, supersedePlan) {
  const paths = automationKernelGuardCutoverPaths(oldPlan.parameters.stateRoot);
  const evidence = supersedeEvidencePaths(oldPlan, supersedePlan);
  if (
    existsSync(paths.transaction) ||
    existsSync(paths.writeAhead) ||
    existsSync(cutoverQuarantineRoot(oldPlan)) ||
    !existsSync(evidence.transaction) ||
    !existsSync(evidence.receipt)
  ) {
    return null;
  }
  requireNoAmbiguousSupersedeTemporaries(oldPlan, {
    supersedePlan,
    includeBootstrap: true,
    includeCompletedEvidence: true,
  });
  if (!exactMarkerFile(paths.bootstrapLock)) return null;
  return withKernelFileGuard(
    paths.bootstrapLock,
    () => {
      requireNoAmbiguousSupersedeTemporaries(oldPlan, {
        supersedePlan,
        includeBootstrap: true,
        includeCompletedEvidence: true,
      });
      const transactionRecord = exactTransactionRecord(oldPlan);
      const writeAhead = readWriteAheadRecord(oldPlan, supersedePlan);
      if (
        transactionRecord !== null ||
        writeAhead !== null ||
        existsSync(cutoverQuarantineRoot(oldPlan))
      ) {
        return null;
      }
      requireSupersedeStillPreMarker(oldPlan);
      return completedSupersedeResult(oldPlan, supersedePlan);
    },
    { label: "completed kernel guard cutover supersede", timeoutMs: 15_000 },
  );
}

export function applyAutomationKernelGuardCutoverSupersede({
  plan: rawOldPlan,
  supersedePlan: rawSupersedePlan,
  ownerConfirmationFile,
  checkpoint = () => undefined,
}) {
  const oldPlan = normalizePlan(rawOldPlan);
  const supersedePlan = normalizeSupersedePlan(rawSupersedePlan, oldPlan);
  requireLocalFilesystem(oldPlan.parameters.stateRoot, {
    plan: oldPlan,
    supersedePlan,
  });
  requireNoAmbiguousSupersedeTemporaries(oldPlan, {
    deferSupersedeWriteAheadTemporary: true,
  });
  const completed = recoverCompletedSupersede(oldPlan, supersedePlan);
  if (completed !== null) return completed;
  const authorize = () =>
    validateCurrentTaskOwnerConfirmation({
      confirmationFile: ownerConfirmationFile,
      taskId: supersedePlan.taskId,
      intentDigest: supersedePlan.intentDigest,
      nowMs: Date.now(),
    });
  authorize();
  const preBootstrapWriteAheadTemporary =
    readRecoverableSupersedeWriteAheadTemporary(oldPlan, supersedePlan);
  requireSupersedeCurrentTask(oldPlan, supersedePlan);
  const preBootstrapTransactionRecord = exactTransactionRecord(oldPlan);
  const preBootstrapWriteAhead = readWriteAheadRecord(oldPlan, supersedePlan);
  requireSupersedeWriteAheadScope(preBootstrapWriteAhead);
  requireLocalFilesystem(oldPlan.parameters.stateRoot, {
    plan: oldPlan,
    supersedePlan,
    transaction: preBootstrapTransactionRecord?.transaction,
    extraPaths: [
      ...writeAheadFilesystemPaths(preBootstrapWriteAhead),
      ...writeAheadFilesystemPaths(
        preBootstrapWriteAheadTemporary?.record ?? null,
      ),
    ],
  });
  requireQuiescence(oldPlan);
  const bootstrapLock = prepareBootstrapLock(oldPlan, authorize);
  return withKernelFileGuard(
    bootstrapLock,
    () => {
      requireQuiescence(oldPlan);
      requireNoAmbiguousSupersedeTemporaries(oldPlan, {
        supersedePlan,
        includeBootstrap: true,
        deferSupersedeWriteAheadTemporary: true,
      });
      const authorization = authorize();
      const authorizedCheckpoint = (name, details) => {
        checkpoint(name, details);
        authorize();
      };
      requireSupersedeStillPreMarker(oldPlan);
      requireSupersedeCurrentTask(oldPlan, supersedePlan);
      recoverSupersedeWriteAheadTemporary(oldPlan, supersedePlan, {
        checkpoint: authorizedCheckpoint,
        beforeMutation: authorize,
      });
      requireNoAmbiguousSupersedeTemporaries(oldPlan, {
        supersedePlan,
        includeBootstrap: true,
      });
      requireSupersedeWriteAheadScope(
        readWriteAheadRecord(oldPlan, supersedePlan),
      );
      requireSupersedeStillPreMarker(oldPlan);
      requireSupersedeCurrentTask(oldPlan, supersedePlan);
      const paths = automationKernelGuardCutoverPaths(
        oldPlan.parameters.stateRoot,
      );
      recoverPendingWriteAhead(oldPlan, {
        supersedePlan,
        checkpoint: authorizedCheckpoint,
        beforeMutation: authorize,
      });
      requireNoAmbiguousSupersedeTemporaries(oldPlan, {
        supersedePlan,
        includeBootstrap: true,
      });
      let transactionRecord = exactTransactionRecord(oldPlan);
      requireLocalFilesystem(oldPlan.parameters.stateRoot, {
        plan: oldPlan,
        supersedePlan,
        transaction: transactionRecord?.transaction,
      });
      const evidence = supersedeEvidencePaths(oldPlan, supersedePlan);
      if (transactionRecord === null) {
        return completedSupersedeResult(oldPlan, supersedePlan);
      }
      if (
        transactionRecord.transaction.phase !==
          supersedePlan.parameters.transactionPhase ||
        !["prepared", "claims-installed"].includes(
          transactionRecord.transaction.phase,
        ) ||
        sha256(transactionRecord.bytes) !==
          supersedePlan.parameters.transactionDigest ||
        sha256(
          canonicalJsonBytes(transactionRecord.transaction.claimGenerations),
        ) !== supersedePlan.parameters.claimGenerationsDigest
      ) {
        fail(
          "cutover_supersede_conflict",
          "Canonical cutover transaction changed after supersede planning.",
        );
      }

      writeSupersedePreparedEvidence(
        oldPlan,
        supersedePlan,
        transactionRecord.bytes,
        authorize,
      );
      authorizedCheckpoint("supersede-evidence-durable", {
        supersedeId: supersedePlan.parameters.supersedeId,
      });
      requireSupersedeStillPreMarker(oldPlan);
      restoreCutoverClaims(
        oldPlan,
        transactionRecord.transaction,
        supersedePlan,
        authorizedCheckpoint,
        authorize,
      );
      authorizedCheckpoint("supersede-claims-restored", {
        supersedeId: supersedePlan.parameters.supersedeId,
      });
      requireQuiescence(oldPlan);
      requireSupersedeStillPreMarker(oldPlan);
      requireSupersedeCurrentTask(oldPlan, supersedePlan);
      const finalAuthorization = authorize();
      requireLocalFilesystem(oldPlan.parameters.stateRoot, {
        plan: oldPlan,
        supersedePlan,
        transaction: transactionRecord.transaction,
      });
      const requireProtectedSupersedeState = ({
        canonicalTransactionRequired,
        receiptRequired,
        activeAtomicMutation = undefined,
      }) => {
        authorize();
        requireQuiescence(oldPlan);
        requireSupersedeStillPreMarker(oldPlan);
        requireSupersedeCurrentTask(oldPlan, supersedePlan);
        requireLocalFilesystem(oldPlan.parameters.stateRoot, {
          plan: oldPlan,
          supersedePlan,
          transaction: transactionRecord.transaction,
        });
        requireNoAmbiguousSupersedeTemporaries(oldPlan, {
          supersedePlan,
          includeBootstrap: true,
          activeAtomicMutation,
        });
        if (canonicalTransactionRequired) {
          const currentTransaction = exactTransactionRecord(oldPlan);
          if (
            currentTransaction === null ||
            !currentTransaction.bytes.equals(transactionRecord.bytes)
          ) {
            fail(
              "cutover_supersede_conflict",
              "Canonical cutover transaction changed before supersede retirement.",
            );
          }
        }
        const currentReceipt = verifySupersedeEvidence(
          oldPlan,
          supersedePlan,
          transactionRecord.bytes,
        );
        if (receiptRequired && currentReceipt === null) {
          fail(
            "cutover_supersede_conflict",
            "Durable supersede receipt is missing before transaction retirement.",
          );
        }
        authorize();
        return currentReceipt;
      };
      let receipt = readSupersedeReceipt(oldPlan, supersedePlan);
      if (receipt === null) {
        receipt = buildSupersedeReceipt(
          supersedePlan,
          finalAuthorization ?? authorization,
        );
      }
      validateSupersedeReceipt(receipt, supersedePlan);
      const receiptWasPublished = existsSync(evidence.receipt);
      const requireReceiptPublicationState = () => {
        requireProtectedSupersedeState({
          canonicalTransactionRequired: true,
          receiptRequired: existsSync(evidence.receipt),
        });
        if (!receiptWasPublished) {
          requireCurrentSupersedeReceiptAuthorization(
            supersedePlan,
            receipt,
            authorize,
          );
        }
      };
      writeCutoverImmutable(oldPlan, evidence.receipt, prettyJsonBytes(receipt), {
        checkpoint(name, details) {
          checkpoint(name, details);
          requireReceiptPublicationState();
        },
        linkedCheckpointName: "supersede-receipt-linked",
        beforeMutation: receiptWasPublished
          ? () =>
              requireProtectedSupersedeState({
                canonicalTransactionRequired: true,
                receiptRequired: true,
              })
          : requireReceiptPublicationState,
        beforeFinalize: requireReceiptPublicationState,
      });
      validateSupersedeReceipt(receipt, supersedePlan);
      checkpoint("supersede-receipt-durable", {
        supersedeId: supersedePlan.parameters.supersedeId,
      });
      requireProtectedSupersedeState({
        canonicalTransactionRequired: true,
        receiptRequired: true,
      });
      const requireRetirementState = (activeAtomicMutation = undefined) =>
        requireProtectedSupersedeState({
          canonicalTransactionRequired: false,
          receiptRequired: true,
          activeAtomicMutation,
        });
      removePathRecoverably(
        oldPlan,
        paths.transaction,
        snapshotPath(paths.transaction),
        {
          operationName: "supersede-transaction-retire",
          supersedePlan,
          checkpoint(name, details) {
            checkpoint(name, details);
            requireRetirementState(
              name === "write-ahead-temporary-durable"
                ? {
                    filePath: details?.filePath,
                    temporaryPath: details?.temporaryPath,
                  }
                : undefined,
            );
          },
          checkpointName: "supersede-transaction-retire",
          beforeMutation: requireRetirementState,
        },
      );
      checkpoint("supersede-transaction-retired", {
        supersedeId: supersedePlan.parameters.supersedeId,
      });
      requireRetirementState();
      verifySupersedeEvidence(oldPlan, supersedePlan, transactionRecord.bytes);
      return {
        changed: true,
        action: CUTOVER_SUPERSEDE_ACTION,
        taskId: supersedePlan.taskId,
        intentDigest: supersedePlan.intentDigest,
        receipt,
      };
    },
    { label: "kernel guard cutover supersede", timeoutMs: 15_000 },
  );
}

export function applyAutomationKernelGuardCutover({
  plan: rawPlan,
  ownerConfirmationFile,
  checkpoint = () => undefined,
}) {
  const plan = normalizePlan(rawPlan);
  requireLocalFilesystem(plan.parameters.stateRoot, { plan });
  const paths = automationKernelGuardCutoverPaths(plan.parameters.stateRoot);
  const authorize = () =>
    validateCurrentTaskOwnerConfirmation({
      confirmationFile: ownerConfirmationFile,
      taskId: plan.taskId,
      intentDigest: plan.intentDigest,
      nowMs: Date.now(),
    });
  const preexistingTransaction = readTransaction(plan, () => undefined, {
    allowIncompleteAuthorizationEvidence: true,
  });
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    transaction: preexistingTransaction,
  });
  const initialInspection = inspectAutomationKernelGuardCutover(
    plan.parameters.stateRoot,
  );
  if (
    initialInspection.ready &&
    leaseRuntimeDirectoryScaffoldReady(plan.parameters.stateRoot)
  ) {
    if (preexistingTransaction?.phase !== "receipt-prepared") {
      fail(
        "cutover_transaction_invalid",
        "Active kernel guard cutover has no exact prepared transaction.",
      );
    }
    verifyPreparedArtifacts(plan, preexistingTransaction);
    return {
      changed: false,
      action: CUTOVER_ACTION,
      taskId: plan.taskId,
      intentDigest: plan.intentDigest,
      receipt: initialInspection.receipt,
    };
  }
  if (preexistingTransaction?.phase === "receipt-prepared") {
    if (!exactMarkerFile(paths.bootstrapLock)) {
      fail(
        "cutover_conflict",
        "Terminal cutover recovery has no exact bootstrap marker.",
      );
    }
    return withKernelFileGuard(
      paths.bootstrapLock,
      () => {
        requireQuiescence(plan, { allowLeaseRuntimeStorage: true });
        const transaction = readTransaction(plan, checkpoint);
        if (transaction?.phase !== "receipt-prepared") {
          fail(
            "cutover_transaction_invalid",
            "Terminal cutover recovery transaction changed while waiting.",
          );
        }
        const receipt = finishReceiptPreparedCutover(
          plan,
          transaction,
          checkpoint,
        );
        return {
          changed: true,
          action: CUTOVER_ACTION,
          taskId: plan.taskId,
          intentDigest: plan.intentDigest,
          receipt,
        };
      },
      { label: "kernel guard cutover activation", timeoutMs: 15_000 },
    );
  }
  const preBootstrapAuthorization = authorize();
  const preBootstrapAuthorizationSource = transactionAuthorizationRecord(
    plan,
    preBootstrapAuthorization,
  );
  const reauthorizeExact = () => {
    const currentAuthorization = authorize();
    const currentSource = transactionAuthorizationRecord(
      plan,
      currentAuthorization,
    );
    if (
      !sameTransactionAuthorizationSource(
        currentSource,
        preBootstrapAuthorizationSource,
      )
    ) {
      fail(
        "cutover_authorization_invalid",
        "Owner confirmation changed during kernel guard cutover.",
      );
    }
    return currentAuthorization;
  };
  const authorizedCheckpoint = (name, details) => {
    checkpoint(name, details);
    reauthorizeExact();
  };
  const preBootstrapWriteAhead = readWriteAheadRecord(plan);
  requireLocalFilesystem(plan.parameters.stateRoot, {
    plan,
    transaction: preexistingTransaction,
    extraPaths: [
      ...transactionAuthorizationFilesystemPaths(
        preBootstrapAuthorizationSource,
      ),
      ...writeAheadFilesystemPaths(preBootstrapWriteAhead),
    ],
  });
  requireCutoverImmutableTargetPreflight(
    plan,
    preBootstrapAuthorizationSource.confirmationArtifact,
    Buffer.from(
      preBootstrapAuthorizationSource.confirmationBytesBase64,
      "base64",
    ),
  );
  requireQuiescence(plan);
  if (preexistingTransaction === null) {
    validateUnmigratedSource(plan);
  } else {
    validateStaticSource(plan);
  }
  const bootstrapLock = prepareBootstrapLock(plan, reauthorizeExact);
  return withKernelFileGuard(
    bootstrapLock,
    () => {
      requireQuiescence(plan);
      const authorization = reauthorizeExact();
      let transaction = readTransaction(plan, authorizedCheckpoint, {
        allowIncompleteAuthorizationEvidence: true,
      });
      if (
        transaction === null &&
        existsSync(preparedAuthorizationArtifactPath(plan))
      ) {
        validateUnmigratedSource(plan);
        transaction = recoverPreparedAuthorizationTransaction(
          plan,
          authorizedCheckpoint,
          reauthorizeExact,
        );
      }
      if (transaction !== null && transaction.phase !== "receipt-prepared") {
        validateStaticSource(plan);
        transaction = repairTransactionAuthorizationEvidence(
          plan,
          transaction,
          authorizedCheckpoint,
          reauthorizeExact,
        );
      }
      if (transaction?.phase === "receipt-prepared") {
        const receipt = finishReceiptPreparedCutover(
          plan,
          transaction,
          checkpoint,
        );
        return {
          changed: true,
          action: CUTOVER_ACTION,
          taskId: plan.taskId,
          intentDigest: plan.intentDigest,
          receipt,
        };
      }
      if (transaction !== null) {
        requireLocalFilesystem(plan.parameters.stateRoot, {
          plan,
          transaction,
        });
        recoverPendingWriteAhead(plan, {
          checkpoint: authorizedCheckpoint,
          beforeMutation: reauthorizeExact,
        });
      }
      if (transaction === null) {
        validateUnmigratedSource(plan);
        reauthorizeExact();
        const initialAuthorization = transactionAuthorizationRecord(
          plan,
          authorization,
        );
        if (
          !sameTransactionAuthorizationSource(
            initialAuthorization,
            preBootstrapAuthorizationSource,
          )
        ) {
          fail(
            "cutover_authorization_invalid",
            "Validated owner confirmation changed after filesystem admission.",
          );
        }
        transaction = {
          schemaVersion: 1,
          kind: CUTOVER_TRANSACTION_KIND,
          cutoverId: plan.parameters.cutoverId,
          planDigest: sha256(canonicalJsonBytes(plan)),
          phase: "prepared",
          preparedAt: initialAuthorization.validatedAt,
          authorizations: [initialAuthorization],
          claimGenerations: [],
        };
        writeTransaction(
          plan,
          transaction,
          reauthorizeExact,
          authorizedCheckpoint,
        );
        authorizedCheckpoint("initial-authorization-transaction-durable", {
          confirmationId: initialAuthorization.confirmationId,
        });
        writeAuthorizationEvidence(
          plan,
          initialAuthorization,
          reauthorizeExact,
          authorizedCheckpoint,
          "initial-authorization-evidence-linked",
        );
        authorizedCheckpoint("initial-authorization-evidence-durable", {
          confirmationId: initialAuthorization.confirmationId,
          filePath: initialAuthorization.confirmationArtifact,
        });
        writePreparedAuthorizationEvidence(
          plan,
          initialAuthorization,
          reauthorizeExact,
          authorizedCheckpoint,
          "prepared-authorization-linked",
        );
        authorizedCheckpoint("prepared-authorization-durable", {
          confirmationId: initialAuthorization.confirmationId,
          filePath: preparedAuthorizationArtifactPath(plan),
        });
        authorizedCheckpoint("transaction-prepared-durable", {
          cutoverId: plan.parameters.cutoverId,
        });
      } else {
        validateStaticSource(plan);
        transaction = recordTransactionAuthorization(
          plan,
          transaction,
          authorization,
          preBootstrapAuthorizationSource,
          authorizedCheckpoint,
          reauthorizeExact,
        );
      }

      requireLocalFilesystem(plan.parameters.stateRoot, {
        plan,
        transaction,
      });

      const directory = artifactDirectory(plan);
      ensurePrivateDirectory(directory, reauthorizeExact);
      writeCutoverImmutable(plan, path.join(directory, "plan.json"), prettyJsonBytes(plan), {
        beforeMutation: reauthorizeExact,
      });
      authorizedCheckpoint("plan-artifact-durable", {
        filePath: path.join(directory, "plan.json"),
      });
      writeCutoverImmutable(
        plan,
        path.join(directory, "source-snapshot.json"),
        canonicalJsonBytes(plan.sourceSnapshot),
        { beforeMutation: reauthorizeExact },
      );
      authorizedCheckpoint("source-artifact-durable", {
        filePath: path.join(directory, "source-snapshot.json"),
      });
      writeCutoverImmutable(
        plan,
        path.join(directory, "legacy-locks.json"),
        canonicalJsonBytes(legacyManifest(plan)),
        { beforeMutation: reauthorizeExact },
      );
      authorizedCheckpoint("legacy-manifest-artifact-durable", {
        filePath: path.join(directory, "legacy-locks.json"),
      });

      archiveLegacySources(plan, reauthorizeExact);
      verifyLegacyArchive(plan);
      authorizedCheckpoint("legacy-archive-durable", {
        directory: path.join(directory, "legacy-paths"),
      });
      if (
        transaction.phase === "prepared" ||
        transaction.phase === "claims-installed"
      ) {
        let generation;
        ({ transaction, generation } = currentClaimGeneration(
          plan,
          transaction,
          reauthorizeExact,
          authorizedCheckpoint,
        ));
        installCutoverClaims(
          plan,
          transaction,
          generation,
          authorizedCheckpoint,
          reauthorizeExact,
        );
        authorizedCheckpoint("claims-before-proof", {
          claimToken: generation.claimToken,
        });
        requireQuiescence(plan);
        validateCutoverClaims(plan, transaction, generation);
        verifyLegacyArchive(plan);
        validateStaticSource(plan);
        if (transaction.phase === "prepared") {
          transaction = { ...transaction, phase: "claims-installed" };
          writeTransaction(
            plan,
            transaction,
            reauthorizeExact,
            authorizedCheckpoint,
          );
        }
        authorizedCheckpoint("claims-transaction-durable", {
          claimToken: generation.claimToken,
        });
        requireQuiescence(plan);
        validateCutoverClaims(plan, transaction, generation);
        verifyLegacyArchive(plan);
        validateStaticSource(plan);
        installPermanentTargets(
          plan,
          transaction,
          generation,
          authorizedCheckpoint,
          reauthorizeExact,
        );
        transaction = { ...transaction, phase: "markers-installed" };
        writeTransaction(
          plan,
          transaction,
          reauthorizeExact,
          authorizedCheckpoint,
        );
        authorizedCheckpoint("markers-transaction-durable", {
          cutoverId: plan.parameters.cutoverId,
        });
      }

      const latestGeneration = transaction.claimGenerations.at(-1);
      if (latestGeneration === undefined) {
        fail(
          "cutover_transaction_invalid",
          "Kernel guard cutover has no durable claim generation.",
        );
      }
      installPermanentTargets(
        plan,
        transaction,
        latestGeneration,
        authorizedCheckpoint,
        reauthorizeExact,
      );
      verifyLegacyArchive(plan);
      validateStaticSource(plan);

      if (transaction.phase === "markers-installed") {
        const finalAuthorization = reauthorizeExact();
        transaction = recordTransactionAuthorization(
          plan,
          transaction,
          finalAuthorization,
          preBootstrapAuthorizationSource,
          authorizedCheckpoint,
          reauthorizeExact,
        );
        const finalAuthorizationSource = transaction.authorizations.at(-1);
        if (
          !sameTransactionAuthorizationSource(
            transactionAuthorizationRecord(plan, reauthorizeExact()),
            finalAuthorizationSource,
          )
        ) {
          fail(
            "cutover_authorization_invalid",
            "Final cutover authorization does not match the durable transaction.",
          );
        }
        transaction = {
          ...transaction,
          phase: "receipt-prepared",
          completedAt: finalAuthorizationSource.validatedAt,
        };
        writeTransaction(
          plan,
          transaction,
          reauthorizeExact,
          authorizedCheckpoint,
        );
        checkpoint("receipt-transaction-durable", {
          cutoverId: plan.parameters.cutoverId,
        });
      }
      const receipt = finishReceiptPreparedCutover(
        plan,
        transaction,
        checkpoint,
      );
      return {
        changed: true,
        action: CUTOVER_ACTION,
        taskId: plan.taskId,
        intentDigest: plan.intentDigest,
        receipt,
      };
    },
    { label: "kernel guard cutover", timeoutMs: 15_000 },
  );
}

export function readAutomationKernelGuardCutoverPlan(planFile) {
  return normalizePlan(readPrivatePlanJson(planFile, "Cutover plan"));
}

function readPrivatePlanJson(planFile, label) {
  if (!path.isAbsolute(planFile) || path.resolve(planFile) !== planFile) {
    fail(
      "cutover_plan_invalid",
      `${label} path must be absolute and canonical.`,
    );
  }
  return JSON.parse(
    fatalDecoder.decode(
      readPrivateMode600File(
        planFile,
        AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
      ),
    ),
  );
}

export function readAutomationKernelGuardCutoverSupersedePlan(
  supersedePlanFile,
  oldPlan,
) {
  return normalizeSupersedePlan(
    readPrivatePlanJson(supersedePlanFile, "Cutover supersede plan"),
    normalizePlan(oldPlan),
  );
}

export function writeAutomationKernelGuardCutoverSupersedePlan(
  supersedePlanFile,
  supersedePlan,
  oldPlan,
) {
  if (!path.isAbsolute(supersedePlanFile)) {
    fail(
      "cutover_plan_invalid",
      "Cutover supersede plan path must be absolute.",
    );
  }
  const normalizedOldPlan = normalizePlan(oldPlan);
  const normalized = normalizeSupersedePlan(
    supersedePlan,
    normalizedOldPlan,
  );
  const bytes = assertAutomationKernelGuardCutoverPlanSize(
    prettyJsonBytes(normalized),
  );
  const retirementDirectory = cutoverRetirementDirectory(
    normalizedOldPlan,
    "immutable-hard-links",
  );
  const retainedState = inspectRetainedHardLinkPublication(
    supersedePlanFile,
    `${supersedePlanFile}.cutover.tmp`,
    bytes,
    retirementDirectory,
  );
  if (
    existsSync(supersedePlanFile) &&
    !existsSync(`${supersedePlanFile}.cutover.tmp`) &&
    !retainedState.relevant
  ) {
    fail("cutover_plan_invalid", "Cutover supersede plan file already exists.");
  }
  writeCutoverImmutable(
    normalizedOldPlan,
    supersedePlanFile,
    bytes,
  );
  return supersedePlanFile;
}

export function writeAutomationKernelGuardCutoverPlan(planFile, plan) {
  if (!path.isAbsolute(planFile)) {
    fail("cutover_plan_invalid", "Cutover plan path must be absolute.");
  }
  const normalized = normalizePlan(plan);
  const bytes = assertAutomationKernelGuardCutoverPlanSize(
    prettyJsonBytes(normalized),
  );
  const retirementDirectory = cutoverRetirementDirectory(
    normalized,
    "immutable-hard-links",
  );
  const retainedState = inspectRetainedHardLinkPublication(
    planFile,
    `${planFile}.cutover.tmp`,
    bytes,
    retirementDirectory,
  );
  if (
    existsSync(planFile) &&
    !existsSync(`${planFile}.cutover.tmp`) &&
    !retainedState.relevant
  ) {
    fail("cutover_plan_invalid", "Cutover plan file already exists.");
  }
  writeCutoverImmutable(
    normalized,
    planFile,
    bytes,
  );
  return planFile;
}
