import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";

const cacheMocks = vi.hoisted(() => ({
  get: vi.fn(async (_globalId: string) => null as string | null),
  set: vi.fn(async (_globalId: string, _html: string) => undefined),
}));

vi.mock("./content-cache.js", () => ({
  contentCache: cacheMocks,
}));

import { cacheRssEssayBodies } from "./rss-essay-cache.js";

function essay(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    globalId:
      "substack:essay:https%3A%2F%2Fwriter.substack.com%2Fp%2Fdeep-thought",
    platform: "substack",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: {
      id: "https://writer.substack.com/",
      handle: "writer",
      displayName: "Writer",
    },
    content: {
      text: `First paragraph.\n\nSecond paragraph with <script>unsafe()</script>. ${"Long body. ".repeat(500)}`,
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: {
        url: "https://writer.substack.com/p/deep-thought?utm_source=feed",
        title: "Deep Thought",
      },
    },
    rssSource: {
      feedUrl: "https://writer.substack.com/feed",
      feedTitle: "Writer",
      siteUrl: "https://writer.substack.com",
    },
    sourceUrl: "https://writer.substack.com/p/deep-thought",
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
    ...overrides,
  };
}

describe("provider RSS essay cache", () => {
  beforeEach(() => {
    cacheMocks.get.mockReset().mockResolvedValue(null);
    cacheMocks.set.mockReset().mockResolvedValue(undefined);
  });

  it("preserves the complete escaped body under canonical and legacy IDs", async () => {
    const legacy = essay({
      globalId: "rss:legacy-guid",
      platform: "rss",
      rssSource: undefined,
    });

    const result = await cacheRssEssayBodies([essay()], [legacy]);

    expect(result).toEqual({ attempted: 2, cached: 2, skipped: 0, failed: 0 });
    expect(cacheMocks.set).toHaveBeenCalledTimes(2);
    expect(cacheMocks.set).toHaveBeenCalledWith(
      "rss:legacy-guid",
      expect.stringContaining("Second paragraph with &lt;script&gt;unsafe()&lt;/script&gt;"),
    );
    const html = cacheMocks.set.mock.calls[0]?.[1] ?? "";
    expect(html.length).toBeGreaterThan(4_000);
    expect(html).toContain("<p>First paragraph.</p>");
  });

  it("keeps a richer local body and ignores non-provider RSS items", async () => {
    cacheMocks.get.mockResolvedValue("Existing rich body. ".repeat(1_000));
    const generic = essay({
      globalId: "rss:generic",
      platform: "rss",
    });

    const result = await cacheRssEssayBodies([essay(), generic], []);

    expect(result).toEqual({ attempted: 1, cached: 0, skipped: 1, failed: 0 });
    expect(cacheMocks.set).not.toHaveBeenCalled();
  });

  it("replaces a shorter cached placeholder with the RSS body", async () => {
    cacheMocks.get.mockResolvedValue("<article><h1>Deep Thought</h1></article>");

    const result = await cacheRssEssayBodies([essay()], []);

    expect(result).toEqual({ attempted: 1, cached: 1, skipped: 0, failed: 0 });
    expect(cacheMocks.set).toHaveBeenCalledWith(
      essay().globalId,
      expect.stringContaining("Second paragraph"),
    );
  });

  it("does not fail feed capture when a local cache write fails", async () => {
    cacheMocks.set.mockRejectedValueOnce(new Error("disk full"));

    await expect(cacheRssEssayBodies([essay()], [])).resolves.toEqual({
      attempted: 1,
      cached: 0,
      skipped: 0,
      failed: 1,
    });
  });
});
