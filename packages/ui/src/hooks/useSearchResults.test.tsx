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
import type { FeedItem } from "@freed/shared";

import {
  PlatformProvider,
  type PlatformConfig,
} from "../context/PlatformContext";
import { type SearchResults, useSearchResults } from "./useSearchResults";

const EMPTY_RECORD = {};
const EMPTY_FILTER = {};
const EMPTY_ITEMS: FeedItem[] = [];

function item(index: number): FeedItem {
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
    priority: index,
    sourceUrl: `https://example.com/${index}`,
  };
}

function Harness({
  items = EMPTY_ITEMS,
  query = "needle",
  onResult,
}: {
  items?: FeedItem[];
  query?: string;
  onResult: (result: SearchResults) => void;
}) {
  const result = useSearchResults(
    items,
    query,
    EMPTY_FILTER,
    41,
    "all_content",
    EMPTY_RECORD,
    EMPTY_RECORD,
    EMPTY_RECORD,
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

  it("indexes bounded pages and retains only the first 100 ordered matches", async () => {
    const corpus = Array.from({ length: 101 }, (_, index) => item(index));
    const scanLibraryItems = vi.fn<
      NonNullable<PlatformConfig["scanLibraryItems"]>
    >(async (visit) => {
      for (let offset = 0; offset < corpus.length; offset += 17) {
        if ((await visit(corpus.slice(offset, offset + 17))) === "stop") return;
      }
    });
    const platform = {
      store: () => undefined,
      scanLibraryItems,
    } as unknown as PlatformConfig;
    let latest: SearchResults | null = null;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness
            onResult={(result) => {
              latest = result;
            }}
          />
        </PlatformProvider>,
      );
    });

    for (
      let attempt = 0;
      attempt < 100 && latest?.resultCount !== 101;
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    expect(scanLibraryItems).toHaveBeenCalledTimes(2);
    expect(latest?.resultCount).toBe(101);
    expect(latest?.filteredItems).toHaveLength(100);
    expect(latest?.filteredItems[0]?.globalId).toBe("rss:item-100");
    expect(latest?.filteredItems.at(-1)?.globalId).toBe("rss:item-001");
  });

  it("does not scan SQLite until a search query is active", async () => {
    const scanLibraryItems = vi.fn<
      NonNullable<PlatformConfig["scanLibraryItems"]>
    >(async () => undefined);
    const platform = {
      store: () => undefined,
      scanLibraryItems,
    } as unknown as PlatformConfig;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness query="" onResult={() => undefined} />
        </PlatformProvider>,
      );
      await Promise.resolve();
    });

    expect(scanLibraryItems).not.toHaveBeenCalled();

    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness query="needle" onResult={() => undefined} />
        </PlatformProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(scanLibraryItems).toHaveBeenCalledTimes(2);
  });

  it("falls back to the Automerge corpus when the SQLite scan is unavailable", async () => {
    const scanLibraryItems = vi.fn<
      NonNullable<PlatformConfig["scanLibraryItems"]>
    >(async () => {
      throw new Error("projection unavailable");
    });
    const platform = {
      store: () => undefined,
      scanLibraryItems,
    } as unknown as PlatformConfig;
    let latest: SearchResults | null = null;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness
            items={[item(1)]}
            onResult={(result) => {
              latest = result;
            }}
          />
        </PlatformProvider>,
      );
    });

    for (
      let attempt = 0;
      attempt < 100 && latest?.filteredItems.length !== 1;
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    expect(scanLibraryItems).toHaveBeenCalledTimes(1);
    expect(latest?.filteredItems[0]?.globalId).toBe("rss:item-001");
  });
});
