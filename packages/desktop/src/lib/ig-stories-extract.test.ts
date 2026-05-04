import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "src-tauri/src/ig-stories-extract.js");
const script = readFileSync(scriptPath, "utf8");

function setReadonlyNumber(target: object, key: string, value: number) {
  Object.defineProperty(target, key, {
    configurable: true,
    value,
  });
}

describe("ig-stories-extract.js", () => {
  it("does not emit feed cards as stories when no story viewer exists", () => {
    window.history.replaceState({}, "", "/?variant=following");

    document.body.innerHTML = `
      <main>
        <article>
          <a href="https://www.instagram.com/reels/">Reels</a>
          <img src="https://scontent.example/feed-card.jpg" alt="feed post" />
          <time datetime="2026-03-23T12:00:00.000Z"></time>
        </article>
      </main>
    `;

    const image = document.querySelector("img") as HTMLImageElement;
    setReadonlyNumber(image, "width", 1080);
    setReadonlyNumber(image, "height", 1350);

    const payloads: Array<{ posts: unknown[]; strategy: string }> = [];
    (
      window as unknown as {
        __TAURI__: { event: { emit: (_name: string, payload: unknown) => void } };
      }
    ).__TAURI__ = {
      event: {
        emit: (_name, payload) => {
          payloads.push(payload as { posts: unknown[]; strategy: string });
        },
      },
    };

    window.eval(script);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].strategy).toBe("story-viewer-skip");
    expect(payloads[0].posts).toHaveLength(0);
  });

  it("keeps alphanumeric story IDs stable across repeated injections", () => {
    window.history.replaceState(
      {},
      "",
      "/stories/alice/ABC123xyz/",
    );

    document.body.innerHTML = `
      <div role="dialog">
        <a href="https://www.instagram.com/alice/">alice</a>
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

    const payloads: Array<{ posts: Array<{ shortcode: string }> }> = [];
    (
      window as unknown as {
        __TAURI__: { event: { emit: (_name: string, payload: unknown) => void } };
      }
    ).__TAURI__ = {
      event: {
        emit: (_name, payload) => {
          payloads.push(payload as { posts: Array<{ shortcode: string }> });
        },
      },
    };

    window.eval(script);
    window.eval(script);

    expect(payloads).toHaveLength(2);
    expect(payloads[0].posts[0].shortcode).toBe("story_ABC123xyz");
    expect(payloads[1].posts[0].shortcode).toBe("story_ABC123xyz");
  });

  it("still extracts video story media when the video is muted", () => {
    window.history.replaceState({}, "", "/stories/alice/VID123/");

    document.body.innerHTML = `
      <div role="dialog">
        <a href="https://www.instagram.com/alice/">alice</a>
        <video src="https://cdn.example/story-video.mp4" poster="https://cdn.example/poster.jpg" muted></video>
        <time datetime="2026-03-23T12:00:00.000Z"></time>
      </div>
    `;

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    setReadonlyNumber(dialog, "offsetHeight", 800);

    const payloads: Array<{
      posts: Array<{
        shortcode: string;
        mediaUrls: string[];
        mediaTypes: string[];
        isVideo: boolean;
      }>;
    }> = [];
    (
      window as unknown as {
        __TAURI__: { event: { emit: (_name: string, payload: unknown) => void } };
      }
    ).__TAURI__ = {
      event: {
        emit: (_name, payload) => {
          payloads.push(
            payload as {
              posts: Array<{
                shortcode: string;
                mediaUrls: string[];
                mediaTypes: string[];
                isVideo: boolean;
              }>;
            },
          );
        },
      },
    };

    window.eval(script);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].posts[0].shortcode).toBe("story_VID123");
    expect(payloads[0].posts[0].isVideo).toBe(true);
    expect(payloads[0].posts[0].mediaUrls).toContain(
      "https://cdn.example/story-video.mp4",
    );
    expect(payloads[0].posts[0].mediaTypes).toEqual(["video", "image"]);
  });

  it("prefers the story URL username over generic profile links", () => {
    window.history.replaceState({}, "", "/stories/o2_treehouse/FRAME123/");

    document.body.innerHTML = `
      <div role="dialog">
        <a href="https://www.instagram.com/reels/">Reels</a>
        <a href="https://www.instagram.com/o2_treehouse/">o2_treehouse</a>
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

    const payloads: Array<{ posts: Array<{ authorHandle: string; shortcode: string }> }> = [];
    (
      window as unknown as {
        __TAURI__: { event: { emit: (_name: string, payload: unknown) => void } };
      }
    ).__TAURI__ = {
      event: {
        emit: (_name, payload) => {
          payloads.push(payload as { posts: Array<{ authorHandle: string; shortcode: string }> });
        },
      },
    };

    window.eval(script);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].posts[0].authorHandle).toBe("o2_treehouse");
    expect(payloads[0].posts[0].shortcode).toBe("story_FRAME123");
  });

  it("uses a content hash when Instagram exposes a timestamp-like story ID", () => {
    window.history.replaceState({}, "", "/stories/alice/1774389196662/");

    document.body.innerHTML = `
      <div role="dialog">
        <a href="https://www.instagram.com/alice/">alice</a>
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

    const payloads: Array<{ posts: Array<{ shortcode: string; mediaTypes: string[] }> }> = [];
    (
      window as unknown as {
        __TAURI__: { event: { emit: (_name: string, payload: unknown) => void } };
      }
    ).__TAURI__ = {
      event: {
        emit: (_name, payload) => {
          payloads.push(payload as { posts: Array<{ shortcode: string; mediaTypes: string[] }> });
        },
      },
    };

    window.eval(script);
    window.history.replaceState({}, "", "/stories/alice/1774389204187/");
    window.eval(script);

    expect(payloads).toHaveLength(2);
    expect(payloads[0].posts[0].shortcode).toMatch(/^story_[a-z0-9]+$/);
    expect(payloads[1].posts[0].shortcode).toBe(payloads[0].posts[0].shortcode);
    expect(payloads[0].posts[0].mediaTypes).toEqual(["image"]);
  });
});
