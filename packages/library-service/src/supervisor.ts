import {
  LIBRARY_SERVICE_ADMISSION_FD,
  LIBRARY_SERVICE_COMMAND_REQUEST_FD,
  LIBRARY_SERVICE_COMMAND_RESPONSE_FD,
  LIBRARY_SERVICE_CREDENTIAL_DESCRIPTOR_FD,
  LIBRARY_SERVICE_DATA_ROOT_FD,
  LIBRARY_SERVICE_EXECUTABLE_FD,
  LIBRARY_SERVICE_LIFETIME_FD,
  LIBRARY_SERVICE_MAX_CONTROL_BYTES,
  LIBRARY_SERVICE_PROTOCOL_VERSION,
  LIBRARY_SERVICE_STATE_ROOT_FD,
  LibraryServiceFailure,
  type LibraryServiceAclProofPort,
  type LibraryServiceBoundPath,
  type LibraryServiceClockPort,
  type LibraryServiceConfig,
  type LibraryServiceEntropyPort,
  type LibraryServiceFailureCode,
  type LibraryServiceFileSystemPort,
  type LibraryServiceIdentityPort,
  type LibraryServiceProcessPort,
  type LibraryServiceReadyRecord,
  type LibraryServiceSidecarExit,
  type LibraryServiceSidecarProcess,
  type LibraryServiceStartEnvelope,
} from "./contracts.js";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_APPLICATION_ID,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
} from "./library-core-command-contract.generated.js";
import {
  createLibraryCoreNativeCommandClientV1,
  type LibraryCoreNativeCommandClientV1,
} from "./native-command.js";
import {
  createLibraryServiceLocalActorProcessorV1,
  type LibraryServiceLocalActorIngressPortV1,
  type LibraryServiceLocalActorListenerV1,
} from "./local-actor-transport.js";
import {
  assertLibraryServiceBindingsStable,
  bindLibraryServiceConfig,
  type BoundLibraryServiceConfiguration,
} from "./config.js";
import {
  bindLibraryServiceStatusFile,
  createLibraryServiceStatusRecord,
  writeLibraryServiceStatus,
} from "./status.js";

const READY_KEYS = new Set([
  "type",
  "protocolVersion",
  "role",
  "pid",
  "leaseHeld",
  "authorityOpen",
  "admissionAccepted",
  "credentialsReady",
  "watchdogActive",
  "commandChannelReady",
  "parentNonce",
  "configDigest",
  "executableDigest",
  "dataRootDevice",
  "dataRootInode",
  "stateRootDevice",
  "stateRootInode",
  "admissionDigest",
  "credentialDescriptorDigest",
]);
const NONCE_HEX = /^[a-f0-9]{64}$/;
const STATUS_WRITE_TIMEOUT_MS = 1_000;

type SupervisorState = "idle" | "starting" | "running" | "stopping" | "settled";

export interface LibraryServiceSupervisorDependencies {
  configPath: string;
  fileSystem: LibraryServiceFileSystemPort;
  identity: LibraryServiceIdentityPort;
  aclProof: LibraryServiceAclProofPort;
  process: LibraryServiceProcessPort;
  clock: LibraryServiceClockPort;
  entropy: LibraryServiceEntropyPort;
  localActorIngress: LibraryServiceLocalActorIngressPortV1;
}

export interface LibraryServiceStartResult {
  role: "primary";
  phase: "running";
  sidecarPid: number;
  startedAt: string;
  localActorEndpoint: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFailure(
  error: unknown,
  fallback: LibraryServiceFailureCode,
): LibraryServiceFailure {
  return error instanceof LibraryServiceFailure
    ? error
    : new LibraryServiceFailure(fallback);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new LibraryServiceFailure("startup_cancelled");
  }
}

function raceWithAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return operation;
  if (signal.aborted) {
    return Promise.reject(new LibraryServiceFailure("startup_cancelled"));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => {
      finish(() => reject(new LibraryServiceFailure("startup_cancelled")));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function parseReadyRecord(bytes: Uint8Array): LibraryServiceReadyRecord {
  if (bytes.byteLength === 0) {
    throw new LibraryServiceFailure("ready_response_lost");
  }
  if (bytes.byteLength > LIBRARY_SERVICE_MAX_CONTROL_BYTES) {
    throw new LibraryServiceFailure("ready_oversized");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LibraryServiceFailure("ready_malformed");
  }
  if (!text.endsWith("\n")) {
    throw new LibraryServiceFailure("ready_response_lost");
  }
  const records = text.slice(0, -1).split("\n");
  if (records.length !== 1) {
    throw new LibraryServiceFailure("ready_multiple");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(records[0]);
  } catch {
    throw new LibraryServiceFailure("ready_malformed");
  }
  if (!isObject(raw)) {
    throw new LibraryServiceFailure("ready_malformed");
  }
  const keys = Object.keys(raw);
  if (
    keys.length !== READY_KEYS.size ||
    !keys.every((key) => READY_KEYS.has(key))
  ) {
    throw new LibraryServiceFailure("ready_malformed");
  }
  if (raw.role !== "primary") {
    throw new LibraryServiceFailure("ready_role_mismatch");
  }
  if (
    raw.type !== "ready" ||
    raw.protocolVersion !== LIBRARY_SERVICE_PROTOCOL_VERSION ||
    typeof raw.pid !== "number" ||
    !Number.isSafeInteger(raw.pid) ||
    raw.pid <= 0 ||
    raw.leaseHeld !== true ||
    raw.authorityOpen !== true ||
    raw.admissionAccepted !== true ||
    raw.credentialsReady !== true ||
    raw.watchdogActive !== true ||
    raw.commandChannelReady !== true ||
    typeof raw.parentNonce !== "string" ||
    typeof raw.configDigest !== "string" ||
    typeof raw.executableDigest !== "string" ||
    typeof raw.dataRootDevice !== "string" ||
    typeof raw.dataRootInode !== "string" ||
    typeof raw.stateRootDevice !== "string" ||
    typeof raw.stateRootInode !== "string" ||
    typeof raw.admissionDigest !== "string" ||
    typeof raw.credentialDescriptorDigest !== "string"
  ) {
    throw new LibraryServiceFailure("ready_malformed");
  }
  return raw as unknown as LibraryServiceReadyRecord;
}

async function inspectNormalizedCommandStorage(
  client: LibraryCoreNativeCommandClientV1,
): Promise<void> {
  const response = await client.execute("inspect_storage_v1", {});
  if (!isObject(response)) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  const resultKeys = Object.keys(response).sort();
  if (
    resultKeys.join(",") !==
      "activeAuthority,applicationId,contractVersion,protocolVersion,schemaSha256,schemaVersion" ||
    response.applicationId !== LIBRARY_CORE_SQLITE_APPLICATION_ID ||
    response.contractVersion !== LIBRARY_CORE_SQLITE_CONTRACT_VERSION ||
    response.protocolVersion !== LIBRARY_CORE_SQLITE_PROTOCOL_VERSION ||
    response.schemaVersion !== LIBRARY_CORE_SQLITE_SCHEMA_VERSION ||
    response.schemaSha256 !== LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256 ||
    (response.activeAuthority !== null && !isObject(response.activeAuthority))
  ) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
}

function assertReadyBinding(
  ready: LibraryServiceReadyRecord,
  child: LibraryServiceSidecarProcess,
  bound: BoundLibraryServiceConfiguration,
  parentNonce: string,
): void {
  if (child.pid === null || ready.pid !== child.pid || !child.isRunning()) {
    throw new LibraryServiceFailure("sidecar_exited");
  }
  if (
    ready.parentNonce !== parentNonce ||
    ready.configDigest !== bound.configDigest ||
    ready.executableDigest !== bound.executableDigest ||
    ready.dataRootDevice !== bound.bindings.dataRoot.metadata.device ||
    ready.dataRootInode !== bound.bindings.dataRoot.metadata.inode ||
    ready.stateRootDevice !== bound.bindings.stateRoot.metadata.device ||
    ready.stateRootInode !== bound.bindings.stateRoot.metadata.inode ||
    ready.admissionDigest !== bound.admissionDigest ||
    ready.credentialDescriptorDigest !== bound.credentialDescriptorDigest
  ) {
    throw new LibraryServiceFailure("ready_binding_mismatch");
  }
}

export class LibraryServiceSupervisor {
  readonly #configPath: string;
  readonly #fileSystem: LibraryServiceFileSystemPort;
  readonly #identity: LibraryServiceIdentityPort;
  readonly #aclProof: LibraryServiceAclProofPort;
  readonly #processPort: LibraryServiceProcessPort;
  readonly #clock: LibraryServiceClockPort;
  readonly #entropy: LibraryServiceEntropyPort;
  readonly #localActorIngress: LibraryServiceLocalActorIngressPortV1;
  #config: LibraryServiceConfig | null = null;
  #state: SupervisorState = "idle";
  #child: LibraryServiceSidecarProcess | null = null;
  #stateRoot: LibraryServiceBoundPath | null = null;
  #statusFile: LibraryServiceBoundPath | null = null;
  #startedAt: string | null = null;
  #settledExit: Promise<LibraryServiceSidecarExit> | null = null;
  #stopPromise: Promise<void> | null = null;
  #startupCommitted = false;
  #statusTail: Promise<void> = Promise.resolve();
  #localActor: LibraryServiceLocalActorListenerV1 | null = null;

  constructor(dependencies: LibraryServiceSupervisorDependencies) {
    this.#configPath = dependencies.configPath;
    this.#fileSystem = dependencies.fileSystem;
    this.#identity = dependencies.identity;
    this.#aclProof = dependencies.aclProof;
    this.#processPort = dependencies.process;
    this.#clock = dependencies.clock;
    this.#entropy = dependencies.entropy;
    this.#localActorIngress = dependencies.localActorIngress;
  }

  #requireConfig(): LibraryServiceConfig {
    if (this.#config === null) {
      throw new LibraryServiceFailure("config_invalid");
    }
    return this.#config;
  }

  async #writeStatus(
    phase: "starting" | "running" | "stopping" | "stopped" | "failed",
    reasonCode: LibraryServiceFailureCode | "requested_stop" | null,
  ): Promise<void> {
    const operation = this.#statusTail.then(() =>
      writeLibraryServiceStatus(
        this.#requireStatusFile(),
        this.#fileSystem,
        createLibraryServiceStatusRecord({
          phase,
          nowMs: this.#clock.nowMs(),
          startedAt: this.#startedAt,
          sidecarPid: this.#child?.pid ?? null,
          localActorEndpoint: this.#localActor?.endpoint ?? null,
          reasonCode,
        }),
      ),
    );
    this.#statusTail = operation.catch(() => undefined);
    await operation;
  }

  async #writeStatusRequired(
    phase: "starting" | "running",
    signal?: AbortSignal,
  ): Promise<void> {
    const deadline = this.#clock.deadline(STATUS_WRITE_TIMEOUT_MS);
    try {
      const outcome = await raceWithAbort(
        Promise.race([
          this.#writeStatus(phase, null).then(() => "written" as const),
          deadline.elapsed.then(() => "timeout" as const),
        ]),
        signal,
      );
      if (outcome === "timeout") {
        throw new LibraryServiceFailure("write_failed");
      }
    } finally {
      deadline.cancel();
    }
  }

  #requireStateRoot(): LibraryServiceBoundPath {
    if (this.#stateRoot === null) {
      throw new LibraryServiceFailure("state_root_invalid");
    }
    return this.#stateRoot;
  }

  #requireStatusFile(): LibraryServiceBoundPath {
    if (this.#statusFile === null) {
      throw new LibraryServiceFailure("status_invalid");
    }
    return this.#statusFile;
  }

  async #closeRuntimeBindings(): Promise<void> {
    const stateRoot = this.#stateRoot;
    const statusFile = this.#statusFile;
    this.#stateRoot = null;
    this.#statusFile = null;
    await Promise.all([
      stateRoot?.close().catch(() => undefined),
      statusFile?.close().catch(() => undefined),
    ]);
  }

  async #writeStatusBounded(
    phase: "starting" | "running" | "stopping" | "stopped" | "failed",
    reasonCode: LibraryServiceFailureCode | "requested_stop" | null,
  ): Promise<void> {
    const deadline = this.#clock.deadline(STATUS_WRITE_TIMEOUT_MS);
    try {
      await Promise.race([
        this.#writeStatus(phase, reasonCode).catch(() => undefined),
        deadline.elapsed,
      ]);
    } finally {
      deadline.cancel();
    }
  }

  async #waitForGroupExit(
    child: LibraryServiceSidecarProcess,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = this.#clock.deadline(timeoutMs);
    let exitWake = child.isRunning()
      ? child.exit.then(() => "exit" as const)
      : null;
    try {
      while (child.isGroupRunning()) {
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

  async #settleAfterTerm(
    child: LibraryServiceSidecarProcess,
    timeoutMs: number,
  ): Promise<void> {
    if (!child.isGroupRunning()) {
      child.closeLifetime();
      return;
    }

    try {
      child.terminate("SIGTERM");
    } catch {
      // The kill deadline below still attempts forced group settlement.
    }
    child.closeLifetime();
    if (await this.#waitForGroupExit(child, timeoutMs)) return;

    try {
      child.terminate("SIGKILL");
    } catch {
      // The settlement deadline below provides the bounded failure.
    }
    if (!(await this.#waitForGroupExit(child, timeoutMs))) {
      throw new LibraryServiceFailure("sidecar_settlement_timeout");
    }
  }

  async #settleAfterKill(
    child: LibraryServiceSidecarProcess,
    timeoutMs: number,
  ): Promise<void> {
    try {
      child.terminate("SIGKILL");
    } catch {
      // The group-exit proof below remains authoritative.
    }
    child.closeLifetime();
    if (!(await this.#waitForGroupExit(child, timeoutMs))) {
      throw new LibraryServiceFailure("sidecar_settlement_timeout");
    }
  }

  async #settleCancelledSpawn(
    spawnPromise: Promise<LibraryServiceSidecarProcess>,
    timeoutMs: number,
  ): Promise<never> {
    const deadline = this.#clock.deadline(timeoutMs);
    try {
      const outcome = await Promise.race([
        spawnPromise.then(
          (child) => ({ type: "child" as const, child }),
          (error: unknown) => ({ type: "error" as const, error }),
        ),
        deadline.elapsed.then(() => ({ type: "timeout" as const })),
      ]);
      if (outcome.type === "timeout") {
        const lateSpawnGuard = this.#clock.deadline(timeoutMs);
        void Promise.race([
          spawnPromise.then(
            () => undefined,
            () => undefined,
          ),
          lateSpawnGuard.elapsed,
        ]).finally(() => lateSpawnGuard.cancel());
        void spawnPromise.then(
          (lateChild) =>
            this.#settleAfterKill(lateChild, timeoutMs).catch(() => undefined),
          () => undefined,
        );
        throw new LibraryServiceFailure("sidecar_settlement_timeout");
      }
      if (outcome.type === "error") {
        throw toFailure(outcome.error, "startup_cancelled");
      }
      await this.#settleAfterKill(outcome.child, timeoutMs);
      throw new LibraryServiceFailure("startup_cancelled");
    } finally {
      deadline.cancel();
    }
  }

  async #failStart(error: unknown): Promise<never> {
    const failure = toFailure(error, "spawn_failed");
    const localActorSettlement =
      this.#localActor?.stop().catch(() => undefined) ?? Promise.resolve();
    this.#localActor = null;
    const child = this.#child;
    const settlement =
      child === null
        ? null
        : this.#settleAfterTerm(
            child,
            this.#requireConfig().sidecar.shutdownTimeoutMs,
          );
    const status =
      this.#statusFile === null
        ? Promise.resolve()
        : this.#writeStatusBounded("failed", failure.code);
    if (settlement !== null) {
      try {
        await settlement;
      } catch (settlementError) {
        const settlementFailure = toFailure(
          settlementError,
          "sidecar_settlement_timeout",
        );
        this.#state = "settled";
        await this.#writeStatusBounded("failed", settlementFailure.code);
        await status;
        throw settlementFailure;
      }
    }
    await localActorSettlement;
    this.#state = "settled";
    await status;
    throw failure;
  }

  async start(signal?: AbortSignal): Promise<LibraryServiceStartResult> {
    if (this.#state !== "idle") {
      throw new LibraryServiceFailure("already_started");
    }
    this.#state = "starting";
    throwIfAborted(signal);

    const bindingPromise = bindLibraryServiceConfig(
      this.#configPath,
      this.#fileSystem,
      this.#identity,
      this.#aclProof,
      signal,
    );
    let bound: BoundLibraryServiceConfiguration | null = null;
    let runningEstablished = false;
    try {
      try {
        bound = await raceWithAbort(bindingPromise, signal);
      } catch (error) {
        if (signal?.aborted) {
          void bindingPromise.then(
            (lateBinding) => lateBinding.close(),
            () => undefined,
          );
        }
        this.#state = "settled";
        throw toFailure(error, "config_invalid");
      }

      this.#config = bound.config;
      this.#stateRoot = bound.bindings.stateRoot;
      this.#startedAt = new Date(this.#clock.nowMs()).toISOString();
      throwIfAborted(signal);
      const statusBindingPromise = bindLibraryServiceStatusFile(
        bound.config,
        bound.bindings.stateRoot,
        this.#fileSystem,
        this.#identity,
        this.#aclProof,
      ).then((statusFile) => {
        if (statusFile === null) {
          throw new LibraryServiceFailure("status_invalid");
        }
        return statusFile;
      });
      try {
        this.#statusFile = await raceWithAbort(statusBindingPromise, signal);
      } catch (error) {
        if (signal?.aborted) {
          void statusBindingPromise.then(
            (lateStatusFile) => lateStatusFile.close(),
            () => undefined,
          );
        }
        throw error;
      }
      throwIfAborted(signal);
      await this.#writeStatusRequired("starting", signal);
      throwIfAborted(signal);
      await assertLibraryServiceBindingsStable(bound, this.#fileSystem, signal);
      throwIfAborted(signal);

      let child: LibraryServiceSidecarProcess;
      const spawnPromise = this.#processPort.spawn({
        bindings: bound.bindings,
        args: [],
        env: {},
        executableDigest: bound.executableDigest,
        settlementTimeoutMs: bound.config.sidecar.shutdownTimeoutMs,
        signal,
      });
      try {
        child = await raceWithAbort(spawnPromise, signal);
      } catch (error) {
        if (signal?.aborted) {
          return await this.#settleCancelledSpawn(
            spawnPromise,
            bound.config.sidecar.shutdownTimeoutMs,
          );
        }
        throw toFailure(
          error,
          signal?.aborted ? "startup_cancelled" : "spawn_failed",
        );
      }
      this.#child = child;
      throwIfAborted(signal);

      const parentNonce = this.#entropy.nonceHex(32);
      if (!NONCE_HEX.test(parentNonce)) {
        throw new LibraryServiceFailure("filesystem_failure");
      }
      const envelope: LibraryServiceStartEnvelope = {
        type: "start",
        protocolVersion: LIBRARY_SERVICE_PROTOCOL_VERSION,
        role: "primary",
        parentNonce,
        configDigest: bound.configDigest,
        executableDigest: bound.executableDigest,
        executableFd: LIBRARY_SERVICE_EXECUTABLE_FD,
        dataRootFd: LIBRARY_SERVICE_DATA_ROOT_FD,
        stateRootFd: LIBRARY_SERVICE_STATE_ROOT_FD,
        admissionFd: LIBRARY_SERVICE_ADMISSION_FD,
        credentialDescriptorFd: LIBRARY_SERVICE_CREDENTIAL_DESCRIPTOR_FD,
        lifetimeFd: LIBRARY_SERVICE_LIFETIME_FD,
        commandRequestFd: LIBRARY_SERVICE_COMMAND_REQUEST_FD,
        commandResponseFd: LIBRARY_SERVICE_COMMAND_RESPONSE_FD,
      };
      const encodedEnvelope = `${JSON.stringify(envelope)}\n`;
      if (
        Buffer.byteLength(encodedEnvelope, "utf8") >
        LIBRARY_SERVICE_MAX_CONTROL_BYTES
      ) {
        throw new LibraryServiceFailure("config_invalid");
      }

      const outputPromise = (async () => {
        await child.writeControl(encodedEnvelope);
        await child.closeControlInput();
        return child.readControlOutput(LIBRARY_SERVICE_MAX_CONTROL_BYTES + 1);
      })();
      const startupDeadline = this.#clock.deadline(
        bound.config.sidecar.startupTimeoutMs,
      );
      const readiness = await (async () => {
        try {
          return await raceWithAbort(
            Promise.race([
              outputPromise.then((bytes) => ({
                type: "output" as const,
                bytes,
              })),
              child.exit.then((exit) => ({ type: "exit" as const, exit })),
              startupDeadline.elapsed.then(() => ({
                type: "timeout" as const,
              })),
            ]),
            signal,
          );
        } finally {
          startupDeadline.cancel();
        }
      })();

      if (readiness.type === "timeout") {
        throw new LibraryServiceFailure("startup_timeout");
      }
      if (readiness.type === "exit") {
        throw new LibraryServiceFailure("sidecar_exited");
      }
      const ready = parseReadyRecord(readiness.bytes);
      assertReadyBinding(ready, child, bound, parentNonce);
      const commandClient = createLibraryCoreNativeCommandClientV1(
        child,
        this.#entropy,
      );
      await inspectNormalizedCommandStorage(commandClient);
      throwIfAborted(signal);

      const expectedUserId = this.#identity.currentUserId();
      if (expectedUserId === null) {
        throw new LibraryServiceFailure("local_actor_unavailable");
      }
      try {
        this.#localActor = await this.#localActorIngress.start({
          stateRoot: bound.bindings.stateRoot,
          expectedUserId,
          processor: createLibraryServiceLocalActorProcessorV1(
            {
              submitSignedIntentPage: (payload) =>
                commandClient.execute(
                  "ingest_follower_intent_page_v1",
                  payload,
                ),
            },
            this.#clock,
          ),
        });
      } catch {
        throw new LibraryServiceFailure("local_actor_unavailable");
      }
      const localActor = this.#localActor;
      let localActorFailed = false;
      void localActor.failure.catch(async () => {
        localActorFailed = true;
        if (this.#state !== "running") return;
        this.#state = "stopping";
        try {
          child.terminate("SIGKILL");
        } catch {
          // The sidecar exit path still fences the service.
        }
        child.closeLifetime();
        await this.#writeStatusBounded("failed", "local_actor_failed");
      });
      throwIfAborted(signal);

      this.#state = "running";
      if (localActorFailed) {
        throw new LibraryServiceFailure("local_actor_failed");
      }
      this.#settledExit = child.exit.then(async (exit) => {
        const unexpectedExit = this.#state === "running";
        const unownedForcedExit =
          this.#state === "stopping" && this.#stopPromise === null;
        if (unexpectedExit || unownedForcedExit) {
          this.#state = "settled";
          const localActorAtExit = this.#localActor;
          this.#localActor = null;
          await localActorAtExit?.stop().catch(() => undefined);
          try {
            await this.#settleAfterKill(
              child,
              this.#requireConfig().sidecar.shutdownTimeoutMs,
            );
          } catch (error) {
            const failure = toFailure(error, "sidecar_settlement_timeout");
            if (this.#startupCommitted) {
              await this.#writeStatusBounded("failed", failure.code);
            }
            await this.#closeRuntimeBindings();
            throw failure;
          }
          if (unexpectedExit && this.#startupCommitted) {
            await this.#writeStatusBounded("failed", "sidecar_exited");
          }
          await this.#closeRuntimeBindings();
        } else {
          child.closeLifetime();
        }
        return exit;
      });
      void this.#settledExit.catch(() => undefined);
      if (!child.isRunning()) {
        throw new LibraryServiceFailure("sidecar_exited");
      }
      await this.#writeStatusRequired("running", signal);
      throwIfAborted(signal);
      if (localActorFailed) {
        throw new LibraryServiceFailure("local_actor_failed");
      }
      if (this.#state !== "running" || !child.isRunning()) {
        throw new LibraryServiceFailure("sidecar_exited");
      }
      this.#startupCommitted = true;
      if (!child.isRunning()) {
        throw new LibraryServiceFailure("sidecar_exited");
      }
      runningEstablished = true;
      return {
        role: "primary",
        phase: "running",
        sidecarPid: ready.pid,
        startedAt: this.#startedAt,
        localActorEndpoint: localActor.endpoint,
      };
    } catch (error) {
      if (this.#config === null) {
        this.#state = "settled";
        throw toFailure(error, "config_invalid");
      }
      return await this.#failStart(error);
    } finally {
      if (bound !== null) {
        if (runningEstablished) {
          await Promise.all([
            bound.configFile.close(),
            bound.bindings.executable.close(),
            bound.bindings.dataRoot.close(),
            bound.bindings.admission.close(),
            bound.bindings.credentialDescriptor.close(),
          ]).catch(() => undefined);
        } else {
          await bound.close().catch(() => undefined);
          this.#stateRoot = null;
          await this.#statusFile?.close().catch(() => undefined);
          this.#statusFile = null;
        }
      }
    }
  }

  async waitForExit(): Promise<LibraryServiceSidecarExit> {
    if (this.#settledExit === null) {
      throw new LibraryServiceFailure("already_started");
    }
    return this.#settledExit;
  }

  stop(): Promise<void> {
    if (this.#stopPromise !== null) return this.#stopPromise;
    if (this.#state !== "running" || this.#child === null) {
      return Promise.reject(new LibraryServiceFailure("already_started"));
    }

    this.#state = "stopping";
    const child = this.#child;
    const localActor = this.#localActor;
    this.#localActor = null;
    const localActorSettlement = localActor?.stop() ?? Promise.resolve();
    const settlement = this.#settleAfterTerm(
      child,
      this.#requireConfig().sidecar.shutdownTimeoutMs,
    );
    void this.#writeStatusBounded("stopping", "requested_stop");
    this.#stopPromise = (async () => {
      let localActorFailed = false;
      try {
        await localActorSettlement.catch(() => {
          localActorFailed = true;
        });
        await settlement;
      } catch (error) {
        const failure = toFailure(error, "sidecar_settlement_timeout");
        this.#state = "settled";
        await this.#writeStatusBounded("failed", failure.code);
        await this.#closeRuntimeBindings();
        throw failure;
      }
      if (localActorFailed) {
        const failure = new LibraryServiceFailure("local_actor_failed");
        this.#state = "settled";
        await this.#writeStatusBounded("failed", failure.code);
        await this.#closeRuntimeBindings();
        throw failure;
      }
      this.#state = "settled";
      await this.#writeStatusBounded("stopped", "requested_stop");
      await this.#closeRuntimeBindings();
    })();
    return this.#stopPromise;
  }

  forceStop(): void {
    const child = this.#child;
    if (child === null) return;
    this.#state = "stopping";
    const localActor = this.#localActor;
    this.#localActor = null;
    void localActor?.stop().catch(() => undefined);
    try {
      child.terminate("SIGKILL");
    } catch {
      // A concurrent exit is already a settled outcome.
    }
    child.closeLifetime();
  }
}
