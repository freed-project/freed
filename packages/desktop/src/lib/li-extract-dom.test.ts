import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  resolve(process.cwd(), "src-tauri/src/li-extract.js"),
  "utf8",
);

function runExtractor(html: string) {
  const dom = new JSDOM(html, {
    url: "https://www.linkedin.com/feed/",
    runScripts: "outside-only",
  });
  Object.defineProperty(dom.window, "scrollY", {
    configurable: true,
    value: 0,
  });
  Object.defineProperty(dom.window, "__TAURI__", {
    value: {
      event: {
        emit(name: string, data: Record<string, unknown>) {
          payloads.push({ name, data });
        },
      },
    },
  });
  const payloads: Array<{ name: string; data: Record<string, unknown> }> = [];

  dom.window.eval(script);
  return payloads.find((payload) => payload.name === "li-feed-data")?.data;
}

describe("LinkedIn DOM extractor", () => {
  it("extracts posts from activity URN containers", () => {
    const payload = runExtractor(`
      <main role="main">
        <div class="scaffold-finite-scroll__content">
          <div class="feed-shared-update-v2" data-urn="urn:li:activity:12345">
            <div class="update-components-actor__name"><span aria-hidden="true">Alice Example</span></div>
            <a class="app-aware-link" href="https://www.linkedin.com/in/alice-example/"></a>
            <div class="update-components-text">A useful LinkedIn post with enough text to keep.</div>
          </div>
        </div>
      </main>
    `);

    expect(payload?.candidateCount).toBe(1);
    expect(payload?.posts).toEqual([
      expect.objectContaining({
        urn: "urn:li:activity:12345",
        authorName: "Alice Example",
        text: "A useful LinkedIn post with enough text to keep.",
      }),
    ]);
    expect(payload?.pageState).toMatchObject({
      mainFound: true,
      candidateCount: 1,
      extractedPostCount: 1,
      activityUrnCount: 1,
    });
  });

  it("emits page-state diagnostics when no posts are found", () => {
    const payload = runExtractor(`
      <main role="main">
        <h1>Feed</h1>
        <p>No updates are available right now.</p>
      </main>
    `);

    expect(payload?.candidateCount).toBe(0);
    expect(payload?.posts).toEqual([]);
    expect(payload?.pageState).toMatchObject({
      mainFound: true,
      candidateCount: 0,
      extractedPostCount: 0,
      activityUrnCount: 0,
      dataUrnCount: 0,
    });
  });

  it("extracts current semantic feed posts without legacy classes or URNs", () => {
    const html = `
      <main role="main">
        <section class="feed">
          <div class="current-post-shell">
            <header>
              <h2>Feed post</h2>
              <a href="https://www.linkedin.com/in/person-who-liked-this/">Person Who Liked This</a>
              <a href="https://www.linkedin.com/in/alice-example/" aria-label="View Alice Example's profile"></a>
              <span>2h</span>
              <button aria-label="Open control menu for post by Alice Example">Menu</button>
            </header>
            <p>A current LinkedIn post with semantic markup and enough text to extract.</p>
            <footer>
              <button aria-label="12 reactions">12 reactions</button>
              <button aria-label="3 comments">3 comments</button>
              <button aria-label="1 repost">1 repost</button>
              <button aria-label="Like">Like</button>
            </footer>
          </div>
          <div class="current-post-shell">
            <header>
              <h2>Feed post</h2>
              <a href="https://www.linkedin.com/company/example-co/">Example Co</a>
              <span>Promoted</span>
            </header>
            <div dir="ltr">A promoted post that must not enter the library.</div>
            <footer><button aria-label="Like">Like</button></footer>
          </div>
        </section>
      </main>
    `;

    const firstPayload = runExtractor(html);
    const secondPayload = runExtractor(html);

    expect(firstPayload?.candidateCount).toBe(2);
    expect(firstPayload?.posts).toEqual([
      expect.objectContaining({
        urn: expect.stringMatching(/^urn:freed:linkedin:content:[0-9a-f]{8}$/),
        url: null,
        authorName: "Alice Example",
        authorProfileUrl: "https://www.linkedin.com/in/alice-example/",
        text: "A current LinkedIn post with semantic markup and enough text to extract.",
        timestampRelative: "2h",
        reactionCount: 12,
        commentCount: 3,
        repostCount: 1,
      }),
    ]);
    const firstPosts = firstPayload?.posts as Array<{ urn: string }>;
    const secondPosts = secondPayload?.posts as Array<{ urn: string }>;
    expect(secondPosts[0]?.urn).toBe(firstPosts[0]?.urn);
    expect(firstPayload?.pageState).toMatchObject({
      candidateCount: 2,
      extractedPostCount: 1,
      semanticFeedPostHeadingCount: 2,
    });
  });
});
