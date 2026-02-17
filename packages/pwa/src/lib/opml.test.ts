/**
 * Unit tests for browser-side OPML import/export
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { parseOPML, generateOPML } from "./opml";
import type { OPMLFeedEntry } from "./opml";
import type { RssFeed } from "@freed/shared";

// =============================================================================
// Test fixtures
// =============================================================================

/** Minimal valid OPML with flat feeds (no folders) */
const FLAT_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test Feeds</title></head>
  <body>
    <outline type="rss" text="Hacker News" title="Hacker News" xmlUrl="https://hnrss.org/frontpage" htmlUrl="https://news.ycombinator.com" />
    <outline type="rss" text="The Verge" title="The Verge" xmlUrl="https://www.theverge.com/rss/index.xml" htmlUrl="https://www.theverge.com" />
  </body>
</opml>`;

/** OPML with nested folder structure */
const NESTED_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Organized Feeds</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Ars Technica" xmlUrl="https://feeds.arstechnica.com/arstechnica/index" htmlUrl="https://arstechnica.com" />
      <outline type="rss" text="The Verge" xmlUrl="https://www.theverge.com/rss/index.xml" htmlUrl="https://www.theverge.com" />
    </outline>
    <outline text="News" title="News">
      <outline type="rss" text="Reuters" xmlUrl="https://www.reuters.com/rssFeed/topNews" htmlUrl="https://www.reuters.com" />
    </outline>
    <outline type="rss" text="Unfiled Blog" xmlUrl="https://example.com/feed.xml" />
  </body>
</opml>`;

/** OPML with deeply nested folders */
const DEEP_NESTED_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Deep Nesting</title></head>
  <body>
    <outline text="Top Level">
      <outline text="Sub Category">
        <outline type="rss" text="Deep Feed" xmlUrl="https://deep.example.com/rss" />
      </outline>
    </outline>
  </body>
</opml>`;

/** OPML with special XML characters in titles */
const SPECIAL_CHARS_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Special Characters</title></head>
  <body>
    <outline type="rss" text="Ben &amp; Jerry&apos;s Blog" xmlUrl="https://example.com/feed" htmlUrl="https://example.com" />
    <outline type="rss" text="Q&amp;A Feed" xmlUrl="https://qa.example.com/rss" />
  </body>
</opml>`;

/** OPML with minimal attributes (only xmlUrl, no title/text) */
const MINIMAL_ATTRS_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Minimal</title></head>
  <body>
    <outline xmlUrl="https://example.com/feed1.xml" />
    <outline text="Has Title" xmlUrl="https://example.com/feed2.xml" />
  </body>
</opml>`;

/** Feedly-style OPML export (uses category attribute) */
const FEEDLY_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head><title>Feedly subscriptions</title></head>
  <body>
    <outline text="tech" title="tech">
      <outline type="rss" text="TechCrunch" title="TechCrunch" xmlUrl="https://techcrunch.com/feed/" htmlUrl="https://techcrunch.com" category="tech" />
    </outline>
    <outline type="rss" text="Uncategorized" title="Uncategorized" xmlUrl="https://uncategorized.example.com/rss" />
  </body>
</opml>`;

// =============================================================================
// parseOPML
// =============================================================================

describe("parseOPML", () => {
  it("parses a flat OPML with no folders", () => {
    const feeds = parseOPML(FLAT_OPML);

    expect(feeds).toHaveLength(2);
    expect(feeds[0]).toEqual({
      url: "https://hnrss.org/frontpage",
      title: "Hacker News",
      siteUrl: "https://news.ycombinator.com",
      folder: undefined,
    });
    expect(feeds[1]).toEqual({
      url: "https://www.theverge.com/rss/index.xml",
      title: "The Verge",
      siteUrl: "https://www.theverge.com",
      folder: undefined,
    });
  });

  it("parses nested folders and assigns folder names", () => {
    const feeds = parseOPML(NESTED_OPML);

    expect(feeds).toHaveLength(4);

    // Tech folder feeds
    expect(feeds[0]).toMatchObject({
      url: "https://feeds.arstechnica.com/arstechnica/index",
      title: "Ars Technica",
      folder: "Tech",
    });
    expect(feeds[1]).toMatchObject({
      url: "https://www.theverge.com/rss/index.xml",
      title: "The Verge",
      folder: "Tech",
    });

    // News folder
    expect(feeds[2]).toMatchObject({
      url: "https://www.reuters.com/rssFeed/topNews",
      title: "Reuters",
      folder: "News",
    });

    // Unfiled feed — no folder
    expect(feeds[3]).toMatchObject({
      url: "https://example.com/feed.xml",
      title: "Unfiled Blog",
      folder: undefined,
    });
  });

  it("handles deeply nested folders (uses innermost folder name)", () => {
    const feeds = parseOPML(DEEP_NESTED_OPML);

    expect(feeds).toHaveLength(1);
    expect(feeds[0]).toMatchObject({
      url: "https://deep.example.com/rss",
      title: "Deep Feed",
      folder: "Sub Category",
    });
  });

  it("handles special XML characters in titles", () => {
    const feeds = parseOPML(SPECIAL_CHARS_OPML);

    expect(feeds).toHaveLength(2);
    expect(feeds[0].title).toBe("Ben & Jerry's Blog");
    expect(feeds[1].title).toBe("Q&A Feed");
  });

  it("defaults to 'Untitled Feed' when text/title are missing", () => {
    const feeds = parseOPML(MINIMAL_ATTRS_OPML);

    expect(feeds).toHaveLength(2);
    expect(feeds[0].title).toBe("Untitled Feed");
    expect(feeds[1].title).toBe("Has Title");
  });

  it("parses Feedly-style exports correctly", () => {
    const feeds = parseOPML(FEEDLY_OPML);

    expect(feeds).toHaveLength(2);
    expect(feeds[0]).toMatchObject({
      url: "https://techcrunch.com/feed/",
      title: "TechCrunch",
      folder: "tech",
    });
    expect(feeds[1]).toMatchObject({
      url: "https://uncategorized.example.com/rss",
      folder: undefined,
    });
  });

  // -- Error cases --

  it("throws on malformed XML", () => {
    expect(() => parseOPML("not xml at all <<<<")).toThrow("Invalid OPML");
  });

  it("throws on missing <body> element", () => {
    const noBody = `<?xml version="1.0"?><opml><head></head></opml>`;
    expect(() => parseOPML(noBody)).toThrow("missing <body>");
  });

  it("throws on empty OPML (body with no feeds)", () => {
    const emptyBody = `<?xml version="1.0"?>
      <opml version="2.0">
        <head><title>Empty</title></head>
        <body>
          <outline text="Empty Folder" />
        </body>
      </opml>`;
    expect(() => parseOPML(emptyBody)).toThrow("No feeds found");
  });
});

// =============================================================================
// generateOPML
// =============================================================================

describe("generateOPML", () => {
  const makeFeed = (overrides: Partial<RssFeed> & { url: string; title: string }): RssFeed => ({
    enabled: true,
    trackUnread: false,
    ...overrides,
  });

  it("generates valid OPML from flat feeds", () => {
    const feeds: RssFeed[] = [
      makeFeed({ url: "https://example.com/feed", title: "Example", siteUrl: "https://example.com" }),
      makeFeed({ url: "https://other.com/rss", title: "Other" }),
    ];

    const xml = generateOPML(feeds);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<opml version="2.0">');
    expect(xml).toContain('xmlUrl="https://example.com/feed"');
    expect(xml).toContain('htmlUrl="https://example.com"');
    expect(xml).toContain('text="Other"');
    // Feed without siteUrl should NOT have htmlUrl attribute
    expect(xml).not.toContain('xmlUrl="https://other.com/rss" htmlUrl');
  });

  it("groups feeds by folder", () => {
    const feeds: RssFeed[] = [
      makeFeed({ url: "https://a.com/feed", title: "A", folder: "Tech" }),
      makeFeed({ url: "https://b.com/feed", title: "B", folder: "Tech" }),
      makeFeed({ url: "https://c.com/feed", title: "C" }),
    ];

    const xml = generateOPML(feeds);

    // Should have a folder outline wrapping Tech feeds
    expect(xml).toContain('text="Tech" title="Tech"');
    // Unfiled feed should be at body level
    expect(xml).toContain('text="C"');
  });

  it("escapes XML special characters", () => {
    const feeds: RssFeed[] = [
      makeFeed({ url: "https://example.com/feed?a=1&b=2", title: 'Ben & Jerry\'s "Blog"' }),
    ];

    const xml = generateOPML(feeds);

    expect(xml).toContain("&amp;");
    expect(xml).toContain("&quot;");
    expect(xml).not.toContain("& ");
  });

  it("uses custom title", () => {
    const xml = generateOPML(
      [makeFeed({ url: "https://x.com/feed", title: "X" })],
      "My Custom Subscriptions",
    );

    expect(xml).toContain("<title>My Custom Subscriptions</title>");
  });

  it("includes dateCreated in ISO format", () => {
    const xml = generateOPML([
      makeFeed({ url: "https://x.com/feed", title: "X" }),
    ]);

    // Should match ISO 8601 date in <dateCreated>
    expect(xml).toMatch(/<dateCreated>\d{4}-\d{2}-\d{2}T/);
  });
});

// =============================================================================
// Round-trip: parse → generate → parse
// =============================================================================

describe("round-trip", () => {
  it("preserves feeds through parse → generate → parse", () => {
    // Parse original
    const original = parseOPML(NESTED_OPML);

    // Convert to RssFeed format for generation
    const rssFeeds: RssFeed[] = original.map((f) => ({
      url: f.url,
      title: f.title,
      siteUrl: f.siteUrl,
      folder: f.folder,
      enabled: true,
      trackUnread: false,
    }));

    // Generate OPML
    const xml = generateOPML(rssFeeds);

    // Parse again
    const roundTripped = parseOPML(xml);

    // Same number of feeds
    expect(roundTripped).toHaveLength(original.length);

    // Each feed should match (url, title, folder)
    for (let i = 0; i < original.length; i++) {
      expect(roundTripped[i].url).toBe(original[i].url);
      expect(roundTripped[i].title).toBe(original[i].title);
      expect(roundTripped[i].folder).toBe(original[i].folder);
    }
  });

  it("preserves special characters through round-trip", () => {
    const original = parseOPML(SPECIAL_CHARS_OPML);

    const rssFeeds: RssFeed[] = original.map((f) => ({
      url: f.url,
      title: f.title,
      siteUrl: f.siteUrl,
      enabled: true,
      trackUnread: false,
    }));

    const xml = generateOPML(rssFeeds);
    const roundTripped = parseOPML(xml);

    expect(roundTripped[0].title).toBe(original[0].title);
    expect(roundTripped[1].title).toBe(original[1].title);
  });

  it("maintains URL integrity through round-trip", () => {
    const trickyFeeds: RssFeed[] = [
      {
        url: "https://example.com/feed?format=rss&lang=en",
        title: "Query Params Feed",
        enabled: true,
        trackUnread: false,
      },
      {
        url: "https://example.com/feed/v2",
        title: "Path Feed",
        siteUrl: "https://example.com/blog?ref=rss&utm_source=feed",
        enabled: true,
        trackUnread: false,
      },
    ];

    const xml = generateOPML(trickyFeeds);
    const parsed = parseOPML(xml);

    expect(parsed[0].url).toBe(trickyFeeds[0].url);
    expect(parsed[1].url).toBe(trickyFeeds[1].url);
    expect(parsed[1].siteUrl).toBe(trickyFeeds[1].siteUrl);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe("edge cases", () => {
  it("handles single-feed OPML", () => {
    const single = `<?xml version="1.0"?>
      <opml version="2.0">
        <head><title>Single</title></head>
        <body>
          <outline type="rss" text="Solo" xmlUrl="https://solo.com/feed" />
        </body>
      </opml>`;

    const feeds = parseOPML(single);
    expect(feeds).toHaveLength(1);
    expect(feeds[0].title).toBe("Solo");
  });

  it("handles OPML without XML declaration", () => {
    const noDecl = `<opml version="2.0">
      <head><title>No Declaration</title></head>
      <body>
        <outline type="rss" text="Feed" xmlUrl="https://example.com/feed" />
      </body>
    </opml>`;

    const feeds = parseOPML(noDecl);
    expect(feeds).toHaveLength(1);
  });

  it("deduplicates by URL when same feed appears in multiple folders", () => {
    const duped = `<?xml version="1.0"?>
      <opml version="2.0">
        <head><title>Dupes</title></head>
        <body>
          <outline text="Folder A">
            <outline type="rss" text="Feed" xmlUrl="https://example.com/feed" />
          </outline>
          <outline text="Folder B">
            <outline type="rss" text="Feed" xmlUrl="https://example.com/feed" />
          </outline>
        </body>
      </opml>`;

    // parseOPML doesn't deduplicate — that's the importer's job
    const feeds = parseOPML(duped);
    expect(feeds).toHaveLength(2);
    expect(feeds[0].folder).toBe("Folder A");
    expect(feeds[1].folder).toBe("Folder B");
  });

  it("generates valid OPML with zero feeds (edge but valid)", () => {
    const xml = generateOPML([]);
    expect(xml).toContain("<opml");
    expect(xml).toContain("</body>");
    // Should be parseable (though parseOPML would throw "No feeds found")
    expect(() => parseOPML(xml)).toThrow("No feeds found");
  });

  it("handles large feed lists efficiently", () => {
    const feeds: RssFeed[] = Array.from({ length: 200 }, (_, i) => ({
      url: `https://feed${i}.example.com/rss`,
      title: `Feed ${i}`,
      folder: `Folder ${i % 5}`,
      enabled: true,
      trackUnread: false,
    }));

    const xml = generateOPML(feeds);
    const parsed = parseOPML(xml);

    expect(parsed).toHaveLength(200);
  });
});
