import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";
import {
  addFeedItem,
  addRssFeed,
  createEmptyDoc,
  removeRssFeed,
} from "@freed/shared/schema";

function rssItem(globalId: string, feedUrl: string) {
  return {
    globalId,
    platform: "rss" as const,
    contentType: "article" as const,
    capturedAt: 1,
    publishedAt: 1,
    author: {
      id: "author-1",
      handle: "author",
      displayName: "Author",
    },
    content: {
      text: "hello",
      mediaUrls: [],
      mediaTypes: [],
    },
    rssSource: {
      feedUrl,
      feedTitle: "Feed",
      siteUrl: "https://example.com",
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
  };
}

describe("removeRssFeed", () => {
  it("keeps articles when includeItems is false", () => {
    let doc = createEmptyDoc();

    doc = A.change(doc, (draft) => {
      addRssFeed(draft, {
        url: "https://example.com/feed.xml",
        title: "Example Feed",
        enabled: true,
        trackUnread: false,
      });
      addFeedItem(draft, rssItem("rss:1", "https://example.com/feed.xml"));
      addFeedItem(draft, rssItem("rss:2", "https://other.com/feed.xml"));
      removeRssFeed(draft, "https://example.com/feed.xml");
    });

    expect(doc.rssFeeds["https://example.com/feed.xml"]).toBeUndefined();
    expect(doc.feedItems["rss:1"]).toBeDefined();
    expect(doc.feedItems["rss:2"]).toBeDefined();
  });

  it("deletes only matching feed articles when includeItems is true", () => {
    let doc = createEmptyDoc();

    doc = A.change(doc, (draft) => {
      addRssFeed(draft, {
        url: "https://example.com/feed.xml",
        title: "Example Feed",
        enabled: true,
        trackUnread: false,
      });
      addFeedItem(draft, rssItem("rss:1", "https://example.com/feed.xml"));
      addFeedItem(draft, rssItem("rss:2", "https://other.com/feed.xml"));
      removeRssFeed(draft, "https://example.com/feed.xml", true);
    });

    expect(doc.rssFeeds["https://example.com/feed.xml"]).toBeUndefined();
    expect(doc.feedItems["rss:1"]).toBeUndefined();
    expect(doc.feedItems["rss:2"]).toBeDefined();
  });
});
