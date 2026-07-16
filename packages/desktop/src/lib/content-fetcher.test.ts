import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import { MAX_SYNCED_PRESERVED_TEXT_CHARS } from "./preserved-text.js";

const SAMPLE_URL = "https://example.com/articles/memory-landfill";
const SAMPLE_HTML = "<html><body><article><p>Expanded article HTML.</p></article></body></html>";
const SAMPLE_ARTICLE_HTML = "<article><p>Expanded article HTML.</p></article>";
const LONG_TEXT =
  `${"Paragraph with   noisy spacing and plenty of detail. ".repeat(160)}Tail text that should be trimmed away.`;

function makeStubItem(globalId = "rss:1"): FeedItem {
  return {
    globalId,
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

async function loadContentFetcherModule(options: {
  cacheSetImpl?: () => Promise<void>;
  isFactoryResetInProgress?: () => boolean;
} = {}) {
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
  const mockCacheSet = vi.fn(options.cacheSetImpl ?? (async () => undefined));
  const mockDocUpdateFeedItem = vi.fn(async () => undefined);
  const mockRecordReaderArticleFetchAttempt = vi.fn();
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
  vi.doMock("@freed/ui/lib/device-ai-preferences", () => ({
    DEFAULT_OLLAMA_URL: "http://localhost:11434",
    getDeviceAIPreferences: () => ({
      provider: "none",
      model: "",
      ollamaUrl: "http://localhost:11434",
    }),
  }));
  vi.doMock("./ai-summarizer.js", () => ({
    summarize: vi.fn(async () => null),
  }));
  vi.doMock("./runtime-health-events.js", () => ({
    recordReaderArticleFetchAttempt: mockRecordReaderArticleFetchAttempt,
  }));
  vi.doMock("./secure-storage.js", () => ({
    secureStorage: {
      getApiKey: vi.fn(async () => null),
    },
  }));
  vi.doMock("@freed/ui/lib/debug-store", () => ({
    addDebugEvent: vi.fn(),
  }));
  vi.doMock("@freed/ui/lib/factory-reset", async () => {
    const actual = await vi.importActual<typeof import("@freed/ui/lib/factory-reset")>(
      "@freed/ui/lib/factory-reset",
    );
    return {
      ...actual,
      isFactoryResetInProgress: options.isFactoryResetInProgress ?? (() => false),
    };
  });
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
    mockInvoke,
    mockCacheSet,
    mockDocUpdateFeedItem,
    mockRecordReaderArticleFetchAttempt,
  };
}

async function loadContentFetcherModuleWithAi({
  autoSummarize,
  extractTopics,
  provider = "openai",
  summarizeImpl,
  invokeImpl,
  getApiKeyImpl,
  isFactoryResetInProgress,
}: {
  autoSummarize: boolean;
  extractTopics: boolean;
  provider?: "integrated" | "openai" | "anthropic" | "gemini";
  summarizeImpl?: () => Promise<{
    summary: string;
    topics: string[];
    sentiment: "positive" | "negative" | "neutral" | "mixed";
  } | null>;
  invokeImpl?: (...args: unknown[]) => Promise<unknown>;
  getApiKeyImpl?: () => Promise<string | null>;
  isFactoryResetInProgress?: () => boolean;
}) {
  vi.resetModules();

  const mockInvoke = vi.fn(invokeImpl ?? (async () => SAMPLE_HTML));
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
  const mockRecordReaderArticleFetchAttempt = vi.fn();
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
  const mockSummarize = vi.fn(summarizeImpl ?? (async () => ({
    summary: "Short AI summary",
    topics: ["ai", "reading"],
    sentiment: "neutral" as const,
  })));
  const mockGetApiKey = vi.fn(getApiKeyImpl ?? (async () => "test-key"));

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
            provider,
            model: provider === "integrated" ? "" : "test-model",
          },
        },
      }),
    },
  }));
  vi.doMock("@freed/ui/lib/device-ai-preferences", () => ({
    DEFAULT_OLLAMA_URL: "http://localhost:11434",
    getDeviceAIPreferences: () => ({
      provider,
      model: provider === "integrated" ? "" : "test-model",
      ollamaUrl: "http://localhost:11434",
    }),
  }));
  vi.doMock("./ai-summarizer.js", () => ({
    summarize: mockSummarize,
  }));
  vi.doMock("./runtime-health-events.js", () => ({
    recordReaderArticleFetchAttempt: mockRecordReaderArticleFetchAttempt,
  }));
  vi.doMock("./secure-storage.js", () => ({
    secureStorage: {
      getApiKey: mockGetApiKey,
    },
  }));
  vi.doMock("@freed/ui/lib/debug-store", () => ({
    addDebugEvent: vi.fn(),
  }));
  vi.doMock("@freed/ui/lib/factory-reset", async () => {
    const actual = await vi.importActual<typeof import("@freed/ui/lib/factory-reset")>(
      "@freed/ui/lib/factory-reset",
    );
    return {
      ...actual,
      isFactoryResetInProgress: isFactoryResetInProgress ?? (() => false),
    };
  });
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
    mockInvoke,
    mockCacheSet,
    mockDocUpdateFeedItem,
    mockSummarize,
    mockGetApiKey,
    mockRecordReaderArticleFetchAttempt,
  };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("content fetcher", () => {
  it("drains an in-flight cache write before reset cleanup begins", async () => {
    vi.useFakeTimers();
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const writeSettled = vi.fn();
    const { mod, subscriberRef, mockCacheSet, mockDocUpdateFeedItem } =
      await loadContentFetcherModule({
        cacheSetImpl: async () => {
          await writeGate;
          writeSettled();
        },
      });

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockCacheSet).toHaveBeenCalledOnce();

    const cleanupStarted = vi.fn();
    const draining = mod.stopAndDrain().then(cleanupStarted);
    await Promise.resolve();
    expect(cleanupStarted).not.toHaveBeenCalled();

    releaseWrite();
    await draining;
    expect(writeSettled).toHaveBeenCalledOnce();
    expect(mockDocUpdateFeedItem).toHaveBeenCalledOnce();
    expect(writeSettled.mock.invocationCallOrder[0]).toBeLessThan(
      cleanupStarted.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it.each(["openai", "anthropic", "gemini"] as const)(
    "waits for an issued article fetch without starting %s after reset",
    async (provider) => {
      vi.useFakeTimers();
      let releaseFetch!: (html: string) => void;
      const fetchGate = new Promise<string>((resolve) => {
        releaseFetch = resolve;
      });
      let resetActive = false;
      const {
        mod,
        subscriberRef,
        mockInvoke,
        mockCacheSet,
        mockDocUpdateFeedItem,
        mockSummarize,
        mockGetApiKey,
      } = await loadContentFetcherModuleWithAi({
        autoSummarize: true,
        extractTopics: true,
        provider,
        invokeImpl: () => fetchGate,
        isFactoryResetInProgress: () => resetActive,
      });

      mod.start();
      subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
      await vi.advanceTimersByTimeAsync(0);
      expect(mockInvoke).toHaveBeenCalledOnce();

      resetActive = true;
      const resetFinished = vi.fn();
      const draining = mod.stopAndDrain().then(resetFinished);
      await Promise.resolve();
      expect(resetFinished).not.toHaveBeenCalled();

      releaseFetch(SAMPLE_HTML);
      await draining;

      expect(mockCacheSet).not.toHaveBeenCalled();
      expect(mockGetApiKey).not.toHaveBeenCalled();
      expect(mockSummarize).not.toHaveBeenCalled();
      expect(mockDocUpdateFeedItem).not.toHaveBeenCalled();
      expect(resetFinished).toHaveBeenCalledOnce();
    },
  );

  it("checks reset again after credential lookup before starting summarization", async () => {
    vi.useFakeTimers();
    let releaseApiKey!: (apiKey: string | null) => void;
    const apiKeyGate = new Promise<string | null>((resolve) => {
      releaseApiKey = resolve;
    });
    let resetActive = false;
    const {
      mod,
      subscriberRef,
      mockCacheSet,
      mockDocUpdateFeedItem,
      mockSummarize,
      mockGetApiKey,
    } = await loadContentFetcherModuleWithAi({
      autoSummarize: true,
      extractTopics: true,
      provider: "openai",
      getApiKeyImpl: () => apiKeyGate,
      isFactoryResetInProgress: () => resetActive,
    });

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockCacheSet).toHaveBeenCalledOnce();
    expect(mockGetApiKey).toHaveBeenCalledOnce();

    resetActive = true;
    const draining = mod.stopAndDrain();
    releaseApiKey("test-key");
    await draining;

    expect(mockSummarize).not.toHaveBeenCalled();
    expect(mockDocUpdateFeedItem).not.toHaveBeenCalled();
  });

  it("keeps full HTML in the local cache but syncs only a compact excerpt", async () => {
    vi.useFakeTimers();
    const {
      mod,
      subscriberRef,
      mockInvoke,
      mockCacheSet,
      mockDocUpdateFeedItem,
      mockRecordReaderArticleFetchAttempt,
    } = await loadContentFetcherModule();

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(0);
    mod.stop();

    expect(mockInvoke).toHaveBeenCalledWith("fetch_url", {
      url: SAMPLE_URL,
      maxBytes: 2 * 1024 * 1024,
    });
    expect(mockCacheSet).toHaveBeenCalledWith("rss:1", SAMPLE_ARTICLE_HTML);
    expect(mockRecordReaderArticleFetchAttempt).toHaveBeenCalledWith({
      source: "background-cache",
    });
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
    await vi.advanceTimersByTimeAsync(0);
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
    await vi.advanceTimersByTimeAsync(0);
    mod.stop();

    const update = mockDocUpdateFeedItem.mock.calls.at(0)?.at(1) as
      | { topics?: string[]; preservedContent: { text: string } }
      | undefined;
    expect(update?.preservedContent.text).toContain("Short AI summary");
    expect(update?.topics).toEqual(["ai", "reading"]);
  });

  it("does not request an API key when integrated AI is selected", async () => {
    vi.useFakeTimers();
    const { mod, subscriberRef, mockGetApiKey, mockSummarize } = await loadContentFetcherModuleWithAi({
      autoSummarize: true,
      extractTopics: true,
      provider: "integrated",
    });

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(0);
    mod.stop();

    expect(mockGetApiKey).not.toHaveBeenCalled();
    expect(mockSummarize).toHaveBeenCalledWith(LONG_TEXT, expect.objectContaining({
      provider: "integrated",
    }), null, expect.objectContaining({
      signal: expect.any(AbortSignal),
      throwOnError: true,
    }));
  });

  it("does not overlap jobs while AI summarization is still running", async () => {
    vi.useFakeTimers();
    const { mod, subscriberRef, mockSummarize } = await loadContentFetcherModuleWithAi({
      autoSummarize: true,
      extractTopics: false,
      summarizeImpl: () => new Promise<null>(() => undefined),
    });

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem("rss:1"), makeStubItem("rss:2")], docItemCount: 2 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);

    const status = mod.getStatus();
    mod.stop();

    expect(mockSummarize).toHaveBeenCalledOnce();
    expect(status.active).toBe(true);
    expect(status.pending).toBe(1);
  });

  it("waits for randomized pacing before starting the next job", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { mod, subscriberRef } = await loadContentFetcherModule();

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem("rss:1"), makeStubItem("rss:2")], docItemCount: 2 });
    await vi.advanceTimersByTimeAsync(0);

    expect(mod.getStatus()).toEqual(expect.objectContaining({
      pending: 1,
      nextDelayMs: 2_500,
    }));

    await vi.advanceTimersByTimeAsync(2_499);
    expect(mod.getStatus().pending).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    mod.stop();

    expect(mod.getStatus().pending).toBe(0);
  });

  it("backs off after fetch timeouts and decays after a successful retry", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    let callCount = 0;
    const { mod, subscriberRef } = await loadContentFetcherModuleWithAi({
      autoSummarize: false,
      extractTopics: false,
      invokeImpl: () => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise<string>(() => undefined);
        }
        return Promise.resolve(SAMPLE_HTML);
      },
    });

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mod.getStatus()).toEqual(expect.objectContaining({
      backoffLevel: 1,
      nextDelayMs: 5_000,
      pending: 1,
    }));

    await vi.advanceTimersByTimeAsync(5_000);
    mod.stop();

    expect(mod.getStatus()).toEqual(expect.objectContaining({
      backoffLevel: 0,
      pending: 0,
      completed: 1,
    }));
  });

  it("skips oversized background article fetches without parsing or retry backoff", async () => {
    vi.useFakeTimers();
    const { mod, subscriberRef, mockCacheSet, mockDocUpdateFeedItem } = await loadContentFetcherModuleWithAi({
      autoSummarize: false,
      extractTopics: false,
      invokeImpl: () => Promise.reject(new Error("response_too_large content_length=22000000 limit=2097152 url=https://example.com/articles/memory-landfill")),
    });

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(0);
    mod.stop();

    expect(mockCacheSet).not.toHaveBeenCalled();
    expect(mockDocUpdateFeedItem).not.toHaveBeenCalled();
    expect(mod.getStatus()).toEqual(expect.objectContaining({
      backoffLevel: 0,
      failedCount: 1,
      pending: 0,
    }));
  });

  it("writes extracted content and advances when AI summarization times out", async () => {
    vi.useFakeTimers();
    const { mod, subscriberRef, mockDocUpdateFeedItem } = await loadContentFetcherModuleWithAi({
      autoSummarize: true,
      extractTopics: true,
      summarizeImpl: () => new Promise<null>(() => undefined),
    });

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    mod.stop();

    const update = mockDocUpdateFeedItem.mock.calls.at(0)?.at(1) as
      | { topics?: string[]; preservedContent: { text: string } }
      | undefined;
    expect(update?.preservedContent.text).toContain("Paragraph with noisy spacing");
    expect(update?.preservedContent.text).not.toContain("Short AI summary");
    expect(update?.topics).toBeUndefined();
    expect(mod.getStatus().completed).toBe(1);
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

  it("defers background article parsing while settings are open", async () => {
    vi.useFakeTimers();
    const settingsShell = document.createElement("div");
    settingsShell.className = "theme-settings-shell";
    document.body.appendChild(settingsShell);
    const { mod, subscriberRef, mockInvoke } = await loadContentFetcherModule();

    mod.start();
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mod.getStatus()).toEqual(expect.objectContaining({
      pending: 1,
      active: false,
      nextDelayMs: 15_000,
    }));

    settingsShell.remove();
    await vi.advanceTimersByTimeAsync(15_000);
    mod.stop();

    expect(mockInvoke).toHaveBeenCalledOnce();
  });

  it("honors a startup delay before processing queued content", async () => {
    vi.useFakeTimers();
    const { mod, subscriberRef, mockInvoke } = await loadContentFetcherModule();

    mod.start({ startupDelayMs: 60_000 });
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(59_999);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mod.getStatus()).toEqual(expect.objectContaining({
      pending: 1,
      active: false,
    }));

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);
    mod.stop();

    expect(mockInvoke).toHaveBeenCalledWith(
      "fetch_url",
      expect.objectContaining({ url: SAMPLE_URL }),
    );
  });

  it("bypasses startup delay and reopens the save dialog when manual detail fetch fails", async () => {
    vi.useFakeTimers();
    const events: Array<{ initialUrl?: string; errorMessage?: string }> = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent<{ initialUrl?: string; errorMessage?: string }>).detail);
    };
    window.addEventListener("freed:save-content-details-error", listener);
    const { mod, mockInvoke } = await loadContentFetcherModuleWithAi({
      autoSummarize: false,
      extractTopics: false,
      invokeImpl: () => Promise.reject(new Error("Network unreachable")),
    });

    mod.start({ startupDelayMs: 60_000 });
    mod.enqueue([makeStubItem("saved:1")], {
      priority: true,
      force: true,
      bypassStartupDelay: true,
      reopenSaveDialogOnError: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    mod.stop();
    window.removeEventListener("freed:save-content-details-error", listener);

    expect(mockInvoke).toHaveBeenCalledWith(
      "fetch_url",
      expect.objectContaining({ url: SAMPLE_URL }),
    );
    expect(events).toEqual([
      {
        initialUrl: SAMPLE_URL,
        errorMessage: "Network unreachable",
      },
    ]);
  });

  it("defers content parsing when the main WebKit process is already large", async () => {
    vi.useFakeTimers();
    let highMemory = true;
    const { mod, subscriberRef, mockInvoke } = await loadContentFetcherModuleWithAi({
      autoSummarize: false,
      extractTopics: false,
      invokeImpl: async (cmd) => {
        if (cmd === "get_runtime_memory_stats") {
          return {
            webkitTelemetryAvailable: true,
            webkitTotalFootprintBytes: highMemory ? 640 * 1024 * 1024 : 180 * 1024 * 1024,
            webkitTotalResidentBytes: highMemory ? 900 * 1024 * 1024 : 220 * 1024 * 1024,
            webkitLargestProcessId: 123,
            webkitProcessCount: 1,
          };
        }
        return SAMPLE_HTML;
      },
    });

    mod.start({ memoryGuard: true });
    subscriberRef.current?.({ items: [makeStubItem()], docItemCount: 1 });
    await vi.advanceTimersByTimeAsync(0);

    const fetchCallsBeforeRecovery = mockInvoke.mock.calls.filter(([cmd]) => cmd === "fetch_url");
    expect(fetchCallsBeforeRecovery).toHaveLength(0);
    expect(mod.getStatus()).toEqual(expect.objectContaining({
      pending: 1,
      active: false,
      nextDelayMs: 5 * 60_000,
    }));

    highMemory = false;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    mod.stop();

    const fetchCallsAfterRecovery = mockInvoke.mock.calls.filter(([cmd]) => cmd === "fetch_url");
    expect(fetchCallsAfterRecovery).toHaveLength(1);
  });
});
