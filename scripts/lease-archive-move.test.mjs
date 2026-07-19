import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
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

function directoryGeneration(directoryPath) {
  const stats = lstatSync(directoryPath);
  return [stats.dev, stats.ino];
}

function fileGeneration(filePath) {
  const stats = lstatSync(filePath);
  return [stats.dev, stats.ino];
}

function contentIdentity(bytes) {
  return [bytes.length, createHash("sha256").update(bytes).digest("hex")];
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

test("lease archive helper source is pinned and contains both native exclusive contracts", () => {
  const source = readPinnedLeaseArchiveHelperSource();
  assert.equal(createHash("sha256").update(source).digest("hex"), helperDigest);
  assert.match(source, /renameatx_np/);
  assert.match(source, /RENAME_EXCL/);
  assert.match(source, /renameat2/);
  assert.match(source, /RENAME_NOREPLACE/);
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
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-python-runtime-"));
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
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-helper-source-"));
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
