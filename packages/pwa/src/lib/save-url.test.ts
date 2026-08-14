import { describe, expect, it, vi, beforeEach } from "vitest";

const mockEnqueueCapture = vi.fn(async () => undefined);

vi.mock("@freed/capture-save/normalize", () => ({
  buildSavedFeedItem: (metadata: { url: string }, _content: null, options: { tags?: string[] }) => ({
    globalId: "saved:abc123",
    platform: "saved",
    capturedAt: 100,
    userState: { saved: true, tags: options.tags ?? [] },
    sourceUrl: metadata.url,
  }),
  hashSavedUrl: (url: string) =>
    url === "https://example.com/article" ? "abc123" : "stub123",
}));

vi.mock("./library-core-runtime", () => ({
  enqueuePwaLibraryCoreFeedItemCapture: mockEnqueueCapture,
}));

describe("saveUrlInPwa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a signed local capture without fetching", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("https://example.com/article", {
      tags: ["research"],
    })).resolves.toEqual({ globalId: "saved:abc123" });
    expect(mockEnqueueCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        globalId: "saved:abc123",
        sourceUrl: "https://example.com/article",
        userState: expect.objectContaining({ tags: ["research"] }),
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects invalid URLs instead of silently creating a stub", async () => {
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("notaurl")).rejects.toThrow("Invalid URL");
  });

  it("rejects unsupported protocols with a specific error", async () => {
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("ftp://example.com/article")).rejects.toThrow(
      "Only http and https URLs are supported",
    );
  });

  it("propagates Library Core persistence failures", async () => {
    mockEnqueueCapture.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("https://example.com/article")).rejects.toThrow(
      "IndexedDB unavailable",
    );
  });
});
