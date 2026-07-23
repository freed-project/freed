import { beginFactoryResetBoundary } from "@freed/ui/lib/factory-reset";

const GENERATION_KEY = "freed_pwa_installation_generation";
const TOMBSTONE_KEY = "freed_pwa_factory_reset_tombstone";
const MESSAGE_KEY = "freed_pwa_factory_reset_message";
const RUNTIME_KEY_PREFIX = "freed_pwa_runtime_";
const ACK_KEY_PREFIX = "freed_pwa_factory_reset_ack_";
const RESET_CLAIM_KEY_PREFIX = "freed_pwa_factory_reset_claim_";
const RELOAD_MARKER_KEY = "freed_pwa_factory_reset_reload";
const RELOAD_ENVELOPE_KEY = "freed_pwa_factory_reset_reload_envelope";
const RESET_LOCK_NAME = "freed-pwa-factory-reset-v1";

const DEFAULT_CLAIM_ELECTION_WINDOW_MS = 50;
const DEFAULT_CLAIM_TTL_MS = 5 * 60_000;
const DEFAULT_QUIESCE_HANDLER_TIMEOUT_MS = 12_000;
// Sync, store, and Automerge quiesce sequentially. Allow their complete
// bounded budget plus time for cross-tab transport and timer throttling.
const DEFAULT_ACK_TIMEOUT_MS = 3 * DEFAULT_QUIESCE_HANDLER_TIMEOUT_MS + 9_000;

interface StorageLike {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

interface ResetTombstone {
  version: 1;
  resetId: string;
  generation: number;
  startedAt: number;
}

interface RuntimeRecord {
  version: 1;
  runtimeId: string;
  generation: number;
  registeredAt: number;
}

interface ResetAcknowledgement {
  version: 1;
  resetId: string;
  runtimeId: string;
  generation: number;
  acknowledgedAt: number;
  errors: string[];
}

interface ResetClaim {
  version: 1;
  claimId: string;
  runtimeId: string;
  generation: number;
  createdAt: number;
  expiresAt: number;
}

interface ReloadEnvelope {
  version: 1;
  tombstone: ResetTombstone;
  initiatorRuntimeId: string;
}

type CoordinatorMessage =
  | { type: "prepare"; tombstone: ResetTombstone }
  | { type: "ack"; acknowledgement: ResetAcknowledgement }
  | { type: "reload"; tombstone: ResetTombstone; initiatorRuntimeId: string };

export interface PwaRuntimeLifecycle {
  readonly generation: number;
  isCurrent(): boolean;
  assertCurrent(): void;
}

export interface PwaFactoryResetTransport {
  post(message: CoordinatorMessage): void;
  subscribe(listener: (message: CoordinatorMessage) => void): () => void;
}

export interface PwaFactoryResetLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => T | Promise<T>,
  ): Promise<T>;
}

export interface PwaFactoryResetCoordinatorOptions {
  storage: StorageLike;
  sessionStorage: StorageLike;
  transport: PwaFactoryResetTransport;
  now?: () => number;
  randomId?: () => string;
  acknowledgementTimeoutMs?: number;
  claimElectionWindowMs?: number;
  quiesceHandlerTimeoutMs?: number;
  lockManager?: PwaFactoryResetLockManager | null;
  onQuiesced?: () => void;
  reload?: () => void;
}

type QuiesceHandler = (signal: AbortSignal) => void | Promise<void>;

export class StalePwaRuntimeError extends Error {
  constructor() {
    super(
      "This Freed runtime belongs to an installation generation that has been reset",
    );
    this.name = "StalePwaRuntimeError";
  }
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function createNoopTransport(): PwaFactoryResetTransport {
  return {
    post: () => {},
    subscribe: () => () => {},
  };
}

function createBrowserTransport(
  storage: StorageLike,
): PwaFactoryResetTransport {
  if (typeof window === "undefined") return createNoopTransport();

  const listeners = new Set<(message: CoordinatorMessage) => void>();
  const BroadcastChannelConstructor = window.BroadcastChannel;
  const channel =
    typeof BroadcastChannelConstructor === "function"
      ? new BroadcastChannelConstructor("freed-pwa-factory-reset-v1")
      : null;

  const emit = (message: CoordinatorMessage) => {
    for (const listener of listeners) listener(message);
  };
  const onBroadcast = (event: MessageEvent<CoordinatorMessage>) =>
    emit(event.data);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== MESSAGE_KEY) return;
    const envelope = parseJson<{ message: CoordinatorMessage }>(event.newValue);
    if (envelope) emit(envelope.message);
  };

  channel?.addEventListener("message", onBroadcast);
  window.addEventListener("storage", onStorage);

  return {
    post: (message) => {
      const envelope = {
        messageId:
          globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        message,
      };
      storage.setItem(MESSAGE_KEY, JSON.stringify(envelope));
      channel?.postMessage(message);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function markBrowserRuntimeQuiesced(): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-freed-runtime-quiesced", "true");
  if (document.body) document.body.inert = true;
  if (document.getElementById("freed-factory-reset-peer-barrier")) return;

  const barrier = document.createElement("div");
  barrier.id = "freed-factory-reset-peer-barrier";
  barrier.textContent = "Freed is resetting. This tab will reload.";
  Object.assign(barrier.style, {
    alignItems: "center",
    background: "var(--theme-bg, #17110f)",
    color: "var(--theme-text, #f5ebe7)",
    display: "flex",
    fontFamily: "inherit",
    fontSize: "16px",
    inset: "0",
    justifyContent: "center",
    position: "fixed",
    zIndex: "2147483647",
  });
  document.documentElement.appendChild(barrier);
}

function readGeneration(storage: StorageLike): number {
  const parsed = Number(storage.getItem(GENERATION_KEY));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function readTombstone(storage: StorageLike): ResetTombstone | null {
  const tombstone = parseJson<ResetTombstone>(storage.getItem(TOMBSTONE_KEY));
  return tombstone?.version === 1 ? tombstone : null;
}

function isReloadEnvelopeForTombstone(
  envelope: ReloadEnvelope | null,
  tombstone: ResetTombstone,
): envelope is ReloadEnvelope {
  return (
    envelope?.version === 1 &&
    envelope.tombstone.resetId === tombstone.resetId &&
    envelope.tombstone.generation === tombstone.generation
  );
}

function acknowledgementKey(resetId: string, runtimeId: string): string {
  return `${ACK_KEY_PREFIX}${resetId}_${runtimeId}`;
}

function requirePositiveOption(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return value;
}

export class PwaFactoryResetCoordinator {
  private readonly storage: StorageLike;
  private readonly sessionStorage: StorageLike;
  private readonly transport: PwaFactoryResetTransport;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly acknowledgementTimeoutMs: number;
  private readonly claimElectionWindowMs: number;
  private readonly quiesceHandlerTimeoutMs: number;
  private readonly lockManager: PwaFactoryResetLockManager | null;
  private readonly onQuiesced: (() => void) | undefined;
  private readonly reload: (() => void) | undefined;
  private readonly runtimeId: string;
  private readonly generation: number;
  private readonly quiesceHandlers = new Map<
    string,
    { priority: number; handler: QuiesceHandler }
  >();
  private quiescePromise: Promise<ResetAcknowledgement> | null = null;
  private quiesceResetId: string | null = null;
  private reloadResetId: string | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private unsubscribeTransport: () => void;

  constructor(options: PwaFactoryResetCoordinatorOptions) {
    this.storage = options.storage;
    this.sessionStorage = options.sessionStorage;
    this.transport = options.transport;
    this.now = options.now ?? Date.now;
    this.randomId =
      options.randomId ??
      (() =>
        globalThis.crypto?.randomUUID?.() ?? `${this.now()}-${Math.random()}`);
    this.acknowledgementTimeoutMs = requirePositiveOption(
      "acknowledgementTimeoutMs",
      options.acknowledgementTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS,
    );
    this.claimElectionWindowMs = requirePositiveOption(
      "claimElectionWindowMs",
      options.claimElectionWindowMs ?? DEFAULT_CLAIM_ELECTION_WINDOW_MS,
    );
    this.quiesceHandlerTimeoutMs = requirePositiveOption(
      "quiesceHandlerTimeoutMs",
      options.quiesceHandlerTimeoutMs ?? DEFAULT_QUIESCE_HANDLER_TIMEOUT_MS,
    );
    this.lockManager = options.lockManager ?? null;
    this.onQuiesced = options.onQuiesced;
    this.reload = options.reload;
    this.runtimeId = this.randomId();

    this.clearCompletedReloadTombstone();
    const existingTombstone = readTombstone(this.storage);
    if (existingTombstone) beginFactoryResetBoundary();
    this.generation = readGeneration(this.storage);
    this.unsubscribeTransport = this.transport.subscribe((message) => {
      if (
        message.type === "prepare" &&
        this.shouldQuiesceForReset(message.tombstone)
      ) {
        void this.quiesceForReset(message.tombstone).catch((error) => {
          console.error("[factory-reset] peer quiesce failed", error);
        });
      }
      if (message.type === "reload") {
        this.handleReloadEnvelope({
          version: 1,
          tombstone: message.tombstone,
          initiatorRuntimeId: message.initiatorRuntimeId,
        });
      }
    });

    if (!existingTombstone) {
      this.registerRuntime();
    } else {
      this.quiesceResetId = existingTombstone.resetId;
      this.onQuiesced?.();
      const reloadEnvelope = parseJson<ReloadEnvelope>(
        this.storage.getItem(RELOAD_ENVELOPE_KEY),
      );
      if (isReloadEnvelopeForTombstone(reloadEnvelope, existingTombstone)) {
        this.handleReloadEnvelope(reloadEnvelope);
      } else {
        this.startInterruptedResetRecovery(existingTombstone);
      }
    }
  }

  captureLifecycle(): PwaRuntimeLifecycle {
    const generation = this.generation;
    return {
      generation,
      isCurrent: () => this.isGenerationCurrent(generation),
      assertCurrent: () => {
        if (!this.isGenerationCurrent(generation))
          throw new StalePwaRuntimeError();
      },
    };
  }

  isCurrent(): boolean {
    return this.isGenerationCurrent(this.generation);
  }

  assertCurrent(): void {
    if (!this.isCurrent()) throw new StalePwaRuntimeError();
  }

  registerQuiesceHandler(
    name: string,
    handler: QuiesceHandler,
    priority = 100,
  ): () => void {
    this.quiesceHandlers.set(name, { priority, handler });
    return () => this.quiesceHandlers.delete(name);
  }

  async runReset(operation: () => void | Promise<void>): Promise<void> {
    beginFactoryResetBoundary();
    if (this.lockManager) {
      return this.lockManager.request(
        RESET_LOCK_NAME,
        { mode: "exclusive" },
        async () => {
          this.assertCurrent();
          await this.runResetWithLock(operation);
        },
      );
    }
    await this.runResetWithFallbackClaim(operation);
  }

  private async runResetWithLock(
    operation: () => void | Promise<void>,
  ): Promise<void> {
    this.assertCurrent();
    const currentGeneration = readGeneration(this.storage);
    const tombstone: ResetTombstone = {
      version: 1,
      resetId: this.randomId(),
      generation: currentGeneration + 1,
      startedAt: this.now(),
    };

    this.storage.setItem(TOMBSTONE_KEY, JSON.stringify(tombstone));
    this.storage.setItem(GENERATION_KEY, String(tombstone.generation));
    const peers = this.readActivePeerIds(currentGeneration);
    this.transport.post({ type: "prepare", tombstone });
    try {
      const ownAcknowledgement = await this.quiesceForReset(tombstone);
      if (ownAcknowledgement.errors.length > 0) {
        throw new Error(
          `Factory reset could not quiesce this tab: ${ownAcknowledgement.errors.join(", ")}`,
        );
      }

      const peerAcknowledgements = await this.waitForPeerAcknowledgements(
        tombstone,
        peers,
      );
      const peerErrors = peerAcknowledgements.flatMap(
        (acknowledgement) => acknowledgement.errors,
      );
      if (peerErrors.length > 0) {
        throw new Error(
          `Factory reset could not quiesce every tab: ${peerErrors.join(", ")}`,
        );
      }

      await operation();
    } finally {
      this.storage.setItem(
        RELOAD_ENVELOPE_KEY,
        JSON.stringify({
          version: 1,
          tombstone,
          initiatorRuntimeId: this.runtimeId,
        } satisfies ReloadEnvelope),
      );
      this.transport.post({
        type: "reload",
        tombstone,
        initiatorRuntimeId: this.runtimeId,
      });
    }
  }

  private async runResetWithFallbackClaim(
    operation: () => void | Promise<void>,
  ): Promise<void> {
    this.assertCurrent();
    const generation = readGeneration(this.storage);
    const claim: ResetClaim = {
      version: 1,
      claimId: this.randomId(),
      runtimeId: this.runtimeId,
      generation,
      createdAt: this.now(),
      expiresAt: this.now() + DEFAULT_CLAIM_TTL_MS,
    };
    const ownClaimKey = `${RESET_CLAIM_KEY_PREFIX}${claim.claimId}`;
    this.storage.setItem(ownClaimKey, JSON.stringify(claim));
    try {
      await new Promise((resolve) =>
        setTimeout(resolve, this.claimElectionWindowMs),
      );
      this.assertCurrent();
      const candidates: ResetClaim[] = [];
      for (let index = 0; index < this.storage.length; index += 1) {
        const key = this.storage.key(index);
        if (!key?.startsWith(RESET_CLAIM_KEY_PREFIX)) continue;
        const candidate = parseJson<ResetClaim>(this.storage.getItem(key));
        if (
          candidate?.version === 1 &&
          candidate.generation === generation &&
          candidate.expiresAt >= this.now()
        ) {
          candidates.push(candidate);
        }
      }
      candidates.sort(
        (left, right) =>
          left.createdAt - right.createdAt ||
          left.claimId.localeCompare(right.claimId) ||
          left.runtimeId.localeCompare(right.runtimeId),
      );
      if (candidates[0]?.claimId !== claim.claimId) {
        throw new Error("Another Freed tab is already running factory reset");
      }
      this.assertCurrent();
      await this.runResetWithLock(operation);
    } finally {
      this.storage.removeItem(ownClaimKey);
    }
  }

  prepareReload(): void {
    const tombstone = readTombstone(this.storage);
    if (!tombstone) return;
    this.sessionStorage.setItem(
      RELOAD_MARKER_KEY,
      JSON.stringify({
        resetId: tombstone.resetId,
        generation: tombstone.generation,
      }),
    );
  }

  checkForPendingReload(): void {
    const tombstone = readTombstone(this.storage);
    const envelope = parseJson<ReloadEnvelope>(
      this.storage.getItem(RELOAD_ENVELOPE_KEY),
    );
    if (!tombstone || !isReloadEnvelopeForTombstone(envelope, tombstone)) {
      if (readGeneration(this.storage) > this.generation) {
        if (!this.quiesceResetId) this.onQuiesced?.();
        this.reload?.();
      }
      return;
    }
    if (
      this.generation < envelope.tombstone.generation &&
      !this.quiesceResetId
    ) {
      this.quiesceResetId = envelope.tombstone.resetId;
      this.onQuiesced?.();
    }
    this.handleReloadEnvelope(envelope);
  }

  dispose(): void {
    this.disposed = true;
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.unsubscribeTransport();
    this.storage.removeItem(`${RUNTIME_KEY_PREFIX}${this.runtimeId}`);
  }

  private clearCompletedReloadTombstone(): void {
    const marker = parseJson<{ resetId: string; generation: number }>(
      this.sessionStorage.getItem(RELOAD_MARKER_KEY),
    );
    const tombstone = readTombstone(this.storage);
    if (!marker) return;
    if (!tombstone) {
      this.sessionStorage.removeItem(RELOAD_MARKER_KEY);
      return;
    }
    if (
      marker.resetId !== tombstone.resetId ||
      marker.generation !== tombstone.generation
    )
      return;

    const reloadEnvelope = parseJson<ReloadEnvelope>(
      this.storage.getItem(RELOAD_ENVELOPE_KEY),
    );
    this.storage.removeItem(TOMBSTONE_KEY);
    if (isReloadEnvelopeForTombstone(reloadEnvelope, tombstone)) {
      this.storage.removeItem(RELOAD_ENVELOPE_KEY);
    }
    this.sessionStorage.removeItem(RELOAD_MARKER_KEY);
    for (let index = this.storage.length - 1; index >= 0; index -= 1) {
      const key = this.storage.key(index);
      if (!key) continue;
      if (key.startsWith(RUNTIME_KEY_PREFIX)) {
        const record = parseJson<RuntimeRecord>(this.storage.getItem(key));
        if (record?.version === 1 && record.generation < tombstone.generation) {
          this.storage.removeItem(key);
        }
        continue;
      }
      if (key.startsWith(`${ACK_KEY_PREFIX}${tombstone.resetId}_`)) {
        this.storage.removeItem(key);
        continue;
      }
      if (key.startsWith(RESET_CLAIM_KEY_PREFIX)) {
        const claim = parseJson<ResetClaim>(this.storage.getItem(key));
        if (claim?.version === 1 && claim.generation < tombstone.generation) {
          this.storage.removeItem(key);
        }
      }
    }
  }

  private startInterruptedResetRecovery(tombstone: ResetTombstone): void {
    if (this.lockManager) {
      void this.lockManager
        .request(RESET_LOCK_NAME, { mode: "exclusive" }, () =>
          this.recoverInterruptedResetAfterLivenessProof(tombstone),
        )
        .catch((error) => {
          console.error(
            "[factory-reset] interrupted reset recovery failed",
            error,
          );
        });
      return;
    }
    this.recoverInterruptedResetWithoutLocks(tombstone);
  }

  private recoverInterruptedResetAfterLivenessProof(
    expectedTombstone: ResetTombstone,
  ): void {
    if (this.disposed) return;
    const tombstone = readTombstone(this.storage);
    if (
      tombstone?.resetId !== expectedTombstone.resetId ||
      tombstone.generation !== expectedTombstone.generation
    ) {
      return;
    }

    const envelope = parseJson<ReloadEnvelope>(
      this.storage.getItem(RELOAD_ENVELOPE_KEY),
    );
    if (isReloadEnvelopeForTombstone(envelope, tombstone)) {
      this.handleReloadEnvelope(envelope);
      return;
    }
    this.publishRecoveryReloadEnvelope(tombstone);
  }

  private recoverInterruptedResetWithoutLocks(tombstone: ResetTombstone): void {
    if (this.disposed) return;
    const durable = readTombstone(this.storage);
    if (
      durable?.resetId !== tombstone.resetId ||
      durable.generation !== tombstone.generation
    ) {
      return;
    }

    const envelope = parseJson<ReloadEnvelope>(
      this.storage.getItem(RELOAD_ENVELOPE_KEY),
    );
    if (isReloadEnvelopeForTombstone(envelope, durable)) {
      this.handleReloadEnvelope(envelope);
      return;
    }

    const nextClaimExpiry = this.readNextActiveResetClaimExpiry(durable);
    if (nextClaimExpiry !== null) {
      const delayMs = Math.min(
        Math.max(1, nextClaimExpiry - this.now() + 1),
        2_147_483_647,
      );
      this.recoveryTimer = setTimeout(() => {
        this.recoveryTimer = null;
        this.recoverInterruptedResetWithoutLocks(tombstone);
      }, delayMs);
      return;
    }
    this.publishRecoveryReloadEnvelope(durable);
  }

  private readNextActiveResetClaimExpiry(
    tombstone: ResetTombstone,
  ): number | null {
    const activeExpiries: number[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (!key?.startsWith(RESET_CLAIM_KEY_PREFIX)) continue;
      const claim = parseJson<ResetClaim>(this.storage.getItem(key));
      if (
        claim?.version === 1 &&
        claim.generation === tombstone.generation - 1 &&
        Number.isFinite(claim.expiresAt) &&
        claim.expiresAt >= this.now()
      ) {
        activeExpiries.push(claim.expiresAt);
      }
    }
    return activeExpiries.length > 0 ? Math.min(...activeExpiries) : null;
  }

  private publishRecoveryReloadEnvelope(tombstone: ResetTombstone): void {
    if (this.disposed) return;
    const envelope: ReloadEnvelope = {
      version: 1,
      tombstone,
      initiatorRuntimeId: this.runtimeId,
    };
    this.storage.setItem(RELOAD_ENVELOPE_KEY, JSON.stringify(envelope));
    this.reloadResetId = tombstone.resetId;
    this.prepareReload();
    this.transport.post({
      type: "reload",
      tombstone,
      initiatorRuntimeId: this.runtimeId,
    });
    this.reload?.();
  }

  private handleReloadEnvelope(envelope: ReloadEnvelope): void {
    const tombstone = readTombstone(this.storage);
    if (
      !tombstone ||
      !isReloadEnvelopeForTombstone(envelope, tombstone) ||
      envelope.initiatorRuntimeId === this.runtimeId ||
      this.quiesceResetId !== envelope.tombstone.resetId ||
      this.reloadResetId === envelope.tombstone.resetId
    ) {
      return;
    }
    this.reloadResetId = envelope.tombstone.resetId;
    this.prepareReload();
    this.reload?.();
  }

  private isGenerationCurrent(generation: number): boolean {
    if (this.disposed || this.quiescePromise || readTombstone(this.storage))
      return false;
    if (readGeneration(this.storage) !== generation) return false;
    return true;
  }

  private registerRuntime(): void {
    if (this.disposed || this.quiescePromise || readTombstone(this.storage))
      return;
    const record: RuntimeRecord = {
      version: 1,
      runtimeId: this.runtimeId,
      generation: this.generation ?? readGeneration(this.storage),
      registeredAt: this.now(),
    };
    this.storage.setItem(
      `${RUNTIME_KEY_PREFIX}${this.runtimeId}`,
      JSON.stringify(record),
    );
  }

  private readActivePeerIds(generation: number): string[] {
    const peers: string[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (!key?.startsWith(RUNTIME_KEY_PREFIX)) continue;
      const record = parseJson<RuntimeRecord>(this.storage.getItem(key));
      if (
        record?.version === 1 &&
        record.runtimeId !== this.runtimeId &&
        record.generation === generation
      ) {
        peers.push(record.runtimeId);
      }
    }
    return [...new Set(peers)].sort();
  }

  private quiesceForReset(
    tombstone: ResetTombstone,
  ): Promise<ResetAcknowledgement> {
    beginFactoryResetBoundary();
    if (this.quiescePromise) return this.quiescePromise;
    this.quiesceResetId = tombstone.resetId;
    this.onQuiesced?.();
    this.quiescePromise = (async () => {
      const errors: string[] = [];
      const handlers = [...this.quiesceHandlers.entries()].sort(
        (left, right) => left[1].priority - right[1].priority,
      );
      for (const [name, entry] of handlers) {
        const controller = new AbortController();
        let timeout: ReturnType<typeof setTimeout> | null = null;
        try {
          await Promise.race([
            Promise.resolve().then(() => entry.handler(controller.signal)),
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(() => {
                controller.abort();
                reject(
                  new Error(
                    `${name} did not quiesce within ${this.quiesceHandlerTimeoutMs.toLocaleString()} milliseconds`,
                  ),
                );
              }, this.quiesceHandlerTimeoutMs);
            }),
          ]);
        } catch (error) {
          errors.push(
            `${name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      }

      const acknowledgement: ResetAcknowledgement = {
        version: 1,
        resetId: tombstone.resetId,
        runtimeId: this.runtimeId,
        generation: tombstone.generation,
        acknowledgedAt: this.now(),
        errors,
      };
      this.storage.setItem(
        acknowledgementKey(tombstone.resetId, this.runtimeId),
        JSON.stringify(acknowledgement),
      );
      this.storage.removeItem(`${RUNTIME_KEY_PREFIX}${this.runtimeId}`);
      this.transport.post({ type: "ack", acknowledgement });
      return acknowledgement;
    })();
    return this.quiescePromise;
  }

  private shouldQuiesceForReset(tombstone: ResetTombstone): boolean {
    const durable = readTombstone(this.storage);
    return (
      durable?.resetId === tombstone.resetId &&
      durable.generation === tombstone.generation &&
      readGeneration(this.storage) === tombstone.generation &&
      this.generation < tombstone.generation
    );
  }

  private async waitForPeerAcknowledgements(
    tombstone: ResetTombstone,
    peerIds: string[],
  ): Promise<ResetAcknowledgement[]> {
    if (peerIds.length === 0) return [];
    const deadline = this.now() + this.acknowledgementTimeoutMs;
    while (this.now() <= deadline) {
      const acknowledgements = peerIds.map((runtimeId) =>
        parseJson<ResetAcknowledgement>(
          this.storage.getItem(
            acknowledgementKey(tombstone.resetId, runtimeId),
          ),
        ),
      );
      if (
        acknowledgements.every(
          (acknowledgement, index) =>
            acknowledgement?.version === 1 &&
            acknowledgement.resetId === tombstone.resetId &&
            acknowledgement.runtimeId === peerIds[index] &&
            acknowledgement.generation === tombstone.generation,
        )
      ) {
        return acknowledgements as ResetAcknowledgement[];
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(
      "Factory reset could not stop another Freed tab. Freed will reload safely. Retry factory reset after the reload.",
    );
  }
}

export function createPwaFactoryResetCoordinator(
  options: PwaFactoryResetCoordinatorOptions,
): PwaFactoryResetCoordinator {
  return new PwaFactoryResetCoordinator(options);
}

const browserStorage =
  typeof localStorage === "undefined" ? createMemoryStorage() : localStorage;
const browserSessionStorage =
  typeof sessionStorage === "undefined"
    ? createMemoryStorage()
    : sessionStorage;
const browserLockManager =
  typeof navigator !== "undefined" && navigator.locks
    ? (navigator.locks as unknown as PwaFactoryResetLockManager)
    : null;
const browserCoordinator = createPwaFactoryResetCoordinator({
  storage: browserStorage,
  sessionStorage: browserSessionStorage,
  transport: createBrowserTransport(browserStorage),
  lockManager: browserLockManager,
  onQuiesced: markBrowserRuntimeQuiesced,
  reload: () => location.reload(),
});

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => browserCoordinator.dispose(), {
    once: true,
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    browserCoordinator.checkForPendingReload();
  });
}

export function capturePwaRuntimeLifecycle(): PwaRuntimeLifecycle {
  return browserCoordinator.captureLifecycle();
}

export function assertPwaRuntimeCurrent(): void {
  browserCoordinator.assertCurrent();
}

export function registerPwaFactoryResetQuiesceHandler(
  name: string,
  handler: QuiesceHandler,
  priority?: number,
): () => void {
  return browserCoordinator.registerQuiesceHandler(name, handler, priority);
}

export function runCoordinatedPwaFactoryReset(
  operation: () => void | Promise<void>,
): Promise<void> {
  return browserCoordinator.runReset(operation);
}

export function preparePwaFactoryResetReload(): void {
  browserCoordinator.prepareReload();
}
