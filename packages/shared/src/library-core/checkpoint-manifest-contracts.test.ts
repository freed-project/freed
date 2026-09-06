import { describe, expect, it } from "vitest";
import {
  createLibraryCoreImmutableObjectKey,
  parseLibraryCoreImmutableObjectDescriptorV1,
} from "./immutable-transport-contracts.js";
import {
  parseLibraryCoreCheckpointManifestV1,
  LIBRARY_CORE_CHECKPOINT_MANIFEST_RECORD_LIMIT,
  LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_LIMIT,
  LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_RECORD_LIMIT,
} from "./checkpoint-manifest-contracts.js";

const PAGE_DIGESTS = ["11".repeat(32), "22".repeat(32)] as const;

function page(
  pageIndex: number,
  firstRecordIdentity: string,
  lastRecordIdentity: string,
  recordCount = 2,
) {
  const contentDigest = PAGE_DIGESTS[pageIndex % PAGE_DIGESTS.length]!;
  return {
    firstRecordIdentity,
    lastRecordIdentity,
    object: {
      descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
        objectKey: createLibraryCoreImmutableObjectKey({
          kind: "checkpoint_page",
          libraryId: "library-1",
          epochId: "epoch-1",
          generation: 7,
          pageIndex,
          digest: contentDigest,
        }),
        contentDigest,
        byteLength: 4_096,
      }),
      transportObjectId: `drive-page-${pageIndex.toLocaleString("en-US", {
        useGrouping: false,
      })}`,
    },
    pageIndex,
    recordCount,
  };
}

function manifest() {
  return {
    causalFrontierDigest: "fe".repeat(32),
    datasetSchemaId: "library_core_feed_card_projection_v1",
    generation: 7,
    kind: "checkpoint_manifest",
    libraryId: "library-1",
    pages: [page(0, "item-1", "item-2"), page(1, "item-3", "item-4")],
    protocolVersion: 1,
    schemaVersion: 1,
    storageEpoch: "epoch-1",
    totalRecordCount: 4,
  };
}

describe("Library Core checkpoint manifest contract", () => {
  it("derives aggregate admission from bounded pages without allocating their records", () => {
    for (const pageCount of [257, LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_LIMIT]) {
      const source = {
        ...manifest(),
        pages: Array.from({ length: pageCount }, (_, index) => {
          const prefix = String(index).padStart(6, "0");
          return page(
            index,
            `${prefix}:a`,
            `${prefix}:z`,
            LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_RECORD_LIMIT,
          );
        }),
        totalRecordCount:
          pageCount * LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_RECORD_LIMIT,
      };
      expect(parseLibraryCoreCheckpointManifestV1(source).totalRecordCount).toBe(
        source.totalRecordCount,
      );
    }
    expect(() =>
      parseLibraryCoreCheckpointManifestV1({
        ...manifest(),
        totalRecordCount: LIBRARY_CORE_CHECKPOINT_MANIFEST_RECORD_LIMIT + 1,
      }),
    ).toThrow(/totalRecordCount/);
  });
  it("closes the exact dataset, frontier, page receipts, counts, and identity ranges", () => {
    const source = manifest();
    const parsed = parseLibraryCoreCheckpointManifestV1(source);
    source.pages[0]!.object.transportObjectId = "changed-after-parse";

    expect(parsed).toMatchObject({
      causalFrontierDigest: "fe".repeat(32),
      datasetSchemaId: "library_core_feed_card_projection_v1",
      generation: 7,
      libraryId: "library-1",
      storageEpoch: "epoch-1",
      totalRecordCount: 4,
    });
    expect(parsed.pages.map((entry) => entry.object.transportObjectId)).toEqual(
      ["drive-page-0", "drive-page-1"],
    );
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.pages)).toBe(true);
    expect(Object.isFrozen(parsed.pages[0])).toBe(true);
  });

  it.each([
    [
      "a page-index gap",
      () => {
        const value = manifest();
        value.pages[1]!.pageIndex = 2;
        return value;
      },
    ],
    ["aggregate count drift", () => ({ ...manifest(), totalRecordCount: 5 })],
    [
      "a repeated provider object ID",
      () => {
        const value = manifest();
        value.pages[1]!.object.transportObjectId = "drive-page-0";
        return value;
      },
    ],
    [
      "overlapping identity ranges",
      () => {
        const value = manifest();
        value.pages[1]!.firstRecordIdentity = "item-2";
        return value;
      },
    ],
    [
      "a page from another epoch",
      () => {
        const value = manifest();
        const descriptor = value.pages[1]!.object.descriptor;
        value.pages[1]!.object.descriptor =
          parseLibraryCoreImmutableObjectDescriptorV1({
            ...descriptor,
            objectKey: createLibraryCoreImmutableObjectKey({
              kind: "checkpoint_page",
              libraryId: "library-1",
              epochId: "epoch-2",
              generation: 7,
              pageIndex: 1,
              digest: descriptor.contentDigest,
            }),
          });
        return value;
      },
    ],
    [
      "an unsupported dataset schema",
      () => ({
        ...manifest(),
        datasetSchemaId: "complete_library_maybe_vibes",
      }),
    ],
    [
      "a decorated page array",
      () => {
        const value = manifest();
        Object.defineProperty(value.pages, "surprise", {
          enumerable: true,
          value: "not part of the wire contract",
        });
        return value;
      },
    ],
  ])("rejects %s", (_label, invalid) => {
    expect(() => parseLibraryCoreCheckpointManifestV1(invalid())).toThrow();
  });
});
