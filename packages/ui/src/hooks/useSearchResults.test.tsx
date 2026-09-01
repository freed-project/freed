/**
 * @vitest-environment jsdom
 */
import { act, useEffect } from "react";
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
import type { FeedItem, FilterOptions } from "@freed/shared";

import {
  PlatformProvider,
  type PlatformConfig,
} from "../context/PlatformContext";
import { type SearchResults, useSearchResults } from "./useSearchResults";

const EMPTY_FILTER: FilterOptions = {};

function item(index: number, priority = index): FeedItem {
  return {
    globalId: `rss:item-${index.toString().padStart(3, "0")}`,
    platform: "rss",
    contentType: "article",
    capturedAt: index,
    publishedAt: index,
    author: {
      id: "author",
      displayName: "Author",
      handle: "author",
    },
    content: {
      text: `needle result ${index}`,
      mediaUrls: [],
      mediaTypes: [],
    },
    userState: {
      saved: false,
      archived: false,
      hidden: false,
      tags: [],
    },
    topics: [],
    priority,
    sourceUrl: `https://example.com/${index}`,
  };
}

function platformConfig(
  searchLibraryItems?: PlatformConfig["searchLibraryItems"],
): PlatformConfig {
  return {
    store: (() => undefined) as unknown as PlatformConfig["store"],
    searchLibraryItems,
  } as PlatformConfig;
}

function Harness({
  query = "needle",
  filter = EMPTY_FILTER,
  identityMode = "all_content",
  resultSourceVersion = 41,
  onResult,
}: {
  query?: string;
  filter?: FilterOptions;
  identityMode?: "friends" | "all_content";
  resultSourceVersion?: number;
  onResult: (result: SearchResults) => void;
}) {
  const result = useSearchResults(
    query,
    filter,
    41,
    identityMode,
    resultSourceVersion,
  );
  useEffect(() => {
    onResult(result);
  }, [onResult, result]);
  return null;
}

describe("SQLite-streamed Library search", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  async function render(
    platform: PlatformConfig,
    props: Omit<Parameters<typeof Harness>[0], "onResult"> = {},
  ): Promise<{ latest: () => SearchResults | null }> {
    let latest: SearchResults | null = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness {...props} onResult={(result) => (latest = result)} />
        </PlatformProvider>,
      );
      await Promise.resolve();
    });
    return { latest: () => latest };
  }

  async function settleUntil(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50 && !predicate(); attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  it("does no Library work for an empty query", async () => {
    const searchLibraryItems = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async () => undefined);
    const result = await render(platformConfig(searchLibraryItems), {
      query: "  ",
    });

    expect(searchLibraryItems).not.toHaveBeenCalled();
    expect(result.latest()).toEqual({
      filteredItems: [],
      isSearching: false,
      resultCount: 0,
    });
  });

  it("forwards normalized filters and identity to SQLite", async () => {
    const searchLibraryItems = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async (_query, _version, visit) => {
      visit([{ item: item(1), score: 2 }]);
    });
    const result = await render(platformConfig(searchLibraryItems), {
      filter: { savedOnly: true },
      identityMode: "friends",
    });
    await settleUntil(() => result.latest()?.resultCount === 1);

    expect(searchLibraryItems).toHaveBeenCalledWith(
      "needle",
      41,
      expect.any(Function),
      expect.objectContaining({
        filter: expect.objectContaining({ savedOnly: true }),
        identityMode: "friends",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.latest()?.filteredItems.map(({ globalId }) => globalId)).toEqual([
      "rss:item-001",
    ]);
  });

  it("counts every SQLite match while retaining only the best 100", async () => {
    const corpus = Array.from({ length: 121 }, (_, index) => item(index));
    const searchLibraryItems = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async (_query, _version, visit) => {
      for (let offset = 0; offset < corpus.length; offset += 13) {
        visit(
          corpus.slice(offset, offset + 13).map((entry) => ({
            item: entry,
            score: 500 - Number(entry.globalId.slice(-3)),
          })),
        );
      }
    });
    const result = await render(platformConfig(searchLibraryItems));
    await settleUntil(() => result.latest()?.resultCount === 121);

    expect(result.latest()?.resultCount).toBe(121);
    expect(result.latest()?.filteredItems).toHaveLength(100);
    expect(result.latest()?.filteredItems[0]?.globalId).toBe("rss:item-120");
    expect(result.latest()?.filteredItems.at(-1)?.globalId).toBe(
      "rss:item-021",
    );
  });

  it("aborts a stale query and publishes only its replacement", async () => {
    const releases = new Map<string, () => void>();
    const searchLibraryItems = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async (query, _version, visit, options) => {
      await new Promise<void>((resolve) => releases.set(query, resolve));
      if (!options?.signal?.aborted) {
        visit([{ item: item(query === "first" ? 1 : 2), score: 1 }]);
      }
    });
    let latest: SearchResults | null = null;
    const platform = platformConfig(searchLibraryItems);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness query="first" onResult={(result) => (latest = result)} />
        </PlatformProvider>,
      );
      await Promise.resolve();
    });
    const firstSignal = searchLibraryItems.mock.calls[0]?.[3]?.signal;
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness query="second" onResult={(result) => (latest = result)} />
        </PlatformProvider>,
      );
      await Promise.resolve();
    });

    expect(firstSignal?.aborted).toBe(true);
    await act(async () => {
      releases.get("first")?.();
      releases.get("second")?.();
      await Promise.resolve();
    });
    await settleUntil(() => latest?.resultCount === 1);
    expect(latest?.filteredItems[0]?.globalId).toBe("rss:item-002");
  });

  it("fails closed for invalid, absent, or rejected SQLite search", async () => {
    const invalidSearch = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async () => undefined);
    const invalid = await render(platformConfig(invalidSearch), {
      query: "x".repeat(1_025),
    });
    expect(invalidSearch).not.toHaveBeenCalled();
    expect(invalid.latest()?.searchUnavailable).toBe(true);

    await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    const absent = await render(platformConfig(), { query: "needle" });
    expect(absent.latest()?.searchUnavailable).toBe(true);

    await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    const rejectedSearch = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async () => {
      throw new Error("SQLite unavailable");
    });
    const rejected = await render(platformConfig(rejectedSearch));
    await settleUntil(() => rejected.latest()?.searchUnavailable === true);
    expect(rejected.latest()?.searchUnavailable).toBe(true);
  });
});
