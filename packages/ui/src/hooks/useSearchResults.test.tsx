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

type SearchPersons = Parameters<typeof useSearchResults>[5];
type SearchAccounts = Parameters<typeof useSearchResults>[6];
type SearchFriends = Parameters<typeof useSearchResults>[7];

function createPlatformStore(
  getState: () => {
    persons: SearchPersons;
    accounts: SearchAccounts;
    friends: SearchFriends;
  } = () => ({
    persons: EMPTY_RECORD,
    accounts: EMPTY_RECORD,
    friends: EMPTY_RECORD,
  }),
): PlatformConfig["store"] {
  const store = (() => undefined) as unknown as PlatformConfig["store"];
  store.getState = getState as PlatformConfig["store"]["getState"];
  return store;
}

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
  resultSourceVersion,
  persons = EMPTY_RECORD,
  accounts = EMPTY_RECORD,
  friends = EMPTY_RECORD,
  onResult,
}: {
  items?: FeedItem[];
  query?: string;
  resultSourceVersion?: number;
  persons?: SearchPersons;
  accounts?: SearchAccounts;
  friends?: SearchFriends;
  onResult: (result: SearchResults) => void;
}) {
  const result = useSearchResults(
    items,
    query,
    EMPTY_FILTER,
    41,
    "all_content",
    persons,
    accounts,
    friends,
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

  it("prefers the persistent row-store search projection over a corpus scan", async () => {
    const corpus = Array.from({ length: 101 }, (_, index) => item(index));
    const searchLibraryItems = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async (_query, _version, visit) => {
      for (let offset = 0; offset < corpus.length; offset += 17) {
        if (
          visit(
            corpus.slice(offset, offset + 17).map((entry, index) => ({
              item: entry,
              score: corpus.length - offset - index,
            })),
          ) === "stop"
        ) {
          return;
        }
      }
    });
    const scanLibraryItems = vi.fn<
      NonNullable<PlatformConfig["scanLibraryItems"]>
    >(async () => undefined);
    const platform = {
      store: createPlatformStore(),
      scanLibraryItems,
      searchLibraryItems,
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

    expect(searchLibraryItems).toHaveBeenCalledOnce();
    expect(searchLibraryItems).toHaveBeenCalledWith(
      "needle",
      41,
      expect.any(Function),
      expect.objectContaining({
        accountAliases: [],
        signal: expect.any(AbortSignal),
      }),
    );
    expect(scanLibraryItems).not.toHaveBeenCalled();
    expect(latest?.resultCount).toBe(101);
    expect(latest?.filteredItems).toHaveLength(100);
    expect(latest?.filteredItems[0]?.globalId).toBe("rss:item-100");
  });

  it("deduplicates aliases and omits over-bound canonical account identities", async () => {
    const accounts = {
      z: {
        id: "z",
        kind: "social",
        provider: "rss",
        externalId: "author",
        displayName: "Later duplicate",
      },
      a: {
        id: "a",
        kind: "social",
        provider: "rss",
        externalId: "author",
        displayName: "Canonical alias",
      },
      long: {
        id: "long",
        kind: "social",
        provider: "rss",
        externalId: "x".repeat(4_097),
        displayName: "Over bound",
      },
    } as unknown as SearchAccounts;
    const searchLibraryItems = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async () => undefined);
    const platform = {
      store: createPlatformStore(() => ({
        persons: EMPTY_RECORD,
        accounts,
        friends: EMPTY_RECORD,
      })),
      searchLibraryItems,
    } as unknown as PlatformConfig;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness accounts={accounts} onResult={() => undefined} />
        </PlatformProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(searchLibraryItems).toHaveBeenCalledOnce();
    expect(searchLibraryItems.mock.calls[0]?.[3]?.accountAliases).toEqual([
      {
        aliases: "Canonical alias author author",
        authorId: "author",
        platform: "rss",
      },
    ]);
  });

  it("retains only the first 100 ordered persistent matches", async () => {
    const corpus = Array.from({ length: 101 }, (_, index) => item(index));
    const searchLibraryItems = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async (_query, _version, visit) => {
      for (let offset = 0; offset < corpus.length; offset += 17) {
        if (
          visit(
            corpus.slice(offset, offset + 17).map((entry, index) => ({
              item: entry,
              score: corpus.length - offset - index,
            })),
          ) === "stop"
        )
          return;
      }
    });
    const platform = {
      store: createPlatformStore(),
      searchLibraryItems,
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

    expect(searchLibraryItems).toHaveBeenCalledOnce();
    expect(latest?.resultCount).toBe(101);
    expect(latest?.filteredItems).toHaveLength(100);
    expect(latest?.filteredItems[0]?.globalId).toBe("rss:item-100");
    expect(latest?.filteredItems.at(-1)?.globalId).toBe("rss:item-001");
  });

  it("does not invoke persistent search until a query is active", async () => {
    const searchLibraryItems = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async () => undefined);
    const platform = {
      store: createPlatformStore(),
      searchLibraryItems,
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

    expect(searchLibraryItems).not.toHaveBeenCalled();

    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness query="needle" onResult={() => undefined} />
        </PlatformProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(searchLibraryItems).toHaveBeenCalledOnce();
  });

  it("refreshes queried user state through the persistent search source", async () => {
    let sourceItem = item(1);
    let releaseRefresh: (() => void) | null = null;
    const refreshBlocked = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let searchCount = 0;
    const searchLibraryItems = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async (_query, _version, visit) => {
      searchCount += 1;
      if (searchCount === 2) await refreshBlocked;
      visit([{ item: sourceItem, score: 1 }]);
    });
    const platform = {
      store: createPlatformStore(),
      searchLibraryItems,
    } as unknown as PlatformConfig;
    const latest = { current: null as SearchResults | null };
    const onResult = (result: SearchResults) => {
      latest.current = result;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness resultSourceVersion={1} onResult={onResult} />
        </PlatformProvider>,
      );
    });

    for (
      let attempt = 0;
      attempt < 100 &&
      latest.current?.filteredItems[0]?.userState.saved !== false;
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(searchLibraryItems).toHaveBeenCalledOnce();
    expect(latest.current?.filteredItems[0]?.userState.saved).toBe(false);

    sourceItem = {
      ...sourceItem,
      userState: { ...sourceItem.userState, saved: true },
    };
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness resultSourceVersion={2} onResult={onResult} />
        </PlatformProvider>,
      );
    });

    expect(searchLibraryItems).toHaveBeenCalledTimes(2);
    expect(latest.current?.filteredItems).toEqual([]);

    await act(async () => {
      releaseRefresh?.();
      await refreshBlocked;
    });

    for (
      let attempt = 0;
      attempt < 100 &&
      latest.current?.filteredItems[0]?.userState.saved !== true;
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(searchLibraryItems).toHaveBeenCalledTimes(2);
    expect(latest.current?.filteredItems[0]?.userState.saved).toBe(true);
  });

  it("fails closed when governed persistent search rejects a query", async () => {
    const scanLibraryItems = vi.fn<
      NonNullable<PlatformConfig["scanLibraryItems"]>
    >(async () => undefined);
    const searchLibraryItems = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async () => {
      throw new Error("persistent projection unavailable");
    });
    const acquireLegacyLibraryItems = vi.fn();
    const platform = {
      store: createPlatformStore(),
      scanLibraryItems,
      searchLibraryItems,
      acquireLegacyLibraryItems,
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
      attempt < 100 && latest?.searchUnavailable !== true;
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    expect(searchLibraryItems).toHaveBeenCalledOnce();
    expect(scanLibraryItems).not.toHaveBeenCalled();
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
    expect(latest).toMatchObject({
      filteredItems: [],
      isSearching: true,
      resultCount: 0,
      searchUnavailable: true,
    });
  });

  it("rejects over-bound queries before any persistent or legacy search work", async () => {
    const scanLibraryItems = vi.fn<
      NonNullable<PlatformConfig["scanLibraryItems"]>
    >(async () => undefined);
    const searchLibraryItems = vi.fn<
      NonNullable<PlatformConfig["searchLibraryItems"]>
    >(async () => undefined);
    const acquireLegacyLibraryItems = vi.fn();
    const platform = {
      store: createPlatformStore(),
      scanLibraryItems,
      searchLibraryItems,
      acquireLegacyLibraryItems,
    } as unknown as PlatformConfig;
    let latest: SearchResults | null = null;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness
            query={"x".repeat(1_025)}
            onResult={(result) => {
              latest = result;
            }}
          />
        </PlatformProvider>,
      );
    });

    for (
      let attempt = 0;
      attempt < 100 && latest?.searchUnavailable !== true;
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(searchLibraryItems).not.toHaveBeenCalled();
    expect(scanLibraryItems).not.toHaveBeenCalled();
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
    expect(latest?.searchUnavailable).toBe(true);
  });
});
