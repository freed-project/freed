import { describe, expect, it, vi } from "vitest";
import type { FeedItem } from "../types.js";
import { normalizeLibraryCoreFeedBrowseFilterV1 } from "./feed-browse-filter-contract.js";
import {
  digestLibraryCoreRssFeedScopeActionRequestV1,
  executeLibraryCoreScopeActionV1,
  LIBRARY_CORE_SCOPE_ACTION_BATCH_LIMIT,
  parseLibraryCoreRssFeedScopeActionRequestV1,
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
  function stageRuntime(
    scan: Parameters<typeof executeLibraryCoreScopeActionV1>[1]["scan"],
    batches: string[][],
  ): Parameters<typeof executeLibraryCoreScopeActionV1>[1] {
    const staged: string[] = [];
    return {
      scan,
      beginStage: async () => "stage:1",
      appendStage: async (_stageId, ids) => {
        staged.push(...ids);
      },
      finalizeStage: async () => staged.length,
      readStage: async (_stageId, afterOrdinal) => {
        const entityIds = staged.slice(
          afterOrdinal + 1,
          afterOrdinal + 1 + LIBRARY_CORE_SCOPE_ACTION_BATCH_LIMIT,
        );
        return {
          entityIds,
          nextOrdinal: afterOrdinal + entityIds.length,
        };
      },
      closeStage: async () => {},
      commitBatch: vi.fn(async (_action, ids) => {
        batches.push([...ids]);
      }),
    };
  }

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
      stageRuntime(async (visit) => {
        for (const page of pages) await visit(page);
      }, batches),
    );

    expect(batches.map((batch) => batch.length)).toEqual([1_000]);
    expect(receipt).toEqual({
      affectedCount: 1_000,
      batchCount: 1,
      schemaVersion: 1,
    });
  });

  it("processes a larger frozen set through multiple bounded transactions", async () => {
    const batches: string[][] = [];
    const receipt = await executeLibraryCoreScopeActionV1(
      {
        action: "read",
        filter: normalizeLibraryCoreFeedBrowseFilterV1({}),
        identityMode: "all_content",
        query: null,
        schemaVersion: 1,
      },
      stageRuntime(async (visit) => {
        await visit(
          Array.from(
            { length: LIBRARY_CORE_SCOPE_ACTION_BATCH_LIMIT + 1 },
            (_, index) => item(`item:${index}`),
          ),
        );
      }, batches),
    );
    expect(batches.map((batch) => batch.length)).toEqual([1_000, 1]);
    expect(receipt).toEqual({
      affectedCount: 1_001,
      batchCount: 2,
      schemaVersion: 1,
    });
  });

  it("closes staging when a bounded transaction fails", async () => {
    const closeStage = vi.fn(async () => {});
    const runtime = stageRuntime(async (visit) => visit([item("item:1")]), []);
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
          ...runtime,
          closeStage,
          commitBatch: async () => {
            throw new Error("commit failed");
          },
        },
      ),
    ).rejects.toThrow("commit failed");
    expect(closeStage).toHaveBeenCalledWith("stage:1");
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

  it("closes and digests RSS Feed scope action identities", () => {
    const request = {
      action: "rss_feeds_remove_keep_items" as const,
      schemaVersion: 1 as const,
    };
    expect(parseLibraryCoreRssFeedScopeActionRequestV1(request)).toEqual(
      request,
    );
    expect(digestLibraryCoreRssFeedScopeActionRequestV1(request)).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(() =>
      parseLibraryCoreRssFeedScopeActionRequestV1({ ...request, extra: true }),
    ).toThrow("fields are invalid");
  });
});
