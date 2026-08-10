import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueUserStateToggle: vi.fn(),
  readSelectedCollectionPage: vi.fn(),
  readSelectedMaterializedRow: vi.fn(),
}));

vi.mock("./library-core-portable-checkpoint-store", () => ({
  createPwaLibraryCorePortableCheckpointStore: () => ({
    enqueueUserStateToggle: mocks.enqueueUserStateToggle,
    readSelectedCollectionPage: mocks.readSelectedCollectionPage,
    readSelectedMaterializedRow: mocks.readSelectedMaterializedRow,
  }),
}));

vi.mock("./factory-reset-coordinator", () => ({
  registerPwaFactoryResetQuiesceHandler: vi.fn(),
}));

import {
  PWA_LIBRARY_CORE_ENABLED_KEY,
  isPwaLibraryCoreEnabled,
  enqueuePwaLibraryCoreUserStateToggle,
  readPwaLibraryCoreItemDetail,
  scanPwaLibraryCoreItems,
} from "./library-core-runtime";

function entry(registryKey: string, globalId: string) {
  return {
    value: {
      registry_key: registryKey,
      row: { globalId },
    },
  };
}

describe("PWA Library Core bounded scanner", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.readSelectedCollectionPage.mockReset();
    mocks.readSelectedMaterializedRow.mockReset();
    mocks.enqueueUserStateToggle.mockReset();
  });

  it("uses IndexedDB Library Core by default with an explicit local rollback", () => {
    expect(isPwaLibraryCoreEnabled()).toBe(true);
    localStorage.setItem(PWA_LIBRARY_CORE_ENABLED_KEY, "0");
    expect(isPwaLibraryCoreEnabled()).toBe(false);
  });

  it("pages the selected IndexedDB generation and stops without reading another page", async () => {
    mocks.readSelectedCollectionPage
      .mockResolvedValueOnce({
        entries: [entry("10_feed_items", "item-1")],
        nextOrdinal: 31,
      })
      .mockResolvedValueOnce({
        entries: [entry("00_library_shell", "shell")],
        nextOrdinal: 63,
      })
      .mockResolvedValueOnce({
        entries: [entry("10_feed_items", "item-2")],
        nextOrdinal: 95,
      });
    const visited: string[][] = [];

    await scanPwaLibraryCoreItems((items) => {
      visited.push(items.map((item) => item.globalId));
      return visited.length === 2 ? "stop" : "continue";
    });

    expect(visited).toEqual([["item-1"], ["item-2"]]);
    expect(mocks.readSelectedCollectionPage).toHaveBeenCalledTimes(3);
    expect(mocks.readSelectedCollectionPage.mock.calls).toEqual([
      [{ afterOrdinal: null, collection: "materialized_rows", limit: 32 }],
      [{ afterOrdinal: 31, collection: "materialized_rows", limit: 32 }],
      [{ afterOrdinal: 63, collection: "materialized_rows", limit: 32 }],
    ]);
  });

  it("reads one complete item from IndexedDB without consulting Automerge", async () => {
    mocks.readSelectedMaterializedRow.mockResolvedValue({
      globalId: "item-9",
      preservedContent: { html: "<p>Saved locally</p>" },
    });

    await expect(readPwaLibraryCoreItemDetail("item-9")).resolves.toEqual({
      globalId: "item-9",
      preservedContent: { html: "<p>Saved locally</p>" },
    });
    expect(mocks.readSelectedMaterializedRow).toHaveBeenCalledWith(
      "10_feed_items",
      "item-9",
    );
  });

  it("queues user-state changes through the signed IndexedDB intent path", async () => {
    mocks.enqueueUserStateToggle.mockResolvedValue({ operationId: "op:toggle" });

    await enqueuePwaLibraryCoreUserStateToggle("item-9", "liked");

    expect(mocks.enqueueUserStateToggle).toHaveBeenCalledOnce();
    expect(mocks.enqueueUserStateToggle).toHaveBeenCalledWith({
      entityId: "item-9",
      toggle: "liked",
      toggledAtMs: expect.any(Number),
    });
  });
});
