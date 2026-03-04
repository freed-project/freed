/**
 * Unit tests for saveUrlInDesktop
 *
 * Tauri IPC, content extraction, content cache, and Automerge are all mocked
 * so these tests run in jsdom without any native runtime dependencies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FeedItem } from "@freed/shared";

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

const mockExtractMetadata = vi.fn();
const mockExtractContent = vi.fn();
vi.mock("@freed/capture-save/browser", () => ({
  extractMetadataBrowser: mockExtractMetadata,
  extractContentBrowser: mockExtractContent,
}));

const mockCacheSet = vi.fn();
vi.mock("./content-cache.js", () => ({
  contentCache: { set: mockCacheSet, get: vi.fn() },
}));

const mockDocAdd = vi.fn<(item: FeedItem) => Promise<void>>();
vi.mock("./automerge.js", () => ({ docAddFeedItem: mockDocAdd }));

// ── Helpers ───────────────────────────────────────────────────────────────────

const SAMPLE_HTML = "<html><head><title>Test Article</title></head><body><p>Hello world.</p></body></html>";
const SAMPLE_URL = "https://example.com/articles/hello-world";

function makeMetadata(overrides: Record<string, unknown> = {}) {
  return {
    title: "Test Article",
    description: "A short description.",
    siteName: "Example",
    author: "Jane Doe",
    imageUrl: "https://example.com/img.jpg",
    publishedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeContent(overrides: Record<string, unknown> = {}) {
  return {
    text: "Hello world. This is the full article body.",
    author: "Jane Doe",
    wordCount: 8,
    readingTime: 1,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("saveUrlInDesktop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(SAMPLE_HTML);
    mockExtractMetadata.mockReturnValue(makeMetadata());
    mockExtractContent.mockReturnValue(makeContent());
    mockCacheSet.mockResolvedValue(undefined);
    mockDocAdd.mockResolvedValue(undefined);
  });

  it("invokes fetch_url with the provided URL", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");
    await saveUrlInDesktop(SAMPLE_URL);
    expect(mockInvoke).toHaveBeenCalledWith("fetch_url", { url: SAMPLE_URL });
  });

  it("writes HTML to the content cache under the item's globalId", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");
    const item = await saveUrlInDesktop(SAMPLE_URL);
    expect(mockCacheSet).toHaveBeenCalledWith(item.globalId, SAMPLE_HTML);
  });

  it("persists the item to Automerge with saved=true and platform=saved", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");
    const item = await saveUrlInDesktop(SAMPLE_URL);
    expect(item.platform).toBe("saved");
    expect(item.userState.saved).toBe(true);
    expect(mockDocAdd).toHaveBeenCalledWith(item);
  });

  it("sets the linkPreview URL, title, and description from metadata", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");
    const item = await saveUrlInDesktop(SAMPLE_URL);
    expect(item.content.linkPreview?.url).toBe(SAMPLE_URL);
    expect(item.content.linkPreview?.title).toBe("Test Article");
    expect(item.content.linkPreview?.description).toBe("A short description.");
  });

  it("does NOT include html in preservedContent (keeps Automerge small)", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");
    const item = await saveUrlInDesktop(SAMPLE_URL);
    expect("html" in (item.preservedContent ?? {})).toBe(false);
  });

  it("assigns user-supplied tags to the item", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");
    const item = await saveUrlInDesktop(SAMPLE_URL, { tags: ["Tech/AI", "Reading"] });
    expect(item.userState.tags).toEqual(["Tech/AI", "Reading"]);
  });

  it("uses hostname as fallback author when siteName is absent", async () => {
    mockExtractMetadata.mockReturnValue(makeMetadata({ siteName: undefined }));
    const { saveUrlInDesktop } = await import("./save-url.js");
    const item = await saveUrlInDesktop(SAMPLE_URL);
    expect(item.author.displayName).toBe("example.com");
  });

  it("produces a stable globalId for the same URL", async () => {
    const { saveUrlInDesktop } = await import("./save-url.js");
    const a = await saveUrlInDesktop(SAMPLE_URL);
    const b = await saveUrlInDesktop(SAMPLE_URL);
    expect(a.globalId).toBe(b.globalId);
  });

  it("propagates IPC errors so callers can display toast.error", async () => {
    mockInvoke.mockRejectedValue(new Error("Network unreachable"));
    const { saveUrlInDesktop } = await import("./save-url.js");
    await expect(saveUrlInDesktop(SAMPLE_URL)).rejects.toThrow("Network unreachable");
    // Cache and Automerge must NOT have been touched
    expect(mockCacheSet).not.toHaveBeenCalled();
    expect(mockDocAdd).not.toHaveBeenCalled();
  });
});
