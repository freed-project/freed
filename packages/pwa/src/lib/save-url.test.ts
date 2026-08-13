import { describe, expect, it, vi, beforeEach } from "vitest";

const mockDocAddStubItem = vi.fn(async () => undefined);
const mockEnqueueCapture = vi.fn(async () => undefined);

vi.mock("./legacy-automerge-runtime", () => ({
  docAddStubItem: mockDocAddStubItem,
}));

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
  isPwaLibraryCoreEnabled: () =>
    localStorage.getItem("freed.libraryCore.pwaIndexedDbV1.enabled") !== "0",
}));

describe("saveUrlInPwa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("freed.libraryCore.pwaIndexedDbV1.enabled", "0");
  });

  it("writes a signed local capture without waking Automerge or fetching", async () => {
    localStorage.removeItem("freed.libraryCore.pwaIndexedDbV1.enabled");
    vi.stubGlobal("fetch", vi.fn());
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("https://example.com/article", {
      tags: ["research"],
    })).resolves.toEqual({ globalId: "saved:abc123" });
    expect(mockDocAddStubItem).not.toHaveBeenCalled();
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

  it("writes a saved stub without foreground article fetching", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { saveUrlInPwa } = await import("./save-url");

    const result = await saveUrlInPwa("https://example.com/article", {
      tags: ["research"],
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(mockDocAddStubItem).toHaveBeenCalledWith(
      "https://example.com/article",
      ["research"],
    );
    expect(result).toEqual({ globalId: "saved:abc123" });
    vi.unstubAllGlobals();
  });

  it("rejects invalid URLs instead of silently creating a stub", async () => {
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("notaurl")).rejects.toThrow("Invalid URL");
    expect(mockDocAddStubItem).not.toHaveBeenCalled();
  });

  it("rejects unsupported protocols with a specific error", async () => {
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("ftp://example.com/article")).rejects.toThrow(
      "Only http and https URLs are supported",
    );
    expect(mockDocAddStubItem).not.toHaveBeenCalled();
  });

  it("propagates Automerge persistence failures", async () => {
    mockDocAddStubItem.mockRejectedValueOnce(
      new Error("Automerge unavailable"),
    );
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("https://example.com/article")).rejects.toThrow(
      "Automerge unavailable",
    );
  });
});
