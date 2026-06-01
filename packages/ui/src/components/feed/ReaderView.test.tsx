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

async function renderReaderView(platform: PlatformConfig): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <PlatformProvider value={platform}>
        <ReaderView item={makeArticleItem()} onClose={() => {}} />
      </PlatformProvider>,
    );
  });

  return { container, root };
}

describe("ReaderView cache-first hydration", () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.removeItem("freed.reader.offlineCacheMode");
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
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Cached content loaded first.");
    expect(container.textContent).not.toContain("Live content should not load.");
    expect(hydrateReaderItem).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("keeps live hydration for synced text when the cache mode pins opened items", async () => {
    localStorage.setItem("freed.reader.offlineCacheMode", "everything_opened");
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
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Pinned live content.");
    expect(hydrateReaderItem).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });
});
