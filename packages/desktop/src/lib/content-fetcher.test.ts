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
});
