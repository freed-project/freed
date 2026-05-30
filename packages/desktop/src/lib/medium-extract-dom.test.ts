import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const script = readFileSync(
  resolve(process.cwd(), "src-tauri/src/medium-extract.js"),
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
  return payloads.find((payload) => payload.name === "medium-feed-data")?.data;
}

describe("Medium DOM extractor", () => {
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

  it("canonicalizes profile and story links into one roster identity", () => {
    const payload = runExtractor(
      `
        <main>
          <div role="listitem">
            <a href="https://medium.com/@ada/a-story-abcdef123456?source=profile">A story</a>
            <a aria-label="Ada Lovelace" href="https://medium.com/@ada">Ada Lovelace</a>
          </div>
        </main>
      `,
      { scope: "graph", relation: "follower" },
    );

    expect(payload?.profiles).toEqual([
      expect.objectContaining({
        id: "https://medium.com/@ada",
        handle: "ada",
        profileUrl: "https://medium.com/@ada",
        role: "follower",
      }),
    ]);
  });

  it("captures followed publications without treating them as people", () => {
    const payload = runExtractor(
      `
        <main>
          <div role="listitem">
            <a aria-label="Better Programming" href="https://medium.com/better-programming">
              Better Programming
            </a>
          </div>
        </main>
      `,
      { scope: "graph", relation: "following" },
    );

    expect(payload?.profiles).toEqual([
      expect.objectContaining({
        id: "https://medium.com/better-programming",
        handle: "better-programming",
        role: "subscription",
      }),
    ]);
  });

  it("rejects navigation chrome and story links from roster results", () => {
    const payload = runExtractor(
      `
        <nav><a href="https://medium.com/@signedin">Signed In User</a></nav>
        <main>
          <div role="listitem">
            <a href="https://medium.com/@ada/a-story-abcdef123456">A story</a>
            <a href="https://medium.com/@ada">Ada Lovelace</a>
          </div>
        </main>
      `,
      { scope: "graph", relation: "follower" },
    );

    expect(payload?.profiles).toEqual([
      expect.objectContaining({
        id: "https://medium.com/@ada",
        displayName: "Ada Lovelace",
      }),
    ]);
  });

  it("caps unique profiles across follower and following surfaces", () => {
    window.sessionStorage.setItem(
      "freed.essay.roster.v1",
      JSON.stringify({
        token: "test-capture",
        ids: Array.from({ length: 500 }, (_, index) => `https://medium.com/@person${index}`),
        roles: [],
      }),
    );

    const payload = runExtractor(
      `<main><div role="listitem"><a href="https://medium.com/@overflow">Overflow Person</a></div></main>`,
      { scope: "graph", relation: "following" },
    );

    expect(payload?.profiles).toEqual([]);
  });

  it("keeps essay authors out of the roster payload", () => {
    const payload = runExtractor(
      `
        <main>
          <article>
            <a aria-label="Ada Lovelace" href="https://medium.com/@ada">Ada Lovelace</a>
            <a href="https://medium.com/@ada/a-story-abcdef123456?source=home">Open story</a>
            <h2>A story</h2>
            <p>A rendered Medium essay with enough text to preserve.</p>
            <time datetime="2026-07-13T12:00:00.000Z"></time>
          </article>
        </main>
      `,
      { scope: "essays" },
    );

    expect(payload?.profiles).toEqual([]);
    expect(payload?.entries).toEqual([
      expect.objectContaining({
        kind: "story",
        url: "https://medium.com/@ada/a-story-abcdef123456",
        author: expect.objectContaining({
          id: "https://medium.com/@ada",
          role: "author",
        }),
      }),
    ]);
    expect((payload?.entries as Array<Record<string, unknown>>)[0]).not.toHaveProperty("text");
  });

  it("emits each roster identity only once across scrolling passes", () => {
    const html = `
      <main>
        <div role="listitem">
          <a aria-label="Ada" href="https://medium.com/@ada">Ada</a>
        </div>
      </main>
    `;

    const first = runExtractor(html, { scope: "graph", relation: "following" });
    const second = runExtractor(html, { scope: "graph", relation: "following" });

    expect(first?.profiles).toHaveLength(1);
    expect(second?.profiles).toEqual([]);
  });

  it("does not infer an action from ordinary story copy", () => {
    const payload = runExtractor(`
      <main>
        <article>
          <a href="https://medium.com/@ada/how-i-highlighted-a-problem-abcdef">Open story</a>
          <h2>How I highlighted a problem</h2>
          <p>This article discusses highlights without recording a Medium action.</p>
        </article>
      </main>
    `);

    expect(payload?.entries).toEqual([
      expect.objectContaining({ kind: "story" }),
    ]);
  });

  it("recognizes explicit activity metadata", () => {
    const payload = runExtractor(`
      <main>
        <article>
          <header>Ada highlighted a passage</header>
          <a href="https://medium.com/@writer/deep-thought-abcdef">Open story</a>
          <p>A useful passage.</p>
        </article>
      </main>
    `);

    expect(payload?.entries).toEqual([
      expect.objectContaining({ kind: "highlight" }),
    ]);
  });

  it("does not archive story excerpts from clap activity cards", () => {
    const payload = runExtractor(`
      <main>
        <article>
          <header>Ada clapped for this story</header>
          <a href="https://medium.com/@writer/deep-thought-abcdef">Open story</a>
          <h2>Deep Thought</h2>
          <p>A members only excerpt that must stay out of activity capture.</p>
        </article>
      </main>
    `);

    expect(payload?.entries).toEqual([
      expect.objectContaining({
        kind: "clap",
        activityLabel: "Ada clapped for this story",
      }),
    ]);
    expect((payload?.entries as Array<Record<string, unknown>>)[0]).not.toHaveProperty("text");
  });

  it("keeps distinct responses on the same story", () => {
    const payload = runExtractor(`
      <main>
        <article>
          <header>Ada responded to this story</header>
          <a href="https://medium.com/@ada">Ada</a>
          <a href="https://medium.com/@writer/deep-thought-abcdef">Open story</a>
          <time datetime="2026-07-13T12:00:00.000Z"></time>
          <p>First response.</p>
        </article>
        <article>
          <header>Grace responded to this story</header>
          <a href="https://medium.com/@grace">Grace</a>
          <a href="https://medium.com/@writer/deep-thought-abcdef">Open story</a>
          <time datetime="2026-07-13T12:01:00.000Z"></time>
          <p>Second response.</p>
        </article>
      </main>
    `);

    expect(payload?.entries).toEqual([
      expect.objectContaining({
        kind: "response",
        author: expect.objectContaining({ handle: "ada" }),
      }),
      expect.objectContaining({
        kind: "response",
        author: expect.objectContaining({ handle: "grace" }),
      }),
    ]);
  });

  it("keeps profile avatars out of story media", () => {
    const payload = runExtractor(`
      <main>
        <article>
          <a href="https://medium.com/@ada">
            <img src="https://images.example/ada-avatar.jpg" alt="Ada" />
            Ada
          </a>
          <a href="https://medium.com/@ada/a-story-abcdef123456">A story</a>
          <img src="https://images.example/story-image.jpg" alt="Story" />
        </article>
      </main>
    `);

    expect(payload?.entries).toEqual([
      expect.objectContaining({
        mediaUrls: ["https://images.example/story-image.jpg"],
      }),
    ]);
  });
});
