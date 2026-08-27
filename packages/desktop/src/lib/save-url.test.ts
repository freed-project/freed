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

vi.mock("./library-client.js", () => ({
  addLibraryStubItem: mockAddLibraryStubItem,
}));

vi.mock("./content-fetcher.js", () => ({
  enqueue: mockEnqueue,
}));

describe("saveUrlInDesktop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddLibraryStubItem.mockResolvedValue(stubItem);
  });

  it("writes a saved stub and queues background detail fetching", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");

    const result = await saveUrlInDesktop(SAMPLE_URL, { tags: ["research"] });

    expect(mockAddLibraryStubItem).toHaveBeenCalledWith(SAMPLE_URL, ["research"]);
    expect(mockEnqueue).toHaveBeenCalledWith([stubItem], {
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
