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
}));

vi.mock("@freed/sync/storage/indexeddb", () => ({
  IndexedDBStorage: class {
    async load(): Promise<Uint8Array | null> {
      return storageHarness.binary?.slice() ?? null;
    }

    async save(binary: Uint8Array): Promise<void> {
      storageHarness.binary = binary.slice();
    }

    async clear(): Promise<void> {
      storageHarness.binary = null;
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

});
