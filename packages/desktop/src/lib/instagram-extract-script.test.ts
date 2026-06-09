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
      mediaUrls: ["https://scontent.cdninstagram.com/v/t51.29350-15/example.jpg"],
    });
  });
});
