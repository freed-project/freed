import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  status: null as null | {
    active: boolean;
    revision: number;
    expectedItemCount: number;
    importedItemCount: number;
    sourceGeneration: number;
    sourceRevision: number;
    sourceDigest: string;
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

import {
  beginPortableSqliteLibraryImport,
  finalizePortableSqliteLibraryImport,
  isSqliteLibraryActive,
  sqliteLibraryStatus,
} from "./sqlite-library";
import type { SqliteLibraryFollowerAnchorInput } from "./sqlite-library";

const request = {
  expectedItemCount: 1,
  shell: {},
  sourceDigest: "ab".repeat(32),
  sourceGeneration: 2,
  sourceRevision: 3,
};

describe("SQLite staged import runtime state", () => {
  beforeEach(() => {
    mocks.status = null;
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "begin_sqlite_library_import") return null;
      if (command === "finalize_sqlite_library_import") return mocks.status;
      if (command === "sqlite_library_status") return mocks.status;
      throw new Error(`Unexpected native command: ${command}`);
    });
  });

  it("keeps an existing active Library fenced while a replacement stages", async () => {
    mocks.status = {
      active: true,
      revision: 8,
      expectedItemCount: 1,
      importedItemCount: 1,
      sourceGeneration: 1,
      sourceRevision: 7,
      sourceDigest: "cd".repeat(32),
    };
    await sqliteLibraryStatus();

    await beginPortableSqliteLibraryImport(request);

    expect(isSqliteLibraryActive()).toBe(true);
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "begin_sqlite_library_import",
      expect.anything(),
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "sqlite_library_status");
  });

  it("keeps a first Library inactive until its staged import finalizes", async () => {
    await sqliteLibraryStatus();

    await beginPortableSqliteLibraryImport(request);

    expect(isSqliteLibraryActive()).toBe(false);
  });

  it("binds a follower anchor into the same native activation request", async () => {
    mocks.status = {
      active: true,
      revision: 1,
      expectedItemCount: 1,
      importedItemCount: 1,
      sourceGeneration: 2,
      sourceRevision: 3,
      sourceDigest: "ab".repeat(32),
    };
    const followerAnchor = {
      authority: {
        library_id: "bc".repeat(32),
        epoch: 2,
        epoch_id: "cd".repeat(32),
        authority_key_id: "de".repeat(32),
        authority_public_key: "ef".repeat(32),
        observed_frontier: [],
      },
      manifestObjectKey: "checkpoints/2/manifest.json",
      manifestTransportObjectId: "drive-manifest-object-4",
      manifestContentDigest: "ab".repeat(32),
      generation: 4,
      remoteIngestSequence: 3,
      remoteMaterializedDigest: "12".repeat(32),
      writerId: "23".repeat(32),
      controlRevision: "drive-revision-4",
      checkpointActor: null,
      installedAtMs: 4,
    } as unknown as SqliteLibraryFollowerAnchorInput;

    await finalizePortableSqliteLibraryImport(followerAnchor);

    expect(mocks.invoke).toHaveBeenCalledWith(
      "finalize_sqlite_library_import",
      expect.objectContaining({ followerAnchor }),
    );
    expect(isSqliteLibraryActive()).toBe(true);
  });
});
