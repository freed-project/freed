import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDocAddFeedItem = vi.fn(async () => undefined);
const mockDocAddStubItem = vi.fn(async () => undefined);
const mockToastInfo = vi.fn();
const mockBuildSavedFeedItem = vi.fn();
const mockExtractMetadataBrowser = vi.fn();
const mockExtractContentBrowser = vi.fn();

vi.mock("./automerge", () => ({
  docAddFeedItem: mockDocAddFeedItem,
  docAddStubItem: mockDocAddStubItem,
}));

vi.mock("@freed/ui/components/Toast", () => ({
  toast: {
    info: mockToastInfo,
  },
}));

vi.mock("@freed/capture-save", () => ({
  buildSavedFeedItem: mockBuildSavedFeedItem,
  extractMetadataBrowser: mockExtractMetadataBrowser,
  extractContentBrowser: mockExtractContentBrowser,
}));

describe("saveUrlInPwa", () => {
  const cachePut = vi.fn(async () => undefined);
  const cacheOpen = vi.fn(async () => ({ put: cachePut }));

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "caches", {
      value: { open: cacheOpen },
      configurable: true,
    });

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
    expect(cacheOpen).toHaveBeenCalledWith("freed-articles-v1");
    expect(cachePut).toHaveBeenCalledTimes(2);
    expect(cachePut).toHaveBeenNthCalledWith(
      1,
      "https://example.com/article",
      expect.any(Response),
    );
    expect(cachePut).toHaveBeenNthCalledWith(
      2,
      "/content/saved:abc123",
      expect.any(Response),
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
});
