import type { FriendsGalaxyRendererScene } from "./friends-galaxy-renderer.js";
import {
  FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
  validateFriendsGalaxyProductWorkerResponse,
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

export class FriendsGalaxyProductWorkerClient {
  private readonly createWorker: () => FriendsGalaxyProductWorkerPort;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly onSourceReady: FriendsGalaxyProductWorkerClientOptions["onSourceReady"];
  private readonly onPresentationReady: FriendsGalaxyProductWorkerClientOptions["onPresentationReady"];
  private readonly onFailure: FriendsGalaxyProductWorkerClientOptions["onFailure"];
  private worker: FriendsGalaxyProductWorkerPort | null = null;
  private generation = 0;
  private nextRequestId = 1;
  private currentSourceRevision: number | null = null;
  private sourceRequest: FriendsGalaxyProductWorkerSourceRequest | null = null;
  private residentScene: FriendsGalaxyRendererScene | null = null;
  private inFlightPresentation: FriendsGalaxyProductWorkerPresentationRequest | null = null;
  private queuedPresentation: FriendsGalaxyProductWorkerPresentationRequest | null = null;
  private latestPresentationRequestId = 0;
  private responseDeadline = 0;
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
    this.latestPresentationRequestId = 0;
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

  poll(): void {
    if (
      this.responseDeadline === 0 ||
      this.now() < this.responseDeadline
    ) return;
    const request = this.sourceRequest ?? this.inFlightPresentation;
    this.fail(
      "runtime",
      "Friends Galaxy worker timed out while preserving the last visible scene.",
      request,
    );
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
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("Friends Galaxy worker client is disposed.");
    }
  }

  private post(request: FriendsGalaxyProductWorkerRequest): void {
    if (!this.worker) throw new Error("Friends Galaxy worker is unavailable.");
    this.responseDeadline = this.now() + this.timeoutMs;
    this.worker.postMessage(request);
  }

  private receive(generation: number, candidate: unknown): void {
    if (generation !== this.generation || this.disposed) {
      this.droppedResponses += 1;
      return;
    }
    const sourceRequest = this.sourceRequest;
    const presentationRequest = this.inFlightPresentation;
    if (!candidate || typeof candidate !== "object") {
      this.fail(
        "protocol",
        "Friends Galaxy worker returned an invalid response.",
        sourceRequest ?? presentationRequest,
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
        sourceRequest ?? presentationRequest,
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
      this.responseDeadline = 0;
      this.sourceRequest = null;
      this.residentScene = candidate.rendererScene;
      this.onSourceReady(candidate);
      this.flushPresentation();
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
      this.sourceRequest ?? this.inFlightPresentation ?? sourceRequest,
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
      this.responseDeadline = 0;
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
    try {
      this.onFailure(failure);
    } catch {
      // Failure reporting must not create a second worker failure.
    }
  }

  private releaseWorker(): void {
    this.responseDeadline = 0;
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onmessageerror = null;
    worker.onerror = null;
    worker.terminate();
  }
}
