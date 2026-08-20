import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import { createNodeLibraryServicePorts } from "../../../dist/node-ports.js";
import { LibraryServiceSupervisor } from "../../../dist/supervisor.js";

const [
  configPath,
  sidecarPath,
  dataRoot,
  stateRoot,
  admissionPath,
  credentialPath,
] = process.argv.slice(2);
const statusPath = path.join(stateRoot, "library-service-status.json");
const userOwnedPaths = new Set([
  configPath,
  dataRoot,
  stateRoot,
  admissionPath,
  credentialPath,
  statusPath,
]);

function rawMetadata(stats) {
  return {
    kind: stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other",
    mode: Number(stats.mode),
    uid: Number(stats.uid),
    size: Number(stats.size),
    device: String(stats.dev),
    inode: String(stats.ino),
    links: Number(stats.nlink),
  };
}

function sameIdentity(left, right) {
  return (
    left.kind === right.kind &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    (left.kind !== "file" || left.size === right.size) &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.links === right.links
  );
}

function presentedMetadata(filePath, stats) {
  const actual = rawMetadata(stats);
  return {
    ...actual,
    uid: userOwnedPaths.has(filePath) ? actual.uid : 0,
  };
}

class BoundPath {
  constructor(filePath, descriptor) {
    this.path = filePath;
    this.descriptor = descriptor;
    this.actualMetadata = rawMetadata(fstatSync(descriptor, { bigint: true }));
    this.metadata = {
      ...this.actualMetadata,
      uid: userOwnedPaths.has(filePath) ? this.actualMetadata.uid : 0,
    };
    this.closed = false;
  }

  async assertStable() {
    if (this.closed) throw new Error("closed descriptor");
    const current = rawMetadata(fstatSync(this.descriptor, { bigint: true }));
    if (!sameIdentity(current, this.actualMetadata))
      throw new Error("fd changed");
  }

  async assertPathStable() {
    if (this.closed) throw new Error("closed descriptor");
    const current = presentedMetadata(
      this.path,
      lstatSync(this.path, { bigint: true }),
    );
    if (!sameIdentity(current, this.metadata)) throw new Error("path changed");
  }

  async assertCanonicalPath() {
    if (realpathSync(this.path) !== this.path) throw new Error("path changed");
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
    await this.assertStable();
    return bytes;
  }

  async sha256() {
    return createHash("sha256")
      .update(await this.readBoundedBytes(this.actualMetadata.size))
      .digest("hex");
  }

  replaceText(contents) {
    const bytes = Buffer.from(contents, "utf8");
    ftruncateSync(this.descriptor, 0);
    let offset = 0;
    while (offset < bytes.length) {
      offset += writeSync(
        this.descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
    }
    fsyncSync(this.descriptor);
    this.actualMetadata = rawMetadata(
      fstatSync(this.descriptor, { bigint: true }),
    );
    this.metadata = {
      ...this.actualMetadata,
      uid: userOwnedPaths.has(this.path) ? this.actualMetadata.uid : 0,
    };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.descriptor);
  }
}

const openReadFlags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
const fileSystem = {
  async canonicalPath(filePath) {
    return realpathSync(filePath);
  },
  async inspect(filePath) {
    return presentedMetadata(filePath, lstatSync(filePath, { bigint: true }));
  },
  async openBoundPath(filePath) {
    return new BoundPath(filePath, openSync(filePath, openReadFlags));
  },
  async openPrivateStatusFile(stateRootBinding, stateRootPath, expectedUserId) {
    await stateRootBinding.assertStable();
    const filePath = path.join(stateRootPath, "library-service-status.json");
    const metadata = rawMetadata(lstatSync(filePath, { bigint: true }));
    if (
      metadata.kind !== "file" ||
      metadata.uid !== expectedUserId ||
      (metadata.mode & 0o7777) !== 0o600 ||
      metadata.links !== 1
    ) {
      throw new Error("invalid status fixture");
    }
    return new BoundPath(
      filePath,
      openSync(filePath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0)),
    );
  },
  async readPrivateStatusText(statusFile, maximumBytes) {
    return Buffer.from(
      await statusFile.readBoundedBytes(maximumBytes),
    ).toString("utf8");
  },
  async writePrivateStatusText(statusFile, contents) {
    statusFile.replaceText(contents);
  },
};

const nodePorts = createNodeLibraryServicePorts();
const supervisor = new LibraryServiceSupervisor({
  configPath,
  fileSystem,
  identity: { currentUserId: () => process.getuid() },
  aclProof: { assertNoExtendedAcl: async () => undefined },
  process: nodePorts.process,
  clock: nodePorts.clock,
  entropy: nodePorts.entropy,
});

try {
  const started = await supervisor.start();
  process.stdout.write(
    `${JSON.stringify({ type: "supervisor-ready", sidecarPid: started.sidecarPid })}\n`,
  );
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    if (chunk.trim() === "leader-term") {
      process.kill(started.sidecarPid, "SIGTERM");
    }
  });
  const exit = await supervisor.waitForExit();
  process.stdin.destroy();
  process.stdout.write(
    `${JSON.stringify({ type: "supervisor-exit", exit })}\n`,
  );
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : "unknown";
  process.stderr.write(
    `${JSON.stringify({ type: "supervisor-failed", code })}\n`,
  );
  process.exitCode = 2;
}
