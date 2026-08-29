import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";

import { createNodeLibraryServicePorts } from "../../../dist/node-ports.js";

const [
  sidecarPath,
  dataRoot,
  stateRoot,
  admissionPath,
  credentialPath,
  digest,
  mode,
] = process.argv.slice(2);

function metadata(stats, uid = Number(stats.uid)) {
  return {
    kind: stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other",
    mode: Number(stats.mode),
    uid,
    size: Number(stats.size),
    device: String(stats.dev),
    inode: String(stats.ino),
    links: Number(stats.nlink),
  };
}

function sameIdentity(left, right, ignoreUid = false) {
  return (
    left.kind === right.kind &&
    left.mode === right.mode &&
    (ignoreUid || left.uid === right.uid) &&
    (left.kind !== "file" || left.size === right.size) &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.links === right.links
  );
}

class BoundPath {
  constructor(path, descriptor, pretendRoot = false) {
    this.path = path;
    this.descriptor = descriptor;
    this.pretendRoot = pretendRoot;
    this.actualMetadata = metadata(fstatSync(descriptor, { bigint: true }));
    this.metadata = {
      ...this.actualMetadata,
      uid: pretendRoot ? 0 : this.actualMetadata.uid,
    };
  }

  async assertStable() {
    const current = metadata(fstatSync(this.descriptor, { bigint: true }));
    if (!sameIdentity(current, this.actualMetadata))
      throw new Error("fd changed");
  }

  async assertPathStable() {
    const current = metadata(lstatSync(this.path, { bigint: true }));
    if (!sameIdentity(current, this.actualMetadata))
      throw new Error("path changed");
  }

  async assertCanonicalPath() {
    await this.assertPathStable();
  }

  async readBoundedBytes(maximumBytes) {
    if (this.actualMetadata.size > maximumBytes) throw new Error("oversized");
    const bytes = Buffer.alloc(this.actualMetadata.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        this.descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count === 0) throw new Error("short read");
      offset += count;
    }
    return bytes;
  }

  async sha256() {
    return createHash("sha256")
      .update(await this.readBoundedBytes(this.actualMetadata.size))
      .digest("hex");
  }

  async close() {
    closeSync(this.descriptor);
  }
}

const openFlags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
const bindings = {
  executable: new BoundPath(
    sidecarPath,
    openSync(sidecarPath, openFlags),
    true,
  ),
  dataRoot: new BoundPath(dataRoot, openSync(dataRoot, openFlags)),
  stateRoot: new BoundPath(stateRoot, openSync(stateRoot, openFlags)),
  admission: new BoundPath(admissionPath, openSync(admissionPath, openFlags)),
  credentialDescriptor: new BoundPath(
    credentialPath,
    openSync(credentialPath, openFlags),
  ),
};
let invalidSidecarPid = null;
let invalidDescendantPid = null;
function spawnWithoutLifetime(command, args, options) {
  const stdio = [...options.stdio];
  stdio[8] = "ignore";
  const child = spawn(command, args, { ...options, stdio });
  invalidSidecarPid = child.pid ?? null;
  for (
    let attempt = 0;
    attempt < 200 && invalidDescendantPid === null;
    attempt += 1
  ) {
    const output = execFileSync("/bin/ps", ["-axo", "pid=,ppid="], {
      encoding: "utf8",
    });
    for (const line of output.trim().split("\n")) {
      const [pid, parentPid] = line.trim().split(/\s+/).map(Number);
      if (parentPid === invalidSidecarPid) {
        invalidDescendantPid = pid;
        break;
      }
    }
  }
  return child;
}

const ports = createNodeLibraryServicePorts(
  mode === "invalid-lifetime"
    ? { spawnChild: spawnWithoutLifetime }
    : undefined,
);

if (mode === "invalid-lifetime") {
  let code = "unexpected_success";
  try {
    await ports.process.spawn({
      bindings,
      args: [],
      env: {},
      executableDigest: digest,
      settlementTimeoutMs: 1_000,
    });
  } catch (error) {
    code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : "unknown";
  }
  for (const binding of Object.values(bindings)) await binding.close();
  await new Promise((resolve) =>
    process.stdout.write(
      `${JSON.stringify({
        type: "invalid-lifetime-settled",
        code,
        sidecarPid: invalidSidecarPid,
        descendantPid: invalidDescendantPid,
      })}\n`,
      resolve,
    ),
  );
} else {
  const sidecar = await ports.process.spawn({
    bindings,
    args: [],
    env: {},
    executableDigest: digest,
    settlementTimeoutMs: 1_000,
  });
  const envelope = {
    type: "start",
    protocolVersion: 2,
    role: "primary",
    parentNonce: "1".repeat(64),
    configDigest: "2".repeat(64),
    executableDigest: digest,
    executableFd: 3,
    dataRootFd: 4,
    stateRootFd: 5,
    admissionFd: 6,
    credentialDescriptorFd: 7,
    lifetimeFd: 8,
    commandRequestFd: 9,
    commandResponseFd: 10,
  };
  await sidecar.writeControl(`${JSON.stringify(envelope)}\n`);
  await sidecar.closeControlInput();
  const receipt = JSON.parse(
    Buffer.from(await sidecar.readControlOutput(4 * 1_024)).toString("utf8"),
  );
  for (const binding of Object.values(bindings)) await binding.close();
  process.stdout.write(
    `${JSON.stringify({ type: "harness-ready", sidecarPid: sidecar.pid, receipt })}\n`,
  );

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    for (const command of chunk.trim().split(/\s+/)) {
      if (command === "term") sidecar.terminate("SIGTERM");
      if (command === "kill") sidecar.terminate("SIGKILL");
    }
  });
  const exit = await sidecar.exit;
  sidecar.closeLifetime();
  process.stdin.destroy();
  process.stdout.write(`${JSON.stringify({ type: "harness-exit", exit })}\n`);
}
