/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BaseAppState } from "@freed/shared";
import {
  PlatformProvider,
  type PlatformConfig,
} from "../context/PlatformContext.js";
import { useLibraryCommandPaletteReader } from "./useLibraryCommandPaletteReader.js";

describe("useLibraryCommandPaletteReader", () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  beforeAll(() => {
    document.body.appendChild(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await act(async () => root.unmount());
    container.remove();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("opens the ordinary command palette from compact aggregates without scanning the corpus", async () => {
    const activeFilter = {};
    const state = {
      activeFilter,
      activeView: "feed",
      accounts: {},
      archivableCountByPlatform: {},
      archivableFeedCounts: {},
      feedUnreadCounts: {},
      friends: {},
      libraryItemVersion: 7,
      markItemsAsRead: vi.fn(),
      archiveItems: vi.fn(),
      persons: {},
      searchCorpusVersion: 7,
      totalArchivableCount: 12,
      totalUnreadCount: 34,
      unreadCountByPlatform: {},
    } as unknown as BaseAppState;
    const store = ((selector: (value: BaseAppState) => unknown) => selector(state)) as
      PlatformConfig["store"];
    store.getState = () => state;
    const openBoundedFeedReader = vi.fn();
    const readLibraryFacetSummary = vi.fn(async () => ({
      archivedCount: 8,
      sampleItemCount: 0,
      savedArchivedCount: 3,
      savedCount: 4,
      savedPlatformCount: 1,
      tags: ["favorite"],
      totalCount: 20_000,
    }));
    let latest: ReturnType<typeof useLibraryCommandPaletteReader> | null = null;
    const config = {
      store,
      openBoundedFeedReader,
      readLibraryFacetSummary,
    } as unknown as PlatformConfig;

    function Harness() {
      latest = useLibraryCommandPaletteReader({
        activeFilter,
        activeView: "feed",
        commandScopeItems: [],
        enabled: true,
        identityMode: "all_content",
        inputValue: "",
        searchQuery: "",
        selectedItemId: null,
        sourceVersion: 7,
      });
      return null;
    }

    await act(async () => {
      root.render(
        <PlatformProvider value={config}>
          <Harness />
        </PlatformProvider>,
      );
      await Promise.resolve();
    });

    expect(openBoundedFeedReader).not.toHaveBeenCalled();
    expect(readLibraryFacetSummary).toHaveBeenCalledOnce();
    expect(latest).toMatchObject({
      archivedUnsavedCount: 5,
      archivableScopeCount: 12,
      savedArchivedCount: 3,
      tags: ["favorite"],
      unreadScopeCount: 34,
    });
  });

  it("uses the Friends-only typed feed reader for complex identity counts", async () => {
    const state = {
      activeFilter: {},
      activeView: "feed",
      accounts: {},
      archivableCountByPlatform: {},
      archivableFeedCounts: {},
      archiveItems: vi.fn(),
      feedUnreadCounts: {},
      friends: {},
      libraryItemVersion: 9,
      markItemsAsRead: vi.fn(),
      persons: {},
      searchCorpusVersion: 9,
      totalArchivableCount: 0,
      totalUnreadCount: 0,
      unreadCountByPlatform: {},
    } as unknown as BaseAppState;
    const store = ((selector: (value: BaseAppState) => unknown) =>
      selector(state)) as PlatformConfig["store"];
    store.getState = () => state;
    const close = vi.fn(async () => {});
    const openBoundedFeedReader = vi.fn();
    const openBoundedFriendsFeedReader = vi.fn(async () => ({
      totalCount: 0,
      readNext: async () => [],
      close,
    }));
    const config = {
      store,
      openBoundedFeedReader,
      openBoundedFriendsFeedReader,
      readLibraryFacetSummary: async () => ({
        archivedCount: 0,
        sampleItemCount: 0,
        savedArchivedCount: 0,
        savedCount: 0,
        savedPlatformCount: 0,
        tags: [],
        totalCount: 0,
      }),
    } as unknown as PlatformConfig;

    function Harness() {
      useLibraryCommandPaletteReader({
        activeFilter: {},
        activeView: "feed",
        commandScopeItems: [],
        enabled: true,
        identityMode: "friends",
        inputValue: "",
        searchQuery: "",
        selectedItemId: null,
        sourceVersion: 9,
      });
      return null;
    }

    await act(async () => {
      root.render(
        <PlatformProvider value={config}>
          <Harness />
        </PlatformProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openBoundedFeedReader).not.toHaveBeenCalled();
    expect(openBoundedFriendsFeedReader).toHaveBeenCalledWith(
      {},
      expect.any(Number),
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
