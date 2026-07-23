import { describe, expect, it } from "vitest";
import { parseFeedXml } from "./browser";
import { generateOPML, parseOPML } from "./opml";

describe("bounded XML parsing", () => {
  it("parses normal RSS and XML entities", async () => {
    const feed = await parseFeedXml(
      `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <title>Security &amp; Privacy</title>
        <link>https://example.com</link>
        <item><title>Safe item</title><link>https://example.com/item</link></item>
      </channel></rss>`,
      "https://example.com/feed.xml",
    );

    expect(feed.title).toBe("Security & Privacy");
    expect(feed.items).toHaveLength(1);
  });

  it("round trips normal OPML after parser hardening", () => {
    const generated = generateOPML(
      [
        {
          url: "https://example.com/feed.xml",
          title: "Example feed",
          siteUrl: "https://example.com",
          enabled: true,
          trackUnread: false,
        },
      ],
      "Security test",
    );

    expect(parseOPML(generated)).toMatchObject([
      {
        url: "https://example.com/feed.xml",
        title: "Example feed",
      },
    ]);
  });

  it("rejects excessive entity expansion before producing a feed", async () => {
    const repeatedEntity = "&a;".repeat(300);
    const malicious = `<?xml version="1.0"?>
      <!DOCTYPE rss [
        <!ENTITY a "1234567890">
      ]>
      <rss version="2.0"><channel><title>${repeatedEntity}</title><link>https://example.com</link></channel></rss>`;

    await expect(parseFeedXml(malicious, "https://example.com/feed.xml")).rejects.toThrow(
      /entity|expansion|expanded/i,
    );
  });
});
