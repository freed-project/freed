/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubeFocusPlayer } from "./YouTubeFocusPlayer";

const VIDEO_ID = "dQw4w9WgXcQ";
const VIDEO_URL = `https://www.youtube.com/shorts/${VIDEO_ID}?feature=share`;

interface MockPlayerEvents {
  onReady: () => void;
  onStateChange: (event: { data: number }) => void;
  onError: () => void;
}

let playerEvents: MockPlayerEvents | null = null;

async function renderPlayer(element: ReactElement): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return { container, root };
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  expect(button).toBeInstanceOf(HTMLButtonElement);
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("YouTubeFocusPlayer", () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    playerEvents = null;
    class MockPlayer {
      constructor(_element: HTMLIFrameElement, options: { events: MockPlayerEvents }) {
        playerEvents = options.events;
      }
    }
    Object.defineProperty(window, "YT", {
      configurable: true,
      value: { Player: MockPlayer },
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Reflect.deleteProperty(window, "YT");
    vi.restoreAllMocks();
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("does not contact YouTube until the user loads the player", async () => {
    const onPlayInYouTube = vi.fn();
    const { container, root } = await renderPlayer(
      <YouTubeFocusPlayer videoUrl={VIDEO_URL} onPlayInYouTube={onPlayInYouTube} />,
    );

    expect(container.querySelector("iframe")).toBeNull();
    expect(document.querySelector(`script[src="https://www.youtube.com/iframe_api"]`)).toBeNull();
    expect(container.querySelector("img")).toBeNull();

    await clickButton(container, "Play in YouTube");
    expect(onPlayInYouTube).toHaveBeenCalledWith(
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    );
    expect(container.querySelector("iframe")).toBeNull();

    await act(async () => root.unmount());
  });

  it("loads a privacy-enhanced player without autoplay", async () => {
    const { container, root } = await renderPlayer(
      <YouTubeFocusPlayer videoUrl={VIDEO_URL} title="A focused lesson" onPlayInYouTube={() => {}} />,
    );

    await clickButton(container, "Watch here in Focus Mode");

    const iframe = container.querySelector("iframe");
    expect(iframe).toBeInstanceOf(HTMLIFrameElement);
    const src = new URL(iframe?.getAttribute("src") ?? "");
    expect(src.origin).toBe("https://www.youtube-nocookie.com");
    expect(src.pathname).toBe(`/embed/${VIDEO_ID}`);
    expect(src.searchParams.get("enablejsapi")).toBe("1");
    expect(src.searchParams.get("playsinline")).toBe("1");
    expect(src.searchParams.get("rel")).toBe("0");
    expect(src.searchParams.get("autoplay")).toBe("0");
    expect(iframe?.getAttribute("allow")).not.toContain("autoplay");
    expect(iframe?.getAttribute("title")).toBe("A focused lesson on YouTube");
    expect(playerEvents).not.toBeNull();

    await act(async () => root.unmount());
  });

  it("requires a fresh user click when the selected video changes", async () => {
    const { container, root } = await renderPlayer(
      <YouTubeFocusPlayer videoUrl={VIDEO_URL} onPlayInYouTube={() => {}} />,
    );

    await clickButton(container, "Watch here in Focus Mode");
    expect(container.querySelector("iframe")).toBeInstanceOf(HTMLIFrameElement);

    await act(async () => {
      root.render(
        <YouTubeFocusPlayer
          videoUrl="https://youtu.be/M7lc1UVf-VE"
          onPlayInYouTube={() => {}}
        />,
      );
    });

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Watch here in Focus Mode");

    await act(async () => root.unmount());
  });

  it("closes the player when the IFrame API reports completion", async () => {
    const onEnded = vi.fn();
    const { container, root } = await renderPlayer(
      <YouTubeFocusPlayer videoUrl={VIDEO_URL} onPlayInYouTube={() => {}} onEnded={onEnded} />,
    );

    await clickButton(container, "Watch here in Focus Mode");
    expect(playerEvents).not.toBeNull();

    await act(async () => {
      playerEvents?.onStateChange({ data: 0 });
    });

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Video finished");
    expect(container.textContent).toContain("The player has closed so the next recommendation cannot start.");
    expect(onEnded).toHaveBeenCalledOnce();

    await clickButton(container, "Replay in Focus Mode");
    expect(container.querySelector("iframe")).toBeInstanceOf(HTMLIFrameElement);

    await act(async () => root.unmount());
  });

  it("offers the exact YouTube video when embedded playback fails", async () => {
    const onPlayInYouTube = vi.fn();
    const { container, root } = await renderPlayer(
      <YouTubeFocusPlayer videoUrl={VIDEO_URL} onPlayInYouTube={onPlayInYouTube} />,
    );

    await clickButton(container, "Watch here in Focus Mode");
    await act(async () => {
      playerEvents?.onError();
    });

    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "The creator may have disabled embedded playback.",
    );
    await clickButton(container, "Play in YouTube");
    expect(onPlayInYouTube).toHaveBeenCalledWith(
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    );

    await act(async () => root.unmount());
  });

  it("removes a failed API script and allows a clean focus retry", async () => {
    Reflect.deleteProperty(window, "YT");
    const { container, root } = await renderPlayer(
      <YouTubeFocusPlayer videoUrl={VIDEO_URL} onPlayInYouTube={() => {}} />,
    );

    await clickButton(container, "Watch here in Focus Mode");
    const script = document.getElementById("freed-youtube-iframe-api");
    expect(script).toBeInstanceOf(HTMLScriptElement);
    await act(async () => {
      script?.dispatchEvent(new Event("error"));
      await Promise.resolve();
    });

    expect(document.getElementById("freed-youtube-iframe-api")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Retry Focus Mode");

    class RetryPlayer {
      constructor(_element: HTMLIFrameElement, options: { events: MockPlayerEvents }) {
        playerEvents = options.events;
      }
    }
    Object.defineProperty(window, "YT", {
      configurable: true,
      value: { Player: RetryPlayer },
    });
    await clickButton(container, "Retry Focus Mode");
    expect(container.querySelector("iframe")).toBeInstanceOf(HTMLIFrameElement);
    expect(playerEvents).not.toBeNull();

    await act(async () => root.unmount());
  });

  it("closes the focus player when API initialization times out", async () => {
    vi.useFakeTimers();
    Reflect.deleteProperty(window, "YT");
    const { container, root } = await renderPlayer(
      <YouTubeFocusPlayer videoUrl={VIDEO_URL} onPlayInYouTube={() => {}} />,
    );

    await clickButton(container, "Watch here in Focus Mode");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(document.getElementById("freed-youtube-iframe-api")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("This video cannot play here");

    await act(async () => root.unmount());
    vi.useRealTimers();
  });

  it("renders an accessible error without loading untrusted URLs", async () => {
    const { container, root } = await renderPlayer(
      <YouTubeFocusPlayer
        videoUrl={`https://www.youtube.com.evil.test/watch?v=${VIDEO_ID}`}
        onPlayInYouTube={() => {}}
      />,
    );

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "This YouTube link cannot be played safely.",
    );

    await act(async () => root.unmount());
  });
});
