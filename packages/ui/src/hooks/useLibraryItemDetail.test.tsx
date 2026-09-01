/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";

import {
  PlatformProvider,
  type PlatformConfig,
} from "../context/PlatformContext.js";
import {
  useLibraryItemDetail,
  type LibraryItemDetailResult,
} from "./useLibraryItemDetail.js";

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
  readLibraryItemDetail: NonNullable<PlatformConfig["readLibraryItemDetail"]>,
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
    readLibraryItemDetail,
  };
}

describe("useLibraryItemDetail", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.restoreAllMocks();
  });

  function render(children: ReactNode, config: PlatformConfig) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(<PlatformProvider value={config}>{children}</PlatformProvider>);
    });
  }

  it("deduplicates concurrent consumers and retains only the current detail row", async () => {
    let resolveDetail: ((value: FeedItem | null) => void) | null = null;
    const readLibraryItemDetail = vi.fn(
      () => new Promise<FeedItem | null>((resolve) => {
        resolveDetail = resolve;
      }),
    );
    const observed: LibraryItemDetailResult[][] = [];

    function Harness() {
      observed.push([
        useLibraryItemDetail("item-1", 7),
        useLibraryItemDetail("item-1", 7),
      ]);
      return null;
    }

    render(<Harness />, platformConfig(readLibraryItemDetail));
    expect(readLibraryItemDetail).toHaveBeenCalledOnce();
    expect(observed.at(-1)?.map((result) => result.status)).toEqual([
      "loading",
      "loading",
    ]);

    await act(async () => {
      resolveDetail?.(item("item-1"));
      await Promise.resolve();
    });

    expect(observed.at(-1)?.map((result) => result.item?.globalId)).toEqual([
      "item-1",
      "item-1",
    ]);
  });

  it("never exposes a late response for a previous item", async () => {
    const pending = new Map<string, (value: FeedItem | null) => void>();
    const readLibraryItemDetail = vi.fn(
      (globalId: string) => new Promise<FeedItem | null>((resolve) => {
        pending.set(globalId, resolve);
      }),
    );
    let currentId = "item-1";
    let latest: LibraryItemDetailResult | null = null;

    function Harness() {
      latest = useLibraryItemDetail(currentId, 7);
      return null;
    }

    const config = platformConfig(readLibraryItemDetail);
    render(<Harness />, config);
    currentId = "item-2";
    await act(async () => {
      root?.render(
        <PlatformProvider value={config}>
          <Harness />
        </PlatformProvider>,
      );
    });
    await act(async () => {
      pending.get("item-1")?.(item("item-1"));
      await Promise.resolve();
    });
    expect(latest).toMatchObject({ item: null, status: "loading" });

    await act(async () => {
      pending.get("item-2")?.(item("item-2"));
      await Promise.resolve();
    });
    expect(latest).toMatchObject({
      item: { globalId: "item-2" },
      status: "ready",
    });
  });

  it("reports a failed point read without inventing an empty Library result", async () => {
    const readLibraryItemDetail = vi.fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(item("item-1"));
    let latest: LibraryItemDetailResult | null = null;

    function Harness() {
      latest = useLibraryItemDetail("item-1", 7);
      return null;
    }

    render(<Harness />, platformConfig(readLibraryItemDetail));
    await act(async () => {
      await Promise.resolve();
    });

    expect(latest).toEqual({ item: null, status: "failed" });

    await act(async () => {
      root?.unmount();
    });
    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(
        <PlatformProvider value={platformConfig(readLibraryItemDetail)}>
          <Harness />
        </PlatformProvider>,
      );
      await Promise.resolve();
    });

    expect(readLibraryItemDetail).toHaveBeenCalledTimes(2);
    expect(latest).toMatchObject({
      item: { globalId: "item-1" },
      status: "ready",
    });
  });
});
