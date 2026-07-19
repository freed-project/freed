import type { FriendsGalaxyRendererScene } from "./friends-galaxy-renderer.js";
import {
  FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
  validateFriendsGalaxyProductWorkerResponse,
  type FriendsGalaxyProductWorkerActivityRequest,
  type FriendsGalaxyProductWorkerActivityResponse,
  type FriendsGalaxyProductWorkerPresentationRequest,
  type FriendsGalaxyProductWorkerPresentationResponse,
  type FriendsGalaxyProductWorkerRequest,
  type FriendsGalaxyProductWorkerSourceRequest,
  type FriendsGalaxyProductWorkerSourceResponse,
} from "./friends-galaxy-product-worker-protocol.js";

const DEFAULT_PRODUCT_WORKER_TIMEOUT_MS = 30_000;

export type FriendsGalaxyProductWorkerSourceInput = Omit<
  FriendsGalaxyProductWorkerSourceRequest,
  "protocolVersion" | "requestId"
>;

export type FriendsGalaxyProductWorkerPresentationInput = Omit<
  FriendsGalaxyProductWorkerPresentationRequest,
  "protocolVersion" | "requestId"
>;

export type FriendsGalaxyProductWorkerActivityInput = Omit<
  FriendsGalaxyProductWorkerActivityRequest,
  "protocolVersion" | "requestId"
>;

export interface FriendsGalaxyProductWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: FriendsGalaxyProductWorkerRequest): void;
  terminate(): void;
}

export type FriendsGalaxyProductWorkerFailurePhase =
  | "source"
  | "presentation"
  | "activity"
  | "protocol"
  | "runtime"
  | "post";

export interface FriendsGalaxyProductWorkerFailure {
  phase: FriendsGalaxyProductWorkerFailurePhase;
  message: string;
  requestId: number | null;
  sourceRevision: number | null;
}

export interface FriendsGalaxyProductWorkerClientOptions {
  createWorker?: () => FriendsGalaxyProductWorkerPort;
  timeoutMs?: number;
  now?: () => number;
  onSourceReady(response: FriendsGalaxyProductWorkerSourceResponse): void;
  onPresentationReady(
    response: FriendsGalaxyProductWorkerPresentationResponse,
  ): void;
  onActivityReady?(response: FriendsGalaxyProductWorkerActivityResponse): void;
  onFailure(failure: FriendsGalaxyProductWorkerFailure): void;
}

function createProductWorker(): FriendsGalaxyProductWorkerPort {
  return new Worker(
    new URL("./friends-galaxy-product.worker.ts", import.meta.url),
    { type: "module", name: "friends-galaxy-product" },
  );
}

function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function boundedMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? "");
  const normalized = message.trim() || "Friends Galaxy worker failed.";
  return Array.from(normalized).slice(0, 240).join("");
}

function cloneActivityPatches(
  patches: FriendsGalaxyProductWorkerActivityRequest["patches"],
): FriendsGalaxyProductWorkerActivityRequest["patches"] {
  return patches.map((patch) => ({
    ...patch,
    summary: patch.summary
      ? {
          ...patch.summary,
          sampleItemIds: [...patch.summary.sampleItemIds],
          avatarUrlCandidates: [...patch.summary.avatarUrlCandidates],
        }
      : null,
  }));
}

function mergeActivityRequests(
  previous: FriendsGalaxyProductWorkerActivityRequest,
  next: FriendsGalaxyProductWorkerActivityRequest,
): FriendsGalaxyProductWorkerActivityRequest {
  const patchBySource = new Map<string, (typeof next.patches)[number]>();
  for (const patch of previous.patches) {
    patchBySource.set(`${patch.namespace}\u0000${patch.key}`, patch);
  }
  for (const patch of next.patches) {
    patchBySource.set(`${patch.namespace}\u0000${patch.key}`, patch);
  }
  return {
    ...next,
    patches: [...patchBySource.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, patch]) => patch),
  };
}

export class FriendsGalaxyProductWorkerClient {
  private readonly createWorker: () => FriendsGalaxyProductWorkerPort;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly onSourceReady: FriendsGalaxyProductWorkerClientOptions["onSourceReady"];
  private readonly onPresentationReady: FriendsGalaxyProductWorkerClientOptions["onPresentationReady"];
  private readonly onActivityReady: FriendsGalaxyProductWorkerClientOptions["onActivityReady"];
  private readonly onFailure: FriendsGalaxyProductWorkerClientOptions["onFailure"];
  private worker: FriendsGalaxyProductWorkerPort | null = null;
  private generation = 0;
  private nextRequestId = 1;
  private currentSourceRevision: number | null = null;
  private sourceRequest: FriendsGalaxyProductWorkerSourceRequest | null = null;
  private residentScene: FriendsGalaxyRendererScene | null = null;
  private inFlightPresentation: FriendsGalaxyProductWorkerPresentationRequest | null = null;
  private queuedPresentation: FriendsGalaxyProductWorkerPresentationRequest | null = null;
  private inFlightActivity: FriendsGalaxyProductWorkerActivityRequest | null = null;
  private queuedActivity: FriendsGalaxyProductWorkerActivityRequest | null = null;
  private latestPresentationRequestId = 0;
  private latestActivityRevision = -1;
  private sourceDeadline = 0;
  private presentationDeadline = 0;
  private activityDeadline = 0;
  private disposed = false;
  private droppedResponses = 0;
  private failures = 0;

  constructor(options: FriendsGalaxyProductWorkerClientOptions) {
    this.createWorker = options.createWorker ?? createProductWorker;
    this.timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(1, Math.floor(options.timeoutMs!))
      : DEFAULT_PRODUCT_WORKER_TIMEOUT_MS;
    this.now = options.now ?? defaultNow;
    this.onSourceReady = options.onSourceReady;
    this.onPresentationReady = options.onPresentationReady;
    this.onActivityReady = options.onActivityReady;
    this.onFailure = options.onFailure;
  }

  get activeSourceRevision(): number | null {
    return this.currentSourceRevision;
  }

  get sourceReady(): boolean {
    return this.residentScene !== null;
  }

  get presentationInFlight(): boolean {
    return this.inFlightPresentation !== null;
  }

  get presentationQueued(): boolean {
    return this.queuedPresentation !== null;
  }

  get activityInFlight(): boolean {
    return this.inFlightActivity !== null;
  }

  get activityQueued(): boolean {
    return this.queuedActivity !== null;
  }

  get droppedResponseCount(): number {
    return this.droppedResponses;
  }

  get failureCount(): number {
    return this.failures;
  }

  requestSource(input: FriendsGalaxyProductWorkerSourceInput): number {
    this.assertActive();
    this.releaseWorker();
    this.generation += 1;
    this.residentScene = null;
    this.inFlightPresentation = null;
    this.queuedPresentation = null;
    this.inFlightActivity = null;
    this.queuedActivity = null;
    this.latestPresentationRequestId = 0;
    this.latestActivityRevision = -1;
    const request: FriendsGalaxyProductWorkerSourceRequest = {
      ...input,
      kind: "source",
      protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
      requestId: this.nextRequestId++,
    };
    this.currentSourceRevision = request.sourceRevision;
    this.sourceRequest = request;
    const generation = this.generation;
    try {
      const worker = this.createWorker();
      this.worker = worker;
      worker.onmessage = (event) => this.receive(generation, event.data);
      worker.onmessageerror = () => this.receivePortFailure(
        generation,
        "protocol",
        "Friends Galaxy worker response could not be deserialized.",
        request,
      );
      worker.onerror = (event) => this.receivePortFailure(
        generation,
        "runtime",
        event.message || "Friends Galaxy worker failed.",
        request,
      );
      this.post(request);
    } catch (error) {
      this.fail("post", error, request);
    }
    return request.requestId;
  }

  requestPresentation(
    input: FriendsGalaxyProductWorkerPresentationInput,
  ): number | null {
    this.assertActive();
    if (this.currentSourceRevision !== input.sourceRevision || !this.worker) return null;
    const request: FriendsGalaxyProductWorkerPresentationRequest = {
      ...input,
      kind: "presentation",
      protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
      requestId: this.nextRequestId++,
    };
    this.latestPresentationRequestId = request.requestId;
    this.queuedPresentation = request;
    this.flushPresentation();
    return request.requestId;
  }

  requestActivity(input: FriendsGalaxyProductWorkerActivityInput): number | null {
    this.assertActive();
    if (
      this.currentSourceRevision !== input.sourceRevision ||
      !this.worker ||
      !Number.isSafeInteger(input.activityRevision) ||
      input.activityRevision < 0 ||
      input.activityRevision <= this.latestActivityRevision
    ) return null;
    const request: FriendsGalaxyProductWorkerActivityRequest = {
      ...input,
      patches: cloneActivityPatches(input.patches),
      kind: "activity",
      protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
      requestId: this.nextRequestId++,
    };
    this.latestActivityRevision = request.activityRevision;
    this.queuedActivity = this.queuedActivity
      ? mergeActivityRequests(this.queuedActivity, request)
      : request;
    this.flushActivity();
    return request.requestId;
  }

  poll(): void {
    const now = this.now();
    if (this.sourceDeadline > 0 && now >= this.sourceDeadline) {
      this.fail(
        "runtime",
        "Friends Galaxy worker timed out while preserving the last visible scene.",
        this.sourceRequest,
      );
      return;
    }
    if (this.presentationDeadline > 0 && now >= this.presentationDeadline) {
      this.fail(
        "runtime",
        "Friends Galaxy presentation timed out while preserving the last visible scene.",
        this.inFlightPresentation,
      );
      return;
    }
    if (this.activityDeadline > 0 && now >= this.activityDeadline) {
      this.fail(
        "runtime",
        "Friends Galaxy activity update timed out while preserving the last visible scene.",
        this.inFlightActivity,
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.releaseWorker();
    this.currentSourceRevision = null;
    this.sourceRequest = null;
    this.residentScene = null;
    this.inFlightPresentation = null;
    this.queuedPresentation = null;
    this.inFlightActivity = null;
    this.queuedActivity = null;
    this.latestActivityRevision = -1;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("Friends Galaxy worker client is disposed.");
    }
  }

  private post(request: FriendsGalaxyProductWorkerRequest): void {
    if (!this.worker) throw new Error("Friends Galaxy worker is unavailable.");
    const deadline = this.now() + this.timeoutMs;
    if (request.kind === "source") this.sourceDeadline = deadline;
    else if (request.kind === "presentation") this.presentationDeadline = deadline;
    else this.activityDeadline = deadline;
    this.worker.postMessage(request);
  }

  private receive(generation: number, candidate: unknown): void {
    if (generation !== this.generation || this.disposed) {
      this.droppedResponses += 1;
      return;
    }
    const sourceRequest = this.sourceRequest;
    const presentationRequest = this.inFlightPresentation;
    const activityRequest = this.inFlightActivity;
    if (!candidate || typeof candidate !== "object") {
      this.fail(
        "protocol",
        "Friends Galaxy worker returned an invalid response.",
        sourceRequest ?? presentationRequest ?? activityRequest,
      );
      return;
    }
    const requestId = (candidate as { requestId?: unknown }).requestId;
    if (
      typeof requestId !== "number" ||
      !Number.isSafeInteger(requestId) ||
      requestId < 0
    ) {
      this.fail(
        "protocol",
        "Friends Galaxy worker returned an invalid request id.",
        sourceRequest ?? presentationRequest ?? activityRequest,
      );
      return;
    }
    if (sourceRequest && requestId === sourceRequest.requestId) {
      this.receiveSource(candidate, sourceRequest);
      return;
    }
    if (presentationRequest && requestId === presentationRequest.requestId) {
      this.receivePresentation(candidate, presentationRequest);
      return;
    }
    if (activityRequest && requestId === activityRequest.requestId) {
      this.receiveActivity(candidate, activityRequest);
      return;
    }
    this.droppedResponses += 1;
  }

  private receiveSource(
    candidate: unknown,
    request: FriendsGalaxyProductWorkerSourceRequest,
  ): void {
    try {
      validateFriendsGalaxyProductWorkerResponse(candidate, request);
      if (candidate.kind === "error") {
        this.fail("source", candidate.message, request);
        return;
      }
      if (candidate.kind !== "source-ready") {
        throw new Error("Friends Galaxy worker returned the wrong source response.");
      }
      this.sourceDeadline = 0;
      this.sourceRequest = null;
      this.residentScene = candidate.rendererScene;
      this.onSourceReady(candidate);
      this.flushPresentation();
      this.flushActivity();
    } catch (error) {
      this.fail("protocol", error, request);
    }
  }

  private receivePortFailure(
    generation: number,
    phase: "protocol" | "runtime",
    error: unknown,
    sourceRequest: FriendsGalaxyProductWorkerSourceRequest,
  ): void {
    if (generation !== this.generation || this.disposed) {
      this.droppedResponses += 1;
      return;
    }
    this.fail(
      phase,
      error,
      this.sourceRequest ??
        this.inFlightPresentation ??
        this.inFlightActivity ??
        sourceRequest,
    );
  }

  private receivePresentation(
    candidate: unknown,
    request: FriendsGalaxyProductWorkerPresentationRequest,
  ): void {
    try {
      validateFriendsGalaxyProductWorkerResponse(
        candidate,
        request,
        this.residentScene ?? undefined,
      );
      if (candidate.kind === "error") {
        this.fail("presentation", candidate.message, request);
        return;
      }
      if (candidate.kind !== "presentation-ready") {
        throw new Error("Friends Galaxy worker returned the wrong presentation response.");
      }
      this.presentationDeadline = 0;
      this.inFlightPresentation = null;
      if (
        request.requestId === this.latestPresentationRequestId &&
        this.queuedPresentation === null
      ) {
        this.onPresentationReady(candidate);
      } else {
        this.droppedResponses += 1;
      }
      this.flushPresentation();
    } catch (error) {
      this.fail("protocol", error, request);
    }
  }

  private receiveActivity(
    candidate: unknown,
    request: FriendsGalaxyProductWorkerActivityRequest,
  ): void {
    try {
      validateFriendsGalaxyProductWorkerResponse(
        candidate,
        request,
        this.residentScene ?? undefined,
      );
      if (candidate.kind === "error") {
        this.fail("activity", candidate.message, request);
        return;
      }
      if (candidate.kind !== "activity-ready") {
        throw new Error("Friends Galaxy worker returned the wrong activity response.");
      }
      this.activityDeadline = 0;
      this.inFlightActivity = null;
      this.onActivityReady?.(candidate);
      this.flushActivity();
    } catch (error) {
      this.fail("protocol", error, request);
    }
  }

  private flushPresentation(): void {
    if (
      !this.worker || !this.residentScene || this.sourceRequest ||
      this.inFlightPresentation || !this.queuedPresentation
    ) return;
    const request = this.queuedPresentation;
    this.queuedPresentation = null;
    this.inFlightPresentation = request;
    try {
      this.post(request);
    } catch (error) {
      this.fail("post", error, request);
    }
  }

  private flushActivity(): void {
    if (
      !this.worker || !this.residentScene || this.sourceRequest ||
      this.inFlightActivity || !this.queuedActivity
    ) return;
    const request = this.queuedActivity;
    this.queuedActivity = null;
    this.inFlightActivity = request;
    try {
      this.post(request);
    } catch (error) {
      this.fail("post", error, request);
    }
  }

  private fail(
    phase: FriendsGalaxyProductWorkerFailurePhase,
    error: unknown,
    request: FriendsGalaxyProductWorkerRequest | null,
  ): void {
    if (this.disposed) return;
    const failure: FriendsGalaxyProductWorkerFailure = {
      phase,
      message: boundedMessage(error),
      requestId: request?.requestId ?? null,
      sourceRevision: request?.sourceRevision ?? null,
    };
    this.failures += 1;
    this.generation += 1;
    this.releaseWorker();
    this.currentSourceRevision = null;
    this.sourceRequest = null;
    this.residentScene = null;
    this.inFlightPresentation = null;
    this.queuedPresentation = null;
    this.inFlightActivity = null;
    this.queuedActivity = null;
    this.latestActivityRevision = -1;
    try {
      this.onFailure(failure);
    } catch {
      // Failure reporting must not create a second worker failure.
    }
  }

  private releaseWorker(): void {
    this.sourceDeadline = 0;
    this.presentationDeadline = 0;
    this.activityDeadline = 0;
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onmessageerror = null;
    worker.onerror = null;
    worker.terminate();
  }
}
