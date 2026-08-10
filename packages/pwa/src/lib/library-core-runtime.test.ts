import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSelectedCollectionPage: vi.fn(),
  readSelectedMaterializedRow: vi.fn(),
}));

vi.mock("./library-core-portable-checkpoint-store", () => ({
  createPwaLibraryCorePortableCheckpointStore: () => ({
    readSelectedCollectionPage: mocks.readSelectedCollectionPage,
    readSelectedMaterializedRow: mocks.readSelectedMaterializedRow,
  }),
}));

vi.mock("./factory-reset-coordinator", () => ({
  registerPwaFactoryResetQuiesceHandler: vi.fn(),
}));

import {
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
    mocks.readSelectedCollectionPage.mockReset();
    mocks.readSelectedMaterializedRow.mockReset();
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
});
