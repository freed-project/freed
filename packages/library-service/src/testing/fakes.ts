import { createHash } from "node:crypto";

import {
  LibraryServiceFailure,
  type LibraryServiceAclProbeTarget,
  type LibraryServiceAclProofPort,
  type LibraryServiceBoundInputs,
  type LibraryServiceBoundPath,
  type LibraryServiceClockPort,
  type LibraryServiceConfig,
  type LibraryServiceEntropyPort,
  type LibraryServiceFileMetadata,
  type LibraryServiceFileSystemPort,
  type LibraryServiceIdentityPort,
  type LibraryServiceProcessPort,
  type LibraryServiceSidecarExit,
  type LibraryServiceSidecarProcess,
  type LibraryServiceStartEnvelope,
} from "../contracts.js";
import {
  LIBRARY_CORE_NATIVE_COMMAND_PROTOCOL_VERSION,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_APPLICATION_ID,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
} from "../library-core-command-contract.generated.js";

export class Deferred<T> {
  readonly promise: Promise<T>;
  #resolve!: (value: T | PromiseLike<T>) => void;
  #reject!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }

  resolve(value: T): void {
    this.#resolve(value);
  }

  reject(error: unknown): void {
    this.#reject(error);
  }
}

class FakeBoundPath implements LibraryServiceBoundPath {
  bytes: Uint8Array;
  closed = false;

  constructor(
    readonly path: string,
    readonly descriptor: number,
    readonly metadata: LibraryServiceFileMetadata,
    text: string | null,
  ) {
    this.bytes = Buffer.from(text ?? "");
  }

  async assertStable(): Promise<void> {
    if (this.closed) {
      throw new LibraryServiceFailure("filesystem_failure");
    }
  }

  async assertPathStable(): Promise<void> {
    await this.assertStable();
  }

  async assertCanonicalPath(): Promise<void> {
    await this.assertStable();
  }

  async readBoundedBytes(maximumBytes: number): Promise<Uint8Array> {
    if (
      this.closed ||
      this.metadata.kind !== "file" ||
      this.bytes.byteLength > maximumBytes
    ) {
      throw new LibraryServiceFailure("filesystem_failure");
    }
    return this.bytes.slice();
  }

  async sha256(): Promise<string> {
    if (this.closed || this.metadata.kind !== "file") {
      throw new LibraryServiceFailure("filesystem_failure");
    }
    return createHash("sha256").update(this.bytes).digest("hex");
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  rewriteBytes(text: string): void {
    this.bytes = Buffer.from(text);
  }
}

export class FakeFileSystem implements LibraryServiceFileSystemPort {
  readonly metadata = new Map<string, LibraryServiceFileMetadata>();
  readonly texts = new Map<string, string>();
  readonly digests = new Map<string, string>();
  readonly canonical = new Map<string, string>();
  readonly writes: Array<{ filePath: string; contents: string }> = [];
  readonly opened: FakeBoundPath[] = [];
  readonly inspected: string[] = [];
  writeBarrier: Promise<void> | null = null;
  openBarrier: Promise<void> | null = null;
  inspectHook: ((filePath: string) => void) | null = null;
  writeHook: (() => void) | null = null;
  #nextDescriptor = 100;
  #nextInode = 1_000;

  #metadata(
    kind: LibraryServiceFileMetadata["kind"],
    uid: number,
    mode: number,
    size: number,
    previous?: LibraryServiceFileMetadata,
  ): LibraryServiceFileMetadata {
    return {
      kind,
      uid,
      mode,
      size,
      device: previous?.device ?? "9",
      inode: previous?.inode ?? String(this.#nextInode++),
      links: previous?.links ?? 1,
    };
  }

  addDirectory(filePath: string, uid = 501, mode = 0o700): void {
    this.metadata.set(
      filePath,
      this.#metadata("directory", uid, mode, 0, this.metadata.get(filePath)),
    );
  }

  addFile(filePath: string, text: string, uid = 501, mode = 0o600): void {
    this.texts.set(filePath, text);
    this.metadata.set(
      filePath,
      this.#metadata(
        "file",
        uid,
        mode,
        Buffer.byteLength(text),
        this.metadata.get(filePath),
      ),
    );
    this.digests.set(filePath, createHash("sha256").update(text).digest("hex"));
  }

  replaceFile(filePath: string, text: string, uid = 501, mode = 0o600): void {
    this.metadata.delete(filePath);
    this.addFile(filePath, text, uid, mode);
  }

  rewriteFileInPlace(filePath: string, text: string): void {
    const metadata = this.metadata.get(filePath);
    if (metadata === undefined || metadata.kind !== "file") {
      throw new Error(`cannot rewrite missing regular file: ${filePath}`);
    }
    const bytes = Buffer.from(text);
    metadata.size = bytes.byteLength;
    this.texts.set(filePath, text);
    this.digests.set(
      filePath,
      createHash("sha256").update(bytes).digest("hex"),
    );
    for (const bound of this.opened) {
      if (
        bound.metadata.device === metadata.device &&
        bound.metadata.inode === metadata.inode
      ) {
        bound.rewriteBytes(text);
      }
    }
  }

  async canonicalPath(filePath: string): Promise<string> {
    if (!this.metadata.has(filePath)) throw new Error("missing");
    return this.canonical.get(filePath) ?? filePath;
  }

  async inspect(filePath: string): Promise<LibraryServiceFileMetadata> {
    this.inspected.push(filePath);
    this.inspectHook?.(filePath);
    const value = this.metadata.get(filePath);
    if (value === undefined) throw new Error("missing");
    return { ...value };
  }

  async openBoundPath(filePath: string): Promise<LibraryServiceBoundPath> {
    if (this.openBarrier !== null) await this.openBarrier;
    const metadata = await this.inspect(filePath);
    const bound = new FakeBoundPath(
      filePath,
      this.#nextDescriptor++,
      metadata,
      this.texts.get(filePath) ?? null,
    );
    this.opened.push(bound);
    return bound;
  }

  async openPrivateStatusFile(
    stateRoot: LibraryServiceBoundPath,
    stateRootPath: string,
    expectedUserId: number,
  ): Promise<LibraryServiceBoundPath | null> {
    await stateRoot.assertStable();
    const filePath = `${stateRootPath}/library-service-status.json`;
    if (!this.metadata.has(filePath)) {
      return null;
    }
    const metadata = this.metadata.get(filePath)!;
    if (
      metadata.kind !== "file" ||
      metadata.uid !== expectedUserId ||
      (metadata.mode & 0o7777) !== 0o600 ||
      metadata.links !== 1
    ) {
      throw new LibraryServiceFailure("status_not_private");
    }
    return this.openBoundPath(filePath);
  }

  async readPrivateStatusText(
    statusFile: LibraryServiceBoundPath,
    maximumBytes: number,
  ): Promise<string> {
    await statusFile.assertStable();
    const filePath = statusFile.path;
    const text = this.texts.get(filePath);
    if (text === undefined) throw new LibraryServiceFailure("status_invalid");
    const metadata = this.metadata.get(filePath);
    if (
      metadata === undefined ||
      metadata.kind !== "file" ||
      (metadata.mode & 0o7777) !== 0o600 ||
      metadata.links !== 1
    ) {
      throw new LibraryServiceFailure("status_not_private");
    }
    if (Buffer.byteLength(text) > maximumBytes) {
      throw new LibraryServiceFailure("status_invalid");
    }
    return text;
  }

  async writePrivateStatusText(
    statusFile: LibraryServiceBoundPath,
    contents: string,
  ): Promise<void> {
    await statusFile.assertStable();
    const filePath = statusFile.path;
    this.writes.push({ filePath, contents });
    if (this.writeBarrier !== null) await this.writeBarrier;
    this.addFile(filePath, contents, 501, 0o600);
    this.writeHook?.();
  }
}

export class FakeIdentity implements LibraryServiceIdentityPort {
  constructor(readonly userId: number | null = 501) {}

  currentUserId(): number | null {
    return this.userId;
  }
}

export class FakeAclProof implements LibraryServiceAclProofPort {
  readonly calls: Array<readonly LibraryServiceAclProbeTarget[]> = [];
  failure: unknown = null;
  barrier: Promise<void> | null = null;
  barrierOnCall: number | null = null;
  afterProbe: (() => void) | null = null;

  async assertNoExtendedAcl(
    targets: readonly LibraryServiceAclProbeTarget[],
  ): Promise<void> {
    this.calls.push(targets.map((target) => ({ ...target })));
    if (
      this.barrier !== null &&
      (this.barrierOnCall === null || this.calls.length === this.barrierOnCall)
    ) {
      await this.barrier;
    }
    this.afterProbe?.();
    if (this.failure !== null) throw this.failure;
  }
}

export class FakeClock implements LibraryServiceClockPort {
  readonly sleepCalls: number[] = [];
  readonly immediateDurations = new Set<number>();
  cancelCalls = 0;

  constructor(
    readonly time = Date.parse("2026-08-19T00:00:00.000Z"),
    public sleepImmediately = false,
  ) {}

  nowMs(): number {
    return this.time;
  }

  deadline(milliseconds: number): {
    elapsed: Promise<void>;
    cancel(): void;
  } {
    this.sleepCalls.push(milliseconds);
    let cancelled = false;
    return {
      elapsed:
        this.sleepImmediately || this.immediateDurations.has(milliseconds)
          ? Promise.resolve()
          : new Promise(() => undefined),
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        this.cancelCalls += 1;
      },
    };
  }
}

export class FakeEntropy implements LibraryServiceEntropyPort {
  constructor(readonly nonce = "1".repeat(64)) {}

  nonceHex(_byteLength: number): string {
    return this.nonce;
  }
}

function defaultReadyBytes(
  pid: number,
  envelope: LibraryServiceStartEnvelope,
  bindings: LibraryServiceBoundInputs,
): Uint8Array {
  return readyBytes(pid, {
    parentNonce: envelope.parentNonce,
    configDigest: envelope.configDigest,
    executableDigest: envelope.executableDigest,
    dataRootDevice: bindings.dataRoot.metadata.device,
    dataRootInode: bindings.dataRoot.metadata.inode,
    stateRootDevice: bindings.stateRoot.metadata.device,
    stateRootInode: bindings.stateRoot.metadata.inode,
    admissionDigest: createHash("sha256")
      .update((bindings.admission as FakeBoundPath).bytes)
      .digest("hex"),
    credentialDescriptorDigest: createHash("sha256")
      .update((bindings.credentialDescriptor as FakeBoundPath).bytes)
      .digest("hex"),
  });
}

export class FakeSidecarProcess implements LibraryServiceSidecarProcess {
  readonly pid: number | null;
  readonly exitDeferred = new Deferred<LibraryServiceSidecarExit>();
  readonly exit = this.exitDeferred.promise;
  readonly controlWrites: string[] = [];
  readonly commandRequests: unknown[] = [];
  readonly signals: Array<"SIGTERM" | "SIGKILL"> = [];
  controlClosed = false;
  lifetimeClosed = false;
  controlWriteBarrier: Promise<void> | null = null;
  running: boolean;
  groupRunning: boolean;
  output: Uint8Array | Promise<Uint8Array> | null;
  bindings: LibraryServiceBoundInputs | null = null;
  exitOnTerm = true;
  exitOnKill = true;
  groupExitOnTerm = true;
  groupExitOnKill = true;

  constructor(
    input: {
      pid?: number | null;
      output?: Uint8Array | Promise<Uint8Array> | null;
      running?: boolean;
    } = {},
  ) {
    this.pid = input.pid === undefined ? 4_242 : input.pid;
    this.output = input.output ?? null;
    this.running = input.running ?? true;
    this.groupRunning = input.running ?? true;
  }

  isRunning(): boolean {
    return this.running;
  }

  isGroupRunning(): boolean {
    return this.groupRunning;
  }

  async writeControl(contents: string): Promise<void> {
    this.controlWrites.push(contents);
    if (this.controlWriteBarrier !== null) await this.controlWriteBarrier;
  }

  async closeControlInput(): Promise<void> {
    this.controlClosed = true;
  }

  async readControlOutput(_maximumBytes: number): Promise<Uint8Array> {
    if (this.output !== null) return this.output;
    if (this.bindings === null || this.controlWrites.length !== 1) {
      throw new Error("fake sidecar missing binding envelope");
    }
    return defaultReadyBytes(
      this.pid ?? 4_242,
      JSON.parse(this.controlWrites[0]) as LibraryServiceStartEnvelope,
      this.bindings,
    );
  }

  async exchangeCommand(
    request: Uint8Array,
    _maximumResponseBytes: number,
  ): Promise<Uint8Array> {
    const parsed = JSON.parse(Buffer.from(request).toString("utf8")) as {
      protocolVersion: number;
      requestId: string;
      commandId: string;
      payload: unknown;
    };
    this.commandRequests.push(parsed);
    if (
      parsed.protocolVersion !== LIBRARY_CORE_NATIVE_COMMAND_PROTOCOL_VERSION ||
      parsed.commandId !== "inspect_storage_v1"
    ) {
      throw new LibraryServiceFailure("command_channel_failed");
    }
    return Buffer.from(
      JSON.stringify({
        protocolVersion: LIBRARY_CORE_NATIVE_COMMAND_PROTOCOL_VERSION,
        requestId: parsed.requestId,
        ok: true,
        result: {
          activeAuthority: null,
          applicationId: LIBRARY_CORE_SQLITE_APPLICATION_ID,
          contractVersion: LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
          protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
          schemaSha256: LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
          schemaVersion: LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
        },
      }),
    );
  }

  terminate(signal: "SIGTERM" | "SIGKILL"): void {
    this.signals.push(signal);
    if (
      (signal === "SIGTERM" && this.exitOnTerm) ||
      (signal === "SIGKILL" && this.exitOnKill)
    ) {
      this.resolveExit({ code: null, signal });
    }
    if (
      (signal === "SIGTERM" && this.groupExitOnTerm) ||
      (signal === "SIGKILL" && this.groupExitOnKill)
    ) {
      this.groupRunning = false;
    }
  }

  closeLifetime(): void {
    this.lifetimeClosed = true;
  }

  resolveExit(exit: LibraryServiceSidecarExit): void {
    if (!this.running) return;
    this.running = false;
    this.exitDeferred.resolve(exit);
  }
}

export class FakeProcessPort implements LibraryServiceProcessPort {
  readonly requests: Array<Parameters<LibraryServiceProcessPort["spawn"]>[0]> =
    [];
  spawnError: unknown = null;
  spawnBarrier: Promise<void> | null = null;
  ignoreAbort = false;

  constructor(readonly child: FakeSidecarProcess) {}

  async spawn(
    request: Parameters<LibraryServiceProcessPort["spawn"]>[0],
  ): Promise<LibraryServiceSidecarProcess> {
    this.requests.push(request);
    if (this.spawnBarrier !== null) await this.spawnBarrier;
    if (!this.ignoreAbort && request.signal?.aborted) {
      throw new LibraryServiceFailure("startup_cancelled");
    }
    if (this.spawnError !== null) throw this.spawnError;
    this.child.bindings = request.bindings;
    return this.child;
  }
}

export function validConfig(): LibraryServiceConfig {
  return {
    schemaVersion: 1,
    role: "primary",
    dataRoot: "/safe/data",
    stateRoot: "/safe/state",
    admissionFile: "/safe/state/admission.json",
    credentialDescriptorFile: "/safe/state/credentials.json",
    sidecar: {
      executable: "/trusted/sidecar",
      sha256: "a".repeat(64),
      startupTimeoutMs: 5_000,
      shutdownTimeoutMs: 1_000,
    },
  };
}

export function readyBytes(
  pid = 4_242,
  overrides: Record<string, unknown> = {},
): Uint8Array {
  return Buffer.from(
    `${JSON.stringify({
      type: "ready",
      protocolVersion: 2,
      role: "primary",
      pid,
      leaseHeld: true,
      authorityOpen: true,
      admissionAccepted: true,
      credentialsReady: true,
      watchdogActive: true,
      commandChannelReady: true,
      parentNonce: "1".repeat(64),
      configDigest: "a".repeat(64),
      executableDigest: "b".repeat(64),
      dataRootDevice: "9",
      dataRootInode: "1002",
      stateRootDevice: "9",
      stateRootInode: "1003",
      admissionDigest: "c".repeat(64),
      credentialDescriptorDigest: "d".repeat(64),
      ...overrides,
    })}\n`,
  );
}

export function validConfigFileSystem(): FakeFileSystem {
  const fileSystem = new FakeFileSystem();
  fileSystem.addDirectory("/", 0, 0o755);
  fileSystem.addDirectory("/safe", 501, 0o700);
  fileSystem.addDirectory("/safe/data", 501, 0o700);
  fileSystem.addDirectory("/safe/state", 501, 0o700);
  fileSystem.addDirectory("/trusted", 0, 0o755);
  fileSystem.addFile("/trusted/sidecar", "sidecar", 0, 0o755);
  const config = validConfig();
  config.sidecar.sha256 = fileSystem.digests.get("/trusted/sidecar")!;
  fileSystem.addFile(
    "/safe/state/admission.json",
    JSON.stringify({ signedAdmission: "opaque" }),
  );
  fileSystem.addFile(
    "/safe/state/credentials.json",
    JSON.stringify({
      schemaVersion: 1,
      backend: "os-vault",
      recordId: "freed-library-primary",
    }),
  );
  fileSystem.addFile("/safe/config.json", JSON.stringify(config));
  fileSystem.addFile("/safe/state/library-service-status.json", "");
  return fileSystem;
}

export function expectFailureCode(error: unknown, code: string): void {
  if (!(error instanceof LibraryServiceFailure) || error.code !== code) {
    throw error;
  }
}
