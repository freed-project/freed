import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const script = readFileSync(
  resolve(process.cwd(), "src-tauri/src/fb-stories-extract.js"),
  "utf8",
);

function setReadonlyNumber(target: object, key: string, value: number) {
  Object.defineProperty(target, key, {
    configurable: true,
    value,
  });
}

function installTauriCapture<T>() {
  const payloads: T[] = [];
  (
    window as unknown as {
      __TAURI__: { event: { emit: (_name: string, payload: unknown) => void } };
    }
  ).__TAURI__ = {
    event: {
      emit: (_name, payload) => {
        payloads.push(payload as T);
      },
    },
  };
  return payloads;
}

describe("fb-stories-extract.js", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/");
  });

  it("does not emit create-account chrome as a Facebook story", () => {
    document.body.innerHTML = `
      <main>
        <div role="dialog">
          <h3><a href="https://www.facebook.com/reg/">Create new account</a></h3>
        </div>
      </main>
    `;

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    setReadonlyNumber(dialog, "offsetHeight", 800);

    const payloads = installTauriCapture<Array<{ posts: unknown[]; strategy: string }>[number]>();

    window.eval(script);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].strategy).toBe("story-viewer-skip");
    expect(payloads[0].posts).toEqual([]);
    expect(payloads[0]).toMatchObject({
      rejected: { missingAuthor: 1 },
    });
  });

  it("does not emit a story when no story viewer exists", () => {
    document.body.innerHTML = `
      <main>
        <div role="article">
          <h3><a href="https://www.facebook.com/alice.example">Alice Example</a></h3>
          <img src="https://scontent.example/feed-card.jpg" alt="feed post" />
        </div>
      </main>
    `;

    const image = document.querySelector("img") as HTMLImageElement;
    setReadonlyNumber(image, "width", 1080);
    setReadonlyNumber(image, "height", 1350);

    const payloads = installTauriCapture<Array<{ posts: unknown[]; strategy: string }>[number]>();

    window.eval(script);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].strategy).toBe("story-viewer-skip");
    expect(payloads[0].posts).toEqual([]);
  });

  it("extracts a real Facebook story with valid author and media", () => {
    window.history.replaceState({}, "", "/stories/alice.example/FRAME123/");
    document.body.innerHTML = `
      <div role="dialog">
        <h3><a href="https://www.facebook.com/alice.example">Alice Example</a></h3>
        <img src="https://cdn.example/avatar.jpg" alt="avatar" />
        <img src="https://scontent.example/story-frame.jpg" alt="story" />
        <time datetime="2026-03-23T12:00:00.000Z"></time>
      </div>
    `;

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const images = Array.from(document.querySelectorAll("img")) as HTMLImageElement[];
    setReadonlyNumber(dialog, "offsetHeight", 800);
    setReadonlyNumber(images[0], "width", 40);
    setReadonlyNumber(images[0], "height", 40);
    setReadonlyNumber(images[1], "width", 1080);
    setReadonlyNumber(images[1], "height", 1920);

    const payloads = installTauriCapture<Array<{
      posts: Array<{
        authorName: string;
        authorProfileUrl: string;
        mediaUrls: string[];
        postType: string;
        strategy: string;
      }>;
      strategy?: string;
    }>[number]>();

    window.eval(script);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].posts).toHaveLength(1);
    expect(payloads[0].posts[0]).toMatchObject({
      authorName: "Alice Example",
      authorProfileUrl: "https://www.facebook.com/alice.example",
      mediaUrls: ["https://scontent.example/story-frame.jpg"],
      postType: "story",
      strategy: "story-viewer",
    });
  });
});
