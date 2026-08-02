/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import {
  PlatformProvider,
  type LibraryFacetSummary,
  type LibrarySurface,
  type PlatformConfig,
} from "../context/PlatformContext.js";
import { useLibraryFacetSummary } from "./useLibraryFacetSummary.js";
import { useLibrarySurfaceItems } from "./useLibrarySurfaceItems.js";

function item(globalId: string): FeedItem {
  return {
    globalId,
    platform: "rss",
    contentType: "post",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: { text: globalId, mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
  };
}

function platformConfig(
  overrides: Partial<Pick<
    PlatformConfig,
    | "acquireLegacyLibraryItems"
    | "readLibraryFacetSummary"
    | "readLibrarySurfaceItems"
  >>,
): PlatformConfig {
  return {
    store: (() => undefined) as unknown as PlatformConfig["store"],
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
    ...overrides,
  };
}

function SurfaceHarness({
  onItems,
  readFallbackItems,
  surface = "map",
}: {
  onItems: (items: readonly FeedItem[]) => void;
  readFallbackItems: () => FeedItem[];
  surface?: LibrarySurface;
}) {
  onItems(useLibrarySurfaceItems(surface, readFallbackItems, 7));
  return null;
}

function FacetHarness({
  onSummaries,
}: {
  onSummaries: (summaries: readonly LibraryFacetSummary[]) => void;
}) {
  const first = useLibraryFacetSummary([], 8);
  const second = useLibraryFacetSummary([], 8);
  onSummaries([first, second]);
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Library row query hooks", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = false;
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  function renderHarness(node: ReactNode): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(node));
  }

  it("loads bounded native rows without materializing the fallback corpus", async () => {
    const readLibrarySurfaceItems = vi.fn(async () => [item("native-map")]);
    const readFallbackItems = vi.fn(() => [item("fallback")]);
    let current: readonly FeedItem[] = [];
    renderHarness(
      <PlatformProvider value={platformConfig({ readLibrarySurfaceItems })}>
        <SurfaceHarness
          onItems={(items) => { current = items; }}
          readFallbackItems={readFallbackItems}
        />
      </PlatformProvider>,
    );

    expect(current).toEqual([]);
    await flush();
    expect(current.map((candidate) => candidate.globalId)).toEqual(["native-map"]);
    expect(readFallbackItems).not.toHaveBeenCalled();
    expect(readLibrarySurfaceItems).toHaveBeenCalledOnce();
    expect(readLibrarySurfaceItems).toHaveBeenCalledWith("map");
  });

  it("leases the compatibility corpus only when a native surface reader is unavailable", async () => {
    const release = vi.fn();
    const acquireLegacyLibraryItems = vi.fn(async () => release);
    const readFallbackItems = vi.fn(() => [item("fallback")]);
    let current: readonly FeedItem[] = [];
    renderHarness(
      <PlatformProvider value={platformConfig({ acquireLegacyLibraryItems })}>
        <SurfaceHarness
          onItems={(items) => { current = items; }}
          readFallbackItems={readFallbackItems}
          surface="story_wall"
        />
      </PlatformProvider>,
    );

    expect(current.map((candidate) => candidate.globalId)).toEqual(["fallback"]);
    await flush();
    expect(acquireLegacyLibraryItems).toHaveBeenCalledOnce();
    expect(readFallbackItems).toHaveBeenCalledOnce();

    await act(async () => {
      root?.unmount();
    });
    root = null;
    expect(release).toHaveBeenCalledOnce();
  });

  it("shares one exact facet query across multiple consumers", async () => {
    const summary: LibraryFacetSummary = {
      archivedCount: 2,
      sampleItemCount: 5,
      savedArchivedCount: 1,
      savedCount: 3,
      savedPlatformCount: 4,
      tags: ["alpha", "beta"],
      totalCount: 10,
    };
    const readLibraryFacetSummary = vi.fn(async () => summary);
    let current: readonly LibraryFacetSummary[] = [];
    renderHarness(
      <PlatformProvider value={platformConfig({ readLibraryFacetSummary })}>
        <FacetHarness onSummaries={(summaries) => { current = summaries; }} />
      </PlatformProvider>,
    );

    await flush();
    expect(readLibraryFacetSummary).toHaveBeenCalledOnce();
    expect(current).toEqual([summary, summary]);
  });
});
