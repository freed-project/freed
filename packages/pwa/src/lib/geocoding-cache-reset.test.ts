import { afterEach, describe, expect, it, vi } from "vitest";

type MutableDeleteRequest = {
  error: DOMException | null;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onblocked: ((event: Event) => void) | null;
};

function installIndexedDbDeleteMock() {
  const request: MutableDeleteRequest = {
    error: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
  };
  const openRequest: MutableDeleteRequest = {
    error: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
  };
  const deleteDatabase = vi.fn(() => request as unknown as IDBOpenDBRequest);
  const open = vi.fn(() => openRequest as unknown as IDBOpenDBRequest);
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: { deleteDatabase, open },
  });
  return { deleteDatabase, open, openRequest, request };
}

describe("geocoding cache reset", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    Reflect.deleteProperty(globalThis, "indexedDB");
  });

  it("deletes the device-local geocoding database", async () => {
    const { deleteDatabase, request } = installIndexedDbDeleteMock();
    const { clearGeocodingCache } = await import("@freed/ui/lib/geocoding-cache");

    const clearing = clearGeocodingCache();
    await Promise.resolve();
    expect(deleteDatabase).toHaveBeenCalledWith("freed-geocache");
    request.onsuccess?.(new Event("success"));

    await expect(clearing).resolves.toBeUndefined();
  });

  it("rejects when another database connection blocks deletion", async () => {
    const { open, openRequest, request } = installIndexedDbDeleteMock();
    const { clearGeocodingCache, getFromCache } = await import("@freed/ui/lib/geocoding-cache");

    const clearing = clearGeocodingCache();
    await Promise.resolve();
    request.onblocked?.(new Event("blocked"));

    await expect(clearing).rejects.toThrow("Geocoding cache is still in use");

    const readingAfterFailure = getFromCache("Portland");
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith("freed-geocache", 1);
    openRequest.onerror?.(new Event("error"));
    await expect(readingAfterFailure).resolves.toBeUndefined();
  });
});
