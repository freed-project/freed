/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { PlatformProvider, type PlatformConfig } from "../../context/PlatformContext.js";
import { ReaderView } from "./ReaderView";

const NOW = 1_712_147_200_000;

function makeArticleItem(overrides: Partial<FeedItemType> = {}): FeedItemType {
  return {
    globalId: "rss:reader-cache-first",
    platform: "rss",
    contentType: "article",
    capturedAt: NOW,
    publishedAt: NOW - 60_000,
    author: {
      id: "rss-author",
      handle: "rss-author",
      displayName: "RSS Author",
    },
    content: {
      text: "Cached preview",
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: {
        url: "https://example.com/cached-reader",
        title: "Cached Reader",
        description: "Cached preview",
      },
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
    sourceUrl: "https://example.com/cached-reader",
    ...overrides,
  };
}

const testStoreState = {
  preferences: {
    display: {
      reading: {
        focusMode: false,
        focusIntensity: "normal",
      },
    },
  },
  toggleSaved: vi.fn(),
  toggleArchived: vi.fn(),
  updatePreferences: vi.fn(),
};

const basePlatformConfig = {
  feedMediaPreviews: "reader-only",
  store: ((selector: (state: typeof testStoreState) => unknown) => selector(testStoreState)) as PlatformConfig["store"],
  SourceIndicator: null,
  HeaderSyncIndicator: null,
  SettingsExtraSections: null,
  LegalSettingsContent: null,
  FeedEmptyState: null,
  XSettingsContent: null,
  FacebookSettingsContent: null,
  InstagramSettingsContent: null,
  LinkedInSettingsContent: null,
  GoogleContactsSettingsContent: null,
} as unknown as PlatformConfig;

function installLocalStorageMock(): void {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
      clear: () => {
        values.clear();
      },
    },
  });
}

async function renderReaderView(platform: PlatformConfig, item: FeedItemType = makeArticleItem()): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <PlatformProvider value={platform}>
        <ReaderView item={item} onClose={() => {}} />
      </PlatformProvider>,
    );
  });

  return { container, root };
}

async function flushReaderEffects(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("ReaderView cache-first hydration", () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    installLocalStorageMock();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("does not run live hydration when full cached content is already available", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    const hydrateReaderItem = vi.fn(async () => ({
      html: "<article><p>Live content should not load.</p></article>",
      status: "hydrated" as const,
    }));
    const platform = {
      ...basePlatformConfig,
      getLocalContent: vi.fn(async () => "<article><p>Cached content loaded first.</p></article>"),
      hydrateReaderItem,
    } as unknown as PlatformConfig;

    const { container, root } = await renderReaderView(platform);
    await flushReaderEffects();

    expect(container.textContent).toContain("Cached content loaded first.");
    expect(container.textContent).not.toContain("Live content should not load.");
    expect(hydrateReaderItem).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("keeps live hydration for synced text when the cache mode pins opened items", async () => {
    window.localStorage.setItem("freed.reader.offlineCacheMode", "everything_opened");
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    const hydrateReaderItem = vi.fn(async () => ({
      html: "<article><p>Pinned live content.</p></article>",
      status: "hydrated" as const,
    }));
    const platform = {
      ...basePlatformConfig,
      getLocalContent: vi.fn(async () => null),
      getLocalPreservedText: vi.fn(async () => "Synced text"),
      hydrateReaderItem,
    } as unknown as PlatformConfig;

    const { container, root } = await renderReaderView(platform);
    await flushReaderEffects();

    expect(container.textContent).toContain("Pinned live content.");
    expect(hydrateReaderItem).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("uses the article title and lead image once when cached content includes them", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    const platform = {
      ...basePlatformConfig,
      getLocalContent: vi.fn(async () => `
        <article>
          <h1>Hydrated Article Title</h1>
          <figure>
            <img src="https://cdn.example.com/article-hero.jpg" alt="Article hero" />
          </figure>
          <p>The full article body appears after the lead media.</p>
        </article>
      `),
      hydrateReaderItem: vi.fn(),
    } as unknown as PlatformConfig;
    const item = makeArticleItem({
      content: {
        text: "Preview body only.",
        mediaUrls: ["https://cdn.example.com/preview-card.jpg"],
        mediaTypes: ["image"],
        linkPreview: {
          url: "https://example.com/cached-reader",
          title: "Preview Card Title",
          description: "Preview body only.",
        },
      },
    });

    const { container, root } = await renderReaderView(platform, item);
    await flushReaderEffects();

    const article = container.querySelector("[data-testid='reader-article']");
    expect(article?.querySelector("h1")?.textContent).toBe("Hydrated Article Title");
    expect(article?.textContent).not.toContain("Preview Card Title");
    expect(article?.textContent).toContain("The full article body appears after the lead media.");

    const images = Array.from(article?.querySelectorAll("img") ?? []);
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe("https://cdn.example.com/article-hero.jpg");
    expect(images[0].getAttribute("alt")).toBe("Article hero");

    await act(async () => root.unmount());
  });

  it("uses focused YouTube actions without article hydration or eager player loading", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    const hydrateReaderItem = vi.fn();
    const openUrl = vi.fn();
    const addToOfflinePlaylist = vi.fn(async () => ({
      playlistId: "playlist-1",
      playlistUrl: "https://www.youtube.com/playlist?list=playlist-1",
      added: true,
    }));
    const platform = {
      ...basePlatformConfig,
      getLocalContent: vi.fn(async () => null),
      hydrateReaderItem,
      openUrl,
      youtube: { addToOfflinePlaylist },
    } as unknown as PlatformConfig;
    const item = makeArticleItem({
      globalId: "youtube:dQw4w9WgXcQ",
      platform: "youtube",
      contentType: "video",
      content: {
        text: "A deliberate course lesson.",
        mediaUrls: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
        mediaTypes: ["image"],
        linkPreview: {
          url: "https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share",
          title: "Focused lesson",
        },
      },
      sourceUrl: "https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share",
    });

    const { container, root } = await renderReaderView(platform, item);
    await flushReaderEffects();

    expect(hydrateReaderItem).not.toHaveBeenCalled();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Watch here in Focus Mode");
    expect(container.querySelector("img[src*='i.ytimg.com']")).toBeNull();

    const playButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Play in YouTube",
    );
    await act(async () => playButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(openUrl).toHaveBeenCalledWith("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    const offlineButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Add to Freed Offline",
    );
    await act(async () => offlineButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flushReaderEffects();
    expect(testStoreState.toggleSaved).toHaveBeenCalledWith("youtube:dQw4w9WgXcQ");
    expect(addToOfflinePlaylist).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(container.textContent).toContain("Added to Freed Offline");

    await act(async () => root.unmount());
  });

  it("does not pin a saved YouTube page through the article cache", async () => {
    const pinReaderItem = vi.fn();
    const item = makeArticleItem({
      globalId: "youtube:dQw4w9WgXcQ",
      platform: "youtube",
      contentType: "video",
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      userState: {
        hidden: false,
        saved: true,
        archived: false,
        tags: [],
      },
    });
    const platform = {
      ...basePlatformConfig,
      getLocalContent: vi.fn(async () => null),
      pinReaderItem,
    } as unknown as PlatformConfig;

    const { root } = await renderReaderView(platform, item);
    await flushReaderEffects();

    expect(pinReaderItem).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("does not carry an offline playlist result to a different inline item", async () => {
    let resolveAdd!: (result: {
      playlistId: string;
      playlistUrl: string;
      added: boolean;
    }) => void;
    const addToOfflinePlaylist = vi.fn(() => new Promise<{
      playlistId: string;
      playlistUrl: string;
      added: boolean;
    }>((resolve) => {
      resolveAdd = resolve;
    }));
    const platform = {
      ...basePlatformConfig,
      getLocalContent: vi.fn(async () => null),
      youtube: { addToOfflinePlaylist },
    } as unknown as PlatformConfig;
    const youtubeItem = (videoId: string) => makeArticleItem({
      globalId: `youtube:yt:video:${videoId}`,
      platform: "youtube",
      contentType: "video",
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      userState: {
        hidden: false,
        saved: true,
        archived: false,
        tags: [],
      },
    });
    const firstItem = youtubeItem("dQw4w9WgXcQ");
    const secondItem = youtubeItem("9bZkp7q19f0");
    const { container, root } = await renderReaderView(platform, firstItem);
    await flushReaderEffects();

    const firstAddButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Add to Freed Offline",
    );
    await act(async () => firstAddButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain("Adding to Freed Offline");

    await act(async () => {
      root.render(
        <PlatformProvider value={platform}>
          <ReaderView item={secondItem} onClose={() => {}} inline />
        </PlatformProvider>,
      );
    });
    expect(container.textContent).not.toContain("Adding to Freed Offline");

    await act(async () => {
      resolveAdd({
        playlistId: "playlist-1",
        playlistUrl: "https://www.youtube.com/playlist?list=playlist-1",
        added: true,
      });
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Added to Freed Offline");

    await act(async () => {
      root.render(
        <PlatformProvider value={platform}>
          <ReaderView item={firstItem} onClose={() => {}} inline />
        </PlatformProvider>,
      );
    });
    expect(container.textContent).toContain("Added to Freed Offline");
    expect(container.textContent).not.toContain("Adding to Freed Offline");

    await act(async () => root.unmount());
  });
});
