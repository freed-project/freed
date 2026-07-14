import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import {
  resetFactoryResetStateForTests,
  runFactoryResetOperations,
} from "@freed/ui/lib/factory-reset";
import { hydrateReaderItemInPwa, pinReaderItemInPwa } from "./reader-cache";

function runEmptyReset(): Promise<void> {
  return runFactoryResetOperations({
    quiesceLocalWriters: [],
    clearDeviceStores: () => [],
    clearLocalSettings: [],
    clearLocalData: [],
    clearProviderDataAndConnections: async () => undefined,
    clearDocument: async () => undefined,
  });
}

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
    resetFactoryResetStateForTests();
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

  it("pins YouTube metadata without fetching the watch page or thumbnail", async () => {
    const pinnedStore = new Map<string, Response>();
    vi.stubGlobal("caches", {
      open: vi.fn(async () => ({
        put: vi.fn(async (key: string, response: Response) => {
          pinnedStore.set(key, response);
        }),
        match: vi.fn(async (key: string) => pinnedStore.get(key)),
      })),
    });
    const fetchMock = vi.fn(async () => {
      throw new Error("YouTube network fetch should stay user-controlled");
    });
    vi.stubGlobal("fetch", fetchMock);
    const watchUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    await pinReaderItemInPwa(makePost({
      globalId: "youtube:dQw4w9WgXcQ",
      platform: "youtube",
      contentType: "video",
      content: {
        text: "Focused lesson",
        mediaUrls: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
        mediaTypes: ["image"],
        linkPreview: { url: watchUrl, title: "Focused lesson" },
      },
      sourceUrl: watchUrl,
    }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(pinnedStore.has("/pinned-content/youtube:dQw4w9WgXcQ")).toBe(true);
  });

  it("does not cache PWA hydration that finishes after reset starts", async () => {
    let finishFetch!: (response: Response) => void;
    const put = vi.fn(async () => undefined);
    vi.stubGlobal("caches", {
      open: vi.fn(async () => ({ put, match: vi.fn(async () => undefined) })),
    });
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      finishFetch = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);
    const item = makePost({
      globalId: "saved:delayed-hydration",
      platform: "saved",
      content: {
        text: "Delayed article",
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: { url: "https://example.com/delayed-hydration" },
      },
      sourceUrl: "https://example.com/delayed-hydration",
    });

    const hydration = hydrateReaderItemInPwa(item, {
      cacheMode: "everything_opened",
      pin: true,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const reset = runEmptyReset();
    finishFetch(new Response("<article>Delayed</article>"));

    await expect(hydration).resolves.toMatchObject({ html: "<article>Delayed</article>" });
    await reset;
    expect(put).not.toHaveBeenCalled();
  });
});
