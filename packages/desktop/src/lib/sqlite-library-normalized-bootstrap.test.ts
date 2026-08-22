import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  queryNormalizedLibrary: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock("./library-core-normalized-query-client", () => ({
  queryNormalizedLibrary: mocks.queryNormalizedLibrary,
}));

const { loadSqliteLibraryState } = await import("./sqlite-library");

describe("Freed Desktop normalized bootstrap projection", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.queryNormalizedLibrary.mockReset();
  });

  it("loads only bounded facets and preferences without reading a shell", async () => {
    mocks.queryNormalizedLibrary.mockImplementation(async (request) => {
      if (request.queryId === "library_facet_summary_v1") {
        return {
          queryId: request.queryId,
          schemaVersion: request.schemaVersion,
          source: {
            generationId: "1".repeat(64),
            projectionRevision: 7,
            transitionSequence: 11,
          },
          summary: {
            archivedCount: 3,
            sampleItemCount: 0,
            savedArchivedCount: 0,
            savedCount: 2,
            savedPlatformCount: 1,
            tags: [],
            totalCount: 19,
          },
        };
      }
      if (request.queryId === "preferences_snapshot_v1") {
        return {
          queryId: request.queryId,
          schemaVersion: request.schemaVersion,
          source: {
            generationId: "1".repeat(64),
            projectionRevision: 7,
            transitionSequence: 11,
          },
          rows: [],
        };
      }
      throw new Error("unexpected normalized query");
    });

    await expect(loadSqliteLibraryState()).resolves.toEqual(
      expect.objectContaining({
        accounts: {},
        docItemCount: 19,
        feeds: {},
        items: [],
        persons: {},
        searchCorpusVersion: 11,
        totalArchivableCount: 16,
        totalItemCount: 19,
      }),
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(
      mocks.queryNormalizedLibrary.mock.calls.map(
        ([request]) => request.queryId,
      ),
    ).toEqual(["library_facet_summary_v1", "preferences_snapshot_v1"]);
  });
});
