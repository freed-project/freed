import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  nativeState: null as unknown,
  publishRequest: null as Record<string, unknown> | null,
  readDescriptor: vi.fn(),
  readPage: vi.fn(),
  writeNative: vi.fn(),
  publish: vi.fn(),
  desktopRegistrationId: "desktop-registration-1",
}));

vi.mock("./desktop-client-registration", () => ({
  getOrCreateDesktopClientRegistration: vi.fn(async () => ({
    id: mocks.desktopRegistrationId,
    registeredAt: 1,
  })),
}));

vi.mock("./native-json-store", () => ({
  readNativeJsonValue: vi.fn(async () => mocks.nativeState),
  writeNativeJsonValue: mocks.writeNative.mockImplementation(
    async (_file: string, _key: string, value: unknown) => {
      mocks.nativeState = value;
    },
  ),
}));

vi.mock("./sqlite-library", () => ({
  readSqliteLibrarySyncDescriptor: mocks.readDescriptor,
  readSqliteLibrarySyncPage: mocks.readPage,
  sqliteLibraryStatus: vi.fn(async () => ({ active: true, revision: 7 })),
}));

vi.mock("@freed/sync/cloud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@freed/sync/cloud")>();
  return {
    ...actual,
    provisionGoogleDriveLibraryCoreControlV1: vi.fn(async () => ({
      controlFileId: "control-1",
      created: true,
    })),
    createGoogleDriveLibraryCoreAdapterV1: vi.fn(() => ({
      readControl: vi.fn(async () => ({
        revision: '"etag-1"',
        bytes: new TextEncoder().encode("{}"),
      })),
    })),
    publishLibraryCorePortableCheckpointV1: mocks.publish.mockImplementation(
      async (request: Record<string, unknown>) => {
        mocks.publishRequest = request;
        const entries: unknown[] = [];
        for await (const entry of request.entries as AsyncIterable<unknown>) {
          entries.push(entry);
        }
        return {
          status: "committed",
          revision: '"etag-2"',
          dependencies: [],
          manifest: {},
          controlPointer: {},
          entries,
        };
      },
    ),
  };
});

import { publishCurrentSqliteLibraryToGoogleDrive } from "./library-core-cloud-sync";

describe("SQLite Library Google Drive production wiring", () => {
  beforeEach(() => {
    mocks.nativeState = null;
    mocks.desktopRegistrationId = "desktop-registration-1";
    mocks.publishRequest = null;
    mocks.publish.mockClear();
    mocks.writeNative.mockClear();
    mocks.readDescriptor.mockReset().mockResolvedValue({
      revision: 7,
      itemCount: 2,
      sourceDigest: "ab".repeat(32),
      shellJson: '{"accounts":{},"feeds":{},"persons":{}}',
      materializedDigest: "cd".repeat(32),
    });
    mocks.readPage.mockReset().mockResolvedValue({
      revision: 7,
      itemsJson: [
        '{"globalId":"item-1","platform":"rss"}',
        '{"globalId":"item-2","platform":"youtube"}',
      ],
      nextOffset: null,
    });
  });

  it("streams the exact SQLite revision into one immutable checkpoint publication", async () => {
    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({ status: "published", revision: 7 });

    expect(mocks.readPage).toHaveBeenCalledWith({
      revision: 7,
      offset: 0,
    });
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const request = mocks.publishRequest;
    expect(request?.generation).toBe(0);
    expect(request?.writerId).toBe("desktop-desktop-registration-1");
    expect(request?.header).toMatchObject({
      collection_counts: { materialized_rows: 3 },
      epoch: 1,
      materializer_position: {
        ingest_sequence: 7,
        materialized_digest: "cd".repeat(32),
      },
      schema_version: 2,
    });
    expect(mocks.nativeState).toMatchObject({
      controlFileId: "control-1",
      lastPublishedRevision: 7,
    });
  });

  it("refuses cloud publication when restored state belongs to another Desktop installation", async () => {
    mocks.nativeState = {
      version: 1,
      libraryId: `library-${"ab".repeat(20)}`,
      sourceDigest: "ab".repeat(32),
      storageEpoch: "epoch-original",
      writerId: "desktop-original-installation",
      controlFileId: "control-1",
      lastPublishedRevision: 6,
    };
    mocks.desktopRegistrationId = "restored-installation";

    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({
      status: "ownership_required",
      currentWriterId: "desktop-original-installation",
      localWriterId: "desktop-restored-installation",
    });

    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.writeNative).not.toHaveBeenCalled();
  });
});
