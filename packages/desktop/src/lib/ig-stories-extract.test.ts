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
        <img src="https://cdn.example/story-frame.jpg" alt="story" />
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

    const payloads: Array<{ posts: Array<{ shortcode: string; mediaUrls: string[]; isVideo: boolean }> }> = [];
    (
      window as unknown as {
        __TAURI__: { event: { emit: (_name: string, payload: unknown) => void } };
      }
    ).__TAURI__ = {
      event: {
        emit: (_name, payload) => {
          payloads.push(
            payload as {
              posts: Array<{ shortcode: string; mediaUrls: string[]; isVideo: boolean }>;
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
  });
});
