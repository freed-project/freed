import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FeedItem } from "@freed/shared";

const SAMPLE_URL = "https://example.com/articles/hello-world";

const stubItem: FeedItem = {
  globalId: "saved:abc123",
  platform: "saved",
  contentType: "article",
  capturedAt: 1,
  publishedAt: 1,
  author: { id: "example.com", handle: "example.com", displayName: "example.com" },
  content: {
    text: SAMPLE_URL,
    mediaUrls: [],
    mediaTypes: [],
    linkPreview: { url: SAMPLE_URL, title: SAMPLE_URL },
  },
  userState: { hidden: false, saved: true, savedAt: 1, archived: false, tags: ["research"] },
  topics: [],
};

const mockAddLibraryStubItem = vi.fn(async () => stubItem);
const mockEnqueue = vi.fn();
const mockRemoveLibraryFeedItem = vi.fn(async () => undefined);
const mockUpdateLibrarySavedItemNote = vi.fn(async () => undefined);
const mockUpdateLibraryFeedItem = vi.fn(async () => undefined);

vi.mock("./library-client.js", () => ({
  addLibraryStubItem: mockAddLibraryStubItem,
  removeLibraryFeedItem: mockRemoveLibraryFeedItem,
  updateLibraryFeedItem: mockUpdateLibraryFeedItem,
  updateLibrarySavedItemNote: mockUpdateLibrarySavedItemNote,
}));

vi.mock("./content-fetcher.js", () => ({
  enqueue: mockEnqueue,
}));

describe("saveUrlInDesktop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddLibraryStubItem.mockResolvedValue(stubItem);
  });

  it("drains an accepted save through its note write while rejecting new saves during handoff", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");
    const { pauseDesktopOperationsForHandoff } = await import("./factory-reset-guard");
    let releaseStub!: (item: FeedItem) => void;
    mockAddLibraryStubItem.mockImplementationOnce(() => new Promise<FeedItem>((resolve) => { releaseStub = resolve; }));
    const saving = saveUrlInDesktop(SAMPLE_URL, { notes: "Keep this note" });
    await Promise.resolve();
    expect(mockAddLibraryStubItem).toHaveBeenCalledOnce();
    const pause = pauseDesktopOperationsForHandoff();
    try {
      const finished = vi.fn();
      const draining = pause.drain(1_000).then(finished);
      await expect(saveUrlInDesktop(SAMPLE_URL)).rejects.toThrow("pausing");
      expect(finished).not.toHaveBeenCalled();
      releaseStub(stubItem);
      await saving;
      await draining;
      expect(mockUpdateLibraryFeedItem).toHaveBeenCalledOnce();
      expect(mockEnqueue).toHaveBeenCalledOnce();
      expect(mockUpdateLibraryFeedItem.mock.invocationCallOrder[0]).toBeLessThan(finished.mock.invocationCallOrder[0]);
    } finally { pause.resume(); }
  });

  it("writes a saved stub and queues background detail fetching", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");

    const result = await saveUrlInDesktop(SAMPLE_URL, {
      notes: "Follow up",
      tags: ["research"],
    });

    expect(mockAddLibraryStubItem).toHaveBeenCalledWith(SAMPLE_URL, ["research"]);
    expect(mockUpdateLibraryFeedItem).toHaveBeenCalledWith(
      "saved:abc123",
      expect.objectContaining({
        userState: expect.objectContaining({
          highlights: [expect.objectContaining({ note: "Follow up" })],
        }),
      }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith([expect.objectContaining({
      globalId: stubItem.globalId,
      userState: expect.objectContaining({
        highlights: [expect.objectContaining({ note: "Follow up" })],
      }),
    })], {
      priority: true,
      force: true,
      bypassStartupDelay: true,
      reopenSaveDialogOnError: true,
    });
    expect(result).toEqual({ globalId: "saved:abc123" });
  });

  it("normalizes URLs before saving", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");

    await saveUrlInDesktop("https://example.com/articles/hello-world#section");

    expect(mockAddLibraryStubItem).toHaveBeenCalledWith(
      "https://example.com/articles/hello-world#section",
      undefined,
    );
  });

  it("rejects invalid URLs instead of creating a stub", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");

    await expect(saveUrlInDesktop("notaurl")).rejects.toThrow("Invalid URL");
    expect(mockAddLibraryStubItem).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("rejects unsupported protocols with a specific error", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");

    await expect(saveUrlInDesktop("ftp://example.com/article")).rejects.toThrow(
      "Only http and https URLs are supported",
    );
    expect(mockAddLibraryStubItem).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("does not enqueue details when stub persistence fails", async () => {
    mockAddLibraryStubItem.mockRejectedValueOnce(new Error("Library unavailable"));
    const { saveUrlInDesktop } = await import("./save-url.js");

    await expect(saveUrlInDesktop(SAMPLE_URL)).rejects.toThrow("Library unavailable");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});


describe("same-URL saved note editing", () => {
  it("uses canonical preservation without capture or URL fetching", async () => {
    vi.clearAllMocks();
    const { updateSavedContentInDesktop } = await import("./save-url.js");
    const annotationSnapshot = { state: "ready" as const, highlights: [], originals: {
      queryId: "item_annotations_v1" as const, schemaVersion: 1 as const, globalId: stubItem.globalId,
      source: { generationId: "a".repeat(64) as import("@freed/shared/library-core").LibraryCoreLowercaseHex64, projectionRevision: 2, transitionSequence: 2 }, tags: [], highlights: [],
    } };
    await updateSavedContentInDesktop(stubItem, { url: SAMPLE_URL, notes: "Revised", annotationSnapshot });
    expect(mockUpdateLibrarySavedItemNote).toHaveBeenCalledWith(stubItem.globalId, "Revised", annotationSnapshot);
    expect(mockUpdateLibraryFeedItem).not.toHaveBeenCalled();
    expect(mockAddLibraryStubItem).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    mockUpdateLibrarySavedItemNote.mockRejectedValueOnce(new Error("Annotation text is corrupt"));
    await expect(updateSavedContentInDesktop(stubItem, { url: SAMPLE_URL, notes: "", annotationSnapshot })).rejects.toThrow("corrupt");
    expect(mockRemoveLibraryFeedItem).not.toHaveBeenCalled();
  });
});
