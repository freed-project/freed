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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerRequest, WorkerResponse } from "./automerge-types";

const storageHarness = vi.hoisted(() => ({
  binary: null as Uint8Array | null,
  failSave: false,
  saveFailureCode: null as string | null,
  saveCount: 0,
  clearCount: 0,
  revision: { generation: 0, saveRevision: 0 },
}));

vi.mock("@freed/sync/storage/indexeddb", () => ({
  IndexedDBStorage: class {
    async load() {
      return {
        data: storageHarness.binary?.slice() ?? null,
        revision: { ...storageHarness.revision },
      };
    }

    async save(
      binary: Uint8Array,
      expectedRevision: { generation: number; saveRevision: number },
    ) {
      if (storageHarness.failSave) {
        throw Object.assign(
          new Error("forced IndexedDB save failure"),
          storageHarness.saveFailureCode
            ? { code: storageHarness.saveFailureCode }
            : {},
        );
      }
      expect(expectedRevision).toEqual(storageHarness.revision);
      storageHarness.binary = binary.slice();
      storageHarness.saveCount += 1;
      storageHarness.revision = {
        generation: storageHarness.revision.generation,
        saveRevision: storageHarness.revision.saveRevision + 1,
      };
      return { ...storageHarness.revision };
    }

    async clear(
      expectedRevision: { generation: number; saveRevision: number },
    ) {
      expect(expectedRevision).toEqual(storageHarness.revision);
      storageHarness.binary = null;
      storageHarness.clearCount += 1;
      storageHarness.revision = {
        generation: storageHarness.revision.generation + 1,
        saveRevision: 0,
      };
      return { ...storageHarness.revision };
    }
  },
}));

interface WorkerScopeHarness {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
}

function makeLegacyDoc(): FreedDoc {
  const item: FeedItem = {
    globalId: "saved:legacy-reader",
    platform: "saved",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: {
      text: "Summary",
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: { url: "https://example.com/article" },
    },
    preservedContent: {
      text: "Preserved summary",
      wordCount: 2,
      readingTime: 1,
      preservedAt: 1,
    },
    userState: { hidden: false, saved: true, archived: false, tags: [] },
    topics: [],
  };

  let doc = A.change(createEmptyDoc(), "Add legacy item", (draft) => {
    addFeedItem(draft, item);
  });
  doc = A.change(doc, "Restore legacy HTML fixture", (draft) => {
    const preservedContent = draft.feedItems[item.globalId].preservedContent;
    if (!preservedContent) throw new Error("Fixture preserved content missing");
    preservedContent.html = "<article>legacy reader copy</article>";
  });
  return doc;
}

async function waitForPost(
  posts: WorkerResponse[],
  predicate: (message: WorkerResponse) => boolean,
): Promise<WorkerResponse> {
  let match: WorkerResponse | undefined;
  await vi.waitFor(() => {
    match = posts.find(predicate);
    expect(match).toBeDefined();
  });
  return match!;
}

describe("PWA Automerge worker legacy reader compatibility", () => {
  let posts: WorkerResponse[];
  let scope: WorkerScopeHarness;

  beforeEach(async () => {
    vi.resetModules();
    storageHarness.binary = A.save(makeLegacyDoc());
    storageHarness.failSave = false;
    storageHarness.saveFailureCode = null;
    storageHarness.saveCount = 0;
    storageHarness.clearCount = 0;
    storageHarness.revision = { generation: 0, saveRevision: 1 };
    posts = [];
    scope = {
      onmessage: null,
      postMessage(message) {
        posts.push(message);
      },
    };
    vi.stubGlobal("self", scope);
    await import("./automerge.worker");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps legacy HTML out of list state and serves it on demand", async () => {
    if (!scope.onmessage) throw new Error("Worker message handler missing");
    scope.onmessage({ data: { reqId: 1, type: "INIT" } } as MessageEvent<WorkerRequest>);

    const stateMessage = await waitForPost(posts, (message) => message.type === "STATE_UPDATE");
    await waitForPost(posts, (message) => message.type === "ACK" && message.reqId === 1);
    if (stateMessage.type !== "STATE_UPDATE") throw new Error("Expected state update");
    expect(stateMessage.state.items[0].preservedContent).not.toHaveProperty("html");

    scope.onmessage({
      data: {
        reqId: 2,
        type: "GET_ITEM_LEGACY_HTML",
        globalId: "saved:legacy-reader",
      },
    } as MessageEvent<WorkerRequest>);
    const htmlMessage = await waitForPost(
      posts,
      (message) => message.type === "ITEM_LEGACY_HTML" && message.reqId === 2,
    );
    expect(htmlMessage).toMatchObject({
      type: "ITEM_LEGACY_HTML",
      html: "<article>legacy reader copy</article>",
    });

    const persisted = A.load<FreedDoc>(storageHarness.binary!);
    expect(persisted.feedItems["saved:legacy-reader"].preservedContent?.html).toBe(
      "<article>legacy reader copy</article>",
    );
  });

  it("reports corrupt bytes without clearing them inside INIT", async () => {
    storageHarness.binary = new Uint8Array([1, 2, 3, 4]);
    if (!scope.onmessage) throw new Error("Worker message handler missing");

    scope.onmessage({ data: { reqId: 30, type: "INIT" } } as MessageEvent<WorkerRequest>);
    const failure = await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 30,
    );

    expect(failure).toMatchObject({
      type: "ACK",
      errorCode: "CORRUPT_DOCUMENT",
    });
    expect(storageHarness.clearCount).toBe(0);
    expect(storageHarness.binary).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("makes a generation permanently nonaccepting when its first INIT cannot persist", async () => {
    storageHarness.binary = null;
    storageHarness.revision = { generation: 0, saveRevision: 0 };
    storageHarness.failSave = true;
    if (!scope.onmessage) throw new Error("Worker message handler missing");

    scope.onmessage({ data: { reqId: 31, type: "INIT" } } as MessageEvent<WorkerRequest>);
    scope.onmessage({
      data: { reqId: 32, type: "MARK_ALL_AS_READ" },
    } as MessageEvent<WorkerRequest>);
    const failure = await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 31,
    );
    const queuedFailure = await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 32,
    );
    scope.onmessage({
      data: { reqId: 33, type: "GET_HEADS" },
    } as MessageEvent<WorkerRequest>);
    const laterFailure = await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 33,
    );

    expect(failure).toMatchObject({
      type: "ACK",
      error: "forced IndexedDB save failure",
      errorCode: "AUTOMERGE_PERSISTENCE_FAILED",
    });
    expect(queuedFailure).toMatchObject({
      type: "ACK",
      error: "forced IndexedDB save failure",
      errorCode: "AUTOMERGE_PERSISTENCE_FAILED",
    });
    expect(laterFailure).toMatchObject({
      type: "ACK",
      error: "forced IndexedDB save failure",
      errorCode: "AUTOMERGE_PERSISTENCE_FAILED",
    });
    expect(storageHarness.clearCount).toBe(0);
    expect(storageHarness.binary).toBeNull();
    expect(posts.some((message) => message.type === "STATE_UPDATE")).toBe(false);
  });

  it("rejects a failed mutation queue without leaking state and a fresh generation reloads durable bytes", async () => {
    if (!scope.onmessage) throw new Error("Worker message handler missing");
    scope.onmessage({ data: { reqId: 40, type: "INIT" } } as MessageEvent<WorkerRequest>);
    await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 40,
    );
    const durableBefore = storageHarness.binary!.slice();
    const revisionBefore = { ...storageHarness.revision };
    const saveCountBefore = storageHarness.saveCount;

    posts.length = 0;
    storageHarness.failSave = true;
    storageHarness.saveFailureCode = "STALE_STORAGE_REVISION";
    scope.onmessage({
      data: { reqId: 41, type: "MARK_ALL_AS_READ" },
    } as MessageEvent<WorkerRequest>);
    scope.onmessage({
      data: {
        reqId: 42,
        type: "TOGGLE_SAVED",
        globalId: "saved:legacy-reader",
      },
    } as MessageEvent<WorkerRequest>);

    for (const reqId of [41, 42]) {
      const failure = await waitForPost(
        posts,
        (message) => message.type === "ACK" && message.reqId === reqId,
      );
      expect(failure).toMatchObject({
        type: "ACK",
        errorCode: "STALE_DOCUMENT_REVISION",
      });
    }
    expect(
      posts.some((message) => message.type === "STATE_UPDATE"),
    ).toBe(false);
    expect(storageHarness.binary).toEqual(durableBefore);
    expect(storageHarness.revision).toEqual(revisionBefore);
    expect(storageHarness.saveCount).toBe(saveCountBefore);

    storageHarness.failSave = false;
    vi.resetModules();
    posts = [];
    scope = {
      onmessage: null,
      postMessage(message) {
        posts.push(message);
      },
    };
    vi.stubGlobal("self", scope);
    await import("./automerge.worker");
    if (!scope.onmessage) throw new Error("Replacement worker handler missing");
    scope.onmessage({ data: { reqId: 43, type: "INIT" } } as MessageEvent<WorkerRequest>);
    const reloaded = await waitForPost(
      posts,
      (message) => message.type === "STATE_UPDATE",
    );
    await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 43,
    );
    if (reloaded.type !== "STATE_UPDATE") {
      throw new Error("Expected replacement state update");
    }
    expect(reloaded.state.items[0].userState.readAt).toBeUndefined();
    expect(reloaded.state.items[0].userState.saved).toBe(true);
  });

  it("persists an empty INIT once and returns defensive committed snapshots", async () => {
    storageHarness.binary = null;
    storageHarness.revision = { generation: 0, saveRevision: 0 };
    vi.resetModules();
    posts = [];
    scope = {
      onmessage: null,
      postMessage(message) {
        posts.push(message);
      },
    };
    vi.stubGlobal("self", scope);
    await import("./automerge.worker");
    if (!scope.onmessage) throw new Error("Worker message handler missing");

    scope.onmessage({ data: { reqId: 50, type: "INIT" } } as MessageEvent<WorkerRequest>);
    await waitForPost(
      posts,
      (message) => message.type === "ACK" && message.reqId === 50,
    );
    expect(storageHarness.saveCount).toBe(1);
    expect(storageHarness.revision).toEqual({
      generation: 0,
      saveRevision: 1,
    });

    scope.onmessage({
      data: { reqId: 51, type: "GET_COMMITTED_DOC" },
    } as MessageEvent<WorkerRequest>);
    const first = await waitForPost(
      posts,
      (message) => message.type === "COMMITTED_DOC" && message.reqId === 51,
    );
    if (first.type !== "COMMITTED_DOC") {
      throw new Error("Expected committed document");
    }
    const expectedBinary = first.binary.slice();
    const expectedHeads = [...first.heads];
    first.binary.fill(255);
    first.heads.push("forged-head");
    first.revision.saveRevision = 999;

    scope.onmessage({
      data: { reqId: 52, type: "GET_COMMITTED_DOC" },
    } as MessageEvent<WorkerRequest>);
    const second = await waitForPost(
      posts,
      (message) => message.type === "COMMITTED_DOC" && message.reqId === 52,
    );
    expect(second).toMatchObject({
      type: "COMMITTED_DOC",
      heads: expectedHeads,
      revision: { generation: 0, saveRevision: 1 },
    });
    if (second.type !== "COMMITTED_DOC") {
      throw new Error("Expected committed document");
    }
    expect(second.binary).toEqual(expectedBinary);
  });

  it("keeps local RSS and preferences without resurrecting a deleted feed item", async () => {
    let base = A.change(makeLegacyDoc(), "Seed shared future root", (draft) => {
      const root = draft as unknown as Record<string, unknown>;
      root.futureLibraryState = {
        localValue: 0,
        incomingValue: 0,
      };
      root.futureRemovedState = { values: ["restore", "me"] };
    });
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
      delete draft.feedItems["saved:legacy-reader"];
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

    if (!scope.onmessage) throw new Error("Worker message handler missing");
    scope.onmessage({ data: { reqId: 10, type: "INIT" } } as MessageEvent<WorkerRequest>);
    await waitForPost(posts, (message) => message.type === "ACK" && message.reqId === 10);
    scope.onmessage({
      data: {
        reqId: 11,
        type: "MERGE_DOC",
        binary: A.save(staleEmpty),
      },
    } as MessageEvent<WorkerRequest>);
    await waitForPost(
      posts,
      (message) => message.type === "STATE_UPDATE" && message.mutation === "MERGE_DOC",
    );
    await waitForPost(posts, (message) => message.type === "ACK" && message.reqId === 11);

    const persisted = A.load<FreedDoc>(storageHarness.binary!);
    expect(persisted.feedItems["saved:legacy-reader"]).toBeUndefined();
    expect(
      (A.toJS(persisted) as unknown as Record<string, unknown>).futureLibraryState,
    ).toEqual({ localValue: 1, incomingValue: 1 });
    expect(
      (A.toJS(persisted) as unknown as Record<string, unknown>).futureRemovedState,
    ).toBeUndefined();
    expect(persisted.rssFeeds["https://local.example/feed.xml"]?.title).toBe("Local only");
    expect(persisted.preferences.display.themeId).toBe("midas");
    expect(persisted.preferences.display.showEngagementCounts).toBe(true);
    expect(persisted.preferences.weights.recency).toBe(73);
    expect(getRegisteredDesktopClientIds(persisted)).toEqual([]);

    scope.onmessage({
      data: {
        reqId: 12,
        type: "COMPARE_DOC",
        binary: A.save(persisted),
      },
    } as MessageEvent<WorkerRequest>);
    await waitForPost(
      posts,
      (message) =>
        message.type === "DOC_RELATIONSHIP" &&
        message.reqId === 12 &&
        message.relation === "equal",
    );

    const incomingAhead = A.change(A.clone(persisted), "Add incoming change", (draft) => {
      draft.preferences.weights.recency = 74;
    });
    scope.onmessage({
      data: {
        reqId: 13,
        type: "COMPARE_DOC",
        binary: A.save(incomingAhead),
      },
    } as MessageEvent<WorkerRequest>);
    await waitForPost(
      posts,
      (message) =>
        message.type === "DOC_RELATIONSHIP" &&
        message.reqId === 13 &&
        message.relation === "incoming-ahead",
    );
  });

  it("tags explicit graph removals with their mutation provenance", async () => {
    if (!scope.onmessage) throw new Error("Worker message handler missing");
    scope.onmessage({ data: { reqId: 20, type: "INIT" } } as MessageEvent<WorkerRequest>);
    await waitForPost(posts, (message) => message.type === "ACK" && message.reqId === 20);

    scope.onmessage({
      data: { reqId: 21, type: "REMOVE_PERSON", personId: "missing-person" },
    } as MessageEvent<WorkerRequest>);
    await waitForPost(
      posts,
      (message) => message.type === "STATE_UPDATE" && message.mutation === "REMOVE_PERSON",
    );
    await waitForPost(posts, (message) => message.type === "ACK" && message.reqId === 21);

    scope.onmessage({
      data: { reqId: 22, type: "REMOVE_ACCOUNT", accountId: "missing-account" },
    } as MessageEvent<WorkerRequest>);
    await waitForPost(
      posts,
      (message) => message.type === "STATE_UPDATE" && message.mutation === "REMOVE_ACCOUNT",
    );
    await waitForPost(posts, (message) => message.type === "ACK" && message.reqId === 22);
  });

});
