// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import { useSelectedLibraryItemValidity } from "./useSelectedLibraryItemValidity.js";

interface TestState {
  readonly isInitialized: boolean;
  readonly selectedItemId: string | null;
  readonly setSelectedItem: (id: string | null) => void;
}

function testStore(selectedItemId: string | null) {
  const store = create<TestState>((set) => ({
    isInitialized: true,
    selectedItemId,
    setSelectedItem: (id) => set({ selectedItemId: id }),
  }));
  return store;
}

describe("selected Library item validity", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render(input: {
    readonly readLibraryItemDetail: (
      globalId: string,
    ) => Promise<FeedItem | null>;
    readonly selectedItemId: string;
  }) {
    const store = testStore(input.selectedItemId);
    function Harness() {
      const isInitialized = store((state) => state.isInitialized);
      const selectedItemId = store((state) => state.selectedItemId);
      const setSelectedItem = store((state) => state.setSelectedItem);
      useSelectedLibraryItemValidity({
        enabled: true,
        isInitialized,
        readLibraryItemDetail: input.readLibraryItemDetail,
        selectedItemId,
        setSelectedItem,
      });
      return null;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(<Harness />);
    });
    return store;
  }

  it("clears only the selected item proven absent by one point query", async () => {
    const readLibraryItemDetail = vi.fn(async () => null);
    const store = render({
      readLibraryItemDetail,
      selectedItemId: "item-1",
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(readLibraryItemDetail).toHaveBeenCalledOnce();
    expect(readLibraryItemDetail).toHaveBeenCalledWith("item-1");
    expect(store.getState().selectedItemId).toBeNull();
  });

  it("does not let a stale missing-row response clear a newer selection", async () => {
    const resolveReads: Array<(item: FeedItem | null) => void> = [];
    const readLibraryItemDetail = vi.fn(
      () =>
        new Promise<FeedItem | null>((resolve) => {
          resolveReads.push(resolve);
        }),
    );
    const store = render({
      readLibraryItemDetail,
      selectedItemId: "item-1",
    });

    await act(async () => {
      store.setState({ selectedItemId: "item-2" });
    });
    await act(async () => {
      resolveReads[0]?.(null);
      await Promise.resolve();
    });

    expect(store.getState().selectedItemId).toBe("item-2");
  });
});
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });
