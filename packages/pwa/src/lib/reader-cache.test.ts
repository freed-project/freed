import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import { pinReaderItemInPwa } from "./reader-cache";

function makePost(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    globalId: "x:pwa-pin",
    platform: "x",
    contentType: "post",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: {
      text: "Long post body for local pinning.",
      mediaUrls: ["https://example.com/photo.jpg"],
      mediaTypes: ["image"],
    },
    userState: { hidden: false, saved: true, archived: false, tags: [] },
    topics: [],
    sourceUrl: "https://x.com/author/status/1",
    ...overrides,
  };
}

describe("PWA reader cache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("pins saved social posts into the permanent cache without a network URL", async () => {
    const pinnedStore = new Map<string, Response>();
    const open = vi.fn(async () => ({
      put: vi.fn(async (key: string, response: Response) => {
        pinnedStore.set(key, response);
      }),
      match: vi.fn(async (key: string) => pinnedStore.get(key)),
    }));
    vi.stubGlobal("caches", { open });

    await pinReaderItemInPwa(makePost());

    expect(open).toHaveBeenCalledWith("freed-articles-pinned-v1");
    expect(pinnedStore.has("/pinned-content/x:pwa-pin")).toBe(true);
    await expect(pinnedStore.get("/content/x:pwa-pin")?.text()).resolves.toContain("Long post body");
  });
});
