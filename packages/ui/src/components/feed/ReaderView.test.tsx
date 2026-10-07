/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateSampleLibraryData, type FeedItem as FeedItemType } from "@freed/shared";
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
  updatePreferences: vi.fn(async () => {}),
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
  SubstackSettingsContent: null,
  MediumSettingsContent: null,
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
  it("keeps cached reading and local focus changes without viewer Library writes", async () => {
    vi.useFakeTimers();
    testStoreState.updatePreferences.mockClear();
    testStoreState.toggleSaved.mockClear();
    testStoreState.toggleArchived.mockClear();
    const { container, root } = await renderReaderView({
      ...basePlatformConfig, libraryAccess: "read-only",
      getLocalContent: vi.fn(async () => "<article><p>Viewer cached article.</p></article>"),
    });
    try {
      expect(container.textContent).toContain("Viewer cached article.");
      const save = container.querySelector<HTMLButtonElement>('button[aria-label="Save"]');
      const archive = container.querySelector<HTMLButtonElement>('button[aria-label="Archive"]');
      expect(save?.disabled).toBe(true);
      expect(archive?.disabled).toBe(true);
      await act(async () => {
        save!.click(); archive!.click();
        container.querySelector<HTMLButtonElement>('button[aria-label="Toggle focus reading mode"]')!.click();
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(testStoreState.toggleSaved).not.toHaveBeenCalled();
      expect(testStoreState.toggleArchived).not.toHaveBeenCalled();
      expect(testStoreState.updatePreferences).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });

  it.each(["facebook", "instagram", "x"] as const)("hides replies for synthetic %s items outside the read-only demo", async (platform) => {
    const item = makeArticleItem({
      platform,
      sampleDataFingerprint: {
        marker: "freed.sample-data.v1",
        batchId: "sample-installed-library",
        generatedAt: NOW,
        generatorVersion: 1,
      },
    });
    const { container, root } = await renderReaderView(basePlatformConfig, item);
    await flushReaderEffects();
    expect(container.textContent).not.toContain("Load replies");
    expect(container.textContent).not.toContain("View replies");
    expect(container.querySelector("article section.border-t")).toBeNull();
    await act(async () => root.unmount());
    const real = await renderReaderView(basePlatformConfig, makeArticleItem({ platform }));
    await flushReaderEffects();
    expect(real.container.textContent).toContain("Load replies inline");
    await act(async () => real.root.unmount());
    const compact = await renderReaderView(basePlatformConfig, makeArticleItem({
      platform,
      globalId: `custom-batch:sample-${platform}:2`,
    }));
    await flushReaderEffects();
    expect(compact.container.textContent).not.toContain("Load replies");
    await act(async () => compact.root.unmount());
  });
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    installLocalStorageMock();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it.each([true, false])("keeps demo text local with native hydrator available: %s", async (nativeHydrator) => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    const hydrateReaderItem = vi.fn();
    const getLocalContent = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { container, root } = await renderReaderView({
      ...basePlatformConfig,
      interactionMode: "read-only",
      getLocalContent,
      hydrateReaderItem: nativeHydrator ? hydrateReaderItem : undefined,
    }, makeArticleItem({ globalId: "freed-demo-showcase-v11:sample-character:nell-pelagic:4" }));
    expect(container.textContent).toContain("Cached preview");
    expect(hydrateReaderItem).not.toHaveBeenCalled();
    expect(getLocalContent).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("shows a demo YouTube thumbnail without embedding a player and keeps text when the image fails", async () => {
    const { container, root } = await renderReaderView({ ...basePlatformConfig, interactionMode: "read-only" },
      makeArticleItem({ platform: "youtube", sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXc",
        content: { text: "Sample video description", mediaUrls: ["https://example.com/thumbnail.jpg"], mediaTypes: ["image"] } }));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("Play in YouTube");
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    await act(async () => image!.dispatchEvent(new Event("error")));
    expect(container.textContent).toContain("You can still read this post.");
    expect(container.textContent).toContain("Sample video description");
    await act(async () => root.unmount());
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

  it("does not mistake a compact feed preview for preserved reader text", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    const hydrateReaderItem = vi.fn(async () => ({
      html: "<article><p>Full live article body.</p></article>",
      status: "hydrated" as const,
    }));
    const platform = {
      ...basePlatformConfig,
      getLocalContent: vi.fn(async () => null),
      getLocalPreservedText: vi.fn(async () => null),
      hydrateReaderItem,
    } as unknown as PlatformConfig;

    const { container, root } = await renderReaderView(platform);
    await flushReaderEffects();

    expect(container.textContent).toContain("Full live article body.");
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

  it("keeps reviewed Story credit separate from character prose and preserves full-frame media", async () => {
    const platform = {
      ...basePlatformConfig,
      getLocalContent: vi.fn(async () => null),
      getLocalPreservedText: vi.fn(async () => null),
      hydrateReaderItem: vi.fn(),
    } as unknown as PlatformConfig;
    const sample = generateSampleLibraryData({ scale: "showcase", generatedAt: NOW, batchId: "reader-credit" });
    const item = sample.items.find((entry) => entry.content.linkPreview?.title === "Separate arrangements")!;
    const { container, root } = await renderReaderView(platform, item);
    await flushReaderEffects();

    expect(platform.hydrateReaderItem).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Summary");
    const credit = container.querySelector('[aria-label="Image credit"]');
    expect(credit?.textContent).toContain("Photograph by malenki, CC BY-SA 3.0.");
    expect(credit?.textContent).toContain("\nLicense: https://creativecommons.org/licenses/by-sa/3.0/");
    expect(credit?.textContent).not.toContain(item.content.text);
    expect(container.textContent).toContain(item.content.text);
    expect(container.querySelector(`img[src="${item.content.mediaUrls[0]}"]`)?.classList.contains("object-contain")).toBe(true);

    await act(async () => root.unmount());
  });

  it("loads the paused YouTube player without article hydration", async () => {
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
        text: "A deliberate course lesson.\n\nA second paragraph.\n\nOriginal video: Focused lesson\nUploaded by: Teacher\nSource: https://example.com/lesson\nThumbnail: Source credit",
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
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(container.textContent).not.toContain("Watch here in Focus Mode");
    expect(container.querySelector("img[src*='i.ytimg.com']")).toBeNull();
    const description = Array.from(container.querySelectorAll("p")).find(
      (paragraph) => paragraph.textContent === item.content.text,
    );
    expect(description).toBeDefined();
    expect(description?.classList.contains("whitespace-pre-wrap")).toBe(true);
    expect(description?.classList.contains("break-words")).toBe(true);

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

  it("clears cached article title and lead image while the adjacent selection loads", async () => {
    let resolveSecond!: (value: string | null) => void;
    const first = makeArticleItem({ globalId: "rss:first" });
    const second = makeArticleItem({ globalId: "rss:second", content: {
      text: "Second body", mediaUrls: [], mediaTypes: [],
      linkPreview: { url: "https://example.com/second", title: "Second title" },
    } });
    const platform = { ...basePlatformConfig, getLocalContent: vi.fn((id: string) =>
      id === first.globalId
        ? Promise.resolve('<article><h1>First cached title</h1><img src="https://example.com/first.jpg"><p>First cached body</p></article>')
        : new Promise<string | null>((resolve) => { resolveSecond = resolve; }),
    ) } as unknown as PlatformConfig;
    const { container, root } = await renderReaderView(platform, first);
    expect(container.textContent).toContain("First cached title");
    await act(async () => root.render(<PlatformProvider value={platform}>
      <ReaderView item={second} onClose={() => {}} />
    </PlatformProvider>));
    expect(container.textContent).not.toContain("First cached title");
    expect(container.querySelector('img[src="https://example.com/first.jpg"]')).toBeNull();
    await act(async () => resolveSecond("<article><p>Second cached body</p></article>"));
    expect(container.textContent).toContain("Second cached body");
    expect(container.textContent).not.toContain("First cached body");
    await act(async () => root.unmount());
  });

  it.each(["adjacent", "return", "remount"])("discards late reply hydration across %s selection", async (scenario) => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    let resolveReplies!: (value: { text: string; mediaUrls: string[]; mediaTypes: ["image"] }) => void;
    const first = makeArticleItem({ globalId: "x:first", platform: "x" });
    const second = makeArticleItem({ globalId: "x:second", platform: "x" });
    const platform = { ...basePlatformConfig,
      getLocalContent: vi.fn(async () => "<article><p>Current cached body</p></article>"),
      hydrateReaderItem: vi.fn(() => new Promise((resolve) => { resolveReplies = resolve; })),
    } as unknown as PlatformConfig;
    const rendered = await renderReaderView(platform, first);
    const container = rendered.container;
    let root = rendered.root;
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Load replies inline, beta"]')!.click());
    const select = async (item: FeedItemType) => act(async () => root.render(
      <PlatformProvider value={platform}><ReaderView item={item} onClose={() => {}} /></PlatformProvider>,
    ));
    if (scenario === "remount") {
      await act(async () => root.unmount());
      root = createRoot(container);
    }
    await select(second);
    if (scenario === "return") await select(first);
    await act(async () => resolveReplies({ text: "Obsolete reply hydration body", mediaUrls: ["https://example.com/obsolete.jpg"], mediaTypes: ["image"] }));
    expect(container.textContent).not.toContain("Obsolete reply hydration body");
    expect(container.querySelector('img[src="https://example.com/obsolete.jpg"]')).toBeNull();
    expect(container.textContent).toContain("Current cached body");
    expect(platform.hydrateReaderItem).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("does not let a stale reply failure settle the next selection's active load", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (value: { text: string }) => void;
    const hydrateReaderItem = vi.fn()
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const platform = { ...basePlatformConfig,
      getLocalContent: vi.fn(async () => "<article><p>Current cached body</p></article>"),
      hydrateReaderItem,
    } as unknown as PlatformConfig;
    const { container, root } = await renderReaderView(platform, makeArticleItem({ globalId: "x:first", platform: "x" }));
    const loadReplies = async () => act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Load replies inline, beta"]')!.click());
    await loadReplies();
    await act(async () => root.render(<PlatformProvider value={platform}>
      <ReaderView item={makeArticleItem({ globalId: "x:second", platform: "x" })} onClose={() => {}} />
    </PlatformProvider>));
    await loadReplies();
    await act(async () => rejectFirst(new Error("Obsolete failure")));
    expect(container.textContent).toContain("Loading replies");
    expect(container.textContent).not.toContain("Freed could not load replies");
    await act(async () => resolveSecond({ text: "Second hydrated body" }));
    expect(container.textContent).toContain("Second hydrated body");
    expect(container.textContent).not.toContain("Loading replies");
    await act(async () => root.unmount());
  });

  it("keeps the newer cache response when adjacent loads settle out of order", async () => {
    const pending = new Map<string, (value: string) => void>();
    const platform = { ...basePlatformConfig, getLocalContent: vi.fn((id: string) =>
      new Promise<string>((resolve) => { pending.set(id, resolve); }),
    ) } as unknown as PlatformConfig;
    const first = makeArticleItem({ globalId: "rss:first" });
    const second = makeArticleItem({ globalId: "rss:second" });
    const { container, root } = await renderReaderView(platform, first);
    await act(async () => root.render(<PlatformProvider value={platform}>
      <ReaderView item={second} onClose={() => {}} />
    </PlatformProvider>));
    await act(async () => pending.get(second.globalId)!("<article><h1>Second loaded title</h1><p>Second loaded body</p></article>"));
    await act(async () => pending.get(first.globalId)!("<article><h1>Obsolete first title</h1><p>Obsolete first body</p></article>"));
    expect(container.textContent).toContain("Second loaded title");
    expect(container.textContent).toContain("Second loaded body");
    expect(container.textContent).not.toContain("Obsolete first");
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

  it("persists only the changed focus mode and cancels a pending save on unmount", async () => {
    vi.useFakeTimers();
    const platform = {
      ...basePlatformConfig,
      getLocalContent: vi.fn(async () => null),
    } as unknown as PlatformConfig;
    const { container, root } = await renderReaderView(platform);
    const focusButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle focus reading mode"]',
    );
    expect(focusButton).not.toBeNull();

    await act(async () => {
      focusButton?.click();
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(testStoreState.updatePreferences).toHaveBeenCalledOnce();
    expect(testStoreState.updatePreferences).toHaveBeenCalledWith({
      display: { reading: { focusMode: true } },
    });

    testStoreState.updatePreferences.mockClear();
    await act(async () => focusButton?.click());
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(testStoreState.updatePreferences).not.toHaveBeenCalled();
  });
});
