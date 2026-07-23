import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import {
  resetFactoryResetStateForTests,
  runFactoryResetOperations,
} from "@freed/ui/lib/factory-reset";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  cacheSet: vi.fn(async () => {}),
  docUpdateFeedItem: vi.fn(async () => {}),
  recordReaderArticleFetchAttempt: vi.fn(),
  fetchFacebookComments: vi.fn(async () => []),
  fetchInstagramComments: vi.fn(async () => []),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./content-cache", () => ({ contentCache: { set: mocks.cacheSet } }));
vi.mock("./automerge", () => ({ docUpdateFeedItem: mocks.docUpdateFeedItem }));
vi.mock("./store", () => ({
  useAppStore: { getState: () => ({ xAuth: { isAuthenticated: false, cookies: null } }) },
}));
vi.mock("./social-comment-hydration", () => ({
  fetchFacebookComments: mocks.fetchFacebookComments,
  fetchInstagramComments: mocks.fetchInstagramComments,
}));
vi.mock("./x-capture", () => ({ fetchXThreadReplies: vi.fn(async () => ({ replies: [] })) }));
vi.mock("./runtime-health-events", () => ({
  recordReaderArticleFetchAttempt: mocks.recordReaderArticleFetchAttempt,
}));

import { hydrateReaderItem } from "./reader-hydration";

function makeItem(url?: string): FeedItem {
  return {
    globalId: "rss:reader-fetch-counter",
    platform: "rss",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: {
      text: "Preview",
      mediaUrls: [],
      mediaTypes: [],
      ...(url ? { linkPreview: { url, title: "Article" } } : {}),
    },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
  };
}

describe("reader hydration request counter", () => {
  beforeEach(() => {
    resetFactoryResetStateForTests();
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(`
      <article>
        <h1>Article</h1>
        <p>A complete article body for the local reader cache.</p>
      </article>
    `);
  });

  it("counts the article request without recording its URL or item ID", async () => {
    await hydrateReaderItem(makeItem("https://example.com/article"), { pin: true });

    expect(mocks.recordReaderArticleFetchAttempt).toHaveBeenCalledWith({
      source: "reader-open",
      pin: true,
    });
    const payload = mocks.recordReaderArticleFetchAttempt.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty("url");
    expect(payload).not.toHaveProperty("globalId");
  });

  it("does not count an article request when there is no article URL", async () => {
    await hydrateReaderItem(makeItem(), { pin: false });

    expect(mocks.invoke).not.toHaveBeenCalledWith("fetch_url", expect.anything());
    expect(mocks.recordReaderArticleFetchAttempt).not.toHaveBeenCalled();
  });

  it("does not repopulate local or document state when reset begins during fetch", async () => {
    let releaseFetch!: (html: string) => void;
    mocks.invoke.mockImplementation(
      () => new Promise<string>((resolve) => {
        releaseFetch = resolve;
      }),
    );
    const clearDocument = vi.fn(async () => {});

    const hydration = hydrateReaderItem(makeItem("https://example.com/slow"), { pin: true });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());

    const reset = runFactoryResetOperations({
      quiesceLocalWriters: [],
      clearDeviceStores: () => [],
      clearLocalSettings: [],
      clearLocalData: [],
      clearProviderDataAndConnections: async () => {},
      clearDocument,
    });
    await Promise.resolve();
    expect(clearDocument).not.toHaveBeenCalled();

    releaseFetch(`
      <article>
        <h1>Article</h1>
        <p>A complete article body for the local reader cache.</p>
      </article>
    `);
    await expect(hydration).rejects.toThrow("Factory reset is in progress");
    await reset;

    expect(mocks.cacheSet).not.toHaveBeenCalled();
    expect(mocks.docUpdateFeedItem).not.toHaveBeenCalled();
    expect(clearDocument).toHaveBeenCalledOnce();
  });

  it("tracks social reply hydration and rejects its stale result after reset", async () => {
    let releaseReplies!: (replies: []) => void;
    mocks.fetchFacebookComments.mockImplementation(
      () => new Promise<[]>((resolve) => {
        releaseReplies = resolve;
      }),
    );
    const item: FeedItem = {
      ...makeItem(),
      globalId: "facebook:reader-thread",
      platform: "facebook",
      contentType: "post",
      sourceUrl: "https://www.facebook.com/posts/123",
    };
    const hydration = hydrateReaderItem(item, { pin: false, includeReplies: true });
    await vi.waitFor(() => expect(mocks.fetchFacebookComments).toHaveBeenCalledOnce());

    const clearDocument = vi.fn(async () => undefined);
    const reset = runFactoryResetOperations({
      quiesceLocalWriters: [],
      clearDeviceStores: () => [],
      clearLocalSettings: [],
      clearLocalData: [],
      clearProviderDataAndConnections: async () => undefined,
      clearDocument,
    });
    await Promise.resolve();
    expect(clearDocument).not.toHaveBeenCalled();

    releaseReplies([]);
    await expect(hydration).rejects.toThrow("Factory reset is in progress");
    await reset;

    expect(clearDocument).toHaveBeenCalledOnce();
  });
});
