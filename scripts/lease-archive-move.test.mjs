import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readPinnedLeaseArchiveHelperSource,
  resolveLeaseArchivePythonRuntime,
} from "./lib/automation-control.mjs";

const helperPath = path.join(
  import.meta.dirname,
  "lib",
  "lease-archive-move.py",
);
const pythonPath = "/usr/bin/python3";
const helperSource = readFileSync(helperPath, "utf8");
const helperDigest = createHash("sha256").update(helperSource).digest("hex");

function runHelper(operation, args, descriptors = []) {
  return spawnSync(
    pythonPath,
    ["-E", "-I", "-S", "-c", helperSource, operation, ...args.map(String)],
    {
      env: { HOME: os.homedir(), LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe", ...descriptors],
    },
  );
}

function runAuthorityHelper(operation, args, descriptors, input) {
  return spawnSync(
    pythonPath,
    ["-E", "-I", "-S", "-c", helperSource, operation, ...args.map(String)],
    {
      env: { HOME: os.homedir(), LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      input,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe", ...descriptors],
    },
  );
}

function directoryGeneration(directoryPath) {
  const stats = lstatSync(directoryPath);
  return [stats.dev, stats.ino];
}

function fileGeneration(filePath) {
  const stats = lstatSync(filePath);
  return [stats.dev, stats.ino];
}

function durableFileIdentity(filePath) {
  const stats = lstatSync(filePath);
  const bytes = readFileSync(filePath);
  return [
    stats.dev,
    stats.ino,
    stats.mode & 0o7777,
    stats.nlink,
    stats.size,
    createHash("sha256").update(bytes).digest("hex"),
  ];
}

function authorityFileIdentity(filePath) {
  const stats = lstatSync(filePath, { bigint: true });
  const bytes = readFileSync(filePath);
  return [
    stats.dev,
    stats.ino,
    stats.mode & 0o7777n,
    stats.nlink,
    stats.uid,
    stats.gid,
    stats.size,
    stats.mtimeNs,
    stats.ctimeNs,
    createHash("sha256").update(bytes).digest("hex"),
  ].map(String);
}

function authorityParentIdentity(directoryPath) {
  const stats = lstatSync(directoryPath, { bigint: true });
  return [stats.dev, stats.ino, stats.mode & 0o7777n, stats.uid].map(String);
}

function contentIdentity(bytes) {
  return [bytes.length, createHash("sha256").update(bytes).digest("hex")];
}

function cutoverSnapshotArgs(parentPath, name, overrides = {}) {
  const parent = lstatSync(parentPath);
  return [
    name,
    overrides.includeBytes ? "1" : "0",
    overrides.maxFileBytes ?? 128 * 1024 * 1024,
    overrides.maxEntries ?? 4_096,
    overrides.maxDepth ?? 64,
    overrides.maxAggregateBytes ?? 32 * 1024 * 1024,
    overrides.maxOutputBytes ?? 32 * 1024 * 1024,
    parent.dev,
    parent.ino,
    parent.mode & 0o7777,
  ];
}

function snapshotTreeDigest(parentPath, name) {
  return withDescriptors([parentPath], ([parentDescriptor]) => {
    const result = runHelper(
      "snapshot-tree",
      cutoverSnapshotArgs(parentPath, name),
      [parentDescriptor],
    );
    assert.equal(result.status, 0, String(result.stderr));
    const receipt = JSON.parse(String(result.stdout));
    assert.equal(receipt.operation, "snapshot-tree");
    assert.match(receipt.treeDigest, /^[0-9a-f]{64}$/);
    return receipt.treeDigest;
  });
}

function retireDirectoryArgs(
  sourcePath,
  destinationPath,
  treeDigest,
  overrides = {},
) {
  const source = lstatSync(sourcePath);
  const sourceParent = lstatSync(path.dirname(sourcePath));
  const destinationParent = lstatSync(path.dirname(destinationPath));
  return [
    path.basename(sourcePath),
    path.basename(destinationPath),
    source.dev,
    source.ino,
    source.mode & 0o7777,
    source.uid,
    sourceParent.dev,
    sourceParent.ino,
    destinationParent.dev,
    destinationParent.ino,
    treeDigest,
    overrides.maxFileBytes ?? 128 * 1024 * 1024,
    overrides.maxEntries ?? 4_096,
    overrides.maxDepth ?? 64,
    overrides.maxAggregateBytes ?? 32 * 1024 * 1024,
  ];
}

function privateBatchRequest({
  expectedDirectoryNames = [],
  expectedInventoryDigest = null,
  expectedNameCount = null,
  expectedNamesDigest = null,
  includeBytes = false,
  returnInventory = true,
  selectedFileNames = [],
} = {}) {
  return Buffer.from(
    `${JSON.stringify({
      expectedDirectoryNames,
      expectedInventoryDigest,
      expectedNameCount,
      expectedNamesDigest,
      includeBytes,
      returnInventory,
      schemaVersion: 1,
      selectedFileNames,
    })}\n`,
    "utf8",
  );
}

function privateBatchArgs(parentPath, overrides = {}) {
  const parent = lstatSync(parentPath);
  return [
    overrides.maxInventoryEntries ?? 100_000,
    overrides.maxSelectedEntries ?? 4_096,
    overrides.maxEncodedNameBytes ?? 32 * 1024 * 1024,
    overrides.maxRequestBytes ?? 1024 * 1024,
    overrides.maxOutputBytes ?? 16 * 1024 * 1024,
    overrides.maxFileBytes ?? 1024 * 1024,
    overrides.maxInventoryTotalBytes ?? 4 * 1024 * 1024 * 1024,
    overrides.maxSelectedTotalBytes ?? 32 * 1024 * 1024,
    parent.dev,
    parent.ino,
  ];
}

function privateLeaseStateRequest({
  expectedInventoryDigest = null,
  expectedNameCount = null,
  expectedNamesDigest = null,
  includeBytes = false,
  returnInventory = true,
  selectedDirectoryNames = [],
} = {}) {
  return Buffer.from(
    `${JSON.stringify({
      expectedInventoryDigest,
      expectedNameCount,
      expectedNamesDigest,
      includeBytes,
      returnInventory,
      schemaVersion: 1,
      selectedDirectoryNames,
    })}\n`,
    "utf8",
  );
}

function privateLeaseStateArgs(parentPath, overrides = {}) {
  return privateBatchArgs(parentPath, overrides);
}

function assertPrivateBatchParentReceipt(receipt, parentPath) {
  const parent = lstatSync(parentPath, { bigint: true });
  assert.deepEqual(
    [
      receipt.parentDevice,
      receipt.parentInode,
      receipt.parentMode,
      receipt.parentUid,
      receipt.parentGid,
      receipt.parentLinkCount,
      receipt.parentSize,
      receipt.parentMtimeNs,
      receipt.parentCtimeNs,
    ],
    [
      parent.dev,
      parent.ino,
      parent.mode & 0o7777n,
      parent.uid,
      parent.gid,
      parent.nlink,
      parent.size,
      parent.mtimeNs,
      parent.ctimeNs,
    ].map(String),
  );
}

function withDescriptors(paths, operation) {
  const descriptors = paths.map((filePath) =>
    openSync(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ),
  );
  try {
    return operation(descriptors);
  } finally {
    for (const descriptor of descriptors.reverse()) closeSync(descriptor);
  }
}

async function withDescriptorsAsync(paths, operation) {
  const descriptors = paths.map((filePath) =>
    openSync(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ),
  );
  try {
    return await operation(descriptors);
  } finally {
    for (const descriptor of descriptors.reverse()) closeSync(descriptor);
  }
}

function spawnPausedHelper({
  operation,
  args,
  descriptors,
  pause,
  source = "",
  destination = "",
  input,
}) {
  const releaseFd = Math.max(6, 3 + descriptors.length);
  const signalFd = releaseFd + 1;
  const stdio = [input === undefined ? "ignore" : "pipe", "pipe", "pipe", ...descriptors];
  while (stdio.length < releaseFd) stdio.push("ignore");
  stdio.push("pipe", "pipe");
  const child = spawn(
    pythonPath,
    ["-E", "-I", "-S", "-c", helperSource, operation, ...args.map(String)],
    {
      env: {
        HOME: os.homedir(),
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin",
        FREED_REPAIR_MOVE_TEST_PAUSE: pause,
        FREED_REPAIR_MOVE_TEST_OPERATION: operation,
        ...(source ? { FREED_REPAIR_MOVE_TEST_SOURCE: source } : {}),
        ...(destination
          ? { FREED_REPAIR_MOVE_TEST_DESTINATION: destination }
          : {}),
        ...(releaseFd === 6
          ? {}
          : {
              FREED_REPAIR_MOVE_TEST_CONTROL_FDS: `${releaseFd},${signalFd}`,
            }),
      },
      maxBuffer: 16 * 1024 * 1024,
      stdio,
    },
  );
  if (input !== undefined) child.stdin.end(input);
  return { child, releaseFd, signalFd };
}

function waitForHelperPause(child, signalFd, checkpoint) {
  return new Promise((resolve, reject) => {
    let signal = "";
    let stderr = "";
    let settled = false;
    child.stdio[signalFd].setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdio[signalFd].on("data", (chunk) => {
      signal += chunk;
      if (!settled && signal.includes(`${checkpoint}\n`)) {
        settled = true;
        resolve();
      }
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("exit", (code, exitSignal) => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Helper exited before ${checkpoint}, code=${code}, signal=${exitSignal}: ${stderr}`,
        ),
      );
    });
  });
}

function waitForHelperExit(child) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }),
    );
  });
}

function releasePausedHelper(child, releaseFd) {
  child.stdio[releaseFd].end("1");
}

function replacementFixture(t, label) {
  const root = mkdtempSync(path.join(os.tmpdir(), `freed-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const sourceDirectory = path.join(root, "source");
  const destinationDirectory = path.join(root, "destination");
  mkdirSync(sourceDirectory, { mode: 0o700 });
  mkdirSync(destinationDirectory, { mode: 0o700 });
  const sourcePath = path.join(sourceDirectory, "successor.json");
  const destinationPath = path.join(destinationDirectory, "current.json");
  const sourceBytes = Buffer.from(`${label} successor\n`);
  const predecessorBytes = Buffer.from(`${label} predecessor\n`);
  writeFileSync(sourcePath, sourceBytes, { mode: 0o600 });
  writeFileSync(destinationPath, predecessorBytes, { mode: 0o600 });
  const sourceIdentity = durableFileIdentity(sourcePath);
  const predecessorIdentity = durableFileIdentity(destinationPath);
  const sourceParent = directoryGeneration(sourceDirectory);
  const destinationParent = directoryGeneration(destinationDirectory);
  return {
    root,
    sourceDirectory,
    destinationDirectory,
    sourcePath,
    destinationPath,
    sourceBytes,
    predecessorBytes,
    sourceIdentity,
    predecessorIdentity,
    sourceParent,
    destinationParent,
    args: [
      "successor.json",
      "current.json",
      ...sourceIdentity,
      ...predecessorIdentity,
      ...sourceParent,
      ...destinationParent,
    ],
  };
}

function removalFixture(t, label, { retainedLink = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), `freed-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const entryPath = path.join(root, "retire.json");
  const retainedPath = path.join(root, "retained.json");
  const bytes = Buffer.from(`${label} generation\n`);
  writeFileSync(entryPath, bytes, { mode: 0o600 });
  if (retainedLink) linkSync(entryPath, retainedPath);
  const identity = durableFileIdentity(entryPath);
  const parent = directoryGeneration(root);
  return {
    root,
    entryPath,
    retainedPath,
    bytes,
    identity,
    parent,
    args: ["retire.json", ...identity, ...parent],
  };
}

function authorityExchangeFixture(t, label) {
  const root = mkdtempSync(path.join(os.tmpdir(), `freed-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const sourceDirectory = path.join(root, "source");
  const destinationDirectory = path.join(root, "destination");
  mkdirSync(sourceDirectory, { mode: 0o700 });
  mkdirSync(destinationDirectory, { mode: 0o700 });
  const sourcePath = path.join(sourceDirectory, "stage.json");
  const destinationPath = path.join(destinationDirectory, "canonical.json");
  const sourceBytes = Buffer.from(`${label} staged authority\n`);
  const destinationBytes = Buffer.from(`${label} canonical authority\n`);
  writeFileSync(sourcePath, sourceBytes, { mode: 0o600 });
  writeFileSync(destinationPath, destinationBytes, { mode: 0o600 });
  const sourceIdentity = authorityFileIdentity(sourcePath);
  const destinationIdentity = authorityFileIdentity(destinationPath);
  const sourceParentIdentity = authorityParentIdentity(sourceDirectory);
  const destinationParentIdentity = authorityParentIdentity(destinationDirectory);
  return {
    root,
    sourceDirectory,
    destinationDirectory,
    sourcePath,
    destinationPath,
    sourceBytes,
    destinationBytes,
    sourceIdentity,
    destinationIdentity,
    sourceParentIdentity,
    destinationParentIdentity,
    args: [
      "stage.json",
      "canonical.json",
      ...sourceIdentity,
      ...destinationIdentity,
      ...sourceParentIdentity,
      ...destinationParentIdentity,
    ],
  };
}

function authorityRetireFixture(t, label) {
  const root = mkdtempSync(path.join(os.tmpdir(), `freed-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const sourceDirectory = path.join(root, "authority");
  const quarantineDirectory = path.join(root, "quarantine");
  mkdirSync(sourceDirectory, { mode: 0o700 });
  mkdirSync(quarantineDirectory, { mode: 0o700 });
  const sourcePath = path.join(sourceDirectory, "predecessor.json");
  const quarantinePath = path.join(quarantineDirectory, "retired.json");
  const sourceBytes = Buffer.from(`${label} retired authority\n`);
  writeFileSync(sourcePath, sourceBytes, { mode: 0o600 });
  const sourceIdentity = authorityFileIdentity(sourcePath);
  const sourceParentIdentity = authorityParentIdentity(sourceDirectory);
  const quarantineParentIdentity = authorityParentIdentity(quarantineDirectory);
  return {
    root,
    sourceDirectory,
    quarantineDirectory,
    sourcePath,
    quarantinePath,
    sourceBytes,
    sourceIdentity,
    sourceParentIdentity,
    quarantineParentIdentity,
    args: [
      "predecessor.json",
      "retired.json",
      ...sourceIdentity,
      ...sourceParentIdentity,
      ...quarantineParentIdentity,
    ],
  };
}

function assertAuthorityIdentityReceipt(receipt, prefix, identity) {
  const fields = [
    "Device",
    "Inode",
    "Mode",
    "LinkCount",
    "Uid",
    "Gid",
    "Size",
    "MtimeNs",
    "CtimeNs",
    "Digest",
  ];
  for (let index = 0; index < fields.length; index += 1) {
    assert.equal(receipt[`${prefix}${fields[index]}`], identity[index]);
  }
}

function assertAuthorityParentReceipt(receipt, prefix, identity) {
  const fields = ["Device", "Inode", "Mode", "Uid"];
  for (let index = 0; index < fields.length; index += 1) {
    assert.equal(receipt[`${prefix}${fields[index]}`], identity[index]);
  }
}

const authorityInventoryLimits = {
  maxEntries: 100_000,
  maxEncodedOutputBytes: 128 * 1024 * 1024,
  maxFileBytes: 128 * 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024 * 1024,
};

function authorityRetirementInventoryArgs(directoryPath, overrides = {}) {
  const limits = { ...authorityInventoryLimits, ...overrides };
  return [
    limits.maxEntries,
    limits.maxEncodedOutputBytes,
    limits.maxFileBytes,
    limits.maxTotalBytes,
    ...authorityParentIdentity(directoryPath),
  ];
}

function authorityEntryInventoryArgs(
  directoryPath,
  name,
  {
    allowedModes = "384,416,420",
    allowMissing = false,
    allowEmpty = false,
    maxFileBytes = authorityInventoryLimits.maxFileBytes,
  } = {},
) {
  return [
    name,
    allowedModes,
    allowMissing ? 1 : 0,
    allowEmpty ? 1 : 0,
    maxFileBytes,
    ...authorityParentIdentity(directoryPath),
  ];
}

function assertAuthorityInventoryEntry(receipt, filePath) {
  const identity = authorityFileIdentity(filePath);
  const fields = [
    "device",
    "inode",
    "mode",
    "linkCount",
    "uid",
    "gid",
    "size",
    "mtimeNs",
    "ctimeNs",
  ];
  for (let index = 0; index < fields.length; index += 1) {
    assert.equal(receipt[fields[index]], identity[index]);
  }
}

test("lease archive helper source is pinned and contains every native mutation contract", () => {
  const source = readPinnedLeaseArchiveHelperSource();
  assert.equal(createHash("sha256").update(source).digest("hex"), helperDigest);
  assert.match(source, /renameatx_np/);
  assert.match(source, /RENAME_EXCL/);
  assert.match(source, /renameat2/);
  assert.match(source, /RENAME_NOREPLACE/);
  assert.match(source, /replace-durable/);
  assert.match(source, /remove-durable/);
  assert.match(source, /authority-stage-create/);
  assert.match(source, /authority-stage-rewrite/);
  assert.match(source, /authority-exchange/);
  assert.match(source, /authority-retire/);
  assert.match(source, /authority-entry-inventory/);
  assert.match(source, /authority-retirement-inventory/);
  assert.match(source, /snapshot-tree/);
  assert.match(source, /retire-directory-durable/);
  assert.match(source, /directory-child-proof/);
  assert.match(source, /private-file-batch-read/);
  assert.match(source, /private-lease-state-batch-read/);
  assert.match(source, /freed-authority-file-operation-v1/);
  assert.match(source, /renameat/);
  assert.match(source, /os\.unlink\(name, dir_fd=3\)/);
  assert.match(source, /directory fsync is unavailable/);
  assert.doesNotMatch(source, /subprocess|os\.system|shutil\.move/);
  const probe = runHelper("probe", []);
  assert.equal(probe.status, 0, String(probe.stderr));
  assert.match(String(probe.stdout), /^freed-lease-archive-move-v1:(darwin|linux)$/);
});

test("lease archive helper moves, reads, lists, syncs, and admits one local filesystem", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-lease-archive-helper-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const sourceDirectory = path.join(root, "source");
  const destinationDirectory = path.join(root, "destination");
  mkdirSync(sourceDirectory, { mode: 0o700 });
  mkdirSync(destinationDirectory, { mode: 0o700 });
  const sourcePath = path.join(sourceDirectory, "source.json");
  const destinationPath = path.join(destinationDirectory, "archive.json");
  const bytes = Buffer.from('{"held":true}\n');
  writeFileSync(sourcePath, bytes, { mode: 0o600 });
  const sourceFileGeneration = fileGeneration(sourcePath);
  const sourceDirectoryGeneration = directoryGeneration(sourceDirectory);
  const destinationDirectoryGeneration = directoryGeneration(destinationDirectory);

  withDescriptors(
    [sourceDirectory, destinationDirectory, sourcePath],
    ([sourceDirectoryFd, destinationDirectoryFd, sourceFd]) => {
      const rename = runHelper(
        "rename",
        [
          "source.json",
          "archive.json",
          ...sourceFileGeneration,
          ...contentIdentity(bytes),
          ...sourceDirectoryGeneration,
          ...destinationDirectoryGeneration,
        ],
        [sourceDirectoryFd, destinationDirectoryFd, sourceFd],
      );
      assert.equal(rename.status, 0, String(rename.stderr));
      const destinationSync = runHelper(
        "sync",
        destinationDirectoryGeneration,
        [destinationDirectoryFd],
      );
      assert.equal(destinationSync.status, 0, String(destinationSync.stderr));
      const sourceSync = runHelper(
        "sync",
        sourceDirectoryGeneration,
        [sourceDirectoryFd],
      );
      assert.equal(sourceSync.status, 0, String(sourceSync.stderr));
      const read = runHelper(
        "read",
        [
          "archive.json",
          ...destinationDirectoryGeneration,
          ...sourceFileGeneration,
        ],
        [destinationDirectoryFd],
      );
      assert.equal(read.status, 0, String(read.stderr));
      assert.deepEqual(read.stdout, bytes);
      const list = runHelper(
        "list",
        destinationDirectoryGeneration,
        [destinationDirectoryFd],
      );
      assert.equal(list.status, 0, String(list.stderr));
      assert.equal(String(list.stdout), "archive.json");
      const missing = runHelper(
        "missing",
        ["source.json", ...sourceDirectoryGeneration],
        [sourceDirectoryFd],
      );
      assert.equal(missing.status, 0, String(missing.stderr));
      const filesystem = runHelper(
        "filesystem",
        destinationDirectoryGeneration,
        [destinationDirectoryFd],
      );
      assert.equal(filesystem.status, 0, String(filesystem.stderr));
      const capacity = JSON.parse(String(filesystem.stdout));
      assert.equal(capacity.protocol, "freed-lease-archive-move-v1");
      assert.equal(capacity.local, true);
      assert.equal(capacity.device, String(destinationDirectoryGeneration[0]));
      assert.ok(BigInt(capacity.availableBytes) > 0n);
    },
  );
  assert.equal(existsSync(sourcePath), false);
  assert.deepEqual(readFileSync(destinationPath), bytes);
});

test("bounded descriptor-relative list admits zero or one entry and rejects the second", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-bounded-list-"));
  const heldRoot = `${root}.held`;
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(heldRoot, { recursive: true, force: true });
  });
  chmodSync(root, 0o700);
  const generation = directoryGeneration(root);

  withDescriptors([root], ([rootDescriptor]) => {
    const empty = runHelper(
      "list-bounded",
      [1, 255, ...generation],
      [rootDescriptor],
    );
    assert.equal(empty.status, 0, String(empty.stderr));
    assert.deepEqual(empty.stdout, Buffer.alloc(0));

    writeFileSync(path.join(root, "first"), "", { mode: 0o600 });
    const one = runHelper(
      "list-bounded",
      [1, 255, ...generation],
      [rootDescriptor],
    );
    assert.equal(one.status, 0, String(one.stderr));
    assert.equal(String(one.stdout), "first");

    renameSync(root, heldRoot);
    mkdirSync(root, { mode: 0o700 });
    writeFileSync(path.join(root, "foreign"), "", { mode: 0o600 });
    const heldGeneration = runHelper(
      "list-bounded",
      [1, 255, ...generation],
      [rootDescriptor],
    );
    assert.equal(heldGeneration.status, 0, String(heldGeneration.stderr));
    assert.equal(String(heldGeneration.stdout), "first");

    writeFileSync(path.join(heldRoot, "second"), "", { mode: 0o600 });
    const overBoundary = runHelper(
      "list-bounded",
      [1, 255, ...generation],
      [rootDescriptor],
    );
    assert.notEqual(overBoundary.status, 0);
    assert.match(String(overBoundary.stderr), /directory listing exceeds the entry boundary/);
    assert.deepEqual(overBoundary.stdout, Buffer.alloc(0));

    const wrongGeneration = runHelper(
      "list-bounded",
      [1, 255, generation[0], generation[1] + 1],
      [rootDescriptor],
    );
    assert.notEqual(wrongGeneration.status, 0);
    assert.match(String(wrongGeneration.stderr), /descriptor changed generation/);
    assert.deepEqual(wrongGeneration.stdout, Buffer.alloc(0));
  });
});

test("authority retirement inventory returns one bounded descriptor-relative metadata snapshot", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-authority-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const files = [
    ["a.json", Buffer.from("alpha\n"), 0o600],
    ["b-é.json", Buffer.from("bravo\n"), 0o640],
    ["c.json", Buffer.alloc(0), 0o644],
  ];
  for (const [name, bytes, mode] of files) {
    const filePath = path.join(root, name);
    writeFileSync(filePath, bytes, { mode });
    chmodSync(filePath, mode);
  }
  const parentIdentity = authorityParentIdentity(root);
  withDescriptors([root], ([rootDescriptor]) => {
    const inventory = runAuthorityHelper(
      "authority-retirement-inventory",
      authorityRetirementInventoryArgs(root),
      [rootDescriptor],
      Buffer.alloc(0),
    );
    assert.equal(inventory.status, 0, String(inventory.stderr));
    const receipt = JSON.parse(String(inventory.stdout));
    assert.deepEqual(Object.keys(receipt).sort(), [
      "encodedOutputBytes",
      "entries",
      "entryCount",
      "operation",
      "parentCtimeNs",
      "parentDevice",
      "parentGid",
      "parentInode",
      "parentLinkCount",
      "parentMode",
      "parentMtimeNs",
      "parentSize",
      "parentUid",
      "protocol",
      "requestedMaxEncodedOutputBytes",
      "requestedMaxEntries",
      "requestedMaxFileBytes",
      "requestedMaxTotalBytes",
      "totalBytes",
    ].sort());
    assert.equal(receipt.protocol, "freed-authority-file-operation-v1");
    assert.equal(receipt.operation, "authority-retirement-inventory");
    assert.equal(receipt.encodedOutputBytes, String(inventory.stdout.length));
    assert.equal(receipt.entryCount, String(files.length));
    assert.equal(
      receipt.totalBytes,
      String(files.reduce((total, [, bytes]) => total + bytes.length, 0)),
    );
    assertAuthorityParentReceipt(receipt, "parent", parentIdentity);
    assert.deepEqual(
      receipt.entries.map((entry) => entry.name),
      files.map(([name]) => name),
    );
    for (let index = 0; index < files.length; index += 1) {
      assert.deepEqual(Object.keys(receipt.entries[index]).sort(), [
        "ctimeNs",
        "device",
        "gid",
        "inode",
        "linkCount",
        "mode",
        "mtimeNs",
        "name",
        "size",
        "uid",
      ].sort());
      assertAuthorityInventoryEntry(
        receipt.entries[index],
        path.join(root, files[index][0]),
      );
    }
  });
});

test("authority entry inventory returns one exact digest bound to the held parent", async (t) => {
  for (const [mode, allowedModes] of [
    [0o600, "384"],
    [0o640, "384,416"],
    [0o644, "384,416,420"],
  ]) {
    await t.test(mode.toString(8), (subtest) => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), `freed-authority-entry-${mode.toString(8)}-`),
      );
      subtest.after(() => rmSync(root, { recursive: true, force: true }));
      chmodSync(root, 0o700);
      const entryPath = path.join(root, "entry.json");
      const bytes = Buffer.from(`authority ${mode.toString(8)}\n`);
      writeFileSync(entryPath, bytes, { mode });
      chmodSync(entryPath, mode);
      const parentIdentity = authorityParentIdentity(root);
      withDescriptors([root], ([rootDescriptor]) => {
        const inventory = runAuthorityHelper(
          "authority-entry-inventory",
          authorityEntryInventoryArgs(root, "entry.json", { allowedModes }),
          [rootDescriptor],
          Buffer.alloc(0),
        );
        assert.equal(inventory.status, 0, String(inventory.stderr));
        const receipt = JSON.parse(String(inventory.stdout));
        assert.deepEqual(Object.keys(receipt).sort(), [
          "entryCtimeNs",
          "entryDevice",
          "entryDigest",
          "entryGid",
          "entryInode",
          "entryLinkCount",
          "entryMode",
          "entryMtimeNs",
          "entrySize",
          "entryUid",
          "missing",
          "name",
          "operation",
          "parentCtimeNs",
          "parentDevice",
          "parentGid",
          "parentInode",
          "parentLinkCount",
          "parentMode",
          "parentMtimeNs",
          "parentSize",
          "parentUid",
          "protocol",
          "requestedAllowEmpty",
          "requestedAllowMissing",
          "requestedAllowedModes",
          "requestedMaxFileBytes",
        ].sort());
        assert.equal(receipt.protocol, "freed-authority-file-operation-v1");
        assert.equal(receipt.operation, "authority-entry-inventory");
        assert.equal(receipt.requestedAllowedModes, allowedModes);
        assert.equal(receipt.requestedAllowMissing, false);
        assert.equal(receipt.requestedAllowEmpty, false);
        assert.equal(receipt.missing, false);
        assertAuthorityParentReceipt(receipt, "parent", parentIdentity);
        assertAuthorityIdentityReceipt(
          receipt,
          "entry",
          authorityFileIdentity(entryPath),
        );
      });
    });
  }
});

test("authority entry inventory proves exact missing state only when explicitly allowed", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-entry-missing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const parentIdentity = authorityParentIdentity(root);
  await withDescriptorsAsync([root], async ([rootDescriptor]) => {
    const disallowed = runAuthorityHelper(
      "authority-entry-inventory",
      authorityEntryInventoryArgs(root, "missing.json"),
      [rootDescriptor],
      Buffer.alloc(0),
    );
    assert.notEqual(disallowed.status, 0);
    assert.match(String(disallowed.stderr), /target is missing/);

    const allowed = runAuthorityHelper(
      "authority-entry-inventory",
      authorityEntryInventoryArgs(root, "missing.json", { allowMissing: true }),
      [rootDescriptor],
      Buffer.alloc(0),
    );
    assert.equal(allowed.status, 0, String(allowed.stderr));
    const receipt = JSON.parse(String(allowed.stdout));
    assert.deepEqual(Object.keys(receipt).sort(), [
      "missing",
      "name",
      "operation",
      "parentCtimeNs",
      "parentDevice",
      "parentGid",
      "parentInode",
      "parentLinkCount",
      "parentMode",
      "parentMtimeNs",
      "parentSize",
      "parentUid",
      "protocol",
      "requestedAllowEmpty",
      "requestedAllowMissing",
      "requestedAllowedModes",
      "requestedMaxFileBytes",
    ].sort());
    assert.equal(receipt.missing, true);
    assert.equal(receipt.requestedAllowMissing, true);
    assertAuthorityParentReceipt(receipt, "parent", parentIdentity);

    const paused = spawnPausedHelper({
      operation: "authority-entry-inventory",
      args: authorityEntryInventoryArgs(root, "appeared.json", {
        allowMissing: true,
      }),
      descriptors: [rootDescriptor],
      pause: "after-authority-entry-inventory-first-missing-proof",
      source: "appeared.json",
    });
    t.after(() => {
      if (paused.child.exitCode === null && paused.child.signalCode === null) {
        paused.child.kill();
      }
    });
    const resultPromise = waitForHelperExit(paused.child);
    await waitForHelperPause(
      paused.child,
      paused.signalFd,
      "after-authority-entry-inventory-first-missing-proof",
    );
    writeFileSync(path.join(root, "appeared.json"), "appeared", { mode: 0o600 });
    releasePausedHelper(paused.child, paused.releaseFd);
    const appeared = await resultPromise;
    assert.notEqual(appeared.code, 0);
    assert.match(String(appeared.stderr), /appeared during missing proof/);
    assert.equal(readFileSync(path.join(root, "appeared.json"), "utf8"), "appeared");
  });
});

test("authority entry inventory enforces mode, empty-file, and per-file policies", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-entry-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const entryPath = path.join(root, "entry.json");
  writeFileSync(entryPath, Buffer.alloc(0), { mode: 0o644 });
  chmodSync(entryPath, 0o644);
  withDescriptors([root], ([rootDescriptor]) => {
    const emptyRejected = runAuthorityHelper(
      "authority-entry-inventory",
      authorityEntryInventoryArgs(root, "entry.json", {
        allowedModes: "384,416,420",
        allowEmpty: false,
      }),
      [rootDescriptor],
      Buffer.alloc(0),
    );
    assert.notEqual(emptyRejected.status, 0);
    assert.match(String(emptyRejected.stderr), /is empty/);

    const emptyAllowed = runAuthorityHelper(
      "authority-entry-inventory",
      authorityEntryInventoryArgs(root, "entry.json", {
        allowedModes: "384,416,420",
        allowEmpty: true,
      }),
      [rootDescriptor],
      Buffer.alloc(0),
    );
    assert.equal(emptyAllowed.status, 0, String(emptyAllowed.stderr));

    const modeRejected = runAuthorityHelper(
      "authority-entry-inventory",
      authorityEntryInventoryArgs(root, "entry.json", {
        allowedModes: "384",
        allowEmpty: true,
      }),
      [rootDescriptor],
      Buffer.alloc(0),
    );
    assert.notEqual(modeRejected.status, 0);
    assert.match(String(modeRejected.stderr), /requested allowlist/);

    for (const invalidModes of ["416,384", "384,384", "384,999", ""] ) {
      const invalid = runAuthorityHelper(
        "authority-entry-inventory",
        authorityEntryInventoryArgs(root, "entry.json", {
          allowedModes: invalidModes,
          allowEmpty: true,
        }),
        [rootDescriptor],
        Buffer.alloc(0),
      );
      assert.notEqual(invalid.status, 0);
      assert.match(String(invalid.stderr), /allowed modes/);
    }

    writeFileSync(entryPath, "1234", { mode: 0o644 });
    const oversize = runAuthorityHelper(
      "authority-entry-inventory",
      authorityEntryInventoryArgs(root, "entry.json", {
        allowedModes: "384,416,420",
        maxFileBytes: 3,
      }),
      [rootDescriptor],
      Buffer.alloc(0),
    );
    assert.notEqual(oversize.status, 0);
    assert.match(String(oversize.stderr), /per-file boundary/);
  });
});

test("authority retirement inventory enforces every requested and compiled capacity bound", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-inventory-bounds-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  writeFileSync(path.join(root, "first.json"), "123", { mode: 0o600 });
  writeFileSync(path.join(root, "second.json"), "456", { mode: 0o600 });
  await withDescriptorsAsync([root], async ([rootDescriptor]) => {
    for (const [overrides, pattern] of [
      [{ maxEntries: 1 }, /entry boundary/],
      [{ maxEncodedOutputBytes: 64 }, /encoded output boundary/],
      [{ maxFileBytes: 2 }, /per-file boundary/],
      [{ maxTotalBytes: 5 }, /total byte boundary/],
      [{ maxEntries: 100_001 }, /entry limit exceeds/],
      [{ maxEncodedOutputBytes: 128 * 1024 * 1024 + 1 }, /encoded output limit exceeds/],
      [{ maxFileBytes: 128 * 1024 * 1024 + 1 }, /per-file byte limit exceeds/],
      [{ maxTotalBytes: 4 * 1024 * 1024 * 1024 + 1 }, /total byte limit exceeds/],
    ]) {
      const rejected = runAuthorityHelper(
        "authority-retirement-inventory",
        authorityRetirementInventoryArgs(root, overrides),
        [rootDescriptor],
        Buffer.alloc(0),
      );
      assert.notEqual(rejected.status, 0, JSON.stringify(overrides));
      assert.match(String(rejected.stderr), pattern);
    }
  });
});

test("authority inventories reject symlinks, FIFOs, directories, unsafe modes, and hard links", async (t) => {
  const cases = [
    {
      label: "symlink",
      install(root) {
        writeFileSync(path.join(root, "target.json"), "target", { mode: 0o600 });
        symlinkSync("target.json", path.join(root, "unsafe"));
      },
      pattern: /not a regular file/,
    },
    {
      label: "fifo",
      install(root) {
        const created = spawnSync("/usr/bin/mkfifo", [path.join(root, "unsafe")]);
        assert.equal(created.status, 0, String(created.stderr));
      },
      pattern: /not a regular file/,
    },
    {
      label: "directory",
      install(root) {
        mkdirSync(path.join(root, "unsafe"), { mode: 0o700 });
      },
      pattern: /not a regular file/,
    },
    {
      label: "mode",
      install(root) {
        writeFileSync(path.join(root, "unsafe"), "unsafe", { mode: 0o666 });
        chmodSync(path.join(root, "unsafe"), 0o666);
      },
      pattern: /authority allowlist/,
    },
    {
      label: "hard-link",
      install(root) {
        const first = path.join(root, "unsafe");
        writeFileSync(first, "unsafe", { mode: 0o600 });
        linkSync(first, path.join(root, "second"));
      },
      pattern: /exactly one admitted link/,
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.label, (subtest) => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), `freed-inventory-${fixture.label}-`),
      );
      subtest.after(() => rmSync(root, { recursive: true, force: true }));
      chmodSync(root, 0o700);
      fixture.install(root);
      withDescriptors([root], ([rootDescriptor]) => {
        const rejected = runAuthorityHelper(
          "authority-retirement-inventory",
          authorityRetirementInventoryArgs(root),
          [rootDescriptor],
          Buffer.alloc(0),
        );
        assert.notEqual(rejected.status, 0);
        assert.match(String(rejected.stderr), fixture.pattern);
      });
    });
  }
});

test("authority retirement inventory rejects invalid UTF-8 entry names", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-inventory-utf8-"));
  const invalidPath = Buffer.concat([
    Buffer.from(`${root}${path.sep}`),
    Buffer.from([0xff, 0xfe]),
  ]);
  t.after(() => {
    rmSync(invalidPath, { force: true });
    rmSync(root, { recursive: true, force: true });
  });
  chmodSync(root, 0o700);
  let installed = false;
  try {
    writeFileSync(invalidPath, "invalid", { mode: 0o600 });
    installed = true;
  } catch (error) {
    assert.equal(error.code, "EILSEQ");
  }
  if (installed) {
    withDescriptors([root], ([rootDescriptor]) => {
      const rejected = runAuthorityHelper(
        "authority-retirement-inventory",
        authorityRetirementInventoryArgs(root),
        [rootDescriptor],
        Buffer.alloc(0),
      );
      assert.notEqual(rejected.status, 0);
      assert.match(String(rejected.stderr), /not valid UTF-8/);
    });
    return;
  }
  const rejected = spawnSync(
    pythonPath,
    [
      "-E",
      "-I",
      "-S",
      "-c",
      [
        "import sys",
        "source = sys.stdin.read()",
        "scope = {'__name__': 'authority_inventory_probe'}",
        "exec(compile(source, '<helper>', 'exec'), scope)",
        "scope['authority_inventory_name'](chr(0xdcff))",
      ].join("\n"),
    ],
    {
      env: { HOME: os.homedir(), LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      input: helperSource,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(String(rejected.stderr), /not valid UTF-8/);
});

test("authority inventories remain bound to fd3 across a parent path swap", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-inventory-parent-swap-"));
  const displacedRoot = `${root}.held`;
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(displacedRoot, { recursive: true, force: true });
  });
  chmodSync(root, 0o700);
  const heldBytes = Buffer.from("held authority\n");
  const foreignBytes = Buffer.from("foreign authority\n");
  writeFileSync(path.join(root, "held.json"), heldBytes, { mode: 0o600 });
  const bulkArgs = authorityRetirementInventoryArgs(root);
  const entryArgs = authorityEntryInventoryArgs(root, "held.json");
  const heldIdentity = authorityFileIdentity(path.join(root, "held.json"));
  const rootDescriptor = openSync(
    root,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    renameSync(root, displacedRoot);
    mkdirSync(root, { mode: 0o700 });
    writeFileSync(path.join(root, "foreign.json"), foreignBytes, { mode: 0o600 });

    const bulk = runAuthorityHelper(
      "authority-retirement-inventory",
      bulkArgs,
      [rootDescriptor],
      Buffer.alloc(0),
    );
    assert.equal(bulk.status, 0, String(bulk.stderr));
    const bulkReceipt = JSON.parse(String(bulk.stdout));
    assert.deepEqual(bulkReceipt.entries.map((entry) => entry.name), ["held.json"]);

    const targeted = runAuthorityHelper(
      "authority-entry-inventory",
      entryArgs,
      [rootDescriptor],
      Buffer.alloc(0),
    );
    assert.equal(targeted.status, 0, String(targeted.stderr));
    const targetedReceipt = JSON.parse(String(targeted.stdout));
    assert.equal(targetedReceipt.entryDigest, heldIdentity[9]);
    assert.equal(targetedReceipt.entryInode, heldIdentity[1]);
  } finally {
    closeSync(rootDescriptor);
  }
  assert.deepEqual(readFileSync(path.join(displacedRoot, "held.json")), heldBytes);
  assert.deepEqual(readFileSync(path.join(root, "foreign.json")), foreignBytes);
});

test("authority inventories reject entry swaps and same-inode changes during admission", async (t) => {
  await t.test("bulk entry swap", async (subtest) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "freed-inventory-entry-swap-"));
    subtest.after(() => rmSync(root, { recursive: true, force: true }));
    chmodSync(root, 0o700);
    const entryPath = path.join(root, "entry.json");
    const displacedPath = path.join(root, "entry.admitted");
    const admittedBytes = Buffer.from("admitted inventory generation\n");
    const foreignBytes = Buffer.from("foreign inventory generation\n");
    writeFileSync(entryPath, admittedBytes, { mode: 0o600 });
    await withDescriptorsAsync([root], async (descriptors) => {
      const paused = spawnPausedHelper({
        operation: "authority-retirement-inventory",
        args: authorityRetirementInventoryArgs(root),
        descriptors,
        pause: "after-authority-retirement-inventory-entry-metadata",
        source: "entry.json",
      });
      subtest.after(() => {
        if (paused.child.exitCode === null && paused.child.signalCode === null) {
          paused.child.kill();
        }
      });
      const resultPromise = waitForHelperExit(paused.child);
      await waitForHelperPause(
        paused.child,
        paused.signalFd,
        "after-authority-retirement-inventory-entry-metadata",
      );
      renameSync(entryPath, displacedPath);
      writeFileSync(entryPath, foreignBytes, { mode: 0o600 });
      releasePausedHelper(paused.child, paused.releaseFd);
      const result = await resultPromise;
      assert.notEqual(result.code, 0);
      assert.match(String(result.stderr), /changed during admission/);
    });
    assert.deepEqual(readFileSync(displacedPath), admittedBytes);
    assert.deepEqual(readFileSync(entryPath), foreignBytes);
  });

  await t.test("targeted entry swap", async (subtest) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "freed-entry-target-swap-"));
    subtest.after(() => rmSync(root, { recursive: true, force: true }));
    chmodSync(root, 0o700);
    const entryPath = path.join(root, "entry.json");
    const displacedPath = path.join(root, "entry.admitted");
    const admittedBytes = Buffer.from("admitted targeted generation\n");
    const foreignBytes = Buffer.from("foreign targeted generation\n");
    writeFileSync(entryPath, admittedBytes, { mode: 0o600 });
    await withDescriptorsAsync([root], async (descriptors) => {
      const paused = spawnPausedHelper({
        operation: "authority-entry-inventory",
        args: authorityEntryInventoryArgs(root, "entry.json"),
        descriptors,
        pause: "after-authority-entry-inventory-lstat-before-open",
        source: "entry.json",
      });
      subtest.after(() => {
        if (paused.child.exitCode === null && paused.child.signalCode === null) {
          paused.child.kill();
        }
      });
      const resultPromise = waitForHelperExit(paused.child);
      await waitForHelperPause(
        paused.child,
        paused.signalFd,
        "after-authority-entry-inventory-lstat-before-open",
      );
      renameSync(entryPath, displacedPath);
      writeFileSync(entryPath, foreignBytes, { mode: 0o600 });
      releasePausedHelper(paused.child, paused.releaseFd);
      const result = await resultPromise;
      assert.notEqual(result.code, 0);
      assert.match(String(result.stderr), /different generation/);
    });
    assert.deepEqual(readFileSync(displacedPath), admittedBytes);
    assert.deepEqual(readFileSync(entryPath), foreignBytes);
  });

  await t.test("targeted same-inode rewrite", async (subtest) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "freed-entry-target-rewrite-"));
    subtest.after(() => rmSync(root, { recursive: true, force: true }));
    chmodSync(root, 0o700);
    const entryPath = path.join(root, "entry.json");
    const admittedBytes = Buffer.from("admitted bytes\n");
    const changedBytes = Buffer.from("modified bytes\n");
    assert.equal(admittedBytes.length, changedBytes.length);
    writeFileSync(entryPath, admittedBytes, { mode: 0o600 });
    const inode = lstatSync(entryPath).ino;
    await withDescriptorsAsync([root], async (descriptors) => {
      const paused = spawnPausedHelper({
        operation: "authority-entry-inventory",
        args: authorityEntryInventoryArgs(root, "entry.json"),
        descriptors,
        pause: "after-authority-entry-inventory-hash-before-revalidation",
        source: "entry.json",
      });
      subtest.after(() => {
        if (paused.child.exitCode === null && paused.child.signalCode === null) {
          paused.child.kill();
        }
      });
      const resultPromise = waitForHelperExit(paused.child);
      await waitForHelperPause(
        paused.child,
        paused.signalFd,
        "after-authority-entry-inventory-hash-before-revalidation",
      );
      writeFileSync(entryPath, changedBytes);
      releasePausedHelper(paused.child, paused.releaseFd);
      const result = await resultPromise;
      assert.notEqual(result.code, 0);
      assert.match(String(result.stderr), /changed while hashing/);
    });
    assert.equal(lstatSync(entryPath).ino, inode);
    assert.deepEqual(readFileSync(entryPath), changedBytes);
  });
});

test("authority stage creation writes exact stdin bytes without replacing a named entry", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-authority-stage-create-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const stagePath = path.join(root, "operation.stage");
  const bytes = Buffer.from([0, 255, 10, 91, 123, 125, 93, 10]);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const parentIdentity = authorityParentIdentity(root);
  withDescriptors([root], ([rootDescriptor]) => {
    const created = runAuthorityHelper(
      "authority-stage-create",
      ["operation.stage", 0o600, bytes.length, digest, ...parentIdentity],
      [rootDescriptor],
      bytes,
    );
    assert.equal(created.status, 0, String(created.stderr));
    const receipt = JSON.parse(String(created.stdout));
    assert.equal(receipt.protocol, "freed-authority-file-operation-v1");
    assert.equal(receipt.operation, "authority-stage-create");
    assert.equal(receipt.name, "operation.stage");
    assert.equal(receipt.requestedMode, String(0o600));
    assert.equal(receipt.requestedSize, String(bytes.length));
    assert.equal(receipt.requestedDigest, digest);
    assertAuthorityParentReceipt(receipt, "parent", parentIdentity);
    assertAuthorityIdentityReceipt(
      receipt,
      "result",
      authorityFileIdentity(stagePath),
    );
  });
  assert.deepEqual(readFileSync(stagePath), bytes);
  assert.equal(lstatSync(stagePath).mode & 0o7777, 0o600);

  withDescriptors([root], ([rootDescriptor]) => {
    const collision = runAuthorityHelper(
      "authority-stage-create",
      ["operation.stage", 0o600, bytes.length, digest, ...parentIdentity],
      [rootDescriptor],
      bytes,
    );
    assert.equal(collision.status, 17);
    assert.match(String(collision.stderr), /already exists/);
  });
  assert.deepEqual(readFileSync(stagePath), bytes);
});

test("authority stage rewrite moves only to an absent name and rewrites the held inode", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-authority-stage-rewrite-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const oldPath = path.join(root, "partial.stage");
  const newPath = path.join(root, "complete.stage");
  const oldBytes = Buffer.from([0, 1, 2, 3, 4]);
  const newBytes = Buffer.from('{"complete":true}\n');
  writeFileSync(oldPath, oldBytes, { mode: 0o600 });
  const oldIdentity = authorityFileIdentity(oldPath);
  const parentIdentity = authorityParentIdentity(root);
  const newDigest = createHash("sha256").update(newBytes).digest("hex");
  const parentDescriptor = openSync(
    root,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  const heldDescriptor = openSync(oldPath, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const rewritten = runAuthorityHelper(
      "authority-stage-rewrite",
      [
        "partial.stage",
        "complete.stage",
        ...oldIdentity,
        0o600,
        newBytes.length,
        newDigest,
        ...parentIdentity,
      ],
      [parentDescriptor, heldDescriptor],
      newBytes,
    );
    assert.equal(rewritten.status, 0, String(rewritten.stderr));
    const receipt = JSON.parse(String(rewritten.stdout));
    assert.equal(receipt.protocol, "freed-authority-file-operation-v1");
    assert.equal(receipt.operation, "authority-stage-rewrite");
    assert.equal(receipt.oldName, "partial.stage");
    assert.equal(receipt.newName, "complete.stage");
    assertAuthorityIdentityReceipt(receipt, "old", oldIdentity);
    assertAuthorityParentReceipt(receipt, "parent", parentIdentity);
    assertAuthorityIdentityReceipt(
      receipt,
      "result",
      authorityFileIdentity(newPath),
    );
  } finally {
    closeSync(heldDescriptor);
    closeSync(parentDescriptor);
  }
  assert.equal(existsSync(oldPath), false);
  assert.deepEqual(readFileSync(newPath), newBytes);
  assert.equal(authorityFileIdentity(newPath)[1], oldIdentity[1]);
});

test("authority stage rewrite normalizes retained 0640 and 0644 predecessors to 0600", async (t) => {
  for (const oldMode of [0o640, 0o644]) {
    await t.test(oldMode.toString(8), (subtest) => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), `freed-authority-stage-mode-${oldMode.toString(8)}-`),
      );
      subtest.after(() => rmSync(root, { recursive: true, force: true }));
      chmodSync(root, 0o700);
      const oldPath = path.join(root, "retained-predecessor.stage");
      const newPath = path.join(root, "next-operation.stage");
      const oldBytes = Buffer.from(`legacy mode ${oldMode.toString(8)} predecessor\n`);
      const newBytes = Buffer.from('{"normalized":true}\n');
      writeFileSync(oldPath, oldBytes, { mode: oldMode });
      const oldIdentity = authorityFileIdentity(oldPath);
      const parentIdentity = authorityParentIdentity(root);
      const newDigest = createHash("sha256").update(newBytes).digest("hex");
      const parentDescriptor = openSync(
        root,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const heldDescriptor = openSync(
        oldPath,
        constants.O_RDWR | constants.O_NOFOLLOW,
      );
      try {
        const rewritten = runAuthorityHelper(
          "authority-stage-rewrite",
          [
            "retained-predecessor.stage",
            "next-operation.stage",
            ...oldIdentity,
            0o600,
            newBytes.length,
            newDigest,
            ...parentIdentity,
          ],
          [parentDescriptor, heldDescriptor],
          newBytes,
        );
        assert.equal(rewritten.status, 0, String(rewritten.stderr));
        const receipt = JSON.parse(String(rewritten.stdout));
        assert.equal(receipt.oldMode, String(oldMode));
        assert.equal(receipt.resultMode, String(0o600));
        assert.equal(receipt.oldInode, receipt.resultInode);
      } finally {
        closeSync(heldDescriptor);
        closeSync(parentDescriptor);
      }
      assert.equal(existsSync(oldPath), false);
      assert.deepEqual(readFileSync(newPath), newBytes);
      assert.equal(lstatSync(newPath).mode & 0o7777, 0o600);
      assert.equal(authorityFileIdentity(newPath)[1], oldIdentity[1]);
    });
  }
});

test("authority exchange atomically preserves and swaps both exact generations", (t) => {
  const fixture = authorityExchangeFixture(t, "authority-exchange-success");
  withDescriptors(
    [
      fixture.sourceDirectory,
      fixture.destinationDirectory,
      fixture.sourcePath,
      fixture.destinationPath,
    ],
    (descriptors) => {
      const exchanged = runAuthorityHelper(
        "authority-exchange",
        fixture.args,
        descriptors,
        Buffer.alloc(0),
      );
      assert.equal(exchanged.status, 0, String(exchanged.stderr));
      const receipt = JSON.parse(String(exchanged.stdout));
      assert.equal(receipt.protocol, "freed-authority-file-operation-v1");
      assert.equal(receipt.operation, "authority-exchange");
      assertAuthorityIdentityReceipt(
        receipt,
        "source",
        fixture.sourceIdentity,
      );
      assertAuthorityIdentityReceipt(
        receipt,
        "destination",
        fixture.destinationIdentity,
      );
      assertAuthorityIdentityReceipt(
        receipt,
        "sourceAfter",
        authorityFileIdentity(fixture.destinationPath),
      );
      assertAuthorityIdentityReceipt(
        receipt,
        "destinationAfter",
        authorityFileIdentity(fixture.sourcePath),
      );
      assertAuthorityParentReceipt(
        receipt,
        "sourceParent",
        fixture.sourceParentIdentity,
      );
      assertAuthorityParentReceipt(
        receipt,
        "destinationParent",
        fixture.destinationParentIdentity,
      );
    },
  );
  assert.deepEqual(readFileSync(fixture.sourcePath), fixture.destinationBytes);
  assert.deepEqual(readFileSync(fixture.destinationPath), fixture.sourceBytes);
});

test("authority retirement exclusively preserves the exact source in quarantine", (t) => {
  const fixture = authorityRetireFixture(t, "authority-retire-success");
  withDescriptors(
    [fixture.sourceDirectory, fixture.quarantineDirectory, fixture.sourcePath],
    (descriptors) => {
      const retired = runAuthorityHelper(
        "authority-retire",
        fixture.args,
        descriptors,
        Buffer.alloc(0),
      );
      assert.equal(retired.status, 0, String(retired.stderr));
      const receipt = JSON.parse(String(retired.stdout));
      assert.equal(receipt.protocol, "freed-authority-file-operation-v1");
      assert.equal(receipt.operation, "authority-retire");
      assertAuthorityIdentityReceipt(
        receipt,
        "source",
        fixture.sourceIdentity,
      );
      assertAuthorityIdentityReceipt(
        receipt,
        "sourceAfter",
        authorityFileIdentity(fixture.quarantinePath),
      );
      assertAuthorityParentReceipt(
        receipt,
        "sourceParent",
        fixture.sourceParentIdentity,
      );
      assertAuthorityParentReceipt(
        receipt,
        "quarantineParent",
        fixture.quarantineParentIdentity,
      );
    },
  );
  assert.equal(existsSync(fixture.sourcePath), false);
  assert.deepEqual(readFileSync(fixture.quarantinePath), fixture.sourceBytes);
});

test("authority exchange rejects every inexact admitted identity field before mutation", (t) => {
  const fixture = authorityExchangeFixture(t, "authority-exchange-identity");
  const digestPositions = new Set([11, 21]);
  withDescriptors(
    [
      fixture.sourceDirectory,
      fixture.destinationDirectory,
      fixture.sourcePath,
      fixture.destinationPath,
    ],
    (descriptors) => {
      for (let index = 2; index < fixture.args.length; index += 1) {
        const altered = [...fixture.args];
        altered[index] = digestPositions.has(index)
          ? "0".repeat(64)
          : (BigInt(altered[index]) + 1n).toString();
        const rejected = runAuthorityHelper(
          "authority-exchange",
          altered,
          descriptors,
          Buffer.alloc(0),
        );
        assert.notEqual(
          rejected.status,
          0,
          `identity argv index ${index} was not validated`,
        );
        assert.deepEqual(readFileSync(fixture.sourcePath), fixture.sourceBytes);
        assert.deepEqual(
          readFileSync(fixture.destinationPath),
          fixture.destinationBytes,
        );
      }
    },
  );
});

test("authority exchange preserves all generations across final-window entry swaps", async (t) => {
  for (const swappedSide of ["source", "destination"]) {
    await t.test(swappedSide, async (subtest) => {
      const fixture = authorityExchangeFixture(
        subtest,
        `authority-exchange-final-${swappedSide}`,
      );
      const swappedPath =
        swappedSide === "source" ? fixture.sourcePath : fixture.destinationPath;
      const displacedPath = `${swappedPath}.admitted`;
      const foreignBytes = Buffer.from(`${swappedSide} foreign authority\n`);
      await withDescriptorsAsync(
        [
          fixture.sourceDirectory,
          fixture.destinationDirectory,
          fixture.sourcePath,
          fixture.destinationPath,
        ],
        async (descriptors) => {
          const paused = spawnPausedHelper({
            operation: "authority-exchange",
            args: fixture.args,
            descriptors,
            pause:
              "after-authority-exchange-final-validation-before-syscall",
            source: "stage.json",
            destination: "canonical.json",
          });
          subtest.after(() => {
            if (paused.child.exitCode === null && paused.child.signalCode === null) {
              paused.child.kill();
            }
          });
          const resultPromise = waitForHelperExit(paused.child);
          await waitForHelperPause(
            paused.child,
            paused.signalFd,
            "after-authority-exchange-final-validation-before-syscall",
          );
          renameSync(swappedPath, displacedPath);
          writeFileSync(swappedPath, foreignBytes, { mode: 0o600 });
          releasePausedHelper(paused.child, paused.releaseFd);
          const result = await resultPromise;
          assert.notEqual(result.code, 0);
          assert.match(String(result.stderr), /generation|differs|lost|changed/);
        },
      );
      assert.deepEqual(
        readFileSync(displacedPath),
        swappedSide === "source"
          ? fixture.sourceBytes
          : fixture.destinationBytes,
      );
      if (swappedSide === "source") {
        assert.deepEqual(readFileSync(fixture.sourcePath), fixture.destinationBytes);
        assert.deepEqual(readFileSync(fixture.destinationPath), foreignBytes);
      } else {
        assert.deepEqual(readFileSync(fixture.sourcePath), foreignBytes);
        assert.deepEqual(readFileSync(fixture.destinationPath), fixture.sourceBytes);
      }
    });
  }
});

test("authority retirement preserves admitted and foreign generations in both final windows", async (t) => {
  await t.test("source generation swap", async (subtest) => {
    const fixture = authorityRetireFixture(
      subtest,
      "authority-retire-final-source",
    );
    const displacedPath = `${fixture.sourcePath}.admitted`;
    const foreignBytes = Buffer.from("foreign retirement source\n");
    await withDescriptorsAsync(
      [fixture.sourceDirectory, fixture.quarantineDirectory, fixture.sourcePath],
      async (descriptors) => {
        const paused = spawnPausedHelper({
          operation: "authority-retire",
          args: fixture.args,
          descriptors,
          pause: "after-authority-retire-final-validation-before-syscall",
          source: "predecessor.json",
          destination: "retired.json",
        });
        subtest.after(() => {
          if (paused.child.exitCode === null && paused.child.signalCode === null) {
            paused.child.kill();
          }
        });
        const resultPromise = waitForHelperExit(paused.child);
        await waitForHelperPause(
          paused.child,
          paused.signalFd,
          "after-authority-retire-final-validation-before-syscall",
        );
        renameSync(fixture.sourcePath, displacedPath);
        writeFileSync(fixture.sourcePath, foreignBytes, { mode: 0o600 });
        releasePausedHelper(paused.child, paused.releaseFd);
        const result = await resultPromise;
        assert.notEqual(result.code, 0);
        assert.match(String(result.stderr), /generation|lost|changed/);
      },
    );
    assert.deepEqual(readFileSync(displacedPath), fixture.sourceBytes);
    assert.equal(existsSync(fixture.sourcePath), false);
    assert.deepEqual(readFileSync(fixture.quarantinePath), foreignBytes);
  });

  await t.test("quarantine collision", async (subtest) => {
    const fixture = authorityRetireFixture(
      subtest,
      "authority-retire-final-destination",
    );
    const foreignBytes = Buffer.from("foreign quarantine generation\n");
    await withDescriptorsAsync(
      [fixture.sourceDirectory, fixture.quarantineDirectory, fixture.sourcePath],
      async (descriptors) => {
        const paused = spawnPausedHelper({
          operation: "authority-retire",
          args: fixture.args,
          descriptors,
          pause: "after-authority-retire-final-validation-before-syscall",
          source: "predecessor.json",
          destination: "retired.json",
        });
        subtest.after(() => {
          if (paused.child.exitCode === null && paused.child.signalCode === null) {
            paused.child.kill();
          }
        });
        const resultPromise = waitForHelperExit(paused.child);
        await waitForHelperPause(
          paused.child,
          paused.signalFd,
          "after-authority-retire-final-validation-before-syscall",
        );
        writeFileSync(fixture.quarantinePath, foreignBytes, { mode: 0o600 });
        releasePausedHelper(paused.child, paused.releaseFd);
        const result = await resultPromise;
        assert.equal(result.code, 17);
        assert.match(String(result.stderr), /already exists/);
      },
    );
    assert.deepEqual(readFileSync(fixture.sourcePath), fixture.sourceBytes);
    assert.deepEqual(readFileSync(fixture.quarantinePath), foreignBytes);
  });
});

test("authority stage creation preserves a final-window destination generation", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-stage-create-final-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const stagePath = path.join(root, "operation.stage");
  const intendedBytes = Buffer.from("intended authority stage\n");
  const foreignBytes = Buffer.from("foreign authority stage\n");
  const digest = createHash("sha256").update(intendedBytes).digest("hex");
  await withDescriptorsAsync([root], async (descriptors) => {
    const paused = spawnPausedHelper({
      operation: "authority-stage-create",
      args: [
        "operation.stage",
        0o600,
        intendedBytes.length,
        digest,
        ...authorityParentIdentity(root),
      ],
      descriptors,
      input: intendedBytes,
      pause: "after-authority-stage-create-final-validation-before-syscall",
      source: "operation.stage",
      destination: "operation.stage",
    });
    t.after(() => {
      if (paused.child.exitCode === null && paused.child.signalCode === null) {
        paused.child.kill();
      }
    });
    const resultPromise = waitForHelperExit(paused.child);
    await waitForHelperPause(
      paused.child,
      paused.signalFd,
      "after-authority-stage-create-final-validation-before-syscall",
    );
    writeFileSync(stagePath, foreignBytes, { mode: 0o600 });
    releasePausedHelper(paused.child, paused.releaseFd);
    const result = await resultPromise;
    assert.equal(result.code, 17);
    assert.match(String(result.stderr), /already exists/);
  });
  assert.deepEqual(readFileSync(stagePath), foreignBytes);
});

test("authority stage rewrite never overwrites final-window source or destination generations", async (t) => {
  for (const swappedSide of ["source", "destination"]) {
    await t.test(swappedSide, async (subtest) => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), `freed-stage-rewrite-final-${swappedSide}-`),
      );
      subtest.after(() => rmSync(root, { recursive: true, force: true }));
      chmodSync(root, 0o700);
      const oldPath = path.join(root, "old.stage");
      const newPath = path.join(root, "new.stage");
      const displacedPath = `${oldPath}.admitted`;
      const oldBytes = Buffer.from("admitted partial stage\n");
      const newBytes = Buffer.from("completed stage\n");
      const foreignBytes = Buffer.from(`foreign ${swappedSide} stage\n`);
      writeFileSync(oldPath, oldBytes, { mode: 0o600 });
      const oldIdentity = authorityFileIdentity(oldPath);
      const parentIdentity = authorityParentIdentity(root);
      const digest = createHash("sha256").update(newBytes).digest("hex");
      const parentDescriptor = openSync(
        root,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const heldDescriptor = openSync(oldPath, constants.O_RDWR | constants.O_NOFOLLOW);
      try {
        const paused = spawnPausedHelper({
          operation: "authority-stage-rewrite",
          args: [
            "old.stage",
            "new.stage",
            ...oldIdentity,
            0o600,
            newBytes.length,
            digest,
            ...parentIdentity,
          ],
          descriptors: [parentDescriptor, heldDescriptor],
          input: newBytes,
          pause:
            "after-authority-stage-rewrite-rename-final-validation-before-syscall",
          source: "old.stage",
          destination: "new.stage",
        });
        subtest.after(() => {
          if (paused.child.exitCode === null && paused.child.signalCode === null) {
            paused.child.kill();
          }
        });
        const resultPromise = waitForHelperExit(paused.child);
        await waitForHelperPause(
          paused.child,
          paused.signalFd,
          "after-authority-stage-rewrite-rename-final-validation-before-syscall",
        );
        if (swappedSide === "source") {
          renameSync(oldPath, displacedPath);
          writeFileSync(oldPath, foreignBytes, { mode: 0o600 });
        } else {
          writeFileSync(newPath, foreignBytes, { mode: 0o600 });
        }
        releasePausedHelper(paused.child, paused.releaseFd);
        const result = await resultPromise;
        assert.notEqual(result.code, 0);
        assert.match(String(result.stderr), /already exists|generation|lost|changed/);
      } finally {
        closeSync(heldDescriptor);
        closeSync(parentDescriptor);
      }
      if (swappedSide === "source") {
        assert.deepEqual(readFileSync(displacedPath), oldBytes);
        assert.equal(existsSync(oldPath), false);
        assert.deepEqual(readFileSync(newPath), foreignBytes);
      } else {
        assert.deepEqual(readFileSync(oldPath), oldBytes);
        assert.deepEqual(readFileSync(newPath), foreignBytes);
      }
    });
  }
});

test("a killed partial authority stage is exactly recoverable through same-name rewrite", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-stage-partial-recovery-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const stagePath = path.join(root, "recover.stage");
  const intendedBytes = Buffer.alloc(130 * 1024, 0x5a);
  const digest = createHash("sha256").update(intendedBytes).digest("hex");
  await withDescriptorsAsync([root], async (descriptors) => {
    const paused = spawnPausedHelper({
      operation: "authority-stage-create",
      args: [
        "recover.stage",
        0o600,
        intendedBytes.length,
        digest,
        ...authorityParentIdentity(root),
      ],
      descriptors,
      input: intendedBytes,
      pause: "after-authority-stage-partial-write",
      source: "recover.stage",
      destination: "recover.stage",
    });
    t.after(() => {
      if (paused.child.exitCode === null && paused.child.signalCode === null) {
        paused.child.kill();
      }
    });
    const resultPromise = waitForHelperExit(paused.child);
    await waitForHelperPause(
      paused.child,
      paused.signalFd,
      "after-authority-stage-partial-write",
    );
    assert.equal(paused.child.kill("SIGKILL"), true);
    const result = await resultPromise;
    assert.equal(result.code, null);
    assert.equal(result.signal, "SIGKILL");
  });
  assert.equal(readFileSync(stagePath).length, 64 * 1024);

  const partialIdentity = authorityFileIdentity(stagePath);
  const parentIdentity = authorityParentIdentity(root);
  const parentDescriptor = openSync(
    root,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  const heldDescriptor = openSync(stagePath, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const recovered = runAuthorityHelper(
      "authority-stage-rewrite",
      [
        "recover.stage",
        "recover.stage",
        ...partialIdentity,
        0o600,
        intendedBytes.length,
        digest,
        ...parentIdentity,
      ],
      [parentDescriptor, heldDescriptor],
      intendedBytes,
    );
    assert.equal(recovered.status, 0, String(recovered.stderr));
  } finally {
    closeSync(heldDescriptor);
    closeSync(parentDescriptor);
  }
  assert.deepEqual(readFileSync(stagePath), intendedBytes);
});

test("durable replacement binds both generations, parents, unlink identity, and receipt", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-replace-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const sourceDirectory = path.join(root, "source");
  const destinationDirectory = path.join(root, "destination");
  mkdirSync(sourceDirectory, { mode: 0o700 });
  mkdirSync(destinationDirectory, { mode: 0o700 });
  const sourcePath = path.join(sourceDirectory, "successor.json");
  const destinationPath = path.join(destinationDirectory, "current.json");
  const sourceBytes = Buffer.from('{"generation":"successor"}\n');
  const predecessorBytes = Buffer.from('{"generation":"predecessor"}\n');
  writeFileSync(sourcePath, sourceBytes, { mode: 0o600 });
  writeFileSync(destinationPath, predecessorBytes, { mode: 0o600 });
  const sourceIdentity = durableFileIdentity(sourcePath);
  const predecessorIdentity = durableFileIdentity(destinationPath);
  const sourceParent = directoryGeneration(sourceDirectory);
  const destinationParent = directoryGeneration(destinationDirectory);

  withDescriptors(
    [sourceDirectory, destinationDirectory, sourcePath, destinationPath],
    ([sourceParentFd, destinationParentFd, sourceFd, predecessorFd]) => {
      const result = runHelper(
        "replace-durable",
        [
          "successor.json",
          "current.json",
          ...sourceIdentity,
          ...predecessorIdentity,
          ...sourceParent,
          ...destinationParent,
        ],
        [sourceParentFd, destinationParentFd, sourceFd, predecessorFd],
      );
      assert.equal(result.status, 0, String(result.stderr));
      assert.deepEqual(JSON.parse(String(result.stdout)), {
        protocol: "freed-lease-archive-move-v1",
        sourceDevice: String(sourceIdentity[0]),
        sourceInode: String(sourceIdentity[1]),
        sourceMode: String(sourceIdentity[2]),
        sourceLinkCount: String(sourceIdentity[3]),
        sourceSize: String(sourceIdentity[4]),
        sourceDigest: sourceIdentity[5],
        predecessorDevice: String(predecessorIdentity[0]),
        predecessorInode: String(predecessorIdentity[1]),
        predecessorMode: String(predecessorIdentity[2]),
        predecessorLinkCountBefore: String(predecessorIdentity[3]),
        predecessorLinkCountAfter: String(predecessorIdentity[3] - 1),
        predecessorSize: String(predecessorIdentity[4]),
        predecessorDigest: predecessorIdentity[5],
        sourceParentDevice: String(sourceParent[0]),
        sourceParentInode: String(sourceParent[1]),
        destinationParentDevice: String(destinationParent[0]),
        destinationParentInode: String(destinationParent[1]),
      });
      assert.equal(fstatSync(sourceFd).nlink, sourceIdentity[3]);
      assert.equal(fstatSync(predecessorFd).nlink, predecessorIdentity[3] - 1);
      assert.deepEqual(readFileSync(sourceFd), sourceBytes);
      assert.deepEqual(readFileSync(predecessorFd), predecessorBytes);
    },
  );
  assert.equal(existsSync(sourcePath), false);
  assert.deepEqual(readFileSync(destinationPath), sourceBytes);
  assert.deepEqual(fileGeneration(destinationPath), sourceIdentity.slice(0, 2));
});

test("durable removal unlinks only the admitted name and returns its exact receipt", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-remove-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const entryPath = path.join(root, "retire.json");
  const retainedPath = path.join(root, "retained.json");
  const bytes = Buffer.from('{"retire":true}\n');
  writeFileSync(entryPath, bytes, { mode: 0o600 });
  linkSync(entryPath, retainedPath);
  const identity = durableFileIdentity(entryPath);
  const parent = directoryGeneration(root);
  assert.equal(identity[3], 2);

  withDescriptors([root, entryPath], ([parentFd, heldFd]) => {
    const result = runHelper(
      "remove-durable",
      ["retire.json", ...identity, ...parent],
      [parentFd, heldFd],
    );
    assert.equal(result.status, 0, String(result.stderr));
    assert.deepEqual(JSON.parse(String(result.stdout)), {
      protocol: "freed-lease-archive-move-v1",
      device: String(identity[0]),
      inode: String(identity[1]),
      mode: String(identity[2]),
      linkCountBefore: String(identity[3]),
      linkCountAfter: String(identity[3] - 1),
      size: String(identity[4]),
      digest: identity[5],
      parentDevice: String(parent[0]),
      parentInode: String(parent[1]),
    });
    assert.equal(fstatSync(heldFd).nlink, identity[3] - 1);
    assert.deepEqual(readFileSync(heldFd), bytes);
  });
  assert.equal(existsSync(entryPath), false);
  assert.deepEqual(readFileSync(retainedPath), bytes);
  assert.equal(lstatSync(retainedPath).nlink, 1);
});

test("lease archive helper preserves sources across collision, symlink, and inode replacement", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-lease-archive-race-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const sourceDirectory = path.join(root, "source");
  const destinationDirectory = path.join(root, "destination");
  mkdirSync(sourceDirectory, { mode: 0o700 });
  mkdirSync(destinationDirectory, { mode: 0o700 });
  const sourceDirectoryGeneration = directoryGeneration(sourceDirectory);
  const destinationDirectoryGeneration = directoryGeneration(destinationDirectory);

  for (const kind of ["collision", "symlink"]) {
    const sourcePath = path.join(sourceDirectory, `${kind}.json`);
    const destinationPath = path.join(destinationDirectory, `${kind}.json`);
    const sourceBytes = Buffer.from(`${kind}-source\n`);
    writeFileSync(sourcePath, sourceBytes, { mode: 0o600 });
    if (kind === "collision") {
      writeFileSync(destinationPath, `${kind}-destination\n`, { mode: 0o600 });
    } else {
      const directoryTarget = path.join(destinationDirectory, "directory-target");
      mkdirSync(directoryTarget, { mode: 0o700 });
      symlinkSync(directoryTarget, destinationPath);
    }
    const sourceGeneration = fileGeneration(sourcePath);
    withDescriptors(
      [sourceDirectory, destinationDirectory, sourcePath],
      ([sourceDirectoryFd, destinationDirectoryFd, sourceFd]) => {
        const result = runHelper(
          "rename",
          [
            `${kind}.json`,
            `${kind}.json`,
            ...sourceGeneration,
            ...contentIdentity(sourceBytes),
            ...sourceDirectoryGeneration,
            ...destinationDirectoryGeneration,
          ],
          [sourceDirectoryFd, destinationDirectoryFd, sourceFd],
        );
        assert.notEqual(result.status, 0);
        assert.match(String(result.stderr), /already exists/);
      },
    );
    assert.deepEqual(readFileSync(sourcePath), sourceBytes);
  }

  const pinnedPath = path.join(sourceDirectory, "pinned.json");
  const displacedPath = path.join(sourceDirectory, "pinned-original.json");
  writeFileSync(pinnedPath, "original\n", { mode: 0o600 });
  const pinnedGeneration = fileGeneration(pinnedPath);
  withDescriptors(
    [sourceDirectory, destinationDirectory, pinnedPath],
    ([sourceDirectoryFd, destinationDirectoryFd, sourceFd]) => {
      renameSync(pinnedPath, displacedPath);
      writeFileSync(pinnedPath, "replacement\n", { mode: 0o600 });
      const result = runHelper(
        "rename",
        [
          "pinned.json",
          "pinned-archive.json",
          ...pinnedGeneration,
          ...contentIdentity(Buffer.from("original\n")),
          ...sourceDirectoryGeneration,
          ...destinationDirectoryGeneration,
        ],
        [sourceDirectoryFd, destinationDirectoryFd, sourceFd],
      );
      assert.notEqual(result.status, 0);
      assert.match(String(result.stderr), /changed inode generation/);
    },
  );
  assert.equal(readFileSync(pinnedPath, "utf8"), "replacement\n");
  assert.equal(readFileSync(displacedPath, "utf8"), "original\n");
});

test("durable replacement rejects final-window source and destination generation swaps", async (t) => {
  for (const swappedSide of ["source", "destination"]) {
    await t.test(swappedSide, async (subtest) => {
      const fixture = replacementFixture(
        subtest,
        `helper-replace-${swappedSide}-swap`,
      );
      const swappedPath =
        swappedSide === "source"
          ? fixture.sourcePath
          : fixture.destinationPath;
      const originalBytes =
        swappedSide === "source"
          ? fixture.sourceBytes
          : fixture.predecessorBytes;
      const replacementBytes = Buffer.from(`${swappedSide} foreign generation\n`);
      const displacedPath = `${swappedPath}.admitted`;
      await withDescriptorsAsync(
        [
          fixture.sourceDirectory,
          fixture.destinationDirectory,
          fixture.sourcePath,
          fixture.destinationPath,
        ],
        async (descriptors) => {
          const paused = spawnPausedHelper({
            operation: "replace-durable",
            args: fixture.args,
            descriptors,
            pause: "before-replace-syscall",
            source: "successor.json",
            destination: "current.json",
          });
          subtest.after(() => {
            if (paused.child.exitCode === null && paused.child.signalCode === null) {
              paused.child.kill();
            }
          });
          const resultPromise = waitForHelperExit(paused.child);
          await waitForHelperPause(
            paused.child,
            paused.signalFd,
            "before-replace-syscall",
          );
          renameSync(swappedPath, displacedPath);
          writeFileSync(swappedPath, replacementBytes, { mode: 0o600 });
          releasePausedHelper(paused.child, paused.releaseFd);
          const result = await resultPromise;
          assert.notEqual(result.code, 0);
          assert.match(String(result.stderr), /changed|generation/);
        },
      );
      assert.deepEqual(readFileSync(displacedPath), originalBytes);
      assert.deepEqual(readFileSync(swappedPath), replacementBytes);
      if (swappedSide === "source") {
        assert.deepEqual(
          readFileSync(fixture.destinationPath),
          fixture.predecessorBytes,
        );
      } else {
        assert.deepEqual(readFileSync(fixture.sourcePath), fixture.sourceBytes);
      }
    });
  }
});

test("durable replacement rejects swapped held parents without touching substitutes", async (t) => {
  for (const swappedSide of ["source", "destination"]) {
    await t.test(swappedSide, async (subtest) => {
      const fixture = replacementFixture(
        subtest,
        `helper-replace-${swappedSide}-parent`,
      );
      await withDescriptorsAsync(
        [
          fixture.sourceDirectory,
          fixture.destinationDirectory,
          fixture.sourcePath,
          fixture.destinationPath,
        ],
        async (descriptors) => {
          const paused = spawnPausedHelper({
            operation: "replace-durable",
            args: fixture.args,
            descriptors,
            pause: "before-replace-syscall",
            source: "successor.json",
            destination: "current.json",
          });
          subtest.after(() => {
            if (paused.child.exitCode === null && paused.child.signalCode === null) {
              paused.child.kill();
            }
          });
          const resultPromise = waitForHelperExit(paused.child);
          await waitForHelperPause(
            paused.child,
            paused.signalFd,
            "before-replace-syscall",
          );
          const selectedDirectory =
            swappedSide === "source"
              ? fixture.sourceDirectory
              : fixture.destinationDirectory;
          const displacedDirectory = `${selectedDirectory}.admitted`;
          const substituteDirectory = path.join(
            fixture.root,
            `${swappedSide}-substitute`,
          );
          renameSync(selectedDirectory, displacedDirectory);
          mkdirSync(substituteDirectory, { mode: 0o700 });
          symlinkSync(substituteDirectory, selectedDirectory);
          writeFileSync(path.join(displacedDirectory, "parent-swap-marker"), "x", {
            mode: 0o600,
          });
          releasePausedHelper(paused.child, paused.releaseFd);
          const result = await resultPromise;
          assert.notEqual(result.code, 0);
          assert.match(String(result.stderr), /changed during admission/);
          assert.equal(
            existsSync(path.join(substituteDirectory, "successor.json")),
            false,
          );
          assert.equal(
            existsSync(path.join(substituteDirectory, "current.json")),
            false,
          );
          const admittedSource =
            swappedSide === "source"
              ? path.join(displacedDirectory, "successor.json")
              : fixture.sourcePath;
          const admittedDestination =
            swappedSide === "destination"
              ? path.join(displacedDirectory, "current.json")
              : fixture.destinationPath;
          assert.deepEqual(readFileSync(admittedSource), fixture.sourceBytes);
          assert.deepEqual(
            readFileSync(admittedDestination),
            fixture.predecessorBytes,
          );
        },
      );
    });
  }
});

test("durable removal rejects final-window entry and parent swaps", async (t) => {
  await t.test("entry generation", async (subtest) => {
    const fixture = removalFixture(subtest, "helper-remove-entry-swap");
    const displacedPath = `${fixture.entryPath}.admitted`;
    const replacementBytes = Buffer.from("foreign removal generation\n");
    await withDescriptorsAsync(
      [fixture.root, fixture.entryPath],
      async (descriptors) => {
        const paused = spawnPausedHelper({
          operation: "remove-durable",
          args: fixture.args,
          descriptors,
          pause: "before-remove-syscall",
          source: "retire.json",
        });
        subtest.after(() => {
          if (paused.child.exitCode === null && paused.child.signalCode === null) {
            paused.child.kill();
          }
        });
        const resultPromise = waitForHelperExit(paused.child);
        await waitForHelperPause(
          paused.child,
          paused.signalFd,
          "before-remove-syscall",
        );
        renameSync(fixture.entryPath, displacedPath);
        writeFileSync(fixture.entryPath, replacementBytes, { mode: 0o600 });
        releasePausedHelper(paused.child, paused.releaseFd);
        const result = await resultPromise;
        assert.notEqual(result.code, 0);
        assert.match(String(result.stderr), /changed|generation/);
      },
    );
    assert.deepEqual(readFileSync(displacedPath), fixture.bytes);
    assert.deepEqual(readFileSync(fixture.entryPath), replacementBytes);
  });

  await t.test("parent generation", async (subtest) => {
    const fixture = removalFixture(subtest, "helper-remove-parent-swap");
    await withDescriptorsAsync(
      [fixture.root, fixture.entryPath],
      async (descriptors) => {
        const paused = spawnPausedHelper({
          operation: "remove-durable",
          args: fixture.args,
          descriptors,
          pause: "before-remove-syscall",
          source: "retire.json",
        });
        subtest.after(() => {
          if (paused.child.exitCode === null && paused.child.signalCode === null) {
            paused.child.kill();
          }
        });
        const resultPromise = waitForHelperExit(paused.child);
        await waitForHelperPause(
          paused.child,
          paused.signalFd,
          "before-remove-syscall",
        );
        const displacedRoot = `${fixture.root}.admitted`;
        const substituteRoot = `${fixture.root}.substitute`;
        subtest.after(() => {
          rmSync(displacedRoot, { recursive: true, force: true });
          rmSync(substituteRoot, { recursive: true, force: true });
        });
        renameSync(fixture.root, displacedRoot);
        mkdirSync(substituteRoot, { mode: 0o700 });
        symlinkSync(substituteRoot, fixture.root);
        writeFileSync(path.join(displacedRoot, "parent-swap-marker"), "x", {
          mode: 0o600,
        });
        releasePausedHelper(paused.child, paused.releaseFd);
        const result = await resultPromise;
        assert.notEqual(result.code, 0);
        assert.match(String(result.stderr), /changed during admission/);
        assert.equal(existsSync(path.join(substituteRoot, "retire.json")), false);
        assert.deepEqual(
          readFileSync(path.join(displacedRoot, "retire.json")),
          fixture.bytes,
        );
      },
    );
  });
});

test("durable replacement has one deterministic topology at every failure checkpoint", async (t) => {
  const checkpoints = [
    ["before-replace-syscall", false],
    ["after-replace-before-destination-sync", true],
    ["after-replace-destination-sync", true],
    ["after-replace-source-sync", true],
    ["after-replace-postcheck", true],
  ];
  for (const [checkpoint, replaced] of checkpoints) {
    await t.test(checkpoint, async (subtest) => {
      const fixture = replacementFixture(
        subtest,
        `helper-replace-crash-${checkpoint}`,
      );
      await withDescriptorsAsync(
        [
          fixture.sourceDirectory,
          fixture.destinationDirectory,
          fixture.sourcePath,
          fixture.destinationPath,
        ],
        async (descriptors) => {
          const paused = spawnPausedHelper({
            operation: "replace-durable",
            args: fixture.args,
            descriptors,
            pause: checkpoint,
            source: "successor.json",
            destination: "current.json",
          });
          subtest.after(() => {
            if (paused.child.exitCode === null && paused.child.signalCode === null) {
              paused.child.kill();
            }
          });
          const resultPromise = waitForHelperExit(paused.child);
          await waitForHelperPause(paused.child, paused.signalFd, checkpoint);
          assert.equal(paused.child.kill("SIGKILL"), true);
          const result = await resultPromise;
          assert.equal(result.code, null);
          assert.equal(result.signal, "SIGKILL");
          assert.equal(result.stdout.length, 0);
          assert.equal(
            fstatSync(descriptors[2]).nlink,
            fixture.sourceIdentity[3],
          );
          assert.equal(
            fstatSync(descriptors[3]).nlink,
            fixture.predecessorIdentity[3] - Number(replaced),
          );
        },
      );
      assert.equal(existsSync(fixture.sourcePath), !replaced);
      assert.deepEqual(
        readFileSync(fixture.destinationPath),
        replaced ? fixture.sourceBytes : fixture.predecessorBytes,
      );
    });
  }
});

test("durable removal has one deterministic topology at every failure checkpoint", async (t) => {
  const checkpoints = [
    ["before-remove-syscall", false],
    ["after-remove-before-parent-sync", true],
    ["after-remove-parent-sync", true],
    ["after-remove-postcheck", true],
  ];
  for (const [checkpoint, removed] of checkpoints) {
    await t.test(checkpoint, async (subtest) => {
      const fixture = removalFixture(
        subtest,
        `helper-remove-crash-${checkpoint}`,
      );
      await withDescriptorsAsync(
        [fixture.root, fixture.entryPath],
        async (descriptors) => {
          const paused = spawnPausedHelper({
            operation: "remove-durable",
            args: fixture.args,
            descriptors,
            pause: checkpoint,
            source: "retire.json",
          });
          subtest.after(() => {
            if (paused.child.exitCode === null && paused.child.signalCode === null) {
              paused.child.kill();
            }
          });
          const resultPromise = waitForHelperExit(paused.child);
          await waitForHelperPause(paused.child, paused.signalFd, checkpoint);
          assert.equal(paused.child.kill("SIGKILL"), true);
          const result = await resultPromise;
          assert.equal(result.code, null);
          assert.equal(result.signal, "SIGKILL");
          assert.equal(result.stdout.length, 0);
          assert.equal(
            fstatSync(descriptors[1]).nlink,
            fixture.identity[3] - Number(removed),
          );
          assert.deepEqual(readFileSync(descriptors[1]), fixture.bytes);
        },
      );
      assert.equal(existsSync(fixture.entryPath), !removed);
    });
  }
});

test("descriptor-relative read rejects a synchronized same-name destination replacement", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-lease-archive-read-race-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const directory = path.join(root, "archive");
  mkdirSync(directory, { mode: 0o700 });
  const archivePath = path.join(directory, "archive.json");
  const displacedPath = path.join(directory, "archive-original.json");
  writeFileSync(archivePath, "original\n", { mode: 0o600 });
  const directoryIdentity = directoryGeneration(directory);
  const archiveIdentity = fileGeneration(archivePath);
  withDescriptors([directory], ([directoryFd]) => {
    renameSync(archivePath, displacedPath);
    writeFileSync(archivePath, "replacement\n", { mode: 0o600 });
    const result = runHelper(
      "read",
      ["archive.json", ...directoryIdentity, ...archiveIdentity],
      [directoryFd],
    );
    assert.notEqual(result.status, 0);
    assert.match(String(result.stderr), /changed inode generation/);
  });
  assert.equal(readFileSync(archivePath, "utf8"), "replacement\n");
  assert.equal(readFileSync(displacedPath, "utf8"), "original\n");
});

test("Python runtime resolution admits a trusted fixed symlink and rejects escaped or unsafe chains", (t) => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-python-runtime-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const bin = path.join(root, "bin");
  mkdirSync(bin, { mode: 0o755 });
  const runtime = path.join(bin, "python3-real");
  const entry = path.join(bin, "python3");
  writeFileSync(runtime, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  symlinkSync("python3-real", entry);
  const options = {
    requiredUid: process.getuid(),
    trustedRoot: root,
  };
  assert.equal(resolveLeaseArchivePythonRuntime(entry, options), runtime);

  chmodSync(runtime, 0o775);
  assert.throws(
    () => resolveLeaseArchivePythonRuntime(entry, options),
    /immutable executable regular file/,
  );
  chmodSync(runtime, 0o755);
  chmodSync(runtime, 0o4755);
  assert.throws(
    () => resolveLeaseArchivePythonRuntime(entry, options),
    /immutable executable regular file/,
  );
  chmodSync(runtime, 0o755);
  chmodSync(bin, 0o777);
  assert.throws(
    () => resolveLeaseArchivePythonRuntime(entry, options),
    /untrusted directory/,
  );
  chmodSync(bin, 0o755);
  assert.throws(
    () =>
      resolveLeaseArchivePythonRuntime(entry, {
        ...options,
        lstat: (candidate) => {
          const stats = lstatSync(candidate);
          if (candidate !== runtime) return stats;
          return new Proxy(stats, {
            get(target, property) {
              if (property === "uid") return target.uid + 1;
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      }),
    /not root-owned/,
  );
  const directoryTarget = path.join(bin, "python-directory");
  mkdirSync(directoryTarget, { mode: 0o755 });
  renameSync(entry, path.join(bin, "regular-link"));
  symlinkSync("python-directory", entry);
  assert.throws(
    () => resolveLeaseArchivePythonRuntime(entry, options),
    /immutable executable regular file/,
  );
  renameSync(entry, path.join(bin, "directory-link"));
  symlinkSync("python3-real", entry);
  renameSync(entry, path.join(bin, "trusted-link"));
  symlinkSync("../../outside-python", entry);
  assert.throws(
    () => resolveLeaseArchivePythonRuntime(entry, options),
    /cyclic or escaped/,
  );
  renameSync(entry, path.join(bin, "escaped-link"));
  symlinkSync("cycle", entry);
  symlinkSync("python3", path.join(bin, "cycle"));
  assert.throws(
    () => resolveLeaseArchivePythonRuntime(entry, options),
    /cyclic or escaped/,
  );
});

test("descriptor-relative mkdir admits new and existing directories and rejects unsafe generations", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-mkdir-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  withDescriptors([root], ([rootDescriptor]) => {
    const generation = directoryGeneration(root);
    const created = runHelper(
      "mkdir",
      ["child", ...generation],
      [rootDescriptor],
    );
    assert.equal(created.status, 0, String(created.stderr));
    assert.equal(JSON.parse(String(created.stdout)).created, true);
    assert.equal(lstatSync(path.join(root, "child")).mode & 0o7777, 0o700);

    const existing = runHelper(
      "mkdir",
      ["child", ...generation],
      [rootDescriptor],
    );
    assert.equal(existing.status, 0, String(existing.stderr));
    assert.equal(JSON.parse(String(existing.stdout)).created, false);

    const wrongParent = runHelper(
      "mkdir",
      ["wrong-parent", generation[0], generation[1] + 1],
      [rootDescriptor],
    );
    assert.notEqual(wrongParent.status, 0);
    assert.equal(existsSync(path.join(root, "wrong-parent")), false);

    symlinkSync(path.join(root, "child"), path.join(root, "symlink-child"));
    const symlink = runHelper(
      "mkdir",
      ["symlink-child", ...generation],
      [rootDescriptor],
    );
    assert.notEqual(symlink.status, 0);
    assert.equal(lstatSync(path.join(root, "symlink-child")).isSymbolicLink(), true);
  });
});

test("held helper admission rejects a synchronized same-inode rewrite", (t) => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-helper-source-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const candidate = path.join(root, "lease-archive-move.py");
  writeFileSync(candidate, helperSource, { mode: 0o644 });
  const before = lstatSync(candidate);
  const altered = `${helperSource.slice(0, -1)}${helperSource.endsWith("\n") ? " " : "\n"}`;
  assert.equal(Buffer.byteLength(altered), Buffer.byteLength(helperSource));
  assert.throws(
    () =>
      readPinnedLeaseArchiveHelperSource(candidate, {
        expectedDigest: helperDigest,
        checkpoint: () => writeFileSync(candidate, altered),
      }),
    /changed during admission/,
  );
  const after = lstatSync(candidate);
  assert.equal(after.ino, before.ino);
  assert.equal(readFileSync(candidate, "utf8"), altered);
});

test("descriptor-relative list returns output beyond the former two-megabyte boundary", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-list-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const archive = path.join(root, "archive");
  mkdirSync(archive, { mode: 0o700 });
  const entryCount = 15_600;
  for (let index = 0; index < entryCount; index += 1) {
    const operationId = index.toString(16).padStart(64, "0");
    const digest = (entryCount - index).toString(16).padStart(64, "0");
    const descriptor = openSync(
      path.join(archive, `${operationId}.${digest}.json`),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    closeSync(descriptor);
  }
  withDescriptors([archive], ([archiveDescriptor]) => {
    const result = runHelper(
      "list",
      directoryGeneration(archive),
      [archiveDescriptor],
    );
    assert.equal(result.status, 0, String(result.stderr));
    assert.ok(result.stdout.length > 2 * 1024 * 1024);
    assert.equal(result.stdout.toString("utf8").split("\0").length, entryCount);
  });
});

test("descriptor-relative recursive snapshots reject a swapped named root instead of mixing generations", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-snapshot-root-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const source = path.join(root, "source");
  const displaced = path.join(root, "displaced");
  mkdirSync(source, { mode: 0o700 });
  writeFileSync(path.join(source, "original.json"), "original\n", { mode: 0o600 });
  await withDescriptorsAsync([root], async ([rootDescriptor]) => {
    const paused = spawnPausedHelper({
      operation: "snapshot-tree",
      args: cutoverSnapshotArgs(root, "source"),
      descriptors: [rootDescriptor],
      pause: "after-snapshot-tree-root-open-before-traversal",
      source: "source",
    });
    const resultPromise = waitForHelperExit(paused.child);
    await waitForHelperPause(
      paused.child,
      paused.signalFd,
      "after-snapshot-tree-root-open-before-traversal",
    );
    renameSync(source, displaced);
    mkdirSync(source, { mode: 0o700 });
    writeFileSync(path.join(source, "replacement.json"), "replacement\n", {
      mode: 0o600,
    });
    releasePausedHelper(paused.child, paused.releaseFd);
    const result = await resultPromise;
    assert.notEqual(result.code, 0);
    assert.match(String(result.stderr), /snapshot target changed/);
  });
  assert.equal(readFileSync(path.join(displaced, "original.json"), "utf8"), "original\n");
  assert.equal(readFileSync(path.join(source, "replacement.json"), "utf8"), "replacement\n");
});

test("recursive snapshots reject aggregate overflow before retaining file bytes", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-snapshot-budget-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const source = path.join(root, "source");
  mkdirSync(source, { mode: 0o700 });
  writeFileSync(path.join(source, "too-large.json"), "xx", { mode: 0o600 });
  withDescriptors([root], ([rootDescriptor]) => {
    const result = runHelper(
      "snapshot-tree",
      cutoverSnapshotArgs(root, "source", {
        includeBytes: true,
        maxAggregateBytes: 1,
      }),
      [rootDescriptor],
    );
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout.length, 0);
    assert.match(String(result.stderr), /aggregate byte boundary/);
  });
});

test("directory child proof binds one exact held 0700 child beneath its held parent", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-child-proof-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const child = path.join(root, "child");
  const displaced = path.join(root, "displaced");
  mkdirSync(child, { mode: 0o700 });
  const parentGeneration = directoryGeneration(root);
  const childGeneration = directoryGeneration(child);
  await withDescriptorsAsync([root, child], async (descriptors) => {
    const args = ["child", ...parentGeneration, ...childGeneration];
    const admitted = runHelper("directory-child-proof", args, descriptors);
    assert.equal(admitted.status, 0, String(admitted.stderr));
    const receipt = JSON.parse(String(admitted.stdout));
    assert.equal(receipt.operation, "directory-child-proof");
    assert.equal(receipt.parentDevice, String(parentGeneration[0]));
    assert.equal(receipt.parentInode, String(parentGeneration[1]));
    assert.equal(receipt.childDevice, String(childGeneration[0]));
    assert.equal(receipt.childInode, String(childGeneration[1]));

    const paused = spawnPausedHelper({
      operation: "directory-child-proof",
      args,
      descriptors,
      pause: "after-directory-child-proof-open-before-revalidation",
      source: "child",
    });
    const resultPromise = waitForHelperExit(paused.child);
    await waitForHelperPause(
      paused.child,
      paused.signalFd,
      "after-directory-child-proof-open-before-revalidation",
    );
    renameSync(child, displaced);
    mkdirSync(child, { mode: 0o700 });
    releasePausedHelper(paused.child, paused.releaseFd);
    const result = await resultPromise;
    assert.notEqual(result.code, 0);
    assert.match(String(result.stderr), /changed/);
  });

  chmodSync(child, 0o755);
  withDescriptors([root, child], (descriptors) => {
    const unsafe = runHelper(
      "directory-child-proof",
      ["child", ...directoryGeneration(root), ...directoryGeneration(child)],
      descriptors,
    );
    assert.notEqual(unsafe.status, 0);
    assert.match(String(unsafe.stderr), /exact private/);
  });
});

test("directory retirement binds recursive content before the exclusive rename", async (t) => {
  async function runScenario(name, mutate, { empty = false } = {}) {
    await t.test(name, async (subtest) => {
      const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-retire-tree-"));
      subtest.after(() => rmSync(root, { recursive: true, force: true }));
      chmodSync(root, 0o700);
      const sourceParent = path.join(root, "source-parent");
      const destinationParent = path.join(root, "destination-parent");
      const source = path.join(sourceParent, "source");
      const destination = path.join(destinationParent, "retired");
      mkdirSync(sourceParent, { mode: 0o700 });
      mkdirSync(destinationParent, { mode: 0o700 });
      mkdirSync(source, { mode: 0o700 });
      if (!empty) {
        writeFileSync(path.join(source, "payload.json"), "before\n", {
          mode: 0o600,
        });
      }
      const digest = snapshotTreeDigest(sourceParent, "source");
      await withDescriptorsAsync(
        [sourceParent, destinationParent, source],
        async (descriptors) => {
          const args = retireDirectoryArgs(source, destination, digest, {
            ...(empty
              ? {
                  maxFileBytes: 0,
                  maxEntries: 1,
                  maxDepth: 0,
                  maxAggregateBytes: 0,
                }
              : {}),
          });
          const paused = spawnPausedHelper({
            operation: "retire-directory-durable",
            args,
            descriptors,
            pause: "before-retire-directory-syscall",
            source: "source",
            destination: "retired",
          });
          const resultPromise = waitForHelperExit(paused.child);
          await waitForHelperPause(
            paused.child,
            paused.signalFd,
            "before-retire-directory-syscall",
          );
          mutate(source);
          releasePausedHelper(paused.child, paused.releaseFd);
          const result = await resultPromise;
          assert.notEqual(result.code, 0);
          assert.match(
            String(result.stderr),
            /tree digest changed|entry boundary|changed during admission/,
          );
        },
      );
      assert.equal(existsSync(source), true);
      assert.equal(existsSync(destination), false);
    });
  }

  await runScenario("same-size child rewrite", (source) => {
    writeFileSync(path.join(source, "payload.json"), "after!\n", { mode: 0o600 });
  });
  await runScenario(
    "late entry in an admitted empty directory",
    (source) => {
      writeFileSync(path.join(source, "late.json"), "late\n", { mode: 0o600 });
    },
    { empty: true },
  );
});

test("directory retirement publishes the exact recursively admitted tree", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-retire-success-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const sourceParent = path.join(root, "source-parent");
  const destinationParent = path.join(root, "destination-parent");
  const source = path.join(sourceParent, "source");
  const destination = path.join(destinationParent, "retired");
  mkdirSync(sourceParent, { mode: 0o700 });
  mkdirSync(destinationParent, { mode: 0o700 });
  mkdirSync(source, { mode: 0o700 });
  chmodSync(source, 0o755);
  mkdirSync(path.join(source, "nested"), { mode: 0o700 });
  writeFileSync(path.join(source, "nested", "payload.json"), "payload\n", {
    mode: 0o600,
  });
  const digest = snapshotTreeDigest(sourceParent, "source");
  withDescriptors(
    [sourceParent, destinationParent, source],
    (descriptors) => {
      const result = runHelper(
        "retire-directory-durable",
        retireDirectoryArgs(source, destination, digest),
        descriptors,
      );
      assert.equal(result.status, 0, String(result.stderr));
      const receipt = JSON.parse(String(result.stdout));
      assert.equal(receipt.treeDigest, digest);
    },
  );
  assert.equal(existsSync(source), false);
  assert.equal(readFileSync(path.join(destination, "nested", "payload.json"), "utf8"), "payload\n");
});

test("private file batch read inventories 1,300 files and returns one exact selected chunk", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-private-batch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const quarantine = path.join(root, ".lease-cleanup-quarantine");
  mkdirSync(quarantine, { mode: 0o700 });
  const names = [];
  let totalBytes = 0;
  for (let index = 0; index < 1_300; index += 1) {
    const name = `receipt-${index.toString().padStart(4, "0")}.json`;
    const bytes = Buffer.from(`${index.toString()}\n`, "utf8");
    names.push(name);
    totalBytes += bytes.length;
    writeFileSync(path.join(root, name), bytes, { mode: 0o600 });
  }
  withDescriptors([root], ([rootDescriptor]) => {
    const inventoryRequest = privateBatchRequest({
      expectedDirectoryNames: [".lease-cleanup-quarantine"],
    });
    const inventoryResult = runAuthorityHelper(
      "private-file-batch-read",
      privateBatchArgs(root),
      [rootDescriptor],
      inventoryRequest,
    );
    assert.equal(inventoryResult.status, 0, String(inventoryResult.stderr));
    const inventory = JSON.parse(String(inventoryResult.stdout));
    assertPrivateBatchParentReceipt(inventory, root);
    assert.equal(inventory.inventoryEntryCount, "1301");
    assert.equal(inventory.inventoryTotalFileBytes, String(totalBytes));
    assert.equal(inventory.inventoryEntries.length, 1_301);
    assert.equal(inventory.inventoryEntries[0].name, ".lease-cleanup-quarantine");
    assert.equal(inventory.inventoryEntries[0].kind, "directory");

    const request = privateBatchRequest({
      expectedDirectoryNames: [".lease-cleanup-quarantine"],
      expectedInventoryDigest: inventory.inventoryDigest,
      expectedNameCount: Number(inventory.inventoryEntryCount),
      expectedNamesDigest: inventory.inventoryNamesDigest,
      includeBytes: true,
      returnInventory: false,
      selectedFileNames: names,
    });
    const result = runAuthorityHelper(
      "private-file-batch-read",
      privateBatchArgs(root),
      [rootDescriptor],
      request,
    );
    assert.equal(result.status, 0, String(result.stderr));
    const receipt = JSON.parse(String(result.stdout));
    assert.equal(receipt.protocol, "freed-lease-archive-move-v1");
    assert.equal(receipt.operation, "private-file-batch-read");
    assert.equal(receipt.requestDigest, createHash("sha256").update(request).digest("hex"));
    assert.equal(receipt.inventoryDigest, inventory.inventoryDigest);
    assert.equal(receipt.selectedEntryCount, "1300");
    assert.equal(receipt.selectedTotalBytes, String(totalBytes));
    assert.equal(receipt.encodedOutputBytes, String(result.stdout.length));
    assert.deepEqual(receipt.inventoryEntries, []);
    assert.equal(receipt.selectedEntries.length, names.length);
    for (let index = 0; index < names.length; index += 1) {
      const entry = receipt.selectedEntries[index];
      const identity = authorityFileIdentity(path.join(root, names[index]));
      assert.equal(entry.name, names[index]);
      assert.equal(entry.kind, "file");
      assert.deepEqual(
        [
          entry.device,
          entry.inode,
          entry.mode,
          entry.linkCount,
          entry.uid,
          entry.gid,
          entry.size,
          entry.mtimeNs,
          entry.ctimeNs,
          entry.digest,
        ],
        identity,
      );
      assert.equal(
        entry.bytesBase64,
        readFileSync(path.join(root, names[index])).toString("base64"),
      );
    }
  });
});

test("private file batch read validates every selected and unselected sibling", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-private-batch-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const quarantine = path.join(root, ".lease-cleanup-quarantine");
  mkdirSync(quarantine, { mode: 0o700 });
  const first = path.join(root, "a.json");
  const second = path.join(root, "b.json");
  writeFileSync(first, "aa", { mode: 0o600 });
  writeFileSync(second, "bb", { mode: 0o600 });
  withDescriptors([root], ([rootDescriptor]) => {
    const inventoryRequest = () =>
      privateBatchRequest({
        expectedDirectoryNames: [".lease-cleanup-quarantine"],
      });
    const runInventory = (overrides = {}) =>
      runAuthorityHelper(
        "private-file-batch-read",
        privateBatchArgs(root, overrides),
        [rootDescriptor],
        inventoryRequest(),
      );
    const initialResult = runInventory();
    assert.equal(initialResult.status, 0, String(initialResult.stderr));
    const initial = JSON.parse(String(initialResult.stdout));
    const chunkRequest = (selectedFileNames, overrides = {}) =>
      privateBatchRequest({
        expectedDirectoryNames: [".lease-cleanup-quarantine"],
        expectedInventoryDigest:
          overrides.expectedInventoryDigest ?? initial.inventoryDigest,
        expectedNameCount:
          overrides.expectedNameCount ?? Number(initial.inventoryEntryCount),
        expectedNamesDigest:
          overrides.expectedNamesDigest ?? initial.inventoryNamesDigest,
        includeBytes: true,
        returnInventory: false,
        selectedFileNames,
      });

    const subset = runAuthorityHelper(
      "private-file-batch-read",
      privateBatchArgs(root),
      [rootDescriptor],
      chunkRequest(["a.json"]),
    );
    assert.equal(subset.status, 0, String(subset.stderr));
    assert.equal(JSON.parse(String(subset.stdout)).selectedEntryCount, "1");

    const wrongNameDigest = runAuthorityHelper(
      "private-file-batch-read",
      privateBatchArgs(root),
      [rootDescriptor],
      chunkRequest(["a.json"], { expectedNamesDigest: "0".repeat(64) }),
    );
    assert.notEqual(wrongNameDigest.status, 0);
    assert.match(String(wrongNameDigest.stderr), /full name digest changed/);

    const outOfOrder = runAuthorityHelper(
      "private-file-batch-read",
      privateBatchArgs(root),
      [rootDescriptor],
      chunkRequest(["b.json", "a.json"]),
    );
    assert.notEqual(outOfOrder.status, 0);
    assert.match(String(outOfOrder.stderr), /canonical byte order/);

    const aggregate = runAuthorityHelper(
      "private-file-batch-read",
      privateBatchArgs(root, { maxSelectedTotalBytes: 3 }),
      [rootDescriptor],
      chunkRequest(["a.json", "b.json"]),
    );
    assert.notEqual(aggregate.status, 0);
    assert.equal(aggregate.stdout.length, 0);
    assert.match(String(aggregate.stderr), /selected byte boundary/);

    chmodSync(second, 0o644);
    const unsafeMode = runInventory();
    assert.notEqual(unsafeMode.status, 0);
    assert.match(String(unsafeMode.stderr), /exact mode 0600/);
    chmodSync(second, 0o600);

    const alias = path.join(root, "c.json");
    linkSync(second, alias);
    const hardLink = runInventory();
    assert.notEqual(hardLink.status, 0);
    assert.match(String(hardLink.stderr), /exactly one link/);
    rmSync(alias);

    const symbolic = path.join(root, "c.json");
    symlinkSync(first, symbolic);
    const symlink = runInventory();
    assert.notEqual(symlink.status, 0);
    assert.match(String(symlink.stderr), /not a regular file/);
    rmSync(symbolic);

    const fifoPath = path.join(root, "c.json");
    const fifoCreated = spawnSync("/usr/bin/mkfifo", [fifoPath]);
    assert.equal(fifoCreated.status, 0, String(fifoCreated.stderr));
    const fifo = runInventory();
    assert.notEqual(fifo.status, 0);
    assert.match(String(fifo.stderr), /not a regular file/);
    rmSync(fifoPath);

    const unexpectedDirectory = path.join(root, "c.json");
    mkdirSync(unexpectedDirectory, { mode: 0o700 });
    const directory = runInventory();
    assert.notEqual(directory.status, 0);
    assert.match(String(directory.stderr), /unexpected directory/);
    rmSync(unexpectedDirectory, { recursive: true });

    const empty = path.join(root, "c.json");
    writeFileSync(empty, "", { mode: 0o600 });
    const zeroBytes = runInventory();
    assert.notEqual(zeroBytes.status, 0);
    assert.match(String(zeroBytes.stderr), /per-file byte boundary/);
    rmSync(empty);

    const oversized = path.join(root, "c.json");
    writeFileSync(oversized, "12345", { mode: 0o600 });
    const tooLarge = runInventory({ maxFileBytes: 4 });
    assert.notEqual(tooLarge.status, 0);
    assert.match(String(tooLarge.stderr), /per-file byte boundary/);
    rmSync(oversized);

    const inventoryOverflow = runInventory({ maxInventoryTotalBytes: 3 });
    assert.notEqual(inventoryOverflow.status, 0);
    assert.match(String(inventoryOverflow.stderr), /inventory.*total byte boundary/);

    chmodSync(quarantine, 0o755);
    const unsafeDirectoryMode = runInventory();
    assert.notEqual(unsafeDirectoryMode.status, 0);
    assert.match(String(unsafeDirectoryMode.stderr), /exact mode 0700/);
    chmodSync(quarantine, 0o700);

    writeFileSync(path.join(quarantine, "archived.json"), "archive\n", {
      mode: 0o600,
    });
    const populatedExpectedDirectory = runInventory();
    assert.equal(
      populatedExpectedDirectory.status,
      0,
      String(populatedExpectedDirectory.stderr),
    );
    rmSync(path.join(quarantine, "archived.json"));

    rmSync(quarantine, { recursive: true });
    const missingExpectedDirectory = runInventory();
    assert.notEqual(missingExpectedDirectory.status, 0);
    assert.match(String(missingExpectedDirectory.stderr), /directory set is incomplete/);
  });
});

test("private file batch read rejects a same-inode rewrite after aggregate admission", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-private-batch-race-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const filePath = path.join(root, "receipt.json");
  writeFileSync(filePath, "before\n", { mode: 0o600 });
  const inode = lstatSync(filePath).ino;
  await withDescriptorsAsync([root], async ([rootDescriptor]) => {
    const inventoryResult = runAuthorityHelper(
      "private-file-batch-read",
      privateBatchArgs(root),
      [rootDescriptor],
      privateBatchRequest(),
    );
    assert.equal(inventoryResult.status, 0, String(inventoryResult.stderr));
    const inventory = JSON.parse(String(inventoryResult.stdout));
    assertPrivateBatchParentReceipt(inventory, root);
    const paused = spawnPausedHelper({
      operation: "private-file-batch-read",
      args: privateBatchArgs(root),
      descriptors: [rootDescriptor],
      pause: "after-private-file-batch-open-before-read",
      source: "receipt.json",
      input: privateBatchRequest({
        expectedInventoryDigest: inventory.inventoryDigest,
        expectedNameCount: Number(inventory.inventoryEntryCount),
        expectedNamesDigest: inventory.inventoryNamesDigest,
        includeBytes: true,
        returnInventory: false,
        selectedFileNames: ["receipt.json"],
      }),
    });
    const resultPromise = waitForHelperExit(paused.child);
    await waitForHelperPause(
      paused.child,
      paused.signalFd,
      "after-private-file-batch-open-before-read",
    );
    writeFileSync(filePath, "after!\n", { mode: 0o600 });
    releasePausedHelper(paused.child, paused.releaseFd);
    const result = await resultPromise;
    assert.notEqual(result.code, 0);
    assert.match(String(result.stderr), /changed while being read|changed during admission/);
  });
  assert.equal(lstatSync(filePath).ino, inode);
  assert.equal(readFileSync(filePath, "utf8"), "after!\n");
});

test("private file batch read rejects an entry added after exact-set preflight", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-private-batch-set-race-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  writeFileSync(path.join(root, "receipt.json"), "receipt\n", { mode: 0o600 });
  await withDescriptorsAsync([root], async ([rootDescriptor]) => {
    const paused = spawnPausedHelper({
      operation: "private-file-batch-read",
      args: privateBatchArgs(root),
      descriptors: [rootDescriptor],
      pause: "after-private-file-batch-preflight",
      input: privateBatchRequest(),
    });
    const resultPromise = waitForHelperExit(paused.child);
    await waitForHelperPause(
      paused.child,
      paused.signalFd,
      "after-private-file-batch-preflight",
    );
    writeFileSync(path.join(root, "late.json"), "late\n", { mode: 0o600 });
    releasePausedHelper(paused.child, paused.releaseFd);
    const result = await resultPromise;
    assert.notEqual(result.code, 0);
    assert.match(
      String(result.stderr),
      /full inventory changed during admission|parent changed during admission/,
    );
  });
});

test("private file batch read binds transient parent mutations across launches", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-private-batch-parent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  writeFileSync(path.join(root, "receipt.json"), "receipt\n", { mode: 0o600 });
  withDescriptors([root], ([rootDescriptor]) => {
    const initialResult = runAuthorityHelper(
      "private-file-batch-read",
      privateBatchArgs(root),
      [rootDescriptor],
      privateBatchRequest(),
    );
    assert.equal(initialResult.status, 0, String(initialResult.stderr));
    const initial = JSON.parse(String(initialResult.stdout));
    writeFileSync(path.join(root, "transient.json"), "transient\n", { mode: 0o600 });
    rmSync(path.join(root, "transient.json"));
    const terminal = runAuthorityHelper(
      "private-file-batch-read",
      privateBatchArgs(root),
      [rootDescriptor],
      privateBatchRequest({
        expectedInventoryDigest: initial.inventoryDigest,
        expectedNameCount: Number(initial.inventoryEntryCount),
        expectedNamesDigest: initial.inventoryNamesDigest,
        returnInventory: false,
      }),
    );
    assert.notEqual(terminal.status, 0);
    assert.match(String(terminal.stderr), /full inventory identity changed/);
  });
});

test("private lease state batch inventories exact retired directories and selected bytes", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-lease-state-batch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const populatedName = `${"1".repeat(64)}.${"2".repeat(64)}.lease`;
  const emptyName = `${"3".repeat(64)}.${"4".repeat(64)}.lease`;
  const populated = path.join(root, populatedName);
  const empty = path.join(root, emptyName);
  mkdirSync(populated, { mode: 0o700 });
  mkdirSync(empty, { mode: 0o700 });
  const recordBytes = Buffer.from('{"lease":"retired"}\n', "utf8");
  writeFileSync(path.join(populated, "lease.json"), recordBytes, { mode: 0o600 });
  withDescriptors([root], ([rootDescriptor]) => {
    const inventoryRequest = privateLeaseStateRequest();
    const inventoryResult = runAuthorityHelper(
      "private-lease-state-batch-read",
      privateLeaseStateArgs(root),
      [rootDescriptor],
      inventoryRequest,
    );
    assert.equal(inventoryResult.status, 0, String(inventoryResult.stderr));
    const inventory = JSON.parse(String(inventoryResult.stdout));
    assert.equal(inventory.operation, "private-lease-state-batch-read");
    assertPrivateBatchParentReceipt(inventory, root);
    assert.equal(inventory.inventoryEntryCount, "2");
    assert.equal(inventory.inventoryTotalRecordBytes, String(recordBytes.length));
    assert.equal(inventory.inventoryEntries.length, 2);
    const populatedEntry = inventory.inventoryEntries.find(
      (entry) => entry.name === populatedName,
    );
    assert.equal(populatedEntry.kind, "lease-state-directory");
    assert.equal(
      populatedEntry.record.digest,
      createHash("sha256").update(recordBytes).digest("hex"),
    );
    assert.equal(
      inventory.inventoryEntries.find((entry) => entry.name === emptyName).record,
      null,
    );

    const chunkRequest = privateLeaseStateRequest({
      expectedInventoryDigest: inventory.inventoryDigest,
      expectedNameCount: Number(inventory.inventoryEntryCount),
      expectedNamesDigest: inventory.inventoryNamesDigest,
      includeBytes: true,
      returnInventory: false,
      selectedDirectoryNames: [populatedName, emptyName].sort(),
    });
    const chunkResult = runAuthorityHelper(
      "private-lease-state-batch-read",
      privateLeaseStateArgs(root),
      [rootDescriptor],
      chunkRequest,
    );
    assert.equal(chunkResult.status, 0, String(chunkResult.stderr));
    const chunk = JSON.parse(String(chunkResult.stdout));
    assert.equal(chunk.inventoryDigest, inventory.inventoryDigest);
    assert.equal(chunk.selectedEntryCount, "2");
    assert.deepEqual(chunk.inventoryEntries, []);
    assert.equal(
      chunk.selectedEntries.find((entry) => entry.name === populatedName).record
        .bytesBase64,
      recordBytes.toString("base64"),
    );
    assert.equal(
      chunk.selectedEntries.find((entry) => entry.name === emptyName).record,
      null,
    );
  });
});

test("private lease state batch rejects every unsafe full-set sibling", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-lease-state-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const name = `${"a".repeat(64)}.${"b".repeat(64)}.lease`;
  const child = path.join(root, name);
  const record = path.join(child, "lease.json");
  mkdirSync(child, { mode: 0o700 });
  writeFileSync(record, "record\n", { mode: 0o600 });
  const outsideAlias = `${root}-record-alias`;
  t.after(() => rmSync(outsideAlias, { force: true }));
  withDescriptors([root], ([rootDescriptor]) => {
    const runInventory = (overrides = {}) =>
      runAuthorityHelper(
        "private-lease-state-batch-read",
        privateLeaseStateArgs(root, overrides),
        [rootDescriptor],
        privateLeaseStateRequest(),
      );
    assert.equal(runInventory().status, 0);

    const invalidName = path.join(root, "invalid.lease");
    mkdirSync(invalidName, { mode: 0o700 });
    const invalid = runInventory();
    assert.notEqual(invalid.status, 0);
    assert.match(String(invalid.stderr), /canonical retired lease state name/);
    rmSync(invalidName, { recursive: true });

    chmodSync(child, 0o755);
    const directoryMode = runInventory();
    assert.notEqual(directoryMode.status, 0);
    assert.match(String(directoryMode.stderr), /exact mode 0700/);
    chmodSync(child, 0o700);

    writeFileSync(path.join(child, "extra"), "extra\n", { mode: 0o600 });
    const extra = runInventory();
    assert.notEqual(extra.status, 0);
    assert.match(String(extra.stderr), /unsupported entries|encoded name boundary/);
    rmSync(path.join(child, "extra"));

    chmodSync(record, 0o644);
    const recordMode = runInventory();
    assert.notEqual(recordMode.status, 0);
    assert.match(String(recordMode.stderr), /exact mode 0600/);
    chmodSync(record, 0o600);

    linkSync(record, outsideAlias);
    const hardLink = runInventory();
    assert.notEqual(hardLink.status, 0);
    assert.match(String(hardLink.stderr), /exactly one link/);
    rmSync(outsideAlias);

    rmSync(record);
    writeFileSync(record, "", { mode: 0o600 });
    const empty = runInventory();
    assert.notEqual(empty.status, 0);
    assert.match(String(empty.stderr), /per-file byte boundary/);

    writeFileSync(record, Buffer.from([0xff]), { mode: 0o600 });
    const invalidUtf8 = runInventory();
    assert.notEqual(invalidUtf8.status, 0);
    assert.match(String(invalidUtf8.stderr), /not valid UTF-8/);

    writeFileSync(record, "12345", { mode: 0o600 });
    const oversized = runInventory({ maxFileBytes: 4 });
    assert.notEqual(oversized.status, 0);
    assert.match(String(oversized.stderr), /per-file byte boundary/);

    writeFileSync(record, "record\n", { mode: 0o600 });
    const selectedInventoryResult = runInventory();
    assert.equal(selectedInventoryResult.status, 0);
    const selectedInventory = JSON.parse(String(selectedInventoryResult.stdout));
    const selectedOverflow = runAuthorityHelper(
      "private-lease-state-batch-read",
      privateLeaseStateArgs(root, { maxSelectedTotalBytes: 1 }),
      [rootDescriptor],
      privateLeaseStateRequest({
        expectedInventoryDigest: selectedInventory.inventoryDigest,
        expectedNameCount: Number(selectedInventory.inventoryEntryCount),
        expectedNamesDigest: selectedInventory.inventoryNamesDigest,
        includeBytes: true,
        returnInventory: false,
        selectedDirectoryNames: [name],
      }),
    );
    assert.notEqual(selectedOverflow.status, 0);
    assert.match(String(selectedOverflow.stderr), /selected byte boundary/);
  });
});

test("private lease state batch rejects record and sibling races", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-lease-state-race-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const name = `${"c".repeat(64)}.${"d".repeat(64)}.lease`;
  const child = path.join(root, name);
  const record = path.join(child, "lease.json");
  mkdirSync(child, { mode: 0o700 });
  writeFileSync(record, "before\n", { mode: 0o600 });
  await withDescriptorsAsync([root], async ([rootDescriptor]) => {
    const inventoryResult = runAuthorityHelper(
      "private-lease-state-batch-read",
      privateLeaseStateArgs(root),
      [rootDescriptor],
      privateLeaseStateRequest(),
    );
    assert.equal(inventoryResult.status, 0, String(inventoryResult.stderr));
    const inventory = JSON.parse(String(inventoryResult.stdout));
    const paused = spawnPausedHelper({
      operation: "private-lease-state-batch-read",
      args: privateLeaseStateArgs(root),
      descriptors: [rootDescriptor],
      pause: "after-private-lease-state-batch-record-open-before-read",
      source: name,
      input: privateLeaseStateRequest({
        expectedInventoryDigest: inventory.inventoryDigest,
        expectedNameCount: Number(inventory.inventoryEntryCount),
        expectedNamesDigest: inventory.inventoryNamesDigest,
        includeBytes: true,
        returnInventory: false,
        selectedDirectoryNames: [name],
      }),
    });
    const resultPromise = waitForHelperExit(paused.child);
    await waitForHelperPause(
      paused.child,
      paused.signalFd,
      "after-private-lease-state-batch-record-open-before-read",
    );
    writeFileSync(record, "after!\n", { mode: 0o600 });
    releasePausedHelper(paused.child, paused.releaseFd);
    const result = await resultPromise;
    assert.notEqual(result.code, 0);
    assert.match(String(result.stderr), /changed while being read|changed during admission/);
  });

  writeFileSync(record, "stable\n", { mode: 0o600 });
  await withDescriptorsAsync([root], async ([rootDescriptor]) => {
    const paused = spawnPausedHelper({
      operation: "private-lease-state-batch-read",
      args: privateLeaseStateArgs(root),
      descriptors: [rootDescriptor],
      pause: "after-private-lease-state-batch-preflight",
      input: privateLeaseStateRequest(),
    });
    const resultPromise = waitForHelperExit(paused.child);
    await waitForHelperPause(
      paused.child,
      paused.signalFd,
      "after-private-lease-state-batch-preflight",
    );
    const lateName = `${"e".repeat(64)}.${"f".repeat(64)}.lease`;
    mkdirSync(path.join(root, lateName), { mode: 0o700 });
    releasePausedHelper(paused.child, paused.releaseFd);
    const result = await resultPromise;
    assert.notEqual(result.code, 0);
    assert.match(String(result.stderr), /metadata changed|parent changed/);
  });
});

test("private lease state batch binds transient parent mutations across launches", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-lease-state-parent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const name = `${"5".repeat(64)}.${"6".repeat(64)}.lease`;
  mkdirSync(path.join(root, name), { mode: 0o700 });
  withDescriptors([root], ([rootDescriptor]) => {
    const initialResult = runAuthorityHelper(
      "private-lease-state-batch-read",
      privateLeaseStateArgs(root),
      [rootDescriptor],
      privateLeaseStateRequest(),
    );
    assert.equal(initialResult.status, 0, String(initialResult.stderr));
    const initial = JSON.parse(String(initialResult.stdout));
    const transient = `${"7".repeat(64)}.${"8".repeat(64)}.lease`;
    mkdirSync(path.join(root, transient), { mode: 0o700 });
    rmSync(path.join(root, transient), { recursive: true });
    const terminal = runAuthorityHelper(
      "private-lease-state-batch-read",
      privateLeaseStateArgs(root),
      [rootDescriptor],
      privateLeaseStateRequest({
        expectedInventoryDigest: initial.inventoryDigest,
        expectedNameCount: Number(initial.inventoryEntryCount),
        expectedNamesDigest: initial.inventoryNamesDigest,
        returnInventory: false,
      }),
    );
    assert.notEqual(terminal.status, 0);
    assert.match(String(terminal.stderr), /full inventory identity changed/);
  });
});
