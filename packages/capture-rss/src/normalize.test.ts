import { describe, expect, it } from "vitest";
import { parseFeedXml } from "./browser.js";
import { detectPlatform } from "./discovery.js";
import { rssItemToFeedItem } from "./normalize.js";
import type { ParsedFeed, ParsedFeedItem } from "./types.js";

function feed(feedUrl: string, item: ParsedFeedItem): ParsedFeed {
  return {
    title: "Deep Writing",
    link: feedUrl.replace(/\/feed\/?$/, ""),
    feedUrl,
    items: [item],
  };
}

describe("authenticated essay RSS normalization", () => {
  it("classifies only real Substack and Medium hosts", () => {
    expect(detectPlatform("https://writer.substack.com/feed")).toBe("substack");
    expect(detectPlatform("https://medium.com/feed/@ada")).toBe("medium");
    expect(detectPlatform("https://example.com/feed?source=medium.com")).toBe("rss");
  });

  it("uses the Substack essay identity and keeps the RSS body", () => {
    const item = rssItemToFeedItem(
      {
        title: "A Deep Thought",
        link: "https://writer.substack.com/p/deep-thought?utm_source=feed#section",
        guid: "legacy-guid",
        contentSnippet: "Short excerpt",
        content: "<p>Full essay body &amp; detail.</p><p>Second paragraph.</p>",
      },
      feed("https://writer.substack.com/feed", {}),
    );

    expect(item).toMatchObject({
      globalId:
        "substack:essay:https%3A%2F%2Fwriter.substack.com%2Fp%2Fdeep-thought",
      platform: "substack",
      contentType: "article",
      content: {
        text: "Full essay body & detail.\n\nSecond paragraph.",
      },
      author: {
        id: "https://writer.substack.com/",
        handle: "writer",
      },
    });
  });

  it("uses the Medium story identity for short publication entries", () => {
    const item = rssItemToFeedItem(
      {
        title: "Compact but complete",
        link: "https://medium.com/@ada/compact-but-complete-abcdef?sk=secret&utm_source=rss",
        content: "<p>A short essay.</p>",
      },
      feed("https://medium.com/feed/@ada", {}),
    );

    expect(item.globalId).toBe(
      "medium:story:https%3A%2F%2Fmedium.com%2F%40ada%2Fcompact-but-complete-abcdef",
    );
    expect(item.platform).toBe("medium");
    expect(item.contentType).toBe("article");
    expect(item.content.text).toBe("A short essay.");
    expect(item.author).toMatchObject({
      id: "https://medium.com/@ada",
      handle: "ada",
    });
  });

  it("recognizes a Medium custom domain feed from its generator", () => {
    const customFeed = feed("https://essays.example.com/feed", {});
    customFeed.generator = "Medium";
    const item = rssItemToFeedItem(
      {
        title: "A custom domain story",
        link: "https://essays.example.com/a-custom-domain-story-abcdef",
        creator: "Ada Lovelace",
        content: "<p>The full custom domain essay.</p>",
      },
      customFeed,
    );

    expect(item).toMatchObject({
      globalId:
        "medium:story:https%3A%2F%2Fessays.example.com%2Fa-custom-domain-story-abcdef",
      platform: "medium",
      contentType: "article",
      author: { id: "https://essays.example.com/" },
    });
  });

  it("uses the publication URL for a Medium publication feed", () => {
    const publicationFeed = feed("https://medium.com/feed/better-programming", {});
    publicationFeed.link = "https://medium.com/better-programming";
    const item = rssItemToFeedItem(
      {
        title: "A publication story",
        link: "https://medium.com/better-programming/a-publication-story-abcdef",
        creator: "Ada Lovelace",
        content: "<p>The full publication essay.</p>",
      },
      publicationFeed,
    );

    expect(item.author.id).toBe("https://medium.com/better-programming");
  });

  it("preserves generator metadata from raw custom-domain RSS", async () => {
    const parsed = await parseFeedXml(
      `<?xml version="1.0" encoding="UTF-8"?>
       <rss version="2.0">
         <channel>
           <title>Deep Writing</title>
           <link>https://essays.example.com</link>
           <generator>Medium</generator>
           <item>
             <title>From XML</title>
             <link>https://essays.example.com/from-xml-abcdef</link>
             <description>A complete entry.</description>
           </item>
         </channel>
       </rss>`,
      "https://essays.example.com/feed",
    );

    expect(parsed.generator).toBe("Medium");
    expect(rssItemToFeedItem(parsed.items[0], parsed).platform).toBe("medium");
  });

  it("does not classify unrelated generators by a shared prefix", () => {
    const customFeed = feed("https://essays.example.com/feed", {});
    customFeed.generator = "MediumRare CMS";

    expect(
      rssItemToFeedItem(
        {
          title: "A generic post",
          link: "https://essays.example.com/a-generic-post",
          content: "Brief post",
        },
        customFeed,
      ).platform,
    ).toBe("rss");
  });

  it("preserves generic RSS identity and content classification", () => {
    const item = rssItemToFeedItem(
      { guid: "guid-one", link: "https://example.com/one", content: "Brief post" },
      feed("https://example.com/feed", {}),
    );

    expect(item.globalId).toBe("rss:guid-one");
    expect(item.platform).toBe("rss");
    expect(item.contentType).toBe("post");
  });

  it("keeps media URLs and types aligned without treating the article URL as media", () => {
    const item = rssItemToFeedItem(
      {
        link: "https://example.com/essay",
        enclosure: { url: "https://cdn.example.com/audio.mp3", type: "audio/mpeg" },
        "media:content": [
          { $: { url: "https://cdn.example.com/cover.jpg", type: "image/jpeg" } },
          { $: { url: "https://cdn.example.com/clip.mp4", medium: "video" } },
        ],
        content:
          '<p>Body</p><img src="https://cdn.example.com/cover.jpg"><img src="https://cdn.example.com/inline.png">',
      },
      feed("https://example.com/feed", {}),
    );

    expect(item.content.mediaUrls).toEqual([
      "https://cdn.example.com/audio.mp3",
      "https://cdn.example.com/cover.jpg",
      "https://cdn.example.com/clip.mp4",
      "https://cdn.example.com/inline.png",
    ]);
    expect(item.content.mediaTypes).toEqual(["video", "image", "video", "image"]);
    expect(item.content.mediaTypes).toHaveLength(item.content.mediaUrls.length);
  });
});
