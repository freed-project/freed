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
  isSqliteLibraryActive,
  sqliteLibraryStatus,
} from "./sqlite-library";

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
});
