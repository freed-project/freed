import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const script = readFileSync(
  resolve(process.cwd(), "src-tauri/src/substack-extract.js"),
  "utf8",
);

function runExtractor(
  html: string,
  options: { scope: "graph" | "activity" | "essays"; relation?: string } = {
    scope: "activity",
  },
) {
  const payloads: Array<{ name: string; data: Record<string, unknown> }> = [];
  document.documentElement.innerHTML = html;
  Object.defineProperty(window, "__FREED_ESSAY_CAPTURE_SCOPE", {
    value: options.scope,
    configurable: true,
  });
  Object.defineProperty(window, "__FREED_ESSAY_RELATION", {
    value: options.relation ?? null,
    configurable: true,
  });
  Object.defineProperty(window, "__FREED_ESSAY_CAPTURE_TOKEN", {
    value: "test-capture",
    configurable: true,
  });
  Object.defineProperty(window, "__TAURI__", {
    value: {
      event: {
        emit(name: string, data: Record<string, unknown>) {
          payloads.push({ name, data });
        },
      },
    },
    configurable: true,
  });

  window.eval(script);
  return payloads.find((payload) => payload.name === "substack-feed-data")?.data;
}

describe("Substack DOM extractor", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "";
    window.sessionStorage.clear();
    delete (window as typeof window & { __FREED_ESSAY_ROSTER_KEY?: string })
      .__FREED_ESSAY_ROSTER_KEY;
    delete (window as typeof window & { __FREED_ESSAY_ROSTER_SEEN?: Set<string> })
      .__FREED_ESSAY_ROSTER_SEEN;
    delete (window as typeof window & { __FREED_ESSAY_ROSTER_IDS?: Set<string> })
      .__FREED_ESSAY_ROSTER_IDS;
  });

  it("canonicalizes publication links into one roster identity", () => {
    const payload = runExtractor(
      `
        <main>
          <section role="listitem">
            <h2>Following</h2>
            <a href="https://deepthoughts.substack.com/p/a-post?utm_source=home">A post</a>
            <a aria-label="Deep Thoughts" href="https://deepthoughts.substack.com/">Deep Thoughts</a>
            <a href="https://on.substack.com/r/tracker">Tracking link</a>
          </section>
        </main>
      `,
      { scope: "graph", relation: "following" },
    );

    expect(payload?.profiles).toEqual([
      expect.objectContaining({
        id: "https://deepthoughts.substack.com/",
        handle: "deepthoughts",
        profileUrl: "https://deepthoughts.substack.com/",
        role: "following",
      }),
    ]);
  });

  it("keeps multiple relationship roles for one profile across surfaces", () => {
    const html = `
      <main>
        <div role="listitem">
          <a href="https://substack.com/@ada">Ada Lovelace</a>
        </div>
      </main>
    `;
    const followers = runExtractor(html, { scope: "graph", relation: "follower" });
    const following = runExtractor(html, { scope: "graph", relation: "following" });

    expect(followers?.profiles).toEqual([
      expect.objectContaining({ role: "follower" }),
    ]);
    expect(following?.profiles).toEqual([
      expect.objectContaining({ role: "following" }),
    ]);
  });

  it("rejects navigation chrome and post links from roster results", () => {
    const payload = runExtractor(
      `
        <header><a href="https://substack.com/@signedin">Signed In User</a></header>
        <main>
          <div role="listitem">
            <a href="https://writer.substack.com/p/an-essay">An essay</a>
            <a href="https://substack.com/@writer">Actual Writer</a>
          </div>
        </main>
      `,
      { scope: "graph", relation: "following" },
    );

    expect(payload?.profiles).toEqual([
      expect.objectContaining({
        id: "https://substack.com/@writer",
        displayName: "Actual Writer",
      }),
    ]);
  });

  it("caps unique profiles across the entire graph capture", () => {
    window.sessionStorage.setItem(
      "freed.essay.roster.v1",
      JSON.stringify({
        token: "test-capture",
        ids: Array.from({ length: 500 }, (_, index) => `https://substack.com/@person${index}`),
        roles: [],
      }),
    );

    const payload = runExtractor(
      `<main><div role="listitem"><a href="https://substack.com/@overflow">Overflow Person</a></div></main>`,
      { scope: "graph", relation: "following" },
    );

    expect(payload?.profiles).toEqual([]);
  });

  it("emits each roster identity only once across scrolling passes", () => {
    const html = `
      <main>
        <div role="listitem">
          <a aria-label="Ada" href="https://substack.com/@ada">Ada</a>
        </div>
      </main>
    `;

    const first = runExtractor(html, { scope: "graph", relation: "follower" });
    const second = runExtractor(html, { scope: "graph", relation: "follower" });

    expect(first?.profiles).toHaveLength(1);
    expect(second?.profiles).toEqual([]);
  });

  it("keeps activity authors out of the roster payload", () => {
    const payload = runExtractor(`
      <main>
        <article>
          <a aria-label="Ada" href="https://substack.com/@ada">Ada</a>
          <a href="https://substack.com/@ada/note/123?utm_source=activity">Open note</a>
          <p>A rendered note with enough text to preserve.</p>
          <time datetime="2026-07-13T12:00:00.000Z"></time>
        </article>
      </main>
    `);

    expect(payload?.profiles).toEqual([]);
    expect(payload?.entries).toEqual([
      expect.objectContaining({
        kind: "note",
        url: "https://substack.com/@ada/note/123",
        author: expect.objectContaining({
          id: "https://substack.com/@ada",
          role: "author",
        }),
      }),
    ]);
  });

  it("does not archive WebView essay body text", () => {
    const payload = runExtractor(
      `
        <main>
          <article>
            <a aria-label="Ada" href="https://substack.com/@ada">Ada</a>
            <a href="https://example.substack.com/p/private-essay">Open essay</a>
            <h2>A subscriber essay</h2>
            <p>This visible card text must not become an archived essay body.</p>
          </article>
        </main>
      `,
      { scope: "essays" },
    );

    const entries = payload?.entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "essay",
      title: "A subscriber essay",
      url: "https://example.substack.com/p/private-essay",
    });
    expect(entries[0]).not.toHaveProperty("text");
  });

  it("keeps restacks linked to essays as activity posts", () => {
    const payload = runExtractor(`
      <main>
        <article>
          <header>Ada restacked this essay</header>
          <a aria-label="Ada" href="https://substack.com/@ada">Ada</a>
          <a href="https://writer.substack.com/p/deep-thought">Open essay</a>
          <p>A useful argument.</p>
        </article>
      </main>
    `);

    expect(payload?.entries).toEqual([
      expect.objectContaining({
        kind: "restack",
        url: "https://writer.substack.com/p/deep-thought",
        activityLabel: "Ada restacked this essay",
      }),
    ]);
    expect((payload?.entries as Array<Record<string, unknown>>)[0]).not.toHaveProperty("text");
  });

  it("does not infer an action from ordinary note copy", () => {
    const payload = runExtractor(`
      <main>
        <article>
          <a aria-label="Ada" href="https://substack.com/@ada">Ada</a>
          <a href="https://substack.com/@ada/note/124">Open note</a>
          <p>I liked this argument, but the conclusion needs work.</p>
        </article>
      </main>
    `);

    expect(payload?.entries).toEqual([
      expect.objectContaining({ kind: "note" }),
    ]);
  });

  it("keeps distinct comments on the same essay", () => {
    const payload = runExtractor(`
      <main>
        <article>
          <header>Ada commented</header>
          <a href="https://substack.com/@ada">Ada</a>
          <a href="https://writer.substack.com/p/deep-thought">Open essay</a>
          <time datetime="2026-07-13T12:00:00.000Z"></time>
          <p>First response.</p>
        </article>
        <article>
          <header>Grace commented</header>
          <a href="https://substack.com/@grace">Grace</a>
          <a href="https://writer.substack.com/p/deep-thought">Open essay</a>
          <time datetime="2026-07-13T12:01:00.000Z"></time>
          <p>Second response.</p>
        </article>
      </main>
    `);

    expect(payload?.entries).toEqual([
      expect.objectContaining({
        kind: "comment",
        author: expect.objectContaining({ handle: "ada" }),
      }),
      expect.objectContaining({
        kind: "comment",
        author: expect.objectContaining({ handle: "grace" }),
      }),
    ]);
  });

  it("keeps profile avatars out of activity media", () => {
    const payload = runExtractor(`
      <main>
        <article>
          <a href="https://substack.com/@ada">
            <img src="https://images.example/ada-avatar.jpg" alt="Ada" />
            Ada
          </a>
          <a href="https://substack.com/@ada/note/124">Open note</a>
          <p>A note with an image.</p>
          <img src="https://images.example/note-image.jpg" alt="Note" />
        </article>
      </main>
    `);

    expect(payload?.entries).toEqual([
      expect.objectContaining({
        mediaUrls: ["https://images.example/note-image.jpg"],
      }),
    ]);
  });
});
