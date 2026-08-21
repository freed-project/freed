import { describe, expect, it, vi } from "vitest";
import type { FeedItem } from "../types.js";
import { normalizeLibraryCoreFeedBrowseFilterV1 } from "./feed-browse-filter-contract.js";
import {
  executeLibraryCoreScopeActionV1,
  LIBRARY_CORE_SCOPE_ACTION_BATCH_LIMIT,
  parseLibraryCoreScopeActionRequestV1,
} from "./scope-action-contracts.js";

function item(
  globalId: string,
  state: Partial<FeedItem["userState"]> = {},
): FeedItem {
  return {
    globalId,
    userState: {
      archived: false,
      hidden: false,
      liked: false,
      saved: false,
      tags: [],
      highlights: [],
      ...state,
    },
  } as FeedItem;
}

describe("Library Core scope actions", () => {
  it("commits one complete eligible set at the transaction ceiling", async () => {
    const eligible = Array.from(
      { length: LIBRARY_CORE_SCOPE_ACTION_BATCH_LIMIT },
      (_, index) => item(`item:${index}`, { readAt: 1 }),
    );
    const pages = [
      [...eligible.slice(0, 700), item("unread")],
      [...eligible.slice(700), item("saved", { readAt: 1, saved: true })],
    ];
    const batches: string[][] = [];
    const receipt = await executeLibraryCoreScopeActionV1(
      {
        action: "archive",
        filter: normalizeLibraryCoreFeedBrowseFilterV1({}),
        identityMode: "all_content",
        query: null,
        schemaVersion: 1,
      },
      {
        scan: async (visit) => {
          for (const page of pages) await visit(page);
        },
        commitBatch: vi.fn(async (_action, ids) => {
          batches.push([...ids]);
        }),
      },
    );

    expect(batches.map((batch) => batch.length)).toEqual([1_000]);
    expect(receipt).toEqual({
      affectedCount: 1_000,
      batchCount: 1,
      schemaVersion: 1,
    });
  });

  it("fails before mutation when the set requires durable staging", async () => {
    const commitBatch = vi.fn();
    await expect(
      executeLibraryCoreScopeActionV1(
        {
          action: "read",
          filter: normalizeLibraryCoreFeedBrowseFilterV1({}),
          identityMode: "all_content",
          query: null,
          schemaVersion: 1,
        },
        {
          scan: async (visit) => {
            await visit(
              Array.from(
                { length: LIBRARY_CORE_SCOPE_ACTION_BATCH_LIMIT + 1 },
                (_, index) => item(`item:${index}`),
              ),
            );
          },
          commitBatch,
        },
      ),
    ).rejects.toThrow("requires durable SQLite staging");
    expect(commitBatch).not.toHaveBeenCalled();
  });

  it("rejects open or malformed requests before scanning", () => {
    expect(() =>
      parseLibraryCoreScopeActionRequestV1({
        action: "read",
        extra: true,
        filter: normalizeLibraryCoreFeedBrowseFilterV1({}),
        identityMode: "all_content",
        query: null,
        schemaVersion: 1,
      }),
    ).toThrow("fields are invalid");
  });
});
