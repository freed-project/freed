import { describe, expect, it, vi } from "vitest";
import {
  hasLegacyLibraryData,
  shouldBlockForLegacyLibrary,
} from "./legacy-library-presence";
import type { SqliteStatus } from "./sqlite-library";

function resultRequest<T>(result: T): IDBRequest<T> {
  const request = { result, error: null } as unknown as IDBRequest<T>;
  queueMicrotask(() => request.onsuccess?.(new Event("success")));
  return request;
}

function existingDatabase(input: {
  documentKey?: IDBValidKey;
  byteLength?: number;
  chunkCount?: number;
}) {
  const get = vi.fn((key: IDBValidKey) => {
    if (key === "feed:byte-length") return resultRequest(input.byteLength);
    if (key === "feed:chunk-count") return resultRequest(input.chunkCount);
    return resultRequest(undefined);
  });
  const getKey = vi.fn(() => resultRequest(input.documentKey));
  const close = vi.fn();
  const database = {
    close,
    objectStoreNames: { contains: (name: string) => name === "automerge" },
    transaction: () => ({ objectStore: () => ({ get, getKey }) }),
  } as unknown as IDBDatabase;
  const request = { result: database, error: null } as unknown as IDBOpenDBRequest;
  const factory = {
    open: vi.fn(() => {
      queueMicrotask(() => request.onsuccess?.(new Event("success")));
      return request;
    }),
  } as unknown as IDBFactory;
  return { close, factory, get, getKey };
}

function status(overrides: Partial<SqliteStatus> = {}): SqliteStatus {
  return {
    active: true,
    revision: 1,
    expectedItemCount: 0,
    importedItemCount: 0,
    sourceGeneration: 0,
    sourceRevision: 0,
    sourceDigest: "0".repeat(64),
    ...overrides,
  };
}

describe("legacy Library presence", () => {
  it("detects the version 1 document key without reading its value", async () => {
    const database = existingDatabase({ documentKey: "feed" });

    await expect(hasLegacyLibraryData(database.factory)).resolves.toBe(true);
    expect(database.getKey).toHaveBeenCalledWith("feed");
    expect(database.get).not.toHaveBeenCalledWith("feed");
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("detects a chunked version 3 document from bounded metadata", async () => {
    const database = existingDatabase({ byteLength: 15_560_586, chunkCount: 15 });

    await expect(hasLegacyLibraryData(database.factory)).resolves.toBe(true);
  });

  it("aborts a missing database instead of creating it", async () => {
    const abort = vi.fn();
    const close = vi.fn();
    const request = {
      error: null,
      result: { close },
      transaction: { abort },
    } as unknown as IDBOpenDBRequest;
    const factory = {
      open: vi.fn(() => {
        queueMicrotask(() => request.onupgradeneeded?.(new Event("upgradeneeded") as IDBVersionChangeEvent));
        return request;
      }),
    } as unknown as IDBFactory;

    await expect(hasLegacyLibraryData(factory)).resolves.toBe(false);
    expect(abort).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("blocks both first initialization and a synthetic empty cutover", () => {
    expect(shouldBlockForLegacyLibrary(null, true)).toBe(true);
    expect(shouldBlockForLegacyLibrary(status(), true)).toBe(true);
    expect(
      shouldBlockForLegacyLibrary(
        status({ expectedItemCount: 14_510, importedItemCount: 14_510 }),
        true,
      ),
    ).toBe(false);
    expect(shouldBlockForLegacyLibrary(status(), false)).toBe(false);
  });
});
