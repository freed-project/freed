import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDocAddFeedItem = vi.fn(async () => undefined);
const mockDocAddStubItem = vi.fn(async () => undefined);
const mockToastInfo = vi.fn();
const mockBuildSavedFeedItem = vi.fn();
const mockExtractMetadataBrowser = vi.fn();
const mockExtractContentBrowser = vi.fn();
const mockCacheArticleHtml = vi.fn(async () => undefined);
const mockWarmArticleImageCache = vi.fn(async () => undefined);

vi.mock("./automerge", () => ({
  docAddFeedItem: mockDocAddFeedItem,
  docAddStubItem: mockDocAddStubItem,
}));

vi.mock("@freed/ui/components/Toast", () => ({
  toast: {
    info: mockToastInfo,
  },
}));

vi.mock("@freed/capture-save/browser", () => ({
  extractMetadataBrowser: mockExtractMetadataBrowser,
  extractContentBrowser: mockExtractContentBrowser,
}));

vi.mock("@freed/capture-save/normalize", () => ({
  buildSavedFeedItem: mockBuildSavedFeedItem,
}));

vi.mock("@freed/ui/lib/article-cache", () => ({
  cacheArticleHtml: mockCacheArticleHtml,
  warmArticleImageCache: mockWarmArticleImageCache,
}));

describe("saveUrlInPwa", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockExtractMetadataBrowser.mockReturnValue({
      url: "https://example.com/article",
      title: "Saved Article",
      description: "Short summary",
      siteName: "example.com",
    });
    mockExtractContentBrowser.mockReturnValue({
      html: "<article><p>Readable body</p></article>",
      text: "Readable body",
      wordCount: 2,
      readingTime: 1,
    });
    mockBuildSavedFeedItem.mockReturnValue({
      globalId: "saved:abc123",
      platform: "saved",
      contentType: "article",
      capturedAt: 1,
      publishedAt: 1,
      author: { id: "example.com", handle: "example.com", displayName: "example.com" },
      content: {
        text: "Short summary",
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: {
          url: "https://example.com/article",
          title: "Saved Article",
          description: "Short summary",
        },
      },
      preservedContent: {
        text: "Readable body",
        wordCount: 2,
        readingTime: 1,
        preservedAt: 1,
      },
      userState: { hidden: false, saved: true, savedAt: 1, archived: false, tags: ["research"] },
      topics: [],
      sourceUrl: "https://example.com/article",
      priority: 50,
      priorityComputedAt: 1,
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => "<html><body><article><p>Readable body</p></article></body></html>",
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes a full saved item and caches readable HTML when proxy fetch succeeds", async () => {
    const { saveUrlInPwa } = await import("./save-url");

    await saveUrlInPwa("https://example.com/article", { tags: ["research"] });

    expect(fetch).toHaveBeenCalledWith("/api/fetch-url", expect.objectContaining({
      method: "POST",
    }));
    expect(mockDocAddFeedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        globalId: "saved:abc123",
        platform: "saved",
      }),
    );
    expect(mockDocAddStubItem).not.toHaveBeenCalled();
    expect(mockCacheArticleHtml).toHaveBeenCalledWith(
      "https://example.com/article",
      "saved:abc123",
      "<article><p>Readable body</p></article>",
      { pinned: true },
    );
    expect(mockWarmArticleImageCache).toHaveBeenCalledWith(
      "<article><p>Readable body</p></article>",
      "https://example.com/article",
    );
  });

  it("falls back to a stub item and shows an info toast when proxy fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      text: async () => "blocked",
    })));

    const { saveUrlInPwa } = await import("./save-url");
    await saveUrlInPwa("https://example.com/article", { tags: ["research"] });

    expect(mockDocAddFeedItem).not.toHaveBeenCalled();
    expect(mockDocAddStubItem).toHaveBeenCalledWith("https://example.com/article", ["research"]);
    expect(mockToastInfo).toHaveBeenCalledWith(
      "Saved a stub. Full article content will arrive after your next desktop sync.",
    );
  });

  it("rejects invalid URLs instead of silently creating a stub", async () => {
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("notaurl")).rejects.toThrow("Invalid URL");
    expect(mockDocAddFeedItem).not.toHaveBeenCalled();
    expect(mockDocAddStubItem).not.toHaveBeenCalled();
  });

  it("rejects unsupported protocols with a specific error", async () => {
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("ftp://example.com/article")).rejects.toThrow(
      "Only http and https URLs are supported",
    );
    expect(mockDocAddFeedItem).not.toHaveBeenCalled();
    expect(mockDocAddStubItem).not.toHaveBeenCalled();
  });

  it("does not fall back to a stub when Automerge persistence fails", async () => {
    mockDocAddFeedItem.mockRejectedValueOnce(new Error("Automerge unavailable"));

    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("https://example.com/article")).rejects.toThrow(
      "Automerge unavailable",
    );
    expect(mockDocAddStubItem).not.toHaveBeenCalled();
    expect(mockToastInfo).not.toHaveBeenCalled();
  });
});
