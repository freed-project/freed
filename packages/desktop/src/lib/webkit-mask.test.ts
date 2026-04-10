import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scriptPath = resolve(process.cwd(), "src-tauri/src/webkit-mask.js");
const script = readFileSync(scriptPath, "utf8");

function nextTick(): Promise<void> {
  return new Promise((resolveTick) => setTimeout(resolveTick, 0));
}

describe("webkit-mask.js media guard", () => {
  beforeEach(() => {
    const existingDisable = (
      window as unknown as Record<string, unknown>
    ).__FREED_SET_BACKGROUND_SCRAPER_MEDIA_GUARD__;
    if (typeof existingDisable === "function") {
      (existingDisable as (enabled: boolean) => void)(false);
    }
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    window.name = "__freed_media_guard__";
    delete (window as unknown as Record<string, unknown>)
      .__FREED_SET_BACKGROUND_SCRAPER_CLOAK__;
    delete (window as unknown as Record<string, unknown>)
      .__FREED_SET_BACKGROUND_SCRAPER_MEDIA_GUARD__;
    delete (window as unknown as Record<string, unknown>)
      .__freedBackgroundScraperMediaGuardState__;
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  it("mutes existing video elements during the initial scan", () => {
    document.body.innerHTML = `<video src="https://cdn.example/video.mp4"></video>`;

    window.eval(script);

    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video.defaultMuted).toBe(true);
    expect(video.volume).toBe(0);
  });

  it("mutes and pauses existing audio elements", () => {
    const audio = document.createElement("audio");
    const pause = vi.fn();
    Object.defineProperty(audio, "pause", {
      configurable: true,
      value: pause,
    });
    document.body.append(audio);

    window.eval(script);

    expect(audio.muted).toBe(true);
    expect(audio.defaultMuted).toBe(true);
    expect(audio.volume).toBe(0);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("silences newly inserted media through the mutation observer", async () => {
    window.eval(script);

    const video = document.createElement("video");
    video.src = "https://cdn.example/dynamic.mp4";
    document.body.append(video);
    await nextTick();

    expect(video.muted).toBe(true);
    expect(video.defaultMuted).toBe(true);
    expect(video.volume).toBe(0);
  });

  it("does not duplicate media listeners when the script runs twice", () => {
    const audio = document.createElement("audio");
    const pause = vi.fn();
    Object.defineProperty(audio, "pause", {
      configurable: true,
      value: pause,
    });
    document.body.append(audio);

    window.eval(script);
    pause.mockClear();

    window.eval(script);
    audio.dispatchEvent(new Event("play"));

    expect(pause).toHaveBeenCalledTimes(1);
  });
});
