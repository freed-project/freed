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
