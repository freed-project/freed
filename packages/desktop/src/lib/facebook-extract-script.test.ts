import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

type FbFeedEvent = {
  posts?: Array<{
    id: string | null;
    authorName: string | null;
    authorProfileUrl: string | null;
    text: string | null;
    strategy?: string;
  }>;
  strategy?: string;
  candidateCount?: number;
  scrapeRunId?: string | null;
  error?: string;
};

const scriptPath = join(process.cwd(), "src-tauri/src/fb-extract.js");
const extractScript = readFileSync(scriptPath, "utf8");

function runFacebookExtractor(html: string): FbFeedEvent {
  const events: FbFeedEvent[] = [];
  document.documentElement.innerHTML = html;
  Object.defineProperty(document, "cookie", {
    value: "c_user=123; xs=session",
    configurable: true,
  });
  Object.defineProperty(window, "scrollY", {
    value: 0,
    configurable: true,
  });
  Object.defineProperty(window, "__TAURI__", {
    value: {
      event: {
        emit(name: string, payload: FbFeedEvent) {
          if (name === "fb-feed-data") events.push(payload);
        },
      },
    },
    configurable: true,
  });

  window.eval(extractScript);
  expect(events).toHaveLength(1);
  return events[0];
}

describe("Facebook injected extractor", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "";
    Reflect.deleteProperty(window, "__FREED_FB_SCRAPE_RUN_ID");
  });

  it("extracts a feed post without the legacy Feed posts heading", () => {
    const event = runFacebookExtractor(`
      <body>
        <div role="main">
          <div role="article" data-freed-test-height="420">
            <a aria-label="Zana Prana" href="https://www.facebook.com/zana.prana"></a>
            <a href="https://www.facebook.com/zana.prana/posts/pfbid02abc">3 hours ago</a>
            <div dir="auto">Europe is calling, and we are listening. See you all soon.</div>
          </div>
        </div>
      </body>
    `);

    expect(event.error).toBeUndefined();
    expect(event.strategy).toBe("role-main-fallback");
    expect(event.candidateCount).toBe(1);
    expect(event.posts).toHaveLength(1);
    expect(event.posts?.[0]).toMatchObject({
      id: "pfbid02abc",
      authorName: "Zana Prana",
      authorProfileUrl: "https://www.facebook.com/zana.prana",
      text: "Europe is calling, and we are listening. See you all soon.",
    });
  });

  it("climbs from feed-unit markers to the enclosing post", () => {
    const event = runFacebookExtractor(`
      <body>
        <section>
          <div data-freed-test-height="520">
            <div data-pagelet="FeedUnit_7">
              <a aria-label="Gabriel Bakker" href="https://www.facebook.com/gabriel.bakker.1"></a>
              <a href="https://www.facebook.com/groups/local-builders/permalink/987654321">about 1 month ago</a>
              <div dir="auto">A community update with enough text to be treated as content.</div>
            </div>
          </div>
        </section>
      </body>
    `);

    expect(event.error).toBeUndefined();
    expect(event.strategy).toBe("document-feedunit-fallback");
    expect(event.candidateCount).toBe(1);
    expect(event.posts).toHaveLength(1);
    expect(event.posts?.[0]).toMatchObject({
      id: "987654321",
      authorName: "Gabriel Bakker",
      authorProfileUrl: "https://www.facebook.com/gabriel.bakker.1",
      text: "A community update with enough text to be treated as content.",
    });
  });

  it("emits the native scrape run id with extraction batches", () => {
    Object.defineProperty(window, "__FREED_FB_SCRAPE_RUN_ID", {
      value: "fb-test-run",
      configurable: true,
    });

    const event = runFacebookExtractor(`
      <body>
        <div role="main">
          <div role="article" data-freed-test-height="420">
            <a aria-label="Zana Prana" href="https://www.facebook.com/zana.prana"></a>
            <a href="https://www.facebook.com/zana.prana/posts/pfbid02abc">3 hours ago</a>
            <div dir="auto">Europe is calling, and we are listening. See you all soon.</div>
          </div>
        </div>
      </body>
    `);

    expect(event.scrapeRunId).toBe("fb-test-run");
  });
});
