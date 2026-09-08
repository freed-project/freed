/**
 * @vitest-environment jsdom
 */
import { act, useEffect, useMemo } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { useReadOnScrollTracker } from "./useReadOnScrollTracker";
import { buildReadTrackListKey } from "./read-on-scroll";

type TestItem = {
  globalId: string;
  userState: {
    readAt?: number;
  };
};

type ReadProcessor = ReturnType<typeof useReadOnScrollTracker<TestItem>>;

function item(globalId: string, readAt?: number): TestItem {
  return { globalId, userState: { readAt } };
}

function TrackerHarness({
  items,
  markItemsAsRead,
  onReady,
  layoutKey,
  scrollTop = 0,
  viewportHeight = 400,
}: {
  items: TestItem[];
  layoutKey?: string;
  scrollTop?: number;
  viewportHeight?: number;
  markItemsAsRead: (ids: string[]) => Promise<void>;
  onReady: (process: ReadProcessor) => void;
}) {
  const listKey = useMemo(() => buildReadTrackListKey(items), [items]);
  const processReadOnScroll = useReadOnScrollTracker({
    surface: "compact-feed",
    listKey,
    layoutKey,
    rows: items,
    items,
    markReadOnScroll: true,
    getScrollMetrics: () => ({
      rawScrollTop: scrollTop,
      viewportHeight,
      scrollMargin: 0,
    }),
    markItemsAsRead,
  });

  useEffect(() => {
    onReady(processReadOnScroll);
  }, [onReady, processReadOnScroll]);

  return null;
}

describe("useReadOnScrollTracker", () => {
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

  it("resets compact-feed session state when the item ids change", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const markItemsAsRead = vi
      .fn<(ids: string[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    let processReadOnScroll: ReadProcessor | null = null;
    const onReady = (process: ReadProcessor) => {
      processReadOnScroll = process;
    };
    const virtualizer = {
      getVirtualItems: () => [{ index: 0, end: 200 }],
      getTotalSize: () => 400,
      options: { scrollMargin: 0 },
    };

    await act(async () => {
      root.render(
        <TrackerHarness
          items={[item("a", 1), item("b"), item("c"), item("d", 1)]}
          markItemsAsRead={markItemsAsRead}
          onReady={onReady}
        />,
      );
    });

    await act(async () => {
      processReadOnScroll?.(virtualizer, "element");
    });

    expect(markItemsAsRead).toHaveBeenCalledTimes(1);
    expect(markItemsAsRead).toHaveBeenLastCalledWith(["b", "c"]);

    await act(async () => {
      root.render(
        <TrackerHarness
          items={[item("a", 1), item("x"), item("y"), item("d", 1)]}
          markItemsAsRead={markItemsAsRead}
          onReady={onReady}
        />,
      );
    });

    await act(async () => {
      processReadOnScroll?.(virtualizer, "element");
    });

    expect(markItemsAsRead).toHaveBeenLastCalledWith(["x", "y"]);
    expect(markItemsAsRead.mock.calls).toContainEqual([["x", "y"]]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
  it("does not mark newly displaced rows read until the user scrolls past them", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = createRoot(container);
    const mark = vi
      .fn<(ids: string[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    let process: ReadProcessor | undefined;
    const onReady = (next: ReadProcessor) => {
      process = next;
    };
    const items = [item("a"), item("b"), item("c"), item("d"), item("e")];
    const virtualizer = {
      getVirtualItems: () =>
        items.map((_, index) => ({ index, end: (index + 1) * 100 })),
      getTotalSize: () => 500,
    };
    const render = async (key: string, top: number) => {
      await act(async () =>
        root.render(
          <TrackerHarness
            items={items}
            markItemsAsRead={mark}
            onReady={onReady}
            layoutKey={key}
            scrollTop={top}
            viewportHeight={50}
          />,
        ),
      );
      await act(async () => {
        process?.(virtualizer, "element");
      });
    };
    try {
      await render("old-rows", 0);
      await render("new-rows", 250);
      await act(async () => {
        process?.(virtualizer, "element");
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(mark).not.toHaveBeenCalled();
      await render("new-rows", 350);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(mark).toHaveBeenCalledExactlyOnceWith(["c"]);
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });
});
