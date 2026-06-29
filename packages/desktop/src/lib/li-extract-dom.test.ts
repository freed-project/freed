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
});
