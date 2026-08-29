import { describe, expect, it } from "vitest";
import {
  FriendsGalaxyProductWorkerClient,
  type FriendsGalaxyProductWorkerActivityInput,
  type FriendsGalaxyProductWorkerFailure,
  type FriendsGalaxyProductWorkerPort,
  type FriendsGalaxyProductWorkerPresentationInput,
} from "../../src/lib/friends-galaxy-product-worker-client.js";
import type {
  FriendsGalaxyProductWorkerRequest,
  FriendsGalaxyProductWorkerResponse,
} from "../../src/lib/friends-galaxy-product-worker-protocol.js";
import { FriendsGalaxyProductWorkerService } from "../../src/lib/friends-galaxy-product-worker-service.js";
import { socialActivitySummaryKey } from "../../src/lib/identity-graph-activity-summary.js";
import {
  createFriendsGalaxyProductSqliteQuery,
  productNormalizedSourceInput,
} from "./product-sqlite-source-fixture.js";

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
  key = socialActivitySummaryKey("x", "product-author-1"),
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

async function flushPromiseChain(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function requestSource(
  client: FriendsGalaxyProductWorkerClient,
  sourceRevision = 1,
) {
  const options = {
    accountCount: 320,
    backgroundSeed: "product-client",
    personCount: 80,
    sourceRevision,
    viewport: {
      height: 844,
      selectedAccountId: "product-account-319",
      width: 390,
    },
  };
  return client.requestNormalizedSource(
    productNormalizedSourceInput(options),
    createFriendsGalaxyProductSqliteQuery(options),
  );
}

async function admitSource(
  client: FriendsGalaxyProductWorkerClient,
  worker: FakeProductWorker,
  service: FriendsGalaxyProductWorkerService,
  sourceRevision = 1,
): Promise<number> {
  const startIndex = worker.messages.length;
  requestSource(client, sourceRevision);
  let messageIndex = startIndex;
  while (!client.sourceReady) {
    if (messageIndex >= worker.messages.length) await flushPromiseChain();
    const request = worker.messages[messageIndex];
    if (!request) throw new Error("Expected a normalized source request.");
    worker.emit(service.handle(request));
    messageIndex += 1;
    await flushPromiseChain();
  }
  return messageIndex;
}

describe("Friends Galaxy product worker client", () => {
  it("pumps one bounded SQLite graph page at a time before scene commit", async () => {
    const worker = new FakeProductWorker();
    const service = new FriendsGalaxyProductWorkerService();
    const queryIds: string[] = [];
    const sourceReady: number[] = [];
    const client = new FriendsGalaxyProductWorkerClient({
      createWorker: () => worker,
      onSourceReady: (response) => sourceReady.push(response.sourceRevision),
      onPresentationReady: () => undefined,
      onFailure: () => undefined,
    });
    const started = client.requestNormalizedSource({
      mode: "all_content",
      sourceRevision: 9,
      viewport: { height: 844, width: 390 },
    }, async (request) => {
      queryIds.push(request.queryId);
      return {
        layoutRevision: 2,
        nextCursor: null,
        queryId: request.queryId,
        rows: [],
        schemaVersion: 1,
        source: {
          generationId: "b".repeat(64),
          projectionRevision: 4,
          transitionSequence: 4,
        },
      } as unknown as Awaited<
        ReturnType<Parameters<typeof client.requestNormalizedSource>[1]>
      >;
    });
    expect(started).toBe(1);
    expect(worker.messages.map((message) => message.kind)).toEqual([
      "normalized-source-begin",
    ]);

    worker.emit(serviceResponse(service, worker, 0));
    await flushPromiseChain();
    for (let index = 1; index <= 3; index += 1) {
      expect(worker.messages.at(-1)?.kind).toBe("normalized-source-page");
      worker.emit(serviceResponse(service, worker, index));
      await flushPromiseChain();
    }
    expect(worker.messages.at(-1)?.kind).toBe("normalized-source-commit");
    worker.emit(serviceResponse(service, worker, 4));

    expect(queryIds).toEqual([
      "person_graph_page_v1",
      "account_graph_page_v1",
      "rss_feed_page_v1",
    ]);
    expect(sourceReady).toEqual([9]);
    expect(client.sourceReady).toBe(true);
  });

  it("admits one source scene and queues settled detail until it is ready", async () => {
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

    requestSource(client);
    client.requestPresentation(presentationInput(1));
    expect(worker.messages.map((request) => request.kind)).toEqual([
      "normalized-source-begin",
    ]);
    let messageIndex = 0;
    while (!client.sourceReady) {
      worker.emit(serviceResponse(service, worker, messageIndex));
      messageIndex += 1;
      await flushPromiseChain();
    }
    expect(sourceReady).toEqual([1]);
    expect(worker.messages.at(-1)?.kind).toBe("presentation");
    worker.emit(serviceResponse(service, worker, messageIndex));
    expect(presentations).toEqual([1]);
    expect(client.sourceReady).toBe(true);
    expect(client.presentationInFlight).toBe(false);
  });

  it("keeps one settled request in flight and applies only the latest coalesced view", async () => {
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

    const messageIndex = await admitSource(client, worker, service);
    client.requestPresentation(presentationInput(1));
    client.requestPresentation(presentationInput(2));
    client.requestPresentation(presentationInput(3));
    expect(worker.messages).toHaveLength(messageIndex + 1);
    expect(client.presentationInFlight).toBe(true);
    expect(client.presentationQueued).toBe(true);

    worker.emit(serviceResponse(service, worker, messageIndex));
    expect(presentations).toEqual([]);
    expect(worker.messages).toHaveLength(messageIndex + 2);
    expect(worker.messages[messageIndex + 1]).toMatchObject({ presentationRevision: 3 });
    worker.emit(serviceResponse(service, worker, messageIndex + 1));
    expect(presentations).toEqual([3]);
    expect(client.droppedResponseCount).toBe(1);
  });

  it("queues sparse activity until its source scene is admitted", async () => {
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

    requestSource(client);
    client.requestActivity(activityInput(1));
    let messageIndex = 0;
    while (!client.sourceReady) {
      worker.emit(serviceResponse(service, worker, messageIndex));
      messageIndex += 1;
      await flushPromiseChain();
    }
    expect(worker.messages.at(-1)?.kind).toBe("activity");
    worker.emit(serviceResponse(service, worker, messageIndex));
    expect(activityRevisions).toEqual([1]);
    expect(client.activityInFlight).toBe(false);
  });

  it("merges queued activity sources without dropping an earlier delta", async () => {
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

    const messageIndex = await admitSource(client, worker, service);
    client.requestActivity(activityInput(1));
    client.requestActivity(activityInput(
      2,
      socialActivitySummaryKey("linkedin", "product-author-2"),
    ));
    client.requestActivity(activityInput(
      3,
      socialActivitySummaryKey("instagram", "product-author-3"),
    ));
    expect(client.activityInFlight).toBe(true);
    expect(client.activityQueued).toBe(true);
    expect(worker.messages).toHaveLength(messageIndex + 1);

    worker.emit(serviceResponse(service, worker, messageIndex));
    expect(activityRevisions).toEqual([1]);
    expect(worker.messages).toHaveLength(messageIndex + 2);
    expect(worker.messages[messageIndex + 1]).toMatchObject({
      kind: "activity",
      activityRevision: 3,
    });
    const queued = worker.messages[messageIndex + 1];
    if (queued?.kind !== "activity") throw new Error("Expected an activity request.");
    expect(queued.patches.map((patch) => patch.key)).toEqual([
      socialActivitySummaryKey("instagram", "product-author-3"),
      socialActivitySummaryKey("linkedin", "product-author-2"),
    ]);
    worker.emit(serviceResponse(service, worker, messageIndex + 1));
    expect(activityRevisions).toEqual([1, 3]);
  });

  it("refuses a second normalized source while one fenced job is active", () => {
    const worker = new FakeProductWorker();
    const client = new FriendsGalaxyProductWorkerClient({
      createWorker: () => worker,
      onSourceReady: () => undefined,
      onPresentationReady: () => undefined,
      onFailure: () => undefined,
    });

    expect(requestSource(client, 1)).toBe(1);
    expect(requestSource(client, 2)).toBeNull();
    expect(worker.messages).toHaveLength(1);
    expect(worker.messages[0]).toMatchObject({ sourceRevision: 1 });
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

    requestSource(client);
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

    requestSource(client);
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

    requestSource(client);
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

    requestSource(client, 4);
    expect(client.requestPresentation(presentationInput(1, 3))).toBeNull();
    expect(worker.messages).toHaveLength(1);
  });
});
