import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  resolve(process.cwd(), "src-tauri/src/fb-extract.js"),
  "utf8",
);

function runExtractor(html: string) {
  const dom = new JSDOM(html, {
    url: "https://www.facebook.com/",
    runScripts: "outside-only",
  });
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

  dom.window.eval(script);
  return payloads.find((payload) => payload.name === "fb-feed-data")?.data;
}

describe("Facebook DOM extractor", () => {
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
});
