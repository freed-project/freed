import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

type IgFeedEvent = {
  posts?: Array<{
    shortcode: string | null;
    authorHandle: string | null;
    caption: string | null;
    mediaUrls: string[];
  }>;
  strategy?: string;
  candidateCount?: number;
  rejected?: {
    suggestedOrSponsored?: number;
    tinyOrInvisible?: number;
    missingContent?: number;
  };
  error?: string;
};

const scriptPath = join(process.cwd(), "src-tauri/src/ig-extract.js");
const extractScript = readFileSync(scriptPath, "utf8");

function runInstagramExtractor(html: string): IgFeedEvent {
  const events: IgFeedEvent[] = [];
  document.documentElement.innerHTML = html;
  Object.defineProperty(document, "cookie", {
    value: "sessionid=abc123",
    configurable: true,
  });
  Object.defineProperty(window, "scrollY", {
    value: 0,
    configurable: true,
  });
  Object.defineProperty(window, "__TAURI__", {
    value: {
      event: {
        emit(name: string, payload: IgFeedEvent) {
          if (name === "ig-feed-data") events.push(payload);
        },
      },
    },
    configurable: true,
  });

  window.eval(extractScript);
  expect(events).toHaveLength(1);
  return events[0];
}

describe("Instagram injected extractor", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "";
  });

  it.each([
    { name: "personal suggested caption", caption: "A friend suggested this beautiful hiking trail for our weekend walk.", count: 1 },
    { name: "discussion of suggested posts", caption: "We discussed suggested posts and how feeds shape our communities.", count: 1 },
    { name: "commercial organic", caption: "Our handmade mugs are available in the shop this week.", count: 1 },
    { name: "Suggested for you header", header: "<span>Suggested for you</span>", count: 0 },
    { name: "Suggested Posts header", header: "<div>Suggested Posts</div>", count: 0 },
    { name: "Reels header", header: "Reels you might like", count: 0 },
    { name: "author display name", author: "<span>Suggested Posts</span>", count: 1 },
    { name: "longer header phrase", header: "<span>Suggested by neighbors</span>", count: 1 },
    { name: "non-followed header", header: "<button>Follow</button>", count: 0 },
  ])("checks recommendation labels only in the post header: $name", (fixture) => {
    const event = runInstagramExtractor(`
      <body><main><article data-freed-test-height="520">
        <header>
          <a href="https://www.instagram.com/synthetic.example/">${fixture.author ?? "synthetic.example"}</a>
          ${fixture.header ?? ""}
        </header>
        <a href="https://www.instagram.com/p/synthetic123/">Open post</a>
        <div dir="auto">${fixture.caption ?? "An ordinary synthetic caption with enough text."}</div>
        <img src="https://scontent.cdninstagram.com/synthetic.jpg" width="640" height="640" />
      </article></main></body>
    `);
    expect(event.error).toBeUndefined();
    expect(event.candidateCount).toBe(1);
    expect(event.posts).toHaveLength(fixture.count);
    expect(event.rejected).toMatchObject({ suggestedOrSponsored: 1 - fixture.count });
    if (fixture.count === 1) {
      expect(event.posts?.[0]).toMatchObject({
        shortcode: "synthetic123",
        mediaUrls: ["https://scontent.cdninstagram.com/synthetic.jpg"],
      });
    }
  });

  it.each([
    { name: "plain header span", disclosure: "<span>Sponsored</span>", count: 0 },
    { name: "plain header div", disclosure: "<div> Sponsored </div>", count: 0 },
    { name: "direct header text", disclosure: "Sponsored", count: 0 },
    { name: "accessible header", disclosure: '<span aria-label="Sponsored">Sponsored</span>', count: 0 },
    { name: "commercial organic", caption: "Our handmade mugs are available in the shop this week.", count: 1 },
    { name: "caption discussion", caption: "We discussed how sponsored posts affect our community today.", count: 1 },
    { name: "caption marker", caption: "<span>Sponsored</span>", count: 1 },
    { name: "author display name", author: "<span>Sponsored</span>", count: 1 },
    { name: "header phrase", disclosure: "<span>Sponsored by local volunteers</span>", count: 1 },
  ])("scopes plain Sponsored disclosure to the header: $name", (fixture) => {
    const caption = fixture.caption ?? "A synthetic product announcement with enough text.";
    const event = runInstagramExtractor(`
      <body><main><article data-freed-test-height="520">
        <header>
          <a href="https://www.instagram.com/synthetic.example/">${fixture.author ?? "synthetic.example"}</a>
          ${fixture.disclosure ?? ""}
        </header>
        <a href="https://www.instagram.com/p/synthetic123/">Open post</a>
        <div dir="auto">${caption}</div>
        <img src="https://scontent.cdninstagram.com/synthetic.jpg" width="640" height="640" />
      </article></main></body>
    `);
    expect(event.error).toBeUndefined();
    expect(event.candidateCount).toBe(1);
    expect(event.posts).toHaveLength(fixture.count);
    expect(event.rejected).toMatchObject({ suggestedOrSponsored: 1 - fixture.count });
    if (fixture.count === 1) {
      expect(event.posts?.[0]).toMatchObject({
        shortcode: "synthetic123",
        authorHandle: "synthetic.example",
        mediaUrls: ["https://scontent.cdninstagram.com/synthetic.jpg"],
      });
    }
  });

  it.each([
    { name: "adjacent split disclosure", header: "<span>Spon</span><span>sored</span>", count: 0 },
    { name: "three split fragments", header: "<span>S</span><span>pon</span><span>sored</span>", count: 0 },
    { name: "nested split disclosure", header: "<div><span>Spon</span><span>sored</span></div>", count: 0 },
    { name: "nested organic phrase", header: "<div><span>Sponsored</span> by local volunteers</div>", count: 1 },
    { name: "nested organic spans", header: "<div><span>Sponsored</span><span> by local volunteers</span></div>", count: 1 },
    { name: "bullet then timestamp", header: "<div><span>Sponsored</span><span>·</span><span>1 h</span></div>", count: 0 },
    { name: "wrapped menu after disclosure", header: "<div><span>Sponsored</span><div><button>Menu</button></div></div>", count: 0 },
    { name: "nested button fragment", header: "<span>Spon</span><span><button>sored</button></span>", count: 1 },
    { name: "overflowing control wrapper", header: `<span>Spon</span><span>${"<span></span>".repeat(65)}<button>sored</button></span>`, count: 1 },
    { name: "nested role button fragment", header: '<span>Spon</span><span><div role="button">sored</div></span>', count: 1 },
    { name: "nested split with timestamp", header: "<div><span>Spon</span><span>sored</span><span>1 h</span></div>", count: 0 },
    { name: "wrapped timestamp", header: "<div><span>Sponsored</span><time>1 h</time></div>", count: 0 },
    { name: "wrapped span timestamp", header: "<div><span>Sponsored</span><span>1 h</span></div>", count: 0 },
    { name: "link separates fragments", header: '<span>Spon</span><a href="/synthetic/">author</a><span>sored</span>', count: 1 },
    { name: "control separates fragments", header: "<span>Spon</span><button>Menu</button><span>sored</span>", count: 1 },
    { name: "block separates fragments", header: "<span>Spon</span><div>Context</div><span>sored</span>", count: 1 },
    { name: "split then direct prose", header: "<span>Spon</span><span>sored</span> by local volunteers", count: 1 },
    { name: "split then span prose", header: "<span>Spon</span><span>sored</span><span> by local volunteers</span>", count: 1 },
    { name: "split then linked author", header: '<span>Spon</span><span>sored</span><span><a href="/synthetic/">author</a></span>', count: 0 },
    { name: "split then timestamp", header: "<span>Spon</span><span>sored</span><time>1 h</time>", count: 0 },
    { name: "split longer phrase", header: "<span>Spon</span><span>sored by local volunteers</span>", count: 1 },
    { name: "split author link", header: '<a href="/synthetic/"><span>Spon</span><span>sored</span></a>', count: 1 },
  ])("preserves disclosure label boundaries: $name", ({ header, count }) => {
    const event = runInstagramExtractor(`<main><article data-freed-test-height="520">
      <header><a href="https://www.instagram.com/synthetic/">synthetic</a>${header}</header>
      <a href="https://www.instagram.com/p/stable/">Open post</a>
      <div dir="auto">A synthetic caption with enough organic text.</div>
      <img src="https://scontent.cdninstagram.com/fixture.jpg" width="640" height="640" />
    </article></main>`);
    expect(event.error).toBeUndefined();
    expect(event.candidateCount).toBe(1);
    expect(event.posts).toHaveLength(count);
    expect(event.rejected?.suggestedOrSponsored).toBe(1 - count);
    if (count) expect(event.posts?.[0]).toMatchObject({shortcode: "stable", mediaUrls: ["https://scontent.cdninstagram.com/fixture.jpg"]});
  });

  it("extracts a single rendered article without requiring div fallback candidates", () => {
    const event = runInstagramExtractor(`
      <body>
        <main>
          <article data-freed-test-height="520">
            <header>
              <a href="https://www.instagram.com/ada.example/">ada.example</a>
            </header>
            <a href="https://www.instagram.com/p/abc123/">Open post</a>
            <time datetime="2026-06-08T20:00:00.000Z"></time>
            <div dir="auto">A real Instagram feed caption with enough text to be captured.</div>
            <img
              src="https://scontent.cdninstagram.com/v/t51.29350-15/example.jpg"
              width="640"
              height="640"
            />
          </article>
          <div data-freed-test-height="900">
            Navigation and recommendations live here, but this is not a feed post.
          </div>
        </main>
      </body>
    `);

    expect(event.error).toBeUndefined();
    expect(event.strategy).toBe("article");
    expect(event.candidateCount).toBe(1);
    expect(event.rejected).toMatchObject({
      tinyOrInvisible: 0,
      missingContent: 0,
    });
    expect(event.posts).toHaveLength(1);
    expect(event.posts?.[0]).toMatchObject({
      shortcode: "abc123",
      authorHandle: "ada.example",
      caption: "A real Instagram feed caption with enough text to be captured.",
      mediaUrls: [
        "https://scontent.cdninstagram.com/v/t51.29350-15/example.jpg",
      ],
    });
  });

  it("extracts a content-bearing article when a hidden WebView reports zero layout height", () => {
    const event = runInstagramExtractor(`
      <body>
        <main>
          <article>
            <header>
              <a href="https://www.instagram.com/hidden.example/">hidden.example</a>
            </header>
            <a href="https://www.instagram.com/p/hidden123/">Open post</a>
            <time datetime="2026-08-14T15:00:00.000Z"></time>
            <div dir="auto">Visible feed content whose hidden WebView has no layout box.</div>
            <img
              src="https://scontent.cdninstagram.com/v/t51.29350-15/hidden.jpg"
              width="640"
              height="640"
            />
          </article>
        </main>
      </body>
    `);

    expect(event.rejected).toMatchObject({ tinyOrInvisible: 0 });
    expect(event.posts).toHaveLength(1);
    expect(event.posts?.[0]).toMatchObject({
      shortcode: "hidden123",
      authorHandle: "hidden.example",
      caption: "Visible feed content whose hidden WebView has no layout box.",
    });
  });

  it("still rejects an empty zero-height placeholder article", () => {
    const event = runInstagramExtractor(`
      <body><main><article><div></div></article></main></body>
    `);

    expect(event.posts).toHaveLength(0);
    expect(event.rejected).toMatchObject({ tinyOrInvisible: 1 });
  });
});
