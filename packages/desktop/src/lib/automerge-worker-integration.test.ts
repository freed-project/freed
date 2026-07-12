import * as A from "@automerge/automerge";
import type { FreedDoc } from "@freed/shared/schema";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { WorkerRequest, WorkerResponse } from "./automerge-types";
import {
  createLargeAutomergeFixture,
  type LargeAutomergeFixture,
} from "./__fixtures__/large-automerge-doc";

const storageHarness = vi.hoisted(() => ({
  binary: null as Uint8Array | null,
  saveBytes: [] as number[],
  clearCount: 0,
}));

vi.mock("@freed/sync/storage/indexeddb", () => ({
  IndexedDBStorage: class {
    async load(): Promise<Uint8Array | null> {
      return storageHarness.binary?.slice() ?? null;
    }

    async save(binary: Uint8Array): Promise<void> {
      storageHarness.binary = binary.slice();
      storageHarness.saveBytes.push(binary.byteLength);
    }

    async clear(): Promise<void> {
      storageHarness.binary = null;
      storageHarness.clearCount += 1;
    }
  },
}));

interface CapturedWorkerPost {
  message: WorkerResponse;
  transferCount: number;
  transferBytes: number;
}

interface WorkerScopeHarness {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (
    message: WorkerResponse,
    transferOrOptions?: Transferable[] | StructuredSerializeOptions,
  ) => void;
}

function transferList(
  transferOrOptions?: Transferable[] | StructuredSerializeOptions,
): Transferable[] {
  if (Array.isArray(transferOrOptions)) return transferOrOptions;
  return transferOrOptions?.transfer ?? [];
}

function transferByteLength(value: Transferable): number {
  if (value instanceof ArrayBuffer) return value.byteLength;
  return 0;
}

function createWorkerScope(posts: CapturedWorkerPost[]): WorkerScopeHarness {
  return {
    onmessage: null,
    postMessage(message, transferOrOptions) {
      const transfers = transferList(transferOrOptions);
      posts.push({
        message,
        transferCount: transfers.length,
        transferBytes: transfers.reduce<number>(
          (total, transfer) => total + transferByteLength(transfer),
          0,
        ),
      });
    },
  };
}

function sendRequest(scope: WorkerScopeHarness, request: WorkerRequest): void {
  if (!scope.onmessage)
    throw new Error("Worker message handler is not installed");
  scope.onmessage({ data: request } as MessageEvent<WorkerRequest>);
}

async function waitForPost(
  posts: CapturedWorkerPost[],
  predicate: (message: WorkerResponse) => boolean,
  startIndex = 0,
): Promise<CapturedWorkerPost> {
  let match: CapturedWorkerPost | undefined;
  await vi.waitFor(
    () => {
      match = posts.slice(startIndex).find(({ message }) => predicate(message));
      expect(match).toBeDefined();
    },
    { timeout: 30_000, interval: 10 },
  );
  return match!;
}

function debugDetails(posts: CapturedWorkerPost[]): string[] {
  return posts.flatMap(({ message }) =>
    message.type === "DEBUG_EVENT" && message.detail ? [message.detail] : [],
  );
}

describe("real Automerge worker module", () => {
  let fixture: LargeAutomergeFixture;
  let posts: CapturedWorkerPost[];
  let scope: WorkerScopeHarness;

  beforeAll(() => {
    fixture = createLargeAutomergeFixture();
  }, 60_000);

  beforeEach(async () => {
    vi.resetModules();
    posts = [];
    scope = createWorkerScope(posts);
    storageHarness.binary = fixture.binary.slice();
    storageHarness.saveBytes = [];
    storageHarness.clearCount = 0;
    vi.stubGlobal("self", scope);
    await import("./automerge.worker");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a representative document, releases it, reloads once, and characterizes binary transport", async () => {
    expect(fixture.manifest.binaryBytes).toBeGreaterThanOrEqual(
      fixture.manifest.targetBytes,
    );
    expect(fixture.manifest.binaryBytes).toBeLessThan(8 * 1024 * 1024);
    expect(fixture.manifest.historyDepth).toBeGreaterThanOrEqual(64);
    expect(posts.map(({ message }) => message.type)).toEqual(["READY"]);

    sendRequest(scope, { reqId: 1, type: "INIT" });
    const initStatsPost = await waitForPost(
      posts,
      (message) => message.type === "INIT_STATS",
    );
    await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 1,
    );
    await waitForPost(
      posts,
      (message) =>
        message.type === "DEBUG_EVENT" &&
        message.detail?.startsWith(
          "[automerge-worker] released idle document",
        ) === true,
    );

    expect(initStatsPost.message).toMatchObject({
      type: "INIT_STATS",
      docBytes: fixture.manifest.binaryBytes,
    });
    expect(
      posts.filter(({ message }) => message.type === "STATE_UPDATE"),
    ).toHaveLength(1);
    expect(storageHarness.saveBytes).toEqual([]);
    expect(storageHarness.clearCount).toBe(0);

    const reloadCountBeforeHeads = debugDetails(posts).filter((detail) =>
      detail.startsWith("[automerge-worker] reloaded idle document"),
    ).length;
    const headsStart = posts.length;
    sendRequest(scope, { reqId: 2, type: "GET_HEADS" });
    const headsPost = await waitForPost(
      posts,
      (message) => message.type === "DOC_HEADS" && message.reqId === 2,
      headsStart,
    );
    expect(headsPost.message).toMatchObject({ type: "DOC_HEADS" });
    expect(
      debugDetails(posts).filter((detail) =>
        detail.startsWith("[automerge-worker] reloaded idle document"),
      ),
    ).toHaveLength(reloadCountBeforeHeads);

    const preservedStart = posts.length;
    sendRequest(scope, {
      reqId: 3,
      type: "GET_ITEM_PRESERVED_TEXT",
      globalId: fixture.manifest.expectedItemIds[1],
    });
    const preservedPost = await waitForPost(
      posts,
      (message) =>
        message.type === "ITEM_PRESERVED_TEXT" && message.reqId === 3,
      preservedStart,
    );
    expect(preservedPost.message).toMatchObject({
      type: "ITEM_PRESERVED_TEXT",
      globalId: fixture.manifest.expectedItemIds[1],
    });
    if (preservedPost.message.type !== "ITEM_PRESERVED_TEXT") {
      throw new Error("Expected preserved text response");
    }
    expect(preservedPost.message.text).toHaveLength(
      fixture.manifest.preservedTextBytes,
    );
    expect(
      debugDetails(posts).filter((detail) =>
        detail.startsWith("[automerge-worker] reloaded idle document"),
      ),
    ).toHaveLength(reloadCountBeforeHeads + 1);

    const binaryStart = posts.length;
    sendRequest(scope, { reqId: 4, type: "GET_DOC_BINARY" });
    const binaryPost = await waitForPost(
      posts,
      (message) => message.type === "DOC_BINARY" && message.reqId === 4,
      binaryStart,
    );
    if (binaryPost.message.type !== "DOC_BINARY") {
      throw new Error("Expected document binary response");
    }
    expect(binaryPost.message.binary).toBeInstanceOf(Uint8Array);
    expect(binaryPost.message.binary.byteLength).toBe(
      fixture.manifest.binaryBytes,
    );

    sendRequest(scope, {
      reqId: 5,
      type: "UPDATE_RELAY_CLIENT_COUNT",
      count: 1,
    });
    const mutationStart = posts.length;
    sendRequest(scope, {
      reqId: 6,
      type: "MARK_AS_READ",
      globalId: fixture.manifest.mutationTargetId,
    });
    await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 6,
      mutationStart,
    );
    const relayPost = await waitForPost(
      posts,
      (message) => message.type === "BROADCAST_REQUEST",
      mutationStart,
    );
    if (relayPost.message.type !== "BROADCAST_REQUEST") {
      throw new Error("Expected relay broadcast response");
    }

    expect({
      docBinaryPayload: binaryPost.message.binary.constructor.name,
      docBinaryTransferCount: binaryPost.transferCount,
      docBinaryTransferBytes: binaryPost.transferBytes,
      relayPayload: Array.isArray(relayPost.message.data)
        ? "number[]"
        : typeof relayPost.message.data,
      relayTransferCount: relayPost.transferCount,
      relayTransferBytes: relayPost.transferBytes,
      relayPayloadMatchesPersistedBinary:
        storageHarness.binary !== null &&
        Buffer.from(relayPost.message.data).equals(
          Buffer.from(storageHarness.binary),
        ),
    }).toEqual({
      docBinaryPayload: "Uint8Array",
      docBinaryTransferCount: 0,
      docBinaryTransferBytes: 0,
      relayPayload: "number[]",
      relayTransferCount: 0,
      relayTransferBytes: 0,
      relayPayloadMatchesPersistedBinary: true,
    });

    const persistedBinary = storageHarness.binary;
    expect(persistedBinary).not.toBeNull();
    const persistedDoc = A.load<FreedDoc>(persistedBinary!);
    expect(
      persistedDoc.feedItems[fixture.manifest.mutationTargetId]?.userState
        .readAt,
    ).toBeTypeOf("number");
  }, 90_000);

  it("generates deterministic fixture bytes for the same bounded profile", () => {
    const options = {
      targetBytes: 128 * 1024,
      minimumHistoryDepth: 8,
      batchSize: 24,
      maxItems: 256,
      seed: 42,
    };
    const first = createLargeAutomergeFixture(options);
    const second = createLargeAutomergeFixture(options);

    expect(first.manifest).toEqual(second.manifest);
    expect(Buffer.from(first.binary).equals(Buffer.from(second.binary))).toBe(
      true,
    );
  });
});
