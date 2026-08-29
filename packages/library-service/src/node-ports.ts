import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { Duplex } from "node:stream";
import { promisify } from "node:util";

import {
  LIBRARY_SERVICE_ADMISSION_FD,
  LIBRARY_SERVICE_COMMAND_REQUEST_FD,
  LIBRARY_SERVICE_COMMAND_RESPONSE_FD,
  LIBRARY_SERVICE_CREDENTIAL_DESCRIPTOR_FD,
  LIBRARY_SERVICE_DATA_ROOT_FD,
  LIBRARY_SERVICE_EXECUTABLE_FD,
  LIBRARY_SERVICE_LIFETIME_FD,
  LIBRARY_SERVICE_STATE_ROOT_FD,
  LibraryServiceFailure,
  type LibraryServiceAclProbeTarget,
  type LibraryServiceAclProofPort,
  type LibraryServiceBoundPath,
  type LibraryServiceClockPort,
  type LibraryServiceEntropyPort,
  type LibraryServiceFileMetadata,
  type LibraryServiceFileSystemPort,
  type LibraryServiceIdentityPort,
  type LibraryServiceProcessPort,
  type LibraryServiceSidecarExit,
  type LibraryServiceSidecarProcess,
} from "./contracts.js";
import { LIBRARY_CORE_NATIVE_COMMAND_MAXIMUM_FRAME_BYTES } from "./library-core-command-contract.generated.js";
import { assertLinuxAclOutputHasOnlyModeEntries } from "./linux-acl-proof.js";
import { createNodeLibraryServiceLocalActorIngressPortV1 } from "./local-actor-node-server.js";
import type { LibraryServiceLocalActorIngressPortV1 } from "./local-actor-transport.js";

const execFileAsync = promisify(execFile);
const MAX_ACL_OUTPUT_BYTES = 32 * 1_024;
const ACL_TIMEOUT_MS = 1_000;
const LINUX_GETFACL = "/usr/bin/getfacl";

type BigIntStats = Awaited<ReturnType<FileHandle["stat"]>> & {
  dev: bigint;
  ino: bigint;
  nlink: bigint;
  mode: bigint;
  uid: bigint;
  size: bigint;
};

function metadataKind(metadata: {
  isSymbolicLink(): boolean;
  isFile(): boolean;
  isDirectory(): boolean;
}): LibraryServiceFileMetadata["kind"] {
  if (metadata.isSymbolicLink()) return "symbolic-link";
  if (metadata.isFile()) return "file";
  if (metadata.isDirectory()) return "directory";
  return "other";
}

function metadataFromStats(metadata: BigIntStats): LibraryServiceFileMetadata {
  const size = Number(metadata.size);
  const uid = Number(metadata.uid);
  const links = Number(metadata.nlink);
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    !Number.isSafeInteger(uid) ||
    uid < 0 ||
    !Number.isSafeInteger(links) ||
    links < 1
  ) {
    throw new LibraryServiceFailure("filesystem_failure");
  }
  return {
    kind: metadataKind(metadata),
    mode: Number(metadata.mode),
    uid,
    size,
    device: metadata.dev.toString(10),
    inode: metadata.ino.toString(10),
    links,
  };
}

async function handleMetadata(
  handle: FileHandle,
): Promise<LibraryServiceFileMetadata> {
  return metadataFromStats(
    (await handle.stat({ bigint: true })) as unknown as BigIntStats,
  );
}

function sameIdentity(
  left: LibraryServiceFileMetadata,
  right: LibraryServiceFileMetadata,
): boolean {
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

class NodeBoundPath implements LibraryServiceBoundPath {
  #closed = false;
  readonly #handle: FileHandle;
  #metadata: LibraryServiceFileMetadata;

  constructor(
    readonly path: string,
    handle: FileHandle,
    metadata: LibraryServiceFileMetadata,
  ) {
    this.#handle = handle;
    this.#metadata = metadata;
  }

  get descriptor(): number {
    return this.#handle.fd;
  }

  get metadata(): LibraryServiceFileMetadata {
    return this.#metadata;
  }

  async assertStable(): Promise<void> {
    if (this.#closed) {
      throw new LibraryServiceFailure("filesystem_failure");
    }
    const after = await handleMetadata(this.#handle);
    if (!sameIdentity(after, this.metadata)) {
      throw new LibraryServiceFailure("bound_input_changed");
    }
  }

  async assertPathStable(): Promise<void> {
    if (this.#closed) {
      throw new LibraryServiceFailure("filesystem_failure");
    }
    let after: LibraryServiceFileMetadata;
    try {
      after = metadataFromStats(
        (await lstat(this.path, { bigint: true })) as unknown as BigIntStats,
      );
    } catch {
      throw new LibraryServiceFailure("bound_input_changed");
    }
    if (!sameIdentity(after, this.#metadata)) {
      throw new LibraryServiceFailure("bound_input_changed");
    }
  }

  async assertCanonicalPath(): Promise<void> {
    if (this.#closed) {
      throw new LibraryServiceFailure("filesystem_failure");
    }
    let canonical: string;
    try {
      canonical = await realpath(this.path);
    } catch {
      throw new LibraryServiceFailure("bound_input_changed");
    }
    if (canonical !== this.path) {
      throw new LibraryServiceFailure("bound_input_changed");
    }
  }

  async replaceText(contents: string): Promise<void> {
    if (this.#closed || this.#metadata.kind !== "file") {
      throw new LibraryServiceFailure("write_failed");
    }
    const before = this.#metadata;
    const bytes = Buffer.from(contents, "utf8");
    await this.#handle.truncate(0);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesWritten } = await this.#handle.write(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (bytesWritten === 0) throw new LibraryServiceFailure("write_failed");
      offset += bytesWritten;
    }
    await this.#handle.sync();
    const after = await handleMetadata(this.#handle);
    if (
      after.kind !== before.kind ||
      after.mode !== before.mode ||
      after.uid !== before.uid ||
      after.device !== before.device ||
      after.inode !== before.inode ||
      after.links !== before.links
    ) {
      throw new LibraryServiceFailure("bound_input_changed");
    }
    this.#metadata = after;
  }

  async readBoundedBytes(maximumBytes: number): Promise<Uint8Array> {
    if (
      this.#closed ||
      this.metadata.kind !== "file" ||
      this.metadata.size > maximumBytes
    ) {
      throw new LibraryServiceFailure("filesystem_failure");
    }
    const bytes = Buffer.alloc(this.metadata.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await this.#handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== bytes.byteLength) {
      throw new LibraryServiceFailure("bound_input_changed");
    }
    await this.assertStable();
    return bytes;
  }

  async sha256(): Promise<string> {
    if (this.#closed || this.metadata.kind !== "file") {
      throw new LibraryServiceFailure("filesystem_failure");
    }
    const digest = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1_024);
    let position = 0;
    while (position < this.metadata.size) {
      const length = Math.min(buffer.byteLength, this.metadata.size - position);
      const { bytesRead } = await this.#handle.read(
        buffer,
        0,
        length,
        position,
      );
      if (bytesRead === 0) {
        throw new LibraryServiceFailure("bound_input_changed");
      }
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    await this.assertStable();
    return digest.digest("hex");
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#handle.close();
  }
}

class NodeLibraryServiceFileSystem implements LibraryServiceFileSystemPort {
  async canonicalPath(filePath: string): Promise<string> {
    return realpath(filePath);
  }

  async inspect(filePath: string): Promise<LibraryServiceFileMetadata> {
    return metadataFromStats(
      (await lstat(filePath, { bigint: true })) as unknown as BigIntStats,
    );
  }

  async openBoundPath(filePath: string): Promise<LibraryServiceBoundPath> {
    const flags =
      constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0);
    const handle = await open(filePath, flags);
    try {
      const metadata = await handleMetadata(handle);
      return new NodeBoundPath(filePath, handle, metadata);
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  async openPrivateStatusFile(
    stateRoot: LibraryServiceBoundPath,
    stateRootPath: string,
    expectedUserId: number,
  ): Promise<LibraryServiceBoundPath | null> {
    await stateRoot.assertStable();
    await stateRoot.assertPathStable();
    const statusPath = path.join(stateRootPath, "library-service-status.json");
    let before: LibraryServiceFileMetadata | null = null;
    try {
      before = await this.inspect(statusPath);
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    if (before === null) return null;
    if (
      before !== null &&
      (before.kind !== "file" ||
        before.uid !== expectedUserId ||
        (before.mode & 0o7777) !== 0o600 ||
        before.links !== 1)
    ) {
      throw new LibraryServiceFailure("status_not_private");
    }

    const flags =
      constants.O_RDWR |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0);
    let handle: FileHandle;
    try {
      handle = await open(statusPath, flags, 0o600);
    } catch {
      throw new LibraryServiceFailure("status_not_private");
    }
    try {
      const metadata = await handleMetadata(handle);
      if (
        metadata.kind !== "file" ||
        metadata.uid !== expectedUserId ||
        (metadata.mode & 0o7777) !== 0o600 ||
        metadata.links !== 1 ||
        !sameIdentity(before, metadata)
      ) {
        throw new LibraryServiceFailure("status_not_private");
      }
      const bound = new NodeBoundPath(statusPath, handle, metadata);
      await stateRoot.assertStable();
      await stateRoot.assertPathStable();
      await bound.assertPathStable();
      return bound;
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  async readPrivateStatusText(
    statusFile: LibraryServiceBoundPath,
    maximumBytes: number,
  ): Promise<string> {
    const bytes = await statusFile.readBoundedBytes(maximumBytes);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  async writePrivateStatusText(
    statusFile: LibraryServiceBoundPath,
    contents: string,
  ): Promise<void> {
    if (!(statusFile instanceof NodeBoundPath)) {
      throw new LibraryServiceFailure("write_failed");
    }
    await statusFile.replaceText(contents);
  }
}

class NodeLibraryServiceIdentity implements LibraryServiceIdentityPort {
  currentUserId(): number | null {
    return typeof process.getuid === "function" ? process.getuid() : null;
  }
}

class NodeLibraryServiceClock implements LibraryServiceClockPort {
  nowMs(): number {
    return Date.now();
  }

  deadline(milliseconds: number): {
    elapsed: Promise<void>;
    cancel(): void;
  } {
    let timer: NodeJS.Timeout | null = null;
    const elapsed = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, milliseconds);
    });
    return {
      elapsed,
      cancel() {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
      },
    };
  }
}

class NodeLibraryServiceEntropy implements LibraryServiceEntropyPort {
  nonceHex(byteLength: number): string {
    return randomBytes(byteLength).toString("hex");
  }
}

class NodeLibraryServiceAclProof implements LibraryServiceAclProofPort {
  readonly #fileSystem: LibraryServiceFileSystemPort;

  constructor(fileSystem: LibraryServiceFileSystemPort) {
    this.#fileSystem = fileSystem;
  }

  async assertNoExtendedAcl(
    targets: readonly LibraryServiceAclProbeTarget[],
  ): Promise<void> {
    if (process.platform !== "darwin" && process.platform !== "linux") {
      throw new LibraryServiceFailure("acl_probe_unavailable");
    }
    const helperPath =
      process.platform === "darwin" ? "/bin/ls" : LINUX_GETFACL;
    let helper: LibraryServiceFileMetadata;
    try {
      helper = await this.#fileSystem.inspect(helperPath);
    } catch {
      throw new LibraryServiceFailure("acl_probe_unavailable");
    }
    if (
      helper.kind !== "file" ||
      helper.uid !== 0 ||
      (helper.mode & 0o022) !== 0 ||
      helper.links !== 1 ||
      (await this.#fileSystem.canonicalPath(helperPath)) !== helperPath
    ) {
      throw new LibraryServiceFailure("acl_probe_unavailable");
    }

    for (const target of targets) {
      const before = await this.#fileSystem.inspect(target.path);
      if (before.device !== target.device || before.inode !== target.inode) {
        throw new LibraryServiceFailure("bound_input_changed");
      }
      let stdout: string;
      let stderr: string;
      try {
        const arguments_ =
          process.platform === "darwin"
            ? ["-lde", target.path]
            : [
                "--absolute-names",
                "--numeric",
                "--omit-header",
                "--physical",
                "--",
                target.path,
              ];
        const result = await execFileAsync(helperPath, arguments_, {
          encoding: "utf8",
          timeout: ACL_TIMEOUT_MS,
          maxBuffer: MAX_ACL_OUTPUT_BYTES,
          env: { LANG: "C", LC_ALL: "C" },
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch {
        throw new LibraryServiceFailure("acl_probe_unavailable");
      }
      if (stderr !== "" || Buffer.byteLength(stdout) > MAX_ACL_OUTPUT_BYTES) {
        throw new LibraryServiceFailure("acl_probe_malformed");
      }
      if (process.platform === "linux") {
        assertLinuxAclOutputHasOnlyModeEntries(stdout, stderr, before.mode);
      } else {
        const firstLine = stdout.split("\n", 1)[0] ?? "";
        const mode = /^([bcdlps-][rwxStTs-]{9})([+@])?\s/.exec(firstLine);
        if (mode === null) {
          throw new LibraryServiceFailure("acl_probe_malformed");
        }
        if (
          mode[2] === "+" ||
          stdout.split("\n").some((line) => /^\s+\d+:/.test(line))
        ) {
          throw new LibraryServiceFailure("acl_present");
        }
      }
      const after = await this.#fileSystem.inspect(target.path);
      if (after.device !== target.device || after.inode !== target.inode) {
        throw new LibraryServiceFailure("bound_input_changed");
      }
    }
  }
}

interface NodeProcessGroup {
  readonly pid: number | null;
  readonly exit: Promise<LibraryServiceSidecarExit>;
  isRunning(): boolean;
  isGroupRunning(): boolean;
  terminate(signal: "SIGTERM" | "SIGKILL"): void;
}

function isDuplex(value: unknown): value is Duplex {
  return (
    value !== null &&
    typeof value === "object" &&
    "destroy" in value &&
    typeof value.destroy === "function" &&
    "end" in value &&
    typeof value.end === "function" &&
    "on" in value &&
    typeof value.on === "function" &&
    "read" in value &&
    typeof value.read === "function" &&
    "write" in value &&
    typeof value.write === "function"
  );
}

class NodeChildProcessGroup implements NodeProcessGroup {
  readonly exit: Promise<LibraryServiceSidecarExit>;
  protected readonly child: ChildProcess;

  constructor(child: ChildProcess) {
    this.child = child;
    this.exit = new Promise((resolve) => {
      let settled = false;
      const settle = (exit: LibraryServiceSidecarExit): void => {
        if (settled) return;
        settled = true;
        resolve(exit);
      };
      this.child.once("error", () => settle({ code: null, signal: null }));
      this.child.once("exit", (code, signal) => settle({ code, signal }));
    });
  }

  get pid(): number | null {
    return this.child.pid ?? null;
  }

  isRunning(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  isGroupRunning(): boolean {
    const pid = this.pid;
    if (pid === null) return false;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ESRCH"
      ) {
        return false;
      }
      return true;
    }
  }

  terminate(signal: "SIGTERM" | "SIGKILL"): void {
    const pid = this.pid;
    if (pid === null) return;
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ESRCH"
      ) {
        throw error;
      }
    }
  }
}

class NodeSidecarProcess
  extends NodeChildProcessGroup
  implements LibraryServiceSidecarProcess
{
  readonly #lifetimeWrite: Duplex;
  readonly #commandRequest: Duplex;
  readonly #commandResponse: Duplex;
  #lifetimeClosed = false;
  #commandTail: Promise<void> = Promise.resolve();

  constructor(
    child: ChildProcess,
    lifetimeWrite: Duplex,
    commandRequest: Duplex,
    commandResponse: Duplex,
  ) {
    super(child);
    this.#lifetimeWrite = lifetimeWrite;
    this.#commandRequest = commandRequest;
    this.#commandResponse = commandResponse;
    this.child.stdin?.on("error", () => undefined);
    this.child.stdout?.on("error", () => undefined);
    this.#lifetimeWrite.on("error", () => undefined);
    this.#commandRequest.on("error", () => undefined);
    this.#commandResponse.on("error", () => undefined);
  }

  async writeControl(contents: string): Promise<void> {
    if (this.child.stdin === null)
      throw new LibraryServiceFailure("spawn_failed");
    await new Promise<void>((resolve, reject) => {
      this.child.stdin!.write(contents, "utf8", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async closeControlInput(): Promise<void> {
    if (this.child.stdin === null)
      throw new LibraryServiceFailure("spawn_failed");
    await new Promise<void>((resolve) => this.child.stdin!.end(resolve));
  }

  async readControlOutput(maximumBytes: number): Promise<Uint8Array> {
    if (this.child.stdout === null)
      throw new LibraryServiceFailure("spawn_failed");
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of this.child.stdout) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > maximumBytes) {
        this.child.stdout.destroy();
        throw new LibraryServiceFailure("ready_oversized");
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, total);
  }

  async exchangeCommand(
    request: Uint8Array,
    maximumResponseBytes: number,
  ): Promise<Uint8Array> {
    if (
      request.byteLength === 0 ||
      request.byteLength > LIBRARY_CORE_NATIVE_COMMAND_MAXIMUM_FRAME_BYTES ||
      maximumResponseBytes <= 0 ||
      maximumResponseBytes > LIBRARY_CORE_NATIVE_COMMAND_MAXIMUM_FRAME_BYTES
    ) {
      throw new LibraryServiceFailure("command_channel_failed");
    }
    let resolveResult!: (value: Uint8Array) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<Uint8Array>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const operation = this.#commandTail.then(async () => {
      try {
        const header = Buffer.alloc(4);
        header.writeUInt32BE(request.byteLength, 0);
        await this.#writeCommandBytes(Buffer.concat([header, request]));
        const responseHeader = await this.#readCommandBytes(4);
        const responseLength = responseHeader.readUInt32BE(0);
        if (responseLength === 0 || responseLength > maximumResponseBytes) {
          throw new LibraryServiceFailure("command_response_invalid");
        }
        resolveResult(await this.#readCommandBytes(responseLength));
      } catch (error) {
        rejectResult(error);
      }
    });
    this.#commandTail = operation.catch(() => undefined);
    return result;
  }

  async #writeCommandBytes(bytes: Uint8Array): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#commandRequest.write(bytes, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async #readCommandBytes(length: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total < length) {
      const chunk = this.#commandResponse.read(length - total) as Buffer | null;
      if (chunk !== null) {
        chunks.push(chunk);
        total += chunk.byteLength;
        continue;
      }
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          this.#commandResponse.removeListener("readable", onReadable);
          this.#commandResponse.removeListener("end", onEnd);
          this.#commandResponse.removeListener("error", onError);
        };
        const onReadable = (): void => {
          cleanup();
          resolve();
        };
        const onEnd = (): void => {
          cleanup();
          reject(new LibraryServiceFailure("command_channel_failed"));
        };
        const onError = (): void => {
          cleanup();
          reject(new LibraryServiceFailure("command_channel_failed"));
        };
        this.#commandResponse.once("readable", onReadable);
        this.#commandResponse.once("end", onEnd);
        this.#commandResponse.once("error", onError);
      });
    }
    return Buffer.concat(chunks, total);
  }

  closeLifetime(): void {
    if (this.#lifetimeClosed) return;
    this.#lifetimeClosed = true;
    this.#lifetimeWrite.end();
    this.#lifetimeWrite.destroy();
    this.#commandRequest.end();
    this.#commandRequest.destroy();
    this.#commandResponse.destroy();
  }
}

class NodeLibraryServiceProcess implements LibraryServiceProcessPort {
  readonly #clock: LibraryServiceClockPort;
  readonly #spawnChild: typeof spawn;

  constructor(clock: LibraryServiceClockPort, spawnChild: typeof spawn) {
    this.#clock = clock;
    this.#spawnChild = spawnChild;
  }

  async #waitForGroupExit(
    processGroup: NodeProcessGroup,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = this.#clock.deadline(timeoutMs);
    let exitWake = processGroup.isRunning()
      ? processGroup.exit.then(() => "exit" as const)
      : null;
    try {
      while (processGroup.isGroupRunning()) {
        const poll = this.#clock.deadline(Math.min(25, timeoutMs));
        try {
          const outcomes: Array<Promise<"poll" | "timeout" | "exit">> = [
            deadline.elapsed.then(() => "timeout" as const),
            poll.elapsed.then(() => "poll" as const),
          ];
          if (exitWake !== null) outcomes.push(exitWake);
          const outcome = await Promise.race(outcomes);
          if (outcome === "timeout") return false;
          if (outcome === "exit") exitWake = null;
        } finally {
          poll.cancel();
        }
      }
      return true;
    } finally {
      deadline.cancel();
    }
  }

  async #settleAfterKill(
    processGroup: NodeProcessGroup,
    timeoutMs: number,
    closeLifetime?: () => void,
  ): Promise<void> {
    try {
      processGroup.terminate("SIGKILL");
    } catch {
      // The group-exit proof below remains authoritative.
    }
    closeLifetime?.();
    if (!(await this.#waitForGroupExit(processGroup, timeoutMs))) {
      throw new LibraryServiceFailure("sidecar_settlement_timeout");
    }
  }

  async spawn(request: {
    bindings: Parameters<LibraryServiceProcessPort["spawn"]>[0]["bindings"];
    args: readonly [];
    env: Readonly<Record<string, never>>;
    executableDigest: string;
    settlementTimeoutMs: number;
    signal?: AbortSignal;
  }): Promise<LibraryServiceSidecarProcess> {
    if (process.platform !== "darwin" && process.platform !== "linux") {
      throw new LibraryServiceFailure("unsupported_bound_descriptor_execution");
    }
    if (request.signal?.aborted) {
      throw new LibraryServiceFailure("startup_cancelled");
    }
    const executable = request.bindings.executable;
    await executable.assertStable();
    await executable.assertPathStable();
    await executable.assertCanonicalPath();
    if ((await executable.sha256()) !== request.executableDigest) {
      throw new LibraryServiceFailure("sidecar_digest_mismatch");
    }
    await executable.assertStable();
    await executable.assertPathStable();
    await executable.assertCanonicalPath();
    if (
      executable.metadata.uid !== 0 ||
      executable.metadata.links !== 1 ||
      (executable.metadata.mode & 0o022) !== 0
    ) {
      throw new LibraryServiceFailure("sidecar_path_unsafe");
    }
    if (request.signal?.aborted) {
      throw new LibraryServiceFailure("startup_cancelled");
    }
    const launchPath =
      process.platform === "linux"
        ? `/proc/self/fd/${LIBRARY_SERVICE_EXECUTABLE_FD}`
        : executable.path;
    let child: ChildProcess;
    try {
      child = this.#spawnChild(launchPath, [], {
        detached: true,
        cwd: "/",
        env: request.env,
        shell: false,
        windowsHide: true,
        stdio: [
          "pipe",
          "pipe",
          "ignore",
          request.bindings.executable.descriptor,
          request.bindings.dataRoot.descriptor,
          request.bindings.stateRoot.descriptor,
          request.bindings.admission.descriptor,
          request.bindings.credentialDescriptor.descriptor,
          "pipe",
          "pipe",
          "pipe",
        ],
      });
    } catch {
      throw new LibraryServiceFailure("spawn_failed");
    }
    const lifetime: unknown = (child.stdio as Array<unknown>)[
      LIBRARY_SERVICE_LIFETIME_FD
    ];
    const commandRequest: unknown = (child.stdio as Array<unknown>)[
      LIBRARY_SERVICE_COMMAND_REQUEST_FD
    ];
    const commandResponse: unknown = (child.stdio as Array<unknown>)[
      LIBRARY_SERVICE_COMMAND_RESPONSE_FD
    ];
    if (
      lifetime === null ||
      typeof lifetime !== "object" ||
      !("destroy" in lifetime) ||
      typeof lifetime.destroy !== "function" ||
      !("end" in lifetime) ||
      typeof lifetime.end !== "function" ||
      !("on" in lifetime) ||
      typeof lifetime.on !== "function" ||
      !isDuplex(commandRequest) ||
      !isDuplex(commandResponse)
    ) {
      let closeInvalidLifetime: (() => void) | undefined;
      if (
        lifetime !== null &&
        typeof lifetime === "object" &&
        "destroy" in lifetime &&
        typeof lifetime.destroy === "function"
      ) {
        const invalidLifetime = lifetime as { destroy(): void };
        closeInvalidLifetime = () => invalidLifetime.destroy();
      }
      await this.#settleAfterKill(
        new NodeChildProcessGroup(child),
        request.settlementTimeoutMs,
        closeInvalidLifetime,
      );
      throw new LibraryServiceFailure("unsupported_bound_descriptor_execution");
    }
    const sidecar = new NodeSidecarProcess(
      child,
      lifetime as Duplex,
      commandRequest as Duplex,
      commandResponse as Duplex,
    );

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let cancelling = false;
      const settle = (error?: LibraryServiceFailure): void => {
        if (settled) return;
        settled = true;
        request.signal?.removeEventListener("abort", onAbort);
        child.removeListener("spawn", onSpawn);
        child.removeListener("error", onError);
        if (error === undefined) resolve();
        else reject(error);
      };
      const onSpawn = (): void => {
        if (!cancelling) settle();
      };
      const onError = (): void => {
        if (cancelling) return;
        cancelling = true;
        void this.#settleAfterKill(sidecar, request.settlementTimeoutMs, () =>
          sidecar.closeLifetime(),
        ).then(
          () => settle(new LibraryServiceFailure("spawn_failed")),
          () => settle(new LibraryServiceFailure("sidecar_settlement_timeout")),
        );
      };
      const onAbort = (): void => {
        if (settled || cancelling) return;
        cancelling = true;
        void this.#settleAfterKill(sidecar, request.settlementTimeoutMs, () =>
          sidecar.closeLifetime(),
        ).then(
          () => settle(new LibraryServiceFailure("startup_cancelled")),
          () => settle(new LibraryServiceFailure("sidecar_settlement_timeout")),
        );
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) onAbort();
    });
    return sidecar;
  }
}

interface NodeLibraryServicePorts {
  fileSystem: LibraryServiceFileSystemPort;
  identity: LibraryServiceIdentityPort;
  aclProof: LibraryServiceAclProofPort;
  clock: LibraryServiceClockPort;
  entropy: LibraryServiceEntropyPort;
  process: LibraryServiceProcessPort;
  localActorIngress: LibraryServiceLocalActorIngressPortV1;
}

interface NodeLibraryServicePortsOptions {
  spawnChild?: typeof spawn;
}

export function createNodeLibraryServicePorts(
  options: NodeLibraryServicePortsOptions = {},
): NodeLibraryServicePorts {
  const fileSystem = new NodeLibraryServiceFileSystem();
  const clock = new NodeLibraryServiceClock();
  return {
    fileSystem,
    identity: new NodeLibraryServiceIdentity(),
    aclProof: new NodeLibraryServiceAclProof(fileSystem),
    clock,
    entropy: new NodeLibraryServiceEntropy(),
    process: new NodeLibraryServiceProcess(clock, options.spawnChild ?? spawn),
    localActorIngress: createNodeLibraryServiceLocalActorIngressPortV1(),
  };
}
