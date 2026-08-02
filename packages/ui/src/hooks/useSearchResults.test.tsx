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
      store: createPlatformStore(),
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
      store: createPlatformStore(),
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

  it("refreshes queried user state without rebuilding the search index", async () => {
    let sourceItem = item(1);
    let releaseRefresh: (() => void) | null = null;
    const refreshBlocked = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let scanCount = 0;
    const scanLibraryItems = vi.fn<
      NonNullable<PlatformConfig["scanLibraryItems"]>
    >(async (visit) => {
      scanCount += 1;
      if (scanCount === 3) await refreshBlocked;
      await visit([sourceItem]);
    });
    const platform = {
      store: createPlatformStore(),
      scanLibraryItems,
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
    expect(scanLibraryItems).toHaveBeenCalledTimes(2);
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

    expect(scanLibraryItems).toHaveBeenCalledTimes(3);
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
    expect(scanLibraryItems).toHaveBeenCalledTimes(3);
    expect(latest.current?.filteredItems[0]?.userState.saved).toBe(true);
  });

  it("falls back to the Automerge corpus when the SQLite scan is unavailable", async () => {
    const scanLibraryItems = vi.fn<
      NonNullable<PlatformConfig["scanLibraryItems"]>
    >(async () => {
      throw new Error("projection unavailable");
    });
    const releaseLegacyItems = vi.fn();
    const acquireLegacyLibraryItems = vi.fn(async () => releaseLegacyItems);
    const platform = {
      store: createPlatformStore(),
      scanLibraryItems,
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
      attempt < 100 && latest?.filteredItems.length !== 1;
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    expect(scanLibraryItems).toHaveBeenCalledTimes(1);
    expect(acquireLegacyLibraryItems).toHaveBeenCalledTimes(1);
    expect(latest?.filteredItems[0]?.globalId).toBe("rss:item-001");

    await act(async () => root?.unmount());
    root = null;
    expect(releaseLegacyItems).toHaveBeenCalledTimes(1);
  });

  it("keeps one legacy lease across cloned graph records and failed version retries", async () => {
    let graphState = {
      persons: {} as SearchPersons,
      accounts: {} as SearchAccounts,
      friends: {} as SearchFriends,
    };
    let scanFails = true;
    const scanLibraryItems = vi.fn<
      NonNullable<PlatformConfig["scanLibraryItems"]>
    >(async (visit) => {
      if (scanFails) throw new Error("projection unavailable");
      await visit([item(1)]);
    });
    const releaseLegacyItems = vi.fn();
    const acquireLegacyLibraryItems = vi.fn(async () => releaseLegacyItems);
    const platform = {
      store: createPlatformStore(() => graphState),
      scanLibraryItems,
      acquireLegacyLibraryItems,
    } as unknown as PlatformConfig;
    let latest: SearchResults | null = null;
    const onResult = (result: SearchResults) => {
      latest = result;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness
            items={[item(1)]}
            resultSourceVersion={1}
            persons={graphState.persons}
            accounts={graphState.accounts}
            friends={graphState.friends}
            onResult={onResult}
          />
        </PlatformProvider>,
      );
    });

    for (
      let attempt = 0;
      attempt < 100 && acquireLegacyLibraryItems.mock.calls.length !== 1;
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(scanLibraryItems).toHaveBeenCalledTimes(1);
    expect(acquireLegacyLibraryItems).toHaveBeenCalledTimes(1);
    expect(releaseLegacyItems).not.toHaveBeenCalled();

    graphState = {
      persons: { ...graphState.persons },
      accounts: { ...graphState.accounts },
      friends: { ...graphState.friends },
    };
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness
            items={[item(1)]}
            resultSourceVersion={1}
            persons={graphState.persons}
            accounts={graphState.accounts}
            friends={graphState.friends}
            onResult={onResult}
          />
        </PlatformProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(scanLibraryItems).toHaveBeenCalledTimes(1);
    expect(acquireLegacyLibraryItems).toHaveBeenCalledTimes(1);
    expect(releaseLegacyItems).not.toHaveBeenCalled();

    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness
            items={[item(1)]}
            resultSourceVersion={2}
            persons={graphState.persons}
            accounts={graphState.accounts}
            friends={graphState.friends}
            onResult={onResult}
          />
        </PlatformProvider>,
      );
    });
    for (
      let attempt = 0;
      attempt < 100 && scanLibraryItems.mock.calls.length !== 2;
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(scanLibraryItems).toHaveBeenCalledTimes(2);
    expect(acquireLegacyLibraryItems).toHaveBeenCalledTimes(1);
    expect(releaseLegacyItems).not.toHaveBeenCalled();

    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness
            items={[item(1)]}
            query=""
            resultSourceVersion={2}
            persons={graphState.persons}
            accounts={graphState.accounts}
            friends={graphState.friends}
            onResult={onResult}
          />
        </PlatformProvider>,
      );
      await Promise.resolve();
    });
    expect(releaseLegacyItems).toHaveBeenCalledTimes(1);

    scanFails = false;
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness
            items={[item(1)]}
            resultSourceVersion={2}
            persons={graphState.persons}
            accounts={graphState.accounts}
            friends={graphState.friends}
            onResult={onResult}
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
    expect(latest?.filteredItems[0]?.globalId).toBe("rss:item-001");
    expect(acquireLegacyLibraryItems).toHaveBeenCalledTimes(1);
    expect(releaseLegacyItems).toHaveBeenCalledTimes(1);
  });
});
