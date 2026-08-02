/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ContentSignal, FeedItem } from "@freed/shared";
import {
  PlatformProvider,
  type PlatformConfig,
} from "../context/PlatformContext.js";
import {
  useFeedSignalCounts,
  type FeedSignalCounts,
} from "./useFeedSignalCounts.js";

function item(globalId: string, tags: readonly ContentSignal[]): FeedItem {
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
    contentSignals: {
      version: 1,
      method: "rules",
      inferredAt: 1,
      scores: {},
      tags: [...tags],
    },
  };
}

const CORPUS: FeedItem[] = [
  item("essay-1", ["essay"]),
  item("essay-2", ["how_to"]),
  item("event-1", ["event"]),
  item("news-1", ["news"]),
  item("news-2", ["alert"]),
  item("news-3", ["product_update"]),
];

function Harness({
  fallbackItems,
  enabled = true,
  onReady,
}: {
  fallbackItems: FeedItem[];
  enabled?: boolean;
  onReady: (counts: FeedSignalCounts) => void;
}) {
  onReady(useFeedSignalCounts(fallbackItems, {}, 1, enabled));
  return null;
}

describe("useFeedSignalCounts", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
    vi.restoreAllMocks();
  });

  function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }

  async function render(
    config: Partial<PlatformConfig>,
    fallbackItems: FeedItem[],
    enabled = true,
  ) {
    mount();
    let current: FeedSignalCounts | null = null;
    await act(async () => {
      root!.render(
        <PlatformProvider value={config as PlatformConfig}>
          <Harness
            fallbackItems={fallbackItems}
            enabled={enabled}
            onReady={(counts) => {
              current = counts;
            }}
          />
        </PlatformProvider>,
      );
    });
    return () => current;
  }

  it("counts every preset from bounded pages while the renderer corpus is evicted", async () => {
    // Two pages, mirroring the bounded native scan contract.
    const scanLibraryItems = vi.fn(async (visit) => {
      await visit(CORPUS.slice(0, 3));
      await visit(CORPUS.slice(3));
    });
    // The store array is empty because renderer eviction is active. Counting
    // from it is exactly the regression this hook exists to prevent.
    const read = await render({ scanLibraryItems }, []);

    await vi.waitFor(() => {
      expect(read()?.all).toBe(6);
    });
    const counts = read()!;
    expect(counts.inspiring).toBe(2);
    expect(counts.events).toBe(1);
    expect(counts.news).toBe(3);
    expect(counts.personal).toBe(0);
    expect(counts.conversation).toBe(0);
    expect(scanLibraryItems).toHaveBeenCalledOnce();
  });

  it("reads nothing before the library reports initialized", async () => {
    // The bounded scanner pins the projection source. Asking for it during
    // startup made the Automerge worker log a fatal-looking console error.
    const scanLibraryItems = vi.fn(async () => undefined);
    const acquireLegacyLibraryItems = vi.fn(async () => () => undefined);
    const read = await render(
      { scanLibraryItems, acquireLegacyLibraryItems },
      CORPUS,
      false,
    );

    expect(read()!.all).toBe(0);
    expect(scanLibraryItems).not.toHaveBeenCalled();
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
  });

  it("falls back to the leased projection when no bounded scanner exists", async () => {
    const acquireLegacyLibraryItems = vi.fn(async () => () => undefined);
    const read = await render({ acquireLegacyLibraryItems }, CORPUS);

    await vi.waitFor(() => {
      expect(read()?.all).toBe(6);
    });
    expect(read()!.news).toBe(3);
    expect(acquireLegacyLibraryItems).toHaveBeenCalled();
  });

  it("falls back when the bounded scan fails instead of reporting zero", async () => {
    const scanLibraryItems = vi.fn(async () => {
      throw new Error("stale source");
    });
    const acquireLegacyLibraryItems = vi.fn(async () => () => undefined);
    const read = await render(
      { scanLibraryItems, acquireLegacyLibraryItems },
      CORPUS,
    );

    await vi.waitFor(() => {
      expect(read()?.all).toBe(6);
    });
    expect(read()!.inspiring).toBe(2);
    expect(acquireLegacyLibraryItems).toHaveBeenCalled();
  });
});
