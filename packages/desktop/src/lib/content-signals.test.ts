import { describe, expect, it } from "vitest";
import type { FeedItem } from "@freed/shared";
import {
  applyFeedSignalModeToFilter,
  applyFeedSignalModesToFilter,
  filterFeedItems,
  getFeedSignalModeForFilter,
  inferContentSignals,
} from "@freed/shared";
import {
  addFeedItem,
  backfillContentSignals,
  createEmptyDoc,
  type FreedDoc,
} from "@freed/shared/schema";

function plainDoc(): FreedDoc {
  return JSON.parse(JSON.stringify(createEmptyDoc())) as FreedDoc;
}

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  const now = Date.parse("2026-04-25T12:00:00Z");
  return {
    globalId: "x:item-1",
    platform: "x",
    contentType: "post",
    capturedAt: now,
    publishedAt: now,
    author: {
      id: "author-1",
      handle: "author",
      displayName: "Author",
    },
    content: {
      text: "",
      mediaUrls: [],
      mediaTypes: [],
    },
    topics: [],
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    ...overrides,
  };
}

describe("content signals", () => {
  it("infers multiple signals for promoted events", () => {
    const signals = inferContentSignals(
      makeItem({
        content: {
          text: "Join us Friday at 7pm for a launch party. RSVP now, early bird tickets are almost gone.",
          mediaUrls: [],
          mediaTypes: [],
        },
        location: {
          name: "Austin",
          source: "text_extraction",
        },
      }),
      Date.parse("2026-04-25T12:00:00Z"),
    );

    expect(signals.tags).toContain("event");
    expect(signals.tags).toContain("promotion");
    expect(signals.scores.event).toBeGreaterThanOrEqual(0.5);
    expect(signals.scores.promotion).toBeGreaterThanOrEqual(0.5);
  });

  it("keeps media as evidence instead of a signal", () => {
    const signals = inferContentSignals(
      makeItem({
        content: {
          text: "Today at the overlook.",
          mediaUrls: ["https://example.com/photo.jpg"],
          mediaTypes: ["image"],
        },
      }),
    );

    expect(signals.tags).toContain("moment");
    expect(Object.keys(signals.scores)).not.toContain("media");
  });

  it("leaves weak items untagged", () => {
    const signals = inferContentSignals(
      makeItem({
        content: {
          text: "ok",
          mediaUrls: [],
          mediaTypes: [],
        },
      }),
    );

    expect(signals.tags).toEqual([]);
  });

  it("classifies reported news articles", () => {
    const signals = inferContentSignals(
      makeItem({
        platform: "rss",
        contentType: "article",
        rssSource: {
          feedUrl: "https://www.reuters.com/rss",
          feedTitle: "Reuters",
          itemGuid: "news-1",
        },
        content: {
          text: "Reuters reports that regulators announced a new policy after officials reviewed new data.",
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: "https://www.reuters.com/world/example",
            title: "Regulators announce new policy",
          },
        },
      }),
    );

    expect(signals.tags).toContain("news");
    expect(signals.scores.news).toBeGreaterThanOrEqual(0.5);
  });

  it("classifies new feed items during schema insertion", () => {
    const doc = plainDoc();
    addFeedItem(doc, makeItem({
      content: {
        text: "Anyone know a good book on local-first sync?",
        mediaUrls: [],
        mediaTypes: [],
      },
    }));

    expect(doc.feedItems["x:item-1"]?.contentSignals?.tags).toEqual(
      expect.arrayContaining(["request", "recommendation"]),
    );
  });

  it("backfills stale feed items in bounded batches", () => {
    const doc = plainDoc();
    doc.feedItems["x:item-1"] = makeItem({
      globalId: "x:item-1",
      content: {
        text: "Announcing a new release, now available in public beta.",
        mediaUrls: [],
        mediaTypes: [],
      },
    });
    doc.feedItems["x:item-2"] = makeItem({
      globalId: "x:item-2",
      content: {
        text: "This long read explains why local-first software changes collaboration.",
        mediaUrls: [],
        mediaTypes: [],
      },
      contentType: "article",
      preservedContent: {
        text: "This long read explains why local-first software changes collaboration.",
        wordCount: 900,
        readingTime: 5,
        preservedAt: Date.now(),
      },
    });

    const first = backfillContentSignals(doc, 1);
    expect(first.updated).toBe(1);
    expect(first.remaining).toBe(1);

    const second = backfillContentSignals(doc, 1);
    expect(second.updated).toBe(1);
    expect(second.remaining).toBe(0);
    expect(second.counts.announcement).toBeGreaterThanOrEqual(1);
    expect(second.counts.essay).toBeGreaterThanOrEqual(1);
  });

  it("applies saved signal filter presets to feed filters", () => {
    const inspiring = applyFeedSignalModeToFilter({ platform: "x" }, "inspiring");
    expect(inspiring).toEqual({
      platform: "x",
      signals: ["essay", "recommendation", "moment"],
    });
    expect(getFeedSignalModeForFilter(inspiring)).toBe("inspiring");

    expect(applyFeedSignalModeToFilter(inspiring, "all")).toEqual({
      platform: "x",
    });

    expect(applyFeedSignalModesToFilter({ platform: "x" }, ["inspiring", "events"])).toEqual({
      platform: "x",
      signals: ["essay", "recommendation", "moment", "event", "promotion"],
    });

    expect(applyFeedSignalModesToFilter({ platform: "rss" }, ["news"])).toEqual({
      platform: "rss",
      signals: ["news"],
    });
  });

  it("applies post and story filters in the unified feed", () => {
    const post = makeItem({
      globalId: "x:post",
      contentType: "post",
    });
    const story = makeItem({
      globalId: "ig:story",
      platform: "instagram",
      contentType: "story",
    });

    expect(filterFeedItems([post, story], { socialContentFilter: "posts" })).toEqual([post]);
    expect(filterFeedItems([post, story], { socialContentFilter: "stories" })).toEqual([story]);
  });
});
