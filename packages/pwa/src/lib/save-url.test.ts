import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSavedNote = vi.fn(async () => undefined);
const mockEnqueueCapture = vi.fn(async () => undefined);
const mockEnqueueAnnotations = vi.fn(async () => undefined);
const mockEnqueueRemove = vi.fn(async () => undefined);

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
  enqueuePwaLibraryCoreSavedItemNote: mockSavedNote,
  enqueuePwaLibraryCoreFeedItemCapture: mockEnqueueCapture,
  enqueuePwaLibraryCoreFeedItemAnnotationSets: mockEnqueueAnnotations,
  enqueuePwaLibraryCoreFeedItemRemove: mockEnqueueRemove,
}));

describe("saveUrlInPwa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a signed local capture without fetching", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("https://example.com/article", {
      notes: "Follow up",
      tags: ["research"],
    })).resolves.toEqual({ globalId: "saved:abc123" });
    expect(mockEnqueueCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        globalId: "saved:abc123",
        sourceUrl: "https://example.com/article",
        userState: expect.objectContaining({ tags: ["research"] }),
      }),
    );
    expect(mockEnqueueAnnotations).toHaveBeenCalledWith([
      expect.objectContaining({
        entityId: "saved:abc123",
        highlights: [expect.objectContaining({ note: "Follow up" })],
        tags: ["research"],
      }),
    ]);
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


it("edits an existing note through canonical preservation without capture or fetch", async () => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  try {
    const { updateSavedContentInPwa } = await import("./save-url");
    const item = { globalId: "saved:abc123", sourceUrl: "https://example.com/article" } as import("@freed/shared").FeedItem;
    const annotationSnapshot = { state: "ready" as const, highlights: [], originals: {
      queryId: "item_annotations_v1" as const, schemaVersion: 1 as const, globalId: item.globalId,
      source: { generationId: "a".repeat(64) as import("@freed/shared/library-core").LibraryCoreLowercaseHex64, projectionRevision: 2, transitionSequence: 2 }, tags: [], highlights: [],
    } };
    await updateSavedContentInPwa(item, { url: item.sourceUrl!, notes: "Revised", annotationSnapshot });
    expect(mockSavedNote).toHaveBeenCalledWith(item.globalId, "Revised", annotationSnapshot);
    expect(mockEnqueueAnnotations).not.toHaveBeenCalled();
    expect(mockEnqueueCapture).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    mockSavedNote.mockRejectedValueOnce(new Error("Annotation text is unavailable"));
    await expect(updateSavedContentInPwa(item, { url: item.sourceUrl!, notes: "", annotationSnapshot })).rejects.toThrow("unavailable");
    expect(mockEnqueueRemove).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
