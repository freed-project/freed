import * as A from "@automerge/automerge";
import {
  addFeedItem,
  addRssFeed,
  createEmptyDoc,
  getRegisteredDesktopClientIds,
  registerDesktopClient,
  type FreedDoc,
} from "@freed/shared/schema";
import type { FeedItem } from "@freed/shared";
import {
  afterEach,
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

function createSmallCompatibilityDoc(legacyHtml?: string): FreedDoc {
  const item: FeedItem = {
    globalId: "saved:worker-compatibility",
    platform: "saved",
    contentType: "article",
    capturedAt: 1_000,
    publishedAt: 1_000,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: {
      text: "Worker compatibility fixture",
      mediaUrls: [],
      mediaTypes: [],
    },
    preservedContent: {
      text: "Preserved text",
      wordCount: 2,
      readingTime: 1,
      preservedAt: 1_000,
    },
    userState: { hidden: false, saved: true, archived: false, tags: [] },
    topics: [],
  };
  let doc = A.change(createEmptyDoc(), "Add compatibility item", (draft) => {
    addFeedItem(draft, item);
  });
  if (legacyHtml) {
    doc = A.change(doc, "Restore compatibility HTML", (draft) => {
      const preservedContent = draft.feedItems[item.globalId].preservedContent;
      if (!preservedContent) throw new Error("Compatibility fixture is missing preserved content");
      preservedContent.html = legacyHtml;
    });
  }
  return doc;
}

describe("real Automerge worker module", () => {
  let posts: CapturedWorkerPost[];
  let scope: WorkerScopeHarness;

  beforeEach(async () => {
    vi.resetModules();
    posts = [];
    scope = createWorkerScope(posts);
    storageHarness.binary = A.save(createSmallCompatibilityDoc());
    storageHarness.saveBytes = [];
    storageHarness.clearCount = 0;
    vi.stubGlobal("self", scope);
    await import("./automerge.worker");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a representative document, releases it, reloads once, and characterizes binary transport", async () => {
    const fixture: LargeAutomergeFixture = createLargeAutomergeFixture();
    storageHarness.binary = fixture.binary.slice();

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

  it("makes replacement authoritative while re-registering the current Desktop", async () => {
    const currentRegistration = { id: "desktop-current", registeredAt: 1_000 };
    let previous = registerDesktopClient(
      createSmallCompatibilityDoc(),
      { id: "desktop-previous", registeredAt: 500 },
    );
    previous = A.change(previous, "Add future root", (draft) => {
      (draft as unknown as Record<string, unknown>).futureLibraryState = {
        shouldStayDeleted: true,
      };
    });
    storageHarness.binary = A.save(previous);
    sendRequest(scope, {
      reqId: 101,
      type: "INIT",
      desktopClientRegistration: currentRegistration,
    });
    await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 101,
    );
    await waitForPost(
      posts,
      (message) =>
        message.type === "DEBUG_EVENT" &&
        message.detail?.startsWith("[automerge-worker] released idle document") === true,
    );

    const legacyItemId = "saved:worker-compatibility";
    let replacement = registerDesktopClient(
      createSmallCompatibilityDoc("<article>legacy reader copy</article>"),
      { id: "desktop-snapshot", registeredAt: 2_000 },
    );

    const replaceStart = posts.length;
    sendRequest(scope, {
      reqId: 102,
      type: "REPLACE_DOC",
      binary: A.save(replacement),
      desktopClientRegistration: currentRegistration,
    });
    const statePost = await waitForPost(
      posts,
      (message) => message.type === "STATE_UPDATE",
      replaceStart,
    );
    await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 102,
      replaceStart,
    );
    if (statePost.message.type !== "STATE_UPDATE") {
      throw new Error("Expected replacement state");
    }
    expect(statePost.message.state.desktopClientIds).toEqual([
      "desktop-current",
      "desktop-snapshot",
    ]);
    expect(
      statePost.message.state.items.find((item) => item.globalId === legacyItemId)
        ?.preservedContent,
    ).not.toHaveProperty("html");

    const htmlStart = posts.length;
    sendRequest(scope, {
      reqId: 103,
      type: "GET_ITEM_LEGACY_HTML",
      globalId: legacyItemId,
    });
    const htmlPost = await waitForPost(
      posts,
      (message) => message.type === "ITEM_LEGACY_HTML" && message.reqId === 103,
      htmlStart,
    );
    expect(htmlPost.message).toMatchObject({
      type: "ITEM_LEGACY_HTML",
      html: "<article>legacy reader copy</article>",
    });

    const saved = A.load<FreedDoc>(storageHarness.binary!);
    expect(getRegisteredDesktopClientIds(saved)).toEqual([
      "desktop-current",
      "desktop-snapshot",
    ]);
    expect(
      (A.toJS(saved) as unknown as Record<string, unknown>).futureLibraryState,
    ).toBeUndefined();
    expect(saved.feedItems[legacyItemId].preservedContent?.html).toBe(
      "<article>legacy reader copy</article>",
    );
  }, 30_000);

  it("keeps local RSS and preferences without resurrecting a deleted feed item", async () => {
    let base = A.change(
      createSmallCompatibilityDoc(),
      "Seed shared future root",
      (draft) => {
        const root = draft as unknown as Record<string, unknown>;
        root.futureLibraryState = {
          localValue: 0,
          incomingValue: 0,
        };
        root.futureRemovedState = { values: ["restore", "me"] };
      },
    );
    base = registerDesktopClient(base, {
      id: "desktop-shared",
      registeredAt: 1_000,
    });
    const populated = A.change(A.clone(base), "Update future root locally", (draft) => {
      const future = (draft as unknown as Record<string, unknown>)
        .futureLibraryState as Record<string, number>;
      future.localValue = 1;
    });
    const staleEmpty = A.change(A.clone(base), "Delete feed and update future root", (draft) => {
      for (const id of Object.keys(draft.feedItems)) delete draft.feedItems[id];
      addRssFeed(draft, {
        url: "https://local.example/feed.xml",
        title: "Local only",
        enabled: true,
        trackUnread: false,
      });
      draft.preferences.display.themeId = "midas";
      draft.preferences.display.showEngagementCounts = true;
      draft.preferences.weights.recency = 73;
      const root = draft as unknown as Record<string, unknown>;
      delete root.futureRemovedState;
      delete root["desktopClient:desktop-shared"];
      const future = root.futureLibraryState as Record<string, number>;
      future.incomingValue = 1;
    });
    base = populated;
    storageHarness.binary = A.save(base);

    sendRequest(scope, { reqId: 301, type: "INIT" });
    await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 301,
    );

    const mergeStart = posts.length;
    sendRequest(scope, {
      reqId: 302,
      type: "MERGE_DOC",
      binary: A.save(staleEmpty),
    });
    await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 302,
      mergeStart,
    );

    const saved = A.load<FreedDoc>(storageHarness.binary!);
    expect(Object.keys(saved.feedItems)).toHaveLength(0);
    expect(
      (A.toJS(saved) as unknown as Record<string, unknown>).futureLibraryState,
    ).toEqual({ localValue: 1, incomingValue: 1 });
    expect(
      (A.toJS(saved) as unknown as Record<string, unknown>).futureRemovedState,
    ).toBeUndefined();
    expect(saved.rssFeeds["https://local.example/feed.xml"]?.title).toBe("Local only");
    expect(saved.preferences.display.themeId).toBe("midas");
    expect(saved.preferences.display.showEngagementCounts).toBe(true);
    expect(saved.preferences.weights.recency).toBe(73);
    expect(getRegisteredDesktopClientIds(saved)).toEqual([]);

    const compareStart = posts.length;
    sendRequest(scope, {
      reqId: 303,
      type: "COMPARE_DOC",
      binary: A.save(saved),
    });
    await waitForPost(
      posts,
      (message) =>
        message.type === "DOC_RELATIONSHIP" &&
        message.reqId === 303 &&
        message.relation === "equal",
      compareStart,
    );

    const incomingAhead = A.change(A.clone(saved), "Add incoming change", (draft) => {
      draft.preferences.weights.recency = 74;
    });
    sendRequest(scope, {
      reqId: 304,
      type: "COMPARE_DOC",
      binary: A.save(incomingAhead),
    });
    await waitForPost(
      posts,
      (message) =>
        message.type === "DOC_RELATIONSHIP" &&
        message.reqId === 304 &&
        message.relation === "incoming-ahead",
      compareStart,
    );
  }, 30_000);

  it("strips device-local fields from new preference update patches", async () => {
    sendRequest(scope, { reqId: 201, type: "INIT" });
    await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 201,
    );

    const updateStart = posts.length;
    sendRequest(scope, {
      reqId: 202,
      type: "UPDATE_PREFERENCES",
      updates: {
        display: {
          sidebarMode: "closed",
          themeId: "midas",
        },
      } as never,
    });
    const patchPost = await waitForPost(
      posts,
      (message) => message.type === "PREFERENCES_PATCH",
      updateStart,
    );
    await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 202,
      updateStart,
    );
    if (patchPost.message.type !== "PREFERENCES_PATCH") {
      throw new Error("Expected preference patch");
    }
    expect(patchPost.message.updates).toEqual({
      display: { themeId: "midas" },
    });

    const saved = A.load<FreedDoc>(storageHarness.binary!);
    expect(saved.preferences.display.themeId).toBe("midas");
    expect(saved.preferences.display.sidebarMode).toBeUndefined();
  }, 30_000);
});
