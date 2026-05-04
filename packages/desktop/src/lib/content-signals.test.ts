import { describe, expect, it } from "vitest";
import type { FeedItem } from "@freed/shared";
import {
  applyFeedSignalModeToFilter,
  applyFeedSignalModesToFilter,
  filterFeedItems,
  getFeedSignalModeForFilter,
  inferContentSignals,
  inferEventCandidate,
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

  it("classifies media as a first-class signal", () => {
    const signals = inferContentSignals(
      makeItem({
        content: {
          text: "Today at the overlook with a short video.",
          mediaUrls: ["https://example.com/clip.mp4"],
          mediaTypes: ["video"],
        },
      }),
    );

    expect(signals.tags).toContain("media");
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
          siteUrl: "https://www.reuters.com",
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

  it("classifies deadline and opportunity signals without making them exclusive", () => {
    const signals = inferContentSignals(
      makeItem({
        content: {
          text: "Call for speakers is open. Apply by May 12 for the conference program.",
          mediaUrls: [],
          mediaTypes: [],
        },
      }),
      Date.parse("2026-04-25T12:00:00Z"),
    );

    expect(signals.tags).toEqual(expect.arrayContaining(["deadline", "opportunity"]));
    expect(signals.scores.deadline).toBeGreaterThanOrEqual(0.5);
    expect(signals.scores.opportunity).toBeGreaterThanOrEqual(0.5);
  });

  it("classifies reference, how-to, transaction, product update, alert, deal, and place signals", () => {
    expect(inferContentSignals(makeItem({
      content: { text: "API reference and setup guide for troubleshooting install errors.", mediaUrls: [], mediaTypes: [] },
    })).tags).toEqual(expect.arrayContaining(["reference", "how_to"]));

    expect(inferContentSignals(makeItem({
      content: { text: "Order confirmation #12345. Your reservation is confirmed.", mediaUrls: [], mediaTypes: [] },
    })).tags).toContain("transaction");

    expect(inferContentSignals(makeItem({
      content: { text: "Release notes for version 2.4 include bug fixes and a product update.", mediaUrls: [], mediaTypes: [] },
    })).tags).toContain("product_update");

    expect(inferContentSignals(makeItem({
      content: { text: "Urgent service outage alert. Avoid the station until the warning clears.", mediaUrls: [], mediaTypes: [] },
    })).tags).toContain("alert");

    expect(inferContentSignals(makeItem({
      content: { text: "Limited time deal: use promo code SAVE20 for 20% off.", mediaUrls: [], mediaTypes: [] },
    })).tags).toContain("deal");

    expect(inferContentSignals(makeItem({
      location: { name: "MoMA", source: "text_extraction" },
      content: { text: "Great museum visit in New York.", mediaUrls: [], mediaTypes: [] },
    })).tags).toContain("place");
  });

  it("extracts event candidates from explicit and relative future dates", () => {
    const now = Date.parse("2026-04-25T12:00:00Z");
    const explicit = makeItem({
      content: {
        text: "Join us at Pioneer Works on May 12 at 7pm for a launch party. RSVP now.",
        mediaUrls: [],
        mediaTypes: [],
      },
    });
    const explicitCandidate = inferEventCandidate(explicit, inferContentSignals(explicit, now), now);

    expect(explicitCandidate?.startsAt).toBe(Date.parse("2026-05-12T19:00:00Z"));
    expect(explicitCandidate?.locationName).toBe("Pioneer Works");
    expect(explicitCandidate?.confidence).toBeGreaterThanOrEqual(0.7);

    const relative = makeItem({
      publishedAt: now,
      content: {
        text: "Workshop this Friday at 6pm. Register now.",
        mediaUrls: [],
        mediaTypes: [],
      },
    });
    const relativeCandidate = inferEventCandidate(relative, inferContentSignals(relative, now), now);

    expect(relativeCandidate?.startsAt).toBe(Date.parse("2026-05-01T18:00:00Z"));
  });

  it("rejects ambiguous stale event candidates", () => {
    const now = Date.parse("2026-04-25T12:00:00Z");
    const item = makeItem({
      publishedAt: Date.parse("2026-04-01T12:00:00Z"),
      content: {
        text: "Join us on April 2 at 7pm for a meetup.",
        mediaUrls: [],
        mediaTypes: [],
      },
    });

    expect(inferEventCandidate(item, inferContentSignals(item, now), now)).toBeNull();
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

  it("stores compact event metadata during schema insertion", () => {
    const doc = plainDoc();
    addFeedItem(doc, makeItem({
      content: {
        text: "Join us at Civic Hall on May 12 at 7pm for a live event. RSVP now.",
        mediaUrls: [],
        mediaTypes: [],
      },
    }));

    const item = doc.feedItems["x:item-1"];
    expect(item?.eventCandidate?.startsAt).toBe(Date.parse("2026-05-12T19:00:00Z"));
    expect(item?.timeRange?.kind).toBe("event");
    expect(item?.location?.source).toBe("text_extraction");
    expect(item?.eventCandidate).not.toHaveProperty("vector");
    expect(item?.eventCandidate).not.toHaveProperty("html");
  });

  it("does not overwrite stronger existing locations", () => {
    const doc = plainDoc();
    addFeedItem(doc, makeItem({
      location: {
        name: "Existing Venue",
        source: "check_in",
      },
      content: {
        text: "Join us at New Venue on May 12 at 7pm for a meetup. RSVP now.",
        mediaUrls: [],
        mediaTypes: [],
      },
    }));

    expect(doc.feedItems["x:item-1"]?.location?.name).toBe("Existing Venue");
    expect(doc.feedItems["x:item-1"]?.location?.source).toBe("check_in");
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
      signals: ["essay", "how_to", "reference", "recommendation", "moment"],
    });
    expect(getFeedSignalModeForFilter(inspiring)).toBe("inspiring");

    expect(applyFeedSignalModeToFilter(inspiring, "all")).toEqual({
      platform: "x",
    });

    expect(applyFeedSignalModesToFilter({ platform: "x" }, ["inspiring", "events"])).toEqual({
      platform: "x",
      signals: [
        "essay",
        "how_to",
        "reference",
        "recommendation",
        "moment",
        "event",
        "deadline",
        "opportunity",
        "deal",
        "promotion",
      ],
    });

    expect(applyFeedSignalModesToFilter({ platform: "rss" }, ["news"])).toEqual({
      platform: "rss",
      signals: ["news", "alert", "product_update"],
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
