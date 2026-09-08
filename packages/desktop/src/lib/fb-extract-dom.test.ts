import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  resolve(process.cwd(), "src-tauri/src/fb-extract.js"),
  "utf8",
);

function runExtractor(
  html: string,
  options: {
    authenticated?: boolean;
    scrollHeight?: number;
    beforeExtract?: (dom: JSDOM) => void;
  } = {},
) {
  const dom = new JSDOM(html, {
    url: "https://www.facebook.com/",
    runScripts: "outside-only",
  });
  if (typeof options.scrollHeight === "number") {
    Object.defineProperty(dom.window.document.documentElement, "scrollHeight", {
      configurable: true,
      value: options.scrollHeight,
    });
  }
  if (options.authenticated !== false) {
    dom.window.document.cookie = "c_user=12345";
  }
  const payloads: Array<{ name: string; data: Record<string, unknown> }> = [];
  Object.defineProperty(dom.window, "__TAURI__", {
    value: {
      event: {
        emit(name: string, data: Record<string, unknown>) {
          payloads.push({ name, data });
        },
      },
    },
  });

  options.beforeExtract?.(dom);

  dom.window.eval(script);
  return payloads.find((payload) => payload.name === "fb-feed-data")?.data;
}

describe("Facebook DOM extractor", () => {
  it("reports an auth error when Facebook renders the logged-out shell", () => {
    const payload = runExtractor(
      `
        <main>
          <h1>Facebook</h1>
          <button>Log in</button>
          <a>Create new account</a>
        </main>
      `,
      { authenticated: false },
    );

    expect(payload?.strategy).toBe("not_authenticated");
    expect(payload?.candidateCount).toBe(0);
    expect(payload?.posts).toEqual([]);
    expect(payload?.error).toContain("Reconnect Facebook");
    expect(payload?.pageState).toMatchObject({
      state: "not_authenticated",
      loggedInCookie: false,
    });
  });

  it("extracts modern role article feed units without relying on the Feed posts heading", () => {
    const payload = runExtractor(`
      <div role="main">
        <div role="article">
          <h3><a href="https://www.facebook.com/alice.example">Alice Example</a></h3>
          <a href="https://www.facebook.com/groups/my-group/posts/123456789">1 h</a>
          <div dir="auto">This is a real Facebook post with enough text to clear the content heuristic.</div>
        </div>
      </div>
    `);

    expect(payload?.strategy).toBe("role-main-fallback");
    expect(payload?.candidateCount).toBe(1);
    expect(payload?.posts).toEqual([
      expect.objectContaining({
        id: "123456789",
        authorName: "Alice Example",
        authorProfileUrl: "https://www.facebook.com/alice.example",
        text: "This is a real Facebook post with enough text to clear the content heuristic.",
      }),
    ]);
  });

  it("accepts rendered feed evidence when the Facebook session cookie is not script-readable", () => {
    const payload = runExtractor(
      `
        <div role="main">
          <div role="article">
            <h3><a href="https://www.facebook.com/alice.example">Alice Example</a></h3>
            <a href="https://www.facebook.com/alice.example/posts/123456789">1 h</a>
            <div dir="auto">A rendered feed post should prove the page is scrapeable even when c_user is hidden from document.cookie.</div>
          </div>
        </div>
      `,
      { authenticated: false },
    );

    expect(payload?.strategy).toBe("role-main-fallback");
    expect(payload?.pageState).toMatchObject({
      state: "feed_possible",
      loggedInCookie: false,
      feedLike: true,
      feedUnitCount: 1,
    });
    expect(payload?.candidateCount).toBe(1);
    expect(payload?.posts).toEqual([
      expect.objectContaining({
        id: "123456789",
        authorName: "Alice Example",
      }),
    ]);
  });

  it("does not treat a tall logged-out shell as a feed", () => {
    const payload = runExtractor(
      `
        <div role="main">
          <section style="min-height: 2400px">
            <h1>Facebook</h1>
            <button>Log in</button>
            <a>Create new account</a>
            <div>Suggested pages and generic logged-out chrome can make this page tall.</div>
          </section>
        </div>
      `,
      { authenticated: false, scrollHeight: 3200 },
    );

    expect(payload?.strategy).toBe("not_authenticated");
    expect(payload?.pageState).toMatchObject({
      state: "not_authenticated",
      feedLike: false,
      feedUnitCount: 0,
      loginChrome: true,
      scrollHeight: 3200,
    });
  });

  it("reports author rejections when Facebook renders non-post chrome as candidates", () => {
    const payload = runExtractor(`
      <div role="main">
        <div role="article">
          <h3><a href="https://www.facebook.com/bookmarks">Your shortcuts</a></h3>
          <div dir="auto">This chrome block is tall and text-heavy, but it is not a real post.</div>
        </div>
      </div>
    `);

    expect(payload?.candidateCount).toBe(1);
    expect(payload?.posts).toEqual([]);
    expect(payload?.rejected).toMatchObject({ missingAuthor: 1 });
  });

  it("extracts post blocks without role article or measurable height", () => {
    const payload = runExtractor(`
      <div role="main">
        <section>
          <div>
            <div>
              <h3><a href="https://www.facebook.com/bob.example">Bob Example</a></h3>
              <a href="https://www.facebook.com/bob.example/posts/987654321">2 h</a>
              <div dir="auto">Facebook sometimes hides useful feed structure from automation, but this plain block is still a real post.</div>
            </div>
          </div>
        </section>
      </div>
    `);

    expect(payload?.strategy).toBe("role-main-fallback");
    expect(payload?.candidateCount).toBe(1);
    expect(payload?.posts).toEqual([
      expect.objectContaining({
        id: "987654321",
        authorName: "Bob Example",
        authorProfileUrl: "https://www.facebook.com/bob.example",
        text: "Facebook sometimes hides useful feed structure from automation, but this plain block is still a real post.",
      }),
    ]);
  });

  it("climbs from post permalinks when semantic article boundaries are missing", () => {
    const payload = runExtractor(`
      <div role="main">
        <section>
          <div>
            <div>
              <h3><a href="https://www.facebook.com/ada.example">Ada Example</a></h3>
              <a href="https://www.facebook.com/ada.example/posts/123456789">Open post</a>
              <div dir="auto">A permalink can be the only reliable post boundary on the current Facebook feed.</div>
            </div>
          </div>
        </section>
      </div>
    `);

    expect(payload?.candidateCount).toBe(1);
    expect(payload?.posts).toEqual([
      expect.objectContaining({
        id: "123456789",
        authorName: "Ada Example",
        authorProfileUrl: "https://www.facebook.com/ada.example",
        text: "A permalink can be the only reliable post boundary on the current Facebook feed.",
      }),
    ]);
  });

  it("excludes an accessible Sponsored placement before clicking See more", () => {
    let clicks = 0;
    const payload = runExtractor(
      `
        <div role="main">
          <div role="article">
            <h3><a href="https://www.facebook.com/keeps.example">Keeps</a></h3>
            <span aria-label="Sponsored"><span>S</span><span>ponsored</span></span>
            <button aria-label="See more">See more</button>
            <a href="https://www.facebook.com/keeps.example/posts/555">1 h</a>
            <div dir="auto">Commercial placement content that must never enter capture.</div>
          </div>
        </div>
      `,
      {
        beforeExtract(dom) {
          dom.window.document.querySelector("button")?.addEventListener("click", () => {
            clicks += 1;
          });
        },
      },
    );

    expect(payload?.posts).toEqual([]);
    expect(payload?.rejected).toMatchObject({
      advertising: 1,
      recommendation: 0,
      inspectedPlacements: 1,
    });
    expect(clicks).toBe(0);
  });

  it("reconstructs split disclosure text in the placement header", () => {
    const payload = runExtractor(`
      <div role="main">
        <div role="article">
          <header><h3><a href="https://www.facebook.com/brand.example">Brand</a></h3><span>S</span><span>pon</span><span>sored</span></header>
          <a href="https://www.facebook.com/brand.example/posts/777">1 h</a>
          <div dir="auto">A paid placement with a split disclosure.</div>
        </div>
      </div>
    `);

    expect(payload?.posts).toEqual([]);
    expect(payload?.rejected).toMatchObject({ advertising: 1 });
  });

  it("does not classify post body prose or hidden decoys as advertising", () => {
    const payload = runExtractor(`
      <div role="main">
        <div role="article">
          <h3><a href="https://www.facebook.com/writer.example">Writer Example</a></h3>
          <span aria-label="Sponsored" aria-hidden="true">Sponsored</span>
          <a href="https://www.facebook.com/writer.example/posts/888">1 h</a>
          <div dir="auto">A discussion of sponsored research belongs in the organic post body.</div>
        </div>
      </div>
    `);

    expect(payload?.posts).toHaveLength(1);
    expect(payload?.posts).toEqual([
      expect.objectContaining({
        id: "888",
        admission: expect.objectContaining({
          decision: "admit",
          inspectionStatus: "complete",
          surface: "feed",
        }),
      }),
    ]);
  });

  it("defers an unresolved partial disclosure instead of admitting it", () => {
    const payload = runExtractor(`
      <div role="main">
        <div role="article">
          <h3><a href="https://www.facebook.com/unclear.example">Unclear</a></h3>
          <span aria-label="Spons">Spons</span>
          <a href="https://www.facebook.com/unclear.example/posts/999">1 h</a>
          <div dir="auto">This placement remains unresolved.</div>
        </div>
      </div>
    `);

    expect(payload?.posts).toEqual([]);
    expect(payload?.rejected).toMatchObject({
      advertising: 0,
      deferredAdvertising: 1,
    });
  });
});
