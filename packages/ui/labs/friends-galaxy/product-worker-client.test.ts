import { describe, expect, it } from "vitest";
import {
  FriendsGalaxyProductWorkerClient,
  type FriendsGalaxyProductWorkerActivityInput,
  type FriendsGalaxyProductWorkerFailure,
  type FriendsGalaxyProductWorkerPort,
  type FriendsGalaxyProductWorkerPresentationInput,
  type FriendsGalaxyProductWorkerSourceInput,
} from "../../src/lib/friends-galaxy-product-worker-client.js";
import type {
  FriendsGalaxyProductWorkerRequest,
  FriendsGalaxyProductWorkerResponse,
} from "../../src/lib/friends-galaxy-product-worker-protocol.js";
import { FriendsGalaxyProductWorkerService } from "../../src/lib/friends-galaxy-product-worker-service.js";
import { createFriendsGalaxyProductSource } from "./product-source-fixture.js";

class FakeProductWorker implements FriendsGalaxyProductWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: FriendsGalaxyProductWorkerRequest[] = [];
  terminated = false;

  postMessage(message: FriendsGalaxyProductWorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: FriendsGalaxyProductWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<unknown>);
  }
}

function sourceInput(sourceRevision = 1): FriendsGalaxyProductWorkerSourceInput {
  return {
    kind: "source",
    sourceRevision,
    source: createFriendsGalaxyProductSource(80, 320),
    viewport: {
      width: 390,
      height: 844,
      selectedAccountId: "product-account-319",
    },
    backgroundStarCount: 1_000,
    backgroundSeed: "product-client",
  };
}

function presentationInput(
  presentationRevision: number,
  sourceRevision = 1,
): FriendsGalaxyProductWorkerPresentationInput {
  return {
    kind: "presentation",
    sourceRevision,
    presentationRevision,
    viewport: {
      width: 390,
      height: 844,
      transform: { x: 195, y: 422, scale: 0.42 },
      selectedAccountId: "product-account-319",
    },
  };
}

function activityInput(
  activityRevision: number,
  key = "x:product-author-1",
  sourceRevision = 1,
): FriendsGalaxyProductWorkerActivityInput {
  return {
    kind: "activity",
    sourceRevision,
    activityRevision,
    referenceTime: 1_800_000_000_000,
    patches: [{
      namespace: "social",
      key,
      summary: {
        itemCount: activityRevision,
        latestActivityAt: 1_799_999_000_000 + activityRevision,
        sampleItemIds: [`sample-${activityRevision.toLocaleString()}`],
        hasLocation: false,
        avatarUrlCandidates: [],
      },
    }],
  };
}

function serviceResponse(
  service: FriendsGalaxyProductWorkerService,
  worker: FakeProductWorker,
  messageIndex: number,
): FriendsGalaxyProductWorkerResponse {
  return service.handle(worker.messages[messageIndex]!);
}

describe("Friends Galaxy product worker client", () => {
  it("admits one source scene and queues settled detail until it is ready", () => {
    const worker = new FakeProductWorker();
    const service = new FriendsGalaxyProductWorkerService();
    const sourceReady: number[] = [];
    const presentations: number[] = [];
    const client = new FriendsGalaxyProductWorkerClient({
      createWorker: () => worker,
      onSourceReady: (response) => sourceReady.push(response.sourceRevision),
      onPresentationReady: (response) =>
        presentations.push(response.presentationRevision),
      onFailure: () => undefined,
    });

    client.requestSource(sourceInput());
    client.requestPresentation(presentationInput(1));
    expect(worker.messages.map((request) => request.kind)).toEqual(["source"]);
    worker.emit(serviceResponse(service, worker, 0));
    expect(sourceReady).toEqual([1]);
    expect(worker.messages.map((request) => request.kind)).toEqual([
      "source",
      "presentation",
    ]);
    worker.emit(serviceResponse(service, worker, 1));
    expect(presentations).toEqual([1]);
    expect(client.sourceReady).toBe(true);
    expect(client.presentationInFlight).toBe(false);
  });

  it("keeps one settled request in flight and applies only the latest coalesced view", () => {
    const worker = new FakeProductWorker();
    const service = new FriendsGalaxyProductWorkerService();
    const presentations: number[] = [];
    const client = new FriendsGalaxyProductWorkerClient({
      createWorker: () => worker,
      onSourceReady: () => undefined,
      onPresentationReady: (response) =>
        presentations.push(response.presentationRevision),
      onFailure: () => undefined,
    });

    client.requestSource(sourceInput());
    worker.emit(serviceResponse(service, worker, 0));
    client.requestPresentation(presentationInput(1));
    client.requestPresentation(presentationInput(2));
    client.requestPresentation(presentationInput(3));
    expect(worker.messages).toHaveLength(2);
    expect(client.presentationInFlight).toBe(true);
    expect(client.presentationQueued).toBe(true);

    worker.emit(serviceResponse(service, worker, 1));
    expect(presentations).toEqual([]);
    expect(worker.messages).toHaveLength(3);
    expect(worker.messages[2]).toMatchObject({ presentationRevision: 3 });
    worker.emit(serviceResponse(service, worker, 2));
    expect(presentations).toEqual([3]);
    expect(client.droppedResponseCount).toBe(1);
  });

  it("queues sparse activity until its source scene is admitted", () => {
    const worker = new FakeProductWorker();
    const service = new FriendsGalaxyProductWorkerService();
    const activityRevisions: number[] = [];
    const client = new FriendsGalaxyProductWorkerClient({
      createWorker: () => worker,
      onSourceReady: () => undefined,
      onPresentationReady: () => undefined,
      onActivityReady: (response) =>
        activityRevisions.push(response.activityRevision),
      onFailure: () => undefined,
    });

    client.requestSource(sourceInput());
    client.requestActivity(activityInput(1));
    expect(worker.messages.map((request) => request.kind)).toEqual(["source"]);
    worker.emit(serviceResponse(service, worker, 0));
    expect(worker.messages.map((request) => request.kind)).toEqual([
      "source",
      "activity",
    ]);
    worker.emit(serviceResponse(service, worker, 1));
    expect(activityRevisions).toEqual([1]);
    expect(client.activityInFlight).toBe(false);
  });

  it("merges queued activity sources without dropping an earlier delta", () => {
    const worker = new FakeProductWorker();
    const service = new FriendsGalaxyProductWorkerService();
    const activityRevisions: number[] = [];
    const client = new FriendsGalaxyProductWorkerClient({
      createWorker: () => worker,
      onSourceReady: () => undefined,
      onPresentationReady: () => undefined,
      onActivityReady: (response) =>
        activityRevisions.push(response.activityRevision),
      onFailure: () => undefined,
    });

    client.requestSource(sourceInput());
    worker.emit(serviceResponse(service, worker, 0));
    client.requestActivity(activityInput(1));
    client.requestActivity(activityInput(2, "linkedin:product-author-2"));
    client.requestActivity(activityInput(3, "instagram:product-author-3"));
    expect(client.activityInFlight).toBe(true);
    expect(client.activityQueued).toBe(true);
    expect(worker.messages).toHaveLength(2);

    worker.emit(serviceResponse(service, worker, 1));
    expect(activityRevisions).toEqual([1]);
    expect(worker.messages).toHaveLength(3);
    expect(worker.messages[2]).toMatchObject({
      kind: "activity",
      activityRevision: 3,
    });
    const queued = worker.messages[2];
    if (queued?.kind !== "activity") throw new Error("Expected an activity request.");
    expect(queued.patches.map((patch) => patch.key)).toEqual([
      "instagram:product-author-3",
      "linkedin:product-author-2",
    ]);
    worker.emit(serviceResponse(service, worker, 2));
    expect(activityRevisions).toEqual([1, 3]);
  });

  it("terminates an older source generation and ignores its late callback", () => {
    const workers: FakeProductWorker[] = [];
    const sourceReady: number[] = [];
    const failures: FriendsGalaxyProductWorkerFailure[] = [];
    const client = new FriendsGalaxyProductWorkerClient({
      createWorker: () => {
        const worker = new FakeProductWorker();
        workers.push(worker);
        return worker;
      },
      onSourceReady: (response) => sourceReady.push(response.sourceRevision),
      onPresentationReady: () => undefined,
      onFailure: (failure) => failures.push(failure),
    });

    client.requestSource(sourceInput(1));
    const staleHandler = workers[0]!.onmessage!;
    const staleErrorHandler = workers[0]!.onerror!;
    const staleResponse = new FriendsGalaxyProductWorkerService().handle(
      workers[0]!.messages[0]!,
    );
    client.requestSource(sourceInput(2));
    expect(workers[0]!.terminated).toBe(true);
    staleHandler({ data: staleResponse } as MessageEvent<unknown>);
    staleErrorHandler({ message: "late worker error" } as ErrorEvent);
    expect(sourceReady).toEqual([]);
    expect(failures).toEqual([]);
    expect(workers[1]!.terminated).toBe(false);
    const currentService = new FriendsGalaxyProductWorkerService();
    workers[1]!.emit(currentService.handle(workers[1]!.messages[0]!));
    expect(sourceReady).toEqual([2]);
    expect(client.droppedResponseCount).toBe(2);
  });

  it("terminates a current generation response without a valid request id", () => {
    const worker = new FakeProductWorker();
    const failures: FriendsGalaxyProductWorkerFailure[] = [];
    const client = new FriendsGalaxyProductWorkerClient({
      createWorker: () => worker,
      onSourceReady: () => undefined,
      onPresentationReady: () => undefined,
      onFailure: (failure) => failures.push(failure),
    });

    client.requestSource(sourceInput());
    worker.onmessage?.({ data: { kind: "source-ready" } } as MessageEvent<unknown>);

    expect(worker.terminated).toBe(true);
    expect(failures[0]).toMatchObject({
      phase: "protocol",
      message: "Friends Galaxy worker returned an invalid request id.",
    });
  });

  it("fails closed on a malformed response without a caller-side compiler", () => {
    const worker = new FakeProductWorker();
    const failures: FriendsGalaxyProductWorkerFailure[] = [];
    const client = new FriendsGalaxyProductWorkerClient({
      createWorker: () => worker,
      onSourceReady: () => undefined,
      onPresentationReady: () => undefined,
      onFailure: (failure) => failures.push(failure),
    });

    client.requestSource(sourceInput());
    worker.onmessage?.({
      data: {
        protocolVersion: 1,
        requestId: 1,
        sourceRevision: 1,
        durationMs: 0,
        kind: "source-ready",
      },
    } as MessageEvent<unknown>);

    expect(worker.terminated).toBe(true);
    expect(client.sourceReady).toBe(false);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      phase: "protocol",
      requestId: 1,
      sourceRevision: 1,
    });
  });

  it("uses the shared health poll to bound a silent worker", () => {
    const worker = new FakeProductWorker();
    const failures: FriendsGalaxyProductWorkerFailure[] = [];
    let now = 100;
    const client = new FriendsGalaxyProductWorkerClient({
      createWorker: () => worker,
      timeoutMs: 50,
      now: () => now,
      onSourceReady: () => undefined,
      onPresentationReady: () => undefined,
      onFailure: (failure) => failures.push(failure),
    });

    client.requestSource(sourceInput());
    now = 149;
    client.poll();
    expect(failures).toEqual([]);
    now = 150;
    client.poll();
    expect(worker.terminated).toBe(true);
    expect(failures[0]).toMatchObject({ phase: "runtime", requestId: 1 });
    expect(failures[0]!.message).toContain("last visible scene");
  });

  it("rejects a settled request from a different source revision", () => {
    const worker = new FakeProductWorker();
    const client = new FriendsGalaxyProductWorkerClient({
      createWorker: () => worker,
      onSourceReady: () => undefined,
      onPresentationReady: () => undefined,
      onFailure: () => undefined,
    });

    client.requestSource(sourceInput(4));
    expect(client.requestPresentation(presentationInput(1, 3))).toBeNull();
    expect(worker.messages).toHaveLength(1);
  });
});
