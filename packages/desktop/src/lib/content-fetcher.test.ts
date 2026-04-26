import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import { MAX_SYNCED_PRESERVED_TEXT_CHARS } from "./preserved-text.js";

const SAMPLE_URL = "https://example.com/articles/memory-landfill";
const SAMPLE_HTML = "<html><body><article><p>Expanded article HTML.</p></article></body></html>";
const SAMPLE_ARTICLE_HTML = "<article><p>Expanded article HTML.</p></article>";
const LONG_TEXT =
  `${"Paragraph with   noisy spacing and plenty of detail. ".repeat(160)}Tail text that should be trimmed away.`;

function makeStubItem(): FeedItem {
  return {
    globalId: "rss:1",
    platform: "rss",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: {
      id: "author-1",
      handle: "author",
      displayName: "Author",
    },
    content: {
      text: "Short description",
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: {
        url: SAMPLE_URL,
        title: "Article title",
        description: "Short description",
      },
    },
    rssSource: {
      feedUrl: "https://example.com/feed.xml",
      feedTitle: "Example Feed",
      siteUrl: "https://example.com",
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
  };
}

function makeTextPostItem(): FeedItem {
  return {
    ...makeStubItem(),
    globalId: "x:post-1",
    platform: "x",
    contentType: "post",
    author: {
      id: "space-x",
      handle: "SpaceX",
      displayName: "SpaceX",
    },
    content: {
      text: "Deployment confirmed.\n\nLonger context should remain readable inside Freed.",
      mediaUrls: ["https://pbs.twimg.com/media/rocket.jpg"],
      mediaTypes: ["image"],
    },
    sourceUrl: "https://x.com/SpaceX/status/1",
  };
}

async function loadContentFetcherModule() {
  vi.resetModules();

  const mockInvoke = vi.fn(async () => SAMPLE_HTML);
  const mockExtractContent = vi.fn(() => ({
    html: SAMPLE_ARTICLE_HTML,
    text: LONG_TEXT,
    author: "Content Author",
    wordCount: 900,
    readingTime: 4,
  }));
  const mockExtractMetadata = vi.fn(() => ({
    author: "Metadata Author",
    publishedAt: 1_700_000_000_000,
  }));
  const mockCacheSet = vi.fn(async () => undefined);
  const mockDocUpdateFeedItem = vi.fn(async () => undefined);
  const mockSubscribe = vi.fn<(cb: (state: { items: FeedItem[]; docItemCount: number }) => void) => () => void>();
  const subscriberRef: {
    current: ((state: { items: FeedItem[]; docItemCount: number }) => void) | null;
  } = { current: null };
  mockSubscribe.mockImplementation((cb) => {
    subscriberRef.current = cb;
    return () => {
      subscriberRef.current = null;
    };
  });

  vi.doMock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
  vi.doMock("@freed/capture-save/browser", () => ({
    extractContentBrowser: mockExtractContent,
    extractMetadataBrowser: mockExtractMetadata,
  }));
  vi.doMock("./content-cache.js", () => ({
    contentCache: { set: mockCacheSet },
  }));
  vi.doMock("./automerge.js", () => ({
    docUpdateFeedItem: mockDocUpdateFeedItem,
    subscribe: mockSubscribe,
  }));
  vi.doMock("./store.js", () => ({
    useAppStore: {
      getState: () => ({
        preferences: {
          ai: {
            autoSummarize: false,
            extractTopics: false,
            provider: "none",
          },
        },
      }),
    },
  }));
  vi.doMock("./ai-summarizer.js", () => ({
    summarize: vi.fn(async () => null),
  }));
  vi.doMock("./secure-storage.js", () => ({
    secureStorage: {
      getApiKey: vi.fn(async () => null),
    },
  }));
  vi.doMock("@freed/ui/lib/debug-store", () => ({
    addDebugEvent: vi.fn(),
  }));
  vi.doMock("./logger.js", () => ({
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

  const mod = await import("./content-fetcher.js");
  return {
    mod,
    subscriberRef,
    mockCacheSet,
    mockDocUpdateFeedItem,
  };
}

async function loadContentFetcherModuleWithAi({
  autoSummarize,
  extractTopics,
}: {
  autoSummarize: boolean;
  extractTopics: boolean;
}) {
  vi.resetModules();

  const mockInvoke = vi.fn(async () => SAMPLE_HTML);
  const mockExtractContent = vi.fn(() => ({
    html: SAMPLE_ARTICLE_HTML,
    text: LONG_TEXT,
    author: "Content Author",
    wordCount: 900,
    readingTime: 4,
  }));
  const mockExtractMetadata = vi.fn(() => ({
    author: "Metadata Author",
    publishedAt: 1_700_000_000_000,
  }));
  const mockCacheSet = vi.fn(async () => undefined);
  const mockDocUpdateFeedItem = vi.fn(async () => undefined);
  const mockSubscribe = vi.fn<(cb: (state: { items: FeedItem[]; docItemCount: number }) => void) => () => void>();
  const subscriberRef: {
    current: ((state: { items: FeedItem[]; docItemCount: number }) => void) | null;
  } = { current: null };
  mockSubscribe.mockImplementation((cb) => {
    subscriberRef.current = cb;
    return () => {
      subscriberRef.current = null;
    };
  });
  const mockSummarize = vi.fn(async () => ({
    summary: "Short AI summary",
    topics: ["ai", "reading"],
    sentiment: "neutral" as const,
  }));

  vi.doMock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
  vi.doMock("@freed/capture-save/browser", () => ({
    extractContentBrowser: mockExtractContent,
    extractMetadataBrowser: mockExtractMetadata,
  }));
  vi.doMock("./content-cache.js", () => ({
    contentCache: { set: mockCacheSet },
  }));
  vi.doMock("./automerge.js", () => ({
    docUpdateFeedItem: mockDocUpdateFeedItem,
    subscribe: mockSubscribe,
  }));
  vi.doMock("./store.js", () => ({
    useAppStore: {
      getState: () => ({
        preferences: {
          ai: {
            autoSummarize,
            extractTopics,
            provider: "openai",
            model: "gpt-4o-mini",
          },
        },
      }),
    },
  }));
  vi.doMock("./ai-summarizer.js", () => ({
    summarize: mockSummarize,
  }));
  vi.doMock("./secure-storage.js", () => ({
    secureStorage: {
      getApiKey: vi.fn(async () => "test-key"),
    },
  }));
  vi.doMock("@freed/ui/lib/debug-store", () => ({
    addDebugEvent: vi.fn(),
  }));
  vi.doMock("./logger.js", () => ({
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

  const mod = await import("./content-fetcher.js");
  return {
    mod,
    subscriberRef,
    mockDocUpdateFeedItem,
    mockSummarize,
  };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("content fetcher", () => {
  it("keeps full HTML in the local cache but syncs only a compact excerpt", async () => {
    vi.useFakeTimers();
    const { mod, subscriberRef, mockCacheSet, mockDocUpdateFeedItem } = await loadContentFetcherModule();

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(2_000);
    mod.stop();

    expect(mockCacheSet).toHaveBeenCalledWith("rss:1", SAMPLE_ARTICLE_HTML);
    expect(mockDocUpdateFeedItem).toHaveBeenCalledOnce();

    const update = mockDocUpdateFeedItem.mock.calls.at(0)?.at(1) as unknown as
      | { preservedContent: { text: string; author?: string } }
      | undefined;
    expect(update).toBeDefined();
    const preservedContent = update!.preservedContent;
    expect(preservedContent.text.length).toBeLessThanOrEqual(MAX_SYNCED_PRESERVED_TEXT_CHARS);
    expect(preservedContent.text).not.toContain("  ");
    expect(preservedContent.text).not.toContain("Tail text that should be trimmed away.");
    expect(preservedContent.author).toBe("Content Author");
  });

  it("does not write topics when extractTopics is disabled", async () => {
    vi.useFakeTimers();
    const { mod, subscriberRef, mockDocUpdateFeedItem } = await loadContentFetcherModuleWithAi({
      autoSummarize: true,
      extractTopics: false,
    });

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(2_000);
    mod.stop();

    const update = mockDocUpdateFeedItem.mock.calls.at(0)?.at(1) as
      | { topics?: string[]; preservedContent: { text: string } }
      | undefined;
    expect(update?.preservedContent.text).toContain("Short AI summary");
    expect(update?.topics).toBeUndefined();
  });

  it("writes topics when extractTopics is enabled", async () => {
    vi.useFakeTimers();
    const { mod, subscriberRef, mockDocUpdateFeedItem } = await loadContentFetcherModuleWithAi({
      autoSummarize: true,
      extractTopics: true,
    });

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(2_000);
    mod.stop();

    const update = mockDocUpdateFeedItem.mock.calls.at(0)?.at(1) as
      | { topics?: string[]; preservedContent: { text: string } }
      | undefined;
    expect(update?.preservedContent.text).toContain("Short AI summary");
    expect(update?.topics).toEqual(["ai", "reading"]);
  });

  it("pins existing text posts by writing reader HTML to the local cache", async () => {
    const { mod, mockCacheSet } = await loadContentFetcherModule();

    await mod.pinReaderItem(makeTextPostItem());

    expect(mockCacheSet).toHaveBeenCalledWith(
      "x:post-1",
      expect.stringContaining("Deployment confirmed."),
    );
    const cacheCalls = mockCacheSet.mock.calls as unknown as Array<[string, string]>;
    const cachedHtml = cacheCalls[0]?.[1];
    expect(cachedHtml).toContain("rocket.jpg");
    expect(cachedHtml).toContain("Longer context should remain readable inside Freed.");
  });

  it("puts saved URL items in the high-priority cache queue even when they have synced text", async () => {
    const { mod, mockCacheSet } = await loadContentFetcherModule();
    const statuses: Array<{ pending: number }> = [];
    const unsubscribe = mod.subscribeToStatus((status: { pending: number }) => {
      statuses.push(status);
    });

    await mod.pinReaderItem({
      ...makeStubItem(),
      preservedContent: {
        text: "Synced preview",
        wordCount: 2,
        readingTime: 1,
        preservedAt: 1,
      },
    });
    unsubscribe();

    expect(mockCacheSet).toHaveBeenCalledWith("rss:1", expect.stringContaining("Article title"));
    expect(statuses.at(-1)?.pending).toBe(1);
  });
});
